import assert from 'node:assert/strict';
import test from 'node:test';
import { lstatSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
    store: { liveCommandSites: () => [], siteById: () => site(releaseId) },
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
    store: { liveCommandSites: () => [], siteById: () => null, portsInUse: () => [] },
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
    store: { liveCommandSites: () => [], siteById: () => current },
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
