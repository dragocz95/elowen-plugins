import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createServer as createNetServer } from 'node:net';
import { request as httpRequest } from 'node:http';

import { SiteRuntimeSupervisor } from '../plugins/sites/dist/runtime.js';

const SITE_ID = '123e4567-e89b-12d3-a456-426614174000';

const site = (releaseId, overrides = {}) => ({
  id: SITE_ID,
  slug: 'runtime-demo',
  title: 'Runtime demo',
  summary: '',
  projectId: 1,
  ownerUserId: 7,
  visibility: 'authenticated',
  accessGeneration: 1,
  sourceRel: 'sites/legacy-demo',
  spa: false,
  kind: 'static',
  target: '',
  runtime: 'command',
  startCommand: 'node server.mjs',
  bind: 'socket',
  port: null,
  status: 'live',
  currentReleaseId: releaseId,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  createdModel: null,
  lastPublishAt: null,
  lastPublishModel: null,
  lastError: null,
  ...overrides,
});

test('socket runtime keeps the configured network policy and answers through the sealed broker', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'sites-runtime-'));
  const releaseId = 'release-1';
  const release = join(root, 'release');
  const socketPath = join(root, 'broker', SITE_ID, 'app.sock');
  mkdirSync(release, { recursive: true });
  writeFileSync(join(release, 'server.mjs'), `
    import http from 'node:http';
    http.createServer((_req, res) => res.end('ok')).listen(process.env.SOCKET_PATH);
  `);
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const preparedInputs = [];
  let releases = 0;
  let seals = 0;
  let removals = 0;
  const sandbox = {
    prepareExecution: async (input, options) => {
      preparedInputs.push({ input, options });
      return {
        mode: 'confined', cwd: release, home: root, roots: options.roots, workspace: null,
        launch: { type: 'argv', file: process.execPath, args: [join(release, 'server.mjs')], env: {} },
        lease: { id: 'lease-1', accountUserId: 7, workspaceId: null, homeGeneration: 1, heartbeat() {}, release() { releases += 1; } },
      };
    },
  };
  const gateway = {
    async prepareRuntimeSocket() {
      mkdirSync(dirname(socketPath), { recursive: true });
      return { path: socketPath };
    },
    async sealRuntimeSocket() {
      assert.equal(lstatSync(socketPath).isSocket(), true);
      seals += 1;
    },
    async removeRuntimeSocket() {
      removals += 1;
      rmSync(dirname(socketPath), { recursive: true, force: true });
    },
  };
  const ctx = {
    control(name) { return name === 'sandbox' ? sandbox : name === 'publishedSitesGateway' ? gateway : undefined; },
    logger: { info() {}, warn() {}, error() {} },
  };
  const supervisor = new SiteRuntimeSupervisor({
    ctx,
    store: { liveCommandSites: () => [], siteById: () => site(releaseId), conversionSuspends: () => null, conversionSuspensions: () => new Map() },
    config: () => ({ startTimeoutSeconds: 5, runtimeNetwork: 'isolated', allowLoopbackPorts: false, loopbackPortMin: 41000, loopbackPortMax: 41999 }),
    siteDir: () => root,
    releaseDir: () => release,
  });

  await supervisor.start(site(releaseId));
  assert.equal(supervisor.isRunning(SITE_ID), true);
  assert.equal(seals, 1);
  assert.equal(preparedInputs[0].input.network, 'isolated');
  assert.deepEqual(preparedInputs[0].options.roots, [release, dirname(socketPath)]);

  await supervisor.stop(SITE_ID);
  assert.equal(supervisor.isRunning(SITE_ID), false);
  assert.equal(releases, 1);
  assert.ok(removals >= 1);
});

