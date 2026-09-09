// Test fixtures for the Sites-owned environment supervisor against the CURRENT SiteEnvironmentControl
// SDK seam (SITE_ENVIRONMENT_CONTROL_METHODS in elowen/plugin-api). The lower container lifecycle belongs
// to the Sandbox provider, so the fake control below models the exact typed SDK surface — never a local
// Podman client and never a second caller-side lifecycle loop. The supervisor is the real production
// class; everything here runs on private temporary data — no real Podman, no account-default storage and
// no privileged gateway helper are touched.

import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { EnvironmentSupervisor } from '../../plugins/sites/dist/environment.js';

export const SITE_ID = '123e4567-e89b-12d3-a456-426614174000';

export const environmentSite = (overrides = {}) => ({
  id: SITE_ID,
  slug: 'environment-demo',
  title: 'Environment demo',
  summary: '',
  projectId: 1,
  ownerUserId: 7,
  visibility: 'public',
  accessGeneration: 1,
  sourceDir: '/workspace/project',
  spa: false,
  runtime: 'environment',
  unsupportedRuntime: null,
  startCommand: '',
  bind: 'socket',
  port: null,
  environmentCpus: null,
  environmentMemoryMb: null,
  environmentPidsLimit: null,
  environmentDiskSoftMb: null,
  environmentDesiredState: 'running',
  status: 'live',
  currentReleaseId: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  createdModel: 'test/model',
  lastPublishAt: null,
  lastPublishModel: null,
  lastError: null,
  ...overrides,
});

const environmentConfig = (overrides = {}) => ({
  startTimeoutSeconds: 1,
  environmentNetwork: 'shared',
  environmentCpus: 1,
  environmentMemoryMb: 1024,
  environmentPidsLimit: 512,
  environmentDiskSoftMb: 4096,
  releasesKept: 5,
  ...overrides,
});

// ---------------------------------------------------------------------------
// In-memory store covering exactly the SitesStore surface EnvironmentSupervisor uses.

function sitesSdkStore(site, overrides = {}) {
  const records = new Map();
  const releases = [];
  let action = null;
  let execLease = null;
  const store = {
    siteById: (id) => (id === site.id ? site : null),
    allSites: () => [site],
    liveEnvironmentSites: () => [site],
    environmentSitesForReconcile: () => [site],
    runtimeMigration: () => null,
    conversionSuspends: () => null,
    runtimeRecord: (id, key) => records.get(`${id}:${key}`) ?? null,
    runtimeRecords: (id, prefix) => [...records]
      .filter(([key]) => key.startsWith(`${id}:${prefix}`))
      .map(([key, value]) => ({ key: key.slice(id.length + 1), value })),
    putRuntimeRecord: (id, key, value) => { records.set(`${id}:${key}`, value); },
    claimRuntimeRecord: (id, key, value) => {
      const key2 = `${id}:${key}`;
      if (records.has(key2)) return false;
      records.set(key2, value);
      return true;
    },
    compareRuntimeRecord: (id, key, expected, value) => {
      const key2 = `${id}:${key}`;
      if (records.get(key2) !== expected) return false;
      records.set(key2, value);
      return true;
    },
    deleteRuntimeRecord: (id, key) => { records.delete(`${id}:${key}`); },
    releases: () => releases,
    release: (id, releaseId) => releases.find((release) => release.siteId === id && release.id === releaseId) ?? null,
    insertRelease: (release) => releases.unshift(release),
    deleteRelease: (_id, releaseId) => {
      const index = releases.findIndex((release) => release.id === releaseId);
      if (index >= 0) releases.splice(index, 1);
    },
    updateSite: (_id, patch) => Object.assign(site, patch),
    environmentAction: () => action,
    /** Claims the visible action row for a newly scheduled action. Exclusive against a clean pending
     * row or an active execution lease; only an errored row may be replaced. Durable before dispatch. */
    beginEnvironmentAction: (next) => {
      if (execLease) return false;
      if (action && action.lastError === null) return false;
      action = { ...next };
      return true;
    },
    updateEnvironmentActionError: (_id, error) => { if (action) action.lastError = error; },
    deleteEnvironmentAction: () => { action = null; },
    tryBeginEnvironmentExec: (_id, token) => {
      if (execLease || action) return false;
      execLease = token;
      return true;
    },
    endEnvironmentExec: (_id, token) => { if (execLease === token) execLease = null; },
    transaction: (fn) => fn(),
    ...overrides,
  };
  return store;
}

