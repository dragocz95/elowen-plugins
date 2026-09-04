import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';

import { BASE_IMAGE_SOURCE, BASE_IMAGE_TAG, CONTAINERFILE, INGRESS_SERVICE, INGRESS_SOCKET } from '../plugins/sites/dist/baseImage.js';
import { EnvironmentSupervisor } from '../plugins/sites/dist/environment.js';
import { cleanPodmanEnv, PodmanClient } from '../plugins/sites/dist/podman.js';
import { resolveConfig } from '../plugins/sites/dist/config.js';
import { SitesStore } from '../plugins/sites/dist/store.js';
import { createSiteHandler } from '../plugins/sites/dist/serve.js';
import { proxyToEnvironment } from '../plugins/sites/dist/proxy.js';
import { registerTools } from '../plugins/sites/dist/tools.js';
import { createApiHandlers } from '../plugins/sites/dist/api.js';
import { EnvironmentProvisioningService } from '../plugins/sites/dist/provisioning.js';

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
  environmentNetwork: 'shared',
  environmentCpus: 1,
  environmentMemoryMb: 1024,
  environmentPidsLimit: 512,
  environmentDiskSoftMb: 4096,
  releasesKept: 5,
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

test('default Podman identity comes from the service account, not poisoned ambient variables', () => {
  const previous = { HOME: process.env.HOME, USER: process.env.USER, LOGNAME: process.env.LOGNAME };
  process.env.HOME = '/poison/home';
  process.env.USER = 'poison-user';
  process.env.LOGNAME = 'poison-logname';
  try {
    const service = userInfo();
    const env = cleanPodmanEnv();
    assert.equal(env.HOME, service.homedir);
    assert.equal(env.USER, service.username);
    assert.equal(env.LOGNAME, service.username);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('Podman creates labeled data volumes and updates limits with exact argv', async () => {
  const executor = new FakeExecutor();
  const podman = new PodmanClient({ executor, uid: 1000, home: '/home/elowen', user: 'elowen' });
  await podman.createVolume(`elowen-site-${SITE_ID}-data`, SITE_ID);
  await podman.update(`elowen-site-${SITE_ID}`, { memoryMb: 1536, cpus: 2.25, pidsLimit: 640 });
  assert.deepEqual(executor.calls[0].args, [
    'volume', 'create', '--label', `io.elowen.site=${SITE_ID}`, `elowen-site-${SITE_ID}-data`,
  ]);
  assert.deepEqual(executor.calls[1].args, [
    'update', '--memory=1536m', '--memory-swap=1536m', '--cpus=2.25', '--pids-limit=640', `elowen-site-${SITE_ID}`,
  ]);
});

test('explicitly paused snapshots commit without a second Podman pause', async () => {
  const executor = new FakeExecutor();
  const podman = new PodmanClient({ executor });
  await podman.commit(`elowen-site-${SITE_ID}`, 'localhost/snapshot:test', { pause: false });
  assert.deepEqual(executor.calls[0].args, [
    'commit', '--pause=false', `elowen-site-${SITE_ID}`, 'localhost/snapshot:test',
  ]);
});

test('SiteExec command bytes use stdin and never appear in host argv', async () => {
  const executor = new FakeExecutor();
  executor.enqueue('done');
  const podman = new PodmanClient({ executor });
  const command = 'printf super-secret-command';
  const result = await podman.execInteractive(`elowen-site-${SITE_ID}`, ['/bin/bash', '-s'], command, {
    timeoutMs: 5_000,
    workdir: '/workspace',
  });
  assert.equal(result.stdout, 'done');
  assert.deepEqual(executor.calls[0].args, [
    'exec', '--interactive', '--workdir', '/workspace', `elowen-site-${SITE_ID}`, '/bin/bash', '-s',
  ]);
  assert.equal(executor.calls[0].args.some((arg) => arg.includes('super-secret-command')), false);
  assert.equal(executor.calls[0].options.input, command);
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

test('Podman ps normalizes representative 4.9 uppercase JSON fields', async () => {
  const executor = new FakeExecutor();
  executor.enqueue(JSON.stringify([{
    Id: 'abc', Names: [`elowen-site-${SITE_ID}`], State: 'running', Status: 'Up 3 minutes',
    Labels: { 'io.elowen.site': SITE_ID },
  }]));
  const podman = new PodmanClient({ executor });
  assert.deepEqual(await podman.ps(), [{
    id: 'abc', names: [`elowen-site-${SITE_ID}`], state: 'running', status: 'Up 3 minutes',
    labels: { 'io.elowen.site': SITE_ID },
  }]);
});

test('volume removal ignores only an absent volume and surfaces structural failures', async () => {
  const missing = new FakeExecutor();
  missing.enqueue('', 'Error: no such volume missing', 1);
  await new PodmanClient({ executor: missing }).removeVolume('missing');

  const denied = new FakeExecutor();
  denied.enqueue('', 'Error: permission denied', 125);
  await assert.rejects(() => new PodmanClient({ executor: denied }).removeVolume('blocked'), /permission denied/);
});

test('executor timeout kills the detached process group', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'sites-podman-timeout-'));
  const marker = join(root, 'survived');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const grandchild = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'alive'), 250); setInterval(() => {}, 1000);`;
  const parent = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: 'ignore' }); setInterval(() => {}, 1000);`;
  const podman = new PodmanClient({ binary: process.execPath, timeoutMs: 75 });
  await assert.rejects(() => podman.run(['-e', parent]), /timed out/);
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(existsSync(marker), false);
});

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

