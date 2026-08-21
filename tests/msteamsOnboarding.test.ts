// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { PlatformOrchestrator } from 'elowen/dist/brain/platforms.js';
import { IdentityResolver } from 'elowen/dist/brain/identity.js';
import { MsTeamsAdapter } from '../plugins/msteams/lib/adapter.mjs';
import { TeamsAccountLinking } from '../plugins/msteams/lib/accountLinking.mjs';

const TENANT = 'tenant-guid';
const PERSON_A = { teamsId: '29:alex', objectId: 'aad-alex', name: 'Alex Rivera', email: 'alex@contoso.com' };
const PERSON_B = { teamsId: '29:dana', objectId: 'aad-dana', name: 'Dana Novak', email: 'dana@contoso.com' };

const token = (claims: Record<string, unknown>) => `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.x`;

function activity(person = PERSON_A, conversationType = 'personal', conversationId = 'personal-alex') {
  return {
    type: 'message', id: `msg-${person.objectId}`, text: 'hello', serviceUrl: 'https://smba.test/emea',
    channelId: 'msteams',
    from: { id: person.teamsId, aadObjectId: person.objectId, name: person.name },
    recipient: { id: '28:bot', name: 'Chetty' },
    conversation: { id: conversationId, conversationType, tenantId: TENANT },
  };
}

class MemoryState {
  data: Record<string, Record<string, unknown>> = {};
  all() { return this.data; }
  get(id: string) { return this.data[id] ?? {}; }
  patch(id: string, fields: Record<string, unknown>) { this.data[id] = { ...this.data[id], ...fields }; }
}

