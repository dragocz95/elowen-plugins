// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { PluginContext } from 'elowen/plugin-api';
import { publishBranch } from '../plugins/github/src/execution.js';

describe('managed personal publishing boundary', () => {
  it.each([false, true])('never creates a broker in a shared guest HOME, admin=%s', async admin => {
    const control = vi.fn(() => { throw new Error('must refuse before a launch'); });
    const ctx = { currentAccess: () => ({ admin, projectRef: { kind: 'managed', projectId: 7 } }), control } as unknown as PluginContext;
    await expect(publishBranch({ ctx, cwd: '/workspace', branch: 'elowen/u1/topic', token: 'personal-secret', repository: { owner: 'owner', name: 'repo' } })).rejects.toMatchObject({ code: 'managed_publish_unavailable' });
    expect(control).not.toHaveBeenCalled();
  });
});
