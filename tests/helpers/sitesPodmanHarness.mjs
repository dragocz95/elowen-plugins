// The runtime conversion exercised through the WHOLE plugin route, the real Sites store, the real
// data-sync tars and real HTTP over the sealed ingress socket — with the container lifecycle behind
// its one SDK seam, `SiteEnvironmentControl` (elowen/plugin-api).
//
// WHY THERE IS NO PODMAN CLIENT HERE ANY MORE. Sites no longer owns a container driver: discovery,
// provisioning, start/stop, snapshots and data-volume import/export belong to the Sandbox provider, and
// Sites talks to it only through the typed SDK control. So the harness plugs a provider into that exact
// seam and the conversion flow runs against it exactly as production runs it.
//
// TWO PROVIDERS, ONE SUITE.
//
// - Default: a PRIVATE provider stand-in that models the SDK contract in process — durable desired
//   state, the Sites authority callbacks around container create/start/stop, staging-only data import,
//   and a private per-site directory standing in for the container's data volume. The container's
//   application is a stand-in process bound to the same broker socket the real ingress uses. Everything
//   is private temporary data: no Podman, no account-default storage, no privileged gateway helper.
//
// - SITES_PODMAN_E2E=1: the REAL provider, loaded from the LINKED elowen package (never a private
//   worktree path), with a private isolated Podman namespace created by the runtime's own
//   `isolatedPodmanOptions` under an mkdtemp root. The account engine is never touched, and there is no
//   fallback to an account engine or to the old Sites driver: if the linked SDK does not ship the
//   managed environment provider yet, the suite fails naming exactly what is missing, because a silent
//   skip would hide the integration this suite exists to prove.
//
// The gateway is NOT the privileged helper: `testGateway` below reproduces the helper's three socket
// operations — rm -rf then mkdir 0730 on prepare, chmod 0510 plus an lstat socket check on seal, rm -rf
// on remove — with one unavoidable deviation named at its call site: the helper chowns the directory to
// root and an unprivileged test cannot, so the mode is applied without the ownership change.

import Database from 'better-sqlite3';
import { createServer, globalAgent, request } from 'node:http';
import {
  chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { SitesStore } from '../../plugins/sites/dist/store.js';
import { MigrationRefused, RuntimeMigrationService, stagedWorkspace } from '../../plugins/sites/dist/migration.js';
import { DataSyncService, migrationArtifactDir, validateLegacyHome } from '../../plugins/sites/dist/dataSync.js';
import { EnvironmentSupervisor } from '../../plugins/sites/dist/environment.js';
import { SpawnExecutor } from '../../plugins/sites/dist/podman.js';
import { createApiHandlers } from '../../plugins/sites/dist/api.js';
import { conversionImageTag } from '../../plugins/sites/dist/conversionImage.js';
import {
  installAppRecipe, loadAppRecipe, recipeBinding, relaxStaticServingPermissions,
} from '../../plugins/sites/dist/recipe.js';

/** Container work is minutes, not milliseconds; the stand-in provider finishes in seconds. */
const SLOW_MS = 300_000;

const RELEASE_ID = 'rel-live-0001';
const OWNER = 7;

/** The real engine is opt-in and stays opt-in. */
const realEngineRequested = () => process.env.SITES_PODMAN_E2E === '1';

const makeDb = () => {
  const db = new Database(':memory:');
  let version = 0;
  const handle = { exec: (sql) => db.exec(sql), prepare: (sql) => db.prepare(sql) };
  return {
    ...handle,
    migrate: (steps) => {
      for (const step of steps) {
        if (step.version <= version) continue;
        step.up(handle);
        version = step.version;
      }
    },
    transaction: (fn) => db.transaction(fn)(),
  };
};

const site0 = (overrides = {}) => ({
  id: randomUUID(),
  slug: 'conv-demo',
  title: 'Conversion demo',
  summary: '',
  projectId: 2,
  ownerUserId: 7,
  visibility: 'private',
  accessGeneration: 4,
  sourceDir: '/unused/source',
  spa: false,
  runtime: 'static',
  unsupportedRuntime: null,
  startCommand: '',
  bind: 'socket',
  port: null,
  environmentCpus: 0.5,
  environmentMemoryMb: 256,
  environmentPidsLimit: 256,
  environmentDesiredState: 'running',
  status: 'live',
  currentReleaseId: RELEASE_ID,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  createdModel: '',
  lastPublishAt: null,
  lastPublishModel: null,
  lastError: null,
  ...overrides,
});

const release0 = (siteId) => ({
  id: RELEASE_ID,
  siteId,
  createdAt: '2026-01-01T00:00:00.000Z',
  model: '',
  fileCount: 1,
  sizeBytes: 20,
  note: '',
  kind: 'files',
  imageRef: null,
  dataArchive: null,
});

/** One HTTP request over a Unix socket, so a cutover is proven by an answer rather than by a status.
 *  The request socket is destroyed after the answer: the default keep-alive pool would otherwise leave
 *  the socket behind and hold the test process open after the run. */
const httpOverSocket = (socketPath, path) => new Promise((resolve, reject) => {
  const req = request({ socketPath, path, method: 'GET', timeout: 5_000 }, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => { resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }); req.socket?.destroy(); });
  });
  req.once('error', (error) => { req.socket?.destroy(); reject(error); });
  req.once('timeout', () => { req.destroy(new Error('socket request timed out')); });
  req.end();
});

