import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SitesStore } from '../plugins/sites/dist/store.js';
import {
  digestTree, finalArtifactDigest, interruptedByRestart, legacyDescriptor, MigrationRefused, plainRemove,
  reconcileIntoSource, RuntimeMigrationService, stagedWorkspace,
} from '../plugins/sites/dist/migration.js';
import {
  assertAppOwnedSelection, assertContainedSubtrees, DataSyncService, migrationArtifactDir, validateLegacyHome,
  withinRoots,
  workspaceOwnedBy,
} from '../plugins/sites/dist/dataSync.js';
import { EnvironmentSupervisor } from '../plugins/sites/dist/environment.js';
import { SpawnExecutor } from '../plugins/sites/dist/podman.js';
import { createApiHandlers } from '../plugins/sites/dist/api.js';
import {
  appUnit, auditStaticTree, installAppRecipe, isRecipeKind, loadAppRecipe, parseAppRecipe, provisionScript,
  recipeBinding, relaxStaticServingPermissions, staticServable,
} from '../plugins/sites/dist/recipe.js';
import { BASE_IMAGE_TAG, BOOTSTRAP_SERVICE, CONTAINERFILE } from '../plugins/sites/dist/baseImage.js';
import {
  conversionImageTag, NODE_CONTAINERFILE, NODE_IMAGE_REF, NODE_IMAGE_SOURCE, NODE_IMAGE_VERSION,
  STATIC_CONTAINERFILE, STATIC_SITE_CONF,
} from '../plugins/sites/dist/conversionImage.js';

const SITE_ID = '11111111-2222-3333-4444-555555555555';

/** The tag derivation, reproduced so a test can prove the published tag depends on exactly these inputs. */
const imageTagFor = (base, containerfile, conf) => `localhost/elowen-site-static:${
  createHash('sha256').update([base, containerfile, conf].join('\0')).digest('hex').slice(0, 16)}`;

/** A supervisor whose ingress endpoint is a real unix socket, for probing readiness over real HTTP. */
const readinessHarness = (socketPath) => {
  const env = new EnvironmentSupervisor({
    podman: {},
    store: {},
    gateway: {},
    config: () => ({ startTimeoutSeconds: 5, environmentNetwork: 'shared', environmentCpus: 1,
      environmentMemoryMb: 256, environmentPidsLimit: 128, environmentDiskSoftMb: 1024, releasesKept: 3 }),
    siteDir: () => '/tmp/unused',
    ensureBaseImage: async () => 'unused',
  });
  env.endpoints.set(SITE_ID, { kind: 'socket', path: socketPath });
  return env;
};
const OTHER_ID = '99999999-8888-7777-6666-555555555555';
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

const legacySite = (overrides = {}) => ({
  id: SITE_ID,
  slug: 'legacy-demo',
  title: 'Legacy demo',
  summary: '',
  projectId: 2,
  ownerUserId: 7,
  visibility: 'authenticated',
  accessGeneration: 4,
  sourceDir: '/data/project/sites/legacy-demo',
  spa: false,
  runtime: 'static',
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
  currentReleaseId: RELEASE_ID,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  createdModel: '',
  lastPublishAt: null,
  lastPublishModel: null,
  lastError: null,
  ...overrides,
});

const release = (overrides = {}) => ({
  id: RELEASE_ID,
  siteId: SITE_ID,
  createdAt: '2026-01-01T00:00:00.000Z',
  model: '',
  fileCount: 2,
  sizeBytes: 20,
  note: '',
  kind: 'files',
  imageRef: null,
  dataArchive: null,
  ...overrides,
});

/** A harness whose filesystem is real (the copy and the digest are the behaviour under test) and whose
 *  container side is recorded rather than run. */
const harness = (options = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'sites-migration-'));
  const store = new SitesStore(makeDb());
  const calls = {
    prepareContainer: [], startEnvironment: [], discardContainer: [], stopLegacy: [], startLegacy: [],
    resolveLegacyData: [], loadDataVolume: [], exportDataVolume: [], stopContainer: [],
    prepareBroker: [], discard: [], relaxStatic: [], rebind: [], publish: [], clearStage: [],
  };
  // The persisted environment binding, as the supervisor keeps it: the completion is what moves it off
  // the staged copy, so a test can read where the container would actually be mounted.
  const binding = { sourcePath: null, staging: null };
  // The host directory Podman bind-mounts at /run/elowen, rooted in the harness so a test can assert on
  // it as a real filesystem object rather than a recorded call.
  const brokerDirOf = (siteId) => join(root, 'broker', siteId);
  let containerLive = false;
  let restoreAttempted = false;
  let running = options.legacyRunning ?? false;
  // The REAL data-sync service: real tar, real filesystem, real 0600 artifacts. Only the container is
  // stood in for, because Podman cannot run in this workspace.
  const dataSync = new DataSyncService({
    executor: new SpawnExecutor(),
    artifactDir: (siteId) => migrationArtifactDir(join(root, 'sites', siteId)),
  });
  const realTar = async (args) => {
    const result = await new SpawnExecutor().run('tar', args, {
      env: { PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' },
      timeoutMs: 60_000,
      outputLimitBytes: 65536,
    });
    if (result.code !== 0) throw new Error(`tar failed: ${result.stderr}`);
  };
  const legacyHome = join(root, 'legacy-home');
  const recipe = parseAppRecipe(options.recipe ?? {
    kind: 'node-app',
    argv: ['/usr/bin/node', 'server.mjs'],
    env: { DEV_PORT: '80' },
    dataIncludes: options.includes ?? ['.local/share/this-app'],
    secretFiles: ['.env'],
    readiness: { path: '/api/me', expectStatus: 200 },
  });

  const deps = {
    store,
    siteDir: (siteId) => join(root, 'sites', siteId),
    releaseDir: (siteId, releaseId) => join(root, 'sites', siteId, 'releases', releaseId),
    stopLegacyRuntime: async (siteId) => {
      calls.stopLegacy.push(siteId);
      if (options.stopFails) throw new Error('stop exploded');
      if (!options.stopLeavesRunning) running = false;
    },
    legacyRunning: () => running,
    loadRecipe: () => recipe,
    prepareContainer: async (input) => {
      // Reproduces the real failure the isolated daemon found: podman statfs-es every bind source at
      // create time, so a missing broker directory fails with 125 and no container is made.
      if (!existsSync(brokerDirOf(input.site.id))) {
        throw new Error(`podman create failed (125): statfs ${brokerDirOf(input.site.id)}: no such file or directory`);
      }
      calls.prepareContainer.push({ siteId: input.site.id, workspace: input.workspace, image: input.recipe.image });
      binding.sourcePath = input.workspace;
      binding.staging = true;
      if (options.prepareFails) throw new Error('container build exploded');
    },
    // The supervisor retires the staged container and builds a new one on the site's own source folder.
    // Only the binding it would register with is modelled here; Podman cannot run in this workspace.
    rebindToSource: async (site) => {
      calls.rebind.push(site.id);
      if (options.rebindFails) throw new Error('the container could not be rebuilt');
      binding.sourcePath = site.sourceDir;
      binding.staging = true;
      containerLive = false;
    },
    publishBinding: (site) => {
      calls.publish.push(site.id);
      binding.staging = false;
    },
    clearConversionStage: async (site, stageDir) => {
      calls.clearStage.push({ siteId: site.id, stageDir });
      if (options.clearStageFails) throw new Error('the container did not answer the exec');
      if (!containerLive) throw new Error('exec against a container that is not running');
    },
    startEnvironment: async (site) => {
      calls.startEnvironment.push(site.id);
      containerLive = true;
      if (options.startFails) throw new Error('environment start exploded');
    },
    stopContainer: async (siteId) => {
      calls.stopContainer.push(siteId);
      if (options.containerWontStop) return;
      containerLive = false;
    },
    containerStopped: async () => !containerLive,
    inspectOwnership: async () => options.ownership ?? null,
    conversionImageTag: (r) => conversionImageTag(r.image),
    brokerDirectoryExists: (siteId) => existsSync(brokerDirOf(siteId)),
    // Stands in for the privileged gateway helper: rm -rf then recreate, exactly what it does.
    prepareBrokerDirectory: async (siteId) => {
      calls.prepareBroker.push(siteId);
      rmSync(brokerDirOf(siteId), { recursive: true, force: true });
      mkdirSync(brokerDirOf(siteId), { recursive: true });
    },
    verifyReadiness: async (_site, expect) => options.readiness ?? { ready: true, detail: `GET ${expect.path} answered ${expect.expectStatus}` },
    runningLegacyHome: () => (options.runningHome === undefined ? legacyHome : options.runningHome),
    stagedSecretDigest: (siteId) => dataSync.stagedSecretDigest(siteId),
    relaxStaticServing: (siteId, workspace) => {
      calls.relaxStatic.push(siteId);
      relaxStaticServingPermissions(workspace, [join(root, 'sites', siteId), join(root, 'sites', siteId, 'migration')]);
    },
    recipeBinding: (siteId) => options.binding ?? { siteId, expectedReleaseId: siteId === OTHER_ID ? 'rel-other' : RELEASE_ID },
    installRecipe: (siteId, input) => installAppRecipe(migrationArtifactDir(join(root, 'sites', siteId)), input),
    recoverInterruptedRestore: (siteId) => dataSync.recoverInterruptedRestore(siteId),
    discardContainer: async (siteId, opts) => {
      calls.discardContainer.push(siteId);
      calls.discard.push({ siteId, removeBroker: opts?.removeBroker });
      if (opts?.removeBroker) rmSync(brokerDirOf(siteId), { recursive: true, force: true });
      if (options.discardFails) throw new Error('discard exploded');
      containerLive = false;
    },
    removeStaged: plainRemove,
    startLegacyRuntime: async (site) => {
      calls.startLegacy.push(site.id);
      // The real supervisor only resolves once the endpoint answers, so a rejection here is what a
      // legacy runtime that will not come up looks like to the conversion.
      if (options.startLegacyFails) throw new Error('the legacy runtime did not answer');
      running = true;
    },
    resolveLegacyData: async (site) => {
      calls.resolveLegacyData.push(site.id);
      if (options.noLegacyHome) return null;
      return { home: legacyHome, includes: options.includes ?? ['.local/share/this-app'] };
    },
    captureLegacyData: (siteId, selection) => dataSync.captureLegacyData(siteId, selection),
    buildSeedArchive: (siteId, input) => dataSync.buildSeedArchive(siteId, input),
    loadDataVolume: async (site, seedArchive) => { calls.loadDataVolume.push({ siteId: site.id, seedArchive }); },
    exportDataVolume: async (site, output) => {
      calls.exportDataVolume.push({ siteId: site.id, output });
      if (options.exportFails) throw new Error('volume export exploded');
      if (!options.containerWrote) return false;
      // Stand in for `podman volume export`: a tar of what the container "wrote" while converted.
      const staged = join(root, 'container-data', '.local/share/this-app');
      mkdirSync(staged, { recursive: true });
      writeFileSync(join(staged, 'data.db'), 'WRITTEN-WHILE-CONVERTED');
      await realTar(['-cf', output, '-C', join(root, 'container-data'), '--', '.local/share/this-app']);
      return true;
    },
    restoreLegacyData: async (selection, archive) => {
      if (options.restoreFailsOnce && !restoreAttempted) { restoreAttempted = true; throw new Error('restore exploded'); }
      restoreAttempted = true;
      return dataSync.restoreLegacyData(selection, archive, SITE_ID);
    },
    extractSecretArtifacts: (siteId, workspace, files) => dataSync.extractSecretArtifacts(siteId, workspace, files),
    artifactPath: (siteId, name) => dataSync.archivePath(siteId, name),
    discardArtifacts: (siteId) => dataSync.discardArtifacts(siteId),
    now: () => new Date('2026-09-05T22:00:00.000Z'),
  };

  const service = new RuntimeMigrationService(deps);
  const seedRelease = (siteId, releaseId, files) => {
    const dir = deps.releaseDir(siteId, releaseId);
    mkdirSync(dir, { recursive: true });
    for (const [name, body] of Object.entries(files)) {
      const full = join(dir, name);
      mkdirSync(join(full, '..'), { recursive: true });
      writeFileSync(full, body);
    }
    return dir;
  };
  const setRunning = (value) => { running = value; };
  const cleanup = () => rmSync(root, { recursive: true, force: true });
  return {
    root, store, service, deps, calls, seedRelease, setRunning, cleanup, dataSync, legacyHome, realTar,
    brokerDirOf, binding,
  };
};

/** The site's own source folder lands inside the harness root, because a completion folds the staged copy
 *  back into it and a test must own the directory it writes to. */
const sourceDirOf = (h) => join(h.root, 'project', 'sites', 'legacy-demo');

const seedLiveStatic = (h, overrides = {}) => {
  mkdirSync(sourceDirOf(h), { recursive: true });
  h.store.insertSite(legacySite({ sourceDir: sourceDirOf(h), ...overrides }));
  h.store.insertRelease(release());
  return h.seedRelease(SITE_ID, RELEASE_ID, { 'index.html': '<h1>live</h1>', 'assets/app.js': 'console.log(1)' });
};

// --- recipe boundary -------------------------------------------------------------------------------

test('only a named built-in recipe is accepted, never a path or an image', () => {
  assert.equal(isRecipeKind('release-copy'), true);
  for (const hostile of ['/etc/passwd', '../../escape', 'docker.io/library/alpine', '', null, 42, {}]) {
    assert.equal(isRecipeKind(hostile), false);
  }
});

test('the staged workspace is derived from the site id, under the plugin site directory', () => {
  const h = harness();
  try {
    const path = stagedWorkspace(h.deps, SITE_ID);
    assert.equal(path, join(h.root, 'sites', SITE_ID, 'migration', 'workspace'));
  } finally { h.cleanup(); }
});

// --- refusal ---------------------------------------------------------------------------------------

test('refuses a site that does not exist, is already an environment, or is unsupported', async () => {
  const h = harness();
  try {
    await assert.rejects(() => h.service.prepare(SITE_ID, 'release-copy'), MigrationRefused);

    h.store.insertSite(legacySite({ runtime: 'environment' }));
    await assert.rejects(() => h.service.prepare(SITE_ID, 'release-copy'), /already a persistent environment/);

    h.store.insertSite(legacySite({ id: OTHER_ID, slug: 'broken', runtime: 'nonsense-runtime' }));
    await assert.rejects(() => h.service.prepare(OTHER_ID, 'release-copy'), /unsupported runtime/);
  } finally { h.cleanup(); }
});

test('refuses a draft site and a live site with no release to stage from', async () => {
  const h = harness();
  try {
    h.store.insertSite(legacySite({ status: 'draft' }));
    await assert.rejects(() => h.service.prepare(SITE_ID, 'release-copy'), /busy|conversion/);

    h.store.insertSite(legacySite({ id: OTHER_ID, slug: 'no-release', currentReleaseId: null }));
    await assert.rejects(() => h.service.prepare(OTHER_ID, 'release-copy'), MigrationRefused);
    assert.equal(h.store.runtimeMigration(OTHER_ID), null);
  } finally { h.cleanup(); }
});

test('refuses while a shell lease or a snapshot action already owns the site', async () => {
  const h = harness();
  try {
    seedLiveStatic(h);
    h.store.putEnvironmentAction({
      siteId: SITE_ID, kind: 'snapshot', snapshotId: 'snap-1', includeData: false,
      note: '', model: '', requestedAt: '2026-09-05T21:00:00.000Z', lastError: null,
    });
    await assert.rejects(() => h.service.prepare(SITE_ID, 'release-copy'), /busy/);
    assert.equal(h.store.runtimeMigration(SITE_ID), null);
  } finally { h.cleanup(); }
});

test('a second driver cannot claim a conversion that is already owned', async () => {
  const h = harness();
  try {
    seedLiveStatic(h);
    await h.service.prepare(SITE_ID, 'release-copy');
    assert.equal(h.store.runtimeMigration(SITE_ID).lastError, null);
    assert.equal(
      h.store.tryClaimRuntimeMigration({ siteId: SITE_ID, recipe: 'release-copy', requestedAt: 'now' }),
      false,
    );
  } finally { h.cleanup(); }
});

// --- ownership and undo material -------------------------------------------------------------------

test('the claim captures the undo material before anything is touched', async () => {
  const h = harness();
  try {
    h.store.insertSite(legacySite({ runtime: 'command', startCommand: 'node server.js', bind: 'socket', port: null }));
    h.store.insertRelease(release());
    h.seedRelease(SITE_ID, RELEASE_ID, { 'server.js': 'run()', '.env': 'APP_PASSWORD=secret\n' });

    await h.service.prepare(SITE_ID, 'release-copy');
    const migration = h.store.runtimeMigration(SITE_ID);
    assert.equal(migration.fromRuntime, 'command');
    assert.equal(migration.fromStartCommand, 'node server.js');
    assert.equal(migration.fromBind, 'socket');
    assert.equal(migration.fromReleaseId, RELEASE_ID);
    assert.equal(migration.recipe, 'release-copy');
    assert.equal(migration.stage, 'prepared');
  } finally { h.cleanup(); }
});

// --- source versus release -------------------------------------------------------------------------

test('preparation stages the RELEASE copy and never the editable source directory', async () => {
  const h = harness();
  try {
    const releaseDir = seedLiveStatic(h);
    // The editable source has moved on. A conversion that staged it would publish unreleased edits.
    const sourceDir = join(h.root, 'editable-source');
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(join(sourceDir, 'index.html'), '<h1>UNRELEASED DRAFT</h1>');
    h.store.updateSite(SITE_ID, { title: 'unchanged' });

    await h.service.prepare(SITE_ID, 'release-copy');

    const workspace = stagedWorkspace(h.deps, SITE_ID);
    assert.equal(readFileSync(join(workspace, 'index.html'), 'utf8'), '<h1>live</h1>');
    assert.equal(readFileSync(join(workspace, 'assets/app.js'), 'utf8'), 'console.log(1)');
    assert.equal(digestTree(workspace), digestTree(releaseDir));
    // The container is handed the staged copy, not the site's own source root.
    assert.equal(h.calls.prepareContainer[0].workspace, workspace);
    assert.notEqual(h.calls.prepareContainer[0].workspace, legacySite().sourceDir);
  } finally { h.cleanup(); }
});

test('a release .env is moved into a protected artifact, never left in the writable workspace', async () => {
  const h = harness();
  try {
    h.store.insertSite(legacySite({ runtime: 'command', startCommand: 'node server.mjs' }));
    h.store.insertRelease(release());
    const releaseDir = h.seedRelease(SITE_ID, RELEASE_ID, { 'server.mjs': 'run()', '.env': 'TWILIO_TOKEN=abc\n' });

    await h.service.prepare(SITE_ID, 'release-copy');

    const workspace = stagedWorkspace(h.deps, SITE_ID);
    // /workspace is bind-mounted read-write, so a secret left there is one the site's own code can
    // rewrite or serve. It must not be there.
    assert.equal(existsSync(join(workspace, '.env')), false);
    assert.equal(readFileSync(join(workspace, 'server.mjs'), 'utf8'), 'run()');

    const artifact = h.dataSync.archivePath(SITE_ID, 'secrets/.env');
    assert.equal(readFileSync(artifact, 'utf8'), 'TWILIO_TOKEN=abc\n');
    assert.equal(statSync(artifact).mode & 0o777, 0o600, 'the secret artifact is owner-only');
    assert.equal(statSync(join(artifact, '..')).mode & 0o777, 0o700, 'so is the directory holding it');

    // NO SOURCE MUTATION: the release the copy came from still has its own .env, untouched.
    assert.equal(readFileSync(join(releaseDir, '.env'), 'utf8'), 'TWILIO_TOKEN=abc\n');
  } finally { h.cleanup(); }
});

