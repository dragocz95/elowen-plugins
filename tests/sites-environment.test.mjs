// Environment lifecycle tests for the Sites plugin, converted to the CURRENT architecture: the concrete
// container driver and every lower lifecycle mutation belong to the Sandbox provider, reached through the
// typed SiteEnvironmentControl SDK seam (SITE_ENVIRONMENT_CONTROL_METHODS). These tests assert the
// Sites-owned behaviours — durable receipts and the visible pending-action slot, the SDK request contract
// (actor, generation, idempotency key, action kinds), readiness adoption over the ingress socket, and the
// authority handover — using a real EnvironmentSupervisor over a fake EXACT SDK, never a local Podman
// client, a shallow environment stand-in or a copied provider loop. Driver-level invariants that moved
// with the provider are preserved at that boundary in tests/sites-environment-driver.test.mjs; runtime
// orchestration invariants (stop ordering, snapshot pause/commit/export sequencing, retention pruning,
// fleet sweeps) belong to the Sandbox suite and are listed in the migration report.
//
// Until the coordinator rebuilds plugins/sites/dist, this file runs against plugins/sites/src through the
// resolve hook in tests/helpers/sitesOwnedEnvironmentSdk.mjs, so it tracks the in-flight source directly.

import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BASE_IMAGE_SOURCE, BASE_IMAGE_TAG, CONTAINERFILE, INGRESS_SERVICE, INGRESS_SOCKET } from '../plugins/sites/dist/baseImage.js';
import { resolveConfig } from '../plugins/sites/dist/config.js';
import { SitesStore } from '../plugins/sites/dist/store.js';
import { createSiteHandler } from '../plugins/sites/dist/serve.js';
import { proxyToEnvironment } from '../plugins/sites/dist/proxy.js';
import { registerTools } from '../plugins/sites/dist/tools.js';
import { createApiHandlers } from '../plugins/sites/dist/api.js';
import { EnvironmentProvisioningService } from '../plugins/sites/dist/provisioning.js';
import {
  SITE_ID, environmentSite, modeOf, snapshotRelease, sitesSdkHarness,
} from './helpers/sitesOwnedEnvironmentSdk.mjs';

const makeDb = ({ beforeStep } = {}) => {
  const db = new Database(':memory:');
  let version = 0;
  const handle = { exec: (sql) => db.exec(sql), prepare: (sql) => db.prepare(sql) };
  return {
    ...handle,
    migrate: (steps) => {
      for (const step of steps) {
        if (step.version <= version) continue;
        beforeStep?.(step.version, handle);
        step.up(handle);
        version = step.version;
      }
    },
    appliedVersion: () => version,
    transaction: (fn) => db.transaction(fn)(),
  };
};

const iso = () => new Date().toISOString();
const requestKinds = (control) => control.requests.map((request) => request.action.kind);
const snapshotRequests = (control) => control.requests.filter((request) => request.action.kind === 'snapshot');
const restoreRequests = (control) => control.requests.filter((request) => request.action.kind === 'restore');

// --- Supervisor over the fake EXACT SDK ----------------------------------------------------------

test('environment start performs the typed SDK sequence, prepares the ingress and never issues a restart', async (t) => {
  const { supervisor, control, gateway, site, socketPath, root } = await sitesSdkHarness(t, { bootstrapped: false });
  await supervisor.start(site);

  assert.deepEqual(requestKinds(control), ['provision-image', 'start']);
  assert.equal(control.requests.some((request) => request.action.kind === 'restart'), false);
  assert.match(control.requests[0].requestId, new RegExp(`^sites-bootstrap-image:${SITE_ID}:1$`));
  assert.match(control.requests[1].requestId, new RegExp(`^sites-bootstrap-start:${SITE_ID}:1$`));
  for (const request of control.requests) {
    assert.equal(request.accountUserId, 7);
    assert.equal(request.expectedGeneration, 1);
  }
  // The broker-aware ingress sequence is prepared (handover callback + start callback) and sealed by
  // readiness; nothing removes it on a healthy start.
  assert.deepEqual(gateway.ops.map(([name]) => name), ['prepare', 'prepare', 'seal']);
  assert.deepEqual(supervisor.endpointFor(SITE_ID), { kind: 'socket', path: socketPath });
  assert.equal(site.status, 'live');
  assert.equal(site.lastError, null);
  // The trusted handover callback wrote the environment contract for the container — at the root Sandbox
  // actually binds from, which is `<sitesDataDir>/<id>/environment` and NOT the source/release siteDir.
  const environment = join(root, 'data', SITE_ID, 'environment');
  assert.match(readFileSync(join(environment, 'container.env'), 'utf8'), /ELOWEN_SITE_SLUG=environment-demo/);
  assert.equal(existsSync(join(environment, 'git-stub')), true);
  // …and nowhere under the source root. This is the production failure verbatim: the files existed, one
  // level too deep, while the container create kept failing lstat on the git-stub bind source.
  assert.equal(existsSync(join(root, 'data', 'sites', SITE_ID, 'environment')), false,
    'the container contract must not be written under the source/release siteDir');
});

test('a structural provider failure is surfaced once and never retried by the caller', async (t) => {
  let failures = 0;
  const { supervisor, control, site } = await sitesSdkHarness(t, {
  });
  await supervisor.state(site);
  control.requestSiteEnvironment = async (input) => {
    control.requests.push(input);
    failures += 1;
    throw new Error('podman update failed: permission denied');
  };
  await assert.rejects(() => supervisor.start(site), /permission denied/);
  assert.equal(failures, 1, 'exactly one dispatch, no caller-side retry loop');
});

test('stop requests the typed stop and drops the routing endpoint', async (t) => {
  const { supervisor, control, gateway, site } = await sitesSdkHarness(t, {
  });
  await supervisor.start(site);
  await supervisor.stop(SITE_ID);

  assert.deepEqual(requestKinds(control), ['start', 'stop']);
  assert.equal(supervisor.endpointFor(SITE_ID), null);
  // The provider stops first; Sites' own afterStop hook only then takes the broker away.
  assert.equal(gateway.ops.some(([name]) => name === 'remove'), true);
});

test('healthy running environment is adopted and clears a stale failure without lifecycle changes', async (t) => {
  const { supervisor, control, gateway, store, site, socketPath, brokerDir } = await sitesSdkHarness(t, { controlState: 'running' });
  store.putRuntimeRecord(SITE_ID, 'handover', 'complete');
  site.status = 'failed';
  site.lastError = 'stale action error';
  mkdirSync(brokerDir, { recursive: true });
  const server = createServer();
  await new Promise((resolve) => server.listen(socketPath, resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); });
  chmodSync(brokerDir, 0o510);

  await supervisor.start(site);
  assert.deepEqual(control.requests, [], 'a healthy environment is adopted, not restarted');
  assert.deepEqual(gateway.ops, [], 'an already sealed broker is left alone');
  assert.deepEqual(supervisor.endpointFor(SITE_ID), { kind: 'socket', path: socketPath });
  assert.equal(site.status, 'live');
  assert.equal(site.lastError, null);
});

test('service detach drops routing without any lifecycle request', async (t) => {
  const { supervisor, control, site } = await sitesSdkHarness(t, {
  });
  await supervisor.start(site);
  assert.notEqual(supervisor.endpointFor(SITE_ID), null);

  await supervisor.detach();
  assert.equal(supervisor.endpointFor(SITE_ID), null);
  assert.equal(supervisor.isRunning(SITE_ID), false);
  assert.deepEqual(requestKinds(control).filter((kind) => kind === 'stop' || kind === 'kill'), [], 'detach never stops anything');
});

test('environment limit overrides persist only after the provider accepts the change', async (t) => {
  const { supervisor, control, site } = await sitesSdkHarness(t, {
  });
  await supervisor.state(site);
  control.requestSiteEnvironment = async (input) => {
    control.requests.push(input);
    return { id: 'op-limits', requestId: input.requestId, siteId: input.siteId, accountUserId: input.accountUserId,
      generation: input.generation, action: input.action, status: 'failed', error: 'podman update denied' };
  };
  await assert.rejects(() => supervisor.applyLimits(site, {
    environmentCpus: 2, environmentMemoryMb: 2048, environmentPidsLimit: 700,
  }), /update denied/);
  assert.equal(site.environmentMemoryMb, null, 'nothing persisted on provider failure');
  assert.deepEqual(control.requests[0].action, { kind: 'limits', limits: { cpus: 2, memoryMb: 2048, pidsLimit: 700 } });
});

test('environment limit overrides persist while stopped and the binding carries them on the next start', async (t) => {
  const { supervisor, control, site } = await sitesSdkHarness(t, {
  });
  await supervisor.applyLimits(site, {
    environmentCpus: 2, environmentMemoryMb: 2048, environmentPidsLimit: 700,
  });
  assert.equal(site.environmentMemoryMb, 2048);
  assert.deepEqual(requestKinds(control), ['limits']);

  await supervisor.start(site);
  assert.deepEqual(requestKinds(control), ['limits', 'start'], 'the provider applies binding limits on start; no second limits call');
  const binding = await control.authority.resolve({ siteId: SITE_ID, accountUserId: 7, access: 'read' });
  assert.deepEqual(binding.limits, { cpus: 2, memoryMb: 2048, pidsLimit: 700 });
});

test('environment exec forwards the command through the typed seam with a bounded timeout', async (t) => {
  const { supervisor, control, site } = await sitesSdkHarness(t, {
  });
  const result = await supervisor.exec(site, 'echo ok', { timeoutSeconds: 120, workdir: '/workspace' });
  assert.equal(result.stdout, 'exec-ok');
  assert.deepEqual(control.execCalls[0], {
    siteId: SITE_ID, accountUserId: 7, command: 'echo ok', timeoutMs: 120_000, workdir: '/workspace',
  });
});