/** The same request, retried through the start-up window.
 *
 *  The ingress socket is listening from boot, so the first requests after a cutover are reset while the
 *  application behind it is still coming up — the same window `probeReadiness` exists to wait through.
 *  Only transport failures are retried; an answer, of any status, is returned as it is. */
const httpOverSocketWhenUp = async (socketPath, path, { tries = 60, everyMs = 500 } = {}) => {
  let last;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    try { return await httpOverSocket(socketPath, path); }
    catch (error) { last = error; }
    await new Promise((resolve) => { setTimeout(resolve, everyMs); });
  }
  throw last ?? new Error('the ingress socket never answered');
};

/** The privileged helper's socket operations, reproduced in a directory this test owns. */
const testGateway = (brokerRoot, calls) => ({
  async prepareRuntimeSocket(siteId) {
    calls.prepare.push(siteId);
    const dir = join(brokerRoot, siteId);
    // The helper runs as root, so it can rm a directory it previously sealed to 0510. This test owns the
    // directory as the service account, so it restores write permission before removing it. That is the
    // ONE deviation from the helper, and it is a privilege difference, never a path or mode relaxation.
    try { chmodSync(dir, 0o730); } catch { /* it may not exist yet */ }
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(brokerRoot, { recursive: true, mode: 0o755 });
    mkdirSync(dir, { mode: 0o730 });
    // The helper chowns to root:<service gid> here. Unprivileged, the directory is already owned by the
    // service account, so only the mode is applied.
    chmodSync(dir, 0o730);
    return { path: join(dir, 'app.sock') };
  },
  async sealRuntimeSocket(siteId) {
    calls.seal.push(siteId);
    const dir = join(brokerRoot, siteId);
    chmodSync(dir, 0o510);
    if (!lstatSync(join(dir, 'app.sock')).isSocket()) throw new Error('the runtime endpoint is not a Unix socket');
  },
  async removeRuntimeSocket(siteId) {
    calls.remove.push(siteId);
    const dir = join(brokerRoot, siteId);
    try { chmodSync(dir, 0o730); } catch { /* absent is the ordinary case */ }
    rmSync(dir, { recursive: true, force: true });
  },
});