test('shared loopback runtime loads .env without letting it replace host-owned values', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'sites-runtime-port-'));
  const release = join(root, 'release');
  mkdirSync(release, { recursive: true });
  writeFileSync(join(release, '.env'), 'FROM_DOTENV=loaded\nPORT=1\nHOST=bad.example\nNODE_ENV=development\nELOWEN_TOKEN=fake\n');
  writeFileSync(join(release, 'server.mjs'), `
    import http from 'node:http';
    http.createServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        fromDotenv: process.env.FROM_DOTENV,
        port: process.env.PORT,
        host: process.env.HOST,
        nodeEnv: process.env.NODE_ENV,
        token: process.env.ELOWEN_TOKEN ?? null,
      }));
    }).listen(Number(process.env.PORT), process.env.HOST);
  `);
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const preparedInputs = [];
  const sandbox = {
    prepareExecution: async (input, options) => {
      preparedInputs.push({ input, options });
      return {
        mode: 'confined', cwd: release, home: root, roots: options.roots, workspace: null,
        launch: { type: 'argv', file: process.execPath, args: [join(release, 'server.mjs')], env: { PATH: process.env.PATH } },
        lease: { id: 'lease-port', accountUserId: 7, workspaceId: null, homeGeneration: 1, heartbeat() {}, release() {} },
      };
    },
  };
  const ctx = {
    control(name) { return name === 'sandbox' ? sandbox : undefined; },
    logger: { info() {}, warn() {}, error() {} },
  };
  const supervisor = new SiteRuntimeSupervisor({
    ctx,
    store: { liveCommandSites: () => [], siteById: () => null, portsInUse: () => [], conversionSuspends: () => null, conversionSuspensions: () => new Map() },
    config: () => ({ startTimeoutSeconds: 5, runtimeNetwork: 'shared', allowLoopbackPorts: true, loopbackPortMin: 45100, loopbackPortMax: 45199 }),
    siteDir: () => root,
    releaseDir: () => release,
  });
  const port = await supervisor.allocatePort();
  const target = site('release-1', { bind: 'port', port });

  await supervisor.start(target);
  const payload = await new Promise((resolve, reject) => {
    const request = httpRequest({ host: '127.0.0.1', port, path: '/' }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
    });
    request.on('error', reject);
    request.end();
  });

  assert.equal(preparedInputs[0].input.network, 'shared');
  assert.deepEqual(preparedInputs[0].options.roots, [release]);
  assert.deepEqual(payload, {
    fromDotenv: 'loaded',
    port: String(port),
    host: '127.0.0.1',
    nodeEnv: 'production',
    token: null,
  });
  await supervisor.stop(SITE_ID);
});

test('port allocation skips ports already claimed by Sites or another local process', async (t) => {
  const occupied = createNetServer();
  await new Promise((resolve) => occupied.listen(0, '127.0.0.1', resolve));
  const address = occupied.address();
  assert.ok(address && typeof address === 'object');
  t.after(() => occupied.close());
  const claimed = address.port + 1;
  const supervisor = new SiteRuntimeSupervisor({
    ctx: { control: () => undefined, logger: { info() {}, warn() {}, error() {} } },
    store: { portsInUse: () => [claimed] },
    config: () => ({ startTimeoutSeconds: 5, runtimeNetwork: 'shared', allowLoopbackPorts: true, loopbackPortMin: address.port, loopbackPortMax: address.port + 2 }),
    siteDir: () => '',
    releaseDir: () => '',
  });
  assert.equal(await supervisor.allocatePort(), address.port + 2);
});

