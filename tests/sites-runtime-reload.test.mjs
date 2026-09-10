// The reload leak, against REAL supervised child processes under REAL bubblewrap.
//
// The daemon stops a `criticalStop` service BEFORE it disarms the ordinary intervals, so during every
// reload `reconcile-site-runtimes` keeps firing while the runtime supervisor is emptying its map. A tick
// in that window respawns what the stop just took down; the supervisor holding those new children is
// discarded moments later, and nothing ever stops them. Three reloads leave three orphaned bwrap trees
// per affected site, each with a heartbeat still ticking and a sandbox lease still held.
//
// A double is not enough to prove this: the leak is a real process tree that outlives its supervisor, so
// the test spawns real ones and then asks the operating system whether they are gone.
//
// SELF-CONTAINED. The sandbox seam is a local bubblewrap launcher and the gateway seam is a local
// directory, so the privileged broker helper is never invoked and /var/lib/elowen is never touched.

import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { SiteRuntimeSupervisor } from '../plugins/sites/dist/runtime.js';

const SITE_ID = '9f1d2c3b-4a5e-6f70-8192-a3b4c5d6e7f8';
const bwrap = '/usr/bin/bwrap';

/** Whether this machine can actually run the thing under test. */
const canRun = (() => {
  try {
    return spawnSync(bwrap, ['--dev-bind', '/', '/', '--die-with-parent', '/bin/true']).status === 0;
  } catch {
    return false;
  }
})();
const skip = canRun ? false : 'bubblewrap is not usable here';

const site = (overrides = {}) => ({
  id: SITE_ID,
  slug: 'reload-demo',
  title: 'Reload demo',
  summary: '',
  projectId: 1,
  ownerUserId: 7,
  visibility: 'authenticated',
  accessGeneration: 1,
  sourceDir: '/unused',
  spa: false,
  kind: 'static',
  target: '',
  runtime: 'command',
  startCommand: 'node server.mjs',
  bind: 'socket',
  port: null,
  status: 'live',
  currentReleaseId: 'rel-reload',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  createdModel: '',
  lastPublishAt: null,
  lastPublishModel: null,
  lastError: null,
  ...overrides,
});

const alive = (pid) => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};

/** One plugin generation: its own supervisor, its own leases, over shared on-disk state. */
const generation = (root, release, state) => {
  const socketPath = join(root, 'broker', SITE_ID, 'app.sock');
  const leases = new Set();
  const heartbeats = { armed: 0, cleared: 0 };

  const sandbox = {
    prepareExecution: async (_input, options) => {
      const id = `lease-${state.leaseSeq += 1}`;
      leases.add(id);
      state.openLeases.add(id);
      if (state.holdPrepare) await state.holdPrepare;
      return {
        mode: 'confined',
        cwd: release,
        home: root,
        roots: options.roots,
        workspace: null,
        // REAL bubblewrap, wrapping a real Node server. `--die-with-parent` is deliberately NOT used:
        // an orphan that dies on its own would hide exactly the leak being measured.
        launch: {
          type: 'argv',
          file: bwrap,
          args: ['--dev-bind', '/', '/', '--chdir', release, process.execPath, join(release, 'server.mjs')],
          env: {},
        },
        lease: {
          id,
          accountUserId: 7,
          workspaceId: null,
          homeGeneration: 1,
          heartbeat() { heartbeats.armed += 1; },
          release() { leases.delete(id); state.openLeases.delete(id); heartbeats.cleared += 1; },
        },
      };
    },
  };

  // The privileged helper reproduced as plain directory work, in a tree this test owns.
  const gateway = {
    async prepareRuntimeSocket() {
      rmSync(dirname(socketPath), { recursive: true, force: true });
      mkdirSync(dirname(socketPath), { recursive: true, mode: 0o730 });
      return { path: socketPath };
    },
    async sealRuntimeSocket() {},
    async removeRuntimeSocket() { rmSync(dirname(socketPath), { recursive: true, force: true }); },
  };

  const supervisor = new SiteRuntimeSupervisor({
    ctx: {
      control(name) { return name === 'sandbox' ? sandbox : name === 'publishedSitesGateway' ? gateway : undefined; },
      logger: { info() {}, warn() {}, error() {} },
    },
    store: {
      liveCommandSites: () => [state.site],
      siteById: () => state.site,
      updateSite: (_id, patch) => Object.assign(state.site, patch),
      conversionSuspends: () => null,
      conversionSuspensions: () => new Map(),
    },
    config: () => ({
      startTimeoutSeconds: 20, runtimeNetwork: 'isolated',
      allowLoopbackPorts: false, loopbackPortMin: 41000, loopbackPortMax: 41999,
    }),
    siteDir: () => root,
    releaseDir: () => release,
  });

  return { supervisor, leases, heartbeats, socketPath };
};