function supervisorHarness(t, { statuses = [null], sealed = false, connectReady = true, configOverrides = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sites-environment-'));
  const brokerDir = join(root, 'broker', SITE_ID);
  const socketPath = join(brokerDir, 'app.sock');
  const lifecycle = [];
  const calls = [];
  let statusIndex = 0;
  let currentStatus = statuses[0] ?? null;
  const podman = {
    async inspectStatus() {
      const value = statusIndex < statuses.length ? statuses[statusIndex] : currentStatus;
      statusIndex += 1;
      calls.push(['inspect', value]);
      return value;
    },
    async ensureVolume(name, siteId) { calls.push(['volume-ensure', name, siteId]); },
    async create(spec) { calls.push(['create', spec]); currentStatus = 'created'; },
    async update(name, limits) { calls.push(['update', name, limits]); },
    async execInteractive(name, argv, input, options) { calls.push(['exec-interactive', name, argv, input, options]); return { stdout: 'ok', stderr: '', code: 0 }; },
    async exec(name, argv, options) { calls.push(['exec', name, argv, options]); return { stdout: 'journal', stderr: '', code: 0 }; },
    async pause(name) { calls.push(['pause', name]); },
    async unpause(name) { calls.push(['unpause', name]); },
    async commit(name, image, options) { calls.push(['commit', name, image, options]); },
    async exportVolume(name, output) { calls.push(['volume-export', name, output]); mkdirSync(join(output, '..'), { recursive: true }); writeFileSync(output, 'archive'); },
    async importVolume(name, input) { calls.push(['volume-import', name, input]); },
    async removeImage(name) { calls.push(['image-rm', name]); },
    async imageExists(name) { calls.push(['image-exists', name]); return true; },
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
  const releases = [];
  let action = null;
  let execLease = null;
  const store = {
    siteById: () => desired,
    liveEnvironmentSites: () => [desired],
    environmentSitesForReconcile: () => [desired],
    updateSite: (_id, patch) => Object.assign(desired, patch),
    insertRelease: (release) => releases.unshift(release),
    deleteRelease: (_siteId, releaseId) => {
      const index = releases.findIndex((release) => release.id === releaseId);
      if (index >= 0) releases.splice(index, 1);
    },
    releases: () => releases,
    release: (siteId, releaseId) => releases.find((release) => release.siteId === siteId && release.id === releaseId) ?? null,
    tryBeginEnvironmentExec: (_siteId, token) => {
      if (action || execLease || desired.environmentDesiredState !== 'running') return false;
      execLease = token;
      return true;
    },
    endEnvironmentExec: (_siteId, token) => { if (execLease === token) execLease = null; },
    tryRequestEnvironmentControl: (_siteId, desiredState) => {
      if (execLease || action?.lastError === null) return false;
      action = null;
      Object.assign(desired, { environmentDesiredState: desiredState, lastError: null });
      return true;
    },
    environmentAction: () => action,
    putEnvironmentAction: (next) => { action = next; desired.environmentDesiredState = 'restarting'; },
    completeEnvironmentRestart: () => {
      if (desired.environmentDesiredState !== 'restarting') return false;
      Object.assign(desired, { environmentDesiredState: 'running', status: 'live', lastError: null });
      return true;
    },
    completeEnvironmentAction: (_siteId, currentReleaseId) => {
      if (!action || desired.environmentDesiredState !== 'restarting') return false;
      Object.assign(desired, {
        environmentDesiredState: 'running', status: 'live', lastError: null,
        ...(currentReleaseId === undefined ? {} : { currentReleaseId }),
      });
      action = null;
      return true;
    },
    updateEnvironmentActionError: (_siteId, error) => { if (action) action.lastError = error; },
    deleteEnvironmentAction: () => { action = null; },
  };
  const supervisor = new EnvironmentSupervisor({
    podman,
    store,
    gateway,
    config: () => config(configOverrides),
    siteDir: () => join(root, 'site'),
    brokerPath: () => socketPath,
    ensureBaseImage: async () => BASE_IMAGE_TAG,
    socketReady: async (path) => {
      try {
        const ready = lstatSync(path).isSocket();
        calls.push(['socket-ready', ready]);
        return ready;
      } catch {
        calls.push(['socket-ready', false]);
        return false;
      }
    },
    connectReady: async () => connectReady,
    sleep: async () => { if (currentStatus === 'stopping') currentStatus = 'exited'; },
    now: (() => { let value = 0; return () => (value += 100); })(),
  });
  t.after(() => {
    try { chmodSync(brokerDir, 0o730); } catch {}
    rmSync(root, { recursive: true, force: true });
  });
  return { supervisor, lifecycle, calls, socketPath, brokerDir, site: desired, store, releases, podman, root };
}

test('environment start performs the direct broker sequence and never uses restart', async (t) => {
  const { supervisor, lifecycle, calls, site } = supervisorHarness(t, { statuses: [null] });
  await supervisor.start(site);
  assert.deepEqual(lifecycle, ['remove', 'prepare', 'seal']);
  assert.equal(calls.filter(([name]) => name === 'create').length, 1);
  assert.equal(calls.filter(([name]) => name === 'start').length, 1);
  assert.deepEqual(calls.filter(([name]) => ['volume-ensure', 'create', 'update', 'start'].includes(name)).map(([name]) => name), [
    'volume-ensure', 'create', 'start',
  ]);
  assert.equal(supervisor.endpointFor(SITE_ID)?.kind, 'socket');
  assert.equal(calls.some(([name]) => name === 'restart'), false);
});

test('existing environment receives effective limits after start without recreation', async (t) => {
  const { supervisor, calls, site } = supervisorHarness(t, { statuses: ['exited'] });
  site.environmentMemoryMb = 2048;
  site.environmentCpus = 1.75;
  site.environmentPidsLimit = 700;
  await supervisor.start(site);
  assert.equal(calls.some(([name]) => name === 'create'), false);
  assert.deepEqual(calls.filter(([name]) => ['update', 'start'].includes(name)), [
    ['start', `elowen-site-${SITE_ID}`],
    ['update', `elowen-site-${SITE_ID}`, { cpus: 1.75, memoryMb: 2048, pidsLimit: 700 }],
  ]);
});

test('a previously created container retries the transient crun race through created and running states', async (t) => {
  const name = `elowen-site-${SITE_ID}`;
  const { supervisor, calls, site, podman } = supervisorHarness(t, { statuses: ['created', 'created', 'running'] });
  let updates = 0;
  podman.update = async (container, limits) => {
    calls.push(['update', container, limits]);
    updates += 1;
    if (updates < 3) {
      throw new Error('podman update failed: error opening file `/run/user/33/crun/test/status`: No such file or directory');
    }
  };
  await supervisor.start(site);
  const startIndex = calls.findIndex(([operation]) => operation === 'start');
  const readyIndex = calls.findIndex(([operation, ready]) => operation === 'socket-ready' && ready === true);
  const updateIndexes = calls.flatMap(([operation], index) => operation === 'update' ? [index] : []);
  assert.ok(startIndex >= 0);
  assert.ok(readyIndex > startIndex);
  assert.equal(updateIndexes.length, 3);
  assert.ok(updateIndexes[0] > readyIndex);
  assert.deepEqual(
    calls.slice(updateIndexes[0] + 1, updateIndexes[2]).filter(([operation]) => operation === 'inspect').map(([, status]) => status),
    ['created', 'running'],
  );
  assert.deepEqual(calls[updateIndexes[2]], ['update', name, { cpus: 1, memoryMb: 1024, pidsLimit: 512 }]);
});

test('a structural crun update failure is not retried', async (t) => {
  const { supervisor, site, podman } = supervisorHarness(t, { statuses: ['created'] });
  let updates = 0;
  podman.update = async () => { updates += 1; throw new Error('podman update failed: permission denied'); };
  await assert.rejects(() => supervisor.start(site), /permission denied/);
  assert.equal(updates, 1);
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

test('healthy running environment is adopted and clears a stale failure without broker changes', async (t) => {
  const { supervisor, lifecycle, calls, site, brokerDir } = supervisorHarness(t, { statuses: ['running'], sealed: true });
  site.status = 'failed';
  site.lastError = 'stale action error';
  const socketPath = join(brokerDir, 'app.sock');
  const server = createServer();
  await new Promise((resolve) => server.listen(socketPath, resolve));
  chmodSync(brokerDir, 0o510);
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); });

  await supervisor.start(site);
  assert.deepEqual(lifecycle, []);
  assert.equal(calls.some(([name]) => name === 'start' || name === 'create'), false);
  assert.deepEqual(supervisor.endpointFor(SITE_ID), { kind: 'socket', path: socketPath });
  assert.equal(site.status, 'live');
  assert.equal(site.lastError, null);
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

test('environment limit overrides persist only after Podman update succeeds', async (t) => {
  const { supervisor, site, podman } = supervisorHarness(t, { statuses: ['running'] });
  podman.update = async () => { throw new Error('update denied'); };
  await assert.rejects(() => supervisor.applyLimits(site, {
    environmentCpus: 2,
    environmentMemoryMb: 2048,
    environmentPidsLimit: 700,
    environmentDiskSoftMb: 8192,
  }), /update denied/);
  assert.equal(site.environmentMemoryMb, null);
});

test('environment limit overrides persist while stopped and apply on the next start', async (t) => {
  const { supervisor, site, calls } = supervisorHarness(t, { statuses: ['exited'] });
  await supervisor.applyLimits(site, {
    environmentCpus: 2,
    environmentMemoryMb: 2048,
    environmentPidsLimit: 700,
    environmentDiskSoftMb: 8192,
  });
  assert.equal(calls.some(([name]) => name === 'update'), false);
  assert.equal(site.environmentMemoryMb, 2048);

  calls.length = 0;
  await supervisor.start(site);
  assert.deepEqual(calls.filter(([name]) => ['start', 'update'].includes(name)), [
    ['start', `elowen-site-${SITE_ID}`],
    ['update', `elowen-site-${SITE_ID}`, { cpus: 2, memoryMb: 2048, pidsLimit: 700 }],
  ]);
});

test('environment exec refuses a stopped container', async (t) => {
  const { supervisor, site } = supervisorHarness(t, { statuses: ['exited'] });
  await assert.rejects(() => supervisor.exec(site, 'echo no', { timeoutSeconds: 120 }), /not running/);
});

test('environment exec serializes against a newly scheduled snapshot', async (t) => {
  const { supervisor, site, store, podman, calls } = supervisorHarness(t, { statuses: ['running'] });
  let finishExec;
  podman.execInteractive = async () => await new Promise((resolve) => { finishExec = resolve; });
  const execution = supervisor.exec(site, 'sleep', { timeoutSeconds: 120 });
  await new Promise((resolve) => setImmediate(resolve));
  store.putEnvironmentAction({
    siteId: site.id, kind: 'snapshot', snapshotId: 'after-exec', includeData: false,
    note: '', model: 'm', requestedAt: new Date().toISOString(), lastError: null,
  });
  const reconciliation = supervisor.reconcile();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.some(([name]) => name === 'pause'), false);
  finishExec({ stdout: '', stderr: '', code: 0 });
  await execution;
  await reconciliation;
  assert.equal(calls.some(([name]) => name === 'pause'), true);
});

test('environment logs use a bounded journalctl argv plus lifecycle log', async (t) => {
  const { supervisor, calls, site } = supervisorHarness(t, { statuses: ['running'] });
  const logs = await supervisor.logs(site, 5000);
  assert.equal(logs.journal, 'journal');
  assert.deepEqual(calls.find(([name]) => name === 'exec'), [
    'exec', `elowen-site-${SITE_ID}`, ['journalctl', '--no-pager', '-n', '1000'], { timeoutMs: 30000 },
  ]);
});

test('durable environment snapshot pauses, commits and exports data before unpausing', async (t) => {
  const { supervisor, calls, site, releases, store } = supervisorHarness(t, { statuses: ['running'] });
  store.putEnvironmentAction({
    siteId: site.id, kind: 'snapshot', snapshotId: 'snap-1', includeData: true,
    note: 'before change', model: 'test/model', requestedAt: new Date().toISOString(), lastError: null,
  });
  await supervisor.reconcile();
  assert.deepEqual(calls.filter(([name]) => ['pause', 'commit', 'volume-export', 'unpause'].includes(name)).map(([name]) => name), [
    'pause', 'commit', 'volume-export', 'unpause',
  ]);
  assert.deepEqual(calls.find(([name]) => name === 'commit'), [
    'commit', `elowen-site-${SITE_ID}`, `localhost/elowen-site/${SITE_ID}:snap-1`, { pause: false },
  ]);
  assert.equal(releases[0].kind, 'environment-snapshot');
  assert.match(releases[0].dataArchive, /snapshots\/snap-1\/data\.tar$/);
  assert.equal(store.environmentAction(site.id), null);
});

test('durable snapshot resumes after release metadata was committed before a crash', async (t) => {
  const { supervisor, calls, site, releases, store } = supervisorHarness(t, { statuses: ['running'] });
  releases.push({
    id: 'snap-crash', siteId: site.id, createdAt: new Date().toISOString(), model: 'm', fileCount: 0,
    sizeBytes: 0, note: '', kind: 'environment-snapshot', imageRef: `localhost/elowen-site/${site.id}:snap-crash`, dataArchive: null,
  });
  store.putEnvironmentAction({
    siteId: site.id, kind: 'snapshot', snapshotId: 'snap-crash', includeData: false,
    note: '', model: 'm', requestedAt: new Date().toISOString(), lastError: null,
  });
  await supervisor.reconcile();
  assert.equal(calls.some(([name]) => name === 'pause' || name === 'commit' || name === 'image-rm'), false);
  assert.equal(releases.length, 1);
  assert.equal(store.environmentAction(site.id), null);
});

test('durable snapshot recovers a container left paused by a process crash', async (t) => {
  const { supervisor, calls, site, store, root } = supervisorHarness(t, { statuses: ['paused', 'running'] });
  mkdirSync(join(root, 'site', 'environment', 'snapshots', 'snap-paused'), { recursive: true });
  store.putEnvironmentAction({
    siteId: site.id, kind: 'snapshot', snapshotId: 'snap-paused', includeData: false,
    note: '', model: 'm', requestedAt: new Date().toISOString(), lastError: null,
  });
  await supervisor.reconcile();
  assert.equal(calls.some(([name]) => name === 'stop'), true);
  assert.equal(calls.some(([name]) => name === 'start'), true);
  assert.deepEqual(calls.filter(([name]) => name === 'unpause' || name === 'pause').map(([name]) => name), ['pause', 'unpause']);
  assert.equal(store.environmentAction(site.id), null);
});

test('durable snapshot failure adopts a healthy environment after daemon restart and stops retrying', async (t) => {
  const { supervisor, calls, site, podman, store, brokerDir } = supervisorHarness(t, { statuses: ['running'], sealed: true });
  const socketPath = join(brokerDir, 'app.sock');
  const server = createServer();
  await new Promise((resolve) => server.listen(socketPath, resolve));
  chmodSync(brokerDir, 0o510);
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); });
  podman.exportVolume = async () => { calls.push(['volume-export-failed']); throw new Error('export failed'); };
  store.putEnvironmentAction({
    siteId: site.id, kind: 'snapshot', snapshotId: 'snap-fail', includeData: true,
    note: '', model: 'test/model', requestedAt: new Date().toISOString(), lastError: null,
  });
  await supervisor.reconcile();
  const firstPauseCount = calls.filter(([name]) => name === 'pause').length;
  await supervisor.reconcile();
  assert.equal(calls.filter(([name]) => name === 'pause').length, firstPauseCount, 'errored action must not hot-retry');
  assert.equal(calls.some(([name]) => name === 'unpause'), true);
  assert.match(store.environmentAction(site.id).lastError, /export failed/);
  assert.equal(site.status, 'live');
  assert.equal(site.lastError, null);
  assert.notEqual(supervisor.endpointFor(site.id), null);
});