test('unexpected exit cleanup cannot delete a replacement runtime socket', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'sites-runtime-race-'));
  const releases = new Map([
    ['release-1', join(root, 'release-1')],
    ['release-2', join(root, 'release-2')],
  ]);
  for (const [releaseId, release] of releases) {
    mkdirSync(release, { recursive: true });
    // The first release dies only AFTER the supervisor has accepted it. Exiting on a fixed timer instead
    // would race the readiness poll and turn this into a failed start — a different code path, whose
    // cleanup runs inside `start` and would deadlock against the block this test installs below.
    writeFileSync(join(release, 'server.mjs'), `
      import http from 'node:http';
      const server = http.createServer((_req, res) => res.end('${releaseId}'));
      server.listen(process.env.SOCKET_PATH);
      ${releaseId === 'release-1' ? "server.once('connection', () => setTimeout(() => process.exit(0), 400));" : ''}
    `);
  }
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const socketPath = join(root, 'broker', SITE_ID, 'app.sock');
  let current = site('release-1');
  let prepares = 0;
  let removals = 0;
  let releaseBlockedCleanup;
  const blockedCleanup = new Promise((resolve) => { releaseBlockedCleanup = resolve; });
  const keepAlive = setInterval(() => {}, 100);
  t.after(() => clearInterval(keepAlive));
  let cleanupStarted;
  const cleanupSeen = new Promise((resolve) => { cleanupStarted = resolve; });
  const sandbox = {
    prepareExecution: async (_input, options) => {
      const release = releases.get(current.currentReleaseId);
      return {
        mode: 'confined', cwd: release, home: root, roots: options.roots, workspace: null,
        launch: { type: 'argv', file: process.execPath, args: [join(release, 'server.mjs')], env: {} },
        lease: { id: `lease-${current.currentReleaseId}`, accountUserId: 7, workspaceId: null, homeGeneration: 1, heartbeat() {}, release() {} },
      };
    },
  };
  const gateway = {
    async prepareRuntimeSocket() {
      prepares += 1;
      rmSync(dirname(socketPath), { recursive: true, force: true });
      mkdirSync(dirname(socketPath), { recursive: true });
      return { path: socketPath };
    },
    async sealRuntimeSocket() { assert.equal(lstatSync(socketPath).isSocket(), true); },
    async removeRuntimeSocket() {
      removals += 1;
      if (removals === 2) {
        cleanupStarted();
        await blockedCleanup;
      }
      rmSync(dirname(socketPath), { recursive: true, force: true });
    },
  };
  const ctx = {
    control(name) { return name === 'sandbox' ? sandbox : name === 'publishedSitesGateway' ? gateway : undefined; },
    logger: { info() {}, warn() {}, error() {} },
  };
  const supervisor = new SiteRuntimeSupervisor({
    ctx,
    store: { liveCommandSites: () => [], siteById: () => current, conversionSuspends: () => null, conversionSuspensions: () => new Map() },
    config: () => ({ startTimeoutSeconds: 5, runtimeNetwork: 'isolated', allowLoopbackPorts: false, loopbackPortMin: 41000, loopbackPortMax: 41999 }),
    siteDir: () => root,
    releaseDir: (_siteId, releaseId) => releases.get(releaseId),
  });

  await supervisor.start(current);
  await cleanupSeen;
  current = site('release-2');
  const replacement = supervisor.start(current);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(prepares, 1, 'replacement prepare must wait for old cleanup');
  releaseBlockedCleanup();
  await replacement;
  assert.equal(prepares, 2);
  assert.equal(supervisor.isRunning(SITE_ID), true);
  assert.equal(lstatSync(socketPath).isSocket(), true);
  await supervisor.stop(SITE_ID);
});

// --- Runtime conversion ownership -----------------------------------------------------------------
//
// A conversion stops a legacy process, then spends minutes capturing its data and building the
// container that replaces it. Throughout that window the row still says `command` and `live`, so the
// site is in `liveCommandSites()` and looks to the five-second reconcile exactly like one that simply
// is not running. Restarting it puts a second writer on the tree being captured and a second holder on
// the broker directory the container is being built around.

/** A supervisor over a REAL store, with the spawn seam recorded rather than stubbed out. */
const ownershipHarness = async (t, { suspends = null, siteOverrides = {} } = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'sites-runtime-own-'));
  const release = join(root, 'release');
  mkdirSync(release, { recursive: true });
  writeFileSync(join(release, 'server.mjs'), `
    import http from 'node:http';
    http.createServer((_req, res) => res.end('ok')).listen(process.env.SOCKET_PATH);
  `);
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const socketPath = join(root, 'broker', 'app.sock');
  const spawns = [];
  const removals = [];
  const current = site('rel-own', siteOverrides);
  /** Mirrors the derived answer the real store computes from its durable conversion row. */
  const suspension = { value: suspends };

  const sandbox = {
    prepareExecution: async (_input, options) => {
      spawns.push(Date.now());
      return {
        mode: 'confined', cwd: release, home: root, roots: options.roots, workspace: null,
        launch: { type: 'argv', file: process.execPath, args: [join(release, 'server.mjs')], env: {} },
        lease: { id: 'l', accountUserId: 7, workspaceId: null, homeGeneration: 1, heartbeat() {}, release() {} },
      };
    },
  };
  const gateway = {
    async prepareRuntimeSocket() { mkdirSync(dirname(socketPath), { recursive: true }); return { path: socketPath }; },
    async sealRuntimeSocket() {},
    async removeRuntimeSocket(siteId) { removals.push(siteId); rmSync(dirname(socketPath), { recursive: true, force: true }); },
  };
  const supervisor = new SiteRuntimeSupervisor({
    ctx: {
      control(name) { return name === 'sandbox' ? sandbox : name === 'publishedSitesGateway' ? gateway : undefined; },
      logger: { info() {}, warn() {}, error() {} },
    },
    store: {
      liveCommandSites: () => [current],
      siteById: () => current,
      updateSite: (_id, patch) => Object.assign(current, patch),
      conversionSuspends: (siteId) => (siteId === current.id ? suspension.value : null),
      conversionSuspensions: () => (suspension.value ? new Map([[current.id, suspension.value]]) : new Map()),
    },
    config: () => ({ startTimeoutSeconds: 5, runtimeNetwork: 'isolated', allowLoopbackPorts: false, loopbackPortMin: 41000, loopbackPortMax: 41999 }),
    siteDir: () => root,
    releaseDir: () => release,
  });
  return { supervisor, spawns, removals, current, suspension, socketPath, release };
};

