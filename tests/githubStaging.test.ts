// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, chmod, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stageBundle, pushStaged, publishManaged } from '../plugins/github/src/staging.js';
import type { SpawnPrepared } from '../plugins/github/src/types.js';
import type { PluginContext, SandboxPreparedExecution } from 'elowen/plugin-api';

const exec = promisify(execFile);
async function fixture(branch = 'elowen/u1/test') {
  const root = await mkdtemp(join(tmpdir(), 'elowen-stage-test-'));
  const git = (...args: string[]) => exec('/usr/bin/git', ['-C', root, ...args], { env: { PATH: '/usr/bin:/bin', HOME: root, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } });
  await git('init', '-b', branch);
  await writeFile(join(root, 'content'), 'approved content');
  await git('add', 'content');
  await git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'approved');
  const head = (await git('rev-parse', 'HEAD')).stdout.trim();
  await git('config', 'credential.helper', `!touch ${root}/stolen`);
  await git('config', 'core.hooksPath', root);
  await writeFile(join(root, 'pre-push'), `#!/bin/sh\ntouch '${root}/stolen'\n`, { mode: 0o700 });
  await git('bundle', 'create', join(root, 'input.bundle'), `refs/heads/${branch}`);
  return { root, head, bundle: await readFile(join(root, 'input.bundle')) };
}

/** A managed project runtime that records what publishing prepared, ran and removed again. `git bundle
 *  create` puts `bundle` where the guest read finds it and `rm` takes it away, so a test can ask whether
 *  the bundle a failed publish created was cleaned up, and how many times that was attempted. */
function managedRuntime(options: { preparedProjectId?: number; head?: string; bundle?: Buffer; read?: () => unknown; removalFails?: boolean } = {}) {
  const prepared: string[][] = [];
  const commands: string[][] = [];
  let released = 0;
  let onGuest: Buffer | undefined;
  const provider = {
    prepareExecution: async (input: { command: { file: string; args: string[] }; cwd: string }) => {
      prepared.push([input.command.file, ...input.command.args]);
      return {
        mode: 'managed', projectRef: { kind: 'managed', projectId: options.preparedProjectId ?? 7 }, cwd: input.cwd,
        launch: { type: 'argv', file: input.command.file, args: input.command.args, env: {} },
        lease: { release() { released += 1; }, heartbeat() {} },
      };
    },
    projectFiles: async ({ operation }: { operation: { offset: number; length: number } }) => {
      if (options.read) return options.read();
      const bytes = onGuest ?? Buffer.alloc(0);
      return { kind: 'read', totalBytes: bytes.length, version: 'stable', base64: bytes.subarray(operation.offset, operation.offset + operation.length).toString('base64') };
    },
    environmentFor: async () => {},
  };
  const runner = (async (value: SandboxPreparedExecution) => {
    if (value.launch.type !== 'argv') throw new Error('unexpected launch');
    const argv = [value.launch.file, ...value.launch.args];
    commands.push(argv);
    await value.lease.release();
    if (argv[0] === 'rm') {
      if (options.removalFails) throw new Error('the guest refused to remove the bundle');
      onGuest = undefined;
    } else if (argv.includes('rev-parse')) {
      return { stdout: `${options.head ?? 'a'.repeat(40)}\n`, stderr: '' };
    } else if (argv.includes('bundle')) {
      onGuest = options.bundle ?? Buffer.alloc(0);
    }
    return { stdout: '', stderr: '' };
  }) as unknown as SpawnPrepared;
  return {
    provider, runner, prepared, commands,
    get released() { return released; },
    removals: () => commands.filter(argv => argv[0] === 'rm').length,
  };
}

/** Publish against that runtime and hand back whatever it refused with. */
async function publishing(runtime: ReturnType<typeof managedRuntime>, overrides: { expectedHead?: string }, publish: (input: { directory: string }) => unknown): Promise<unknown> {
  const ctx = { currentAccess: () => ({}), currentAccountUserId: () => 11, control: () => runtime.provider } as unknown as PluginContext;
  return publishManaged({
    ctx, projectRef: { kind: 'managed', projectId: 7 }, cwd: '/workspace', branch: 'elowen/u1/test',
    expectedHead: overrides.expectedHead ?? 'b'.repeat(40), token: 'fake-personal-token',
    repository: { owner: 'approved', name: 'destination' }, runner: runtime.runner,
  }, publish as never).then(
    () => { throw new Error('publishing accepted what this test expected it to refuse'); },
    (error: unknown) => error,
  );
}