test('an active execution lease excludes a concurrent snapshot schedule and leaves nothing behind', async (t) => {
  const { supervisor, control, store, site } = await sitesSdkHarness(t, {
  });
  await supervisor.state(site);
  assert.equal(store.tryBeginEnvironmentExec(SITE_ID, 'exec-token', Date.now() + 60_000), true);
  await assert.rejects(
    () => supervisor.scheduleSnapshot(site, { includeData: true, note: 'n', model: 'm' }),
    /another environment action or execution is in progress/,
  );
  assert.deepEqual(snapshotRequests(control), [], 'nothing was dispatched under the lease');
  assert.equal(store.environmentAction(SITE_ID), null);
  assert.deepEqual(store.runtimeRecords(SITE_ID, 'snapshot-request:'), [], 'the receipt was dropped clean');

  store.endEnvironmentExec(SITE_ID, 'exec-token');
  const scheduled = await supervisor.scheduleSnapshot(site, { includeData: true, note: 'n', model: 'm' });
  assert.equal(store.environmentAction(SITE_ID).snapshotId, scheduled.id);
});

test('environment logs are requested with a bounded line count', async (t) => {
  const { supervisor, control, site } = await sitesSdkHarness(t, {
  });
  const logs = await supervisor.logs(site, 5000);
  assert.equal(logs.journal, 'journal');
  assert.equal(control.logCalls[0].lines, 1000);
  assert.equal(control.logCalls[0].accountUserId, 7);
});

// --- Durable snapshot receipts -------------------------------------------------------------------

test('scheduleSnapshot returns the promised public id durably and recovery completes it under that id', async (t) => {
  const { supervisor, control, store, site } = await sitesSdkHarness(t);
  const scheduled = await supervisor.scheduleSnapshot(site, { includeData: true, note: 'before change', model: 'test/model' });

  assert.match(scheduled.id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(store.environmentAction(SITE_ID), {
    siteId: SITE_ID, kind: 'snapshot', snapshotId: scheduled.id, includeData: true, note: 'before change',
    model: 'test/model', requestedAt: store.environmentAction(SITE_ID).requestedAt, lastError: null,
  });
  const receipts = store.runtimeRecords(SITE_ID, 'snapshot-request:');
  assert.equal(receipts.length, 1);
  const receipt = JSON.parse(receipts[0].value);
  assert.equal(receipt.publicId, scheduled.id);
  assert.equal(typeof receipt.operationId, 'string', 'the runtime accepted the request before the promise was returned');
  assert.deepEqual(store.releases(), [], 'the release appears only through completion, never synchronously');
  assert.deepEqual(requestKinds(control).at(-1), 'snapshot');
  assert.equal(snapshotRequests(control)[0].requestId, receipt.requestId);
  assert.deepEqual(snapshotRequests(control)[0].action, { kind: 'snapshot', includeData: true, note: 'before change' });

  const runtimeId = control.operations.get(receipt.operationId).snapshotId;
  control.snapshots.push({ id: runtimeId, generation: 1, createdAt: iso(), consistency: 'crash-consistent', completeProject: false, note: 'before change' });
  await supervisor.reconcile();

  const release = store.release(SITE_ID, scheduled.id);
  assert.notEqual(release, null);
  assert.equal(release.model, 'test/model');
  assert.equal(release.note, 'before change');
  assert.equal(store.release(SITE_ID, runtimeId), null, 'the provider snapshot id never becomes a public release');
  assert.equal(store.runtimeRecord(SITE_ID, `snapshot-display:${runtimeId}`), scheduled.id);
  assert.equal(store.runtimeRecord(SITE_ID, `snapshot-runtime:${scheduled.id}`), runtimeId);
  assert.equal(store.environmentAction(SITE_ID), null);
  assert.equal(store.runtimeRecords(SITE_ID, 'snapshot-request:').length, 0);
  // Merely taking a snapshot preserves the current pointer; only a completed restore moves it.
  assert.equal(site.currentReleaseId, null);
});

test('an interrupted snapshot receipt replays the same runtime request key', async (t) => {
  const { supervisor, control, store, site } = await sitesSdkHarness(t, { controlState: 'stopped' });
  seedHandover(store);
  store.putRuntimeRecord(SITE_ID, 'snapshot-request:rid', JSON.stringify({
    requestId: 'rid', accountUserId: 7, kind: 'snapshot', publicId: 'pub-1', requestedAt: iso(),
    input: { includeData: false, note: '', model: 'm' },
  }));
  assert.equal(store.beginEnvironmentAction({ siteId: SITE_ID, kind: 'snapshot', snapshotId: 'pub-1', includeData: false, note: '', model: 'm', requestedAt: iso(), lastError: null }), true);
  control.snapshots.push({ id: 'runtime-1', generation: 1, createdAt: iso(), consistency: 'crash-consistent', completeProject: false, note: '' });

  await supervisor.reconcile();

  assert.deepEqual(snapshotRequests(control).length, 1);
  assert.equal(snapshotRequests(control)[0].requestId, 'rid', 'the same idempotency key, so the provider deduplicates');
  assert.equal(store.release(SITE_ID, 'pub-1') !== null, true);
  assert.equal(store.environmentAction(SITE_ID), null);
});

test('a snapshot whose release metadata already survived a crash is completed, never re-dispatched', async (t) => {
  const { supervisor, control, store, site } = await sitesSdkHarness(t, { controlState: 'stopped' });
  seedHandover(store);
  control.operations.set('op-7', { id: 'op-7', requestId: 'rid2', siteId: SITE_ID, accountUserId: 7, generation: 1,
    action: { kind: 'snapshot' }, status: 'succeeded', error: null, snapshotId: 'runtime-3' });
  store.putRuntimeRecord(SITE_ID, 'snapshot-request:rid2', JSON.stringify({
    requestId: 'rid2', accountUserId: 7, kind: 'snapshot', publicId: 'pub-2', operationId: 'op-7', requestedAt: iso(),
    input: { includeData: false, note: '', model: 'm' },
  }));
  store.insertRelease(snapshotRelease(site, { id: 'pub-2' }));
  assert.equal(store.beginEnvironmentAction({ siteId: SITE_ID, kind: 'snapshot', snapshotId: 'pub-2', includeData: false, note: '', model: 'm', requestedAt: iso(), lastError: null }), true);
  control.snapshots.push({ id: 'runtime-3', generation: 1, createdAt: iso(), consistency: 'crash-consistent', completeProject: false, note: '' });

  await supervisor.reconcile();

  assert.deepEqual(snapshotRequests(control), [], 'a completed snapshot must not run twice');
  assert.deepEqual(store.releases().map((release) => release.id), ['pub-2']);
  assert.equal(store.environmentAction(SITE_ID), null);
});

test('a failed snapshot operation marks only its own row, stops retrying and still adopts a healthy ingress', async (t) => {
  const { supervisor, control, store, site, socketPath, brokerDir } = await sitesSdkHarness(t, { controlState: 'running' });
  seedHandover(store);
  control.operations.set('op-9', { id: 'op-9', requestId: 'rid3', siteId: SITE_ID, accountUserId: 7, generation: 1,
    action: { kind: 'snapshot' }, status: 'failed', error: 'export failed' });
  store.putRuntimeRecord(SITE_ID, 'snapshot-request:rid3', JSON.stringify({
    requestId: 'rid3', accountUserId: 7, kind: 'snapshot', publicId: 'pub-3', operationId: 'op-9', requestedAt: iso(),
    input: { includeData: true, note: '', model: 'm' },
  }));
  assert.equal(store.beginEnvironmentAction({ siteId: SITE_ID, kind: 'snapshot', snapshotId: 'pub-3', includeData: true, note: '', model: 'm', requestedAt: iso(), lastError: null }), true);
  site.status = 'failed';
  site.lastError = 'stale';
  mkdirSync(brokerDir, { recursive: true });
  const server = createServer();
  await new Promise((resolve) => server.listen(socketPath, resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); });
  chmodSync(brokerDir, 0o510);

  await supervisor.reconcile();
  assert.match(store.environmentAction(SITE_ID).lastError, /export failed/);
  assert.equal(store.runtimeRecords(SITE_ID, 'snapshot-request:').length, 0, 'the terminal receipt is settled');
  assert.equal(site.status, 'live', 'the environment itself recovered and is adopted');
  assert.equal(site.lastError, null);
  assert.notEqual(supervisor.endpointFor(SITE_ID), null);

  await supervisor.reconcile();
  assert.deepEqual(snapshotRequests(control), [], 'an errored action never hot-retries');
});

test('pendingAction projects the runtime status onto the visible row without writing anything', async (t) => {
  const { supervisor, control, store, site } = await sitesSdkHarness(t, { controlState: 'stopped' });
  seedHandover(store);
  const receipt = {
    requestId: 'rid4', accountUserId: 7, kind: 'snapshot', publicId: 'pub-4', operationId: 'op-4', requestedAt: iso(),
    input: { includeData: false, note: '', model: 'm' },
  };
  store.putRuntimeRecord(SITE_ID, 'snapshot-request:rid4', JSON.stringify(receipt));
  assert.equal(store.beginEnvironmentAction({ siteId: SITE_ID, kind: 'snapshot', snapshotId: 'pub-4', includeData: false, note: '', model: 'm', requestedAt: iso(), lastError: null }), true);

  // Still running: no error is invented.
  control.operations.set('op-4', { id: 'op-4', requestId: 'rid4', siteId: SITE_ID, accountUserId: 7, generation: 1,
    action: { kind: 'snapshot' }, status: 'running', error: null });
  assert.deepEqual(await supervisor.pendingAction(site), { ...store.environmentAction(SITE_ID), lastError: null });
  assert.equal(store.environmentAction(SITE_ID).lastError, null);

  // Terminal failure is surfaced for display but never written by the projection.
  control.operations.set('op-4', { ...control.operations.get('op-4'), status: 'failed', error: 'unpause failed' });
  assert.match((await supervisor.pendingAction(site)).lastError, /unpause failed/);
  assert.equal(store.environmentAction(SITE_ID).lastError, null, 'the projection is read-only');

  // An already-errored row and a receipt without a dispatch are returned untouched.
  store.updateEnvironmentActionError(SITE_ID, 'previous failure');
  const errored = await supervisor.pendingAction(site);
  assert.match(errored.lastError, /previous failure/);
  assert.deepEqual(control.requests, [], 'the projection never dispatches');
  store.deleteRuntimeRecord(SITE_ID, 'snapshot-request:rid4');
  assert.deepEqual(await supervisor.pendingAction(site), store.environmentAction(SITE_ID));
});

