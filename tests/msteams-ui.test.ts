import { describe, expect, it } from 'vitest';
import {
  accountDetailPath,
  accountIdentityFromDetail,
  accountLinkOptions,
  bindAccountRequest,
  directPolicyIndex,
  effectivePersonPolicy,
  globalSettingsDetail,
  linkedUserFor,
  matchesPerson,
  peopleWithAccountDetail,
  upsertDirectPolicy,
} from '../plugins/msteams/web-src/TeamsWorkspace';
import type { PluginDetail, RolePolicy, TeamsAccountDetail, TeamsPerson, User } from '../plugins/msteams/web-src/runtime';

const person: TeamsPerson = {
  key: 'aad-1',
  name: 'Alex Rivera',
  upn: 'Alex@Example.com',
  aadObjectId: 'aad-1',
  teamsId: '29:encrypted',
  hasPersonalChat: true,
  lastSeenAt: 123,
  identity: { linked: true, user: { id: 2, username: 'michal', isAdmin: false }, linkedAt: '2026-08-19T01:00:00Z' },
};
const policy = (roleId: string): RolePolicy => ({ roleId, name: 'Alex', projectIds: [] });

const accountDetail: TeamsAccountDetail = {
  linked: true,
  user: { id: 2, username: 'michal', isAdmin: false },
  linkedAt: '2026-08-19T01:00:00Z',
  signedIn: true,
  verifiedAt: '2026-08-19T02:00:00Z',
  profile: {
    id: 'aad-1',
    displayName: 'Alex Rivera',
    userPrincipalName: 'alex@example.com',
    mail: 'alex@example.com',
    accountEnabled: true,
    userType: 'Member',
  },
};

describe('Teams person access matching', () => {
  it('matches Entra and Teams ids exactly', () => {
    expect(matchesPerson(policy('aad-1'), person)).toBe(true);
    expect(matchesPerson(policy('AAD-1'), person)).toBe(false);
    expect(matchesPerson(policy('29:encrypted'), person)).toBe(true);
  });

  it('matches UPNs case-insensitively', () => {
    expect(matchesPerson(policy('alex@example.com'), person)).toBe(true);
  });

  it('does not present wildcard or conversation policies as direct person mappings', () => {
    expect(matchesPerson(policy('*'), person)).toBe(false);
    expect(matchesPerson(policy('a:conversation'), person)).toBe(false);
  });

  it('treats a person policy below a wildcard or conversation policy as shadowed', () => {
    expect(directPolicyIndex([policy('aad-1'), policy('*')], person)).toBe(0);
    expect(directPolicyIndex([policy('*'), policy('aad-1')], person)).toBe(-1);
    expect(directPolicyIndex([policy('19:channel'), policy('aad-1')], person)).toBe(-1);
  });

  it('relocates an existing person policy without duplicating it or losing its access configuration', () => {
    const existing = { ...policy('aad-1'), admin: true, projectIds: [1], tools: ['RaynetSearch'], prompt: 'Private context' };
    const updated = upsertDirectPolicy(
      [policy('19:channel'), existing, policy('*')],
      person,
      { ...policy('aad-1'), name: 'Empty replacement' },
    );
    expect(updated.map((entry) => entry.roleId)).toEqual(['aad-1', '19:channel', '*']);
    expect(updated.filter((entry) => entry.roleId === 'aad-1')).toHaveLength(1);
    expect(updated[0]).toEqual(existing);
  });

  it('uses first-match semantics for effective per-person admin access', () => {
    const direct = { ...policy('aad-1'), admin: false };
    const wildcard = { ...policy('*'), admin: true };
    expect(effectivePersonPolicy([direct, wildcard], person)).toBe(direct);
    expect(effectivePersonPolicy([wildcard, direct], person)).toBe(wildcard);
  });

  it('resolves the linked account from the verified person identity', () => {
    const users: User[] = [
      { id: 1, username: 'filip', name: 'Filip', avatar: '1.png' },
      { id: 2, username: 'michal', name: 'Michal' },
    ];
    expect(linkedUserFor(person, users)).toBe(users[1]);
    expect(linkedUserFor({ ...person, identity: undefined }, users)).toBeUndefined();
  });

  it('gives an unlinked identity its own option so the field cannot read as linked to the first account', () => {
    const users: User[] = [
      { id: 1, username: 'filip', name: 'Filip' },
      { id: 2, username: 'michal', name: 'Michal' },
    ];

    const unlinked = accountLinkOptions(undefined, users, 'No linked account');
    expect(unlinked[0]).toEqual({ value: '', label: 'No linked account' });

    const linked = accountLinkOptions(2, users, 'No linked account');
    expect(linked.some((option) => option.value === '')).toBe(false);
    expect(linked.map((option) => option.value)).toEqual(['1', '2']);
  });

  it('projects account detail into PeopleResponse without session, profile, or secret fields', () => {
    const detailWithSecrets = { ...accountDetail, accessToken: 'secret', claims: { oid: 'aad-1' } } as TeamsAccountDetail & { accessToken: string; claims: object };
    const identity = accountIdentityFromDetail(detailWithSecrets);
    const updated = peopleWithAccountDetail({ active: true, people: [person] }, person.aadObjectId, detailWithSecrets);

    expect(identity).toEqual({ linked: true, user: accountDetail.user, linkedAt: accountDetail.linkedAt });
    expect(updated.people[0]?.identity).toEqual(identity);
    expect(JSON.stringify(updated)).not.toContain('secret');
    expect(JSON.stringify(updated)).not.toContain('claims');
    expect(JSON.stringify(updated)).not.toContain('profile');
  });

  it('builds encoded detail paths and minimal bind requests without forwarding secrets', () => {
    const request = bindAccountRequest(42, true);
    expect(accountDetailPath('aad/object')).toBe('/plugins/msteams/people/aad%2Fobject/account');
    expect(request.method).toBe('PATCH');
    expect(JSON.parse(String(request.body))).toEqual({ userId: 42, replace: true });
    expect(JSON.stringify(request)).not.toContain('token');
    expect(JSON.stringify(request)).not.toContain('claims');
  });

  it('keeps role policies in the shared draft but removes their duplicate generic settings fields', () => {
    const detail = {
      name: 'msteams',
      configSchema: [
        { key: 'sec_connection', type: 'section', label: 'Connection' },
        { key: 'appId', type: 'string', label: 'App ID' },
        { key: 'sec_roles', type: 'section', label: 'Role policies' },
        { key: 'rolePolicies', type: 'rolePolicies', label: 'Role policies' },
      ],
      config: { rolePolicies: [policy('*')] },
      secretsSet: [],
    } as unknown as PluginDetail;

    expect(globalSettingsDetail(detail).configSchema.map((field) => field.key)).toEqual(['sec_connection', 'appId']);
    expect(detail.config.rolePolicies).toEqual([policy('*')]);
  });

  it('keeps the people register as a desktop master-detail surface despite host utility order', async () => {
    const { readFile } = await import('node:fs/promises');
    const source = await readFile(`${process.cwd()}/plugins/msteams/web-src/TeamsWorkspace.tsx`, 'utf8');

    expect(source).toContain('lg:!grid-cols-[19rem_minmax(0,1fr)]');
    expect(source).toContain('lg:max-h-[calc(100dvh-15rem)]');
    expect(source).toContain('lg:sticky lg:top-4 lg:self-start');
  });
});