test('durable snapshot cleans image and archive when release metadata cannot be stored', async (t) => {
  const { supervisor, calls, site, store, releases } = supervisorHarness(t, { statuses: ['running'] });
  store.insertRelease = () => { throw new Error('database full'); };
  store.putEnvironmentAction({
    siteId: site.id, kind: 'snapshot', snapshotId: 'snap-db', includeData: true,
    note: '', model: 'test/model', requestedAt: new Date().toISOString(), lastError: null,
  });
  await supervisor.reconcile();
  assert.equal(calls.some(([name]) => name === 'image-rm'), true);
  assert.equal(releases.length, 0);
  assert.match(store.environmentAction(site.id).lastError, /database full/);
});

test('durable snapshot marks the environment failed when unpause fails', async (t) => {
  const { supervisor, calls, site, podman, releases, store } = supervisorHarness(t, { statuses: [null] });
  await supervisor.start(site);
  calls.length = 0;
  podman.unpause = async () => { calls.push(['unpause-failed']); throw new Error('unpause failed'); };
  store.putEnvironmentAction({
    siteId: site.id, kind: 'snapshot', snapshotId: 'snap-unpause', includeData: false,
    note: '', model: 'test/model', requestedAt: new Date().toISOString(), lastError: null,
  });
  await supervisor.reconcile();
  assert.equal(calls.some(([name]) => name === 'image-rm'), true);
  assert.equal(releases.length, 0);
  assert.equal(site.status, 'failed');
  assert.match(site.lastError, /snapshot resume failed.*unpause failed/);
  assert.equal(supervisor.endpointFor(site.id), null);
  assert.match(store.environmentAction(site.id).lastError, /unpause failed/);
});

