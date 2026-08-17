import { describe, expect, it } from 'vitest';
import { accountOptionsFor, directPolicyIndex, effectivePersonPolicy, globalSettingsDetail, linkedUserFor, matchesPerson, upsertDirectPolicy } from '../plugins/msteams/web-src/TeamsWorkspace';
import type { PluginDetail, RolePolicy, TeamsPerson, User } from '../plugins/msteams/web-src/runtime';

const person: TeamsPerson = {
  key: 'aad-1',
  name: 'Alex Rivera',
  upn: 'Alex@Example.com',
  aadObjectId: 'aad-1',
  teamsId: '29:encrypted',
  hasPersonalChat: true,
  lastSeenAt: 123,
};
const policy = (roleId: string): RolePolicy => ({ roleId, name: 'Alex', projectIds: [] });

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
    const existing = { ...policy('aad-1'), elowenUser: 'filip', admin: true, projectIds: [1], tools: ['RaynetSearch'], prompt: 'Private context' };
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

  it('resolves the linked Elowen account for avatar fallback by username or numeric id', () => {
    const users: User[] = [
      { id: 1, username: 'filip', name: 'Filip', avatar: '1.png' },
      { id: 2, username: 'michal', name: 'Michal' },
    ];
    expect(linkedUserFor([{ ...policy('aad-1'), elowenUser: 'FILIP' }], person, users)).toBe(users[0]);
    expect(linkedUserFor([{ ...policy('aad-1'), elowenUser: '2' }], person, users)).toBe(users[1]);
    expect(linkedUserFor([policy('*')], person, users)).toBeUndefined();
  });

  it('keeps the selected numeric account reference attached to its avatar option', () => {
    const users: User[] = [
      { id: 1, username: 'filip', name: 'Filip', avatar: '1.png' },
      { id: 2, username: 'michal', name: 'Michal', avatar: '2.png' },
    ];
    const options = accountOptionsFor({ ...policy('aad-1'), elowenUser: '2' }, users, 'No account');
    expect(options).toMatchObject([
      { value: '', label: 'No account' },
      { value: 'filip', user: users[0] },
      { value: '2', label: 'Michal · @michal', user: users[1] },
    ]);
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
});