test('snapshot retention authority is handed to the runtime with the configured bound', async (t) => {
  const { supervisor, control, site } = await sitesSdkHarness(t, {
    config: { releasesKept: 2 },
  });
  await supervisor.state(site);
  const binding = await control.authority.resolve({ siteId: SITE_ID, accountUserId: 7, access: 'read' });
  assert.equal(binding.snapshotRetention, 2, 'the provider prunes with the Sites-configured retention');
  assert.equal(binding.image, BASE_IMAGE_TAG);
  assert.equal(binding.sourcePath, site.sourceDir);
  assert.equal(binding.staging, false);
});

// --- Durable restore receipts --------------------------------------------------------------------

test('restore is durable before dispatch and a completed restore moves the public pointer exactly once', async (t) => {
  const { supervisor, control, store, site } = await sitesSdkHarness(t, { controlState: 'stopped' });
  seedHandover(store);
  store.insertRelease(snapshotRelease(site, { id: 'pub-1' }));

  await supervisor.scheduleRestore(site, 'pub-1', true);

  assert.deepEqual(store.environmentAction(SITE_ID), {
    siteId: SITE_ID, kind: 'rollback', snapshotId: 'pub-1', restoreData: true,
    requestedAt: store.environmentAction(SITE_ID).requestedAt, lastError: null,
  });
  assert.equal(site.currentReleaseId, null, 'the pointer moves only when the restore completes');
  assert.deepEqual(restoreRequests(control).length, 1);
  assert.deepEqual(restoreRequests(control)[0].action, { kind: 'restore', snapshotId: 'pub-1', restoreData: true });

  await supervisor.reconcile();
  assert.equal(site.currentReleaseId, 'pub-1');
  assert.equal(store.environmentAction(SITE_ID), null);
  assert.equal(store.runtimeRecords(SITE_ID, 'restore-request:').length, 0);

  const dispatched = restoreRequests(control).length;
  await supervisor.reconcile();
  assert.equal(restoreRequests(control).length, dispatched, 'a completed restore is never replayed');
});

test('restore dispatch maps the public snapshot id to its runtime id', async (t) => {
  const { supervisor, control, store, site } = await sitesSdkHarness(t, { controlState: 'stopped' });
  seedHandover(store);
  store.insertRelease(snapshotRelease(site, { id: 'pub-1' }));
  store.putRuntimeRecord(SITE_ID, 'snapshot-runtime:pub-1', 'runtime-1');

  await supervisor.scheduleRestore(site, 'pub-1', false);
  assert.deepEqual(restoreRequests(control)[0].action, { kind: 'restore', snapshotId: 'runtime-1', restoreData: false });

  await supervisor.reconcile();
  assert.equal(site.currentReleaseId, 'pub-1', 'the public id, not the runtime id, becomes the release pointer');
});

test('a failed restore marks its own visible row and does not hot-retry', async (t) => {
  const { supervisor, control, store, site } = await sitesSdkHarness(t, { controlState: 'stopped' });
  seedHandover(store);
  store.insertRelease(snapshotRelease(site, { id: 'pub-1' }));
  control.operations.set('op-11', { id: 'op-11', requestId: 'rid5', siteId: SITE_ID, accountUserId: 7, generation: 1,
    action: { kind: 'restore', snapshotId: 'pub-1', restoreData: true }, status: 'failed', error: 'snapshot import failed' });
  store.putRuntimeRecord(SITE_ID, 'restore-request:rid5', JSON.stringify({
    requestId: 'rid5', accountUserId: 7, kind: 'restore', publicId: 'pub-1', operationId: 'op-11', requestedAt: iso(),
    input: { includeData: true, note: '', model: '', restoreData: true },
  }));
  assert.equal(store.beginEnvironmentAction({ siteId: SITE_ID, kind: 'rollback', snapshotId: 'pub-1', restoreData: true, requestedAt: iso(), lastError: null }), true);

  await supervisor.reconcile();
  assert.match(store.environmentAction(SITE_ID).lastError, /snapshot import failed/);
  assert.equal(store.runtimeRecords(SITE_ID, 'restore-request:').length, 0);
  assert.notEqual(site.currentReleaseId, 'pub-1', 'a failed restore never moves the pointer');

  await supervisor.reconcile();
  assert.deepEqual(restoreRequests(control), [], 'no hot retry of a failed restore');
});

// --- Deletion and environment files --------------------------------------------------------------

test('environment delete requests the typed delete, removes the broker through authority and keeps the Project source', async (t) => {
  const { supervisor, control, gateway, store, site } = await sitesSdkHarness(t, { controlState: 'stopped' });
  await supervisor.state(site);
  await supervisor.delete(SITE_ID);

  assert.deepEqual(requestKinds(control).at(-1), 'delete');
  assert.equal(supervisor.endpointFor(SITE_ID), null);
  assert.equal(site.sourceDir, '/workspace/project', 'the Project source directory is never touched');
  assert.notEqual(store.siteById(SITE_ID), null);
  assert.equal(gateway.ops.some(([name]) => name === 'remove'), true, 'the broker goes only after the provider stopped the container');
});

test('a staging conversion binding deletes as cleanup-stage and takes its broker with it', async (t) => {
  const { supervisor, control, gateway, site } = await sitesSdkHarness(t, { site: environmentSite({ runtime: 'static' }) });
  await supervisor.state(site);
  await supervisor.delete(SITE_ID, {});

  assert.deepEqual(requestKinds(control).at(-1), 'cleanup-stage');
  assert.deepEqual(gateway.ops.filter(([name]) => name === 'remove').length, 1);
});

test('environment files survive repeated container creation', async (t) => {
  const { supervisor, control, site, root } = await sitesSdkHarness(t);
  await supervisor.state(site);
  // The handover above ran beforeCreate once; the provider may recreate the container (restore, rebuild).
  await control.authority.beforeCreate(SITE_ID);
  const environment = join(root, 'data', SITE_ID, 'environment');
  const stub = join(environment, 'git-stub');
  assert.equal(modeOf(stub), 0o400, 'the stub stays read-only after the second create');
  assert.equal(readFileSync(stub, 'utf8'), '');
  assert.match(readFileSync(join(environment, 'container.env'), 'utf8'), /ELOWEN_SITE_SLUG=environment-demo/);
});

test('a failed runtime is projected into the Site row instead of leaving it live', async (t) => {
  const { supervisor, site } = await sitesSdkHarness(t, {
    controlState: 'failed',
    control: {
      desiredState: 'running',
      failStart: true,
      lastError: "ENOENT: no such file or directory, lstat '/data/x/environment/git-stub'",
    },
  });
  site.status = 'live';
  site.lastError = null;

  await supervisor.reconcile();

  // The live audit found exactly the opposite: a container that failed four lifecycle attempts while
  // SiteList and SiteGet kept advertising `live` with no error at all.
  assert.equal(site.status, 'failed');
  assert.match(site.lastError, /git-stub/);
});

test('an explicitly stopped runtime keeps its Site row untouched', async (t) => {
  const { supervisor, site } = await sitesSdkHarness(t, { controlState: 'stopped', control: { desiredState: 'stopped' } });
  site.status = 'live';
  site.lastError = null;

  await supervisor.reconcile();

  // Stopped is an intent, not a fault — projecting it would turn every deliberate stop into an error.
  assert.equal(site.status, 'live');
  assert.equal(site.lastError, null);
});

// --- Conversion suspension -----------------------------------------------------------------------
//
// A rollback stops the container to export its volume consistently. The row still says `environment` and
// `live` for that whole window, so to any automatic starter the container looks exactly like one that
// should be up and is not. The conversion's own authorized start is the marker's owner.

test('a reconcile tick under conversion suspension drops routing and dispatches nothing', async (t) => {
  const suspension = { value: null };
  const { supervisor, control, store, socketPath } = await sitesSdkHarness(t, {
    controlState: 'running',
    store: { conversionSuspends: (id) => (id === SITE_ID ? suspension.value : null) },
  });
  seedHandover(store);
  // Nothing starts the container in this tick, so the ingress directory the live socket needs is not
  // prepared by a lifecycle callback here.
  mkdirSync(join(socketPath, '..'), { recursive: true });
  const server = createServer();
  await new Promise((resolve) => server.listen(socketPath, resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); });
  suspension.value = 'environment';

  await supervisor.reconcile();

  assert.deepEqual(control.requests, [], 'nothing was started or dispatched');
  assert.equal(supervisor.endpointFor(SITE_ID), null, 'nothing keeps routing to the stopped container');
});

