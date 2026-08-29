import assert from 'node:assert/strict';
import test from 'node:test';
import { lstatSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { SiteRuntimeSupervisor } from '../plugins/sites/dist/runtime.js';

const SITE_ID = '123e4567-e89b-12d3-a456-426614174000';

const waitFor = async (predicate, timeoutMs = 5_000) => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for runtime state');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

const site = (releaseId) => ({
  id: SITE_ID,
  slug: 'runtime-demo',
  title: 'Runtime demo',
  summary: '',
  projectId: 1,
  ownerUserId: 7,
  visibility: 'authenticated',
  accessGeneration: 1,
  sourceDir: '/unused',
  spa: false,
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
});

test('command runtime stays network-isolated and answers through a sealed pathname socket', async (t) => {
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
    store: { liveCommandSites: () => [], siteById: () => site(releaseId) },
    config: () => ({ startTimeoutSeconds: 5 }),
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

test('unexpected exit cleanup cannot delete a replacement runtime socket', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'sites-runtime-race-'));
  const releases = new Map([
    ['release-1', join(root, 'release-1')],
    ['release-2', join(root, 'release-2')],
  ]);
  for (const [releaseId, release] of releases) {
    mkdirSync(release, { recursive: true });
    writeFileSync(join(release, 'server.mjs'), `
      import http from 'node:http';
      http.createServer((_req, res) => res.end('${releaseId}')).listen(process.env.SOCKET_PATH);
      ${releaseId === 'release-1' ? 'setTimeout(() => process.exit(0), 100);' : ''}
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
    store: { liveCommandSites: () => [], siteById: () => current },
    config: () => ({ startTimeoutSeconds: 5 }),
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
