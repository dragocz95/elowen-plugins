// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stageBundle, pushStaged, publishManaged } from '../plugins/github/src/staging.js';
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
  it('rejects a changed approved commit and malformed bundle before any authenticated push', async () => {
    const f = await fixture();
    try {
      await expect(stageBundle(f.bundle, 'f'.repeat(40), 'elowen/u1/test')).rejects.toThrow();
      await expect(stageBundle(Buffer.from('hostile bundle'), f.head, 'elowen/u1/test')).rejects.toThrow();
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });
});