test('snapshot retention keeps the new and current snapshots even when the limit is one', async (t) => {
  const { supervisor, site, store, releases, calls, root } = supervisorHarness(t, { statuses: ['running'], configOverrides: { releasesKept: 1 } });
  site.currentReleaseId = 'protected';
  for (const id of ['protected', 'old']) {
    const snapshotDir = join(root, 'site', 'environment', 'snapshots', id);
    mkdirSync(snapshotDir, { recursive: true });
    releases.push({
      id, siteId: site.id, createdAt: new Date().toISOString(), model: 'm', fileCount: 0, sizeBytes: 0,
      note: '', kind: 'environment-snapshot', imageRef: `localhost/elowen-site/${site.id}:${id}`,
      dataArchive: join(snapshotDir, 'data.tar'),
    });
  }
  store.putEnvironmentAction({
    siteId: site.id, kind: 'snapshot', snapshotId: 'new', includeData: false,
    note: '', model: 'm', requestedAt: new Date().toISOString(), lastError: null,
  });
  await supervisor.reconcile();
  assert.deepEqual(releases.map((release) => release.id).sort(), ['new', 'protected']);
  assert.equal(calls.some(([name, image]) => name === 'image-rm' && image.endsWith(':old')), true);
  assert.equal(site.currentReleaseId, 'protected');
});

test('snapshot retention preserves its row when structural image removal fails', async (t) => {
  const { supervisor, site, store, releases, podman, root } = supervisorHarness(t, { statuses: ['running'], configOverrides: { releasesKept: 1 } });
  const oldDir = join(root, 'site', 'environment', 'snapshots', 'old');
  releases.push({
    id: 'old', siteId: site.id, createdAt: new Date().toISOString(), model: 'm', fileCount: 0, sizeBytes: 0,
    note: '', kind: 'environment-snapshot', imageRef: `localhost/elowen-site/${site.id}:old`, dataArchive: join(oldDir, 'data.tar'),
  });
  podman.removeImage = async () => { throw new Error('image store denied'); };
  store.putEnvironmentAction({
    siteId: site.id, kind: 'snapshot', snapshotId: 'new', includeData: false,
    note: '', model: 'm', requestedAt: new Date().toISOString(), lastError: null,
  });
  await supervisor.reconcile();
  assert.equal(releases.some((release) => release.id === 'old'), true);
  assert.match(store.environmentAction(site.id).lastError, /image store denied/);
});

test('daemon reconcile performs a durable restart and atomically returns desired state to running', async (t) => {
  const { supervisor, calls, site } = supervisorHarness(t, { statuses: ['running', 'stopping', 'exited'] });
  site.environmentDesiredState = 'restarting';
  await supervisor.reconcile();
  assert.equal(site.environmentDesiredState, 'running');
  assert.deepEqual(calls.filter(([name]) => ['stop', 'update', 'start'].includes(name)).map(([name]) => name), [
    'stop', 'start', 'update',
  ]);
});

test('a newer durable stop request is not overwritten when restart finishes', async (t) => {
  const { supervisor, site, podman } = supervisorHarness(t, { statuses: ['running', 'stopping', 'exited'] });
  site.environmentDesiredState = 'restarting';
  const start = podman.start;
  podman.start = async (name) => { await start(name); site.environmentDesiredState = 'stopped'; };
  await supervisor.reconcile();
  assert.equal(site.environmentDesiredState, 'stopped');
});

test('failed restart stays idle until explicit control permits exactly one retry', async (t) => {
  const { supervisor, site, podman, store, calls } = supervisorHarness(t, { statuses: ['running', 'stopping', 'exited'] });
  site.environmentDesiredState = 'restarting';
  const start = podman.start;
  let starts = 0;
  podman.start = async (name) => {
    starts += 1;
    if (starts === 1) throw new Error('restart failed once');
    await start(name);
  };
  await supervisor.reconcile();
  assert.equal(starts, 1);
  assert.match(site.lastError, /restart failed once/);
  const lifecycleCalls = () => calls.filter(([name]) => name !== 'ps').length;
  const afterFailure = lifecycleCalls();
  await supervisor.reconcile();
  await supervisor.reconcile();
  await supervisor.backstop();
  await supervisor.backstop();
  assert.equal(lifecycleCalls(), afterFailure);
  assert.equal(starts, 1);
  assert.equal(store.tryRequestEnvironmentControl(site.id, 'restarting'), true);
  await supervisor.reconcile();
  assert.equal(starts, 2);
  assert.equal(site.lastError, null);
  assert.equal(site.environmentDesiredState, 'running');
  await supervisor.reconcile();
  await supervisor.backstop();
  assert.equal(starts, 2);
});

test('fleet backstop never clears a durable restarting state', async (t) => {
  const { supervisor, site, calls } = supervisorHarness(t, { statuses: ['running'] });
  site.environmentDesiredState = 'restarting';
  await supervisor.backstop();
  assert.equal(site.environmentDesiredState, 'restarting');
  assert.equal(calls.some(([name]) => name === 'start'), false);
});

test('daemon reconcile completes durable rollback and returns desired state to running', async (t) => {
  const { supervisor, calls, site, store, releases, root } = supervisorHarness(t, { statuses: ['running', 'stopping', 'exited'] });
  const dataArchive = join(root, 'site', 'environment', 'snapshots', 'restore-1', 'data.tar');
  releases.push({
    id: 'restore-1', siteId: site.id, createdAt: new Date().toISOString(), model: 'm', fileCount: 0,
    sizeBytes: 0, note: '', kind: 'environment-snapshot', imageRef: `localhost/elowen-site/${site.id}:restore-1`,
    dataArchive,
  });
  store.putEnvironmentAction({
    siteId: site.id, kind: 'rollback', snapshotId: 'restore-1', restoreData: true,
    requestedAt: new Date().toISOString(), lastError: null,
  });
  await supervisor.reconcile();
  assert.equal(store.environmentAction(site.id), null);
  assert.equal(site.environmentDesiredState, 'running');
  assert.equal(site.currentReleaseId, 'restore-1');
  assert.equal(calls.some(([name, spec]) => name === 'create' && spec.image === releases[0].imageRef), true);
  assert.deepEqual(calls.filter(([name]) => ['stop', 'remove', 'volume-rm', 'volume-ensure', 'volume-import', 'volume-export', 'create', 'update', 'start'].includes(name)).map(([name]) => name), [
    'volume-rm', 'volume-ensure', 'volume-import', 'volume-rm',
    'stop', 'remove', 'volume-export', 'volume-rm', 'volume-ensure', 'volume-import',
    'create', 'start',
  ]);
});