test('the secret artifact path is handed to the container builder, never the secret itself', async () => {
  const h = harness();
  try {
    h.store.insertSite(legacySite({ runtime: 'command', startCommand: 'node server.mjs' }));
    h.store.insertRelease(release());
    h.seedRelease(SITE_ID, RELEASE_ID, { 'server.mjs': 'run()', '.env': 'APP_PASSWORD=hunter2\n' });

    await h.service.prepare(SITE_ID, 'release-copy');

    const spec = h.calls.prepareContainer[0];
    assert.deepEqual(Object.keys(spec).sort(), ['image', 'siteId', 'workspace']);
    assert.equal(JSON.stringify(spec).includes('hunter2'), false, 'no secret value crosses the container seam');
  } finally { h.cleanup(); }
});

// --- data sync: post-quiesce capture and reverse sync ------------------------------------------------

test('the legacy data snapshot is taken only after the process is verified stopped', async () => {
  const h = harness({ legacyRunning: true });
  try {
    h.store.insertSite(legacySite({ runtime: 'command', startCommand: 'node server.mjs' }));
    h.store.insertRelease(release());
    h.seedRelease(SITE_ID, RELEASE_ID, { 'server.mjs': 'run()' });
    // A live SQLite file outside the release, exactly the shape this step exists for.
    mkdirSync(join(h.legacyHome, '.local/share/this-app'), { recursive: true });
    writeFileSync(join(h.legacyHome, '.local/share/this-app/data.db'), 'LEGACY-ROWS');

    await h.service.prepare(SITE_ID, 'release-copy');
    assert.deepEqual(h.calls.loadDataVolume, [], 'preparation must not touch live data');

    await h.service.flip(SITE_ID);

    // Ordering is the invariant: stop, then capture, then load, then flip.
    assert.deepEqual(h.calls.stopLegacy, [SITE_ID]);
    assert.equal(h.calls.loadDataVolume.length, 1);
    const seed = h.calls.loadDataVolume[0].seedArchive;
    assert.equal(existsSync(seed), true);
    assert.equal(statSync(seed).mode & 0o777, 0o600);
    // The capture itself is a 0600 artefact too, and it is what the seed carries.
    const capture = h.dataSync.archivePath(SITE_ID, 'legacy-data.tar');
    assert.equal(statSync(capture).mode & 0o777, 0o600);
  } finally { h.cleanup(); }
});

test('a captured subtree restores byte for byte', async () => {
  const h = harness();
  const includes = ['.local/share/this-app'];
  try {
    mkdirSync(join(h.legacyHome, '.local/share/this-app/nested'), { recursive: true });
    writeFileSync(join(h.legacyHome, '.local/share/this-app/nested/data.db'), 'ROWS-A');
    writeFileSync(join(h.legacyHome, '.local/share/this-app/top.txt'), 'ROWS-B');

    const archive = await h.dataSync.captureLegacyData(SITE_ID, { home: h.legacyHome, includes });
    assert.notEqual(archive, null);

    const restored = join(h.root, 'restored');
    await h.dataSync.restoreLegacyData({ home: restored, includes }, archive);
    assert.equal(readFileSync(join(restored, '.local/share/this-app/nested/data.db'), 'utf8'), 'ROWS-A');
    assert.equal(readFileSync(join(restored, '.local/share/this-app/top.txt'), 'utf8'), 'ROWS-B');
    assert.equal(
      digestTree(join(restored, '.local/share/this-app')),
      digestTree(join(h.legacyHome, '.local/share/this-app')),
    );
  } finally { h.cleanup(); }
});

test('a stateless site captures nothing rather than an empty archive that looks like success', async () => {
  const h = harness();
  try {
    assert.equal(
      await h.dataSync.captureLegacyData(SITE_ID, { home: join(h.root, 'nope'), includes: ['.local/share/x'] }),
      null,
    );
    // Present home, absent subtree: also nothing, rather than an archive of the home.
    mkdirSync(h.legacyHome, { recursive: true });
    assert.equal(
      await h.dataSync.captureLegacyData(SITE_ID, { home: h.legacyHome, includes: ['.local/share/x'] }),
      null,
    );
  } finally { h.cleanup(); }
});

test('rollback carries container writes back into the legacy data directory', async () => {
  const h = harness({ legacyRunning: true, containerWrote: true });
  try {
    h.store.insertSite(legacySite({ runtime: 'command', startCommand: 'node server.mjs' }));
    h.store.insertRelease(release());
    h.seedRelease(SITE_ID, RELEASE_ID, { 'server.mjs': 'run()' });
    mkdirSync(join(h.legacyHome, '.local/share/this-app'), { recursive: true });
    writeFileSync(join(h.legacyHome, '.local/share/this-app/data.db'), 'ROWS-BEFORE-CONVERSION');

    await h.service.prepare(SITE_ID, 'release-copy');
    await h.service.flip(SITE_ID);
    await h.service.rollback(SITE_ID);

    // The writes the container made while it owned the data are what the legacy runtime comes back to.
    assert.equal(
      readFileSync(join(h.legacyHome, '.local/share/this-app/data.db'), 'utf8'),
      'WRITTEN-WHILE-CONVERTED',
    );
    assert.equal(h.calls.exportDataVolume.length, 1);
    assert.deepEqual(h.calls.startLegacy, [SITE_ID], 'the legacy process is started again, after the data');
  } finally { h.cleanup(); }
});

test('the export happens before the container is discarded, or the writes would be gone', async () => {
  const h = harness({ legacyRunning: true, containerWrote: true });
  const order = [];
  try {
    h.store.insertSite(legacySite({ runtime: 'command', startCommand: 'node server.mjs' }));
    h.store.insertRelease(release());
    h.seedRelease(SITE_ID, RELEASE_ID, { 'server.mjs': 'run()' });
    mkdirSync(h.legacyHome, { recursive: true });

    const realExport = h.deps.exportDataVolume;
    h.deps.exportDataVolume = async (...args) => { order.push('export'); return realExport(...args); };
    const realDiscard = h.deps.discardContainer;
    h.deps.discardContainer = async (...args) => { order.push('discard'); return realDiscard(...args); };

    await h.service.prepare(SITE_ID, 'release-copy');
    await h.service.flip(SITE_ID);
    await h.service.rollback(SITE_ID);

    assert.deepEqual(order, ['export', 'discard']);
  } finally { h.cleanup(); }
});

test('opting out of the reverse sync discards container writes instead of exporting them', async () => {
  const h = harness({ legacyRunning: true, containerWrote: true });
  try {
    h.store.insertSite(legacySite({ runtime: 'command', startCommand: 'node server.mjs' }));
    h.store.insertRelease(release());
    h.seedRelease(SITE_ID, RELEASE_ID, { 'server.mjs': 'run()' });
    mkdirSync(join(h.legacyHome, '.local/share/this-app'), { recursive: true });
    writeFileSync(join(h.legacyHome, '.local/share/this-app/data.db'), 'ROWS-BEFORE-CONVERSION');

    await h.service.prepare(SITE_ID, 'release-copy');
    await h.service.flip(SITE_ID);
    await h.service.rollback(SITE_ID, { restoreData: false });

    assert.deepEqual(h.calls.exportDataVolume, []);
    assert.equal(
      readFileSync(join(h.legacyHome, '.local/share/this-app/data.db'), 'utf8'),
      'ROWS-BEFORE-CONVERSION',
    );
  } finally { h.cleanup(); }
});

test('a rollback that cannot locate the data directory fails loudly instead of reporting success', async () => {
  const h = harness({ legacyRunning: true, containerWrote: true });
  try {
    h.store.insertSite(legacySite({ runtime: 'command', startCommand: 'node server.mjs' }));
    h.store.insertRelease(release());
    h.seedRelease(SITE_ID, RELEASE_ID, { 'server.mjs': 'run()' });
    mkdirSync(h.legacyHome, { recursive: true });

    await h.service.prepare(SITE_ID, 'release-copy');
    await h.service.flip(SITE_ID);
    // The sandbox stops being able to name the directory, e.g. the plugin was disabled underneath.
    h.deps.resolveLegacyData = async () => null;

    await assert.rejects(() => h.service.rollback(SITE_ID), /cannot be carried back/);
  } finally { h.cleanup(); }
});

test('artifacts do not outlive the conversion', async () => {
  const h = harness({ legacyRunning: true });
  try {
    h.store.insertSite(legacySite({ runtime: 'command', startCommand: 'node server.mjs' }));
    h.store.insertRelease(release());
    h.seedRelease(SITE_ID, RELEASE_ID, { 'server.mjs': 'run()', '.env': 'SECRET=1\n' });
    mkdirSync(join(h.legacyHome, '.local/share/this-app'), { recursive: true });
    writeFileSync(join(h.legacyHome, '.local/share/this-app/data.db'), 'ROWS');

    await h.service.prepare(SITE_ID, 'release-copy');
    await h.service.flip(SITE_ID);
    const secret = h.dataSync.archivePath(SITE_ID, 'secrets/.env');
    assert.equal(existsSync(secret), true);

    await h.service.rollback(SITE_ID);
    assert.equal(existsSync(secret), false, 'a captured secret must not survive a rolled-back conversion');
  } finally { h.cleanup(); }
});

// --- sandbox-derived location, never a caller-supplied root -------------------------------------------

test('containment still catches the prefix trap wherever it is used', () => {
  assert.equal(withinRoots('/home/site-a/data', ['/home/site-a']), true);
  assert.equal(withinRoots('/home/site-a', ['/home/site-a']), true);
  // The classic prefix trap: a sibling whose name merely starts with the root.
  assert.equal(withinRoots('/home/site-a-evil', ['/home/site-a']), false);
  assert.equal(withinRoots('/etc/shadow', ['/home/site-a']), false);
  assert.equal(withinRoots('relative/path', ['/home/site-a']), false);
});

/** The shape `SandboxPreparedExecution` actually returns: `home` and `roots` are SEPARATE fields, and the
 *  roots a caller names are the directories the child may see, never the home. */
const preparedShape = (root, { home, ownerUserId = 4, leaseAccountUserId = 4 } = {}) => ({
  mode: 'confined',
  cwd: join(root, 'release'),
  displayCwd: '/release',
  home,
  // Exactly what this plugin asks for: the release directory, and nothing else. The home is NOT here.
  roots: [join(root, 'release')],
  launch: { type: 'shell', command: 'node server.mjs', env: {} },
  workspace: null,
  lease: { id: 'lease-1', accountUserId: leaseAccountUserId, workspaceId: null, homeGeneration: 1, heartbeat() {}, release() {} },
  sanitizeOutput: (text) => text,
  ownerUserId,
});

test('S1 a HOME outside the granted roots is ACCEPTED, because that is the contract', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'sites-home-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'sandbox', 'users', '2', 'home');
  mkdirSync(home, { recursive: true });
  mkdirSync(join(root, 'release'), { recursive: true });
  const prepared = preparedShape(root, { home });

  // THE PRODUCTION BLOCKER. Sandbox binds the home separately from the roots the caller names, so a home
  // outside them is the normal, intended result. Requiring containment refused every correct preparation
  // and made every data-carrying conversion impossible: prepare succeeded, flip returned 502.
  assert.equal(withinRoots(prepared.home, prepared.roots), false, 'the real shape genuinely has home outside roots');
  assert.equal(
    validateLegacyHome({
      home: prepared.home,
      expectedOwnerUserId: 4,
      leaseAccountUserId: prepared.lease.accountUserId,
    }),
    realpathSync(home),
  );
});

test('S2 a preparation issued for the wrong account is refused', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'sites-home-owner-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'home');
  mkdirSync(home, { recursive: true });

  // Ownership is the boundary that replaced containment. Sandbox derives the home from the account, so a
  // lease issued for a different account means we were handed somebody else's directory.
  assert.throws(
    () => validateLegacyHome({ home, expectedOwnerUserId: 4, leaseAccountUserId: 2 }),
    /prepared this execution for account 2 rather than the site owner 4/,
  );
  assert.throws(
    () => validateLegacyHome({ home, expectedOwnerUserId: 4, leaseAccountUserId: null }),
    /account none rather than the site owner 4/,
  );
});

test('S3 a home that disagrees with the live process is refused', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'sites-home-live-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'home');
  const other = join(root, 'other');
  mkdirSync(home, { recursive: true });
  mkdirSync(other, { recursive: true });

  assert.throws(
    () => validateLegacyHome({ home, expectedOwnerUserId: 4, leaseAccountUserId: 4, expectedHome: other }),
    /bound to .*other but the sandbox now reports/,
  );
  // Matching the live home, through a symlink, still resolves to one canonical answer.
  const linked = join(root, 'link-to-home');
  symlinkSync(home, linked);
  assert.equal(
    validateLegacyHome({ home: linked, expectedOwnerUserId: 4, leaseAccountUserId: 4, expectedHome: home }),
    realpathSync(home),
  );
});

test('S4 the basic shape checks still hold', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'sites-home-shape-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.throws(() => validateLegacyHome({ home: 'not-absolute', expectedOwnerUserId: 4, leaseAccountUserId: 4 }), /absolute HOME/);
  assert.throws(() => validateLegacyHome({ home: join(root, 'missing'), expectedOwnerUserId: 4, leaseAccountUserId: 4 }), /does not exist/);
  writeFileSync(join(root, 'file'), 'x');
  assert.throws(() => validateLegacyHome({ home: join(root, 'file'), expectedOwnerUserId: 4, leaseAccountUserId: 4 }), /not a directory/);
});

test('S5 an app-owned subtree that escapes the home through a symlink is refused', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'sites-subtree-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'home');
  const neighbour = join(root, 'neighbour-home', '.local', 'share', 'other-app');
  mkdirSync(join(home, '.local', 'share'), { recursive: true });
  mkdirSync(neighbour, { recursive: true });
  writeFileSync(join(neighbour, 'secret.db'), 'not-ours');

  // Textually impeccable, and it leaves the home anyway: the escape is on an intermediate component.
  symlinkSync(join(root, 'neighbour-home', '.local', 'share'), join(home, '.local', 'share', 'linked'));
  assert.throws(
    () => assertContainedSubtrees(home, ['.local/share/linked']),
    /is a symlink, so capturing it would leave this site's home/,
  );

  // A real subtree is kept, and one the app has not created yet is simply skipped.
  mkdirSync(join(home, '.local', 'share', 'mine'), { recursive: true });
  assert.deepEqual(
    assertContainedSubtrees(home, ['.local/share/mine', '.local/share/not-yet']),
    ['.local/share/mine'],
  );
});

test('S6 two apps sharing ONE home stay isolated from each other', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'sites-shared-home-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  // The real fleet shape: two command sites confined to the same sandbox home.
  const home = join(root, 'sandbox', 'users', '2', 'home');
  mkdirSync(join(home, '.local', 'share', 'schuzky-a-ukazky'), { recursive: true });
  mkdirSync(join(home, '.local', 'share', 'hovory-twilio'), { recursive: true });
  writeFileSync(join(home, '.local', 'share', 'schuzky-a-ukazky', 'data.db'), 'schuzky');
  writeFileSync(join(home, '.local', 'share', 'hovory-twilio', 'data.db'), 'hovory');

  // Each site names only its own subtree, so the shared home never widens either capture.
  assert.deepEqual(assertContainedSubtrees(home, ['.local/share/schuzky-a-ukazky']), ['.local/share/schuzky-a-ukazky']);
  assert.deepEqual(assertContainedSubtrees(home, ['.local/share/hovory-twilio']), ['.local/share/hovory-twilio']);
  // And the home itself remains unrepresentable as a capture, shared or not.
  assert.throws(() => assertAppOwnedSelection({ home, includes: ['.'] }), /not the home itself/);
  assert.throws(() => assertAppOwnedSelection({ home, includes: [] }), /capturing a whole home is refused/);
});

test('a staged workspace is only accepted under the site\'s own plugin directory', () => {
  assert.equal(workspaceOwnedBy('/data/sites/abc/migration/workspace', '/data/sites/abc'), true);
  assert.equal(workspaceOwnedBy('/data/sites/abc', '/data/sites/abc'), false);
  assert.equal(workspaceOwnedBy('/data/sites/other/workspace', '/data/sites/abc'), false);
  assert.equal(workspaceOwnedBy('/etc', '/data/sites/abc'), false);
});

// --- the flip --------------------------------------------------------------------------------------

test('a static flip preserves id, slug, visibility, access generation, members and releases', async () => {
  const h = harness();
  try {
    seedLiveStatic(h);
    h.store.addMember(SITE_ID, 42);
    h.store.addMember(SITE_ID, 43);
    const before = h.store.siteById(SITE_ID);

    await h.service.prepare(SITE_ID, 'release-copy');
    await h.service.flip(SITE_ID);

    const after = h.store.siteById(SITE_ID);
    assert.equal(after.runtime, 'environment');
    assert.equal(after.id, before.id);
    assert.equal(after.slug, before.slug);
    assert.equal(after.visibility, before.visibility);
    assert.equal(after.accessGeneration, before.accessGeneration, 'a conversion changes no access rule');
    assert.equal(after.currentReleaseId, RELEASE_ID);
    assert.deepEqual(h.store.memberIds(SITE_ID), [42, 43]);
    assert.equal(h.store.releases(SITE_ID).length, 1);
  } finally { h.cleanup(); }
});

test('the flip starts the prepared container and never asks for a second build', async () => {
  const h = harness();
  try {
    seedLiveStatic(h);
    await h.service.prepare(SITE_ID, 'release-copy');
    assert.equal(h.calls.prepareContainer.length, 1);

    await h.service.flip(SITE_ID);

    assert.equal(h.calls.prepareContainer.length, 1, 'the prepared container is reused, not rebuilt');
    assert.deepEqual(h.calls.startEnvironment, [SITE_ID]);
  } finally { h.cleanup(); }
});

test('a command flip stops the legacy process first, awaited, before the column moves', async () => {
  const h = harness({ legacyRunning: true });
  try {
    h.store.insertSite(legacySite({ runtime: 'command', startCommand: 'node server.js' }));
    h.store.insertRelease(release());
    h.seedRelease(SITE_ID, RELEASE_ID, { 'server.js': 'run()' });

    await h.service.prepare(SITE_ID, 'release-copy');
    assert.deepEqual(h.calls.stopLegacy, [], 'preparation must not touch the live process');
    assert.equal(h.store.siteById(SITE_ID).runtime, 'command', 'the site still serves legacy while staged');

    await h.service.flip(SITE_ID);

    assert.deepEqual(h.calls.stopLegacy, [SITE_ID]);
    assert.equal(h.store.siteById(SITE_ID).runtime, 'environment');
  } finally { h.cleanup(); }
});

