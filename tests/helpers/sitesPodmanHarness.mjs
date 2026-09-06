// The runtime conversion against REAL rootless Podman, real containers, a real ingress socket and real
// HTTP — the half `sites-migration.test.mjs` deliberately stands in for.
//
// Opt-in: it needs a working rootless Podman and the conversion derivative images, so it is skipped
// unless SITES_PODMAN_E2E=1. Nothing here is a production configuration knob.
//
// ISOLATION. The broker namespace is redirected through `brokerPath`, the EnvironmentDeps seam the
// supervisor already has, into a directory this test owns. The privileged gateway helper is NOT invoked
// and /var/lib/elowen is never read or written. `testGateway` below reproduces the helper's three socket
// operations exactly — rm -rf then mkdir 0730 on prepare, chmod 0510 plus an lstat socket check on seal,
// rm -rf on remove — with one unavoidable deviation named at its call site: the helper chowns the
// directory to root and this test cannot, so the mode is applied without the ownership change.

import Database from 'better-sqlite3';
import { createServer, request } from 'node:http';
import {
  chmodSync, lstatSync, mkdirSync, mkdtempSync, rmSync, writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { SitesStore } from '../../plugins/sites/dist/store.js';
import { MigrationRefused, RuntimeMigrationService, stagedWorkspace } from '../../plugins/sites/dist/migration.js';
import { DataSyncService, migrationArtifactDir, validateLegacyHome } from '../../plugins/sites/dist/dataSync.js';
import { EnvironmentSupervisor } from '../../plugins/sites/dist/environment.js';
import { PodmanClient, SpawnExecutor } from '../../plugins/sites/dist/podman.js';
import { createApiHandlers } from '../../plugins/sites/dist/api.js';
import { conversionImageTag, ensureConversionImage } from '../../plugins/sites/dist/conversionImage.js';
import {
  installAppRecipe, loadAppRecipe, recipeBinding, relaxStaticServingPermissions,
} from '../../plugins/sites/dist/recipe.js';

const skip = process.env.SITES_PODMAN_E2E === '1' ? false : 'set SITES_PODMAN_E2E=1 to run the real Podman conversion suite';
/** Container work is minutes, not milliseconds. */
const SLOW_MS = 300_000;

const RELEASE_ID = 'rel-live-0001';

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
  environmentDiskSoftMb: 1024,
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

/** One HTTP request over a Unix socket, so a cutover is proven by an answer rather than by a status. */
const httpOverSocket = (socketPath, path) => new Promise((resolve, reject) => {
  const req = request({ socketPath, path, method: 'GET', timeout: 5_000 }, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
  });
  req.once('error', reject);
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

/** The real plugin, wired exactly as `plugins/sites/src/index.ts` wires it, with a task-owned broker. */
const podmanHarness = () => {
  const root = mkdtempSync(join(process.env.SITES_PODMAN_E2E_ROOT ?? '/var/www/eo-testonly-runtime', 'conv-'));
  const brokerRoot = join(root, 'broker');
  const dataDir = join(root, 'plugin-data');
  const legacyHome = join(root, 'legacy-home');
  mkdirSync(brokerRoot, { recursive: true, mode: 0o755 });
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(legacyHome, { recursive: true });

  const store = new SitesStore(makeDb());
  const podman = new PodmanClient();
  const gatewayCalls = { prepare: [], seal: [], remove: [] };
  const gateway = testGateway(brokerRoot, gatewayCalls);
  const siteDir = (siteId) => join(root, 'sites', siteId);
  const releaseDir = (siteId, releaseId) => join(siteDir(siteId), 'releases', releaseId);
  const brokerPath = (siteId) => join(brokerRoot, siteId, 'app.sock');

  const environment = new EnvironmentSupervisor({
    podman,
    store,
    gateway,
    brokerPath,
    config: () => ({
      startTimeoutSeconds: 60,
      environmentNetwork: 'isolated',
      environmentCpus: 0.5,
      environmentMemoryMb: 256,
      environmentPidsLimit: 256,
      environmentDiskSoftMb: 1024,
      releasesKept: 3,
    }),
    siteDir,
    ensureBaseImage: async () => { throw new Error('a conversion always supplies its own derivative image'); },
    // The supervisor's own start-poll sleep is deliberately unref'd so a long-lived daemon is never held
    // open by it. A bare test process has nothing else on the loop, so that timer lets the run exit in
    // the middle of a start with the await still pending. This is the `sleep` seam EnvironmentDeps
    // already exposes, supplied with a referenced timer. Nothing on the production path changes.
    sleep: (milliseconds) => new Promise((resolve) => { setTimeout(resolve, milliseconds); }),
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
      const image = await ensureConversionImage(podman, dataDir, recipe.image);
      await environment.prepareContainer(site, workspace, image, recipe.image === 'static');
    },
    startEnvironment: (site) => environment.start(site),
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
    removeStaged: (paths) => podman.unshareRemove(paths),
    // Mirrors `index.ts`, INCLUDING its `site.runtime !== 'command'` guard. A rollback reaches this with
    // the descriptor the conversion recorded rather than the flipped row, so the guard must still pass.
    //
    // The preparation below has the SHAPE `SandboxPreparedExecution` really returns: `home` and `roots`
    // are separate, and the home sits OUTSIDE the roots this plugin names, because Sandbox binds it
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
   *  The supervisor's own delete is tried first, because exercising it is part of the point. It runs on
   *  the site queue and stops the container before removing it, so a test that failed mid-start can leave
   *  it unable to finish — hence the unconditional force-remove behind it. Container-written files under
   *  the root belong to a subuid, so the tree is removed through the namespace-aware path first. */
  const cleanup = async (siteId) => {
    await stopLegacy();
    if (siteId) {
      try { await environment.delete(siteId, { removeBroker: true }); } catch { /* forced below */ }
      await podman.run(['rm', '-f', `elowen-site-${siteId}`], { allowFailure: true });
      await podman.run(['volume', 'rm', '-f', `elowen-site-${siteId}-data`], { allowFailure: true });
    }
    try { await podman.unshareRemove([root]); } catch { /* fall through to plain removal */ }
    try { rmSync(root, { recursive: true, force: true }); } catch { /* a leaked subuid tree is reported by the caller */ }
  };

  return {
    root, brokerRoot, brokerPath, store, environment, migration, handlers, call, seedRelease, cleanup,
    podman, gatewayCalls, legacyHome, startLegacy, stopLegacy, legacy, siteDir, dataSync, releaseDir,
  };
};


export {
  skip, SLOW_MS, RELEASE_ID, site0, release0, httpOverSocket, httpOverSocketWhenUp, podmanHarness,
  stagedWorkspace, MigrationRefused,
};
