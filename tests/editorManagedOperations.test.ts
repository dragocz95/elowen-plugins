// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat, access, rename, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { PluginContext, PluginApiRequest, PluginApiRoute, SandboxPreparedExecution } from 'elowen/plugin-api';
import type { GuestFileOperation } from 'elowen/dist/plugins/environmentTypes.js';
import { registerEditorApi } from '../plugins/editor/src/api.js';

const exec = promisify(execFile);
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'elowen-editor-guest-'));
  await mkdir(join(root, 'tmp'));
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'src/a.ts'), 'initial content');
  const operations: GuestFileOperation[] = [];
  const guest = (path: string) => path.startsWith('/workspace') ? root + path.slice('/workspace'.length) : path.startsWith('/tmp/') ? join(root, 'tmp', path.slice(5)) : path;
  const routes: PluginApiRoute[] = [];
  const provider = {
    async prepareExecution(input: { command: { type: string; file: string; args: string[] }; projectRef: unknown }): Promise<SandboxPreparedExecution> {
      expect(input.projectRef).toEqual({ kind: 'managed', projectId: 7 });
      const args = input.command.args.map(guest);
      let file = `/usr/bin/${input.command.file}`;
      if (input.command.file === 'soffice') {
        file = '/usr/bin/python3';
        args.unshift('-c', 'import pathlib,sys; a=sys.argv; out=pathlib.Path(a[a.index("--outdir")+1]); (out/(pathlib.Path(a[-1]).stem+".pdf")).write_bytes(b"%PDF-1.4 fixture")');
      }
      return { mode: 'managed', projectRef: { kind: 'managed', projectId: 7 }, cwd: root, home: '/root', displayCwd: '/workspace', roots: ['/'], workspace: null, launch: { type: 'argv', file, args, env: { PATH: '/usr/bin:/bin', HOME: root } }, lease: { id: 'test', accountUserId: 11, workspaceId: null, homeGeneration: null, heartbeat() {}, release() {} }, cancel: async () => {}, sanitizeOutput: text => text.replaceAll(root, '/workspace') };
    },
    async projectFiles({ operation }: { operation: GuestFileOperation }) {
      operations.push(operation);
      const path = guest(operation.path);
      if (operation.kind === 'mkdir') await mkdir(path);
      if (operation.kind === 'write' && operation.expectedVersion === null) await writeFile(path, Buffer.from(operation.base64, 'base64'), { flag: 'wx' });
      const s = await stat(path);
      let bytes = s.isFile() ? await readFile(path) : Buffer.alloc(0);
      let version = createHash('sha256').update(bytes).digest('hex');
      if (operation.kind === 'write' && operation.expectedVersion !== null) {
        if (operation.expectedVersion !== version) throw new Error('version conflict');
        bytes = Buffer.from(operation.base64, 'base64');
        await writeFile(path, bytes);
        version = createHash('sha256').update(bytes).digest('hex');
      }
      const entry = { path: operation.path, kind: s.isFile() ? 'file' : 'directory', size: s.size, modifiedAt: s.mtime.toISOString(), version };
      if (operation.kind === 'stat' || operation.kind === 'mkdir' || operation.kind === 'write') return { kind: operation.kind, entry };
      if (operation.kind === 'rename') {
        if (operation.expectedVersion !== version) throw new Error('version conflict');
        const destination = guest(operation.destination);
        try { await access(destination); throw new Error('target exists'); }
        catch (error) { if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') throw error; }
        await rename(path, destination);
        return { kind: 'rename', entry: { ...entry, path: operation.destination } };
      }
      if (operation.kind === 'remove') { await unlink(path); return { kind: 'remove', removed: true }; }
      if (operation.kind !== 'read') throw new Error('unexpected fixture operation');
      if (operation.maxBytes > 512 * 1024) throw new Error('guest transport read limit');
      const start = operation.offset ?? 0;
      return { kind: 'read', base64: bytes.subarray(start, start + Math.min(operation.length ?? operation.maxBytes, operation.maxBytes)).toString('base64'), totalBytes: bytes.length, version };
    },
  };
  const ctx = { control: () => provider, registerApiRoute: (route: PluginApiRoute) => routes.push(route), host: { projectFiles: () => ({ safe: () => { throw new Error('host route called'); } }), stores: () => ({ projects: { get: () => ({ id: 7, executionKind: 'managed', path: '/host-must-not-be-used' }) } }) } } as unknown as PluginContext;
  registerEditorApi(ctx);
  const call = async (name: string, method = 'GET', path?: string, body?: unknown, hash?: string) => {
    const route = routes.find(route => route.rootMount === `/projects/:id/${name}` && route.method === method)!;
    return route.handler({ path: '', params: { id: '7', hash }, query: path ? { path } : {}, headers: {}, auth: { userId: 11, accessibleProjects: [7], admin: false }, json: async () => body } as unknown as PluginApiRequest);
  };
  return { root, call, operations, dispose: () => rm(root, { recursive: true, force: true }) };
}

