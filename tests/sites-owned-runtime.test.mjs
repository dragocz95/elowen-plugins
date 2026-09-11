import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EnvironmentSupervisor } from '../plugins/sites/dist/environment.js';

function fixture(overrides = {}) {
  const site = { id: 'a', projectId: 1, ownerUserId: 2, sourceDir: '/sources/a', runtime: 'environment', environmentDesiredState: 'stopped', slug: 'a', status: 'live' };
  const records = new Map();
  const calls = [];
  const control = {
    connectSitesRuntime: authority => { control.authority = authority; },
    registerSiteEnvironment: async () => { calls.push('register'); return { siteId: 'a', generation: 1, state: 'stopped', desiredState: 'stopped', limits: {}, lastError: null }; },
    requestSiteEnvironment: async input => { calls.push(input); return { ...input, id: 'op', status: 'succeeded' }; },
    siteEnvironmentFor: async () => ({ siteId: 'a', generation: 1, state: 'stopped', desiredState: 'stopped', limits: {}, lastError: null }),
    siteEnvironmentSnapshots: async () => [],
  };
  let available = true;
  const environment = new EnvironmentSupervisor({
    control: () => available ? control : undefined,
    store: {
      siteById: () => site, runtimeMigration: () => null, conversionSuspends: () => null,
      runtimeRecord: (id, key) => records.get(id + ':' + key) ?? null,
      runtimeRecords: (id, prefix) => [...records].filter(([key]) => key.startsWith(id + ':' + prefix)).map(([key, value]) => ({ key: key.slice(id.length + 1), value })),
      transaction: fn => fn(),
      putRuntimeRecord: (id, key, value) => records.set(id + ':' + key, value),
      claimRuntimeRecord: (id, key, value) => { const k = id + ':' + key; if (records.has(k)) return false; records.set(k, value); return true; },
      compareRuntimeRecord: (id, key, expected, value) => { const k = id + ':' + key; if (records.get(k) !== expected) return false; records.set(k, value); return true; },
      deleteRuntimeRecord: (id, key) => records.delete(id + ':' + key),
      releases: () => [], environmentAction: () => null, allSites: () => [site],
      environmentSitesForReconcile: () => [site], updateSite: (id, patch) => Object.assign(site, patch),
      ...overrides.store,
    },
    access: { accountExists: () => true, isAdmin: () => false, canAccessProject: () => true },
    config: () => ({ environmentCpus: 1, environmentMemoryMb: 1024, environmentPidsLimit: 512, environmentNetwork: 'shared', releasesKept: 3, startTimeoutSeconds: 1 }),
    dataDir: '/sites', siteDir: id => '/sites/sites/' + id,
    gateway: { prepareRuntimeSocket: async () => ({ path: '/var/lib/elowen/site-runtime-sockets/a/app.sock' }), sealRuntimeSocket: async () => {}, removeRuntimeSocket: async () => {} },
  });
  return { environment, control, calls, records, site, disable: () => { available = false; } };
}

test('a new environment provisions its fixed image before requesting its first start', async () => {
  const f = fixture();
  f.site.environmentDesiredState = 'running';
  f.control.registerSiteEnvironment = async () => {
    const binding = await f.control.authority.resolve({ siteId: 'a', accountUserId: 2, access: 'manage' });
    assert.equal(binding.initialIntent.desiredState, 'stopped');
    return { generation: 1 };
  };
  await f.environment.state(f.site);
  assert.deepEqual(f.calls.map(call => call.action.kind), ['provision-image', 'start']);
  assert.equal(f.calls[0].action.imageKind, 'base');
  assert.equal(f.records.get('a:bootstrap-intent'), 'complete');
});

test('missing runtime refuses managed operations and never uses a local driver', async () => {
  const f = fixture();
  f.disable();
  await assert.rejects(f.environment.state(f.site), /unavailable/);
  assert.deepEqual(f.calls, []);
});

test('control requests carry the actor, generation and idempotency key', async () => {
  const f = fixture();
  await f.environment.request(f.site, { kind: 'stop' }, 2, 'intent-1');
  const request = f.calls.at(-1);
  assert.equal(request.accountUserId, 2);
  assert.equal(request.expectedGeneration, 1);
  assert.equal(request.requestId, 'intent-1');
  assert.deepEqual(request.action, { kind: 'stop' });
});

test('a lost registration response leaves the handover incomplete and is retried', async () => {
  const f = fixture();
  f.control.registerSiteEnvironment = async () => { throw new Error('lost response'); };
  await assert.rejects(f.environment.state(f.site), /lost response/);
  assert.notEqual(f.records.get('a:handover'), 'complete');
  f.control.registerSiteEnvironment = async () => ({ state: 'stopped' });
  await f.environment.state(f.site);
  assert.equal(f.records.get('a:handover'), 'complete');
});