// ---------------------------------------------------------------------------
// A fake EXACT SiteEnvironmentControl. It models the provider behaviour the SDK contract promises:
// lifecycle actions move the durable desired state, the runtime invokes the Sites authority callbacks
// around container create/start/stop, and snapshot operations complete with a provider-side snapshot id.

function sitesSdkControl({
  state = 'stopped',
  desiredState = 'stopped',
  generation = 1,
  discover = null,
  snapshots = [],
  authorityLifecycle = true,
  onStart = null,
  /** What the durable runtime row reports as its own failure, so a test can model a container that never
   *  came up rather than only the healthy and stopped states. */
  lastError = null,
  /** Every start attempt leaves the runtime `failed` with intent `running`. */
  failStart = false,
} = {}) {
  const requests = [];
  const operations = new Map();
  const execCalls = [];
  const logCalls = [];
  let sequence = 0;
  let current = { state, desiredState };
  const created = new Set();

  const apply = (action, siteId, authority) => {
    switch (action.kind) {
      case 'start':
      case 'restart': {
        if (authorityLifecycle) {
          if (!created.has(siteId)) {
            created.add(siteId);
            // First start of a generation performs the container creation, which is where the trusted
            // Sites handover callback runs (environment files + ingress directory preparation).
            authority?.beforeCreate?.(siteId);
          }
          authority?.beforeStart(siteId);
        }
        // A container create that cannot be satisfied leaves the durable row `failed` while intent stays
        // `running` — the production shape when a bind source is missing. Without this the fake could only
        // model healthy and stopped, which is why a stale `live` Site row had no test at all.
        if (failStart) { current = { state: 'failed', desiredState: 'running' }; break; }
        current = { state: 'running', desiredState: 'running' };
        onStart?.(siteId);
        break;
      }
      case 'stop':
        if (authorityLifecycle) authority?.afterStop(siteId);
        current = { state: 'stopped', desiredState: 'stopped' };
        break;
      case 'restore':
        // Restoring reads a retained snapshot and never consumes it, so the id the request names is
        // retained both before and after. A runtime that did not retain it could not have restored it.
        if (action.snapshotId && !snapshots.some((snapshot) => snapshot.id === action.snapshotId)) {
          snapshots.push({ id: action.snapshotId, generation, createdAt: new Date().toISOString(), consistency: 'crash-consistent', completeProject: false, note: '' });
        }
        break;
      case 'delete':
      case 'cleanup-stage':
        if (authorityLifecycle) authority?.afterStop(siteId);
        current = { state: 'deleted', desiredState: 'deleted' };
        break;
      default:
        break;
    }
  };

  const control = {
    authority: null,
    requests,
    execCalls,
    logCalls,
    snapshots,
    operations,
    get state() { return current.state; },
    view(siteId) {
      return {
        siteId, generation, state: current.state, desiredState: current.desiredState,
        limits: { cpus: 1, memoryMb: 1024, pidsLimit: 512, diskSoftMb: 4096 }, lastError,
      };
    },
    connectSitesRuntime(authority) { control.authority = authority; },
    async discoverSiteEnvironment() { return typeof discover === 'function' ? discover() : discover; },
    async registerSiteEnvironment({ siteId }) {
      created.delete(siteId);
      return control.view(siteId);
    },
    async siteEnvironmentFor({ siteId }) { return control.view(siteId); },
    async requestSiteEnvironment(input) {
      requests.push(input);
      sequence += 1;
      const id = `op-${sequence}`;
      const snapshotId = input.action.kind === 'snapshot' ? `runtime-snapshot-${sequence}` : null;
      const operation = {
        id,
        requestId: input.requestId,
        siteId: input.siteId,
        accountUserId: input.accountUserId,
        generation: input.generation,
        action: input.action,
        status: 'succeeded',
        error: null,
        ...(snapshotId ? { snapshotId } : {}),
      };
      operations.set(id, operation);
      // A snapshot operation the provider reports as succeeded has RETAINED that snapshot, so it is
      // listed from here on. Without it a replayed dispatch would report an id the runtime then denies.
      if (snapshotId) snapshots.push({ id: snapshotId, generation: input.generation, createdAt: new Date().toISOString(), consistency: 'crash-consistent', completeProject: input.action.includeData === true, note: input.action.note ?? '' });
      apply(input.action, input.siteId, control.authority);
      return operation;
    },
    async siteEnvironmentOperation({ operationId }) { return operations.get(operationId) ?? null; },
    async siteEnvironmentExec(input) {
      execCalls.push(input);
      return { stdout: 'exec-ok', stderr: '', code: 0, truncated: false };
    },
    async siteEnvironmentLogs(input) {
      logCalls.push(input);
      return { lifecycle: 'life', journal: 'journal' };
    },
    async siteEnvironmentSnapshots() { return control.snapshots; },
  };
  return control;
}

