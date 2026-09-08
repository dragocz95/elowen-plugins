// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { PluginContext } from 'elowen/plugin-api';
import { publishBranch } from '../plugins/github/src/execution.js';

describe('managed personal publishing boundary', () => {
  it('refuses an explicit target that differs from the selected project, including for an admin', async () => {
    const control = vi.fn();
    const ctx = { currentAccess: () => ({ admin: true, projectRef: { kind: 'managed', projectId: 7 } }), control } as unknown as PluginContext;
    await expect(publishBranch({ ctx, projectRef: { kind: 'managed', projectId: 8 }, expectedHead: 'a'.repeat(40), cwd: '/workspace', branch: 'main', token: 'fake-token', repository: { owner: 'owner', name: 'repo' } })).rejects.toMatchObject({ code: 'project_forbidden' });
    expect(control).not.toHaveBeenCalled();
  });
  it.each([false, true])('requires an approved commit before any managed execution, admin=%s', async admin => {
    const control = vi.fn(() => { throw new Error('must refuse before a launch'); });
    const ctx = { currentAccess: () => ({ admin, projectRef: { kind: 'managed', projectId: 7 } }), control } as unknown as PluginContext;
    await expect(publishBranch({ ctx, cwd: '/workspace', branch: 'elowen/u1/topic', token: 'personal-secret', repository: { owner: 'owner', name: 'repo' } })).rejects.toMatchObject({ code: 'publish_scope_invalid' });
    expect(control).not.toHaveBeenCalled();
  });
});
