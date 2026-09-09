// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import type { PluginContext, PluginApiRequest, PluginApiRoute } from 'elowen/dist/plugins/api.js';
import { registerEditorApi } from '../plugins/editor/src/api.js';

function fixture(admin = false, allowed = [7], provider: unknown = null) {
  const routes: PluginApiRoute[] = [];
  const safe = vi.fn(() => { throw new Error('host filesystem must not be used'); });
  const ctx = {
    host: { projectFiles: () => ({ safe }), stores: () => ({ projects: { get: () => ({ id: 7, path: '/host-secret', executionKind: 'managed' }) } }) },
    control: vi.fn(() => provider), registerApiRoute: (route: PluginApiRoute) => routes.push(route),
  } as unknown as PluginContext;
  registerEditorApi(ctx);
  const call = (mount: string, method = 'GET', query = { path: 'src/a.ts' }, input: unknown = undefined) => {
    const route = routes.find(r => r.rootMount === `/projects/:id/${mount}` && r.method === method)!;
    return route.handler({ path: '', params: { id: '7' }, query, headers: {}, auth: { admin, accessibleProjects: allowed, userId: 11 }, json: async () => input } as unknown as PluginApiRequest);
  };
  return { call, safe, ctx };
}

describe('managed editor routing', () => {
  it.each([false, true])('refuses an absent provider before host access, admin=%s', async admin => {
    const f = fixture(admin);
    expect((await f.call('file')).status).toBe(503);
    expect(f.safe).not.toHaveBeenCalled();
  });
  it('refuses a different project before resolving its provider', async () => {
    const f = fixture(false, [8]);
    expect((await f.call('file')).status).toBe(403);
    expect(f.ctx.control).not.toHaveBeenCalled();
  });
  it('reads guest bytes with the explicit actor and project reference', async () => {
    const projectFiles = vi.fn(async () => ({ kind: 'read', base64: Buffer.from('guest data').toString('base64'), totalBytes: 10, version: 'v1' }));
    const f = fixture(false, [7], { projectFiles });
    expect((await f.call('file')).body).toEqual({ content: 'guest data', truncated: false, version: 'v1' });
    expect(projectFiles).toHaveBeenCalledWith({ project: { kind: 'managed', projectId: 7 }, accountUserId: 11, operation: { kind: 'read', path: '/workspace/src/a.ts', offset: 0, length: 262144, maxBytes: 262144 } });
    expect(f.safe).not.toHaveBeenCalled();
  });
  it('rejects traversal without asking the guest or host', async () => {
    const projectFiles = vi.fn();
    const f = fixture(false, [7], { projectFiles });
    expect((await f.call('file', 'GET', { path: '../other-project' })).status).toBe(400);
    expect(projectFiles).not.toHaveBeenCalled();
    expect(f.safe).not.toHaveBeenCalled();
  });
  it('passes an explicit content version to the guest mutation', async () => {
    const projectFiles = vi.fn(async () => ({ kind: 'write', entry: { version: 'v2' } }));
    const f = fixture(false, [7], { projectFiles });
    expect((await f.call('file', 'PUT', { path: '' }, { path: 'src/a.ts', content: 'next', version: 'v1' })).body).toEqual({ ok: true, version: 'v2' });
    expect(projectFiles.mock.calls[0]).toEqual([{ project: { kind: 'managed', projectId: 7 }, accountUserId: 11, operation: { kind: 'write', path: '/workspace/src/a.ts', base64: Buffer.from('next').toString('base64'), expectedVersion: 'v1' } }]);
  });
  it('does not mask a provider refusal or use the host', async () => {
    const f = fixture(true, [7], { projectFiles: async () => { throw new Error('membership revoked'); } });
    expect((await f.call('file')).status).toBe(503);
    expect(f.safe).not.toHaveBeenCalled();
  });
  // An access decision is not an outage. Reported as 503 it read as "the environment is broken", which is
  // what hid a provider-side authorization bug behind a week of environment debugging.
  it.each(['project_forbidden', 'account_forbidden'])('answers a %s refusal as 403 with its own message', async code => {
    const f = fixture(true, [7], { projectFiles: async () => { throw Object.assign(new Error('Project access is denied'), { code, status: 403 }); } });
    expect(await f.call('file')).toMatchObject({ status: 403, body: { error: 'Project access is denied' } });
    expect(f.safe).not.toHaveBeenCalled();
  });
  it('still hides a refusal that only claims a status, without a known code', async () => {
    const f = fixture(true, [7], { projectFiles: async () => { throw Object.assign(new Error('/var/lib/containers/storage is full'), { status: 403 }); } });
    expect(await f.call('file')).toEqual({ status: 503, body: { error: 'project environment operation failed' } });
  });
});
