import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EnvironmentSupervisor } from '../plugins/sites/dist/environment.js';

/** Focused receipt/pendingAction semantics for the scheduled snapshot and restore flow.
 *
 *  The public surfaces promise a stable public snapshot id and return immediately; the durable answer
 *  arrives through the reconcile recovery. These tests pin the contract between the two. */

function fixture(overrides = {}) {
  const site = { id: 'a', projectId: 1, ownerUserId: 2, sourceDir: '/sources/a', runtime: 'environment', environmentDesiredState: 'stopped', slug: 'a', status: 'live', currentReleaseId: null };
  const records = new Map();
  const releases = new Map();
  const calls = [];
  const patches = [];
  let actionRow = null;
  const store = {
    siteById: () => site, runtimeMigration: () => null, conversionSuspends: () => null,
    runtimeRecord: (id, key) => records.get(id + ':' + key) ?? null,
    runtimeRecords: (id, prefix) => [...records].filter(([key]) => key.startsWith(id + ':' + prefix)).map(([key, value]) => ({ key: key.slice(id.length + 1), value })),
    transaction: fn => fn(),
    putRuntimeRecord: (id, key, value) => records.set(id + ':' + key, value),
    claimRuntimeRecord: (id, key, value) => { const k = id + ':' + key; if (records.has(k)) return false; records.set(k, value); return true; },
    compareRuntimeRecord: (id, key, expected, value) => { const k = id + ':' + key; if (records.get(k) !== expected) return false; records.set(k, value); return true; },
    deleteRuntimeRecord: (id, key) => records.delete(id + ':' + key),
    releases: () => [...releases.values()],
    release: (id, releaseId) => releases.get(releaseId) ?? null,
    insertRelease: release => releases.set(release.id, release),
    deleteRelease: (id, releaseId) => releases.delete(releaseId),
    environmentAction: () => actionRow,
    beginEnvironmentAction: (action) => {
      if (actionRow && actionRow.lastError === null) return false;
      actionRow = { ...action };
      return true;
    },
    deleteEnvironmentAction: () => { actionRow = null; },
    updateEnvironmentActionError: (id, error) => { if (actionRow) actionRow.lastError = error; },
    updateSite: (id, patch) => { patches.push(patch); Object.assign(site, patch); },
    allSites: () => [site],
    environmentSitesForReconcile: () => [site],
    ...overrides,
  };
  const control = {
    connectSitesRuntime: authority => { control.authority = authority; },
    discoverSiteEnvironment: async () => { calls.push('discover'); return null; },
    registerSiteEnvironment: async () => { calls.push('register'); return { siteId: 'a', generation: 1, state: 'stopped', desiredState: 'stopped', limits: {}, lastError: null }; },
    requestSiteEnvironment: async input => {
      calls.push(input);
      return { ...input, id: 'op-1', status: 'pending' };
    },
    siteEnvironmentFor: async () => ({ siteId: 'a', generation: 1, state: 'stopped', desiredState: 'stopped', limits: {}, lastError: null }),
    siteEnvironmentOperation: async () => ({ id: 'op-1', status: 'pending' }),
    siteEnvironmentSnapshots: async () => [],
  };
  records.set('a:handover', 'complete');
  records.set('a:binding', JSON.stringify({
    siteId: 'a', projectId: 1, sourcePath: '/sources/a', sitesDataDir: '/sites', brokerDir: '/brokers/a',
    workspaceReadOnly: false, network: 'shared', limits: { cpus: 1, memoryMb: 1024, pidsLimit: 512, diskSoftMb: 4096 },
    initialIntent: { desiredState: 'stopped', pendingAction: null },
  }));
  const environment = new EnvironmentSupervisor({
    control: () => control,
    store,
    access: { accountExists: () => true, isAdmin: () => false, canAccessProject: () => true },
    config: () => ({ environmentCpus: 1, environmentMemoryMb: 1024, environmentPidsLimit: 512, environmentDiskSoftMb: 4096, environmentNetwork: 'shared', releasesKept: 3, startTimeoutSeconds: 1 }),
    dataDir: '/sites', siteDir: id => '/sites/sites/' + id,
    gateway: { prepareRuntimeSocket: async () => ({ path: '/brokers/a/app.sock' }), sealRuntimeSocket: async () => {}, removeRuntimeSocket: async () => {} },
  });
  return { environment, control, calls, records, releases, patches, site, action: () => actionRow, setAction: row => { actionRow = row; } };
}

