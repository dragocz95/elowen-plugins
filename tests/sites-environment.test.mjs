import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BASE_IMAGE_TAG, CONTAINERFILE, INGRESS_SERVICE, INGRESS_SOCKET } from '../plugins/sites/dist/baseImage.js';
import { EnvironmentSupervisor } from '../plugins/sites/dist/environment.js';
import { cleanPodmanEnv, PodmanClient } from '../plugins/sites/dist/podman.js';
import { resolveConfig } from '../plugins/sites/dist/config.js';
import { SitesStore } from '../plugins/sites/dist/store.js';
import { createSiteHandler } from '../plugins/sites/dist/serve.js';

const SITE_ID = '123e4567-e89b-12d3-a456-426614174000';

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

const environmentSite = (overrides = {}) => ({
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

const config = (overrides = {}) => ({
  startTimeoutSeconds: 1,
  runtimeNetwork: 'shared',
  environmentCpus: 1,
  environmentMemoryMb: 1024,
  environmentPidsLimit: 512,
  environmentDiskSoftMb: 4096,
  ...overrides,
});

class FakeExecutor {
  calls = [];
  responses = [];

  enqueue(stdout = '', stderr = '', code = 0) {
    this.responses.push({ stdout, stderr, code });
  }

  async run(file, args, options) {
    this.calls.push({ file, args, options });
    return this.responses.shift() ?? { stdout: '', stderr: '', code: 0 };
  }
}

test('Podman uses argv-only calls, exact clean environment and direct detached lifecycle flags', async () => {
  const executor = new FakeExecutor();
  const podman = new PodmanClient({ executor, uid: 1000, home: '/home/elowen', user: 'elowen' });
  await podman.create({
    name: `elowen-site-${SITE_ID}`,
    siteId: SITE_ID,
    memoryMb: 768,
    cpus: 1.5,
    pidsLimit: 300,
    network: 'shared',
    envFile: '/data/environment.env',
    workspace: '/project/sites/demo',
    gitStub: '/data/git-stub',
    brokerDir: `/var/lib/elowen/site-runtime-sockets/${SITE_ID}`,
    volume: `elowen-site-${SITE_ID}-data`,
    image: BASE_IMAGE_TAG,
  });
  await podman.start(`elowen-site-${SITE_ID}`);

  assert.deepEqual(executor.calls[0].args, [
    'create', '--name', `elowen-site-${SITE_ID}`,
    '--label', `io.elowen.site=${SITE_ID}`,
    '--cgroups=split', '--systemd=always',
    '--memory=768m', '--memory-swap=768m', '--cpus=1.5', '--pids-limit=300',
    '--network=slirp4netns:allow_host_loopback=false',
    '--env-file', '/data/environment.env',
    '--mount', 'type=bind,src=/project/sites/demo,dst=/workspace',
    '--mount', 'type=bind,src=/data/git-stub,dst=/workspace/.git,ro',
    '--mount', `type=bind,src=/var/lib/elowen/site-runtime-sockets/${SITE_ID},dst=/run/elowen`,
    '--mount', `type=volume,src=elowen-site-${SITE_ID}-data,dst=/data`,
    BASE_IMAGE_TAG,
  ]);
  assert.deepEqual(executor.calls[1].args, ['start', `elowen-site-${SITE_ID}`]);
  assert.deepEqual(executor.calls[0].options.env, cleanPodmanEnv({ uid: 1000, home: '/home/elowen', user: 'elowen' }));
  assert.deepEqual(Object.keys(executor.calls[0].options.env).sort(), [
    'DBUS_SESSION_BUS_ADDRESS', 'HOME', 'LOGNAME', 'PATH', 'USER', 'XDG_RUNTIME_DIR',
  ]);
  const allArgv = executor.calls.flatMap((call) => call.args);
  for (const forbidden of ['--attach', 'restart', 'systemd-run', '--privileged', '--network=host', '-e', '-p']) {
    assert.equal(allArgv.includes(forbidden), false, forbidden);
  }
});

test('isolated environments use no network and Podman output is bounded', async () => {
  const executor = new FakeExecutor();
  executor.enqueue('x'.repeat(100), 'y'.repeat(100));
  const podman = new PodmanClient({ executor, outputLimitBytes: 16 });
  const result = await podman.run(['ps']);
  assert.equal(Buffer.byteLength(result.stdout), 16);
  assert.equal(Buffer.byteLength(result.stderr), 16);
  await podman.create({
    name: 'n', siteId: SITE_ID, memoryMb: 64, cpus: 0.25, pidsLimit: 32,
    network: 'isolated', envFile: '/e', workspace: '/w', gitStub: '/g', brokerDir: '/b', volume: 'v', image: 'i',
  });
  assert.ok(executor.calls[1].args.includes('--network=none'));
});

test('base image contents are deterministic and use the stable app socket', () => {
  assert.match(BASE_IMAGE_TAG, /^localhost\/elowen-site-base:[a-f0-9]{16}$/);
  assert.match(CONTAINERFILE, /^FROM debian:bookworm-slim/m);
  for (const dependency of ['systemd', 'systemd-sysv', 'dbus', 'ca-certificates', 'curl', 'iproute2', 'procps']) {
    assert.match(CONTAINERFILE, new RegExp(`\\b${dependency.replace('-', '\\-')}\\b`));
  }
  assert.match(CONTAINERFILE, /ENTRYPOINT \["\/sbin\/init"\]/);
  assert.match(INGRESS_SOCKET, /ListenStream=\/run\/elowen\/app\.sock/);
  assert.match(INGRESS_SERVICE, /systemd-socket-proxyd 127\.0\.0\.1:80/);
  assert.doesNotMatch(`${CONTAINERFILE}\n${INGRESS_SOCKET}\n${INGRESS_SERVICE}`, /\/run\/elowen\/ingress\.sock/);
});

function supervisorHarness(t, { statuses = [null], sealed = false, connectReady = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sites-environment-'));
  const brokerDir = join(root, 'broker', SITE_ID);
  const socketPath = join(brokerDir, 'app.sock');
  const lifecycle = [];
  const calls = [];
  let statusIndex = 0;
  let currentStatus = statuses[0] ?? null;
  const podman = {
    async inspectStatus() {
      const value = statuses[Math.min(statusIndex, statuses.length - 1)] ?? currentStatus;
      statusIndex += 1;
      calls.push(['inspect', value]);
      return value;
    },
    async create(spec) { calls.push(['create', spec]); currentStatus = 'created'; },
    async start(name) {
      calls.push(['start', name]);
      currentStatus = 'running';
      mkdirSync(brokerDir, { recursive: true });
      const server = createServer();
      await new Promise((resolve) => server.listen(socketPath, resolve));
      t.after(async () => { await new Promise((resolve) => server.close(resolve)); });
    },
    async stop(name, seconds) { calls.push(['stop', name, seconds]); currentStatus = 'stopping'; },
    async kill(name) { calls.push(['kill', name]); currentStatus = 'exited'; },
    async remove(name, options) { calls.push(['remove', name, options]); currentStatus = null; },
    async removeVolume(name) { calls.push(['volume-rm', name]); },
    async unshareRemove(paths) { calls.push(['unshare-rm', paths]); },
    async ps() {
      calls.push(['ps']);
      return currentStatus === null ? [] : [{ names: [`elowen-site-${SITE_ID}`], state: currentStatus }];
    },
  };
  const gateway = {
    async removeRuntimeSocket() { lifecycle.push('remove'); rmSync(brokerDir, { recursive: true, force: true }); },
    async prepareRuntimeSocket() { lifecycle.push('prepare'); mkdirSync(brokerDir, { recursive: true }); return { path: socketPath }; },
    async sealRuntimeSocket() { lifecycle.push('seal'); chmodSync(brokerDir, 0o510); },
  };
  if (sealed) mkdirSync(brokerDir, { recursive: true });
  const desired = environmentSite();
  const store = {
    siteById: () => desired,
    liveEnvironmentSites: () => [desired],
    updateSite: (_id, patch) => Object.assign(desired, patch),
  };
  const supervisor = new EnvironmentSupervisor({
    podman,
    store,
    gateway,
    config,
    siteDir: () => join(root, 'site'),
    brokerPath: () => socketPath,
    ensureBaseImage: async () => BASE_IMAGE_TAG,
    socketReady: async (path) => {
      try { return lstatSync(path).isSocket(); } catch { return false; }
    },
    connectReady: async () => connectReady,
    sleep: async () => { if (currentStatus === 'stopping') currentStatus = 'exited'; },
    now: (() => { let value = 0; return () => (value += 100); })(),
  });
  t.after(() => {
    try { chmodSync(brokerDir, 0o730); } catch {}
    rmSync(root, { recursive: true, force: true });
  });
  return { supervisor, lifecycle, calls, socketPath, brokerDir, site: desired };
}

test('environment start performs the direct broker sequence and never uses restart', async (t) => {
  const { supervisor, lifecycle, calls, site } = supervisorHarness(t, { statuses: [null] });
  await supervisor.start(site);
  assert.deepEqual(lifecycle, ['remove', 'prepare', 'seal']);
  assert.equal(calls.filter(([name]) => name === 'create').length, 1);
  assert.equal(calls.filter(([name]) => name === 'start').length, 1);
  assert.equal(supervisor.endpointFor(SITE_ID)?.kind, 'socket');
  assert.equal(calls.some(([name]) => name === 'restart'), false);
});

test('stop waits for exactly exited before removing the broker', async (t) => {
  const { supervisor, lifecycle, calls, site } = supervisorHarness(t, { statuses: ['running', 'stopping', 'exited'] });
  await supervisor.stop(site.id);
  const exitedInspect = calls.findIndex(([name, status]) => name === 'inspect' && status === 'exited');
  assert.ok(exitedInspect >= 0);
  assert.equal(lifecycle[0], 'remove');
  const stopIndex = calls.findIndex(([name]) => name === 'stop');
  assert.ok(stopIndex >= 0 && stopIndex < exitedInspect);
  assert.deepEqual(calls[stopIndex], ['stop', `elowen-site-${SITE_ID}`, 8]);
});

test('healthy running environment is adopted without broker preparation or removal', async (t) => {
  const { supervisor, lifecycle, calls, site, brokerDir } = supervisorHarness(t, { statuses: ['running'], sealed: true });
  const socketPath = join(brokerDir, 'app.sock');
  const server = createServer();
  await new Promise((resolve) => server.listen(socketPath, resolve));
  chmodSync(brokerDir, 0o510);
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); });

  await supervisor.start(site);
  assert.deepEqual(lifecycle, []);
  assert.equal(calls.some(([name]) => name === 'start' || name === 'create'), false);
  assert.deepEqual(supervisor.endpointFor(SITE_ID), { kind: 'socket', path: socketPath });
});

