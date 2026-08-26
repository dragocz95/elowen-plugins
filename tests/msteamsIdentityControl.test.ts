// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createMicrosoftIdentityControl, driveScopedPath } from '../plugins/msteams/lib/identityControl.mjs';

type Person = { id: string; aad: string; upn?: string; name?: string };

/** A directory of two known people, only the first of whom is bound to an Elowen account. */
function fixture(overrides: { token?: unknown; people?: Person[] } = {}) {
  const people = overrides.people ?? [
    { id: '29:filip', aad: 'aad-filip', upn: 'filip@example.test', name: 'Filip' },
    { id: '29:stranger', aad: 'aad-stranger', upn: 'stranger@example.test', name: 'Stranger' },
  ];
  const tokenForUser = vi.fn(async () => (overrides.token === undefined ? 'delegated-token' : overrides.token));
  const linking = {
    bindingFor: (aad: string) => (aad === 'aad-filip' ? { user: { id: 7 } } : null),
    tokenForUser,
  };
  const warn = vi.fn();
  const control = createMicrosoftIdentityControl({
    linking, people: { list: () => people }, logger: { warn },
  });
  return { control, tokenForUser, warn };
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
    const { control, tokenForUser } = fixture();
    const graph = await control.driveGraphFor(7);
    expect(graph).not.toBeNull();
    expect(tokenForUser).toHaveBeenCalledWith('29:filip');
    expect(await control.driveGraphFor(99)).toBeNull();
  });

  it('reads a missing or failing token as not connected, never as a fault', async () => {
    expect(await fixture({ token: null }).control.driveGraphFor(7)).toBeNull();

    const people: Person[] = [{ id: '29:filip', aad: 'aad-filip' }];
    const warn = vi.fn();
    const control = createMicrosoftIdentityControl({
      linking: {
        bindingFor: () => ({ user: { id: 7 } }),
        tokenForUser: async () => { throw new Error('token service down'); },
      },
      people: { list: () => people },
      logger: { warn },
    });
    expect(await control.driveGraphFor(7)).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('token service down'));
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
      linking: { bindingFor: () => ({ user: { id: 7 } }), tokenForUser: async () => 'tok' },
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