// ---------------------------------------------------------------------------

/** The broker app socket a started environment must present before Sites adopts the ingress. */
function brokerSocketTracker(t, socketPath) {
  const servers = [];
  t.after(async () => {
    await Promise.all(servers.map((server) => new Promise((resolveClose) => server.close(resolveClose))));
  });
  return () => {
    mkdirSync(join(socketPath, '..'), { recursive: true });
    const server = createServer();
    servers.push(server);
    return new Promise((resolveListen) => server.listen(socketPath, resolveListen));
  };
}

export async function sitesSdkHarness(t, {
  site = environmentSite(),
  controlState = 'stopped',
  control: controlOptions = {},
  store: storeOverrides = {},
  config: configOverrides = {},
  access = { accountExists: () => true, isAdmin: () => false, canAccessProject: () => true },
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sites-owned-sdk-'));
  t.after(() => {
    // Readiness seals the broker directory to 0510; restore permissions so the private root is removable.
    try { chmodSync(brokerDir, 0o700); } catch { /* may not exist */ }
    rmSync(root, { recursive: true, force: true });
  });
  const brokerDir = join(root, 'broker', site.id);
  const socketPath = join(brokerDir, 'app.sock');
  const gateway = {
    ops: [],
    async prepareRuntimeSocket(siteId) {
      gateway.ops.push(['prepare', siteId]);
      mkdirSync(brokerDir, { recursive: true });
      return { path: socketPath };
    },
    async sealRuntimeSocket(siteId) {
      gateway.ops.push(['seal', siteId]);
      chmodSync(brokerDir, 0o510);
    },
    async removeRuntimeSocket(siteId) {
      gateway.ops.push(['remove', siteId]);
      try { chmodSync(brokerDir, 0o700); } catch { /* may not exist yet */ }
      rmSync(brokerDir, { recursive: true, force: true });
    },
  };
  const store = sitesSdkStore(site, storeOverrides);
  const control = sitesSdkControl({ state: controlState, onStart: brokerSocketTracker(t, socketPath), ...controlOptions });
  const supervisor = new EnvironmentSupervisor({
    control: () => control,
    store,
    access,
    dataDir: join(root, 'data'),
    gateway,
    config: () => environmentConfig(configOverrides),
    // The REAL plugin layout: index.ts derives `siteDir` as `<dataDir>/sites/<id>`, so the source root
    // sits INSIDE the same dataDir that Sandbox receives as `sitesDataDir`. The previous fixture put it
    // in an unrelated `<root>/site/<id>` tree, which made writing the container contract at
    // `siteDir/environment` look correct in tests while production wrote it one level too deep and every
    // container create failed lstat-ing its git-stub bind source.
    siteDir: (id) => join(root, 'data', 'sites', id),
    siteUrl: () => null,
    accountUserId: () => 7,
    brokerPath: () => socketPath,
  });
  return { supervisor, control, store, site, gateway, socketPath, brokerDir, root };
}

/** A release row shaped the way Sites records environment snapshots. */
export const snapshotRelease = (site, overrides = {}) => ({
  id: 'snap-1', siteId: site.id, createdAt: new Date().toISOString(), model: 'm', fileCount: 0,
  sizeBytes: 0, note: '', kind: 'environment-snapshot', imageRef: `localhost/elowen-site/${site.id}:snap-1`,
  dataArchive: null, ...overrides,
});

/** Mode bits of a path, for the read-only git stub assertions. */
export const modeOf = (path) => statSync(path).mode & 0o777;