test('service detach never stops a running environment and backstop uses one ps call', async (t) => {
  const { supervisor, calls, site } = supervisorHarness(t, { statuses: [null] });
  await supervisor.start(site);
  calls.length = 0;
  await supervisor.backstop();
  await supervisor.detach();
  assert.equal(calls.filter(([name]) => name === 'ps').length, 1);
  assert.equal(calls.some(([name]) => name === 'stop' || name === 'kill'), false);
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
  assert.equal(db.appliedVersion(), 5);
  for (const runtime of ['static', 'command', 'php']) assert.equal(store.siteById(`legacy-${runtime}`).runtime, runtime);
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

test('core seam and lifecycle use the final provisioning names without forbidden wrappers', () => {
  const seams = readFileSync(new URL('../plugins/sites/src/coreSeams.ts', import.meta.url), 'utf8');
  const lifecycle = readFileSync(new URL('../plugins/sites/src/environment.ts', import.meta.url), 'utf8');
  assert.match(seams, /environmentsStatus\(\)/);
  assert.match(seams, /provisionEnvironments\(\)/);
  assert.doesNotMatch(seams, /environmentSupportStatus|installEnvironmentSupport/);
  assert.doesNotMatch(lifecycle, /systemd-run|start --attach|podman\.restart|deps\.podman\.restart/);
});

test('environment configuration is strictly bounded and separately gated', () => {
  const resolved = resolveConfig({
    allowEnvironments: true,
    environmentCpus: 99,
    environmentMemoryMb: -1,
    environmentPidsLimit: 1.2,
    environmentDiskSoftMb: Number.NaN,
    maxEnvironmentsPerAccount: 999,
  }, 'https://elowen.example', 'sites.elowen.example');
  assert.equal(resolved.allowEnvironments, true);
  assert.equal(resolved.environmentCpus, 8);
  assert.equal(resolved.environmentMemoryMb, 128);
  assert.equal(resolved.environmentPidsLimit, 16);
  assert.equal(resolved.environmentDiskSoftMb, 4096);
  assert.equal(resolved.maxEnvironmentsPerAccount, 20);
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