test('rollback restores previous data when restored rootfs fails readiness', async (t) => {
  const { supervisor, site, store, releases, root, podman, calls } = supervisorHarness(t, { statuses: ['running', 'stopping', 'exited'] });
  const dataArchive = join(root, 'site', 'environment', 'snapshots', 'start-fail', 'data.tar');
  releases.push({
    id: 'start-fail', siteId: site.id, createdAt: new Date().toISOString(), model: 'm', fileCount: 0,
    sizeBytes: 0, note: '', kind: 'environment-snapshot', imageRef: `localhost/elowen-site/${site.id}:start-fail`, dataArchive,
  });
  podman.start = async () => { throw new Error('restored rootfs failed to start'); };
  store.putEnvironmentAction({
    siteId: site.id, kind: 'rollback', snapshotId: 'start-fail', restoreData: true,
    requestedAt: new Date().toISOString(), lastError: null,
  });
  await supervisor.reconcile();
  const backup = join(root, 'site', 'environment', 'restore', 'start-fail', 'previous-data.tar');
  const recoveryRemove = calls.findLastIndex(([name]) => name === 'remove');
  const backupImport = calls.findIndex(([name, _volume, input]) => name === 'volume-import' && input === backup);
  assert.ok(recoveryRemove > calls.findIndex(([name]) => name === 'create'));
  assert.ok(recoveryRemove < backupImport, 'failed snapshot container must be removed before restoring its attached volume');
  assert.equal(backupImport >= 0, true);
  assert.equal(existsSync(backup), false);
  assert.match(store.environmentAction(site.id).lastError, /failed to start/);
});

test('rollback rejects stale cross-site image and archive references before stopping', async (t) => {
  const { supervisor, site, store, releases, calls, root } = supervisorHarness(t, { statuses: ['running'] });
  releases.push({
    id: 'stale', siteId: site.id, createdAt: new Date().toISOString(), model: 'm', fileCount: 0,
    sizeBytes: 0, note: '', kind: 'environment-snapshot', imageRef: 'localhost/elowen-site/other-site:stale',
    dataArchive: join(root, 'site', 'environment', 'snapshots', 'other', 'data.tar'),
  });
  store.putEnvironmentAction({
    siteId: site.id, kind: 'rollback', snapshotId: 'stale', restoreData: true,
    requestedAt: new Date().toISOString(), lastError: null,
  });
  await supervisor.reconcile();
  assert.equal(calls.some(([name]) => name === 'stop'), false);
  assert.match(store.environmentAction(site.id).lastError, /not retained for this site/);
});

test('rollback verifies snapshot image before stopping the current container', async (t) => {
  const { supervisor, site, store, releases, podman, calls } = supervisorHarness(t, { statuses: ['running'] });
  releases.push({
    id: 'missing-image', siteId: site.id, createdAt: new Date().toISOString(), model: 'm', fileCount: 0,
    sizeBytes: 0, note: '', kind: 'environment-snapshot', imageRef: `localhost/elowen-site/${site.id}:missing-image`, dataArchive: null,
  });
  podman.imageExists = async () => false;
  store.putEnvironmentAction({
    siteId: site.id, kind: 'rollback', snapshotId: 'missing-image', restoreData: false,
    requestedAt: new Date().toISOString(), lastError: null,
  });
  await supervisor.reconcile();
  assert.equal(calls.some(([name]) => name === 'stop' || name === 'remove'), false);
  assert.match(store.environmentAction(site.id).lastError, /image is missing/);
});

test('failed data restore puts the previous volume back and leaves the action durable', async (t) => {
  const { supervisor, site, store, releases, root, podman, calls } = supervisorHarness(t, { statuses: ['running', 'stopping', 'exited'] });
  const dataArchive = join(root, 'site', 'environment', 'snapshots', 'restore-fail', 'data.tar');
  releases.push({
    id: 'restore-fail', siteId: site.id, createdAt: new Date().toISOString(), model: 'm', fileCount: 0,
    sizeBytes: 0, note: '', kind: 'environment-snapshot', imageRef: `localhost/elowen-site/${site.id}:restore-fail`, dataArchive,
  });
  let imports = 0;
  podman.importVolume = async (name, input) => {
    imports += 1;
    calls.push(['volume-import', name, input]);
    if (imports === 2) throw new Error('snapshot import failed');
  };
  store.putEnvironmentAction({
    siteId: site.id, kind: 'rollback', snapshotId: 'restore-fail', restoreData: true,
    requestedAt: new Date().toISOString(), lastError: null,
  });
  await supervisor.reconcile();
  assert.equal(imports, 3, 'validate snapshot, failed replacement, restore previous backup');
  assert.match(store.environmentAction(site.id).lastError, /snapshot import failed/);
  assert.equal(site.status, 'failed');
});

test('failed previous-data restore keeps the durable backup archive', async (t) => {
  const { supervisor, site, store, releases, root, podman, calls } = supervisorHarness(t, { statuses: ['running', 'stopping', 'exited'] });
  const dataArchive = join(root, 'site', 'environment', 'snapshots', 'restore-broken', 'data.tar');
  releases.push({
    id: 'restore-broken', siteId: site.id, createdAt: new Date().toISOString(), model: 'm', fileCount: 0,
    sizeBytes: 0, note: '', kind: 'environment-snapshot', imageRef: `localhost/elowen-site/${site.id}:restore-broken`, dataArchive,
  });
  let imports = 0;
  podman.importVolume = async (name, input) => {
    imports += 1;
    calls.push(['volume-import', name, input]);
    if (imports >= 2) throw new Error(imports === 2 ? 'snapshot import failed' : 'backup restore failed');
  };
  store.putEnvironmentAction({
    siteId: site.id, kind: 'rollback', snapshotId: 'restore-broken', restoreData: true,
    requestedAt: new Date().toISOString(), lastError: null,
  });
  await supervisor.reconcile();
  assert.match(store.environmentAction(site.id).lastError, /previous data backup could not be restored/);
  assert.equal(existsSync(join(root, 'site', 'environment', 'restore', 'restore-broken', 'previous-data.tar')), true);
});