test('only the conversion own start passes its guard, and a durable action defers instead of failing', async (t) => {
  const suspension = { value: 'environment' };
  const { supervisor, control, store, site } = await sitesSdkHarness(t, {
    control: { authorityLifecycle: false },
    store: { conversionSuspends: (id) => (id === SITE_ID ? suspension.value : null) },
  });
  await assert.rejects(() => supervisor.start(site), /held by a runtime conversion/);
  assert.deepEqual(control.requests, [], 'an unauthorized start never reaches the provider');

  await supervisor.start(site, { authorized: true });
  assert.deepEqual(requestKinds(control), ['start'], 'the authorized conversion start ran');

  // A snapshot requested while a conversion holds the environment is deferred, not failed: the receipt
  // stays clean for recovery instead of writing an error the operator did not cause.
  store.putRuntimeRecord(SITE_ID, 'snapshot-request:rid6', JSON.stringify({
    requestId: 'rid6', accountUserId: 7, kind: 'snapshot', publicId: 'pub-6', requestedAt: iso(),
    input: { includeData: true, note: '', model: 'm' },
  }));
  assert.equal(store.beginEnvironmentAction({ siteId: SITE_ID, kind: 'snapshot', snapshotId: 'pub-6', includeData: true, note: '', model: 'm', requestedAt: iso(), lastError: null }), true);
  await supervisor.reconcile();
  assert.deepEqual(snapshotRequests(control).length, 0, 'the action is deferred under the rollback');
  assert.equal(store.environmentAction(SITE_ID).lastError, null);
  assert.equal(store.runtimeRecords(SITE_ID, 'snapshot-request:').length, 1, 'the receipt is retained for recovery');
});

// --- Durable store slot --------------------------------------------------------------------------

test('environment exec leases exclude lifecycle actions across processes', () => {
  const store = new SitesStore(makeDb());
  store.insertSite(environmentSite());
  assert.equal(store.tryBeginEnvironmentExec(SITE_ID, 'exec-token', Date.now() + 60_000), true);
  assert.equal(store.beginEnvironmentAction({
    siteId: SITE_ID, kind: 'snapshot', snapshotId: 'blocked', includeData: false,
    note: '', model: 'm', requestedAt: iso(), lastError: null,
  }), false);
  store.endEnvironmentExec(SITE_ID, 'wrong-token');
  assert.equal(store.beginEnvironmentAction({
    siteId: SITE_ID, kind: 'snapshot', snapshotId: 'blocked', includeData: false,
    note: '', model: 'm', requestedAt: iso(), lastError: null,
  }), false);
  store.endEnvironmentExec(SITE_ID, 'exec-token');
  assert.equal(store.beginEnvironmentAction({
    siteId: SITE_ID, kind: 'snapshot', snapshotId: 'lost-stop', includeData: false,
    note: '', model: 'm', requestedAt: iso(), lastError: null,
  }), true);
});

test('the visible action slot is exclusive while clean, replaceable once errored, and never moves desired state', () => {
  const store = new SitesStore(makeDb());
  store.insertSite(environmentSite());
  assert.equal(store.beginEnvironmentAction({
    siteId: SITE_ID, kind: 'snapshot', snapshotId: 'snap-a', includeData: true,
    note: 'a', model: 'm', requestedAt: iso(), lastError: null,
  }), true);
  assert.equal(store.siteById(SITE_ID).environmentDesiredState, 'running', 'the provider owns desired state; the slot never mutates it');
  assert.equal(store.beginEnvironmentAction({
    siteId: SITE_ID, kind: 'rollback', snapshotId: 'snap-b', restoreData: false,
    requestedAt: iso(), lastError: null,
  }), false, 'a clean action stays exclusive');
  store.updateEnvironmentActionError(SITE_ID, 'failed once');
  assert.equal(store.beginEnvironmentAction({
    siteId: SITE_ID, kind: 'rollback', snapshotId: 'snap-b', restoreData: false,
    requestedAt: iso(), lastError: null,
  }), true, 'an errored action is replaced only by a new explicit request');
  const action = store.environmentAction(SITE_ID);
  assert.equal(action.kind, 'rollback');
  assert.equal(action.lastError, null);
  store.deleteEnvironmentAction(SITE_ID);
  assert.equal(store.environmentAction(SITE_ID), null);
});