describe('trusted personal Git publishing stage', () => {
  it('imports approved objects without guest configuration and uses exact remote and commit', async () => {
    const f = await fixture();
    let stage;
    try {
      stage = await stageBundle(f.bundle, f.head, 'elowen/u1/test');
      expect(await readFile(join(stage.directory, 'config'), 'utf8')).not.toMatch(/helper|hooksPath/);
      const sent: { args: string[]; cwd: string; auth: string | undefined }[] = [];
      const result = await pushStaged({ directory: stage.directory, expectedHead: f.head, branch: 'elowen/u1/test', token: 'fake-local-token', repository: { owner: 'approved', name: 'destination' } }, async (args, options) => {
        sent.push({ args, cwd: options.cwd, auth: options.env.GIT_CONFIG_VALUE_0 });
        expect(options.env.GH_TOKEN).toBeUndefined();
        expect(options.env.GIT_CONFIG_GLOBAL).toBe('/dev/null');
        return { stdout: 'ok' };
      });
      expect(result.head).toBe(f.head);
      expect(sent[0]?.args.slice(-2)).toEqual(['https://github.com/approved/destination.git', `${f.head}:refs/heads/elowen/u1/test`]);
      expect(sent[0]?.cwd).not.toBe(f.root);
      expect(sent[0]?.auth).toContain('Basic ');
      await expect(access(join(f.root, 'stolen'))).rejects.toThrow();
    } finally { await stage?.dispose(); await rm(f.root, { recursive: true, force: true }); }
  });
  it('validates the managed project root branch without requiring a legacy workspace prefix', async () => {
    const f = await fixture('main');
    let stage;
    try {
      stage = await stageBundle(f.bundle, f.head, 'main');
      await pushStaged({ directory: stage.directory, expectedHead: f.head, branch: 'main', token: 'fake-token', repository: { owner: 'approved', name: 'destination' } }, async args => {
        expect(args.at(-1)).toBe(`${f.head}:refs/heads/main`);
        return { stdout: 'accepted' };
      });
    } finally { await stage?.dispose(); await rm(f.root, { recursive: true, force: true }); }
  });
  it.each([true, false])('exports through the explicit provider target with ambient turn=%s', async ambient => {
    const f = await fixture();
    let privateStage = '';
    let authorized = false;
    const exportPath = join(f.root, 'export.bundle');
    const provider = {
      prepareExecution: async (input: { command: { file: string; args: string[] }; projectRef: unknown }) => {
        expect(input.projectRef).toEqual({ kind: 'managed', projectId: 7 });
        const args = input.command.args.map(arg => arg === '/workspace' ? f.root : arg.startsWith('/tmp/elowen-publish-') ? exportPath : arg);
        return { mode: 'managed', projectRef: input.projectRef, cwd: f.root, launch: { type: 'argv', file: input.command.file, args, env: { PATH: '/usr/bin:/bin', HOME: f.root } }, lease: { release() {} } };
      },
      projectFiles: async ({ accountUserId, operation }: { accountUserId: number; operation: { offset: number; length: number } }) => {
        expect(accountUserId).toBe(11);
        const bytes = await readFile(exportPath);
        return { kind: 'read', totalBytes: bytes.length, version: 'stable-export', base64: bytes.subarray(operation.offset, operation.offset + operation.length).toString('base64') };
      },
      environmentFor: async () => { authorized = true; },
    };
    const ctx = { currentAccess: () => ambient ? { projectRef: { kind: 'managed', projectId: 7 } } : {}, currentAccountUserId: () => 11, control: () => provider } as unknown as PluginContext;
    try {
      const result = await publishManaged({ ctx, projectRef: { kind: 'managed', projectId: 7 }, cwd: '/workspace', branch: 'elowen/u1/test', expectedHead: f.head, token: 'fake-personal-token', repository: { owner: 'approved', name: 'destination' }, runner: async (prepared: SandboxPreparedExecution) => {
        expect(JSON.stringify(prepared)).not.toContain('fake-personal-token');
        if (prepared.launch.type !== 'argv') throw new Error('unexpected launch');
        return exec(`/usr/bin/${prepared.launch.file}`, prepared.launch.args, { cwd: prepared.cwd, env: prepared.launch.env });
      } }, async input => {
        expect(authorized).toBe(true);
        await expect(access(exportPath)).rejects.toThrow();
        privateStage = input.directory;
        return pushStaged(input, async args => {
          expect(args.slice(-2)).toEqual(['https://github.com/approved/destination.git', `${f.head}:refs/heads/elowen/u1/test`]);
          return { stdout: 'accepted' };
        });
      });
      expect(result.head).toBe(f.head);
      await expect(access(privateStage)).rejects.toThrow();
      await expect(access(join(f.root, 'stolen'))).rejects.toThrow();
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });
  it('refuses a mismatched managed runtime as itself, prepares once and gives the lease back', async () => {
    // Cleanup used to run unconditionally, so a refused preparation was refused a second time and that
    // second untyped failure replaced the first. Nothing was created here, so nothing is removed, and the
    // typed refusal the service endpoints answer with reaches the caller intact.
    const runtime = managedRuntime({ preparedProjectId: 9 });
    const failure = await publishing(runtime, {}, () => { throw new Error('a refused preparation must never reach a push'); });
    expect(failure).toMatchObject({ code: 'project_forbidden', status: 403 });
    expect(runtime.prepared.length, 'a refused preparation was retried by the cleanup').toBe(1);
    expect(runtime.released, 'the lease taken by the refused preparation stayed held').toBe(1);
    expect(runtime.commands, 'a refused preparation reached a command').toEqual([]);
  });
  it('lets an unavailable project runtime surface as itself', async () => {
    const ctx = { currentAccess: () => ({}), currentAccountUserId: () => 11, control: () => null } as unknown as PluginContext;
    const failure = await publishManaged({
      ctx, projectRef: { kind: 'managed', projectId: 7 }, cwd: '/workspace', branch: 'elowen/u1/test',
      expectedHead: 'a'.repeat(40), token: 'fake-personal-token', repository: { owner: 'approved', name: 'destination' },
      runner: (async () => { throw new Error('an unavailable runtime must never reach a command'); }) as unknown as SpawnPrepared,
    }, async () => { throw new Error('an unavailable runtime must never reach a push'); })
      .then(() => { throw new Error('an unavailable runtime was accepted' as never); }, (error: unknown) => error);
    expect(failure).toMatchObject({ code: 'sandbox_unavailable', status: 503 });
  });
  it('keeps the failure that stopped the publish and still removes the bundle it created', async () => {
    const runtime = managedRuntime({ head: 'b'.repeat(40), read: () => ({ kind: 'write' }) });
    const failure = await publishing(runtime, {}, () => { throw new Error('an unreadable bundle must never reach a push'); });
    expect(failure).toMatchObject({ code: 'invalid_publish_bundle', status: 409 });
    expect(runtime.removals(), 'the bundle the publish created was left on the guest').toBe(1);
  });
  it('does not let a failed cleanup replace the failure that caused it', async () => {
    const runtime = managedRuntime({ head: 'b'.repeat(40), read: () => ({ kind: 'write' }), removalFails: true });
    const failure = await publishing(runtime, {}, () => { throw new Error('an unreadable bundle must never reach a push'); });
    expect(failure, 'the cleanup failure masked the reason the publish failed').toMatchObject({ code: 'invalid_publish_bundle', status: 409 });
    expect(runtime.removals(), 'the failed removal was retried').toBe(1);
  });
  it('reports a cleanup that fails on its own without pretending the push failed', async () => {
    const f = await fixture();
    const runtime = managedRuntime({ head: f.head, bundle: f.bundle });
    let locked = '';
    let pushed = false;
    try {
      const failure = await publishing(runtime, { expectedHead: f.head }, async ({ directory }: { directory: string }) => {
        // A stage whose removal is denied. The push has already happened by the time that is discovered.
        locked = join(directory, 'locked');
        await mkdir(locked); await writeFile(join(locked, 'held'), 'x'); await chmod(locked, 0o500);
        pushed = true;
        return { head: f.head, remoteUrl: 'https://github.com/approved/destination.git' };
      });
      expect(pushed, 'the push never ran, so this is not a cleanup-only failure').toBe(true);
      expect(failure).toMatchObject({ code: 'publish_cleanup_failed', status: 500 });
      expect((failure as Error).message, 'the report must not read as a failed push').toContain('was published');
      expect(runtime.removals(), 'the guest bundle is removed before the push, not by the cleanup').toBe(1);
    } finally {
      if (locked) { await chmod(locked, 0o700); await rm(join(locked, '..'), { recursive: true, force: true }); }
      await rm(f.root, { recursive: true, force: true });
    }
  });
  it('rejects a changed approved commit and malformed bundle before any authenticated push', async () => {
    const f = await fixture();
    try {
      await expect(stageBundle(f.bundle, 'f'.repeat(40), 'elowen/u1/test')).rejects.toThrow();
      await expect(stageBundle(Buffer.from('hostile bundle'), f.head, 'elowen/u1/test')).rejects.toThrow();
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });
});
