// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { PluginContext } from 'elowen/plugin-api';
import { publishBranch } from '../plugins/github/src/execution.js';
import { errorBody } from '../plugins/github/src/errors.js';

// Reading a managed project's remotes runs in its environment, so an access decision made there reaches
// the panel as a foreign error. Answered as `github_unavailable` it accused GitHub of an outage for a
// project the account simply may not touch.
describe('managed environment refusals in the panel contract', () => {
  it.each(['project_forbidden', 'account_forbidden'])('reports a %s refusal as project_forbidden', code => {
    expect(errorBody(Object.assign(new Error('Project access is denied'), { code, status: 403 })))
      .toEqual({ status: 403, body: { error: 'project_forbidden', message: 'This project is not accessible.' } });
  });
  it('still reports an unrecognized failure as an upstream outage', () => {
    expect(errorBody(Object.assign(new Error('socket hang up'), { status: 403 })).status).toBe(502);
    expect(errorBody(new Error('socket hang up')).body).toMatchObject({ error: 'github_unavailable' });
  });
});

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
