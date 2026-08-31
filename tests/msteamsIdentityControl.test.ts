// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createMicrosoftIdentityControl, createMicrosoftIdentityRuntime, driveScopedPath } from '../plugins/msteams/lib/identityControl.mjs';

type Person = { id: string; aad: string; upn?: string; name?: string };

/** A directory of two known people, only the first of whom is bound to an Elowen account. */
function fixture(overrides: { token?: unknown; people?: Person[] } = {}) {
  const people = overrides.people ?? [
    { id: '29:filip', aad: 'aad-filip', upn: 'filip@example.test', name: 'Filip' },
    { id: '29:stranger', aad: 'aad-stranger', upn: 'stranger@example.test', name: 'Stranger' },
  ];
  const delegatedSessionForPerson = vi.fn(async () => {
    if (overrides.token instanceof Error) throw overrides.token;
    if (overrides.token === null) throw new Error('sign in required');
    return { token: overrides.token === undefined ? 'delegated-token' : overrides.token };
  });
  const linking = {
    bindingFor: (aad: string) => (aad === 'aad-filip' ? { user: { id: 7 } } : null),
    delegatedSessionForPerson,
    delegatedSession: vi.fn(async () => ({ token: 'interactive-token' })),
  };
  const warn = vi.fn();
  const runtime = createMicrosoftIdentityRuntime({
    linking, people: { list: () => people }, logger: { warn },
  });
  return { control: runtime.control, runtime, delegatedSessionForPerson, warn };
}

describe('microsoftIdentity control', () => {
  it('reports the linked identity for a bound account and nothing for anyone else', () => {
    const { control } = fixture();
    expect(control.identityFor(7)).toEqual({ linked: true, upn: 'filip@example.test', displayName: 'Filip' });
    // An account nobody bound, and a nonsense id, both read as "not connected" rather than throwing —
    // the caller's whole job is to skip that account, and a throw would make an ordinary state an error.
    expect(control.identityFor(99)).toEqual({ linked: false });
    expect(control.identityFor(Number.NaN)).toEqual({ linked: false });
  });

  it('mints a delegated client for a bound account and refuses everyone else', async () => {
    const { control, delegatedSessionForPerson } = fixture();
    const graph = await control.driveGraphFor(7);
    expect(graph).not.toBeNull();
    expect(delegatedSessionForPerson).toHaveBeenCalledWith(expect.objectContaining({ id: '29:filip', aad: 'aad-filip' }), 7);
    expect(await control.driveGraphFor(99)).toBeNull();
  });

  it('reads a missing or failing token as not connected, never as a fault', async () => {
    expect(await fixture({ token: null }).control.driveGraphFor(7)).toBeNull();

    const people: Person[] = [{ id: '29:filip', aad: 'aad-filip' }];
    const warn = vi.fn();
    const control = createMicrosoftIdentityControl({
      linking: {
        bindingFor: () => ({ user: { id: 7 } }),
        delegatedSessionForPerson: async () => { throw new Error('token service down'); },
        delegatedSession: async () => { throw new Error('interactive only'); },
      },
      people: { list: () => people },
      logger: { warn },
    });
    expect(await control.driveGraphFor(7)).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('token service down'));
  });

  it('resolves a host-verified scheduled identity through the durable account binding', async () => {
    const { runtime, delegatedSessionForPerson } = fixture();
    const session = await runtime.sessionForIdentity({
      platform: 'cron', userId: 'cron', elowenUserId: 7, automation: 'scheduled',
    });
    expect(session).toMatchObject({ token: 'delegated-token' });
    expect(delegatedSessionForPerson).toHaveBeenCalledWith(expect.objectContaining({ aad: 'aad-filip' }), 7);
  });

  it('fails closed when scheduled identity has no account or no durable Microsoft binding', async () => {
    const { runtime } = fixture();
    await expect(runtime.sessionForIdentity({ platform: 'cron', userId: 'cron', automation: 'scheduled' }))
      .rejects.toThrow('verified Elowen account');
    await expect(runtime.sessionForIdentity({ platform: 'cron', userId: 'cron', elowenUserId: 99, automation: 'scheduled' }))
      .rejects.toThrow('no linked Microsoft identity');
  });

  it.each([
    { platform: 'elowen', userId: '7', elowenUserId: 7, conversation: 'own' },
    { platform: 'msteams', userId: 'aad-filip', elowenUserId: 7, conversation: 'direct' },
    { platform: 'discord', userId: 'discord-filip', elowenUserId: 7, conversation: 'shared' },
    { platform: 'cron', userId: 'cron', elowenUserId: 7, automation: 'scheduled', conversation: 'shared' },
  ])('resolves the same durable Microsoft account on every verified Elowen surface: $platform', async (identity) => {
    const { runtime, delegatedSessionForPerson } = fixture();
    await expect(runtime.sessionForIdentity(identity)).resolves.toMatchObject({ token: 'delegated-token' });
    expect(delegatedSessionForPerson).toHaveBeenCalledWith(expect.objectContaining({ aad: 'aad-filip' }), 7);
  });

  it('confines the client to the drive namespace, after resolving the path', async () => {
    // The point of the allow-list: the token behind this client carries every scope the tenant consented
    // to, so a consumer must not be able to reach mail, calendar, chats or the directory with it.
    expect(driveScopedPath('/me/drive/root/children')).toBe('/me/drive/root/children');
    expect(driveScopedPath('/me/drive/root:/Elowen/a.txt:/content')).toBe('/me/drive/root:/Elowen/a.txt:/content');
    expect(driveScopedPath('/drives/b!abc/items/01ABC/delta?token=x')).toBe('/drives/b!abc/items/01ABC/delta?token=x');

    for (const outside of ['/me/messages', '/me/events', '/users/someone', '/chats/19:x/messages', '/me/drives']) {
      expect(() => driveScopedPath(outside)).toThrow('outside the drive namespace');
    }
    // Traversal is why the check runs on the RESOLVED path: a prefix test on the raw string would pass
    // this, and Graph would then serve the mailbox it actually resolves to.
    expect(() => driveScopedPath('/me/drive/../messages')).toThrow('outside the drive namespace');
    expect(() => driveScopedPath('/me/drive/root/../../messages')).toThrow('outside the drive namespace');
    expect(() => driveScopedPath('https://graph.microsoft.com/v1.0/me/messages')).toThrow('relative');
    expect(() => driveScopedPath('/../beta/me/drive')).toThrow('v1.0');
  });

  it('applies the confinement on every method the client exposes', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    const people: Person[] = [{ id: '29:filip', aad: 'aad-filip' }];
    const control = createMicrosoftIdentityControl({
      linking: {
        bindingFor: () => ({ user: { id: 7 } }),
        delegatedSessionForPerson: async () => ({ token: 'tok' }),
        delegatedSession: async () => ({ token: 'interactive-token' }),
      },
      people: { list: () => people },
      logger: { warn: vi.fn() },
    });
    const graph = (await control.driveGraphFor(7))!;
    // Swap in a stub fetch on the wrapped client so no real request leaves the test.
    (graph as unknown as { client: { fetch: typeof fetch } }).client.fetch = fetch;

    await expect(graph.json('GET', '/me/messages')).rejects.toThrow('outside the drive namespace');
    await expect(graph.request('GET', '/me/messages')).rejects.toThrow('outside the drive namespace');
    await expect(graph.binary('/me/messages')).rejects.toThrow('outside the drive namespace');
    expect(fetch).not.toHaveBeenCalled();

    await expect(graph.json('GET', '/me/drive/root')).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledWith('https://graph.microsoft.com/v1.0/me/drive/root', expect.anything());
  });
});
