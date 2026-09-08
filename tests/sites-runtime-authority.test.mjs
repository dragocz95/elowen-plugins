import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSiteRuntimeAuthority } from '../plugins/sites/src/siteRuntimeAuthority.ts';

function fixture() {
  const site = { id: 'site-a', projectId: 7, ownerUserId: 1, runtime: 'environment', sourceDir: '/sources/site-a', status: 'live' };
  const binding = { siteId: site.id, projectId: 7, sourcePath: site.sourceDir, image: 'base', sitesDataDir: '/sites', brokerDir: '/broker/site-a', workspaceReadOnly: false, network: 'shared', limits: { cpus: 1, memoryMb: 1024, pidsLimit: 512, diskSoftMb: 10240 }, legacy: { containerId: 'container-id', imageId: 'image-id', volumeMountpoint: '/volume' } };
  const accounts = new Set([1, 2, 3]);
  const admins = new Set([3]);
  const members = new Set([1, 2]);
  const calls = [];
  let gateway = { prepareRuntimeSocket: async () => { calls.push('prepare'); return { path: '/broker/site-a/app.sock' }; }, removeRuntimeSocket: async () => { calls.push('remove'); } };
  const authority = createSiteRuntimeAuthority({
    store: { siteById: id => id === site.id ? site : undefined, conversionSuspends: () => null },
    access: { accountExists: id => accounts.has(id), isAdmin: id => admins.has(id), canAccessProject: id => members.has(id) },
    registration: id => id === site.id ? binding : null,
    gateway: () => gateway,
  });
  return { site, binding, accounts, admins, members, calls, authority, setGateway: value => { gateway = value; } };
}

test('runtime access is owner or current administrator, not public viewing or project membership', async () => {
  const f = fixture();
  f.site.visibility = 'public';
  for (const access of ['read', 'manage']) {
    assert.deepEqual(await f.authority.resolve({ siteId: f.site.id, accountUserId: 1, access }), f.binding);
    assert.equal(await f.authority.resolve({ siteId: f.site.id, accountUserId: 2, access }), null);
    assert.deepEqual(await f.authority.resolve({ siteId: f.site.id, accountUserId: 3, access }), f.binding);
  }
  f.members.delete(1);
  assert.equal(await f.authority.resolve({ siteId: f.site.id, accountUserId: 1, access: 'manage' }), null);
  f.accounts.delete(3);
  assert.equal(await f.authority.resolve({ siteId: f.site.id, accountUserId: 3, access: 'read' }), null);
});

test('registration is fresh and must bind the exact Sites resource and source', async () => {
  const f = fixture();
  f.binding.projectId = 8;
  await assert.rejects(f.authority.resolve({ siteId: f.site.id, accountUserId: 1, access: 'read' }), /binding/);
  f.binding.projectId = 7;
  f.site.sourceDir = '/sources/replaced';
  await assert.rejects(f.authority.resolve({ siteId: f.site.id, accountUserId: 1, access: 'read' }), /binding/);
});

test('static Sites do not require a runtime provider or receive runtime registration', async () => {
  const f = fixture();
  f.site.runtime = 'static';
  f.setGateway(undefined);
  assert.equal(await f.authority.resolve({ siteId: f.site.id, accountUserId: 1, access: 'read' }), null);
});

test('start refuses deleted resources and missing gateway without local fallback', async () => {
  const f = fixture();
  f.site.status = 'deleting';
  await assert.rejects(f.authority.beforeStart(f.site.id), /deleting/);
  assert.deepEqual(f.calls, []);
  f.site.status = 'live';
  f.setGateway(undefined);
  await assert.rejects(f.authority.beforeStart(f.site.id), /unavailable/);
});

test('broker preparation must return the pinned socket and stop removes only its broker', async () => {
  const f = fixture();
  await f.authority.beforeStart(f.site.id);
  await f.authority.afterStop(f.site.id);
  assert.deepEqual(f.calls, ['prepare', 'remove']);
  f.setGateway({ prepareRuntimeSocket: async () => ({ path: '/broker/other/app.sock' }), removeRuntimeSocket: async () => {} });
  await assert.rejects(f.authority.beforeStart(f.site.id), /socket/);
});