test('scheduleSnapshot promises a stable public id and the recovery finalizes it without moving the current pointer', async () => {
  const f = fixture();
  const scheduled = await f.environment.scheduleSnapshot(f.site, { includeData: true, note: 'nightly', model: 'test/model' }, 2);
  assert.ok(/^[0-9a-f-]{36}$/.test(scheduled.id), 'the promised id is a stable uuid');

  // The receipt precedes dispatch and already carries the operation id when the call returns.
  const entries = f.records.get('a:snapshot-request:receipt-1');
  const receiptEntry = [...f.records].find(([key]) => key.startsWith('a:snapshot-request:'));
  assert.ok(receiptEntry, 'the receipt is durable');
  const receipt = JSON.parse(receiptEntry[1]);
  assert.equal(receipt.publicId, scheduled.id);
  assert.equal(receipt.operationId, 'op-1');
  assert.ok(receipt.requestedAt);
  assert.equal(f.action()?.snapshotId, scheduled.id, 'the visible action row carries the promised id');
  assert.equal(f.action()?.lastError, null);

  // The dispatch used the receipt's request id, so a lost response replays the same operation.
  const dispatched = f.calls.at(-1);
  assert.equal(dispatched.requestId, receipt.requestId);
  assert.deepEqual(dispatched.action, { kind: 'snapshot', includeData: true, note: 'nightly' });

  f.control.siteEnvironmentOperation = async () => ({ id: 'op-1', status: 'succeeded', snapshotId: 'runtime-id' });
  f.control.siteEnvironmentSnapshots = async () => [{ id: 'runtime-id', generation: 1, createdAt: '2026-09-08T00:00:00Z', consistency: 'crash-consistent', completeProject: false, note: 'nightly' }];
  await f.environment.reconcile();

  const release = f.releases.get(scheduled.id);
  assert.ok(release, 'the release is visible under the promised public id');
  assert.equal(release.model, 'test/model');
  assert.equal(release.kind, 'environment-snapshot');
  assert.equal(f.releases.has('runtime-id'), false, 'the runtime id never appears as a release');
  assert.equal(f.records.get('a:snapshot-display:runtime-id'), scheduled.id);
  assert.equal(f.records.get('a:snapshot-runtime:' + scheduled.id), 'runtime-id');
  assert.equal(f.records.get('a:snapshot-data:' + scheduled.id), 'true');
  assert.equal([...f.records].some(([key]) => key.startsWith('a:snapshot-request:')), false, 'the receipt is finalized');
  assert.equal(f.action(), null, 'the active action row is cleared with its own completion');
  assert.equal(f.site.currentReleaseId, null, 'taking a snapshot preserves the current pointer');
  assert.equal(f.patches.some(patch => 'currentReleaseId' in patch), false);
});

test('a structural dispatch rejection leaves nothing for recovery to re-dispatch', async () => {
  const f = fixture();
  f.control.requestSiteEnvironment = async () => { f.calls.push('dispatch'); throw new Error('refused by the runtime'); };
  await assert.rejects(f.environment.scheduleSnapshot(f.site, { includeData: false, note: '', model: 'm' }, 2), /refused/);
  assert.equal([...f.records].some(([key]) => key.startsWith('a:snapshot-request:')), false);
  assert.equal(f.action(), null, 'the just-claimed visible row is dropped');
  await f.environment.reconcile();
  assert.equal(f.calls.filter(entry => entry === 'dispatch').length, 1, 'recovery does not auto-dispatch a rejected request');
  assert.equal(f.action(), null);
});

test('a completed restore recovery moves the public snapshot pointer exactly once', async () => {
  const f = fixture();
  f.releases.set('promised-id', { id: 'promised-id', siteId: 'a', createdAt: '2026-09-08T00:00:00Z', model: 'm', fileCount: 0, sizeBytes: 0, note: '', kind: 'environment-snapshot' });
  f.setAction({ siteId: 'a', kind: 'rollback', snapshotId: 'promised-id', restoreData: true, requestedAt: '2026-09-08T01:00:00Z', lastError: null });
  f.records.set('a:restore-request:r1', JSON.stringify({
    requestId: 'r1', accountUserId: 2, kind: 'restore', publicId: 'promised-id', requestedAt: '2026-09-08T01:00:00Z',
    operationId: 'op-r', input: { includeData: true, note: '', model: '', restoreData: true },
  }));
  f.control.siteEnvironmentOperation = async () => ({ id: 'op-r', status: 'succeeded' });
  f.control.siteEnvironmentSnapshots = async () => [{ id: 'promised-id', generation: 1, createdAt: '2026-09-08T00:00:00Z', consistency: 'crash-consistent', completeProject: false, note: '' }];
  await f.environment.reconcile();
  assert.equal(f.site.currentReleaseId, 'promised-id');
  assert.equal(f.patches.filter(patch => patch.currentReleaseId === 'promised-id').length, 1, 'the pointer moves exactly once');
  assert.equal([...f.records].some(([key]) => key.startsWith('a:restore-request:')), false);
  assert.equal(f.action(), null);
});

test('pendingAction projects the live operation status read-only and never wipes an active operation', async () => {
  const f = fixture();
  f.setAction({ siteId: 'a', kind: 'snapshot', snapshotId: 'promised-id', includeData: true, note: '', model: 'm', requestedAt: '2026-09-08T01:00:00Z', lastError: null });
  f.records.set('a:snapshot-request:q1', JSON.stringify({
    requestId: 'q1', accountUserId: 2, kind: 'snapshot', publicId: 'promised-id', requestedAt: '2026-09-08T01:00:00Z',
    operationId: 'op-1', input: { includeData: true, note: '', model: 'm' },
  }));
  f.control.siteEnvironmentOperation = async () => ({ id: 'op-1', status: 'failed', error: 'snapshot store denied' });

  const projected = await f.environment.pendingAction(f.site, 2);
  assert.equal(projected?.lastError, 'snapshot store denied', 'a failed operation is visible through the projection');
  assert.equal(f.action()?.lastError, null, 'the projection wrote nothing');
  assert.deepEqual(f.calls.filter(entry => typeof entry === 'object' && entry.action), [], 'the projection never dispatches');

  f.control.siteEnvironmentOperation = async () => ({ id: 'op-1', status: 'succeeded', snapshotId: 'runtime-id' });
  const running = await f.environment.pendingAction(f.site, 2);
  assert.equal(running?.lastError, null, 'a succeeded operation stays visible until its own recovery finalizes it');
  assert.equal(f.action()?.snapshotId, 'promised-id', 'the active operation is not wiped by a read');
});

test('a second snapshot is refused while an action is active', async () => {
  const f = fixture();
  await f.environment.scheduleSnapshot(f.site, { includeData: true, note: '', model: 'm' }, 2);
  await assert.rejects(f.environment.scheduleSnapshot(f.site, { includeData: true, note: '', model: 'm' }, 2), /another environment action/);
});