describe('msteams owner onboarding flow', () => {
  it('provisions an unknown tenant member and resolves each linked channel sender through their own account policy', async () => {
    const users = new Map<number, { id: number; username: string; name: string; is_admin: boolean }>();
    const bindings = new Map<string, number>();
    users.set(20, { id: 20, username: 'dana', name: PERSON_B.name, is_admin: false });
    bindings.set(PERSON_B.objectId, 20);

    const externalUsers = {
      resolve: (_provider: string, _tenantId: string, subjectId: string) => {
        const id = bindings.get(subjectId);
        return id === undefined ? null : users.get(id) ?? null;
      },
      describe: (_provider: string, _tenantId: string, subjectId: string) => {
        const id = bindings.get(subjectId);
        const user = id === undefined ? undefined : users.get(id);
        return user ? { user } : null;
      },
      linkOrProvision: (input: { subjectId: string; preferredUsername: string; name: string }) => {
        const existingId = bindings.get(input.subjectId);
        if (existingId !== undefined) return { user: users.get(existingId)!, created: false };
        const user = { id: 21, username: input.preferredUsername, name: input.name, is_admin: false };
        users.set(user.id, user);
        bindings.set(input.subjectId, user.id);
        return { user, created: true };
      },
    };

    const tokens = new Map<string, string>();
    const profiles = new Map<string, Record<string, unknown>>([
      [PERSON_A.objectId, { id: PERSON_A.objectId, displayName: PERSON_A.name, userPrincipalName: PERSON_A.email, mail: PERSON_A.email, accountEnabled: true, userType: 'Member' }],
      [PERSON_B.objectId, { id: PERSON_B.objectId, displayName: PERSON_B.name, userPrincipalName: PERSON_B.email, mail: PERSON_B.email, accountEnabled: true, userType: 'Member' }],
    ]);
    const tokenClient = {
      getUserToken: async (teamsId: string) => ({ token: tokens.get(teamsId) }),
      getSignInResource: async () => ({ signInLink: 'https://login.test/authorize' }),
      signOutUser: async () => {},
    };
    const graphFetch = async (_url: string, init?: { headers?: { authorization?: string } }) => {
      const raw = String(init?.headers?.authorization ?? '').replace(/^Bearer /, '');
      const claims = JSON.parse(Buffer.from(raw.split('.')[1] ?? '', 'base64url').toString('utf8')) as { oid?: string };
      return { ok: true, json: async () => profiles.get(String(claims.oid)) ?? {} };
    };
    const logger = { info() {}, warn() {}, error() {} };
    const linking = new TeamsAccountLinking({
      appId: 'app', appPassword: 'secret', tenantId: TENANT, accountLinking: true,
      oauthConnectionName: 'Chetty delegated access',
    }, externalUsers, logger, { tokenClient, fetch: graphFetch });

    const adapter = new MsTeamsAdapter(
      { appId: 'app', appPassword: 'secret', tenantId: TENANT, accountLinking: true, rolePolicies: [] },
      logger, new MemoryState(), async () => [], [], () => null, () => false, () => [], linking as never,
    );
    const connectorCalls: { kind: string; args: unknown[] }[] = [];
    Object.assign(adapter.connector, {
      member: async (_serviceUrl: string, _conversationId: string, teamsId: string) => ({
        userPrincipalName: teamsId === PERSON_B.teamsId ? PERSON_B.email : PERSON_A.email,
      }),
      reply: async (...args: unknown[]) => { connectorCalls.push({ kind: 'reply', args }); return 'reply-1'; },
      typing: async () => {}, addReaction: async () => {}, deleteReaction: async () => {}, token: async () => 'connector-token',
    });

    expect(externalUsers.resolve('msteams', TENANT, PERSON_A.objectId)).toBeNull();
    adapter.listen(async () => { throw new Error('the brain must not run before sign-in'); });
    await adapter.onActivity(activity());
    expect(connectorCalls.find((call) => call.kind === 'reply')?.args[3]).toMatchObject({
      attachments: [{ contentType: 'application/vnd.microsoft.card.oauth' }],
    });

    tokens.set(PERSON_A.teamsId, token({ tid: TENANT, oid: PERSON_A.objectId }));
    const authorized = await linking.authenticate(activity());
    expect(authorized).toMatchObject({ status: 'authorized', created: true, user: { id: 21, username: 'alex' } });
    expect(externalUsers.resolve('msteams', TENANT, PERSON_A.objectId)).toMatchObject({ id: 21 });

    const rejected = async (person: typeof PERSON_A, claims: Record<string, unknown>, profile: Record<string, unknown>) => {
      profiles.set(person.objectId, profile);
      tokens.set(person.teamsId, token(claims));
      return linking.authenticate(activity(person));
    };
    await expect(rejected(PERSON_A, { tid: TENANT, oid: PERSON_A.objectId }, {
      ...profiles.get(PERSON_A.objectId), userType: 'Guest', accountEnabled: true,
    })).rejects.toMatchObject({ code: 'not_member' });
    await expect(rejected(PERSON_A, { tid: TENANT, oid: PERSON_A.objectId }, {
      ...profiles.get(PERSON_A.objectId), userType: 'Member', accountEnabled: false,
    })).rejects.toMatchObject({ code: 'disabled' });
    await expect(rejected(PERSON_A, { tid: 'other-tenant', oid: PERSON_A.objectId }, profiles.get(PERSON_A.objectId)!))
      .rejects.toMatchObject({ code: 'wrong_tenant' });
    await expect(rejected(PERSON_A, { tid: TENANT, oid: 'aad-someone-else' }, profiles.get(PERSON_A.objectId)!))
      .rejects.toMatchObject({ code: 'identity_mismatch' });

    profiles.set(PERSON_A.objectId, { id: PERSON_A.objectId, displayName: PERSON_A.name, userPrincipalName: PERSON_A.email, mail: PERSON_A.email, accountEnabled: true, userType: 'Member' });
    tokens.set(PERSON_A.teamsId, token({ tid: TENANT, oid: PERSON_A.objectId }));

    const policies = new Map<number, { allowedProjectIds: Set<number>; allowedPaths: () => string[] }>([
      [21, { allowedProjectIds: new Set([11]), allowedPaths: () => ['/projects/alex'] }],
      [20, { allowedProjectIds: new Set([22]), allowedPaths: () => ['/projects/dana'] }],
    ]);
    const denies = new Map<number, string[]>([[21, ['AlexDenied']], [20, ['DanaDenied']]]);
    const sent: Array<Record<string, unknown>> = [];
    const identity = new IdentityResolver({
      platformOwner: () => 1,
      resolvePlatformUser: (_platform: string, platformUserId: string) => {
        const id = bindings.get(platformUserId);
        const user = id === undefined ? undefined : users.get(id);
        return user ? { id: user.id, name: user.name, username: user.username, admin: user.is_admin } : null;
      },
      users: { get: (id: number) => users.get(id) },
    });
    const orchestrator = new PlatformOrchestrator({
      plugins: async () => ({ platforms: [adapter] }) as never,
      platformOwner: () => 1,
      policyForProjects: (projectIds: number[]) => ({ allowedProjectIds: new Set(projectIds), allowedPaths: () => [] }),
      policyForUser: (userId: number) => policies.get(userId)!,
      disabledToolsFor: (userId: number) => denies.get(userId) ?? [],
      identity,
      channels: { send: async (opts: unknown) => { sent.push(opts as Record<string, unknown>); return 'ok'; }, fragmentFor: () => '' } as never,
      dispatch: { send: async () => { throw new Error('not delegated'); } },
    });
    await orchestrator.startAll();

    await adapter.onActivity(activity(PERSON_A, 'channel', '19:shared-thread'));
    await adapter.onActivity(activity(PERSON_B, 'channel', '19:shared-thread'));

    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ policy: policies.get(21), writerUserId: 21 });
    expect((sent[0]?.toolPolicy as { deny?: Set<string> })?.deny).toEqual(new Set(['AlexDenied']));
    expect(sent[1]).toMatchObject({ policy: policies.get(20), writerUserId: 20 });
    expect((sent[1]?.toolPolicy as { deny?: Set<string> })?.deny).toEqual(new Set(['DanaDenied']));
  });
});
