import { describe, expect, it } from 'vitest';
import { directPolicyIndex, matchesPerson } from '../plugins/msteams/web-src/TeamsWorkspace';
import type { RolePolicy, TeamsPerson } from '../plugins/msteams/web-src/runtime';

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

  it('treats a person policy below a wildcard as shadowed', () => {
    expect(directPolicyIndex([policy('aad-1'), policy('*')], person)).toBe(0);
    expect(directPolicyIndex([policy('*'), policy('aad-1')], person)).toBe(-1);
  });
});