test('a periodic reconcile does not respawn a legacy runtime a conversion is holding down', async (t) => {
  const h = await ownershipHarness(t, { suspends: 'legacy' });

  await h.supervisor.reconcile();

  assert.deepEqual(h.spawns, [], 'nothing was started under the conversion');
  assert.equal(h.supervisor.isRunning(SITE_ID), false);
  // Not a failure: reconcile records a thrown error as `status = 'failed'`, and a site left failed drops
  // out of `liveCommandSites()` and stays dark even after the conversion releases it.
  assert.equal(h.current.status, 'live');
  assert.equal(h.current.lastError, null);
});

test('a start queued BEFORE the conversion claimed the site does not execute after it', async (t) => {
  const h = await ownershipHarness(t);

  // The barrier stands in for the site the sweep is already awaiting. The reconcile below reads its
  // site list while the conversion has not claimed anything yet, so the start it queues is decided on
  // a list that goes stale while it waits — which is why filtering the query cannot be the whole fix.
  let releaseBarrier;
  const barrier = new Promise((resolve) => { releaseBarrier = resolve; });
  const queued = h.supervisor.start(h.current);
  const behind = barrier.then(() => undefined);
  void behind;

  // The conversion claims the site and stops the legacy process AFTER the start was queued.
  h.suspension.value = 'legacy';
  releaseBarrier();
  await queued;

  assert.deepEqual(h.spawns, [], 'the stale start found the claim and stood down');
  assert.equal(h.supervisor.isRunning(SITE_ID), false);
});

test('once the conversion records a failure the reconcile owns the runtime again', async (t) => {
  const h = await ownershipHarness(t, { suspends: 'legacy' });
  await h.supervisor.reconcile();
  assert.deepEqual(h.spawns, []);

  // A failed stage releases the guard: nobody is driving the slot, and starting a live command site
  // that is not running is precisely the reconcile's ordinary job. A guard that outlived the failure
  // would leave the site dark until the next daemon boot.
  h.suspension.value = null;

  await h.supervisor.reconcile();
  assert.equal(h.spawns.length, 1, 'the ordinary sweep took the restart back');
  assert.equal(h.supervisor.isRunning(SITE_ID), true);
  await h.supervisor.stop(SITE_ID);
});

test('a legacy stop does not remove a broker directory the flipped environment now owns', async (t) => {
  const h = await ownershipHarness(t);
  await h.supervisor.start(h.current);
  assert.equal(h.supervisor.isRunning(SITE_ID), true);
  h.removals.length = 0;

  // The flip points this same site id at a container, and the container is handed the SAME broker
  // directory. The supervisor's `Running` entry still records a socket endpoint from before the flip.
  h.current.runtime = 'environment';

  await h.supervisor.stop(SITE_ID);

  // Ownership is read from the site as it is NOW, not from the captured entry. Removing the directory
  // here is what leaves Podman failing to create or start the container with a bare statfs error.
  assert.deepEqual(h.removals, [], 'the container keeps the broker directory it now owns');
  assert.equal(existsSync(dirname(h.socketPath)), true);
  assert.equal(h.supervisor.isRunning(SITE_ID), false);
});

test('a legacy stop still removes the broker directory while the site is still a command site', async (t) => {
  const h = await ownershipHarness(t);
  await h.supervisor.start(h.current);
  h.removals.length = 0;

  await h.supervisor.stop(SITE_ID);

  assert.deepEqual(h.removals, [SITE_ID], 'the ordinary cleanup is untouched');
  assert.equal(existsSync(dirname(h.socketPath)), false);
});