test('a legacy process still running after the stop aborts the flip and leaves the site legacy', async () => {
  const h = harness({ legacyRunning: true, stopLeavesRunning: true });
  try {
    h.store.insertSite(legacySite({ runtime: 'command', startCommand: 'node server.js' }));
    h.store.insertRelease(release());
    h.seedRelease(SITE_ID, RELEASE_ID, { 'server.js': 'run()' });
    await h.service.prepare(SITE_ID, 'release-copy');

    await assert.rejects(() => h.service.flip(SITE_ID), /still running after an awaited stop/);

    assert.equal(h.store.siteById(SITE_ID).runtime, 'command', 'no double writer: the flip did not land');
    assert.deepEqual(h.calls.startEnvironment, [], 'the container was never started alongside the process');
    assert.match(h.store.runtimeMigration(SITE_ID).lastError, /still running/);
  } finally { h.cleanup(); }
});

test('a static flip never stops a legacy process, because there is none', async () => {
  const h = harness();
  try {
    seedLiveStatic(h);
    await h.service.prepare(SITE_ID, 'release-copy');
    await h.service.flip(SITE_ID);
    assert.deepEqual(h.calls.stopLegacy, []);
  } finally { h.cleanup(); }
});

// --- rollback --------------------------------------------------------------------------------------

test('rollback after a flip restores the exact command runtime the claim captured', async () => {
  const h = harness({ legacyRunning: true });
  try {
    h.store.insertSite(legacySite({ runtime: 'command', startCommand: 'node server.mjs', bind: 'socket' }));
    h.store.insertRelease(release());
    h.seedRelease(SITE_ID, RELEASE_ID, { 'server.mjs': 'run()' });

    await h.service.prepare(SITE_ID, 'release-copy');
    await h.service.flip(SITE_ID);
    await h.service.rollback(SITE_ID);

    const after = h.store.siteById(SITE_ID);
    assert.equal(after.runtime, 'command');
    assert.equal(after.startCommand, 'node server.mjs');
    assert.equal(after.bind, 'socket');
    assert.equal(after.currentReleaseId, RELEASE_ID);
    assert.deepEqual(h.calls.discardContainer, [SITE_ID]);
    assert.equal(h.store.runtimeMigration(SITE_ID), null);
  } finally { h.cleanup(); }
});

test('rollback restores serving before the container is discarded, and clears the staged copy', async () => {
  const h = harness();
  try {
    seedLiveStatic(h);
    await h.service.prepare(SITE_ID, 'release-copy');
    const workspace = stagedWorkspace(h.deps, SITE_ID);
    assert.equal(existsSync(workspace), true);

    await h.service.rollback(SITE_ID);

    assert.equal(existsSync(workspace), false, 'the staged copy does not outlive the conversion');
    assert.equal(h.store.siteById(SITE_ID).runtime, 'static');
    // Releases are the thing static serving resumes from, so a rollback must not have touched them.
    assert.equal(h.store.releases(SITE_ID).length, 1);
    assert.equal(existsSync(h.deps.releaseDir(SITE_ID, RELEASE_ID)), true);
  } finally { h.cleanup(); }
});

test('rollback of a never-flipped conversion leaves the site exactly as it was', async () => {
  const h = harness();
  try {
    seedLiveStatic(h);
    const before = h.store.siteById(SITE_ID);
    await h.service.prepare(SITE_ID, 'release-copy');
    await h.service.rollback(SITE_ID);
    const after = h.store.siteById(SITE_ID);
    assert.equal(after.runtime, before.runtime);
    assert.equal(after.currentReleaseId, before.currentReleaseId);
    assert.equal(after.accessGeneration, before.accessGeneration);
  } finally { h.cleanup(); }
});

test('rollback refuses when there is no conversion to undo', async () => {
  const h = harness();
  try {
    seedLiveStatic(h);
    await assert.rejects(() => h.service.rollback(SITE_ID), MigrationRefused);
  } finally { h.cleanup(); }
});

// --- crash stages ----------------------------------------------------------------------------------

test('a crash during preparation leaves a failed, re-claimable slot and no flip', async () => {
  const h = harness({ prepareFails: true });
  try {
    seedLiveStatic(h);
    await assert.rejects(() => h.service.prepare(SITE_ID, 'release-copy'), /container build exploded/);

    const migration = h.store.runtimeMigration(SITE_ID);
    assert.equal(migration.stage, 'preparing');
    assert.match(migration.lastError, /container build exploded/);
    assert.equal(h.store.siteById(SITE_ID).runtime, 'static', 'the live site never moved');
    // A failed slot is re-claimable: that is how both a retry and a rollback get back in.
    assert.equal(
      h.store.tryClaimRuntimeMigration({ siteId: SITE_ID, recipe: 'release-copy', requestedAt: 'later' }),
      true,
    );
  } finally { h.cleanup(); }
});

test('a crash after the durable flip resumes forward: the site is an environment and still rollbackable', async () => {
  const h = harness({ startFails: true });
  try {
    seedLiveStatic(h);
    await h.service.prepare(SITE_ID, 'release-copy');
    await assert.rejects(() => h.service.flip(SITE_ID), /environment start exploded/);

    assert.equal(h.store.siteById(SITE_ID).runtime, 'environment', 'the flip was durable before the start');
    const pending = h.service.pending();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].stage, 'flipped');
    // The undo material survived the failure, so the site can still go back.
    await h.service.rollback(SITE_ID);
    assert.equal(h.store.siteById(SITE_ID).runtime, 'static');
  } finally { h.cleanup(); }
});

test('a flip cannot be replayed and cannot skip preparation', async () => {
  const h = harness();
  try {
    seedLiveStatic(h);
    await assert.rejects(() => h.service.flip(SITE_ID), /no conversion to flip/);

    await h.service.prepare(SITE_ID, 'release-copy');
    await h.service.flip(SITE_ID);
    // Replay is a no-op rather than a second start.
    const again = await h.service.flip(SITE_ID);
    assert.equal(again.stage, 'flipped');
    assert.equal(h.calls.startEnvironment.length, 1);
  } finally { h.cleanup(); }
});

test('completing retires the slot only once the site really serves as an environment', async () => {
  const h = harness();
  try {
    seedLiveStatic(h);
    await h.service.prepare(SITE_ID, 'release-copy');
    await assert.rejects(() => h.service.complete(SITE_ID), MigrationRefused);

    await h.service.flip(SITE_ID);
    const status = await h.service.complete(SITE_ID);
    assert.equal(status.stage, 'none');
    assert.equal(h.store.runtimeMigration(SITE_ID), null);
    assert.equal(h.store.siteById(SITE_ID).runtime, 'environment');
  } finally { h.cleanup(); }
});

// --- collisions and data survival --------------------------------------------------------------------

test('two sites convert independently and neither slot sees the other', async () => {
  const h = harness();
  try {
    seedLiveStatic(h);
    h.store.insertSite(legacySite({ id: OTHER_ID, slug: 'second', currentReleaseId: 'rel-other' }));
    h.store.insertRelease(release({ id: 'rel-other', siteId: OTHER_ID }));
    h.seedRelease(OTHER_ID, 'rel-other', { 'index.html': '<h1>second</h1>' });

    await h.service.prepare(SITE_ID, 'release-copy');
    await h.service.prepare(OTHER_ID, 'release-copy');
    await h.service.flip(SITE_ID);

    assert.equal(h.store.siteById(SITE_ID).runtime, 'environment');
    assert.equal(h.store.siteById(OTHER_ID).runtime, 'static', 'the neighbour is untouched by the flip');
    assert.notEqual(stagedWorkspace(h.deps, SITE_ID), stagedWorkspace(h.deps, OTHER_ID));
    assert.notEqual(
      h.store.runtimeMigration(SITE_ID).contentDigest,
      h.store.runtimeMigration(OTHER_ID).contentDigest,
    );
  } finally { h.cleanup(); }
});

test('deleting a site clears its conversion slot rather than orphaning it', async () => {
  const h = harness();
  try {
    seedLiveStatic(h);
    await h.service.prepare(SITE_ID, 'release-copy');
    h.store.deleteSite(SITE_ID);
    assert.equal(h.store.runtimeMigration(SITE_ID), null);
    assert.deepEqual(h.service.pending(), []);
  } finally { h.cleanup(); }
});

test('the digest is stable across walks and changes when a staged byte changes', () => {
  const h = harness();
  try {
    const dir = h.seedRelease(SITE_ID, RELEASE_ID, { 'b.txt': 'two', 'a.txt': 'one', 'deep/c.txt': 'three' });
    const first = digestTree(dir);
    assert.equal(first, digestTree(dir), 'readdir order must not change the value');
    writeFileSync(join(dir, 'deep/c.txt'), 'THREE');
    assert.notEqual(first, digestTree(dir));
  } finally { h.cleanup(); }
});

test('a file larger than the hashing buffer is digested whole, without being read into memory', () => {
  // A release may hold an asset far larger than the daemon's heap, and a conversion hashes the tree
  // twice. Reading one file whole would fail the conversion on exactly the files sites now supports.
  const h = harness();
  try {
    const big = Buffer.alloc(9 * 1048576);
    for (let i = 0; i < big.length; i += 1) big[i] = i % 251;
    const dir = h.seedRelease(SITE_ID, RELEASE_ID, { 'movie.mp4': big, 'empty.bin': '' });
    const expected = createHash('sha256')
      .update('F empty.bin 0\n')
      .update(`F movie.mp4 ${big.length}\n`)
      .update(big)
      .digest('hex');
    assert.equal(digestTree(dir), expected);
  } finally { h.cleanup(); }
});

// --- real Sites caller over the typed Sandbox contract ----------------------------------------------

const supervisorHarness = (statuses) => {
  const root = mkdtempSync(join(tmpdir(), 'sites-supervisor-'));
  const store = new SitesStore(makeDb());
  const calls = [];
  let authority;
  const control = {
    connectSitesRuntime: value => { authority = value; },
    registerSiteEnvironment: async () => ({ state: 'stopped', generation: 1 }),
    // `statuses[0]` is the container the runtime already holds for this Site, or nothing at all.
    siteEnvironmentFor: async () => ({ state: statuses[0] ?? 'unprovisioned', desiredState: 'stopped', generation: 1, limits: {}, lastError: null }),
    requestSiteEnvironment: async input => { calls.push(input); return { ...input, id: String(calls.length), status: 'succeeded' }; },
  };
  const supervisor = new EnvironmentSupervisor({
    control: () => control, dataDir: root, store,
    access: { accountExists: () => true, isAdmin: () => true, canAccessProject: () => true },
    gateway: {
      prepareRuntimeSocket: async () => { throw new Error('prepareRuntimeSocket must not be called while staging'); },
      sealRuntimeSocket: async () => { throw new Error('sealRuntimeSocket must not be called while staging'); },
      removeRuntimeSocket: async () => { throw new Error('removeRuntimeSocket must not be called while staging'); },
    },
    config: () => ({
      startTimeoutSeconds: 1, environmentNetwork: 'shared', environmentCpus: 0.5,
      environmentMemoryMb: 384, environmentPidsLimit: 128, environmentDiskSoftMb: 1024, releasesKept: 3,
    }),
    siteDir: (siteId) => join(root, 'sites', siteId),
    brokerPath: (siteId) => join('/var/lib/elowen/site-runtime-sockets', siteId, 'app.sock'),
  });
  return { root, store, supervisor, calls, authority: () => authority, cleanup: () => rmSync(root, { recursive: true, force: true }) };
};

test('the real supervisor stages a container without starting it or touching the live broker', async () => {
  const h = supervisorHarness([null]);
  try {
    h.store.insertSite(legacySite({ runtime: 'environment' }));
    const site = h.store.siteById(SITE_ID);
    const workspace = join(h.root, 'sites', SITE_ID, 'staged');
    mkdirSync(workspace, { recursive: true });

    const result = await h.supervisor.prepareContainer(site, workspace);

    assert.equal(result.created, true);
    assert.equal(h.calls.some(call => call.action.kind === 'start'), false);
    assert.deepEqual(h.calls.map(call => call.action.kind), ['provision-image', 'prepare']);
    const binding = await h.authority().resolve({ siteId: SITE_ID, accountUserId: 7, access: 'manage' });
    assert.equal(binding.limits.memoryMb, 384);
    assert.equal(binding.limits.cpus, 0.5);
    assert.equal(binding.limits.pidsLimit, 128);
    assert.equal(binding.sourcePath, workspace);
    assert.notEqual(binding.sourcePath, legacySite().sourceDir);
  } finally { h.cleanup(); }
});

test('staging an existing container is a no-op rather than a rebuild', async () => {
  const h = supervisorHarness(['exited']);
  try {
    h.store.insertSite(legacySite({ runtime: 'environment' }));
    const site = h.store.siteById(SITE_ID);

    const result = await h.supervisor.prepareContainer(site, join(h.root, 'sites', SITE_ID, 'staged'));

    assert.equal(result.created, false);
    assert.deepEqual(h.calls, []);
  } finally { h.cleanup(); }
});

test('exporting a data volume that never existed reports false instead of failing the rollback', async () => {
  const h = supervisorHarness([]);
  try {
    h.store.insertSite(legacySite({ runtime: 'environment' }));
    assert.equal(await h.supervisor.exportDataVolume(SITE_ID, join(h.root, 'sites', SITE_ID, 'out.tar')), false);
    assert.equal(h.calls.at(-1).action.kind, 'export-data');
  } finally { h.cleanup(); }
});

// --- restart recovery --------------------------------------------------------------------------------

test('a restart mid-preparation clears the orphan container and re-opens the slot', async () => {
  const h = harness();
  try {
    seedLiveStatic(h);
    // Claim and stage, then simulate the driver vanishing with the slot still owned.
    await h.service.prepare(SITE_ID, 'release-copy');
    h.store.advanceRuntimeMigration(SITE_ID, 'prepared', 'preparing');
    h.calls.discardContainer.length = 0;

    const settled = await h.service.recoverInterrupted();

    assert.equal(settled.length, 1);
    assert.match(settled[0].lastError, /interrupted by a restart while preparing/);
    assert.deepEqual(h.calls.discardContainer, [SITE_ID], 'the unverified container is an orphan');
    assert.equal(existsSync(stagedWorkspace(h.deps, SITE_ID)), false);
    assert.equal(h.store.siteById(SITE_ID).runtime, 'static', 'the live site never moved');
    assert.equal(
      h.store.tryClaimRuntimeMigration({ siteId: SITE_ID, recipe: 'release-copy', requestedAt: 'later' }),
      true,
    );
  } finally { h.cleanup(); }
});

test('a restart after preparation keeps the container and only releases ownership', async () => {
  const h = harness();
  try {
    seedLiveStatic(h);
    await h.service.prepare(SITE_ID, 'release-copy');
    h.calls.discardContainer.length = 0;

    const settled = await h.service.recoverInterrupted();

    assert.equal(settled[0].stage, 'prepared');
    assert.deepEqual(h.calls.discardContainer, [], 'a verified container is not an orphan');
    assert.equal(existsSync(stagedWorkspace(h.deps, SITE_ID)), true);
  } finally { h.cleanup(); }
});

test('a restart after the flip leaves the site converted and still rollbackable', async () => {
  const h = harness();
  try {
    seedLiveStatic(h);
    await h.service.prepare(SITE_ID, 'release-copy');
    await h.service.flip(SITE_ID);
    h.calls.discardContainer.length = 0;

    const settled = await h.service.recoverInterrupted();

    assert.equal(settled[0].stage, 'flipped');
    assert.deepEqual(h.calls.discardContainer, []);
    assert.equal(h.store.siteById(SITE_ID).runtime, 'environment');
    await h.service.rollback(SITE_ID);
    assert.equal(h.store.siteById(SITE_ID).runtime, 'static');
  } finally { h.cleanup(); }
});

test('recovery leaves an already-failed slot exactly as it was', async () => {
  const h = harness({ prepareFails: true });
  try {
    seedLiveStatic(h);
    await assert.rejects(() => h.service.prepare(SITE_ID, 'release-copy'));
    const before = h.store.runtimeMigration(SITE_ID).lastError;

    await h.service.recoverInterrupted();

    assert.equal(h.store.runtimeMigration(SITE_ID).lastError, before, 'the original reason is not overwritten');
  } finally { h.cleanup(); }
});

// --- the admin API route, against the real handler ---------------------------------------------------

const apiHarness = (options = {}) => {
  const h = harness(options);
  const handlers = createApiHandlers({
    store: h.store,
    access: { accountExists: () => true, isAdmin: (id) => id === 1, canAccessProject: () => true },
    config: () => ({
      allowEnvironments: options.allowEnvironments !== false,
      allowPublicSites: true, siteHostBase: 'sites.example.test', siteScheme: 'https:',
      appBaseUrl: 'https://example.test', sessionTtlHours: 12, runtimeNetwork: 'shared',
      allowLoopbackPorts: false, loopbackPortMin: 1, loopbackPortMax: 2,
    }),
    people: () => new Map(),
    projectSlug: () => null,
    deleteSite: async () => {},
    activateRelease: () => {},
    runtimeState: () => ({ running: false, logTail: '' }),
    allocatePort: async () => 1,
    restartRuntime: async () => {},
    environmentState: async () => ({ state: null, desiredState: 'running', limits: {}, lastError: null }),
    environmentLogs: async () => ({ lifecycle: '', journal: '' }),
    gatewayReadiness: async () => ({ ok: true, status: 'active', detail: '' }),
    gatewayRecord: () => null,
    requestEnvironmentControl: async () => {},
    snapshotEnvironment: async () => ({ id: 'x' }),
    rollbackEnvironment: async () => {},
    applyEnvironmentLimits: async () => {},
    provisioning: { status: async () => ({ ready: true, items: [] }), provision: async () => ({ ready: true, items: [] }) },
    migration: h.service,
  });
  const call = (path, { method = 'GET', admin = true, body = {}, projects = [2] } = {}) => handlers.conversion({
    path,
    method,
    query: {},
    auth: { userId: admin ? 1 : 5, admin, accessibleProjects: projects },
    json: async () => body,
  });
  return { ...h, call };
};

test('the conversion route is administrator only', async () => {
  const h = apiHarness();
  try {
    seedLiveStatic(h);
    assert.equal((await h.call(`/${SITE_ID}`, { admin: false })).status, 403);
    assert.equal((await h.call(`/${SITE_ID}`, { method: 'POST', admin: false, body: { step: 'flip' } })).status, 403);
    assert.equal((await h.call(`/${SITE_ID}`)).status, 200);
  } finally { h.cleanup(); }
});

test('project scoping follows the same rule as every other environment route', async () => {
  const h = apiHarness();
  try {
    seedLiveStatic(h);
    // `canAccessProject` in api.ts short-circuits on `auth.admin`, exactly as it does for control,
    // snapshot, rollback and logs. Inventing a stricter rule for this one route would be an
    // inconsistency nobody could predict, so the check is here to pin the SHARED behaviour.
    assert.equal((await h.call(`/${SITE_ID}`, { projects: [99] })).status, 200);
    // A non-admin is refused before project access is ever consulted.
    assert.equal((await h.call(`/${SITE_ID}`, { admin: false, projects: [2] })).status, 403);
  } finally { h.cleanup(); }
});