const runTar = async (args) => {
  const result = await new SpawnExecutor().run('tar', args, {
    env: { PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' },
    timeoutMs: 120_000,
    outputLimitBytes: 1_048_576,
  });
  if (result.code !== 0) throw new Error(`tar ${args[0]} failed: ${result.stderr}`);
};

/** A stand-in for the container's ingress application, bound on the same Unix socket the real app
 *  answers on. Static sites serve the staged workspace the way the image's nginx does — regular files
 *  only, dotfiles refused, nothing outside the tree; the real-engine mode re-proves that against real
 *  nginx. Command apps come from the test, because only the test knows what its converted app does. */
const bindAppServer = (socketPath, handler) => new Promise((resolve, reject) => {
  const server = createServer(handler);
  server.once('error', reject);
  server.listen(socketPath, () => resolve({
    close: async () => {
      await new Promise((done) => server.close(done));
      // A sealed broker directory (0510) is read-execute for its owner, so the socket inside it cannot be
      // unlinked without restoring write permission first — the same privilege difference `testGateway`
      // already names; it changes no path and no mode on any other object.
      try { chmodSync(dirname(socketPath), 0o730); } catch { /* absent is the ordinary case */ }
      rmSync(socketPath, { force: true });
    },
  }));
});

const staticAppHandler = (workspace) => (req, res) => {
  const relative = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname)
    .replace(/^\/+/, '') || 'index.html';
  const segments = relative.split('/');
  if (segments.some((segment) => segment === '..' || segment.startsWith('.'))) {
    res.writeHead(404); res.end('no'); return;
  }
  const file = join(workspace, ...segments);
  try {
    if (!statSync(file).isFile()) throw new Error('not a regular file');
  } catch {
    res.writeHead(404); res.end('no'); return;
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(readFileSync(file));
};

/** A stand-in for the converted command app: the same SQLite-and-HTTP behaviour its container image
 *  runs, executed host-side against the private directory that stands in for the container's data
 *  volume. The test supplies `open`, which boots the app once per start (the container's systemd unit)
 *  and whose `close` runs when the runtime stops it, so a quiesced export reads a cleanly closed
 *  database, exactly as a stopped container would leave one. */
const defaultConvertedApp = () => ({
  open: () => {
    throw new Error('this suite needs a convertedApp stand-in to start a converted command app');
  },
});

/** The real provider, assembled exactly as `plugins/sandbox/index.mjs` assembles it, but rooted entirely
 *  in a private mkdtemp tree with a private isolated Podman namespace minted by the runtime's own
 *  `isolatedPodmanOptions`. Returns the typed `SiteEnvironmentControl`, wrapped so every request that
 *  crosses the seam is recorded for the suites' seam-level assertions. */
const realProvider = async ({ engineRoot, dataDir }) => {
  // Locate the provider from the LINKED elowen package, never from a private worktree path.
  const linked = dirname(fileURLToPath(import.meta.resolve('elowen/package.json')));
  const lib = (name) => join(linked, 'plugins', 'sandbox', 'lib', name);
  for (const name of ['environmentRuntime.mjs', 'podman.mjs', 'containerStorage.mjs', 'db.mjs']) {
    if (!existsSync(lib(name))) {
      throw new Error(
        `the real-engine Sites conversion suite needs the managed environment provider: the linked elowen SDK `
        + `does not ship plugins/sandbox/lib/${name} yet. Integrate the environments runtime provider first; `
        + 'the suite never falls back to an account engine or to the retired Sites driver.',
      );
    }
  }
  const [{ isolatedPodmanOptions, PodmanClient }, { ContainerStorage }, { initSandboxDb }, { createEnvironmentRuntime }] =
    await Promise.all([
      import(lib('podman.mjs')), import(lib('containerStorage.mjs')), import(lib('db.mjs')), import(lib('environmentRuntime.mjs')),
    ]);

  // The namespace and every storage location are private to this run. isolatedPodmanOptions demands a
  // fresh, exclusively created directory (and a short runroot path), hence the mkdtemp root.
  const namespace = `sites-${randomUUID().slice(0, 8)}`;
  const { isolation } = isolatedPodmanOptions(join(engineRoot, 'podman'), namespace);
  const podman = new PodmanClient({ outputLimitBytes: 16 * 1024 * 1024, isolation });
  // The provider's own database, private to this run, migrated through the same migrate() shape the
  // plugin context supplies.
  const dbFile = new Database(join(engineRoot, 'sandbox.db'));
  let migrationVersion = 0;
  const dbHandle = { exec: (sql) => dbFile.exec(sql), prepare: (sql) => dbFile.prepare(sql) };
  const db = {
    ...dbHandle,
    migrate: (steps) => {
      for (const step of steps) {
        if (step.version <= migrationVersion) continue;
        step.up(dbHandle);
        migrationVersion = step.version;
      }
    },
    transaction: (fn) => dbFile.transaction(fn)(),
  };
  const ctx = {
    host: { stores: () => ({
      usersRead: {
        list: () => [1, 7].map((id) => ({ id })),
        mayUsePlugin: (id, plugin) => plugin === 'sandbox' && (id === 1 || id === 7),
        isAdmin: (id) => id === 1,
      },
      projects: { get: (id) => ({ id, lifecycle: 'active', executionKind: 'managed' }) },
      userProjects: { canManage: () => true, canAccess: () => true },
    }) },
    currentAccountUserId: () => null,
    currentAccess: () => ({ readOnly: false, admin: false, workspaceRef: null, projectRef: null, projectIds: [] }),
    db: () => db,
  };
  initSandboxDb(ctx);
  const runtime = createEnvironmentRuntime({ ctx, db, dataDir, namespace, podman, storage: new ContainerStorage(podman) });
  const requests = [];
  const control = {
    ...runtime.control,
    async requestSiteEnvironment(input) { requests.push(input); return runtime.control.requestSiteEnvironment(input); },
  };
  return { control, requests, reconcile: () => runtime.reconcile(), dispose: () => runtime.dispose() };
};

/** The real plugin, wired exactly as `plugins/sites/src/index.ts` wires it, with the provider behind the
 *  typed SDK seam and a task-owned gateway. */
const podmanHarness = async ({ convertedApp } = {}) => {
  const realEngine = realEngineRequested();
  const root = mkdtempSync(join(tmpdir(), 'sites-conv-'));
  const brokerRoot = join(root, 'broker');
  const dataDir = join(root, 'plugin-data');
  const legacyHome = join(root, 'legacy-home');
  mkdirSync(brokerRoot, { recursive: true, mode: 0o755 });
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(legacyHome, { recursive: true });

  const store = new SitesStore(makeDb());
  const gatewayCalls = { prepare: [], seal: [], remove: [] };
  const gateway = testGateway(brokerRoot, gatewayCalls);
  const siteDir = (siteId) => join(root, 'sites', siteId);
  const releaseDir = (siteId, releaseId) => join(siteDir(siteId), 'releases', releaseId);
  const brokerPath = (siteId) => join(brokerRoot, siteId, 'app.sock');
  /** The private directory standing in for the container's persistent data volume. */
  const volumeDir = (siteId) => join(root, 'provider-volumes', siteId);

  // --- the provider behind the seam ----------------------------------------------------------------

  const rows = new Map();
  const operations = new Map();
  const apps = new Map();
  let sequence = 0;
  const limits = { cpus: 0.5, memoryMb: 256, pidsLimit: 256 };
  const row = (siteId) => {
    if (!rows.has(siteId)) rows.set(siteId, { state: 'unprovisioned', desiredState: 'running', provisioned: false });
    return rows.get(siteId);
  };

  let control;
  let requests = [];
  let disposeProvider = async () => {};
  let providerReconcile = async () => {};

  if (realEngine) {
    const engineRoot = mkdtempSync(join(tmpdir(), 'sites-pod-'));
    try {
      const provider = await realProvider({ engineRoot, dataDir: join(root, 'engine-data') });
      control = provider.control;
      requests = provider.requests;
      providerReconcile = provider.reconcile;
      // The daemon is the only lifecycle performer: it reconciles durable operations into containers.
      // A test harness stands in for that loop; without it no queued operation would ever complete.
      const loop = setInterval(() => { provider.reconcile().catch(() => { /* reported through the row */ }); }, 200);
      loop.unref?.();
      disposeProvider = async () => { clearInterval(loop); await provider.dispose(); rmSync(engineRoot, { recursive: true, force: true }); };
    } catch (error) {
      rmSync(engineRoot, { recursive: true, force: true });
      throw error;
    }
  } else {
    const fakeControl = {
      authority: null,
      async connectSitesRuntime(authority) { fakeControl.authority = authority; },
      async registerSiteEnvironment({ siteId, accountUserId }) {
        await fakeControl.authorize(siteId, accountUserId);
        const current = rows.get(siteId);
        if (!current || current.state === 'deleted') {
          rows.set(siteId, { state: 'unprovisioned', desiredState: 'running', provisioned: false });
        }
        return fakeControl.view(siteId);
      },
      view(siteId) {
        const current = row(siteId);
        return { siteId, generation: 1, state: current.state, desiredState: current.desiredState, limits, lastError: null };
      },
      async authorize(siteId, accountUserId) {
        if (!fakeControl.authority) throw new Error('the private provider has no Sites runtime authority');
        const registration = await fakeControl.authority.resolve({ siteId, accountUserId, access: 'manage' });
        if (!registration) throw new Error(`site ${siteId} is not registered for account ${accountUserId}`);
        return registration;
      },
      async siteEnvironmentFor({ siteId }) { return fakeControl.view(siteId); },
      async siteEnvironmentOperation({ operationId }) { return operations.get(operationId) ?? null; },
      async siteEnvironmentExec() {
        throw new Error('the private provider stand-in executes no guest commands; run the real-engine suite for that');
      },
      async siteEnvironmentLogs() { return { lifecycle: 'private provider stand-in', journal: '' }; },
      async siteEnvironmentSnapshots() { return []; },
      async requestSiteEnvironment(input) {
        requests.push({ ...input });
        sequence += 1;
        const operation = {
          id: `op-${sequence}`, requestId: input.requestId, siteId: input.siteId, accountUserId: input.accountUserId,
          generation: 1, action: input.action, status: 'succeeded', error: null,
        };
        if (input.action.kind === 'snapshot') operation.snapshotId = `runtime-snapshot-${sequence}`;
        operations.set(operation.id, operation);
        const registration = await fakeControl.authorize(input.siteId, input.accountUserId);
        const current = row(input.siteId);
        switch (input.action.kind) {
          case 'provision-image':
            // Image building belongs to the runtime and is invisible at this seam; the fake records it.
            break;
          case 'prepare':
            await fakeControl.authority.beforeCreate?.(input.siteId);
            current.provisioned = true;
            current.state = 'stopped'; current.desiredState = 'stopped';
            break;
          case 'start':
          case 'restart': {
            await fakeControl.authority.beforeStart(input.siteId);
            // First start of a seeded volume: the image's bootstrap installs the data the seed carried
            // into the container's HOME, which the private directory stands in for.
            const seedData = join(volumeDir(input.siteId), '.elowen-conversion', 'legacy-data.tar');
            if (existsSync(seedData)) {
              await runTar(['-xf', seedData, '-C', volumeDir(input.siteId)]);
              rmSync(join(volumeDir(input.siteId), '.elowen-conversion'), { recursive: true, force: true });
            }
            await fakeControl.bindApp(input.siteId, registration);
            current.state = 'running'; current.desiredState = 'running';
            break;
          }
          case 'stop':
            await fakeControl.unbindApp(input.siteId);
            await fakeControl.authority.afterStop(input.siteId);
            current.state = 'stopped'; current.desiredState = 'stopped';
            break;
          case 'delete':
            await fakeControl.unbindApp(input.siteId);
            await fakeControl.authority.afterStop(input.siteId);
            current.state = 'deleted'; current.desiredState = 'deleted'; current.provisioned = false;
            break;
          case 'cleanup-stage':
            if (!registration.staging) throw new Error('only an unpublished conversion binding may be cleaned up as staging');
            await fakeControl.unbindApp(input.siteId);
            await fakeControl.authority.afterStop(input.siteId);
            rmSync(volumeDir(input.siteId), { recursive: true, force: true });
            current.state = 'deleted'; current.desiredState = 'deleted'; current.provisioned = false;
            break;
          case 'import-data':
          case 'export-data':
          case 'remove-artifact': {
            const artifact = await fakeControl.authority.resolveArtifact?.({
              siteId: input.siteId, accountUserId: input.accountUserId, artifactId: input.action.artifactId, action: input.action.kind,
            });
            if (!artifact) throw new Error('the retained Sites artifact is unavailable');
            if (input.action.kind === 'import-data') {
              if (!registration.staging) throw new Error('data import requires an unpublished conversion binding');
              if (current.state === 'running') throw new Error('stop the conversion target before seeding its data');
              mkdirSync(volumeDir(input.siteId), { recursive: true });
              await runTar(['-xf', artifact.archivePath, '-C', volumeDir(input.siteId)]);
            } else if (input.action.kind === 'export-data') {
              const volume = volumeDir(input.siteId);
              if (!existsSync(volume)) throw new Error('the data volume does not exist');
              const entries = readdirSync(volume);
              if (entries.length === 0) throw new Error('the data volume is empty');
              await runTar(['-cf', artifact.archivePath, '-C', volume, '--', ...entries]);
            } else {
              rmSync(artifact.archivePath, { recursive: true, force: true });
            }
            break;
          }
          default:
            throw new Error(`the private provider stand-in does not model the ${input.action.kind} action`);
        }
        return operation;
      },
      /** Models the contract: the provider reconciles only durable pending operations, and the fake
       *  completes its operations inline, so a sweep has nothing to perform and never resurrects. */
      async reconcile() { fakeControl.reconciles += 1; },
      reconciles: 0,
      async bindApp(siteId, registration) {
        if (apps.has(siteId)) return;
        const socketPath = brokerPath(siteId);
        let handle;
        if (registration.workspaceReadOnly) {
          handle = await bindAppServer(socketPath, staticAppHandler(registration.sourcePath));
        } else {
          const app = (convertedApp ?? defaultConvertedApp()).open(volumeDir(siteId));
          handle = await bindAppServer(socketPath, app.handle);
          handle.close = (original => async () => { await original(); app.close(); })(handle.close);
        }
        apps.set(siteId, handle);
      },
      async unbindApp(siteId) {
        const app = apps.get(siteId);
        if (!app) return;
        apps.delete(siteId);
        await app.close();
      },
    };
    control = fakeControl;
    providerReconcile = () => fakeControl.reconcile();
  }

  const environment = new EnvironmentSupervisor({
    control: () => control,
    store,
    access: { accountExists: () => true, isAdmin: (id) => id === 1, canAccessProject: () => true },
    dataDir,
    gateway,
    config: () => ({
      startTimeoutSeconds: 60,
      environmentNetwork: 'isolated',
      environmentCpus: 0.5,
      environmentMemoryMb: 256,
      environmentPidsLimit: 256,
      releasesKept: 3,
    }),
    siteDir,
    brokerPath,
    logger: { warn: () => {} },
  });

  const dataSync = new DataSyncService({
    executor: new SpawnExecutor(),
    artifactDir: (siteId) => migrationArtifactDir(siteDir(siteId)),
  });

  // The legacy runtime, stood up as a real process on the real broker socket when a test needs one.
  const legacy = { server: null, home: legacyHome, running: false };
  const startLegacy = async (siteId, handler) => {
    await gateway.prepareRuntimeSocket(siteId);
    await new Promise((resolve, reject) => {
      legacy.server = createServer(handler);
      legacy.server.once('error', reject);
      legacy.server.listen(brokerPath(siteId), () => resolve());
    });
    chmodSync(brokerPath(siteId), 0o666);
    legacy.running = true;
  };
  const stopLegacy = async () => {
    if (!legacy.server) return;
    await new Promise((resolve) => legacy.server.close(() => resolve()));
    legacy.server = null;
    legacy.running = false;
  };

  const migration = new RuntimeMigrationService({
    store,
    siteDir,
    releaseDir,
    stopLegacyRuntime: async () => { await stopLegacy(); },
    legacyRunning: () => legacy.running,
    startLegacyRuntime: async () => { legacy.running = true; },
    loadRecipe: (siteId) => loadAppRecipe(migrationArtifactDir(siteDir(siteId))),
    recipeBinding: (siteId) => recipeBinding(migrationArtifactDir(siteDir(siteId))),
    installRecipe: (siteId, input) => installAppRecipe(migrationArtifactDir(siteDir(siteId)), input),
    prepareContainer: async ({ site, workspace, recipe }) => {
      // The derivative carries what the app needs to answer; the RUNTIME owns building it from the
      // recipe Sites supplies. Sites only names the tag.
      await environment.prepareContainer(site, workspace, conversionImageTag(recipe.image), recipe.image === 'static');
    },
    startEnvironment: (site) => environment.start(site, { authorized: true }),
    stopContainer: (siteId) => environment.quiesce(siteId),
    containerStopped: (siteId) => environment.isStopped(siteId),
    inspectOwnership: (siteId, expect) => environment.inspectOwnership(siteId, expect),
    conversionImageTag: (recipe) => conversionImageTag(recipe.image),
    verifyReadiness: async (site, expect) => {
      const state = await environment.state(site);
      if (state.state !== 'running') return { ready: false, detail: `the container is ${state.state ?? 'absent'}` };
      const outcome = await environment.probeReadiness(site.id, expect);
      return { ready: outcome.ready, detail: outcome.detail };
    },
    discardContainer: (siteId, options) => environment.delete(siteId, options),
    brokerDirectoryExists: (siteId) => environment.brokerDirectoryExists(siteId),
    prepareBrokerDirectory: async (siteId) => { await environment.prepareBrokerDirectory(siteId); },
    removeStaged: (paths) => environment.removeStaged(paths),
    // Mirrors `index.ts`, INCLUDING its `site.runtime !== 'command'` guard. A rollback reaches this with
    // the descriptor the conversion recorded rather than the flipped row, so the guard must still pass.
    //
    // The preparation below has the SHAPE the Sandbox preparation really returns: `home` and `roots` are
    // separate, and the home sits OUTSIDE the roots this plugin names, because Sandbox binds it
    // separately from the account rather than from the caller's root list. The real `validateLegacyHome`
    // then runs on it, so this suite exercises the production trust boundary instead of stepping over it.
    resolveLegacyData: async (site) => {
      if (site.runtime !== 'command') return null;
      const recipe = loadAppRecipe(migrationArtifactDir(siteDir(site.id)));
      if (recipe.dataIncludes.length === 0) return null;
      const cwd = releaseDir(site.id, RELEASE_ID);
      const prepared = {
        mode: 'confined',
        cwd,
        displayCwd: '/release',
        home: legacyHome,
        roots: [cwd],
        launch: { type: 'shell', command: site.startCommand, env: {} },
        workspace: null,
        lease: {
          id: 'lease-conv', accountUserId: site.ownerUserId, workspaceId: null, homeGeneration: 1,
          heartbeat() {}, release() {},
        },
        sanitizeOutput: (text) => text,
      };
      return {
        home: validateLegacyHome({
          home: prepared.home,
          expectedOwnerUserId: site.ownerUserId,
          leaseAccountUserId: prepared.lease.accountUserId,
          expectedHome: legacy.running ? legacyHome : null,
        }),
        includes: recipe.dataIncludes,
      };
    },
    runningLegacyHome: () => (legacy.running ? legacyHome : null),
    captureLegacyData: (siteId, selection) => dataSync.captureLegacyData(siteId, selection),
    buildSeedArchive: (siteId, input) => dataSync.buildSeedArchive(siteId, input),
    loadDataVolume: async (site, seedArchive) => { await environment.importDataVolume(site.id, seedArchive); },
    exportDataVolume: (site, output) => environment.exportDataVolume(site.id, output),
    restoreLegacyData: (selection, archive, siteId) => dataSync.restoreLegacyData(selection, archive, siteId),
    recoverInterruptedRestore: (siteId) => dataSync.recoverInterruptedRestore(siteId),
    extractSecretArtifacts: (siteId, workspace, files) => dataSync.extractSecretArtifacts(siteId, workspace, files),
    // The ancestor list is index.ts's, unchanged: this site's own directory and its migration directory,
    // never the plugin data root, never the directory other sites sit in.
    relaxStaticServing: (siteId, workspace) =>
      relaxStaticServingPermissions(workspace, [siteDir(siteId), join(siteDir(siteId), 'migration')]),
    stagedSecretDigest: (siteId) => dataSync.stagedSecretDigest(siteId),
    artifactPath: (siteId, name) => dataSync.archivePath(siteId, name),
    discardArtifacts: (siteId) => dataSync.discardArtifacts(siteId),
  });

  const handlers = createApiHandlers({
    store,
    access: { accountExists: () => true, isAdmin: (id) => id === 1, canAccessProject: () => true },
    config: () => ({
      allowEnvironments: true, allowPublicSites: true, siteHostBase: 'sites.example.test', siteScheme: 'https:',
      appBaseUrl: 'https://example.test', sessionTtlHours: 12, runtimeNetwork: 'isolated',
      allowLoopbackPorts: false, loopbackPortMin: 1, loopbackPortMax: 2,
    }),
    people: () => new Map(),
    projectSlug: () => null,
    deleteSite: async () => {},
    activateRelease: () => {},
    runtimeState: () => ({ running: legacy.running, logTail: '' }),
    allocatePort: async () => 1,
    restartRuntime: async () => {},
    environmentState: (site) => environment.state(site),
    environmentLogs: async () => ({ lifecycle: '', journal: '' }),
    gatewayReadiness: async () => ({ ok: true, status: 'active', detail: '' }),
    gatewayRecord: () => null,
    requestEnvironmentControl: async () => {},
    snapshotEnvironment: async () => ({ id: 'x' }),
    rollbackEnvironment: async () => {},
    applyEnvironmentLimits: async () => {},
    provisioning: { status: async () => ({ ready: true, items: [] }), provision: async () => ({ ready: true, items: [] }) },
    migration,
  });

  /** Every conversion step in these tests goes through the real admin route, never the service directly. */
  const call = (siteId, body, { admin = true } = {}) => handlers.conversion({
    path: `/${siteId}`,
    method: body === undefined ? 'GET' : 'POST',
    query: {},
    auth: { userId: admin ? 1 : 5, admin, accessibleProjects: [2] },
    json: async () => body ?? {},
  });

  /** The runtime view a test asserts on, through the seam: the durable state the provider records and
   *  whether the persistent container exists at all (created but not started reads `stopped`). */
  const runtimeState = async (siteId) => {
    if (realEngine) {
      const view = await control.siteEnvironmentFor({ siteId, accountUserId: OWNER });
      return { state: view.state, provisioned: view.state !== 'unprovisioned' };
    }
    const current = rows.get(siteId);
    return { state: current?.state ?? 'unprovisioned', provisioned: current?.provisioned ?? false };
  };

  const seedRelease = (siteId, files) => {
    const dir = releaseDir(siteId, RELEASE_ID);
    mkdirSync(dir, { recursive: true });
    for (const [name, body] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      writeFileSync(join(dir, name), body);
    }
    return dir;
  };

  /** Leave nothing behind, including after a failed assertion.
   *
   *  The supervisor's own delete is tried first, because exercising it is part of the point. In the
   *  real-engine mode the provider is disposed as well, so no container, volume or lease outlives the
   *  test inside its private namespace; the isolated storage itself lives under the removed root. */
  const cleanup = async (siteId) => {
    await stopLegacy();
    if (siteId) {
      try { await environment.delete(siteId, { removeBroker: true }); } catch { /* forced below */ }
    }
    for (const [siteId, close] of [...apps]) {
      apps.delete(siteId);
      await close().catch(() => {});
    }
    if (realEngine) await disposeProvider();
    // The ingress requests and readiness probes ride the default HTTP agent, whose keep-alive pool
    // would otherwise hold this test process open after the run.
    globalAgent.destroy();
    // A keep-alive socket caught mid-shutdown still shows as an active handle; release the loop's hold
    // on it, the suites are done and every answer was already consumed.
    for (const handle of process._getActiveHandles()) {
      if (handle?.constructor?.name === 'Socket') handle.unref?.();
    }
    try { rmSync(root, { recursive: true, force: true }); } catch { /* a leaked subuid tree is reported by the caller */ }
  };

  return {
    root, brokerRoot, brokerPath, store, environment, migration, handlers, call, seedRelease, cleanup,
    control, requests, runtimeState, volumeDir, gatewayCalls, legacyHome, startLegacy, stopLegacy, legacy,
    siteDir, dataSync, releaseDir, realEngine, providerReconcile,
  };
};

export {
  SLOW_MS, RELEASE_ID, site0, release0, httpOverSocket, httpOverSocketWhenUp, podmanHarness,
  stagedWorkspace, MigrationRefused,
};