const setup = (t) => {
  const root = mkdtempSync(join(tmpdir(), 'sites-reload-'));
  const release = join(root, 'release');
  mkdirSync(release, { recursive: true });
  writeFileSync(join(release, 'server.mjs'), `
    import http from 'node:http';
    import fs from 'node:fs';
    const path = process.env.SOCKET_PATH;
    try { fs.rmSync(path, { force: true }); } catch {}
    http.createServer((_req, res) => res.end('ok')).listen(path);
    // Deliberately long-lived and deliberately not tied to the parent, so a leaked tree stays visible.
    setInterval(() => {}, 60_000);
  `);
  const state = { site: site(), leaseSeq: 0, openLeases: new Set(), holdPrepare: null };
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, release, state };
};

test('a reload tick during the critical stop leaves the old generation with no process, lease or timer',
  { skip, timeout: 60_000 }, async (t) => {
    const { root, release, state } = setup(t);
    const pids = [];
    t.after(() => { for (const pid of pids) { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } } });

    const first = generation(root, release, state);
    await first.supervisor.start(state.site);
    assert.equal(first.supervisor.isRunning(SITE_ID), true, 'the first generation really started a process');
    const firstPid = first.supervisor.runningPid(SITE_ID);
    if (firstPid) pids.push(firstPid);
    assert.equal(state.openLeases.size, 1, 'and holds exactly one lease');

    // THE RELOAD. Core stops the critical service, and the ordinary interval keeps firing throughout and
    // for a moment afterwards, because it is disarmed only once the critical services are down.
    const stopping = first.supervisor.stopAll();
    const ticksDuring = [first.supervisor.reconcile(), first.supervisor.reconcile()];
    await Promise.all([stopping, ...ticksDuring]);
    // The interval is still armed after the stop returned, right up until core disarms it.
    await first.supervisor.reconcile();
    await first.supervisor.start(state.site);

    assert.equal(first.supervisor.isRunning(SITE_ID), false, 'the old generation holds no child');
    assert.equal(first.supervisor.isClosing(), true);
    assert.equal(state.openLeases.size, 0, 'every sandbox lease it took was released');
    assert.equal(first.leases.size, 0);
    if (firstPid) {
      // Give the signalled tree a moment to actually go.
      for (let i = 0; i < 40 && alive(firstPid); i += 1) await new Promise((r) => { setTimeout(r, 50); });
      assert.equal(alive(firstPid), false, 'the bubblewrap tree from the old generation is gone');
    }

    // The new generation starts clean, which is what the reload is for.
    const second = generation(root, release, state);
    await second.supervisor.start(state.site);
    assert.equal(second.supervisor.isRunning(SITE_ID), true);
    const secondPid = second.supervisor.runningPid(SITE_ID);
    if (secondPid) pids.push(secondPid);
    assert.equal(state.openLeases.size, 1, 'exactly one lease across both generations');

    await second.supervisor.stopAll();
    assert.equal(state.openLeases.size, 0);
  });

test('three reloads in a row leak nothing', { skip, timeout: 120_000 }, async (t) => {
  const { root, release, state } = setup(t);
  const pids = [];
  t.after(() => { for (const pid of pids) { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } } });

  // The production symptom was counted in orphans per reload, so the regression counts them the same way.
  for (let round = 0; round < 3; round += 1) {
    const gen = generation(root, release, state);
    await gen.supervisor.start(state.site);
    assert.equal(gen.supervisor.isRunning(SITE_ID), true, `generation ${round} started`);
    const pid = gen.supervisor.runningPid(SITE_ID);
    if (pid) pids.push(pid);

    const stopping = gen.supervisor.stopAll();
    const tick = gen.supervisor.reconcile();
    await Promise.all([stopping, tick]);
    await gen.supervisor.reconcile();

    assert.equal(gen.supervisor.isRunning(SITE_ID), false, `generation ${round} left no child`);
    assert.equal(state.openLeases.size, 0, `generation ${round} left no lease`);
  }

  for (const pid of pids) {
    for (let i = 0; i < 40 && alive(pid); i += 1) await new Promise((r) => { setTimeout(r, 50); });
    assert.equal(alive(pid), false, `no orphan survived from pid ${pid}`);
  }
});