test('the route accepts only a named recipe and a known step', async () => {
  const h = apiHarness();
  try {
    seedLiveStatic(h);
    const hostile = await h.call(`/${SITE_ID}`, { method: 'POST', body: { step: 'prepare', recipe: '/etc/passwd' } });
    assert.equal(hostile.status, 400);
    assert.match(hostile.body.error, /unknown conversion recipe/);

    const unknownStep = await h.call(`/${SITE_ID}`, { method: 'POST', body: { step: 'exec', command: 'rm -rf /' } });
    assert.equal(unknownStep.status, 400);
    assert.match(unknownStep.body.error, /unknown conversion step/);

    // Nothing ran for either.
    assert.deepEqual(h.calls.prepareContainer, []);
    assert.equal(h.store.runtimeMigration(SITE_ID), null);
  } finally { h.cleanup(); }
});

test('the route drives prepare, flip and complete against the real service', async () => {
  const h = apiHarness();
  try {
    seedLiveStatic(h);
    const prepared = await h.call(`/${SITE_ID}`, { method: 'POST', body: { step: 'prepare', recipe: 'release-copy' } });
    assert.equal(prepared.status, 200);
    assert.equal(prepared.body.conversion.stage, 'prepared');

    const flipped = await h.call(`/${SITE_ID}`, { method: 'POST', body: { step: 'flip' } });
    assert.equal(flipped.status, 200);
    assert.equal(h.store.siteById(SITE_ID).runtime, 'environment');

    const done = await h.call(`/${SITE_ID}`, { method: 'POST', body: { step: 'complete' } });
    assert.equal(done.body.conversion.stage, 'none');
  } finally { h.cleanup(); }
});

test('a refusal answers 409 and a fault answers 502 with the current stage', async () => {
  const h = apiHarness({ startFails: true });
  try {
    seedLiveStatic(h);
    const early = await h.call(`/${SITE_ID}`, { method: 'POST', body: { step: 'flip' } });
    assert.equal(early.status, 409, 'flipping before preparing is a state the caller can fix');

    await h.call(`/${SITE_ID}`, { method: 'POST', body: { step: 'prepare', recipe: 'release-copy' } });
    const broken = await h.call(`/${SITE_ID}`, { method: 'POST', body: { step: 'flip' } });
    assert.equal(broken.status, 502);
    assert.equal(broken.body.conversion.stage, 'flipped', 'the durable stage is reported with the fault');
  } finally { h.cleanup(); }
});

test('the route refuses every step while persistent environments are turned off', async () => {
  const h = apiHarness({ allowEnvironments: false });
  try {
    seedLiveStatic(h);
    const refused = await h.call(`/${SITE_ID}`, { method: 'POST', body: { step: 'prepare', recipe: 'release-copy' } });
    assert.equal(refused.status, 403);
    // Reading remains allowed, so an operator can still see what an earlier conversion left behind.
    assert.equal((await h.call(`/${SITE_ID}`)).status, 200);
  } finally { h.cleanup(); }
});

test('the collection endpoint lists unfinished conversions for an administrator', async () => {
  const h = apiHarness();
  try {
    seedLiveStatic(h);
    assert.deepEqual((await h.call('/')).body.pending, []);
    await h.call(`/${SITE_ID}`, { method: 'POST', body: { step: 'prepare', recipe: 'release-copy' } });
    const pending = (await h.call('/')).body.pending;
    assert.equal(pending.length, 1);
    assert.equal(pending[0].siteId, SITE_ID);
  } finally { h.cleanup(); }
});

// --- SHARED HOME: two sites confined to one sandbox home ---------------------------------------------
// On the live fleet two of the three command sites share a home. A capture that took the home would put
// the neighbour's database and credentials into this site's archive, volume and rollback.

test('capturing a whole home is not expressible', () => {
  const home = '/home/shared';
  for (const includes of [[], ['.'], [''], ['./'], ['..'], ['/'], ['   ']]) {
    assert.throws(() => assertAppOwnedSelection({ home, includes }), /capture/i, `includes=${JSON.stringify(includes)}`);
  }
});

test('a capture path may not escape into the neighbour sharing the home', () => {
  const home = '/home/shared';
  assert.throws(() => assertAppOwnedSelection({ home, includes: ['../other-home/data'] }), /inside the home/);
  // Normalised, not just prefix-checked: this one has no leading `..` at all.
  assert.throws(
    () => assertAppOwnedSelection({ home, includes: ['.local/share/mine/../../../../etc'] }),
    /inside the home/,
  );
  assert.throws(() => assertAppOwnedSelection({ home, includes: ['/etc/shadow'] }), /relative to the home/);
  // What a real app subtree looks like, normalised and accepted.
  assert.deepEqual(
    assertAppOwnedSelection({ home, includes: ['.local/share/app-a/', './.local/share/app-b'] }),
    ['.local/share/app-a', '.local/share/app-b'],
  );
});

test('two sites sharing one home each capture only their own subtree', async () => {
  const a = harness({ includes: ['.local/share/app-a'] });
  try {
    // One home, two apps, exactly the live shape.
    const shared = a.legacyHome;
    mkdirSync(join(shared, '.local/share/app-a'), { recursive: true });
    mkdirSync(join(shared, '.local/share/app-b'), { recursive: true });
    writeFileSync(join(shared, '.local/share/app-a/data.db'), 'SITE-A-ROWS');
    writeFileSync(join(shared, '.local/share/app-b/data.db'), 'SITE-B-ROWS');
    writeFileSync(join(shared, '.local/share/app-b/auth.json'), 'SITE-B-CREDENTIALS');
    writeFileSync(join(shared, '.bash_history'), 'USER-LEVEL-SECRET');

    const archive = await a.dataSync.captureLegacyData(SITE_ID, { home: shared, includes: ['.local/share/app-a'] });

    // Unpack the archive somewhere clean and prove the neighbour is simply not in it.
    const unpacked = join(a.root, 'unpacked');
    mkdirSync(unpacked, { recursive: true });
    await a.realTar(['-xf', archive, '-C', unpacked]);
    assert.equal(readFileSync(join(unpacked, '.local/share/app-a/data.db'), 'utf8'), 'SITE-A-ROWS');
    assert.equal(existsSync(join(unpacked, '.local/share/app-b')), false, 'the neighbouring site is not captured');
    assert.equal(existsSync(join(unpacked, '.bash_history')), false, 'user-level files are not captured');
  } finally { a.cleanup(); }
});

test('a restore into a shared home writes only this app\'s subtree', async () => {
  const h = harness();
  const includes = ['.local/share/app-a'];
  try {
    const shared = h.legacyHome;
    mkdirSync(join(shared, '.local/share/app-a'), { recursive: true });
    writeFileSync(join(shared, '.local/share/app-a/data.db'), 'OLD-A');
    // The neighbour is live and must come through the restore untouched.
    mkdirSync(join(shared, '.local/share/app-b'), { recursive: true });
    writeFileSync(join(shared, '.local/share/app-b/data.db'), 'LIVE-B');

    // An archive that ALSO carries a member for the neighbour, as a hostile or buggy export would.
    const staging = join(h.root, 'hostile');
    mkdirSync(join(staging, '.local/share/app-a'), { recursive: true });
    mkdirSync(join(staging, '.local/share/app-b'), { recursive: true });
    writeFileSync(join(staging, '.local/share/app-a/data.db'), 'NEW-A');
    writeFileSync(join(staging, '.local/share/app-b/data.db'), 'OVERWRITE-B');
    const archive = join(h.root, 'hostile.tar');
    await h.realTar(['-cf', archive, '-C', staging, '--', '.local/share/app-a', '.local/share/app-b']);

    await h.dataSync.restoreLegacyData({ home: shared, includes }, archive);

    assert.equal(readFileSync(join(shared, '.local/share/app-a/data.db'), 'utf8'), 'NEW-A');
    assert.equal(
      readFileSync(join(shared, '.local/share/app-b/data.db'), 'utf8'),
      'LIVE-B',
      'extraction is confined to the named members, so a stray archive member cannot overwrite the neighbour',
    );
  } finally { h.cleanup(); }
});

test('a site with no app-owned subtree converts without any capture at all', async () => {
  const h = harness({ legacyRunning: true, noLegacyHome: true, includes: [], runningHome: null });
  try {
    h.store.insertSite(legacySite({ runtime: 'command', startCommand: 'node server.js' }));
    h.store.insertRelease(release());
    h.seedRelease(SITE_ID, RELEASE_ID, { 'server.js': 'run()' });

    await h.service.prepare(SITE_ID, 'release-copy');
    await h.service.flip(SITE_ID);

    // The volume is still seeded: the provisioning script and the application unit travel through it
    // even when there is no data to carry.
    assert.equal(h.calls.loadDataVolume.length, 1);
    assert.equal(existsSync(h.dataSync.archivePath(SITE_ID, 'legacy-data.tar')), false, 'nothing was captured');
    assert.equal(h.store.siteById(SITE_ID).runtime, 'environment');
  } finally { h.cleanup(); }
});

// --- executable recipe and base app provisioning -----------------------------------------------------

test('a recipe refuses argv, env and data shapes it cannot vouch for', () => {
  assert.throws(() => parseAppRecipe(null), /must be a JSON object/);
  assert.throws(() => parseAppRecipe({ kind: 'whatever', argv: ['/usr/bin/node'] }), /unknown recipe kind/);
  assert.throws(() => parseAppRecipe({ kind: 'node-app', argv: [] }), /non-empty array/);
  assert.throws(() => parseAppRecipe({ kind: 'node-app', argv: ['/usr/bin/node\u0000x'] }), /NUL byte/);
  // A shell string is not argv; every quoting mistake in a manifest would otherwise be a code path.
  assert.throws(() => parseAppRecipe({ kind: 'node-app', argv: '/usr/bin/node server.js' }), /non-empty array/);
  assert.throws(() => parseAppRecipe({ kind: 'node-app', argv: ['/x'], env: { HOME: '/tmp' } }), /must not set HOME/);
  assert.throws(() => parseAppRecipe({ kind: 'node-app', argv: ['/x'], env: { PATH: '/tmp' } }), /must not set PATH/);
  assert.throws(() => parseAppRecipe({ kind: 'node-app', argv: ['/x'], env: { 'bad name': 'v' } }), /plain variable name/);
  // A newline would close the assignment and open a new directive in the generated unit.
  assert.throws(() => parseAppRecipe({ kind: 'node-app', argv: ['/x'], env: { A: 'v\nExecStart=/evil' } }), /single line/);
  assert.throws(() => parseAppRecipe({ kind: 'node-app', argv: ['/x'], dataDir: '/etc' }), /must resolve under \/data/);
  // Canonical containment, not a prefix test: both of these used to pass `startsWith('/data')`.
  assert.throws(() => parseAppRecipe({ kind: 'node-app', argv: ['/x'], dataDir: '/datax' }), /must resolve under \/data/);
  assert.throws(() => parseAppRecipe({ kind: 'node-app', argv: ['/x'], dataDir: '/data/../../etc' }), /must resolve under \/data/);
  assert.equal(parseAppRecipe({ kind: 'node-app', argv: ['/x'], dataDir: '/data/app/' }).dataDir, '/data/app');
  // The capture validator is applied at READ time, so a bad manifest is refused before a site is stopped.
  assert.throws(() => parseAppRecipe({ kind: 'node-app', argv: ['/x'], dataIncludes: ['.'] }), /not the home itself/);
  assert.throws(() => parseAppRecipe({ kind: 'node-app', argv: ['/x'], dataIncludes: ['../nope'] }), /inside the home/);
});

test('a valid recipe normalises its data includes and defaults its data directory', () => {
  const recipe = parseAppRecipe({
    kind: 'node-app',
    argv: ['/usr/bin/node', 'server.mjs'],
    env: { DEV_PORT: '80' },
    dataIncludes: ['.local/share/example-app/'],
  });
  assert.equal(recipe.dataDir, '/data');
  assert.deepEqual(recipe.dataIncludes, ['.local/share/example-app']);
  assert.deepEqual(recipe.argv, ['/usr/bin/node', 'server.mjs']);
});

test('the generated unit actually serves: working directory, app-owned home and the app argv', () => {
  const unit = appUnit(parseAppRecipe({
    kind: 'node-app',
    argv: ['/usr/bin/node', 'server.mjs'],
    env: { DEV_PORT: '80' },
    dataIncludes: ['.local/share/example-app'],
  }));
  assert.match(unit, /WorkingDirectory=\/workspace/);
  assert.match(unit, /Environment=HOME=\/data/);
  assert.match(unit, /EnvironmentFile=\/etc\/elowen-app-recipe\.env/);
  assert.match(unit, /ExecStart="\/usr\/bin\/node" "server\.mjs"/);
  assert.match(unit, /WantedBy=multi-user\.target/);
  assert.match(unit, /Restart=always/);
});

test('a recipe value carrying unit syntax cannot inject a directive', () => {
  // The single-line rule already refuses a newline; this pins that a `$` is escaped rather than expanded
  // and that quoting survives into ExecStart.
  const unit = appUnit(parseAppRecipe({
    kind: 'node-app',
    argv: ['/usr/bin/node', 'a b.mjs', '--flag="x"'],
    env: { TOKEN_HINT: 'literal $NOT_EXPANDED' },
  }));
  assert.doesNotMatch(unit, /TOKEN_HINT|NOT_EXPANDED/);
  const script = provisionScript(parseAppRecipe({ kind: 'node-app', argv: ['/x'], env: { TOKEN_HINT: 'literal $NOT_EXPANDED' } }));
  const encoded = script.match(/printf '%s' '([^']*)'/)[1];
  assert.equal(Buffer.from(encoded, 'base64').toString(), 'TOKEN_HINT="literal \\$NOT_EXPANDED"\n');
  assert.match(unit, /ExecStart=.*"a b\.mjs"/);
  assert.match(unit, /\\"x\\"/);
  assert.equal(unit.split('\n').filter((line) => line.startsWith('ExecStart=')).length, 1);
});