test('environment delete removes snapshots and pending actions without deleting Project source', async (t) => {
  const { supervisor, calls, site, releases, store } = supervisorHarness(t, { statuses: [null] });
  releases.push({
    id: 'delete-snapshot', siteId: site.id, createdAt: new Date().toISOString(), model: 'm', fileCount: 0,
    sizeBytes: 0, note: '', kind: 'environment-snapshot', imageRef: `localhost/elowen-site/${site.id}:delete-snapshot`, dataArchive: null,
  });
  store.putEnvironmentAction({ siteId: site.id, kind: 'rollback', snapshotId: 'delete-snapshot', restoreData: false, requestedAt: new Date().toISOString(), lastError: null });
  await supervisor.delete(site.id);
  assert.equal(calls.some(([name]) => name === 'image-rm'), true);
  assert.equal(store.environmentAction(site.id), null);
  const cleanup = calls.find(([name]) => name === 'unshare-rm');
  assert.ok(cleanup);
  assert.equal(cleanup[1].includes(site.sourceDir), false);
  assert.deepEqual(cleanup[1].map((path) => path.endsWith('/environment')), [true]);
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
  assert.equal(db.appliedVersion(), 8);
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

test('environment exec leases exclude lifecycle changes across processes', () => {
  const store = new SitesStore(makeDb());
  store.insertSite(environmentSite());
  assert.equal(store.tryBeginEnvironmentExec(SITE_ID, 'exec-token', Date.now() + 60_000), true);
  assert.equal(store.tryPutEnvironmentAction({
    siteId: SITE_ID, kind: 'snapshot', snapshotId: 'blocked', includeData: false,
    note: '', model: 'm', requestedAt: new Date().toISOString(), lastError: null,
  }), false);
  assert.equal(store.tryRequestEnvironmentControl(SITE_ID, 'stopped'), false);
  store.endEnvironmentExec(SITE_ID, 'wrong-token');
  assert.equal(store.tryRequestEnvironmentControl(SITE_ID, 'stopped'), false);
  store.endEnvironmentExec(SITE_ID, 'exec-token');
  assert.equal(store.tryRequestEnvironmentControl(SITE_ID, 'stopped'), true);
  assert.equal(store.tryPutEnvironmentAction({
    siteId: SITE_ID, kind: 'snapshot', snapshotId: 'lost-stop', includeData: false,
    note: '', model: 'm', requestedAt: new Date().toISOString(), lastError: null,
  }), false);
  assert.equal(store.siteById(SITE_ID).environmentDesiredState, 'stopped');
});

test('errored durable actions can be replaced while clean actions remain exclusive', () => {
  const store = new SitesStore(makeDb());
  store.insertSite(environmentSite());
  assert.equal(store.tryPutEnvironmentAction({
    siteId: SITE_ID, kind: 'snapshot', snapshotId: 'snap-a', includeData: true,
    note: 'a', model: 'm', requestedAt: new Date().toISOString(), lastError: null,
  }), true);
  assert.equal(store.tryPutEnvironmentAction({
    siteId: SITE_ID, kind: 'rollback', snapshotId: 'snap-b', restoreData: false,
    requestedAt: new Date().toISOString(), lastError: null,
  }), false);
  store.updateEnvironmentActionError(SITE_ID, 'failed once');
  assert.equal(store.tryPutEnvironmentAction({
    siteId: SITE_ID, kind: 'rollback', snapshotId: 'snap-b', restoreData: false,
    requestedAt: new Date().toISOString(), lastError: null,
  }), true);
  assert.equal(store.environmentAction(SITE_ID).kind, 'rollback');
  assert.equal(store.environmentAction(SITE_ID).lastError, null);
  assert.equal(store.completeEnvironmentAction(SITE_ID, 'snap-b'), true);
  assert.equal(store.environmentAction(SITE_ID), null);
  assert.equal(store.siteById(SITE_ID).currentReleaseId, 'snap-b');
  assert.equal(store.siteById(SITE_ID).environmentDesiredState, 'running');
  assert.equal(store.siteById(SITE_ID).status, 'live');
});

test('core seam, manifest and lifecycle match the final core contract', () => {
  const seams = readFileSync(new URL('../plugins/sites/src/coreSeams.ts', import.meta.url), 'utf8');
  const index = readFileSync(new URL('../plugins/sites/src/index.ts', import.meta.url), 'utf8');
  const lifecycle = readFileSync(new URL('../plugins/sites/src/environment.ts', import.meta.url), 'utf8');
  const manifest = JSON.parse(readFileSync(new URL('../plugins/sites/elowen-plugin.json', import.meta.url), 'utf8'));
  assert.match(seams, /environmentsStatus\(\)/);
  assert.match(seams, /provisionEnvironments\(\)/);
  assert.match(seams, /ready: boolean/);
  assert.match(seams, /items: PublishedSitesEnvironmentStatusItem\[\]/);
  assert.doesNotMatch(seams, /EnvironmentProvision|steps: Environment|status: Environment|error\?: string/);
  assert.match(index, /report\.items/);
  assert.match(index, /report\.ready/);
  assert.doesNotMatch(index, /report\.steps|report\.available|report\.ok|report\.error/);
  assert.equal(manifest.requiresCore, '0.28.31');
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
  assert.doesNotMatch(lifecycle, /systemd-run|start --attach|podman\.restart|deps\.podman\.restart/);
});

test('environment configuration is strictly bounded and separately gated', () => {
  const resolved = resolveConfig({
    allowEnvironments: true,
    runtimeNetwork: 'isolated',
    environmentNetwork: 'shared',
    environmentCpus: 99,
    environmentMemoryMb: -1,
    environmentPidsLimit: 1.2,
    environmentDiskSoftMb: Number.NaN,
    maxEnvironmentsPerAccount: 999,
  }, 'https://elowen.example', 'sites.elowen.example');
  assert.equal(resolved.allowEnvironments, true);
  assert.equal(resolved.runtimeNetwork, 'isolated');
  assert.equal(resolved.environmentNetwork, 'shared');
  assert.equal(resolveConfig({ runtimeNetwork: 'shared', environmentNetwork: 'invalid' }, null).environmentNetwork, 'shared');
  assert.equal(resolved.environmentCpus, 8);
  assert.equal(resolved.environmentMemoryMb, 128);
  assert.equal(resolved.environmentPidsLimit, 16);
  assert.equal(resolved.environmentDiskSoftMb, 4096);
  assert.equal(resolved.maxEnvironmentsPerAccount, 20);
});

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
    workDir: () => project,
    assertPathAllowed: (path) => path,
    control: () => undefined,
    host: { stores: () => ({ projects: { list: () => [{ id: 7, slug: 'demo', path: project }] } }) },
  };
  const resolved = () => resolveConfig({ allowEnvironments: true, ...configRaw }, 'https://elowen.example', 'sites.elowen.example');
  const environment = {
    async state(site) {
      return {
        state: 'running', desiredState: site.environmentDesiredState ?? 'running',
        limits: {
          cpus: site.environmentCpus ?? resolved().environmentCpus,
          memoryMb: site.environmentMemoryMb ?? resolved().environmentMemoryMb,
          pidsLimit: site.environmentPidsLimit ?? resolved().environmentPidsLimit,
          diskSoftMb: site.environmentDiskSoftMb ?? resolved().environmentDiskSoftMb,
        },
      };
    },
    async exec(site, command, options) { environmentCalls.push(['exec', site.id, command, options]); return { stdout: 'exec-ok', stderr: '', code: 0 }; },
    async snapshot(site, options) {
      environmentCalls.push(['snapshot', site.id, options]);
      const release = {
        id: options.snapshotId, siteId: site.id, createdAt: new Date().toISOString(), model: options.model,
        fileCount: 0, sizeBytes: 0, note: options.note, kind: 'environment-snapshot',
        imageRef: `localhost/elowen-site/${site.id}:${options.snapshotId}`, dataArchive: null,
      };
      store.insertRelease(release);
      return release;
    },
    async logs(site, lines) { environmentCalls.push(['logs', site.id, lines]); return { lifecycle: 'life', journal: 'journal' }; },
  };
  registerTools({
    ctx, store, access, config: resolved,
    people: () => new Map([[userId, { id: userId, username: `user-${userId}`, name: `User ${userId}`, avatar: '' }]]),
    siteDir: (id) => join(root, 'data', id), releaseDir: (id, releaseId) => join(root, 'data', id, releaseId),
    deleteSite: async () => {},
    runtime: { allocatePort: async () => 43000, stop: async () => {}, start: async () => {}, logTail: () => '', isRunning: () => false },
    environment,
  });
  return { store, environmentCalls, call: (name, input = {}) => registered.get(name).execute('call-1', input) };
}