test('a queued snapshot retains its public ID and translates restoration to the runtime ID', async () => {
  let pending = { kind: 'snapshot', snapshotId: 'promised-id', includeData: true, note: 'before restart', model: 'test/model', lastError: null };
  const releases = new Map();
  const f = fixture({ store: {
    environmentAction: () => pending,
    deleteEnvironmentAction: () => { pending = null; },
    release: (siteId, id) => releases.get(id),
    insertRelease: release => releases.set(release.id, release),
  } });
  f.control.requestSiteEnvironment = async input => { f.calls.push(input); return { ...input, id: 'operation', status: 'succeeded', snapshotId: 'runtime-id' }; };
  f.control.siteEnvironmentSnapshots = async () => [{ id: 'runtime-id', generation: 1, createdAt: '2026-09-08T00:00:00Z', consistency: 'crash-consistent', completeProject: false, note: 'before restart' }];
  await f.environment.state(f.site);
  assert.equal(pending, null);
  assert.equal(releases.get('promised-id').model, 'test/model');
  assert.equal(releases.has('runtime-id'), false);
  await f.environment.request(f.site, { kind: 'restore', snapshotId: 'promised-id', restoreData: true }, 2);
  assert.equal(f.calls.at(-1).action.snapshotId, 'runtime-id');
  assert.equal(f.calls.at(-1).action.restoreData, true);
});

test('an interrupted snapshot wait recovers model and data metadata and reconciles retention', async () => {
  const releases = new Map([['expired', { id: 'expired', siteId: 'a', kind: 'environment-snapshot' }], ['files', { id: 'files', siteId: 'a', kind: 'files' }]]);
  const f = fixture({ store: {
    releases: () => [...releases.values()],
    release: (siteId, id) => releases.get(id),
    insertRelease: release => releases.set(release.id, release),
    deleteRelease: (siteId, id) => releases.delete(id),
  } });
  await f.environment.state(f.site);
  f.records.set('a:snapshot-request:request-1', JSON.stringify({ requestId: 'request-1', accountUserId: 2, operationId: 'operation-1', input: { includeData: true, model: 'original/model', note: 'original note' } }));
  f.control.siteEnvironmentOperation = async () => ({ id: 'operation-1', status: 'succeeded', snapshotId: 'retained' });
  f.control.siteEnvironmentSnapshots = async () => [{ id: 'retained', createdAt: '2026-09-08T00:00:00Z', note: 'original note', consistency: 'crash-consistent', completeProject: false }];
  await f.environment.reconcile();
  assert.equal(releases.get('retained').model, 'original/model');
  assert.equal(f.records.get('a:snapshot-data:retained'), 'true');
  assert.equal(f.records.has('a:snapshot-request:request-1'), false);
  assert.equal(releases.has('expired'), false);
  assert.equal(releases.has('files'), true);
});

test('project deletion dependencies include published Sites independently of runtime state', async () => {
  const f = fixture();
  f.site.runtime = 'static';
  f.environment.connect();
  assert.deepEqual(await f.control.authority.projectDependents(1), [{ siteId: 'a' }]);
  assert.deepEqual(await f.control.authority.projectDependents(99), []);
});

test('publication exports guest paths through retained typed artifacts, never host file reads', async () => {
  const f = fixture();
  f.site.runtime = 'static';
  f.site.sourceDir = '/workspace/sites/a';
  await f.environment.exportProject(f.site, { kind: 'managed', projectId: 1 }, '/workspace/sites/a/dist', '/sites/sites/a/exports/release-1', 2);
  const request = f.calls.at(-1);
  assert.equal(request.action.kind, 'export-project');
  const binding = await f.control.authority.resolve({ siteId: 'a', accountUserId: 2, access: 'manage' });
  assert.equal(binding.sourcePath, '/sites/sites/a/exports/release-1');
  assert.equal(binding.initialIntent.desiredState, 'stopped');
  const artifact = await f.control.authority.resolveArtifact({ siteId: 'a', accountUserId: 2, artifactId: request.action.artifactId, action: 'export-project' });
  assert.deepEqual(artifact, { kind: 'project-source', project: { kind: 'managed', projectId: 1 }, guestPath: '/workspace/sites/a/dist', destinationPath: '/sites/sites/a/exports/release-1' });
  assert.equal(await f.control.authority.resolveArtifact({ siteId: 'a', accountUserId: 2, artifactId: request.action.artifactId, action: 'remove-artifact' }), null);

  await f.environment.exportProject(f.site, { kind: 'managed', projectId: 1 }, '/workspace/sites/a/dist', '/sites/sites/a/exports/release-2', 2);
  const secondRequest = f.calls.at(-1);
  assert.equal(secondRequest.action.kind, 'export-project');
  assert.notEqual(secondRequest.requestId, request.requestId, 'a second SitePublish export gets a fresh durable request id');
  assert.notEqual(f.calls.at(-2).requestId, request.requestId, 'retiring the previous publication stage gets a fresh request id');

  await assert.rejects(f.environment.exportProject(f.site, { kind: 'managed', projectId: 1 }, '/workspace', '/etc/release', 2), /outside/);
});
