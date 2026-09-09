// Driver-boundary invariants for the container driver that used to live in the Sites PodmanClient.
// The concrete driver moved into the Sandbox plugin, so this suite drives the ACTUAL Sandbox-owned
// driver (PodmanClient and SpawnExecutor from the runtime plugin source) with an injected fake executor:
// no real Podman engine, no isolation namespace and no account-default storage is ever touched.
//
// Dependency statement: the driver source lives in the environments runtime checkout
// (the installed elowen SDK's plugins/sandbox/lib, read-only here). When the parent combines
// the real runtime this import stays valid; it is the one deliberate Sites-side coupling to that path.
//
// Runtime-orchestration invariants that sit ABOVE the driver (stop waits for `exited` before broker
// removal, snapshot pause/commit/export/unpause sequencing, crun update recovery, fleet sweeps) belong
// to the Sandbox lifecycle owner and are covered by its own suite, not duplicated here.

import assert from 'node:assert/strict';
import test from 'node:test';
import { userInfo } from 'node:os';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  FakeExecutor, IMAGE, PodmanClient, SpawnExecutor, cleanPodmanEnv, inspectRow, makeDriverRoot, makeSiteSpec,
  volumeInspectRow,
} from './helpers/sitesOwnedEnvironmentDriver.mjs';

const snapshotId = 'snap-1';
const is = (args, head) => head.every((token, index) => args[index] === token);

test('create uses argv-only calls with the exact clean environment and hardened defaults', async (t) => {
  const root = makeDriverRoot(t);
  const spec = makeSiteSpec(root);
  let containerCreated = false;
  const executor = new FakeExecutor()
    .on((args) => is(args, ['info']), { stdout: 'true\n' })
    .on((args) => is(args, ['container', 'exists']), () => ({ code: containerCreated ? 0 : 1 }))
    .on((args) => is(args, ['volume', 'exists']), { code: 0 })
    .on((args) => is(args, ['volume', 'inspect']), { stdout: JSON.stringify([volumeInspectRow(spec, 'data')]) })
    .on((args) => is(args, ['create']), () => { containerCreated = true; return { code: 0 }; })
    .on((args) => is(args, ['inspect', '--type']), { stdout: JSON.stringify([inspectRow(spec, 'created')]) });
  const podman = new PodmanClient({ executor, uid: 1000, home: '/home/elowen', user: 'elowen' });

  await podman.create(spec);

  const create = executor.calls.find((call) => call.args[0] === 'create');
  assert.deepEqual(create.args.slice(0, 3), ['create', '--name', spec.name]);
  assert.deepEqual(create.args.filter((arg) => arg.startsWith('io.elowen.')), Object.entries(spec.labels)
    .map(([key, value]) => `${key}=${value}`));
  for (const token of [
    '--cgroups=split', '--systemd=always', '--ipc=private', '--memory=768m', '--memory-swap=768m', '--cpus=1.5',
    '--pids-limit=300', '--network=slirp4netns:allow_host_loopback=false', '--workdir=/workspace', '--env=HOME=/root',
  ]) {
    assert.equal(create.args.includes(token), true, token);
  }
  const envFile = create.args.indexOf('--env-file');
  assert.deepEqual(create.args.slice(envFile, envFile + 2), ['--env-file', spec.envFile]);
  assert.deepEqual(create.args.filter((arg) => arg.startsWith('type=')), [
    `type=bind,src=${spec.mounts[0].source},dst=/workspace`,
    `type=bind,src=${spec.mounts[1].source},dst=/workspace/.git,ro`,
    `type=bind,src=${spec.mounts[2].source},dst=/run/elowen`,
    `type=volume,src=${spec.mounts[3].source},dst=/data`,
  ]);
  assert.equal(create.args.at(-1), IMAGE);

  // Every Podman call runs on the exact clean service-account environment, never ambient variables.
  for (const call of executor.calls) {
    assert.deepEqual(call.options.env, cleanPodmanEnv({ uid: 1000, home: '/home/elowen', user: 'elowen' }));
    assert.deepEqual(Object.keys(call.options.env).sort(), [
      'DBUS_SESSION_BUS_ADDRESS', 'HOME', 'LOGNAME', 'PATH', 'USER', 'XDG_RUNTIME_DIR',
    ]);
  }
  const flattened = executor.calls.flatMap((call) => call.args);
  for (const forbidden of ['--attach', '--privileged', '--network=host', '-e', '-p', 'restart']) {
    assert.equal(flattened.includes(forbidden), false, forbidden);
  }
});