test('migration v5 preserves existing runtimes, exposes environment counts and fails unknown runtimes', () => {
  const now = new Date().toISOString();
  const db = makeDb({
    beforeStep: (version, handle) => {
      if (version !== 5) return;
      for (const runtime of ['static', 'command', 'php']) {
        handle.prepare(`INSERT INTO p_sites_sites (
          id, slug, title, project_id, owner_user_id, source_dir, runtime, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          `legacy-${runtime}`, `legacy-${runtime}`, runtime, 1, 7, '/tmp', runtime, 'live', now, now,
        );
      }
    },
  });
  const store = new SitesStore(db);
  // The schema head is pinned deliberately: a migration added without updating this line is a migration
  // nobody reviewed against the legacy rows seeded above. v9 adds the runtime conversion slot, v10 the
  // durable crash-recovery state on it, v11/v12 the runtime records and provider-owned lifecycle
  // columns, v13 drops the disk threshold column nothing enforced, and v14 adds the publication kind and
  // target; none of them touches the runtime of an existing site row.
  assert.equal(db.appliedVersion(), 14);
  for (const runtime of ['static', 'command', 'php']) assert.equal(store.siteById(`legacy-${runtime}`).runtime, runtime);
  // The rows seeded above predate the publication model, so the migration's defaults make them static
  // publications with nothing to proxy — which is exactly how the serving path treated them before.
  for (const runtime of ['static', 'command', 'php']) {
    assert.equal(store.siteById(`legacy-${runtime}`).kind, 'static');
    assert.equal(store.siteById(`legacy-${runtime}`).target, '');
  }
  store.insertSite(environmentSite({ id: 'site-environment', slug: 'site-environment' }));
  assert.equal(store.countEnvironmentOwnedBy(7), 1);
  assert.deepEqual(store.liveEnvironmentSites().map((site) => site.id), ['site-environment']);

  db.prepare(`INSERT INTO p_sites_sites (
    id, slug, title, project_id, owner_user_id, source_dir, runtime, status, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    'site-unknown', 'site-unknown', 'Unknown', 1, 7, '/tmp', 'mystery', 'live', new Date().toISOString(), new Date().toISOString(),
  );
  const unknown = store.siteById('site-unknown');
  assert.equal(unknown.runtime, 'unsupported');
  assert.equal(unknown.status, 'failed');
  assert.match(unknown.lastError, /mystery/);
});

/** Seed a completed handover so tests can exercise one operation without the bootstrap sequence. */
function seedHandover(store) {
  store.putRuntimeRecord(SITE_ID, 'handover', 'complete');
  store.putRuntimeRecord(SITE_ID, 'bootstrap-intent', 'complete');
}

// --- Core seam, manifest, configuration ----------------------------------------------------------

test('core seam, manifest and lifecycle match the final core contract', () => {
  const seams = readFileSync(new URL('../plugins/sites/src/coreSeams.ts', import.meta.url), 'utf8');
  const index = readFileSync(new URL('../plugins/sites/src/index.ts', import.meta.url), 'utf8');
  const lifecycle = readFileSync(new URL('../plugins/sites/src/environment.ts', import.meta.url), 'utf8');
  const readiness = readFileSync(new URL('../plugins/sites/src/readiness.ts', import.meta.url), 'utf8');
  const manifest = JSON.parse(readFileSync(new URL('../plugins/sites/elowen-plugin.json', import.meta.url), 'utf8'));
  assert.match(seams, /environmentsStatus\(\)/);
  assert.match(seams, /provisionEnvironments\(\)/);
  assert.match(seams, /ready: boolean/);
  assert.match(seams, /items: PublishedSitesEnvironmentStatusItem\[\]/);
  assert.doesNotMatch(seams, /EnvironmentProvision|steps: Environment|status: Environment|error\?: string/);
  // The provisioning report is consumed where the readiness rows are built; index.ts only wires it up.
  assert.match(readiness, /report\.items/);
  assert.match(readiness, /report\.ready/);
  for (const source of [index, readiness]) {
    assert.doesNotMatch(source, /report\.steps|report\.available|report\.ok|report\.error/);
  }
  // The newest core seam this plugin cannot work without. It was the environments contract (0.28.31);
  // it is now the streaming response body, without which a published file over 64 MiB cannot be served
  // at all — while the settings let an administrator publish one far larger.
  assert.equal(manifest.requiresCore, '0.28.35');
  assert.ok(manifest.provides.tools.includes('SiteExec'));
  assert.ok(manifest.provides.tools.includes('SiteControl'));
  assert.ok(manifest.provides.tools.includes('SiteSnapshot'));
  assert.ok(manifest.provides.apiRoutes.includes('environments/readiness'));
  assert.ok(manifest.provides.apiRoutes.includes('environments/provision'));
  assert.ok(manifest.capabilities.mutates.includes('events'));
  assert.equal(manifest.configSchema.find((field) => field.key === 'environmentNetwork')?.default, 'shared');
  assert.equal(manifest.configSchema.find((field) => field.key === 'runtimeNetwork')?.default, 'isolated');
  assert.match(manifest.description, /persistent rootless environments/i);
  assert.match(manifest.description, /static/i);
  assert.match(manifest.description, /command/i);
  assert.match(manifest.description, /PHP/i);
  assert.doesNotMatch(seams, /environmentSupportStatus|installEnvironmentSupport/);
  // All lower container lifecycle belongs to the Sandbox provider: no local driver, no second loop.
  assert.doesNotMatch(lifecycle, /systemd-run|start --attach|podman\.restart|deps\.podman\.restart/);
  assert.doesNotMatch(lifecycle, /PodmanClient/);
});

test('environment configuration is strictly bounded and separately gated', () => {
  const resolved = resolveConfig({
    allowEnvironments: true,
    runtimeNetwork: 'isolated',
    environmentNetwork: 'shared',
    environmentCpus: 99,
    environmentMemoryMb: -1,
    environmentPidsLimit: 1.2,
    maxEnvironmentsPerAccount: 999,
  }, 'https://elowen.example', 'sites.elowen.example');
  assert.equal(resolved.allowEnvironments, true);
  assert.equal(resolved.runtimeNetwork, 'isolated');
  assert.equal(resolved.environmentNetwork, 'shared');
  assert.equal(resolveConfig({ runtimeNetwork: 'shared', environmentNetwork: 'invalid' }, null).environmentNetwork, 'shared');
  assert.equal(resolved.environmentCpus, 8);
  assert.equal(resolved.environmentMemoryMb, 128);
  assert.equal(resolved.environmentPidsLimit, 16);
  assert.equal(resolved.maxEnvironmentsPerAccount, 20);
});

// --- Public tools --------------------------------------------------------------------------------

function phase2ToolHarness(t, { userId = 1, admin = false, projectAccess = true, configRaw = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sites-phase2-tools-'));
  const project = join(root, 'project');
  mkdirSync(project, { recursive: true });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = new SitesStore(makeDb());
  const registered = new Map();
  const environmentCalls = [];
  const access = {
    accountExists: () => true,
    isAdmin: (id) => id === userId && admin,
    canAccessProject: (id, projectId) => id === userId && projectId === 7 && projectAccess,
  };
  const ctx = {
    registerTool: (tool) => registered.set(tool.name, tool),
    currentModel: () => ({ provider: 'test', model: 'model' }),
    currentContributionUserId: () => userId,
    currentIdentity: () => ({ elowenUserId: userId }),
    currentSessionId: () => 'session-1',
    // The trusted per-turn access state. No managed `projectRef` here: this harness stands for a
    // conversation bound to a host Project, so the source root resolves through workDir.
    currentAccess: () => ({ projectIds: [7], admin, owner: false, permissionBoundary: null, accountUserId: userId }),
    workDir: () => project,
    assertPathAllowed: (path) => path,
    // SiteCreate needs the Sandbox control to exist; the environment mock below carries the behaviour.
    // No active workspace here, so the source root falls back to the bound Project.
    control: (name) => (name === 'sandbox' ? { activeWorkspace: () => undefined } : undefined),
    host: { stores: () => ({ projects: {
      list: () => [{ id: 7, slug: 'demo', path: project }],
      get: (id) => (id === 7 ? { id: 7, slug: 'demo', path: project } : null),
    } }) },
  };
  const resolved = () => resolveConfig({ allowEnvironments: true, ...configRaw }, 'https://elowen.example', 'sites.elowen.example');
  const envState = (site) => ({
    state: 'running', desiredState: site.environmentDesiredState === 'running' ? 'running' : 'stopped', lastError: null,
    limits: {
      cpus: site.environmentCpus ?? resolved().environmentCpus,
      memoryMb: site.environmentMemoryMb ?? resolved().environmentMemoryMb,
      pidsLimit: site.environmentPidsLimit ?? resolved().environmentPidsLimit,
    },
  });
  let scheduledSnapshot = null;
  const environment = {
    async state(site) { environmentCalls.push(['state', site.id]); return envState(site); },
    async exec(site, command, options) { environmentCalls.push(['exec', site.id, command, options]); return { stdout: 'exec-ok', stderr: '', code: 0 }; },
    async logs(site, lines) { environmentCalls.push(['logs', site.id, lines]); return { lifecycle: 'life', journal: 'journal' }; },
    async applyLimits(site, limits) { environmentCalls.push(['limits', site.id, limits]); store.updateSite(site.id, limits); },
    async request(site, action, actor) { environmentCalls.push(['request', site.id, action, actor]); },
    /** Same durable slot the real supervisor claims, so the tool tests assert the real semantics. */
    async scheduleSnapshot(site, input, actor) {
      environmentCalls.push(['scheduleSnapshot', site.id, input, actor]);
      const publicId = `public-${scheduledSnapshot = (scheduledSnapshot ?? 0) + 1}`;
      if (!store.beginEnvironmentAction({ siteId: site.id, kind: 'snapshot', snapshotId: publicId, includeData: input.includeData, note: input.note, model: input.model, requestedAt: iso(), lastError: null })) {
        throw new Error('another environment action or execution is in progress');
      }
      return { id: publicId };
    },
    async scheduleRestore(site, snapshotId, restoreData, actor) {
      environmentCalls.push(['scheduleRestore', site.id, snapshotId, restoreData, actor]);
      if (!store.beginEnvironmentAction({ siteId: site.id, kind: 'rollback', snapshotId, restoreData, requestedAt: iso(), lastError: null })) {
        throw new Error('another environment action or execution is in progress');
      }
    },
    async pendingAction(site) {
      environmentCalls.push(['pendingAction', site.id]);
      return store.environmentAction(site.id);
    },
  };
  registerTools({
    ctx, store, access, config: resolved,
    people: () => new Map([[userId, { id: userId, username: `user-${userId}`, name: `User ${userId}`, avatar: '' }]]),
    siteDir: (id) => join(root, 'data', id), releaseDir: (id, releaseId) => join(root, 'data', id, releaseId),
    deleteSite: async () => {},
    runtime: { allocatePort: async () => 43000, stop: async () => {}, start: async () => {}, logTail: () => '', isRunning: () => false },
    environment,
  });
  return { store, environment, environmentCalls, call: (name, input = {}) => registered.get(name).execute('call-1', input) };
}

test('SiteExec enforces publisher and Project access and runs synchronously in a forked runner', async (t) => {
  const allowed = phase2ToolHarness(t);
  allowed.store.insertSite(environmentSite({ ownerUserId: 1, projectId: 7 }));
  const result = await allowed.call('SiteExec', { site: SITE_ID, command: 'echo ok', timeoutSeconds: 900, workdir: '/workspace' });
  assert.equal(result.content[0].text.includes('exec-ok'), true);
  assert.deepEqual(allowed.environmentCalls[0], ['exec', SITE_ID, 'echo ok', { timeoutSeconds: 900, workdir: '/workspace', accountUserId: 1 }]);
  await assert.rejects(() => allowed.call('SiteExec', { site: SITE_ID, command: 'x', workdir: '/workspace/../data' }), /workdir/i);

  const noProject = phase2ToolHarness(t, { projectAccess: false });
  noProject.store.insertSite(environmentSite({ ownerUserId: 1, projectId: 7 }));
  await assert.rejects(() => noProject.call('SiteExec', { site: SITE_ID, command: 'echo no' }), /Project access/i);

  const noPublisher = phase2ToolHarness(t, { configRaw: { publishers: 'admins' } });
  noPublisher.store.insertSite(environmentSite({ ownerUserId: 1, projectId: 7 }));
  await assert.rejects(() => noPublisher.call('SiteExec', { site: SITE_ID, command: 'echo no' }), /not allowed to publish/i);
});

test('SiteExec refuses every pending environment mutation', async (t) => {
  for (const desiredState of ['stopped', 'restarting']) {
    const harness = phase2ToolHarness(t);
    harness.store.insertSite(environmentSite({ ownerUserId: 1, projectId: 7, environmentDesiredState: desiredState }));
    await assert.rejects(() => harness.call('SiteExec', { site: SITE_ID, command: 'echo no' }), /pending/i);
  }
  const harness = phase2ToolHarness(t);
  harness.store.insertSite(environmentSite({ ownerUserId: 1, projectId: 7 }));
  harness.store.beginEnvironmentAction({
    siteId: SITE_ID, kind: 'snapshot', snapshotId: 'pending', includeData: false, note: '', model: 'm',
    requestedAt: iso(), lastError: null,
  });
  await assert.rejects(() => harness.call('SiteExec', { site: SITE_ID, command: 'echo no' }), /pending/i);
});

test('an errored environment action stays visible but no longer locks SiteExec out', async (t) => {
  const harness = phase2ToolHarness(t);
  harness.store.insertSite(environmentSite({ ownerUserId: 1, projectId: 7 }));
  harness.store.beginEnvironmentAction({
    siteId: SITE_ID, kind: 'snapshot', snapshotId: 'stuck', includeData: false, note: '', model: 'm',
    requestedAt: iso(), lastError: null,
  });
  // While it is genuinely in flight the gate holds.
  await assert.rejects(() => harness.call('SiteExec', { site: SITE_ID, command: 'echo no' }), /pending/i);

  harness.store.putEnvironmentAction({
    siteId: SITE_ID, kind: 'snapshot', snapshotId: 'stuck', includeData: false, note: '', model: 'm',
    requestedAt: iso(), lastError: 'Container cannot be quiesced for snapshot',
  });

  // Once it has errored the row is retained for display and retry ownership, not as a lock. The live audit
  // hit exactly this: one snapshot that could never quiesce made SiteExec permanently unreachable with no
  // tool-level way to clear it.
  const result = await harness.call('SiteExec', { site: SITE_ID, command: 'echo ok' });
  assert.ok(result.content[0].text.length > 0);
  assert.equal(harness.store.environmentAction(SITE_ID)?.lastError, 'Container cannot be quiesced for snapshot',
    'the failed action remains inspectable');

  // …and the errored slot can still be replaced by a new action.
  assert.equal(harness.store.beginEnvironmentAction({
    siteId: SITE_ID, kind: 'snapshot', snapshotId: 'retry', includeData: false, note: '', model: 'm',
    requestedAt: iso(), lastError: null,
  }), true);
});

test('admin can manage environments without Project assignment', async (t) => {
  const operations = [
    ['SiteExec', { command: 'echo admin' }],
    ['SiteControl', { action: 'restart' }],
    ['SiteSnapshot', { includeData: false }],
    ['SiteRollback', { releaseId: 'admin-snapshot' }],
    ['SiteLogs', {}],
    ['SiteGet', {}],
  ];
  for (const [tool, input] of operations) {
    const harness = phase2ToolHarness(t, { userId: 9, admin: true, projectAccess: false, configRaw: { publishers: 'admins' } });
    harness.store.insertSite(environmentSite({ ownerUserId: 1, projectId: 7 }));
    harness.store.insertRelease({
      id: 'admin-snapshot', siteId: SITE_ID, createdAt: iso(), model: 'm', fileCount: 0,
      sizeBytes: 0, note: '', kind: 'environment-snapshot', imageRef: `localhost/elowen-site/${SITE_ID}:admin-snapshot`, dataArchive: null,
    });
    await harness.call(tool, { site: SITE_ID, ...input });
  }
});

test('ordinary owner loses environment operations after Project access is revoked', async (t) => {
  for (const [tool, input] of [
    ['SiteExec', { command: 'echo owner' }],
    ['SiteControl', { action: 'restart' }],
    ['SiteSnapshot', {}],
    ['SiteRollback', { releaseId: 'owner-snapshot' }],
    ['SiteLogs', {}],
  ]) {
    const harness = phase2ToolHarness(t, { projectAccess: false });
    harness.store.insertSite(environmentSite({ ownerUserId: 1, projectId: 7 }));
    harness.store.insertRelease({
      id: 'owner-snapshot', siteId: SITE_ID, createdAt: iso(), model: 'm', fileCount: 0,
      sizeBytes: 0, note: '', kind: 'environment-snapshot', imageRef: `localhost/elowen-site/${SITE_ID}:owner-snapshot`, dataArchive: null,
    });
    await assert.rejects(() => harness.call(tool, { site: SITE_ID, ...input }), /Project access/i);
  }
});

test('SiteControl and lifecycle scheduling carry durable daemon work without ambient gateway control', async (t) => {
  const harness = phase2ToolHarness(t);
  const site = environmentSite({ ownerUserId: 1, projectId: 7 });
  harness.store.insertSite(site);
  const result = await harness.call('SiteControl', { site: SITE_ID, action: 'restart' });
  assert.equal(result.details.scheduled, true);
  assert.deepEqual(harness.environmentCalls.find(([name]) => name === 'request'), ['request', SITE_ID, { kind: 'restart' }, 1]);
  assert.equal(harness.environmentCalls.some(([name]) => ['exec', 'snapshot', 'scheduleSnapshot'].includes(name)), false);

  harness.store.insertRelease({
    id: 'snapshot-1', siteId: site.id, createdAt: iso(), model: 'm', fileCount: 0,
    sizeBytes: 0, note: '', kind: 'environment-snapshot', imageRef: `localhost/elowen-site/${site.id}:snapshot-1`, dataArchive: '/snapshot/data.tar',
  });
  await harness.call('SiteRollback', { site: SITE_ID, releaseId: 'snapshot-1', restoreData: true });
  assert.deepEqual(harness.store.environmentAction(SITE_ID), {
    siteId: SITE_ID, kind: 'rollback', snapshotId: 'snapshot-1', restoreData: true,
    requestedAt: harness.store.environmentAction(SITE_ID).requestedAt, lastError: null,
  });

  harness.store.insertSite(environmentSite({ id: 'other-site', slug: 'other-site', ownerUserId: 1, projectId: 7 }));
  await assert.rejects(() => harness.call('SiteRollback', { site: 'other-site', releaseId: 'snapshot-1' }), /not retained for this site/i);
});

test('SiteSnapshot schedules daemon work with a stable public id and SiteGet exposes pending errors', async (t) => {
  const harness = phase2ToolHarness(t);
  harness.store.insertSite(environmentSite({ ownerUserId: 1, projectId: 7 }));
  const scheduled = await harness.call('SiteSnapshot', { site: SITE_ID, includeData: true, note: 'before change' });
  const action = harness.store.environmentAction(SITE_ID);
  assert.equal(action.kind, 'snapshot');
  assert.equal(action.includeData, true);
  assert.equal(action.note, 'before change');
  assert.equal(scheduled.details.scheduled, true);
  assert.equal(scheduled.details.snapshotId, action.snapshotId, 'the promised public id is returned immediately');
  assert.equal(harness.environmentCalls.some(([name]) => name === 'snapshot'), false, 'no synchronous snapshot call');

  harness.store.updateEnvironmentActionError(SITE_ID, 'snapshot failed once');
  const detail = await harness.call('SiteGet', { site: SITE_ID });
  assert.equal(detail.details.environmentAction.lastError, 'snapshot failed once');

  const retried = await harness.call('SiteSnapshot', { site: SITE_ID, includeData: false, note: 'retry' });
  assert.notEqual(retried.details.snapshotId, action.snapshotId, 'the retry promises a fresh public id');
  assert.equal(harness.store.environmentAction(SITE_ID).lastError, null);
  assert.equal(harness.store.environmentAction(SITE_ID).kind, 'snapshot');
});

test('a clean in-flight action refuses scheduling until it settles or errors', async (t) => {
  const harness = phase2ToolHarness(t);
  harness.store.insertSite(environmentSite({ ownerUserId: 1, projectId: 7 }));
  await harness.call('SiteSnapshot', { site: SITE_ID, includeData: false });
  await assert.rejects(() => harness.call('SiteSnapshot', { site: SITE_ID, includeData: true }), /already in progress/i);
  assert.equal(harness.store.environmentAction(SITE_ID).snapshotId.startsWith('public-'), true, 'the clean action was not replaced');
});

test('SiteUpdate applies environment limits for an administrator, clamped to the declared caps', async (t) => {
  // The web screen could already change these; an agent asked to size an environment had no tool for it
  // and no way to read back the ceilings it was given.
  const owner = phase2ToolHarness(t);
  owner.store.insertSite(environmentSite({ ownerUserId: 1, projectId: 7 }));
  await assert.rejects(() => owner.call('SiteUpdate', { site: SITE_ID, environmentMemoryMb: 2048 }), /administrator/i);
  assert.equal(owner.environmentCalls.some(([name]) => name === 'limits'), false);
  assert.equal(owner.store.siteById(SITE_ID).environmentMemoryMb, null);

  const admin = phase2ToolHarness(t, { userId: 9, admin: true });
  admin.store.insertSite(environmentSite({ ownerUserId: 9, projectId: 7 }));
  const updated = await admin.call('SiteUpdate', {
    site: SITE_ID,
    environmentCpus: 99, environmentMemoryMb: 64, environmentPidsLimit: 2,
  });
  // Out-of-range values are pinned to the SAME bounds the settings screen enforces: a tool must not be
  // the way around an instance ceiling.
  assert.deepEqual(admin.environmentCalls.find(([name]) => name === 'limits'), ['limits', SITE_ID, {
    environmentCpus: 8, environmentMemoryMb: 128, environmentPidsLimit: 16,
  }]);
  assert.deepEqual(updated.details.limits, { cpus: 8, memoryMb: 128, pidsLimit: 16 });

  // Null clears an override, so the environment falls back to the instance default rather than keeping a
  // value nobody can see in the settings screen.
  const cleared = await admin.call('SiteUpdate', { site: SITE_ID, environmentMemoryMb: null });
  assert.equal(admin.store.siteById(SITE_ID).environmentMemoryMb, null);
  assert.equal(cleared.details.limits.memoryMb, 1024);
});

test('SiteUpdate leaves nothing half written when the limits cannot be applied', async (t) => {
  // Persisting the ordinary patch first and applying limits afterwards meant a provider failure surfaced
  // as a bare error while the title and visibility had already changed, so the caller could not tell what
  // had actually happened. The limits go first, and their failure names itself.
  const admin = phase2ToolHarness(t, { userId: 9, admin: true });
  admin.store.insertSite(environmentSite({ ownerUserId: 9, projectId: 7, title: 'Before', visibility: 'private' }));
  admin.environment.applyLimits = async () => { throw new Error('the provider refused the update'); };

  await assert.rejects(
    () => admin.call('SiteUpdate', {
      site: SITE_ID, title: 'After', visibility: 'authenticated', environmentMemoryMb: 2048,
    }),
    /limits could not be applied.*the provider refused the update/i,
  );

  const unchanged = admin.store.siteById(SITE_ID);
  assert.equal(unchanged.title, 'Before', 'the ordinary patch must not survive a failed limit change');
  assert.equal(unchanged.visibility, 'private');
  assert.equal(unchanged.environmentMemoryMb, null);
});

test('SiteUpdate refuses resource limits on a site that is not an environment', async (t) => {
  const admin = phase2ToolHarness(t, { userId: 9, admin: true });
  admin.store.insertSite(environmentSite({ ownerUserId: 9, projectId: 7, runtime: 'static' }));
  await assert.rejects(() => admin.call('SiteUpdate', { site: SITE_ID, environmentCpus: 2 }), /only an environment/i);
  assert.equal(admin.environmentCalls.some(([name]) => name === 'limits'), false);
});

// --- Public API ----------------------------------------------------------------------------------

const apiRequest = ({ method = 'GET', path = '', admin = false, userId = 1, body = {}, query = {} } = {}) => ({
  method, path, query, headers: {}, params: {},
  auth: { userId, admin, tokenScope: 'user', accessibleProjects: [7] },
  body: async () => Buffer.from(JSON.stringify(body)),
  json: async () => body,
});

function phase2ApiHarness({ provisioning } = {}) {
  const store = new SitesStore(makeDb());
  const target = environmentSite({ ownerUserId: 1, projectId: 7 });
  store.insertSite(target);
  const calls = [];
  const handlers = createApiHandlers({
    store,
    access: { accountExists: () => true, isAdmin: () => false, canAccessProject: () => true },
    config: () => resolveConfig({ allowEnvironments: true }, 'https://elowen.example', 'sites.elowen.example'),
    people: () => new Map([[1, { id: 1, username: 'owner', name: 'Owner', avatar: '' }]]),
    projectSlug: () => 'demo', deleteSite: async () => {}, activateRelease: () => {},
    runtimeState: () => ({ running: false, logTail: '' }), allocatePort: async () => 43000, restartRuntime: async () => {},
    environmentState: async (site, actor) => {
      calls.push(['state', site.id, actor]);
      return {
        state: 'running', desiredState: site.environmentDesiredState, lastError: null,
        limits: { cpus: 1, memoryMb: 1024, pidsLimit: 512 },
      };
    },
    environmentAction: async (site, actor) => {
      calls.push(['action', site.id, actor]);
      return store.environmentAction(site.id);
    },
    environmentLogs: async (_site, lines, actor) => { calls.push(['logs', lines, actor]); return { lifecycle: 'life', journal: 'journal' }; },
    gatewayReadiness: async () => ({
      id: 'sites-gateway', label: 'Published sites gateway', ok: false, status: 'misdirected',
      detail: 'wrong target', observedTargets: ['203.0.113.5'],
    }),
    gatewayRecord: () => ({ type: 'CNAME', name: '*.sites.elowen.example', value: 'elowen.example.' }),
    requestEnvironmentControl: async (site, action, actor) => {
      calls.push(['control', site.id, action, actor]);
      store.updateSite(site.id, { environmentDesiredState: action === 'stop' ? 'stopped' : action === 'restart' ? 'restarting' : 'running' });
    },
    snapshotEnvironment: async (site, input, actor) => {
      calls.push(['snapshot', site.id, input, actor]);
      const publicId = 'snap-api';
      if (!store.beginEnvironmentAction({ siteId: site.id, kind: 'snapshot', snapshotId: publicId, includeData: input.includeData, note: input.note, model: 'm', requestedAt: iso(), lastError: null })) {
        throw new Error('action pending');
      }
      return { id: publicId };
    },
    rollbackEnvironment: async (site, input, actor) => {
      calls.push(['rollback', site.id, input, actor]);
      if (!store.beginEnvironmentAction({ siteId: site.id, kind: 'rollback', snapshotId: input.releaseId, restoreData: input.restoreData, requestedAt: iso(), lastError: null })) {
        throw new Error('action pending');
      }
    },
    applyEnvironmentLimits: async (site, limits, actor) => { calls.push(['limits', site.id, limits, actor]); store.updateSite(site.id, limits); },
    projectEnvironment: async (projectId, actor) => { calls.push(['project-environment', projectId, actor]); return { state: 'running', lastError: null }; },
    provisioning: provisioning ?? { status: async () => ({ ready: true, items: [] }), provision: async () => ({ ready: true, items: [] }) },
    migration: { status: () => null, prepare: async () => null, flip: async () => null, complete: async () => null, rollback: async () => null, pending: () => [], registerRecipe: async () => null },
  });
  return { store, handlers, calls };
}

test('gateway readiness API returns only sanitized status and expected record fields', async () => {
  const { handlers } = phase2ApiHarness();
  const response = await handlers.gatewayReadiness(apiRequest());
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    ready: false,
    status: 'misdirected',
    detail: 'wrong target',
    expectedRecord: { type: 'CNAME', name: '*.sites.elowen.example', value: 'elowen.example.' },
    observedTargets: ['203.0.113.5'],
  });
  assert.equal('gatewayToken' in response.body, false);
});

test('API environment detail, control, snapshot and rollback actions use durable seams', async () => {
  const { handlers, calls, store } = phase2ApiHarness();
  store.insertRelease({
    id: 'snap', siteId: SITE_ID, createdAt: iso(), model: 'm', fileCount: 0, sizeBytes: 0,
    note: '', kind: 'environment-snapshot', imageRef: `localhost/elowen-site/${SITE_ID}:snap`, dataArchive: null,
  });
  const detail = await handlers.site(apiRequest({ path: SITE_ID }));
  assert.equal(detail.status, 200);
  assert.equal(detail.body.environment.state, 'running');
  assert.equal(detail.body.site.runtime, 'environment');
  assert.equal(detail.body.environment.desiredState, 'running');
  assert.equal(detail.body.environment.limits.memoryMb, 1024);
  assert.deepEqual(detail.body.environment.limitOverrides, { cpus: null, memoryMb: null, pidsLimit: null });
  assert.equal(detail.body.environment.canControl, true);
  assert.equal(detail.body.environment.canSetLimits, false);
  assert.equal(detail.body.environment.transport.requestBodyLimitBytes, 1024 * 1024);
  assert.equal(detail.body.releases[0].kind, 'environment-snapshot');
  assert.equal(detail.body.releases[0].includesData, false);
  assert.equal(detail.body.releases[0].imageRef, undefined, 'provider image references never leak through the API');
  assert.equal(detail.body.releases[0].dataArchive, undefined, 'provider archive paths never leak through the API');
  const logs = await handlers.site(apiRequest({ path: `${SITE_ID}/logs`, query: { lines: '9000' } }));
  assert.equal(logs.status, 200);
  assert.deepEqual(logs.body, { lifecycle: 'life', journal: 'journal', lines: 1000 });
  // Not consuming: the full ordered sequence is asserted at the end of this test.
  assert.deepEqual(calls.filter(([name]) => name === 'logs'), [['logs', 1000, 1]]);

  assert.equal((await handlers.site(apiRequest({ method: 'POST', path: `${SITE_ID}/control`, body: { action: 'restart' } }))).status, 200);
  store.updateSite(SITE_ID, { environmentDesiredState: 'running' });
  assert.equal((await handlers.site(apiRequest({ method: 'POST', path: `${SITE_ID}/snapshot`, body: { includeData: true } }))).status, 200);
  store.updateEnvironmentActionError(SITE_ID, 'api snapshot failed');
  const pending = await handlers.site(apiRequest({ path: SITE_ID }));
  assert.equal(pending.body.environment.action.lastError, 'api snapshot failed', 'the pending projection is exposed for display');
  store.deleteEnvironmentAction(SITE_ID);
  store.updateSite(SITE_ID, { environmentDesiredState: 'running' });
  assert.equal((await handlers.site(apiRequest({ method: 'POST', path: `${SITE_ID}/rollback`, body: { releaseId: 'snap', restoreData: false } }))).status, 200);
  assert.deepEqual(calls.map(([name]) => name), ['state', 'action', 'logs', 'control', 'snapshot', 'state', 'action', 'rollback']);
});

test('API environment routes refuse a proxy publication with a 409 code instead of an empty environment', async () => {
  // A proxy publication has no site environment at all: the application runs in its Project. Answering
  // 200 with a hollow environment block is what this replaces — the UI would draw start, stop, restart,
  // snapshots, logs and limits for a container that does not exist.
  const { handlers, store, calls } = phase2ApiHarness();
  const proxyId = 'proxy-api';
  store.insertSite(environmentSite({
    id: proxyId, slug: 'proxy-a1b2c3', ownerUserId: 9, projectId: 7, kind: 'proxy', target: '3000',
    runtime: 'static', status: 'live', currentReleaseId: null,
  }));

  const detail = await handlers.site(apiRequest({ path: proxyId, admin: true }));
  assert.equal(detail.status, 200);
  assert.equal(detail.body.site.kind, 'proxy');
  assert.equal(detail.body.site.target, '3000');
  assert.equal(detail.body.environment, null, 'no environment block is projected for a proxy publication');
  assert.deepEqual(detail.body.projectEnvironment, { state: 'running', lastError: null });
  assert.deepEqual(calls, [['project-environment', 7, 1]], 'the Project environment is read for the current manager, even after the owner account is gone');

  for (const request of [
    { method: 'POST', path: `${proxyId}/control`, body: { action: 'restart' } },
    { method: 'POST', path: `${proxyId}/snapshot`, body: { includeData: true } },
    { method: 'POST', path: `${proxyId}/rollback`, body: { releaseId: 'snapshot' } },
    { path: `${proxyId}/logs` },
  ]) {
    const response = await handlers.site(apiRequest({ ...request, admin: true }));
    assert.equal(response.status, 409, `${request.method ?? 'GET'} ${request.path}`);
    assert.equal(response.body.code, 'publication_no_site_environment');
    assert.match(String(response.body.detail), /Sandbox plugin/);
  }

  // The limits PATCH is administrator-only, and its refusal names the environment that owns the limits.
  const limits = await handlers.site(apiRequest({ method: 'PATCH', path: proxyId, admin: true, body: { environmentMemoryMb: 2048 } }));
  assert.equal(limits.status, 409);
  assert.equal(limits.body.code, 'publication_no_site_environment');
  assert.deepEqual(calls.filter(([name]) => ['control', 'snapshot', 'logs', 'limits'].includes(name)), [],
    'nothing reached a runtime seam for a publication that has none');
});

test('API rollback refuses an unverified /data replacement before scheduling anything', async () => {
  const { handlers, calls, store } = phase2ApiHarness();
  store.insertRelease({
    id: 'snap', siteId: SITE_ID, createdAt: iso(), model: 'm', fileCount: 0, sizeBytes: 0,
    note: '', kind: 'environment-snapshot', imageRef: `localhost/elowen-site/${SITE_ID}:snap`, dataArchive: null,
  });
  const refused = await handlers.site(apiRequest({ method: 'POST', path: `${SITE_ID}/rollback`, body: { releaseId: 'snap', restoreData: true } }));
  assert.equal(refused.status, 400);
  assert.equal(store.environmentAction(SITE_ID), null);
  assert.deepEqual(calls.filter(([name]) => name === 'rollback'), []);

  store.putRuntimeRecord(SITE_ID, 'snapshot-data:snap', 'true');
  const verified = await handlers.site(apiRequest({ method: 'POST', path: `${SITE_ID}/rollback`, body: { releaseId: 'snap', restoreData: true } }));
  assert.equal(verified.status, 200);
  assert.equal(verified.body.scheduled, true);
});

test('API environment limit overrides are admin-only and persist through the apply seam', async () => {
  const { handlers, store, calls } = phase2ApiHarness();
  const owner = await handlers.site(apiRequest({ method: 'PATCH', path: SITE_ID, body: { environmentMemoryMb: 2048 } }));
  assert.equal(owner.status, 403);
  assert.equal(store.siteById(SITE_ID).environmentMemoryMb, null);

  const invalidMixed = await handlers.site(apiRequest({ method: 'PATCH', path: SITE_ID, admin: true, body: {
    environmentMemoryMb: 2048, visibility: 'mystery',
  } }));
  assert.equal(invalidMixed.status, 400);
  assert.equal(calls.some(([name]) => name === 'limits'), false);
  assert.equal(store.siteById(SITE_ID).environmentMemoryMb, null);

  const admin = await handlers.site(apiRequest({ method: 'PATCH', path: SITE_ID, admin: true, body: {
    environmentCpus: 99, environmentMemoryMb: 64, environmentPidsLimit: 2,
  } }));
  assert.equal(admin.status, 200);
  assert.deepEqual(calls.find(([name]) => name === 'limits'), ['limits', SITE_ID, {
    environmentCpus: 8, environmentMemoryMb: 128, environmentPidsLimit: 16,
  }, 1]);
});

test('provisioning API is admin-only, guards concurrency and handles an old core', async () => {
  const oldCore = new EnvironmentProvisioningService({
    control: () => undefined,
    imageExists: async () => false,
    buildImage: async () => {},
  });
  const unavailable = await oldCore.status();
  assert.equal(unavailable.ready, false);
  assert.match(unavailable.detail, /0\.28\.31|unavailable/i);
  assert.equal((await new EnvironmentProvisioningService({
    control: () => ({}), imageExists: async () => true, buildImage: async () => {},
  }).status()).ready, false);
  const missingImage = await new EnvironmentProvisioningService({
    control: () => ({
      environmentsStatus: async () => ({ ready: true, items: [] }),
      provisionEnvironments: async () => ({ ready: true, items: [] }),
    }),
    imageExists: async () => false,
    buildImage: async () => {},
  }).status();
  assert.equal(missingImage.ready, false);
  assert.equal(missingImage.items.find((item) => item.id === 'base-image').ok, false);

  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  let provisions = 0;
  let imageReady = false;
  let builds = 0;
  const audits = [];
  const service = new EnvironmentProvisioningService({
    control: () => ({
      provisionEnvironments: async () => { provisions += 1; await pending; return { ready: true, items: [] }; },
      environmentsStatus: async () => ({ ready: true, items: [{ id: 'podman', label: 'Podman', ok: true }] }),
    }),
    imageExists: async () => imageReady,
    buildImage: async () => { builds += 1; imageReady = true; },
    audit: (status, actorUserId) => audits.push({ status, actorUserId }),
  });
  const { handlers } = phase2ApiHarness({ provisioning: service });
  const ownerReadiness = await handlers.environmentsReadiness(apiRequest({ admin: false }));
  assert.equal(ownerReadiness.status, 200);
  assert.equal(ownerReadiness.body.canProvision, false);
  assert.equal(ownerReadiness.body.items.find((item) => !item.ok).detail, 'An administrator must complete this dependency.');
  assert.equal((await handlers.environmentsReadiness(apiRequest({ admin: true }))).body.canProvision, true);
  assert.equal((await handlers.environmentsProvision(apiRequest({ method: 'POST', admin: false }))).status, 403);
  const first = handlers.environmentsProvision(apiRequest({ method: 'POST', admin: true }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await handlers.environmentsProvision(apiRequest({ method: 'POST', admin: true }))).status, 409);
  release();
  const completed = await first;
  assert.equal(completed.status, 200);
  assert.equal(completed.body.ready, true);
  assert.equal(completed.body.canProvision, true);
  assert.equal(provisions, 1);
  assert.equal(builds, 1);
  assert.equal(completed.body.items.find((item) => item.id === 'base-image').ok, true);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].actorUserId, 1);

  const failedAudits = [];
  const failed = new EnvironmentProvisioningService({
    control: () => ({
      provisionEnvironments: async () => { throw new Error('package failure'); },
      environmentsStatus: async () => ({ ready: false, items: [] }),
    }),
    imageExists: async () => false,
    buildImage: async () => {},
    audit: (status) => failedAudits.push(status),
  });
  await assert.rejects(() => failed.provision(9), /package failure/);
  assert.equal(failedAudits.length, 1);
  assert.match(failedAudits[0].detail, /package failure/);

  const buildAudits = [];
  const buildFailure = new EnvironmentProvisioningService({
    control: () => ({
      provisionEnvironments: async () => ({ ready: true, items: [] }),
      environmentsStatus: async () => ({
        ready: true,
        detail: 'Core dependencies are ready.',
        items: [{ id: 'podman', label: 'Podman', ok: true, detail: 'Rootless Podman is available.' }],
      }),
    }),
    imageExists: async () => false,
    buildImage: async () => { throw new Error('base build failed'); },
    audit: (status) => buildAudits.push(status),
  });
  const buildStatus = await buildFailure.provision(9);
  assert.equal(buildStatus.ready, false);
  assert.match(buildStatus.detail, /base build failed/);
  assert.equal(buildStatus.items.find((item) => item.id === 'podman').ok, true);
  assert.equal(buildStatus.items.find((item) => item.id === 'base-image').ok, false);
  assert.deepEqual(buildAudits[0], buildStatus);
});

// --- Ingress proxy -------------------------------------------------------------------------------

test('environment proxy strips forged forwarding headers and writes only verified values', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'sites-environment-proxy-'));
  const socketPath = join(root, 'app.sock');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  let received;
  const server = createHttpServer((req, response) => {
    received = req.headers;
    response.end('ok');
  });
  await new Promise((resolve) => server.listen(socketPath, resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); });

  await proxyToEnvironment(
    { kind: 'socket', path: socketPath },
    {
      method: 'GET', path: '', query: {}, remoteAddress: '203.0.113.7',
      headers: {
        host: 'environment-demo.sites.example.test',
        forwarded: 'for=attacker;proto=http;host=evil.test',
        'x-forwarded-for': '198.51.100.99',
        'x-forwarded-host': 'evil.test',
        'x-forwarded-proto': 'http',
        'x-forwarded-port': '81',
      },
      body: async () => Buffer.alloc(0),
    },
    '',
    { userId: null, name: null },
    { maxResponseBytes: 1024, requestTimeoutSeconds: 1 },
    'https://environment-demo.sites.example.test/',
  );
  assert.equal(received.forwarded, undefined);
  assert.equal(received['x-forwarded-for'], '203.0.113.7');
  assert.equal(received['x-forwarded-host'], 'environment-demo.sites.example.test');
  assert.equal(received['x-forwarded-proto'], 'https');
  assert.equal(received['x-forwarded-port'], undefined);
  assert.equal(received.host, 'environment-demo.sites.example.test');
});