describe('managed editor compound operations with an executable provider fixture', () => {
  it('creates nested files and directories through the guest boundary', async () => {
    const f = await fixture();
    try {
      expect((await f.call('new-file', 'POST', undefined, { path: 'nested/deep/new.ts' })).body).toEqual({ ok: true });
      expect(await readFile(join(f.root, 'nested/deep/new.ts'), 'utf8')).toBe('');
      expect((await f.call('dir', 'POST', undefined, { path: 'other/nested/directory' })).body).toEqual({ ok: true });
      expect((await stat(join(f.root, 'other/nested/directory'))).isDirectory()).toBe(true);
    } finally { await f.dispose(); }
  });
  it('copies, renames and removes inside the guest and refuses destination replacement', async () => {
    const f = await fixture();
    try {
      expect((await f.call('copy', 'POST', undefined, { from: 'src', to: 'copied' })).body).toEqual({ ok: true });
      expect(await readFile(join(f.root, 'copied/a.ts'), 'utf8')).toBe('initial content');
      expect((await f.call('rename', 'POST', undefined, { from: 'copied', to: 'renamed' })).body).toEqual({ ok: true });
      expect((await f.call('rename', 'POST', undefined, { from: 'renamed', to: 'src' })).status).toBe(503);
      expect(await readFile(join(f.root, 'src/a.ts'), 'utf8')).toBe('initial content');
      expect((await f.call('entry', 'DELETE', 'renamed')).body).toEqual({ ok: true });
      await expect(access(join(f.root, 'renamed'))).rejects.toThrow();
      expect((await f.call('entry', 'DELETE', '/workspace')).status).toBe(400);
    } finally { await f.dispose(); }
  });
  it('reads editable text through bounded chunks and reports oversized text as truncated', async () => {
    const f = await fixture();
    try {
      const content = 'x'.repeat(1024 * 1024);
      await writeFile(join(f.root, 'large.ts'), content);
      const result = await f.call('file', 'GET', 'large.ts');
      expect(result.body).toMatchObject({ content, truncated: false });
      await writeFile(join(f.root, 'oversized.ts'), 'x'.repeat(3 * 1024 * 1024));
      expect((await f.call('file', 'GET', 'oversized.ts')).body).toMatchObject({ content: '', truncated: true });
    } finally { await f.dispose(); }
  });
  it('exports downloads in bounded version-consistent chunks', async () => {
    const f = await fixture();
    try {
      const bytes = Buffer.alloc(1024 * 1024, 97);
      await writeFile(join(f.root, 'large.bin'), bytes);
      const result = await f.call('raw', 'GET', 'large.bin');
      expect(Buffer.from(result.body as Uint8Array).equals(bytes)).toBe(true);
      const reads = f.operations.filter(op => op.kind === 'read');
      expect(reads).toHaveLength(4);
      expect(reads.every(op => op.kind === 'read' && op.maxBytes === 256 * 1024)).toBe(true);
    } finally { await f.dispose(); }
  });
  it('runs the converter in the guest and removes its private conversion directory', async () => {
    const f = await fixture();
    try {
      await writeFile(join(f.root, 'brief.docx'), 'fixture');
      const result = await f.call('office-preview', 'GET', 'brief.docx');
      expect(Buffer.from(result.body as Uint8Array).toString()).toBe('%PDF-1.4 fixture');
      const output = f.operations.find(op => op.kind === 'read' && op.path.endsWith('.pdf'))!;
      await expect(access(join(f.root, 'tmp', output.path.slice(5).split('/')[0]!))).rejects.toThrow();
    } finally { await f.dispose(); }
  });
  it('inspects actual guest Git history and working changes', async () => {
    const f = await fixture();
    try {
      const git = (...args: string[]) => exec('/usr/bin/git', ['-C', f.root, ...args], { env: { PATH: '/usr/bin:/bin', HOME: f.root, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } });
      await git('init', '-b', 'main'); await git('add', 'src/a.ts');
      await git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture commit');
      const hash = (await git('rev-parse', 'HEAD')).stdout.trim();
      expect((await f.call('head', 'GET', 'src/a.ts')).body).toEqual({ content: 'initial content' });
      await writeFile(join(f.root, 'src/a.ts'), 'changed content');
      expect((await f.call('changed')).body).toEqual({ changed: ['src/a.ts'] });
      expect(JSON.stringify((await f.call('diff', 'GET', 'src/a.ts')).body)).toContain('changed content');
      expect(JSON.stringify((await f.call('commits')).body)).toContain('fixture commit');
      expect(JSON.stringify((await f.call('commit/:hash', 'GET', undefined, undefined, hash)).body)).toContain('src/a.ts');
    } finally { await f.dispose(); }
  });
});