test('SiteCreate creates a durable environment from a forked runner without gateway control', async (t) => {
  const harness = phase2ToolHarness(t);
  const result = await harness.call('SiteCreate', { title: 'Persistent app', runtime: 'environment' });
  const site = harness.store.siteById(result.details.siteId);
  assert.equal(site.runtime, 'environment');
  assert.equal(site.status, 'live');
  assert.equal(site.currentReleaseId, null);
  assert.equal(site.environmentDesiredState, 'running');
  assert.match(result.content[0].text, /SiteExec/);
  assert.match(result.content[0].text, /\/workspace/);
  assert.match(result.content[0].text, /\/data/);
  assert.match(result.content[0].text, /port 80/i);
  assert.match(result.content[0].text, /1 MB/);
});

test('SiteCreate enforces the environment gate, separate count and environment-only inputs', async (t) => {
  const disabled = phase2ToolHarness(t, { configRaw: { allowEnvironments: false } });
  await assert.rejects(() => disabled.call('SiteCreate', { title: 'No', runtime: 'environment' }), /environments are turned off/i);

  const limited = phase2ToolHarness(t, { configRaw: { maxEnvironmentsPerAccount: 1 } });
  limited.store.insertSite(environmentSite({ id: 'existing', slug: 'existing', ownerUserId: 1, projectId: 7 }));
  await assert.rejects(() => limited.call('SiteCreate', { title: 'Another', runtime: 'environment' }), /environment.*limit/i);

  const enabled = phase2ToolHarness(t);
  await assert.rejects(() => enabled.call('SiteCreate', { title: 'Bad', runtime: 'environment', startCommand: 'node app.js' }), /startCommand/);
  await assert.rejects(() => enabled.call('SiteCreate', { title: 'Bad', runtime: 'environment', bind: 'socket' }), /bind/);
});

test('SiteExec enforces publisher and Project access and runs synchronously in a forked runner', async (t) => {
  const allowed = phase2ToolHarness(t);
  allowed.store.insertSite(environmentSite({ ownerUserId: 1, projectId: 7 }));
  const result = await allowed.call('SiteExec', { site: SITE_ID, command: 'echo ok', timeoutSeconds: 900, workdir: '/workspace' });
  assert.equal(result.content[0].text.includes('exec-ok'), true);
  assert.deepEqual(allowed.environmentCalls[0], ['exec', SITE_ID, 'echo ok', { timeoutSeconds: 900, workdir: '/workspace' }]);
  await assert.rejects(() => allowed.call('SiteExec', { site: SITE_ID, command: 'x', workdir: '/workspace/../data' }), /workdir/i);

  const noProject = phase2ToolHarness(t, { projectAccess: false });
  noProject.store.insertSite(environmentSite({ ownerUserId: 1, projectId: 7 }));
  await assert.rejects(() => noProject.call('SiteExec', { site: SITE_ID, command: 'echo no' }), /Project access/i);

  const noPublisher = phase2ToolHarness(t, { configRaw: { publishers: 'admins' } });
  noPublisher.store.insertSite(environmentSite({ ownerUserId: 1, projectId: 7 }));
  await assert.rejects(() => noPublisher.call('SiteExec', { site: SITE_ID, command: 'echo no' }), /not allowed to publish/i);
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
      id: 'admin-snapshot', siteId: SITE_ID, createdAt: new Date().toISOString(), model: 'm', fileCount: 0,
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
      id: 'owner-snapshot', siteId: SITE_ID, createdAt: new Date().toISOString(), model: 'm', fileCount: 0,
      sizeBytes: 0, note: '', kind: 'environment-snapshot', imageRef: `localhost/elowen-site/${SITE_ID}:owner-snapshot`, dataArchive: null,
    });
    await assert.rejects(() => harness.call(tool, { site: SITE_ID, ...input }), /Project access/i);
  }
});

test('SiteControl clears an errored action but never a clean in-flight action', async (t) => {
  const harness = phase2ToolHarness(t);
  harness.store.insertSite(environmentSite({ ownerUserId: 1, projectId: 7, status: 'failed', lastError: 'failed' }));
  harness.store.putEnvironmentAction({
    siteId: SITE_ID, kind: 'snapshot', snapshotId: 'failed', includeData: false, note: '', model: 'm',
    requestedAt: new Date().toISOString(), lastError: 'failed',
  });
  await harness.call('SiteControl', { site: SITE_ID, action: 'start' });
  assert.equal(harness.store.environmentAction(SITE_ID), null);
  assert.equal(harness.store.siteById(SITE_ID).status, 'failed');
  assert.equal(harness.store.siteById(SITE_ID).lastError, null);
  harness.store.putEnvironmentAction({
    siteId: SITE_ID, kind: 'snapshot', snapshotId: 'clean', includeData: false, note: '', model: 'm',
    requestedAt: new Date().toISOString(), lastError: null,
  });
  await assert.rejects(() => harness.call('SiteControl', { site: SITE_ID, action: 'stop' }), /already in progress/i);
  assert.equal(harness.store.environmentAction(SITE_ID).snapshotId, 'clean');
});

test('SiteExec refuses every pending environment mutation', async (t) => {
  for (const desiredState of ['stopped', 'restarting']) {
    const harness = phase2ToolHarness(t);
    harness.store.insertSite(environmentSite({ ownerUserId: 1, projectId: 7, environmentDesiredState: desiredState }));
    await assert.rejects(() => harness.call('SiteExec', { site: SITE_ID, command: 'echo no' }), /pending/i);
  }
  const harness = phase2ToolHarness(t);
  harness.store.insertSite(environmentSite({ ownerUserId: 1, projectId: 7 }));
  harness.store.putEnvironmentAction({
    siteId: SITE_ID, kind: 'snapshot', snapshotId: 'pending', includeData: false, note: '', model: 'm',
    requestedAt: new Date().toISOString(), lastError: null,
  });
  await assert.rejects(() => harness.call('SiteExec', { site: SITE_ID, command: 'echo no' }), /pending/i);
});

test('SiteSnapshot queues daemon work and SiteGet exposes pending action errors', async (t) => {
  const harness = phase2ToolHarness(t);
  harness.store.insertSite(environmentSite({ ownerUserId: 1, projectId: 7 }));
  const scheduled = await harness.call('SiteSnapshot', { site: SITE_ID, includeData: true, note: 'before change' });
  const action = harness.store.environmentAction(SITE_ID);
  assert.equal(action.kind, 'snapshot');
  assert.equal(action.includeData, true);
  assert.equal(action.note, 'before change');
  assert.equal(scheduled.details.scheduled, true);
  assert.equal(harness.environmentCalls.some(([name]) => name === 'snapshot'), false);
  harness.store.updateEnvironmentActionError(SITE_ID, 'snapshot failed once');
  const detail = await harness.call('SiteGet', { site: SITE_ID });
  assert.equal(detail.details.environmentAction.lastError, 'snapshot failed once');
  const retried = await harness.call('SiteSnapshot', { site: SITE_ID, includeData: false, note: 'retry' });
  assert.notEqual(retried.details.snapshotId, action.snapshotId);
  assert.equal(harness.store.environmentAction(SITE_ID).lastError, null);
  assert.equal(harness.store.environmentAction(SITE_ID).kind, 'snapshot');
});