test('isolated environments run without any network', async (t) => {
  const root = makeDriverRoot(t);
  const spec = makeSiteSpec(root, { network: 'isolated' });
  let containerCreated = false;
  const executor = new FakeExecutor()
    .on((args) => is(args, ['info']), { stdout: 'true\n' })
    .on((args) => is(args, ['container', 'exists']), () => ({ code: containerCreated ? 0 : 1 }))
    .on((args) => is(args, ['volume', 'exists']), { code: 0 })
    .on((args) => is(args, ['volume', 'inspect']), { stdout: JSON.stringify([volumeInspectRow(spec, 'data')]) })
    .on((args) => is(args, ['create']), () => { containerCreated = true; return { code: 0 }; })
    .on((args) => is(args, ['inspect', '--type']), { stdout: JSON.stringify([inspectRow(spec, 'created')]) });
  await new PodmanClient({ executor }).create(spec);
  assert.equal(executor.calls.find((call) => call.args[0] === 'create').args.includes('--network=none'), true);
});

test('default driver identity comes from the service account, not poisoned ambient variables', () => {
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

test('data volumes carry resource labels and limit updates use the exact engine argv', async (t) => {
  const root = makeDriverRoot(t);
  const spec = makeSiteSpec(root);
  let volumeCreated = false;
  const executor = new FakeExecutor()
    .on((args) => is(args, ['volume', 'exists']), () => ({ code: volumeCreated ? 0 : 1 }))
    .on((args) => is(args, ['volume', 'create']), () => { volumeCreated = true; return { code: 0 }; })
    .on((args) => is(args, ['volume', 'inspect']), { stdout: JSON.stringify([volumeInspectRow(spec, 'data')]) });
  const podman = new PodmanClient({ executor });
  await podman.ensureVolume(spec, 'data');

  const create = executor.calls.find((call) => call.args[0] === 'volume' && call.args[1] === 'create');
  assert.equal(create.args.at(-1), spec.volumes[0].name);
  assert.deepEqual(create.args.filter((arg) => arg.startsWith('io.elowen.')), Object.entries({
    'io.elowen.runtime': 'sandbox', 'io.elowen.namespace': spec.namespace,
    'io.elowen.resource': `site:${spec.resource.id}`,
    'io.elowen.generation': '1', 'io.elowen.component': 'data',
  }).map(([key, value]) => `${key}=${value}`));
  assert.deepEqual(create.args.slice(-9, -1), ['--driver', 'local', '--opt', 'type=none', '--opt', 'o=bind', '--opt', `device=${spec.volumes[0].path}`]);

  const next = { cpus: 2.25, memoryMb: 1536, pidsLimit: 640 };
  let inspects = 0;
  const baseRow = inspectRow(spec, 'created');
  executor
    .on((args) => is(args, ['container', 'exists']), { code: 0 })
    .on((args) => is(args, ['update']), { code: 0 })
    .on((args) => is(args, ['inspect', '--type']), () => {
      inspects += 1;
      const row = inspects === 1 ? baseRow : {
        ...baseRow,
        HostConfig: { ...baseRow.HostConfig, NanoCpus: 2.25e9, Memory: 1536 * 1024 * 1024, MemorySwap: 1536 * 1024 * 1024, PidsLimit: 640 },
      };
      return { stdout: JSON.stringify([row]) };
    });
  await podman.update(spec, next);
  const update = executor.calls.find((call) => call.args[0] === 'update');
  assert.deepEqual(update.args, [
    'update', '--memory=1536m', '--memory-swap=1536m', '--cpus=2.25', '--pids-limit=640', 'a'.repeat(64),
  ]);
  assert.equal(inspects, 2, 'the update is verified against the effective limits afterwards');
});

test('snapshots commit with --pause=false so an already quiesced container is never paused twice', async (t) => {
  const root = makeDriverRoot(t);
  const spec = makeSiteSpec(root);
  const imageId = 'c'.repeat(64);
  const executor = new FakeExecutor()
    .on((args) => is(args, ['image', 'exists']), { code: 1 })
    .on((args) => is(args, ['container', 'exists']), { code: 0 })
    .on((args) => is(args, ['volume', 'exists']), { code: 0 })
    .on((args) => is(args, ['volume', 'inspect']), { stdout: JSON.stringify([volumeInspectRow(spec, 'data')]) })
    .on((args) => is(args, ['inspect', '--type']), { stdout: JSON.stringify([inspectRow(spec, 'paused')]) })
    .on((args) => is(args, ['commit']), { code: 0 })
    .on((args) => is(args, ['image', 'inspect']), { stdout: JSON.stringify([{
      Id: imageId,
      Labels: { ...spec.labels, 'io.elowen.snapshot': snapshotId },
    }]) });

  const id = await new PodmanClient({ executor }).snapshotImage(spec, snapshotId);
  assert.equal(id, imageId);
  const commit = executor.calls.find((call) => call.args[0] === 'commit');
  assert.deepEqual(commit.args, ['commit', '--pause=false', '--change', `LABEL io.elowen.snapshot=${snapshotId}`, 'a'.repeat(64), `localhost/${spec.namespace}-site/${spec.resource.id}:g1-${snapshotId}`]);
  assert.equal(executor.calls.some((call) => call.args[0] === 'pause' || call.args[0] === 'unpause'), false);
});

test('guest command bytes travel on stdin and never appear in host argv', async (t) => {
  const root = makeDriverRoot(t);
  const spec = makeSiteSpec(root);
  const command = 'printf super-secret-command';
  const executionId = 'd'.repeat(32);
  const executor = new FakeExecutor()
    .on((args) => is(args, ['exec']) && args.includes('systemctl') && args.includes('show'),
      { stdout: 'LoadState=masked\nActiveState=inactive\nSubState=dead\nControlGroup=\n' })
    .on((args) => is(args, ['container', 'exists']), { code: 0 })
    .on((args) => is(args, ['volume', 'exists']), { code: 0 })
    .on((args) => is(args, ['volume', 'inspect']), { stdout: JSON.stringify([volumeInspectRow(spec, 'data')]) })
    .on((args) => is(args, ['inspect', '--type']), { stdout: JSON.stringify([inspectRow(spec, 'running')]) })
    .on((args) => is(args, ['exec']), { stdout: 'done' });
  const podman = new PodmanClient({ executor });

  const result = await podman.exec(spec, executionId, ['/bin/bash', '-s'], {
    input: command, timeoutMs: 5000, workdir: '/workspace',
  });
  assert.equal(result.stdout, 'done');

  const launch = executor.calls.find((call) => call.args[0] === 'exec' && call.args.includes('systemd-run'));
  assert.equal(launch.args.some((arg) => arg.includes('super-secret-command')), false);
  assert.equal(launch.options.input, command);
  assert.equal(launch.args.some((arg) => arg.startsWith('--working-directory=/workspace')), true);
  assert.equal(launch.args.includes('--interactive'), true);
  const unit = launch.args.find((arg) => arg.startsWith('--unit='));
  assert.equal(/^--unit=elowen-exec-g1-[0-9a-f]{32}\.service$/.test(unit), true);
});

test('podman output is bounded by the configured limit', async (t) => {
  const root = makeDriverRoot(t);
  makeSiteSpec(root);
  const executor = new FakeExecutor()
    .on((args) => is(args, ['image', 'exists']), { code: 0 })
    .on((args) => is(args, ['image', 'inspect']), { stdout: 'x'.repeat(300_000) });
  await assert.rejects(
    () => new PodmanClient({ executor }).imageStatus('localhost/elowen-site-base:0123456789abcdef'),
    /exceeded its bound/,
  );
});

test('container status is asked of containers only, so a snapshot image cannot answer for one', async (t) => {
  // Bare `podman inspect NAME` searches containers, images, volumes, networks and pods together. Once a
  // site owned a snapshot image, the moment rollback removed its container that name resolved to the
  // image instead and `{{.State.Status}}` died with a template error on exit 125 — no missing-object
  // wording, so it threw mid-rollback and left the environment with no container at all.
  const root = makeDriverRoot(t);
  const spec = makeSiteSpec(root);
  const running = new FakeExecutor()
    .on((args) => is(args, ['container', 'exists']), { code: 0 })
    .on((args) => is(args, ['volume', 'exists']), { code: 0 })
    .on((args) => is(args, ['volume', 'inspect']), { stdout: JSON.stringify([volumeInspectRow(spec, 'data')]) })
    .on((args) => is(args, ['inspect', '--type']), { stdout: JSON.stringify([inspectRow(spec, 'running')]) });
  const row = await new PodmanClient({ executor: running }).inspect(spec);
  assert.equal(row.state, 'running');
  const inspect = running.calls.find((call) => call.args[0] === 'inspect');
  assert.deepEqual(inspect.args.slice(0, 3), ['inspect', '--type', 'container'], 'the probe is container-scoped');

  const gone = new FakeExecutor().on((args) => is(args, ['container', 'exists']), { code: 1 });
  assert.equal(await new PodmanClient({ executor: gone }).inspect(spec), null,
    'a container-scoped miss is the answer "there is none"');

  // And the failure this replaced still has to be loud: widening the missing-object wording to swallow a
  // template error would turn every unreadable container into a silent "create a new one".
  const templated = new FakeExecutor()
    .on((args) => is(args, ['container', 'exists']), { code: 0 })
    .on((args) => is(args, ['inspect', '--type']), { code: 125, stderr: 'Error: template: inspect:1:19: executing "inspect" at <.State.Status>: can\'t evaluate field State in type interface {}' });
  await assert.rejects(
    () => new PodmanClient({ executor: templated }).inspect(spec),
    /can't evaluate field State/,
  );
});

test('inspection refuses a malformed engine answer loudly', async (t) => {
  const root = makeDriverRoot(t);
  const spec = makeSiteSpec(root);
  const notJson = new FakeExecutor()
    .on((args) => is(args, ['container', 'exists']), { code: 0 })
    .on((args) => is(args, ['inspect', '--type']), { stdout: 'not json' });
  await assert.rejects(() => new PodmanClient({ executor: notJson }).inspect(spec));
  assert.equal(notJson.calls.at(-1).args.at(-1), spec.name, 'the immutable spec name is the probe target');
});

test('volume removal ignores only an absent volume and surfaces structural failures', async (t) => {
  const root = makeDriverRoot(t);
  const spec = makeSiteSpec(root);
  const missing = new FakeExecutor().on((args) => is(args, ['volume', 'exists']), { code: 1 });
  await new PodmanClient({ executor: missing }).removeVolume(spec, 'data');
  assert.equal(missing.calls.length, 1, 'an absent volume is removed by doing nothing');

  const denied = new FakeExecutor()
    .on((args) => is(args, ['volume', 'exists']), { code: 0 })
    .on((args) => is(args, ['volume', 'inspect']), { stdout: JSON.stringify([volumeInspectRow(spec, 'data')]) })
    .on((args) => is(args, ['volume', 'rm']), { code: 125, stderr: 'Error: permission denied' });
  await assert.rejects(() => new PodmanClient({ executor: denied }).removeVolume(spec, 'data'), /permission denied/);
});

test('executor timeout kills the detached process group', async (t) => {
  const root = makeDriverRoot(t);
  const marker = join(root, 'survived');
  const grandchild = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'alive'), 250); setInterval(() => {}, 1000);`;
  const parent = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: 'ignore' }); setInterval(() => {}, 1000);`;
  const executor = new SpawnExecutor();
  await assert.rejects(
    () => executor.run(process.execPath, ['-e', parent], { env: { ...process.env }, timeoutMs: 75, outputLimitBytes: 1 << 20 }),
    /timed out/,
  );
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(existsSync(marker), false, 'the grandchild of a timed-out command does not survive');
});