test('the provision script unpacks the capture and enables the app, idempotently', () => {
  const script = provisionScript(parseAppRecipe({
    kind: 'node-app', argv: ['/usr/bin/node', 'server.js'], secretFiles: ['.env', 'config.json'],
  }));
  // One install line per secret the recipe names, at the release-relative path the app already reads.
  assert.match(script, /install -m 0600 '\/data\/\.elowen-conversion\/secrets\/\.env' '\/workspace\/\.env'/);
  assert.match(script, /install -m 0600 '.*secrets\/config\.json' '\/workspace\/config\.json'/);
  assert.match(script, /^#!\/bin\/sh/);
  assert.match(script, /set -eu/);
  assert.match(script, /install -m 0644 '\/data\/\.elowen-conversion\/elowen-app\.service' \/etc\/systemd\/system\//);
  assert.match(script, /tar -xf '\/data\/\.elowen-conversion\/legacy-data\.tar' -C '\/data'/);
  assert.match(script, /systemctl enable --now elowen-app\.service/);
  // The data step is conditional, so a rerun on a container that already has it is harmless.
  assert.match(script, /if \[ -f /);
  // Staged credentials do not outlive the boot that consumed them.
  assert.match(script, /rm -rf '\/data\/\.elowen-conversion\/secrets'/);
});

test('a missing recipe is a refusal, never an assumed default', () => {
  const h = harness();
  try {
    assert.throws(
      () => loadAppRecipe(migrationArtifactDir(join(h.root, 'sites', SITE_ID))),
      /no conversion recipe/,
    );
  } finally { h.cleanup(); }
});

test('the base image enables a bootstrap unit that runs the provisioning script', () => {
  assert.match(CONTAINERFILE, /COPY elowen-bootstrap\.service \/etc\/systemd\/system\/elowen-bootstrap\.service/);
  assert.match(CONTAINERFILE, /systemctl enable elowen-ingress\.socket elowen-bootstrap\.service/);
  assert.match(BOOTSTRAP_SERVICE, /ConditionPathExists=\/data\/\.elowen-conversion\/provision\.sh/);
  // Ordered ahead of the proxy, so nothing is forwarded to a port with no listener behind it.
  assert.match(BOOTSTRAP_SERVICE, /Before=elowen-ingress\.service/);
  assert.match(BOOTSTRAP_SERVICE, /Type=oneshot/);
});

// --- delivery: what actually reaches the container ---------------------------------------------------

test('the volume seed carries the unit, the script, the capture and the secrets', async () => {
  const h = harness({ legacyRunning: true });
  try {
    h.store.insertSite(legacySite({ runtime: 'command', startCommand: 'node server.mjs' }));
    h.store.insertRelease(release());
    h.seedRelease(SITE_ID, RELEASE_ID, { 'server.mjs': 'run()', '.env': 'TOKEN=abc\n' });
    mkdirSync(join(h.legacyHome, '.local/share/this-app'), { recursive: true });
    writeFileSync(join(h.legacyHome, '.local/share/this-app/data.db'), 'ROWS');

    await h.service.prepare(SITE_ID, 'release-copy');
    await h.service.flip(SITE_ID);

    const seed = h.calls.loadDataVolume[0].seedArchive;
    const unpacked = join(h.root, 'seed-unpacked');
    mkdirSync(unpacked, { recursive: true });
    await h.realTar(['-xf', seed, '-C', unpacked]);

    const stage = join(unpacked, '.elowen-conversion');
    assert.equal(existsSync(join(stage, 'provision.sh')), true);
    assert.equal(existsSync(join(stage, 'elowen-app.service')), true);
    assert.equal(existsSync(join(stage, 'legacy-data.tar')), true);
    assert.equal(readFileSync(join(stage, 'secrets/.env'), 'utf8'), 'TOKEN=abc\n');
    // The unit that ships is the one the recipe generated, so the container really has something to run.
    assert.match(readFileSync(join(stage, 'elowen-app.service'), 'utf8'), /ExecStart="\/usr\/bin\/node" "server\.mjs"/);
  } finally { h.cleanup(); }
});

test('a stateless conversion still ships a runnable unit', async () => {
  const h = harness({ legacyRunning: true, noLegacyHome: true, includes: [], runningHome: null });
  try {
    h.store.insertSite(legacySite({ runtime: 'command', startCommand: 'node server.js' }));
    h.store.insertRelease(release());
    h.seedRelease(SITE_ID, RELEASE_ID, { 'server.js': 'run()' });

    await h.service.prepare(SITE_ID, 'release-copy');
    await h.service.flip(SITE_ID);

    const unpacked = join(h.root, 'seed-stateless');
    mkdirSync(unpacked, { recursive: true });
    await h.realTar(['-xf', h.calls.loadDataVolume[0].seedArchive, '-C', unpacked]);
    const stage = join(unpacked, '.elowen-conversion');
    assert.equal(existsSync(join(stage, 'elowen-app.service')), true);
    assert.equal(existsSync(join(stage, 'legacy-data.tar')), false, 'no capture, and none invented');
  } finally { h.cleanup(); }
});

test('the seed staging tree does not survive the pack', async () => {
  const h = harness();
  try {
    const seed = await h.dataSync.buildSeedArchive(SITE_ID, {
      provisionScript: '#!/bin/sh\ntrue\n', appUnit: '[Unit]\n', dataArchive: null,
    });
    assert.equal(existsSync(seed), true);
    assert.equal(existsSync(h.dataSync.archivePath(SITE_ID, 'seed')), false, 'plaintext staging is not left behind');
  } finally { h.cleanup(); }
});

test('the recipe chooses the derivative image', async () => {
  const nodeSite = harness();
  try {
    seedLiveStatic(nodeSite);
    await nodeSite.service.prepare(SITE_ID, 'release-copy');
    assert.equal(nodeSite.calls.prepareContainer[0].image, 'node');
  } finally { nodeSite.cleanup(); }

  const staticSite = harness({ recipe: { kind: 'release-copy', argv: ['/usr/sbin/nginx'] }, includes: [] });
  try {
    seedLiveStatic(staticSite);
    await staticSite.service.prepare(SITE_ID, 'release-copy');
    assert.equal(staticSite.calls.prepareContainer[0].image, 'static');
  } finally { staticSite.cleanup(); }
});

// --- conversion images -------------------------------------------------------------------------------

test('the shared base image gains no nginx and no Node', () => {
  // Every ordinary environment boots the base. A conversion must not widen what they all run.
  assert.equal(/nginx/.test(CONTAINERFILE), false);
  assert.equal(/nodejs|node_/.test(CONTAINERFILE), false);
  assert.equal(CONTAINERFILE.includes(NODE_IMAGE_REF), false);
});

test('the derivatives build FROM the base so its layers are reused', () => {
  assert.ok(STATIC_CONTAINERFILE.startsWith(`FROM ${BASE_IMAGE_TAG}`));
  assert.match(STATIC_CONTAINERFILE, /apt-get install -y --no-install-recommends nginx/);
  assert.match(STATIC_CONTAINERFILE, /systemctl enable nginx/);
  assert.ok(NODE_CONTAINERFILE.includes(`FROM ${BASE_IMAGE_TAG}`));
});

test('the Node runtime is pinned by digest and copied multi-stage, never apt and never a floating tag', () => {
  assert.match(NODE_IMAGE_SOURCE, /^docker\.io\/library\/node:24\.20\.0-bookworm-slim@sha256:[0-9a-f]{64}$/);
  assert.match(NODE_CONTAINERFILE, /^FROM .*@sha256:[0-9a-f]{64} AS runtime/m);
  assert.match(NODE_CONTAINERFILE, /COPY --from=runtime \/usr\/local\/bin\/node/);
  // A build that produced a broken interpreter must fail at build time, not at first request.
  assert.match(NODE_CONTAINERFILE, /node --version/);
  assert.equal(/apt-get install .*nodejs/.test(NODE_CONTAINERFILE), false);
  // bookworm-slim so the copied binary's glibc matches the Debian base it lands on.
  assert.ok(NODE_IMAGE_VERSION.endsWith('-bookworm-slim'));
});

test('derivative tags fold in the base tag, so a base change cannot leave a stale derivative', () => {
  for (const tag of [conversionImageTag('static'), conversionImageTag('node')]) {
    assert.match(tag, /^localhost\/elowen-site-(static|node):[0-9a-f]{16}$/);
  }
  assert.notEqual(conversionImageTag('static'), conversionImageTag('node'));
});

test('the static image serves the staged workspace on the port the ingress proxy forwards to', () => {
  assert.match(STATIC_SITE_CONF, /listen 127\.0\.0\.1:80/);
  assert.match(STATIC_SITE_CONF, /root \/workspace;/);
});

// --- reviewer defects: one regression per finding, each red without its fix ---------------------------

const flipped = async (h, extra = {}) => {
  h.store.insertSite(legacySite({ runtime: 'command', startCommand: 'node server.mjs', ...extra }));
  h.store.insertRelease(release());
  h.seedRelease(SITE_ID, RELEASE_ID, { 'server.mjs': 'run()' });
  mkdirSync(join(h.legacyHome, '.local/share/this-app'), { recursive: true });
  writeFileSync(join(h.legacyHome, '.local/share/this-app/data.db'), 'ROWS-BEFORE');
  await h.service.prepare(SITE_ID, 'release-copy');
  await h.service.flip(SITE_ID);
};

test('D1 the container is quiesced and verified stopped before its volume is exported', async () => {
  const h = harness({ legacyRunning: true, containerWrote: true });
  const order = [];
  try {
    await flipped(h);
    const realStop = h.deps.stopContainer;
    h.deps.stopContainer = async (...a) => { order.push('stop'); return realStop(...a); };
    const realExport = h.deps.exportDataVolume;
    h.deps.exportDataVolume = async (...a) => { order.push('export'); return realExport(...a); };

    await h.service.rollback(SITE_ID);
    assert.deepEqual(order, ['stop', 'export'], 'exporting a live volume captures a torn database');
  } finally { h.cleanup(); }
});

test('D1 a container that refuses to stop aborts the rollback instead of exporting live data', async () => {
  const h = harness({ legacyRunning: true, containerWrote: true, containerWontStop: true });
  try {
    await flipped(h);
    await assert.rejects(() => h.service.rollback(SITE_ID), /still running, so its data cannot be exported/);
    assert.deepEqual(h.calls.exportDataVolume, [], 'nothing was exported from a live container');
    assert.equal(h.store.siteById(SITE_ID).runtime, 'environment', 'the site was not half-reverted');
  } finally { h.cleanup(); }
});

test('D2 a flip that fails after the quiesce leaves a durable marker, and recovery restarts the legacy site', async () => {
  const h = harness({ legacyRunning: true });
  try {
    h.store.insertSite(legacySite({ runtime: 'command', startCommand: 'node server.mjs' }));
    h.store.insertRelease(release());
    h.seedRelease(SITE_ID, RELEASE_ID, { 'server.mjs': 'run()' });
    mkdirSync(join(h.legacyHome, '.local/share/this-app'), { recursive: true });
    writeFileSync(join(h.legacyHome, '.local/share/this-app/data.db'), 'ROWS');
    await h.service.prepare(SITE_ID, 'release-copy');

    // The seed blows up after the legacy process is already down: the site is dark.
    h.deps.loadDataVolume = async () => { throw new Error('seed exploded'); };
    await assert.rejects(() => h.service.flip(SITE_ID), /seed exploded/);

    assert.equal(h.store.runtimeMigration(SITE_ID).legacyStopped, true, 'the stop is recorded durably');
    assert.deepEqual(h.calls.startLegacy, [], 'nothing has restarted it yet');

    // A restart lands here. Recovery is what owes the site its runtime back.
    await h.service.recoverInterrupted();
    assert.deepEqual(h.calls.startLegacy, [SITE_ID], 'the dark site is brought back');
    assert.equal(h.store.runtimeMigration(SITE_ID).legacyStopped, false);
  } finally { h.cleanup(); }
});

test('D2 rolling back a never-flipped conversion restarts a legacy runtime the flip had stopped', async () => {
  const h = harness({ legacyRunning: true });
  try {
    h.store.insertSite(legacySite({ runtime: 'command', startCommand: 'node server.mjs' }));
    h.store.insertRelease(release());
    h.seedRelease(SITE_ID, RELEASE_ID, { 'server.mjs': 'run()' });
    mkdirSync(join(h.legacyHome, '.local/share/this-app'), { recursive: true });
    writeFileSync(join(h.legacyHome, '.local/share/this-app/data.db'), 'ROWS');
    await h.service.prepare(SITE_ID, 'release-copy');
    h.deps.loadDataVolume = async () => { throw new Error('seed exploded'); };
    await assert.rejects(() => h.service.flip(SITE_ID), /seed exploded/);

    await h.service.rollback(SITE_ID);
    assert.deepEqual(h.calls.startLegacy, [SITE_ID], 'a rollback must not walk away from a dark site');
    assert.equal(h.store.siteById(SITE_ID).runtime, 'command');
  } finally { h.cleanup(); }
});

test('D2 recovery that cannot restart the legacy runtime keeps the marker for the next boot', async () => {
  const h = harness({ legacyRunning: true });
  try {
    h.store.insertSite(legacySite({ runtime: 'command', startCommand: 'node server.mjs' }));
    h.store.insertRelease(release());
    h.seedRelease(SITE_ID, RELEASE_ID, { 'server.mjs': 'run()' });
    mkdirSync(join(h.legacyHome, '.local/share/this-app'), { recursive: true });
    writeFileSync(join(h.legacyHome, '.local/share/this-app/data.db'), 'ROWS');
    await h.service.prepare(SITE_ID, 'release-copy');
    h.deps.loadDataVolume = async () => { throw new Error('seed exploded'); };
    await assert.rejects(() => h.service.flip(SITE_ID), /seed exploded/);

    h.deps.startLegacyRuntime = async () => { throw new Error('start exploded'); };
    await h.service.recoverInterrupted();
    assert.equal(h.store.runtimeMigration(SITE_ID).legacyStopped, true, 'still owed, so the next boot retries');
    assert.match(h.store.runtimeMigration(SITE_ID).lastError, /could not be restarted/);
  } finally { h.cleanup(); }
});

test('D3 re-preparing removes the stale container before replacing the tree it mounts', async () => {
  const workspaceOf = (root) => join(root, 'sites', SITE_ID, 'migration', 'workspace');
  const h = harness();
  try {
    seedLiveStatic(h);
    h.deps.inspectOwnership = async () => ({ owned: true, workspace: workspaceOf(h.root), detail: 'ours' });
    await h.service.prepare(SITE_ID, 'release-copy');
    // The container that mounted the OLD inode is discarded, so nothing is left pointing at a deleted tree.
    assert.deepEqual(h.calls.discardContainer, [SITE_ID]);
    assert.equal(h.calls.prepareContainer.length, 1, 'and a fresh one is built over the new tree');
  } finally { h.cleanup(); }
});

test('D3 a container mounting a different workspace is rebuilt rather than silently reused', async () => {
  const h = harness();
  try {
    seedLiveStatic(h);
    // Ours, but pointing at a tree this conversion did not stage. Discarding and rebuilding is the safe
    // resolution: refusing would leave the operator stuck behind a container only this code can remove.
    h.deps.inspectOwnership = async () => ({ owned: true, workspace: '/somewhere/else', detail: 'ours, stale mount' });
    await h.service.prepare(SITE_ID, 'release-copy');
    assert.deepEqual(h.calls.discardContainer, [SITE_ID]);
    assert.equal(h.calls.prepareContainer.length, 1, 'rebuilt over the tree this conversion staged');
    assert.equal(h.calls.prepareContainer[0].workspace, stagedWorkspace(h.deps, SITE_ID));
  } finally { h.cleanup(); }
});

test('D4 a rollback whose restore fails keeps the archive and does not revert the site', async () => {
  const h = harness({ legacyRunning: true, containerWrote: true, restoreFailsOnce: true });
  try {
    await flipped(h);
    await assert.rejects(() => h.service.rollback(SITE_ID), /restore exploded/);

    const slot = h.store.runtimeMigration(SITE_ID);
    // The restore now runs BEFORE the discard, so a failure here leaves the container and its volume
    // intact: the writes are recoverable twice over, from the archive and from the volume itself.
    assert.equal(slot.rollbackStage, 'exported', 'progress is durable, so a retry resumes here');
    assert.deepEqual(h.calls.discardContainer, [], 'nothing was destroyed before the data was back');
    assert.notEqual(slot.rollbackArchive, null, 'the container writes are still recoverable');
    assert.equal(existsSync(slot.rollbackArchive), true);
    assert.equal(h.store.siteById(SITE_ID).runtime, 'environment', 'never reverted onto stale data');
  } finally { h.cleanup(); }
});

test('D4 the retry restores from the recorded archive and never re-exports a deleted volume', async () => {
  const h = harness({ legacyRunning: true, containerWrote: true, restoreFailsOnce: true });
  try {
    await flipped(h);
    await assert.rejects(() => h.service.rollback(SITE_ID), /restore exploded/);
    const exportsBefore = h.calls.exportDataVolume.length;

    await h.service.rollback(SITE_ID);

    assert.equal(h.calls.exportDataVolume.length, exportsBefore, 'the volume is gone; the archive is authoritative');
    assert.equal(
      readFileSync(join(h.legacyHome, '.local/share/this-app/data.db'), 'utf8'),
      'WRITTEN-WHILE-CONVERTED',
      'the writes made while converted survived the failed attempt',
    );
    assert.equal(h.store.siteById(SITE_ID).runtime, 'command');
    assert.equal(h.store.runtimeMigration(SITE_ID), null);
  } finally { h.cleanup(); }
});

test('D4 restore is idempotent, so a repeated unpack is harmless', async () => {
  const h = harness();
  const includes = ['.local/share/this-app'];
  try {
    mkdirSync(join(h.legacyHome, '.local/share/this-app'), { recursive: true });
    writeFileSync(join(h.legacyHome, '.local/share/this-app/data.db'), 'V1');
    const archive = await h.dataSync.captureLegacyData(SITE_ID, { home: h.legacyHome, includes });
    writeFileSync(join(h.legacyHome, '.local/share/this-app/data.db'), 'MUTATED');

    await h.dataSync.restoreLegacyData({ home: h.legacyHome, includes }, archive);
    const once = readFileSync(join(h.legacyHome, '.local/share/this-app/data.db'), 'utf8');
    await h.dataSync.restoreLegacyData({ home: h.legacyHome, includes }, archive);
    const twice = readFileSync(join(h.legacyHome, '.local/share/this-app/data.db'), 'utf8');
    assert.equal(once, 'V1');
    assert.equal(twice, once);
  } finally { h.cleanup(); }
});

test('D5 completing refuses a flip whose start failed and one that is not answering', async () => {
  const failedStart = harness({ startFails: true });
  try {
    seedLiveStatic(failedStart);
    await failedStart.service.prepare(SITE_ID, 'release-copy');
    await assert.rejects(() => failedStart.service.flip(SITE_ID), /start exploded/);
    await assert.rejects(() => failedStart.service.complete(SITE_ID), /failed and cannot be completed/);
    assert.notEqual(failedStart.store.runtimeMigration(SITE_ID), null, 'the way back is not dropped');
  } finally { failedStart.cleanup(); }

  const notReady = harness({ readiness: { ready: false, detail: 'the container is exited' } });
  try {
    seedLiveStatic(notReady);
    await notReady.service.prepare(SITE_ID, 'release-copy');
    await notReady.service.flip(SITE_ID);
    await assert.rejects(() => notReady.service.complete(SITE_ID), /not answering yet/);
    assert.notEqual(notReady.store.runtimeMigration(SITE_ID), null);
  } finally { notReady.cleanup(); }
});

test('D6 a foreign container carrying this site name is refused, never adopted and never deleted', async () => {
  const h = harness();
  try {
    seedLiveStatic(h);
    h.deps.inspectOwnership = async () => ({ owned: false, workspace: null, detail: 'labelled for site other-id' });
    await assert.rejects(() => h.service.prepare(SITE_ID, 'release-copy'), MigrationRefused);
    await assert.rejects(() => h.service.prepare(SITE_ID, 'release-copy'), /not this plugin's/);
    assert.deepEqual(h.calls.discardContainer, [], 'a foreign resource is never destroyed');
    assert.deepEqual(h.calls.prepareContainer, []);
  } finally { h.cleanup(); }
});

test('D7 a sandbox home that differs from the running process home aborts the capture', async () => {
  const h = harness({ legacyRunning: true, runningHome: '/actual/running/home' });
  try {
    h.store.insertSite(legacySite({ runtime: 'command', startCommand: 'node server.mjs' }));
    h.store.insertRelease(release());
    h.seedRelease(SITE_ID, RELEASE_ID, { 'server.mjs': 'run()' });
    await h.service.prepare(SITE_ID, 'release-copy');

    await assert.rejects(() => h.service.flip(SITE_ID), /refusing to capture the wrong home/);
    assert.deepEqual(h.calls.stopLegacy, [], 'the site was never stopped on a wrong premise');
    assert.equal(h.store.siteById(SITE_ID).runtime, 'command');
  } finally { h.cleanup(); }
});

test('D8 the final digest covers the workspace after the secrets left it', async () => {
  const h = harness();
  try {
    h.store.insertSite(legacySite({ runtime: 'command', startCommand: 'node server.mjs' }));
    h.store.insertRelease(release());
    h.seedRelease(SITE_ID, RELEASE_ID, { 'server.mjs': 'run()', '.env': 'A=1\n' });
    await h.service.prepare(SITE_ID, 'release-copy');

    const slot = h.store.runtimeMigration(SITE_ID);
    assert.notEqual(slot.finalDigest, null);
    // The release digest was taken with .env still present, so the two must differ.
    assert.notEqual(slot.finalDigest, slot.contentDigest);
    // And it matches what the flip will re-derive from the workspace as it stands now.
    const workspace = stagedWorkspace(h.deps, SITE_ID);
    const recipe = parseAppRecipe({
      kind: 'node-app', argv: ['/usr/bin/node', 'server.mjs'], env: { DEV_PORT: '80' },
      dataIncludes: ['.local/share/this-app'], secretFiles: ['.env'],
      readiness: { path: '/api/me', expectStatus: 200 },
    });
    assert.equal(finalArtifactDigest(workspace, h.dataSync.stagedSecretDigest(SITE_ID), recipe), slot.finalDigest);
  } finally { h.cleanup(); }
});

test('D8 tampering with the workspace, a secret or the recipe between prepare and flip is caught', async () => {
  for (const tamper of ['workspace', 'secret', 'recipe']) {
    const h = harness({ legacyRunning: true });
    try {
      h.store.insertSite(legacySite({ runtime: 'command', startCommand: 'node server.mjs' }));
      h.store.insertRelease(release());
      h.seedRelease(SITE_ID, RELEASE_ID, { 'server.mjs': 'run()', '.env': 'A=1\n' });
      await h.service.prepare(SITE_ID, 'release-copy');

      if (tamper === 'workspace') {
        writeFileSync(join(stagedWorkspace(h.deps, SITE_ID), 'server.mjs'), 'EVIL()');
      } else if (tamper === 'secret') {
        rmSync(h.dataSync.archivePath(SITE_ID, 'secrets/.env'), { force: true });
      } else {
        h.deps.loadRecipe = () => parseAppRecipe({
          kind: 'node-app', argv: ['/usr/bin/node', 'evil.mjs'], env: { DEV_PORT: '80' },
          dataIncludes: ['.local/share/this-app'], secretFiles: ['.env'],
          readiness: { path: '/api/me', expectStatus: 200 },
        });
      }

      await assert.rejects(() => h.service.flip(SITE_ID), /changed after they were verified/, `tamper=${tamper}`);
      assert.deepEqual(h.calls.stopLegacy, [], `tamper=${tamper}: the live site was never stopped`);
      assert.equal(h.store.siteById(SITE_ID).runtime, 'command');
    } finally { h.cleanup(); }
  }
});

// --- reviewer residuals -------------------------------------------------------------------------------

test('R1 the artifact digest covers secret BYTES, so swapping contents is caught', async () => {
  const h = harness({ legacyRunning: true });
  try {
    h.store.insertSite(legacySite({ runtime: 'command', startCommand: 'node server.mjs' }));
    h.store.insertRelease(release());
    h.seedRelease(SITE_ID, RELEASE_ID, { 'server.mjs': 'run()', '.env': 'TOKEN=mine\n' });
    await h.service.prepare(SITE_ID, 'release-copy');

    const before = h.dataSync.stagedSecretDigest(SITE_ID);
    // Same name, same count, different bytes: a name-based digest would not notice.
    writeFileSync(h.dataSync.archivePath(SITE_ID, 'secrets/.env'), 'TOKEN=someone-elses\n');
    assert.notEqual(h.dataSync.stagedSecretDigest(SITE_ID), before);

    await assert.rejects(() => h.service.flip(SITE_ID), /changed after they were verified/);
    assert.deepEqual(h.calls.stopLegacy, []);
  } finally { h.cleanup(); }
});

test('R1 the seed is re-verified immediately before it is packed', async () => {
  const h = harness({ legacyRunning: true });
  try {
    h.store.insertSite(legacySite({ runtime: 'command', startCommand: 'node server.mjs' }));
    h.store.insertRelease(release());
    h.seedRelease(SITE_ID, RELEASE_ID, { 'server.mjs': 'run()', '.env': 'A=1\n' });
    mkdirSync(join(h.legacyHome, '.local/share/this-app'), { recursive: true });
    writeFileSync(join(h.legacyHome, '.local/share/this-app/data.db'), 'ROWS');
    await h.service.prepare(SITE_ID, 'release-copy');

    // Tamper DURING the flip, after the first check and before the pack.
    h.deps.captureLegacyData = async (siteId, selection) => {
      writeFileSync(join(stagedWorkspace(h.deps, SITE_ID), 'server.mjs'), 'SWAPPED()');
      return h.dataSync.captureLegacyData(siteId, selection);
    };
    await assert.rejects(() => h.service.flip(SITE_ID), /changed after they were verified/);
    assert.deepEqual(h.calls.loadDataVolume, [], 'nothing unverified reached the volume');
  } finally { h.cleanup(); }
});

test('R2 readiness asks the recipe invariant, and completion waits for it', async () => {
  const h = harness({ readiness: { ready: false, detail: 'GET /api/me answered 502, expected 200' } });
  try {
    seedLiveStatic(h);
    await h.service.prepare(SITE_ID, 'release-copy');
    await h.service.flip(SITE_ID);
    await assert.rejects(() => h.service.complete(SITE_ID), /answered 502/);
    // The way back survives, because completion is the point of no return.
    assert.notEqual(h.store.runtimeMigration(SITE_ID), null);
    assert.equal(h.store.runtimeMigration(SITE_ID).rollbackStage, 'none');
    await h.service.rollback(SITE_ID);
    assert.equal(h.store.siteById(SITE_ID).runtime, 'static');
  } finally { h.cleanup(); }
});

test('R2 a recipe declares its own invariant and refuses a nonsense one', () => {
  const r = parseAppRecipe({ kind: 'node-app', argv: ['/x'], readiness: { path: '/healthz', expectStatus: 200 } });
  assert.deepEqual(r.readiness, { path: '/healthz', expectStatus: 200 });
  assert.throws(() => parseAppRecipe({ kind: 'node-app', argv: ['/x'], readiness: { path: 'healthz' } }), /absolute/);
  assert.throws(() => parseAppRecipe({ kind: 'node-app', argv: ['/x'], readiness: { path: '/a/../b' } }), /traverse/);
  assert.throws(() => parseAppRecipe({ kind: 'node-app', argv: ['/x'], readiness: { expectStatus: 99 } }), /status code/);
});

test('R3 a retry cannot re-derive provenance and cannot proceed while a stop is owed', async () => {
  const h = harness({ legacyRunning: true });
  try {
    h.store.insertSite(legacySite({ runtime: 'command', startCommand: 'node server.mjs' }));
    h.store.insertRelease(release());
    h.seedRelease(SITE_ID, RELEASE_ID, { 'server.mjs': 'run()' });
    mkdirSync(join(h.legacyHome, '.local/share/this-app'), { recursive: true });
    writeFileSync(join(h.legacyHome, '.local/share/this-app/data.db'), 'ROWS');
    await h.service.prepare(SITE_ID, 'release-copy');

    h.deps.loadDataVolume = async () => { throw new Error('seed exploded'); };
    await assert.rejects(() => h.service.flip(SITE_ID), /seed exploded/);
    assert.equal(h.store.runtimeMigration(SITE_ID).legacyHome, h.legacyHome, 'provenance is durable');

    // The process is gone now, so a naive retry would have no live home to check against.
    h.deps.runningLegacyHome = () => null;
    await assert.rejects(() => h.service.flip(SITE_ID), /stopped the legacy runtime and has not restored it/);
  } finally { h.cleanup(); }
});

test('R3 a first capture with no running process is refused rather than guessed', async () => {
  const h = harness({ legacyRunning: true, runningHome: null });
  try {
    h.store.insertSite(legacySite({ runtime: 'command', startCommand: 'node server.mjs' }));
    h.store.insertRelease(release());
    h.seedRelease(SITE_ID, RELEASE_ID, { 'server.mjs': 'run()' });
    await h.service.prepare(SITE_ID, 'release-copy');
    await assert.rejects(() => h.service.flip(SITE_ID), /cannot be proven before capture/);
    assert.deepEqual(h.calls.stopLegacy, []);
  } finally { h.cleanup(); }
});

test('R4 a restore replaces the subtree, so a deleted WAL is not resurrected', async () => {
  const h = harness();
  const includes = ['.local/share/this-app'];
  const app = join(h.legacyHome, '.local/share/this-app');
  try {
    // The legacy tree, captured with a WAL and a shm alongside the database.
    mkdirSync(app, { recursive: true });
    writeFileSync(join(app, 'data.db'), 'OLD-DB');
    writeFileSync(join(app, 'data.db-wal'), 'OLD-WAL');
    writeFileSync(join(app, 'data.db-shm'), 'OLD-SHM');
    writeFileSync(join(app, 'stale.txt'), 'OLD-EXTRA');

    // What the container held after checkpointing: no WAL, no shm, no stale file.
    const container = join(h.root, 'container-state', '.local/share/this-app');
    mkdirSync(container, { recursive: true });
    writeFileSync(join(container, 'data.db'), 'NEW-CHECKPOINTED-DB');
    const archive = join(h.root, 'carried.tar');
    await h.realTar(['-cf', archive, '-C', join(h.root, 'container-state'), '--', '.local/share/this-app']);

    await h.dataSync.restoreLegacyData({ home: h.legacyHome, includes }, archive, SITE_ID);

    assert.equal(readFileSync(join(app, 'data.db'), 'utf8'), 'NEW-CHECKPOINTED-DB');
    // A resurrected WAL belonging to a checkpointed database is applied on open and corrupts it.
    assert.equal(existsSync(join(app, 'data.db-wal')), false, 'the stale WAL must not come back');
    assert.equal(existsSync(join(app, 'data.db-shm')), false, 'nor the stale shm');
    assert.equal(existsSync(join(app, 'stale.txt')), false, 'nor a file the app deleted');
  } finally { h.cleanup(); }
});

test('R4 a failed unpack puts the original subtree back, and a crash mid-swap is recoverable', async () => {
  const h = harness();
  const includes = ['.local/share/this-app'];
  const app = join(h.legacyHome, '.local/share/this-app');
  try {
    mkdirSync(app, { recursive: true });
    writeFileSync(join(app, 'data.db'), 'ORIGINAL');

    // A corrupt archive: the move-aside succeeds, the unpack does not.
    const bad = join(h.root, 'corrupt.tar');
    writeFileSync(bad, 'not a tar at all');
    await assert.rejects(() => h.dataSync.restoreLegacyData({ home: h.legacyHome, includes }, bad, SITE_ID));
    assert.equal(readFileSync(join(app, 'data.db'), 'utf8'), 'ORIGINAL', 'the app is never left with nothing');

    // Now simulate a crash: the backup exists, the target does not, the journal names the swap.
    const backupRoot = h.dataSync.archivePath(SITE_ID, 'restore-backup');
    mkdirSync(backupRoot, { recursive: true });
    const backup = join(backupRoot, '.local__share__this-app');
    renameSync(app, backup);
    writeFileSync(
      h.dataSync.archivePath(SITE_ID, 'restore-journal.json'),
      JSON.stringify({ include: includes[0], target: app, backup }),
    );
    assert.equal(existsSync(app), false);

    const recovered = h.dataSync.recoverInterruptedRestore(SITE_ID);
    assert.equal(recovered.recovered, includes[0]);
    assert.equal(readFileSync(join(app, 'data.db'), 'utf8'), 'ORIGINAL', 'the crash lost nothing');
  } finally { h.cleanup(); }
});

test('R6 a static recipe refuses secrets and application data outright', () => {
  assert.throws(
    () => parseAppRecipe({ kind: 'release-copy', argv: ['/usr/sbin/nginx'], secretFiles: ['.env'] }),
    /nginx would serve them as files/,
  );
  assert.throws(
    () => parseAppRecipe({ kind: 'release-copy', argv: ['/usr/sbin/nginx'], dataIncludes: ['.local/share/x'] }),
    /no process to own application data/,
  );
  // The same lists are fine on a node recipe, which has a process to hand them to.
  const node = parseAppRecipe({
    kind: 'node-app', argv: ['/usr/bin/node', 's.mjs'], secretFiles: ['.env'], dataIncludes: ['.local/share/x'],
  });
  assert.deepEqual(node.secretFiles, ['.env']);
});

test('R6 a static tree never serves dotfiles, credential names, escapes or symlinked paths', () => {
  for (const bad of ['.env', '.git/config', 'nested/.env', 'config.json', 'auth.json', 'a/.hidden/b', '']) {
    assert.equal(staticServable(bad), false, bad);
  }
  for (const good of ['index.html', 'assets/app.js', 'deep/nested/page.html']) {
    assert.equal(staticServable(good), true, good);
  }
  // nginx enforces the same rule at request time, for anything a release carried undeclared.
  assert.match(STATIC_SITE_CONF, /location ~ \/\\\./);
  assert.match(STATIC_SITE_CONF, /config\\.json\|auth\\.json/);
  assert.match(STATIC_SITE_CONF, /deny all;/);
});

test('R8 a recipe is registered through the API, bound to the site and its current release', async () => {
  const h = apiHarness();
  try {
    seedLiveStatic(h);
    const registered = await h.call(`/${SITE_ID}`, {
      method: 'POST',
      body: { step: 'register', recipe: { kind: 'release-copy', argv: ['/usr/sbin/nginx'] } },
    });
    assert.equal(registered.status, 200);
    assert.equal(registered.body.registered.image, 'static');

    const dir = migrationArtifactDir(join(h.root, 'sites', SITE_ID));
    const binding = recipeBinding(dir);
    assert.deepEqual(binding, { siteId: SITE_ID, expectedReleaseId: RELEASE_ID });
    // Written read-only, so the ordinary path cannot edit an approved recipe.
    assert.equal(statSync(join(dir, 'recipe.json')).mode & 0o777, 0o400);
    // And it round-trips through the loader the conversion uses.
    assert.equal(loadAppRecipe(dir).image, 'static');
  } finally { h.cleanup(); }
});

test('R8 registration refuses an invalid recipe and a non-admin', async () => {
  const h = apiHarness();
  try {
    seedLiveStatic(h);
    const bad = await h.call(`/${SITE_ID}`, {
      method: 'POST',
      body: { step: 'register', recipe: { kind: 'release-copy', argv: ['/usr/sbin/nginx'], secretFiles: ['.env'] } },
    });
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, /serve them as files/);
    assert.equal(recipeBinding(migrationArtifactDir(join(h.root, 'sites', SITE_ID))), null, 'nothing was written');

    const denied = await h.call(`/${SITE_ID}`, {
      method: 'POST', admin: false, body: { step: 'register', recipe: { kind: 'release-copy', argv: ['/x'] } },
    });
    assert.equal(denied.status, 403);
  } finally { h.cleanup(); }
});

test('R8 preparing refuses a recipe approved for a different release', async () => {
  const h = harness({ binding: { siteId: SITE_ID, expectedReleaseId: 'rel-from-last-week' } });
  try {
    seedLiveStatic(h);
    await assert.rejects(() => h.service.prepare(SITE_ID, 'release-copy'), /approved for release rel-from-last-week/);
  } finally { h.cleanup(); }
});

test('R9 archives are created and extracted under an explicit uid and mode policy', async () => {
  const h = harness();
  const includes = ['.local/share/this-app'];
  const app = join(h.legacyHome, '.local/share/this-app');
  try {
    mkdirSync(app, { recursive: true });
    writeFileSync(join(app, 'data.db'), 'ROWS', { mode: 0o600 });
    chmodSync(join(app, 'data.db'), 0o600);

    const archive = await h.dataSync.captureLegacyData(SITE_ID, { home: h.legacyHome, includes });
    const restored = join(h.root, 'restored-modes');
    await h.dataSync.restoreLegacyData({ home: restored, includes }, archive, SITE_ID);

    // Modes survive, because a database's 0600 matters. Ownership does not travel, because rootless
    // uid mapping makes host numbers meaningless on the other side.
    assert.equal(statSync(join(restored, '.local/share/this-app/data.db')).mode & 0o777, 0o600);
  } finally { h.cleanup(); }
});

// --- real-Podman findings ------------------------------------------------------------------------------

test('P1 nginx refuses symlinks below the document root, which is what a dot-pattern cannot catch', () => {
  // The leak a real Podman run found: `public-leak -> .env` is requested as `/public-leak`. No dot, no
  // known credential name, so every path pattern misses it and nginx follows the link to the secret.
  assert.match(STATIC_SITE_CONF, /disable_symlinks on from=\$document_root;/);
  // Scoped below the root on purpose: the host path the workspace is mounted through may traverse a
  // symlink, but nothing inside the served tree may be one.
  assert.equal(/disable_symlinks\s+off/.test(STATIC_SITE_CONF), false);
  // The pattern denies survive as defence in depth, and survive template-literal escaping.
  assert.match(STATIC_SITE_CONF, /location ~ \/\\\./);
  assert.match(STATIC_SITE_CONF, /location ~\* \/\(config\\\.json\|auth\\\.json\)\$/);
});

test('P1 a staged static tree with a symlink to a secret is refused before any container is built', async () => {
  const h = harness({ recipe: { kind: 'release-copy', argv: ['/usr/sbin/nginx'] }, includes: [] });
  try {
    h.store.insertSite(legacySite());
    h.store.insertRelease(release());
    const dir = h.seedRelease(SITE_ID, RELEASE_ID, { 'index.html': '<h1>ok</h1>', '.env': 'TESTONLY_STATIC_SECRET\n' });
    // A URL with no dot in it, pointing at the secret beside it.
    symlinkSync('.env', join(dir, 'public-leak'));

    await assert.rejects(
      () => h.service.prepare(SITE_ID, 'release-copy'),
      /public-leak is a symlink/,
    );
    assert.deepEqual(h.calls.prepareContainer, [], 'nothing was built from a leaking tree');
    assert.equal(h.store.siteById(SITE_ID).runtime, 'static', 'the live site never moved');
  } finally { h.cleanup(); }
});

test('P1 a symlink pointing outside the workspace is refused too', async () => {
  const h = harness({ recipe: { kind: 'release-copy', argv: ['/usr/sbin/nginx'] }, includes: [] });
  try {
    h.store.insertSite(legacySite());
    h.store.insertRelease(release());
    const outside = join(h.root, 'host-secret.txt');
    writeFileSync(outside, 'TESTONLY_STATIC_SECRET\n');
    const dir = h.seedRelease(SITE_ID, RELEASE_ID, { 'index.html': '<h1>ok</h1>' });
    symlinkSync(outside, join(dir, 'looks-normal'));

    await assert.rejects(() => h.service.prepare(SITE_ID, 'release-copy'), /looks-normal is a symlink/);
    assert.deepEqual(h.calls.prepareContainer, []);
  } finally { h.cleanup(); }
});

test('P1 the audit finds undeclared secrets and nested symlinks, and passes a clean tree', () => {
  const root = mkdtempSync(join(tmpdir(), 'static-audit-'));
  try {
    mkdirSync(join(root, 'assets'), { recursive: true });
    writeFileSync(join(root, 'index.html'), '<h1>ok</h1>');
    writeFileSync(join(root, 'assets/app.js'), 'console.log(1)');
    assert.deepEqual(auditStaticTree(root), [], 'a plain published tree is servable');

    writeFileSync(join(root, 'config.json'), '{"token":"TESTONLY_STATIC_SECRET"}');
    symlinkSync('../config.json', join(root, 'assets/innocuous'));
    const offenders = auditStaticTree(root);
    assert.equal(offenders.some((o) => o.startsWith('config.json')), true);
    assert.equal(offenders.some((o) => o.startsWith('assets/innocuous is a symlink')), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('P2 changing the static config or its Containerfile changes the derivative tag', () => {
  // The tag IS the digest of what produced the image, so a security fix to either input produces a new
  // tag and `ensureConversionImage` cannot hand back the old, vulnerable build.
  const a = imageTagFor(BASE_IMAGE_TAG, STATIC_CONTAINERFILE, STATIC_SITE_CONF);
  assert.equal(a, conversionImageTag('static'), 'the published tag is derived from exactly these inputs');
  assert.notEqual(a, imageTagFor(BASE_IMAGE_TAG, STATIC_CONTAINERFILE, `${STATIC_SITE_CONF}\n# changed`));
  assert.notEqual(a, imageTagFor(BASE_IMAGE_TAG, `${STATIC_CONTAINERFILE}\nRUN true`, STATIC_SITE_CONF));
  assert.notEqual(a, imageTagFor('localhost/elowen-site-base:other', STATIC_CONTAINERFILE, STATIC_SITE_CONF));
  // And the current config is the fixed one, so this tag is not the leaking build.
  assert.match(STATIC_SITE_CONF, /disable_symlinks/);
});

test('P2 preparing rebuilds a container created from a superseded image', async () => {
  const h = harness();
  try {
    seedLiveStatic(h);
    // Ours by label, right workspace, but built on the image from before the symlink fix.
    h.deps.inspectOwnership = async (siteId, expect) => ({
      owned: true,
      workspace: expect.workspace,
      detail: `container differs: image localhost/elowen-site-static:OLDVULNERABLE is not ${expect.image}`,
    });
    await h.service.prepare(SITE_ID, 'release-copy');
    assert.deepEqual(h.calls.discardContainer, [SITE_ID], 'the stale build is discarded, never reused');
    assert.equal(h.calls.prepareContainer.length, 1, 'and a fresh one is built on the current image');
  } finally { h.cleanup(); }
});

test('P2 the expected image handed to the ownership check is the recipe derivative', async () => {
  const h = harness();
  const seen = [];
  try {
    seedLiveStatic(h);
    h.deps.inspectOwnership = async (_siteId, expect) => { seen.push(expect); return null; };
    await h.service.prepare(SITE_ID, 'release-copy');
    assert.equal(seen.length, 1);
    assert.equal(seen[0].image, conversionImageTag('node'), 'the default fixture recipe is a node app');
    assert.equal(seen[0].workspace, stagedWorkspace(h.deps, SITE_ID));
  } finally { h.cleanup(); }
});

test('P3 readiness waits out a socket that accepts before the application answers', async () => {
  // The ingress socket listens from boot, so early requests reset while systemd starts the app. A single
  // probe reports that as a failure for a site that is merely still coming up.
  const server = createHttpServer();
  const root = mkdtempSync(join(tmpdir(), 'readiness-'));
  const socketPath = join(root, 'app.sock');
  let live = false;
  server.on('request', (req, res) => {
    if (!live) { req.socket.destroy(); return; }
    res.writeHead(req.url === '/api/me' ? 200 : 404).end();
  });
  await new Promise((r) => server.listen(socketPath, r));
  try {
    const env = readinessHarness(socketPath);
    setTimeout(() => { live = true; }, 400);
    const outcome = await env.probeReadiness(SITE_ID, { path: '/api/me', expectStatus: 200 }, { deadlineMs: 4_000 });
    assert.equal(outcome.ready, true, outcome.detail);
    assert.ok(outcome.attempts > 1, `it retried rather than failing on the first reset (attempts=${outcome.attempts})`);
  } finally {
    await new Promise((r) => server.close(r));
    rmSync(root, { recursive: true, force: true });
  }
});

test('P3 a wrong status is settled immediately and a dead socket gives up with the real error', async () => {
  const server = createHttpServer();
  const root = mkdtempSync(join(tmpdir(), 'readiness-bad-'));
  const socketPath = join(root, 'app.sock');
  server.on('request', (_req, res) => res.writeHead(502).end());
  await new Promise((r) => server.listen(socketPath, r));
  try {
    const env = readinessHarness(socketPath);
    const wrong = await env.probeReadiness(SITE_ID, { path: '/api/me', expectStatus: 200 }, { deadlineMs: 4_000 });
    assert.equal(wrong.ready, false);
    assert.match(wrong.detail, /answered 502, expected 200/);
    assert.equal(wrong.attempts, 1, 'an answering application is settled; retrying would not change it');
  } finally {
    await new Promise((r) => server.close(r));
    rmSync(root, { recursive: true, force: true });
  }

  const gone = mkdtempSync(join(tmpdir(), 'readiness-gone-'));
  try {
    const env = readinessHarness(join(gone, 'nothing.sock'));
    const dead = await env.probeReadiness(SITE_ID, { path: '/', expectStatus: 200 }, { deadlineMs: 600 });
    assert.equal(dead.ready, false);
    // The LAST real transport error is propagated, not swallowed into a generic timeout.
    assert.match(dead.detail, /ENOENT|ECONNREFUSED|failed/);
    assert.match(dead.detail, /gave up after \d+ attempt/);
  } finally { rmSync(gone, { recursive: true, force: true }); }
});

// --- broker directory lifecycle (isolated daemon finding) ----------------------------------------------

/** A static site, the case the real daemon found: nothing has ever created its broker directory. */
const staticNoBroker = (h) => {
  h.store.insertSite(legacySite());
  h.store.insertRelease(release());
  h.seedRelease(SITE_ID, RELEASE_ID, { 'index.html': '<h1>live</h1>' });
};

test('B1 a static site has its broker directory created before the container, through the gateway', async () => {
  const h = harness({ recipe: { kind: 'release-copy', argv: ['/usr/sbin/nginx'] }, includes: [] });
  try {
    staticNoBroker(h);
    assert.equal(existsSync(h.brokerDirOf(SITE_ID)), false, 'nothing has ever made it');

    await h.service.prepare(SITE_ID, 'release-copy');

    // Without this the create fails 125 on statfs, which is exactly what the isolated daemon reported.
    assert.deepEqual(h.calls.prepareBroker, [SITE_ID]);
    assert.equal(existsSync(h.brokerDirOf(SITE_ID)), true);
    assert.equal(h.calls.prepareContainer.length, 1, 'and the container was actually created');
    assert.equal(h.store.runtimeMigration(SITE_ID).brokerPrepared, true, 'ownership is durable');
  } finally { h.cleanup(); }
});

test('B1 a loopback-bound command site is prepared too, because it has no socket directory either', async () => {
  const h = harness({ legacyRunning: true, includes: [] });
  try {
    h.store.insertSite(legacySite({ runtime: 'command', startCommand: 'node server.js', bind: 'port', port: 4610 }));
    h.store.insertRelease(release());
    h.seedRelease(SITE_ID, RELEASE_ID, { 'server.js': 'run()' });

    await h.service.prepare(SITE_ID, 'release-copy');

    assert.deepEqual(h.calls.prepareBroker, [SITE_ID], 'a port-bound runtime never had a broker directory');
    assert.equal(h.calls.prepareContainer.length, 1);
  } finally { h.cleanup(); }
});

test('B2 a socket-bound command site inherits its live directory and it is never re-prepared', async () => {
  const h = harness({ legacyRunning: true, includes: [] });
  try {
    h.store.insertSite(legacySite({ runtime: 'command', startCommand: 'node server.mjs' }));
    h.store.insertRelease(release());
    h.seedRelease(SITE_ID, RELEASE_ID, { 'server.mjs': 'run()' });
    // The live process already had the gateway create this, and is answering on the socket inside it.
    mkdirSync(h.brokerDirOf(SITE_ID), { recursive: true });
    writeFileSync(join(h.brokerDirOf(SITE_ID), 'app.sock'), 'LIVE');

    await h.service.prepare(SITE_ID, 'release-copy');

    // prepare-runtime-socket does rm -rf, so calling it here would delete the socket a serving process
    // is answering on.
    assert.deepEqual(h.calls.prepareBroker, [], 'a live writer\'s directory is left alone');
    assert.equal(readFileSync(join(h.brokerDirOf(SITE_ID), 'app.sock'), 'utf8'), 'LIVE');
    assert.equal(h.store.runtimeMigration(SITE_ID).brokerPrepared, false, 'we do not own it');
    assert.equal(h.calls.prepareContainer.length, 1, 'and the create still succeeded against it');
  } finally { h.cleanup(); }
});

test('B3 rolling back before the flip never removes a live writer\'s directory', async () => {
  const h = harness({ legacyRunning: true, includes: [] });
  try {
    h.store.insertSite(legacySite({ runtime: 'command', startCommand: 'node server.mjs' }));
    h.store.insertRelease(release());
    h.seedRelease(SITE_ID, RELEASE_ID, { 'server.mjs': 'run()' });
    mkdirSync(h.brokerDirOf(SITE_ID), { recursive: true });
    writeFileSync(join(h.brokerDirOf(SITE_ID), 'app.sock'), 'LIVE');

    await h.service.prepare(SITE_ID, 'release-copy');
    await h.service.rollback(SITE_ID);

    assert.deepEqual(h.calls.discard, [{ siteId: SITE_ID, removeBroker: false }]);
    assert.equal(
      readFileSync(join(h.brokerDirOf(SITE_ID), 'app.sock'), 'utf8'),
      'LIVE',
      'the legacy process is still serving on this socket',
    );
  } finally { h.cleanup(); }
});

test('B3 rolling back a static conversion removes only the directory it created', async () => {
  const h = harness({ recipe: { kind: 'release-copy', argv: ['/usr/sbin/nginx'] }, includes: [] });
  try {
    staticNoBroker(h);
    await h.service.prepare(SITE_ID, 'release-copy');
    assert.equal(existsSync(h.brokerDirOf(SITE_ID)), true);

    await h.service.rollback(SITE_ID);

    assert.deepEqual(h.calls.discard, [{ siteId: SITE_ID, removeBroker: true }]);
    assert.equal(existsSync(h.brokerDirOf(SITE_ID)), false, 'ours, so it goes');
  } finally { h.cleanup(); }
});

test('B3 a rebuild during re-preparation keeps the broker, because the legacy may still be serving', async () => {
  const h = harness({ legacyRunning: true, includes: [] });
  try {
    h.store.insertSite(legacySite({ runtime: 'command', startCommand: 'node server.mjs' }));
    h.store.insertRelease(release());
    h.seedRelease(SITE_ID, RELEASE_ID, { 'server.mjs': 'run()' });
    mkdirSync(h.brokerDirOf(SITE_ID), { recursive: true });
    writeFileSync(join(h.brokerDirOf(SITE_ID), 'app.sock'), 'LIVE');
    h.deps.inspectOwnership = async (_id, expect) => ({ owned: true, workspace: expect.workspace, detail: 'stale image' });

    await h.service.prepare(SITE_ID, 'release-copy');

    assert.deepEqual(h.calls.discard, [{ siteId: SITE_ID, removeBroker: false }]);
    assert.equal(readFileSync(join(h.brokerDirOf(SITE_ID), 'app.sock'), 'utf8'), 'LIVE');
  } finally { h.cleanup(); }
});

test('B4 an interrupted preparation removes its own directory but never an inherited one', async () => {
  const ours = harness({ recipe: { kind: 'release-copy', argv: ['/usr/sbin/nginx'] }, includes: [] });
  try {
    staticNoBroker(ours);
    await ours.service.prepare(SITE_ID, 'release-copy');
    ours.store.advanceRuntimeMigration(SITE_ID, 'prepared', 'preparing');
    ours.calls.discard.length = 0;

    await ours.service.recoverInterrupted();
    assert.deepEqual(ours.calls.discard, [{ siteId: SITE_ID, removeBroker: true }]);
    assert.equal(existsSync(ours.brokerDirOf(SITE_ID)), false);
  } finally { ours.cleanup(); }

  const inherited = harness({ legacyRunning: true, includes: [] });
  try {
    inherited.store.insertSite(legacySite({ runtime: 'command', startCommand: 'node server.mjs' }));
    inherited.store.insertRelease(release());
    inherited.seedRelease(SITE_ID, RELEASE_ID, { 'server.mjs': 'run()' });
    mkdirSync(inherited.brokerDirOf(SITE_ID), { recursive: true });
    writeFileSync(join(inherited.brokerDirOf(SITE_ID), 'app.sock'), 'LIVE');
    await inherited.service.prepare(SITE_ID, 'release-copy');
    inherited.store.advanceRuntimeMigration(SITE_ID, 'prepared', 'preparing');
    inherited.calls.discard.length = 0;

    await inherited.service.recoverInterrupted();
    assert.deepEqual(inherited.calls.discard, [{ siteId: SITE_ID, removeBroker: false }]);
    assert.equal(readFileSync(join(inherited.brokerDirOf(SITE_ID), 'app.sock'), 'utf8'), 'LIVE');
  } finally { inherited.cleanup(); }
});

test('B5 the directory this conversion created survives a crashed prepare and is cleaned by recovery', async () => {
  const h = harness({ recipe: { kind: 'release-copy', argv: ['/usr/sbin/nginx'] }, includes: [], prepareFails: true });
  try {
    staticNoBroker(h);
    await assert.rejects(() => h.service.prepare(SITE_ID, 'release-copy'), /container build exploded/);

    // Ownership was recorded BEFORE the gateway call, so a crash on either side leaves a directory the
    // slot knows about rather than an orphan nobody will remove.
    assert.equal(h.store.runtimeMigration(SITE_ID).brokerPrepared, true);
    assert.equal(existsSync(h.brokerDirOf(SITE_ID)), true);

    await h.service.rollback(SITE_ID);
    assert.equal(existsSync(h.brokerDirOf(SITE_ID)), false);
  } finally { h.cleanup(); }
});

// --- API/Podman integration findings --------------------------------------------------------------------

test('I1 a staged static tree is readable by a non-root serving process, and its ancestors traversable', async () => {
  const h = harness({ recipe: { kind: 'release-copy', argv: ['/usr/sbin/nginx'] }, includes: [] });
  try {
    h.store.insertSite(legacySite());
    h.store.insertRelease(release());
    h.seedRelease(SITE_ID, RELEASE_ID, { 'index.html': '<h1>converted-static</h1>', 'assets/app.js': 'x' });

    await h.service.prepare(SITE_ID, 'release-copy');

    // nginx workers drop to a non-root user that maps into the subuid range. On a 0700 tree they get
    // EACCES on /workspace and try_files reports it as a plain 404: a site that serves nothing while
    // every status says the conversion succeeded.
    const workspace = stagedWorkspace(h.deps, SITE_ID);
    assert.equal(statSync(workspace).mode & 0o777, 0o755, 'the mount source is readable');
    assert.equal(statSync(join(workspace, 'index.html')).mode & 0o777, 0o644);
    assert.equal(statSync(join(workspace, 'assets')).mode & 0o777, 0o755, 'nested directories too');
    assert.equal(statSync(join(workspace, 'assets/app.js')).mode & 0o777, 0o644);

    // Ancestors get traversal only, so a worker can walk to the mount source without being able to list
    // what else this site's directory holds.
    for (const ancestor of [join(h.root, 'sites', SITE_ID), join(h.root, 'sites', SITE_ID, 'migration')]) {
      const mode = statSync(ancestor).mode & 0o777;
      assert.equal((mode & 0o111) === 0o111, true, `${ancestor} is traversable`);
      assert.equal((mode & 0o044) === 0, true, `${ancestor} is not listable by group or other`);
    }
  } finally { h.cleanup(); }
});

test('I1 relaxing never widens the secrets beside the tree, and never touches the release', async () => {
  const h = harness({ legacyRunning: true, includes: [] });
  try {
    // A node recipe declaring a secret, so the artefact directory really holds one.
    h.store.insertSite(legacySite({ runtime: 'command', startCommand: 'node server.mjs' }));
    h.store.insertRelease(release());
    const releaseDir = h.seedRelease(SITE_ID, RELEASE_ID, { 'server.mjs': 'run()', '.env': 'CONV_SECRET=1\n' });
    const releaseModeBefore = statSync(join(releaseDir, '.env')).mode & 0o777;

    await h.service.prepare(SITE_ID, 'release-copy');

    // A node conversion is not relaxed at all: its app runs as root inside, which maps to the service
    // account, so 0700 is right and widening it would be gratuitous.
    assert.deepEqual(h.calls.relaxStatic, []);
    assert.equal(statSync(stagedWorkspace(h.deps, SITE_ID)).mode & 0o777, 0o700);

    // The secret artefact stays owner-only whatever happens to the tree beside it.
    const secrets = h.dataSync.archivePath(SITE_ID, 'secrets');
    assert.equal(statSync(secrets).mode & 0o777, 0o700);
    assert.equal(statSync(join(secrets, '.env')).mode & 0o777, 0o600);

    // And the release the copy came from is byte- and mode-identical.
    assert.equal(statSync(join(releaseDir, '.env')).mode & 0o777, releaseModeBefore);
    assert.equal(readFileSync(join(releaseDir, '.env'), 'utf8'), 'CONV_SECRET=1\n');
  } finally { h.cleanup(); }
});

test('I1 a static conversion is relaxed only after its secrets are out and its tree audited', async () => {
  const h = harness({ recipe: { kind: 'release-copy', argv: ['/usr/sbin/nginx'] }, includes: [] });
  try {
    h.store.insertSite(legacySite());
    h.store.insertRelease(release());
    const dir = h.seedRelease(SITE_ID, RELEASE_ID, { 'index.html': '<h1>ok</h1>' });
    symlinkSync('.env', join(dir, 'public-leak'));
    writeFileSync(join(dir, '.env'), 'CONV_SECRET=1\n');

    // The audit refuses first, so nothing is ever widened on a tree that failed inspection.
    await assert.rejects(() => h.service.prepare(SITE_ID, 'release-copy'), /cannot be served as a static site/);
    assert.deepEqual(h.calls.relaxStatic, [], 'a refused tree is never made readable');
  } finally { h.cleanup(); }
});

test('I2 a rollback resolves the data directory against the runtime the conversion recorded', async () => {
  const h = harness({ legacyRunning: true, containerWrote: true });
  const asked = [];
  try {
    h.store.insertSite(legacySite({ runtime: 'command', startCommand: 'node server.mjs', bind: 'socket' }));
    h.store.insertRelease(release());
    h.seedRelease(SITE_ID, RELEASE_ID, { 'server.mjs': 'run()' });
    mkdirSync(join(h.legacyHome, '.local/share/this-app'), { recursive: true });
    writeFileSync(join(h.legacyHome, '.local/share/this-app/data.db'), 'ROWS-BEFORE');

    // The production resolver keys off `runtime` and answers null for anything that is not `command`.
    const real = h.deps.resolveLegacyData;
    h.deps.resolveLegacyData = async (site) => {
      asked.push(site.runtime);
      if (site.runtime !== 'command') return null;
      return real(site);
    };

    await h.service.prepare(SITE_ID, 'release-copy');
    await h.service.flip(SITE_ID);
    assert.equal(h.store.siteById(SITE_ID).runtime, 'environment', 'the row has moved on');

    await h.service.rollback(SITE_ID, { restoreData: true });

    // Every question was asked about the recorded runtime, never the flipped row.
    assert.deepEqual([...new Set(asked)], ['command']);
    assert.equal(
      readFileSync(join(h.legacyHome, '.local/share/this-app/data.db'), 'utf8'),
      'WRITTEN-WHILE-CONVERTED',
      'the writes made while converted came back',
    );
    assert.equal(h.store.siteById(SITE_ID).runtime, 'command');
  } finally { h.cleanup(); }
});

test('I2 the reconstructed descriptor carries the captured command runtime, not the flipped row', () => {
  const site = { ...legacySite({ runtime: 'environment', startCommand: '', bind: 'socket', port: null }) };
  const migration = {
    siteId: SITE_ID, stage: 'flipped', fromRuntime: 'command', fromReleaseId: 'rel-pinned',
    fromStartCommand: 'node server.mjs', fromBind: 'port', fromPort: 4610, recipe: 'release-copy',
    contentDigest: null, finalDigest: null, legacyHome: '/home/site', brokerPrepared: false,
    legacyStopped: false, rollbackStage: 'none', rollbackArchive: null, requestedAt: 'now', lastError: null,
  };
  const descriptor = legacyDescriptor(site, migration);
  assert.equal(descriptor.runtime, 'command');
  assert.equal(descriptor.startCommand, 'node server.mjs');
  assert.equal(descriptor.bind, 'port');
  assert.equal(descriptor.port, 4610);
  assert.equal(descriptor.currentReleaseId, 'rel-pinned');
  // Identity is untouched: this describes the same site, only as its old runtime.
  assert.equal(descriptor.id, site.id);
  assert.equal(descriptor.slug, site.slug);
  assert.equal(descriptor.ownerUserId, site.ownerUserId);
});

test('I2 a failed restore leaves the container intact so a retry can export again', async () => {
  const h = harness({ legacyRunning: true, containerWrote: true, restoreFailsOnce: true });
  try {
    h.store.insertSite(legacySite({ runtime: 'command', startCommand: 'node server.mjs' }));
    h.store.insertRelease(release());
    h.seedRelease(SITE_ID, RELEASE_ID, { 'server.mjs': 'run()' });
    mkdirSync(join(h.legacyHome, '.local/share/this-app'), { recursive: true });
    writeFileSync(join(h.legacyHome, '.local/share/this-app/data.db'), 'ROWS-BEFORE');

    await h.service.prepare(SITE_ID, 'release-copy');
    await h.service.flip(SITE_ID);
    await assert.rejects(() => h.service.rollback(SITE_ID), /restore exploded/);

    // Data before destruction: the container and its volume are still there.
    assert.deepEqual(h.calls.discardContainer, []);
    assert.equal(h.store.runtimeMigration(SITE_ID).rollbackStage, 'exported');

    await h.service.rollback(SITE_ID);
    assert.equal(h.store.siteById(SITE_ID).runtime, 'command');
    assert.deepEqual(h.calls.discardContainer, [SITE_ID], 'discarded only once the data was back');
  } finally { h.cleanup(); }
});

// --- Periodic reconciliation during a conversion --------------------------------------------------
//
// The whole operation runs against a live daemon whose two reconcilers tick every five seconds. These
// drive an ACTUAL reconciler tick from inside the awaits the conversion is sitting in, against the same
// real store, which is where the production incident happened: the row is still `command` and `live`
// while the process is deliberately down, and still `environment` and `live` while the container is
// deliberately down.

test('X1 a reconciler tick during the capture does not respawn the legacy runtime', async () => {
  const h = harness({ legacyRunning: true });
  const observed = [];
  try {
    h.store.insertSite(legacySite({ runtime: 'command', startCommand: 'node server.mjs' }));
    h.store.insertRelease(release());
    h.seedRelease(SITE_ID, RELEASE_ID, { 'server.mjs': 'run()' });
    mkdirSync(join(h.legacyHome, '.local/share/this-app'), { recursive: true });
    writeFileSync(join(h.legacyHome, '.local/share/this-app/data.db'), 'ROWS');

    // The barrier: the tick happens while the conversion is INSIDE the capture, holding the quiesced
    // window open. This is the exact moment the production flip failed.
    const capture = h.deps.captureLegacyData;
    h.deps.captureLegacyData = async (siteId, selection) => {
      observed.push({ at: 'capture', suspends: h.store.conversionSuspends(siteId) });
      return capture(siteId, selection);
    };
    const load = h.deps.loadDataVolume;
    h.deps.loadDataVolume = async (site, seed) => {
      observed.push({ at: 'volume-load', suspends: h.store.conversionSuspends(site.id) });
      return load(site, seed);
    };

    await h.service.prepare(SITE_ID, 'release-copy');
    await h.service.flip(SITE_ID);

    // Throughout both awaits the durable answer was the same, and it is what every reconciler consults.
    assert.deepEqual(observed, [
      { at: 'capture', suspends: 'legacy' },
      { at: 'volume-load', suspends: 'legacy' },
    ]);
    // The site is in `liveCommandSites()` for that whole window: it is not missing from the sweep, it
    // is simply protected inside it.
    assert.equal(h.store.siteById(SITE_ID).runtime, 'environment');
    assert.equal(h.store.conversionSuspends(SITE_ID), null, 'and the flip released it');
  } finally { h.cleanup(); }
});

test('X2 the quiesced legacy site is still returned by the live-command query it is protected inside', async () => {
  const h = harness({ legacyRunning: true });
  try {
    h.store.insertSite(legacySite({ runtime: 'command', startCommand: 'node server.mjs' }));
    h.store.insertRelease(release());
    h.seedRelease(SITE_ID, RELEASE_ID, { 'server.mjs': 'run()' });
    mkdirSync(join(h.legacyHome, '.local/share/this-app'), { recursive: true });
    writeFileSync(join(h.legacyHome, '.local/share/this-app/data.db'), 'ROWS');

    let seen = null;
    const capture = h.deps.captureLegacyData;
    h.deps.captureLegacyData = async (siteId, selection) => {
      seen = {
        inLiveQuery: h.store.liveCommandSites().some((s) => s.id === siteId),
        suspends: h.store.conversionSuspends(siteId),
        suspensions: [...h.store.conversionSuspensions()],
      };
      return capture(siteId, selection);
    };

    await h.service.prepare(SITE_ID, 'release-copy');
    await h.service.flip(SITE_ID);

    // Deliberately NOT filtered out of the query. The runtime column is what the whole serving path
    // dispatches on, so a conversion must not edit it early to hide the site; ownership is a separate,
    // durable answer laid over the same row.
    assert.equal(seen.inLiveQuery, true);
    assert.equal(seen.suspends, 'legacy');
    assert.deepEqual(seen.suspensions, [[SITE_ID, 'legacy']]);
  } finally { h.cleanup(); }
});

test('X3 the container stays owned across the whole rollback export window', async () => {
  const h = harness({ legacyRunning: true, containerWrote: true });
  const observed = [];
  try {
    h.store.insertSite(legacySite({ runtime: 'command', startCommand: 'node server.mjs' }));
    h.store.insertRelease(release());
    h.seedRelease(SITE_ID, RELEASE_ID, { 'server.mjs': 'run()' });
    mkdirSync(join(h.legacyHome, '.local/share/this-app'), { recursive: true });
    writeFileSync(join(h.legacyHome, '.local/share/this-app/data.db'), 'ROWS');

    await h.service.prepare(SITE_ID, 'release-copy');
    await h.service.flip(SITE_ID);
    assert.equal(h.store.conversionSuspends(SITE_ID), null, 'a flipped container is meant to be running');

    // The marker must already be durable INSIDE the stop, not written after it: the tick that resurrects
    // the container arrives between the stop and the export.
    const stop = h.deps.stopContainer;
    h.deps.stopContainer = async (siteId) => {
      observed.push({ at: 'stop', suspends: h.store.conversionSuspends(siteId) });
      return stop(siteId);
    };
    const exportVolume = h.deps.exportDataVolume;
    h.deps.exportDataVolume = async (site, output) => {
      observed.push({ at: 'export', suspends: h.store.conversionSuspends(site.id) });
      return exportVolume(site, output);
    };
    const restore = h.deps.restoreLegacyData;
    h.deps.restoreLegacyData = async (selection, archive, siteId) => {
      observed.push({ at: 'restore', suspends: h.store.conversionSuspends(siteId) });
      return restore(selection, archive, siteId);
    };

    await h.service.rollback(SITE_ID, { restoreData: true });

    assert.deepEqual(observed, [
      { at: 'stop', suspends: 'environment' },
      { at: 'export', suspends: 'environment' },
      { at: 'restore', suspends: 'environment' },
    ]);
    assert.equal(h.store.runtimeMigration(SITE_ID), null, 'and the finished rollback released it');
  } finally { h.cleanup(); }
});

test('X4 a rollback publishes the site as serving only after the legacy start was proven', async () => {
  const h = harness({ legacyRunning: true, containerWrote: true });
  try {
    h.store.insertSite(legacySite({ runtime: 'command', startCommand: 'node server.mjs' }));
    h.store.insertRelease(release());
    h.seedRelease(SITE_ID, RELEASE_ID, { 'server.mjs': 'run()' });
    mkdirSync(join(h.legacyHome, '.local/share/this-app'), { recursive: true });
    writeFileSync(join(h.legacyHome, '.local/share/this-app/data.db'), 'ROWS');

    await h.service.prepare(SITE_ID, 'release-copy');
    await h.service.flip(SITE_ID);

    // The reconciler wrote this verdict while the conversion held the site: a site left `failed` is
    // absent from `liveCommandSites()` and therefore dark for good, even once the rollback finishes.
    h.store.updateSite(SITE_ID, { status: 'failed', lastError: 'left over from the reconciler' });

    let statusAtStart = null;
    const startLegacy = h.deps.startLegacyRuntime;
    h.deps.startLegacyRuntime = async (site) => {
      statusAtStart = h.store.siteById(site.id).status;
      return startLegacy(site);
    };

    await h.service.rollback(SITE_ID, { restoreData: true });

    assert.equal(statusAtStart, 'failed', 'nothing was published before the start was awaited');
    const settled = h.store.siteById(SITE_ID);
    assert.equal(settled.status, 'live', 'and the stale verdict was cleared once it answered');
    assert.equal(settled.lastError, null);
    assert.equal(settled.runtime, 'command');
    assert.equal(h.store.liveCommandSites().some((s) => s.id === SITE_ID), true, 'the site is serving again');
  } finally { h.cleanup(); }
});

test('X4 a rollback whose legacy start fails never reports the site as serving', async () => {
  const h = harness({ legacyRunning: true, containerWrote: true, startLegacyFails: true });
  try {
    h.store.insertSite(legacySite({ runtime: 'command', startCommand: 'node server.mjs' }));
    h.store.insertRelease(release());
    h.seedRelease(SITE_ID, RELEASE_ID, { 'server.mjs': 'run()' });
    mkdirSync(join(h.legacyHome, '.local/share/this-app'), { recursive: true });
    writeFileSync(join(h.legacyHome, '.local/share/this-app/data.db'), 'ROWS');

    await h.service.prepare(SITE_ID, 'release-copy');
    await h.service.flip(SITE_ID);
    h.store.updateSite(SITE_ID, { status: 'failed', lastError: 'the legacy runtime will not come up' });

    await assert.rejects(() => h.service.rollback(SITE_ID, { restoreData: true }));

    // Never reported as serving, and never left failed WITHOUT a reason: the revert clears the old
    // message because the runtime column moved back, so the start's own failure has to take its place.
    const settled = h.store.siteById(SITE_ID);
    assert.equal(settled.status, 'failed');
    assert.equal(settled.lastError, 'the legacy runtime did not answer');
  } finally { h.cleanup(); }
});

// --- completion: one working copy ------------------------------------------------------------------

/** A converted site whose source folder is inside the harness root, so a completion can fold the staged
 *  copy into a real directory instead of an absolute path nobody owns. */
const convertedSite = async (h, overrides = {}) => {
  seedLiveStatic(h, overrides);
  await h.service.prepare(SITE_ID, 'release-copy');
  await h.service.flip(SITE_ID);
  return sourceDirOf(h);
};

/** Timestamps decide which side of a two-copy site is newer, so the tests set them rather than racing
 *  the clock. */
const setMtime = (path, seconds) => utimesSync(path, new Date(seconds * 1000), new Date(seconds * 1000));

test('the staged workspace is folded into the source folder without deleting anything', () => {
  const root = mkdtempSync(join(tmpdir(), 'sites-reconcile-'));
  try {
    const workspace = join(root, 'workspace');
    const source = join(root, 'source');
    mkdirSync(join(workspace, 'assets'), { recursive: true });
    mkdirSync(source, { recursive: true });

    writeFileSync(join(workspace, 'index.html'), '<h1>served</h1>');
    setMtime(join(workspace, 'index.html'), 2_000_000);
    writeFileSync(join(source, 'index.html'), '<h1>older draft</h1>');
    setMtime(join(source, 'index.html'), 1_000_000);
    writeFileSync(join(workspace, 'assets/app.js'), 'served()');
    // Newer in the SOURCE folder: the author moved on and the container never saw this.
    writeFileSync(join(source, 'notes.md'), 'work in progress');
    setMtime(join(source, 'notes.md'), 3_000_000);
    writeFileSync(join(workspace, 'notes.md'), 'stale copy');
    setMtime(join(workspace, 'notes.md'), 1_000_000);
    // The credentials the bootstrap installed into the container's workspace, and the runtime's Git stub.
    writeFileSync(join(workspace, '.env'), 'TWILIO_TOKEN=abc\n');
    writeFileSync(join(workspace, '.git'), '');

    const written = reconcileIntoSource(workspace, source, ['.env']);

    assert.equal(readFileSync(join(source, 'index.html'), 'utf8'), '<h1>served</h1>', 'the newer served file wins');
    assert.equal(readFileSync(join(source, 'assets/app.js'), 'utf8'), 'served()', 'a file only the container had arrives');
    assert.equal(readFileSync(join(source, 'notes.md'), 'utf8'), 'work in progress', 'newer source work survives');
    assert.equal(existsSync(join(source, '.env')), false, 'the secret stays in the environment');
    assert.equal(existsSync(join(source, '.git')), false, 'the Git stub is not carried into a Project');
    assert.deepEqual(written.sort(), ['assets/app.js', 'index.html']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('completing a conversion leaves ONE working copy: the site source folder', async () => {
  const h = harness({ containerWrote: true });
  try {
    const sourceDir = await convertedSite(h);
    const workspace = stagedWorkspace(h.deps, SITE_ID);
    assert.equal(h.binding.sourcePath, workspace, 'the flip serves the staged copy');

    // What the container wrote while it was serving, and what the author kept in the Project folder.
    writeFileSync(join(workspace, 'index.html'), '<h1>edited inside the container</h1>');
    setMtime(join(workspace, 'index.html'), 4_000_000);
    writeFileSync(join(sourceDir, 'README.md'), 'only in the Project folder');

    const status = await h.service.complete(SITE_ID);

    assert.equal(status.stage, 'none');
    assert.equal(h.store.runtimeMigration(SITE_ID), null, 'the slot is retired');
    assert.equal(
      readFileSync(join(sourceDir, 'index.html'), 'utf8'), '<h1>edited inside the container</h1>',
      'the container-side edit reached the Project folder',
    );
    assert.equal(readFileSync(join(sourceDir, 'README.md'), 'utf8'), 'only in the Project folder', 'nothing was deleted');
    assert.equal(h.binding.sourcePath, sourceDir, 'the container is bound to the site source folder');
    assert.equal(h.binding.staging, false, 'and is an ordinary live binding');
    assert.equal(existsSync(join(h.root, 'sites', SITE_ID, 'migration')), false, 'the conversion directory is gone');
    assert.deepEqual(h.calls.rebind, [SITE_ID]);
    assert.deepEqual(h.calls.publish, [SITE_ID]);
    assert.equal(h.calls.clearStage[0].stageDir, '/data/.elowen-conversion');
  } finally { h.cleanup(); }
});

test('a completion carries the persistent volume across the rebuilt container', async () => {
  const h = harness({ containerWrote: true });
  try {
    await convertedSite(h);
    const order = [];
    for (const step of ['clearConversionStage', 'stopContainer', 'exportDataVolume', 'rebindToSource', 'loadDataVolume', 'startEnvironment']) {
      const original = h.deps[step];
      h.deps[step] = async (...args) => { order.push(step); return original(...args); };
    }

    await h.service.complete(SITE_ID);

    assert.deepEqual(order, [
      'clearConversionStage', 'stopContainer', 'exportDataVolume', 'rebindToSource',
      // The export first, then the seed the new container's first boot needs.
      'loadDataVolume', 'loadDataVolume', 'startEnvironment',
    ]);
    assert.equal(h.calls.exportDataVolume[0].output.endsWith('completion-data.tar'), true);
  } finally { h.cleanup(); }
});

test('completing twice is a no-op, and a completion holds the environment while it runs', async () => {
  const h = harness({ containerWrote: true });
  try {
    await convertedSite(h);
    let suspendedDuringRebind = null;
    const rebind = h.deps.rebindToSource;
    h.deps.rebindToSource = async (site) => {
      suspendedDuringRebind = h.store.conversionSuspends(site.id);
      return rebind(site);
    };

    await h.service.complete(SITE_ID);
    assert.equal(suspendedDuringRebind, 'environment', 'reconcile is held off while the container is rebuilt');

    h.calls.rebind.length = 0;
    const again = await h.service.complete(SITE_ID);
    assert.equal(again.stage, 'none');
    assert.deepEqual(h.calls.rebind, [], 'nothing is rebuilt a second time');
  } finally { h.cleanup(); }
});

test('a completion resumes from where it died instead of exporting a volume that is gone', async () => {
  const h = harness({ containerWrote: true, rebindFails: true });
  try {
    const sourceDir = await convertedSite(h);
    await assert.rejects(() => h.service.complete(SITE_ID), /could not be rebuilt/);
    assert.equal(h.store.runtimeMigration(SITE_ID).stage, 'completing');
    assert.match(h.store.runtimeMigration(SITE_ID).lastError, /could not be rebuilt/);
    assert.equal(h.calls.exportDataVolume.length, 1);

    h.deps.rebindToSource = async (site) => {
      h.calls.rebind.push(site.id);
      h.binding.sourcePath = site.sourceDir;
      h.binding.staging = true;
    };
    await h.service.complete(SITE_ID);

    assert.equal(h.calls.exportDataVolume.length, 1, 'the volume is exported exactly once');
    assert.deepEqual(h.calls.clearStage.length, 1, 'and the spent seed is cleared once');
    assert.equal(h.binding.sourcePath, sourceDir);
    assert.equal(h.store.runtimeMigration(SITE_ID), null);
  } finally { h.cleanup(); }
});

test('a conversion interrupted by a restart while flipped can still be completed', async () => {
  const h = harness({ containerWrote: true });
  try {
    const sourceDir = await convertedSite(h);
    // Exactly what boot recovery records for a conversion a restart caught after its flip.
    await h.service.recoverInterrupted();
    assert.equal(h.store.runtimeMigration(SITE_ID).lastError, interruptedByRestart('flipped'));

    await h.service.complete(SITE_ID);

    assert.equal(h.store.runtimeMigration(SITE_ID), null);
    assert.equal(h.binding.sourcePath, sourceDir);
  } finally { h.cleanup(); }
});

test('the restart marker is not accepted while the site does not answer, and no other failure is', async () => {
  const down = harness({ containerWrote: true, readiness: { ready: false, detail: 'answered 502' } });
  try {
    await convertedSite(down);
    await down.service.recoverInterrupted();
    await assert.rejects(() => down.service.complete(SITE_ID), /not answering yet/);
    assert.equal(down.store.runtimeMigration(SITE_ID).stage, 'flipped', 'nothing was claimed');
    assert.deepEqual(down.calls.rebind, []);
  } finally { down.cleanup(); }

  const broken = harness({ containerWrote: true });
  try {
    await convertedSite(broken);
    broken.store.failRuntimeMigration(SITE_ID, 'the environment start exploded');
    await assert.rejects(() => broken.service.complete(SITE_ID), /failed and cannot be completed/);
    assert.equal(broken.store.runtimeMigration(SITE_ID).stage, 'flipped', 'the way back is not dropped');
    assert.deepEqual(broken.calls.rebind, []);
  } finally { broken.cleanup(); }
});

test('reconcile completes an interrupted conversion by itself and leaves the others alone', async () => {
  const h = harness({ containerWrote: true });
  try {
    const sourceDir = await convertedSite(h);
    // A freshly flipped conversion belongs to the operator driving it: it can still be rolled back.
    assert.deepEqual(await h.service.reconcileCompletions(), []);
    assert.equal(h.store.runtimeMigration(SITE_ID).stage, 'flipped');

    await h.service.recoverInterrupted();
    const settled = await h.service.reconcileCompletions();

    assert.equal(settled.length, 1);
    assert.equal(settled[0].stage, 'none');
    assert.equal(h.store.runtimeMigration(SITE_ID), null);
    assert.equal(h.binding.sourcePath, sourceDir);
    assert.equal(h.binding.staging, false);
  } finally { h.cleanup(); }
});

test('reconcile does not retry a completion that failed for a reason of its own', async () => {
  const h = harness({ containerWrote: true, rebindFails: true });
  try {
    await convertedSite(h);
    await h.service.recoverInterrupted();

    assert.equal((await h.service.reconcileCompletions())[0].stage, 'completing');
    assert.match(h.store.runtimeMigration(SITE_ID).lastError, /could not be rebuilt/);
    h.calls.rebind.length = 0;

    assert.deepEqual(await h.service.reconcileCompletions(), [], 'the recorded reason is left to be read');
    assert.deepEqual(h.calls.rebind, []);
  } finally { h.cleanup(); }
});

test('a conversion being completed cannot be rolled back underneath itself', async () => {
  const h = harness({ containerWrote: true, rebindFails: true });
  try {
    await convertedSite(h);
    await assert.rejects(() => h.service.complete(SITE_ID), /could not be rebuilt/);

    await assert.rejects(() => h.service.rollback(SITE_ID), /finish the completion/);
    assert.equal(h.store.runtimeMigration(SITE_ID).stage, 'completing');
  } finally { h.cleanup(); }
});