test('SiteControl and SiteRollback persist durable daemon work without ambient gateway control', async (t) => {
  const harness = phase2ToolHarness(t);
  const site = environmentSite({ ownerUserId: 1, projectId: 7 });
  harness.store.insertSite(site);
  harness.store.insertRelease({
    id: 'snapshot-1', siteId: site.id, createdAt: new Date().toISOString(), model: 'm', fileCount: 0,
    sizeBytes: 0, note: '', kind: 'environment-snapshot', imageRef: `localhost/elowen-site/${site.id}:snapshot-1`, dataArchive: '/snapshot/data.tar',
  });
  await harness.call('SiteControl', { site: SITE_ID, action: 'restart' });
  assert.equal(harness.store.siteById(SITE_ID).environmentDesiredState, 'restarting');
  harness.store.updateSite(SITE_ID, { environmentDesiredState: 'running' });
  await harness.call('SiteRollback', { site: SITE_ID, releaseId: 'snapshot-1', restoreData: true });
  assert.deepEqual(harness.store.environmentAction(SITE_ID), {
    siteId: SITE_ID, kind: 'rollback', snapshotId: 'snapshot-1', restoreData: true,
    requestedAt: harness.store.environmentAction(SITE_ID).requestedAt, lastError: null,
  });

  harness.store.insertSite(environmentSite({ id: 'other-site', slug: 'other-site', ownerUserId: 1, projectId: 7 }));
  await assert.rejects(() => harness.call('SiteRollback', { site: 'other-site', releaseId: 'snapshot-1' }), /not retained for this site/i);
});

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
    environmentState: async (site) => ({
      state: 'running', desiredState: site.environmentDesiredState,
      limits: { cpus: 1, memoryMb: 1024, pidsLimit: 512, diskSoftMb: 4096 },
    }),
    environmentLogs: async (_site, lines) => { calls.push(['logs', lines]); return { lifecycle: 'life', journal: 'journal' }; },
    gatewayReadiness: async () => ({
      id: 'sites-gateway', label: 'Published sites gateway', ok: false, status: 'misdirected',
      detail: 'wrong target', observedTargets: ['203.0.113.5'],
    }),
    gatewayRecord: () => ({ type: 'CNAME', name: '*.sites.elowen.example', value: 'elowen.example.' }),
    requestEnvironmentControl: async (site, action) => { calls.push(['control', site.id, action]); store.updateSite(site.id, { environmentDesiredState: action === 'stop' ? 'stopped' : action === 'restart' ? 'restarting' : 'running' }); },
    snapshotEnvironment: async (site, input) => {
      calls.push(['snapshot', site.id, input]);
      if (!store.tryPutEnvironmentAction({
        siteId: site.id, kind: 'snapshot', snapshotId: 'snap-api', includeData: input.includeData,
        note: input.note, model: 'm', requestedAt: new Date().toISOString(), lastError: null,
      })) throw new Error('action pending');
      return { id: 'snap-api' };
    },
    rollbackEnvironment: async (site, input) => { calls.push(['rollback', site.id, input]); },
    applyEnvironmentLimits: async (site, limits) => { calls.push(['limits', site.id, limits]); store.updateSite(site.id, limits); },
    provisioning: provisioning ?? { status: async () => ({ ready: true, items: [] }), provision: async () => ({ ready: true, items: [] }) },
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
    id: 'snap', siteId: SITE_ID, createdAt: new Date().toISOString(), model: 'm', fileCount: 0, sizeBytes: 0,
    note: '', kind: 'environment-snapshot', imageRef: `localhost/elowen-site/${SITE_ID}:snap`, dataArchive: null,
  });
  const detail = await handlers.site(apiRequest({ path: SITE_ID }));
  assert.equal(detail.status, 200);
  assert.equal(detail.body.environment.state, 'running');
  assert.equal(detail.body.site.runtime, 'environment');
  assert.equal(detail.body.environment.desiredState, 'running');
  assert.equal(detail.body.environment.limits.memoryMb, 1024);
  assert.deepEqual(detail.body.environment.limitOverrides, { cpus: null, memoryMb: null, pidsLimit: null, diskSoftMb: null });
  assert.equal(detail.body.environment.canControl, true);
  assert.equal(detail.body.environment.canSetLimits, false);
  const adminDetail = await handlers.site(apiRequest({ path: SITE_ID, admin: true }));
  assert.equal(adminDetail.body.environment.canSetLimits, true);
  assert.equal(detail.body.environment.transport.requestBodyLimitBytes, 1024 * 1024);
  assert.equal(detail.body.releases[0].kind, 'environment-snapshot');
  assert.equal(detail.body.releases[0].imageRef, undefined);
  assert.equal(detail.body.releases[0].dataArchive, undefined);
  const logs = await handlers.site(apiRequest({ path: `${SITE_ID}/logs`, query: { lines: '9000' } }));
  assert.equal(logs.status, 200);
  assert.deepEqual(logs.body, { lifecycle: 'life', journal: 'journal', lines: 1000 });
  assert.deepEqual(calls.shift(), ['logs', 1000]);

  assert.equal((await handlers.site(apiRequest({ method: 'POST', path: `${SITE_ID}/control`, body: { action: 'restart' } }))).status, 200);
  store.updateSite(SITE_ID, { environmentDesiredState: 'running' });
  assert.equal((await handlers.site(apiRequest({ method: 'POST', path: `${SITE_ID}/snapshot`, body: { includeData: true } }))).status, 200);
  store.updateEnvironmentActionError(SITE_ID, 'api snapshot failed');
  const pending = await handlers.site(apiRequest({ path: SITE_ID }));
  assert.equal(pending.body.environment.action.lastError, 'api snapshot failed');
  store.deleteEnvironmentAction(SITE_ID);
  store.updateSite(SITE_ID, { environmentDesiredState: 'running' });
  assert.equal((await handlers.site(apiRequest({ method: 'POST', path: `${SITE_ID}/rollback`, body: { releaseId: 'snap', restoreData: false } }))).status, 200);
  assert.deepEqual(calls.map(([name]) => name), ['control', 'snapshot', 'rollback']);
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
  assert.equal(calls.length, 0);
  assert.equal(store.siteById(SITE_ID).environmentMemoryMb, null);

  const admin = await handlers.site(apiRequest({ method: 'PATCH', path: SITE_ID, admin: true, body: {
    environmentCpus: 99, environmentMemoryMb: 64, environmentPidsLimit: 2, environmentDiskSoftMb: 999999,
  } }));
  assert.equal(admin.status, 200);
  assert.deepEqual(calls[0], ['limits', SITE_ID, {
    environmentCpus: 8, environmentMemoryMb: 128, environmentPidsLimit: 16, environmentDiskSoftMb: 131072,
  }]);
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