test('the sweep leaves a suspended site alone even while its process is still up', async (t) => {
  const h = await ownershipHarness(t);
  await h.supervisor.start(h.current);
  assert.equal(h.supervisor.isRunning(SITE_ID), true);
  h.removals.length = 0;

  // The real ordering: the conversion records the marker BEFORE it stops anything, so there is a window
  // where the site is claimed and the legacy process is still up. A sweep arriving here reaches
  // `if (running) await this.stop(...)` before it ever reaches the start guard, so without the
  // list-level skip the reconciler stops the process out from under the conversion AND removes the
  // broker socket, which is not something the start guard can undo.
  h.suspension.value = 'legacy';
  h.current.currentReleaseId = 'rel-changed';

  await h.supervisor.reconcile();

  assert.equal(h.supervisor.isRunning(SITE_ID), true, 'the conversion still owns its running process');
  assert.deepEqual(h.removals, [], 'and its broker socket');
  await h.supervisor.stop(SITE_ID);
});

// --- Shutdown contract ----------------------------------------------------------------------------
//
// The daemon stops a `criticalStop` service BEFORE it disarms the ordinary intervals, so during every
// reload there is a window where `reconcile-site-runtimes` is still armed while this supervisor is
// emptying its map. A tick in that window respawns what the stop just took down, and the supervisor
// holding those new children is discarded seconds later with their heartbeats and leases still live.

/** A supervisor whose sandbox preparation can be held open, so a shutdown can be driven into the exact
 *  await a real reload loses the race in. */
const shutdownHarness = (t, { holdPrepare = false } = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'sites-runtime-shutdown-'));
  const release = join(root, 'release');
  mkdirSync(release, { recursive: true });
  writeFileSync(join(release, 'server.mjs'), `
    import http from 'node:http';
    http.createServer((_req, res) => res.end('ok')).listen(process.env.SOCKET_PATH);
  `);
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const socketPath = join(root, 'broker', 'app.sock');
  const spawned = [];
  const leases = { taken: 0, released: 0 };
  const removals = [];
  const current = site('rel-shutdown');
  let openPrepare = null;

  const sandbox = {
    prepareExecution: async (_input, options) => {
      leases.taken += 1;
      if (holdPrepare) await new Promise((resolve) => { openPrepare = resolve; });
      return {
        mode: 'confined', cwd: release, home: root, roots: options.roots, workspace: null,
        launch: { type: 'argv', file: process.execPath, args: [join(release, 'server.mjs')], env: {} },
        lease: {
          id: 'l', accountUserId: 7, workspaceId: null, homeGeneration: 1,
          heartbeat() {}, release() { leases.released += 1; },
        },
      };
    },
  };
  const gateway = {
    async prepareRuntimeSocket() { mkdirSync(dirname(socketPath), { recursive: true }); return { path: socketPath }; },
    async sealRuntimeSocket() {},
    async removeRuntimeSocket(siteId) { removals.push(siteId); rmSync(dirname(socketPath), { recursive: true, force: true }); },
  };
  const supervisor = new SiteRuntimeSupervisor({
    ctx: {
      control(name) { return name === 'sandbox' ? sandbox : name === 'publishedSitesGateway' ? gateway : undefined; },
      logger: { info() {}, warn() {}, error() {} },
    },
    store: {
      liveCommandSites: () => [current],
      siteById: () => current,
      updateSite: (_id, patch) => Object.assign(current, patch),
      conversionSuspends: () => null,
      conversionSuspensions: () => new Map(),
    },
    config: () => ({ startTimeoutSeconds: 5, runtimeNetwork: 'isolated', allowLoopbackPorts: false, loopbackPortMin: 41000, loopbackPortMax: 41999 }),
    siteDir: () => root,
    releaseDir: () => release,
  });
  return {
    supervisor, spawned, leases, removals, current, socketPath,
    letPrepareFinish: () => { openPrepare?.(); },
  };
};

test('a reconcile tick fired during the shutdown starts nothing', async (t) => {
  const h = shutdownHarness(t);
  await h.supervisor.start(h.current);
  assert.equal(h.supervisor.isRunning(SITE_ID), true);

  // The interval is still armed while the critical service is stopping. This is that tick.
  const stopping = h.supervisor.stopAll();
  const tick = h.supervisor.reconcile();
  await Promise.all([stopping, tick]);

  assert.equal(h.supervisor.isRunning(SITE_ID), false, 'the map stayed empty');
  assert.equal(h.supervisor.isClosing(), true);
  assert.equal(h.leases.taken, h.leases.released, 'every lease this supervisor took was given back');
});