test('environment proxy never trusts forged client address when core exposes none', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'sites-environment-proxy-anon-'));
  const socketPath = join(root, 'app.sock');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  let received;
  const server = createHttpServer((req, response) => { received = req.headers; response.end('ok'); });
  await new Promise((resolve) => server.listen(socketPath, resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); });
  await proxyToEnvironment(
    { kind: 'socket', path: socketPath },
    {
      method: 'GET', path: '', query: {},
      headers: { host: 'environment-demo.sites.example.test', 'x-forwarded-for': '198.51.100.99' },
      body: async () => Buffer.alloc(0),
    },
    '', { userId: null, name: null }, { maxResponseBytes: 1024, requestTimeoutSeconds: 1 },
    'https://environment-demo.sites.example.test/',
  );
  assert.equal(received['x-forwarded-for'], undefined);
});

test('environment requests use the environment endpoint without the host CSP', async () => {
  const target = environmentSite();
  const handler = createSiteHandler({
    store: { siteBySlug: () => target, takeTicket: () => null },
    access: { accountExists: () => true, isAdmin: () => false, canAccessProject: () => true },
    secret: () => 'secret',
    config: () => ({ siteHostBase: 'sites.example.test', siteScheme: 'https:', appBaseUrl: 'https://example.test', sessionTtlHours: 12, gatewayToken: 'marker' }),
    releaseDir: () => '/unused',
    countHit: () => {},
    endpointFor: () => ({ kind: 'socket', path: '/run/fake.sock' }),
    proxyLimits: () => ({ maxResponseBytes: 1024, requestTimeoutSeconds: 1 }),
    usernameOf: () => null,
    executePhp: async () => { throw new Error('unused'); },
    proxyEnvironment: async () => ({ status: 200, headers: { 'content-type': 'text/plain', 'content-security-policy': 'app-policy' }, body: 'ok' }),
  });
  const response = await handler({
    method: 'GET', path: 'environment-demo/', query: {},
    headers: { host: 'environment-demo.sites.example.test', 'x-elowen-site-gateway': 'marker' },
    body: async () => Buffer.alloc(0),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers['content-security-policy'], 'app-policy');
  assert.equal(response.headers['cache-control'], 'public, max-age=0');
});

// --- Base image contract -------------------------------------------------------------------------

test('base image contents are digest-pinned, deterministic and use the stable app socket', () => {
  assert.equal(BASE_IMAGE_SOURCE, 'docker.io/library/debian:bookworm-slim@sha256:88200866dfff7ea7f5cbcb6ec7c8a701889efe6fe859fe64d6990e4b07ea4171');
  assert.match(BASE_IMAGE_TAG, /^localhost\/elowen-site-base:[a-f0-9]{16}$/);
  assert.ok(CONTAINERFILE.startsWith(`FROM ${BASE_IMAGE_SOURCE}\n`));
  assert.doesNotMatch(CONTAINERFILE, /^FROM debian:bookworm-slim$/m);
  for (const dependency of ['systemd', 'systemd-sysv', 'dbus', 'ca-certificates', 'curl', 'iproute2', 'procps']) {
    assert.match(CONTAINERFILE, new RegExp(`\\b${dependency.replace('-', '\\-')}\\b`));
  }
  assert.match(CONTAINERFILE, /ENTRYPOINT \["\/sbin\/init"\]/);
  assert.match(INGRESS_SOCKET, /ListenStream=\/run\/elowen\/app\.sock/);
  assert.match(INGRESS_SERVICE, /systemd-socket-proxyd 127\.0\.0\.1:80/);
  assert.doesNotMatch(`${CONTAINERFILE}\n${INGRESS_SOCKET}\n${INGRESS_SERVICE}`, /\/run\/elowen\/ingress\.sock/);
});