test('a tick that lands after the critical stop returned still starts nothing', async (t) => {
  const h = shutdownHarness(t);
  await h.supervisor.start(h.current);

  // PRODUCTION ORDERING. Core stops a criticalStop service first and disarms the ordinary intervals
  // afterwards, so `reconcile-site-runtimes` keeps firing against a supervisor that has already emptied
  // its map and is about to be discarded. Every runtime this tick starts is one nothing will ever stop:
  // its heartbeat keeps running, its sandbox lease stays held, and its bwrap tree outlives the reload.
  await h.supervisor.stopAll();
  assert.equal(h.supervisor.isRunning(SITE_ID), false);
  const spawnsBefore = h.leases.taken;

  await h.supervisor.reconcile();
  await h.supervisor.start(h.current);

  assert.equal(h.leases.taken, spawnsBefore, 'no sandbox preparation was even attempted');
  assert.equal(h.supervisor.isRunning(SITE_ID), false, 'the discarded supervisor holds no child');
  assert.equal(h.leases.taken, h.leases.released, 'and no lease is left held');
});

test('a start that was already queued when the shutdown began never spawns', async (t) => {
  const h = shutdownHarness(t);

  // Queued from a sweep that read its list before the stop, exactly the ordering a reload produces.
  const queued = h.supervisor.start(h.current);
  await h.supervisor.stopAll();
  await queued;

  assert.equal(h.supervisor.isRunning(SITE_ID), false);
  assert.equal(h.leases.taken, h.leases.released, 'nothing was left holding a lease');
});

test('a start parked inside the sandbox preparation stands down and releases its lease', async (t) => {
  const h = shutdownHarness(t, { holdPrepare: true });

  // `prepareExecution` is the long await, so this is where a reload actually loses the race: the stop
  // returns while the preparation is still outstanding, and the spawn lands behind it.
  const queued = h.supervisor.start(h.current);
  await new Promise((resolve) => { setTimeout(resolve, 20); });
  assert.equal(h.leases.taken, 1, 'the preparation is genuinely in flight');

  const stopping = h.supervisor.stopAll();
  h.letPrepareFinish();
  await Promise.all([queued, stopping]);

  assert.equal(h.supervisor.isRunning(SITE_ID), false, 'no child was spawned after the fence');
  assert.equal(h.leases.released, 1, 'the lease taken by the parked preparation was released');
  // `startNow` already sweeps a stale broker directory before it prepares a fresh one, so the count is
  // not the interesting fact; the interesting fact is that nothing was left behind for the container or
  // the next generation to trip over.
  assert.equal(existsSync(dirname(h.socketPath)), false, 'the broker directory it created was cleaned up');
});

test('a shutdown leaves no heartbeat or child behind for a running site', async (t) => {
  const h = shutdownHarness(t);
  await h.supervisor.start(h.current);
  const before = process.getActiveResourcesInfo().filter((kind) => kind === 'Timeout').length;

  await h.supervisor.stopAll();

  assert.equal(h.supervisor.isRunning(SITE_ID), false);
  assert.equal(h.leases.released, 1);
  assert.ok(
    process.getActiveResourcesInfo().filter((kind) => kind === 'Timeout').length <= before,
    'the heartbeat interval was cleared rather than left armed',
  );
});

test('a stale start is refused once the site has become an environment', async (t) => {
  const h = shutdownHarness(t);

  // A conversion hands the supervisor a descriptor that deliberately says `command`, because that is
  // what the legacy runtime was. The row has already flipped, so spawning would put a second listener
  // behind the container's ingress and take back the broker directory it is bound to.
  const legacyDescriptor = { ...h.current, runtime: 'command' };
  h.current.runtime = 'environment';

  await h.supervisor.start(legacyDescriptor, { authorized: true });

  assert.equal(h.supervisor.isRunning(SITE_ID), false, 'authorized is not permission to contradict the column');
  assert.equal(h.leases.taken, 0);
});

test('an authorized restore still starts once the row really says command again', async (t) => {
  const h = shutdownHarness(t);
  h.current.runtime = 'command';

  await h.supervisor.start({ ...h.current }, { authorized: true });

  assert.equal(h.supervisor.isRunning(SITE_ID), true, 'a genuine rollback restart is unaffected');
  await h.supervisor.stopAll();
});
