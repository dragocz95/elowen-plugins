// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, lstatSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PluginContext, PluginApiRequest, PluginApiRoute } from 'elowen/dist/plugins/api.js';
import type { GuestFileOperation, GuestFileResult } from 'elowen/dist/plugins/environmentTypes.js';
import { registerEditorApi } from '../plugins/editor/src/api.js';

/** The project tree view used to be driven from the host: one `list` per directory, each one a container
 *  execution, so a root of four directories paid five crossings and answered in three to ten seconds while
 *  a single directory answered in about 750 ms. It now consumes ONE guest `walk`.
 *
 *  The provider below is a faithful stand-in for that operation over a REAL directory tree, written from
 *  the guest's own rules rather than from the editor's expectations: depth first with each directory's
 *  children sorted by name, `skip` applied to CHILDREN only, symlinks counted but never emitted or
 *  followed, `limit` counting every entry looked at, `maxDepth` counting descent below the root, and
 *  `rootKind` describing the path that was asked for. What each test asserts is the editor's half. */

let root = '';
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'editor-walk-'));
  mkdirSync(join(root, 'src/deep/deeper'), { recursive: true });
  mkdirSync(join(root, 'empty'));
  mkdirSync(join(root, 'node_modules/pkg'), { recursive: true });
  mkdirSync(join(root, '.git/objects'), { recursive: true });
  writeFileSync(join(root, 'a.ts'), 'aa');
  writeFileSync(join(root, 'src/b.ts'), 'bbbb');
  writeFileSync(join(root, 'src/deep/c.ts'), 'cc');
  writeFileSync(join(root, 'src/deep/deeper/d.ts'), 'd');
  writeFileSync(join(root, 'node_modules/pkg/index.js'), 'x');
  writeFileSync(join(root, '.git/objects/pack'), 'x');
  writeFileSync(join(root, 'stray.elowen-upload'), 'partial');
  symlinkSync(join(root, 'a.ts'), join(root, 'link-to-file'));
  symlinkSync(join(root, 'src'), join(root, 'link-to-dir'));
});
afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

const hostPath = (guestPath: string): string => root + guestPath.slice('/workspace'.length);
const guestOf = (host: string): string => `/workspace${host.slice(root.length)}`;

/** The guest `walk`, as the contract states it. */
function walk(operation: Extract<GuestFileOperation, { kind: 'walk' }>): GuestFileResult {
  const target = hostPath(operation.path);
  let info;
  try { info = lstatSync(target); } catch { return { kind: 'walk', root: operation.path, rootKind: null, entries: [], truncated: false }; }
  const rootKind = info.isDirectory() ? 'directory' as const : info.isSymbolicLink() ? 'symlink' as const : info.isFile() ? 'file' as const : 'other' as const;
  const base = rootKind === 'directory' ? target : join(target, '..');
  const skip = new Set(operation.skip ?? []);
  const maxDepth = operation.maxDepth ?? 64;
  const entries: { path: string; kind: 'file' | 'directory'; size: number; mtime: number }[] = [];
  let visited = 0;
  let truncated = false;
  const visit = (dir: string, depth: number): void => {
    if (truncated) return;
    for (const name of readdirSync(dir).sort()) {
      if (++visited > operation.limit) { truncated = true; return; }
      const child = join(dir, name);
      const stat = lstatSync(child);
      // Counted above, then dropped: a link is never emitted and never descended into.
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        // Omitted ENTIRELY, not merely left unopened: reporting it would claim it is empty.
        if (skip.has(name)) continue;
        entries.push({ path: guestOf(child), kind: 'directory', size: stat.size, mtime: stat.mtimeMs });
        if (depth < maxDepth) visit(child, depth + 1);
      } else if (stat.isFile()) {
        entries.push({ path: guestOf(child), kind: 'file', size: stat.size, mtime: stat.mtimeMs });
      }
    }
  };
  visit(base, 0);
  return { kind: 'walk', root: guestOf(base), rootKind, entries, truncated };
}

function fixture(override?: (operation: GuestFileOperation) => GuestFileResult) {
  const routes: PluginApiRoute[] = [];
  const operations: GuestFileOperation[] = [];
  const safe = vi.fn(() => { throw new Error('host filesystem must not be used'); });
  const projectFiles = vi.fn(async ({ operation }: { operation: GuestFileOperation }) => {
    operations.push(operation);
    if (override) return override(operation);
    if (operation.kind !== 'walk') throw new Error(`unexpected operation ${operation.kind}`);
    return walk(operation);
  });
  const ctx = {
    host: { projectFiles: () => ({ safe }), stores: () => ({ projects: { get: () => ({ id: 7, path: '/host-secret', executionKind: 'managed' }) } }) },
    control: vi.fn(() => ({ projectFiles })), registerApiRoute: (route: PluginApiRoute) => routes.push(route),
  } as unknown as PluginContext;
  registerEditorApi(ctx);
  const list = (query: Record<string, string> = {}) => {
    const route = routes.find(r => r.rootMount === '/projects/:id/files' && r.method === 'GET')!;
    return route.handler({ path: '', params: { id: '7' }, query, headers: {}, auth: { admin: false, accessibleProjects: [7], userId: 11 }, json: async () => undefined } as unknown as PluginApiRequest);
  };
  return { list, operations, projectFiles, safe };
}

type Node = { path: string; type: 'file' | 'dir'; size?: number };
const paths = (body: unknown): string[] => (body as Node[]).map(node => node.path);

describe('managed project tree over one guest walk', () => {
  it('answers the project root in EXACTLY ONE guest call, eight levels deep', async () => {
    const f = fixture();
    const response = await f.list();

    expect(f.projectFiles).toHaveBeenCalledTimes(1);
    expect(f.operations).toEqual([{
      kind: 'walk', path: '/workspace', limit: 10000, maxDepth: 8,
      skip: ['.git', 'node_modules', '.next', 'dist', '.turbo', 'coverage', '.cache'],
    }]);
    expect(f.safe).not.toHaveBeenCalled();
    expect(paths(response.body)).toEqual([
      'a.ts', 'empty', 'src', 'src/b.ts', 'src/deep', 'src/deep/c.ts', 'src/deep/deeper', 'src/deep/deeper/d.ts',
    ]);
  });

  it('answers ONE expanded directory in exactly one call, and does not go below it', async () => {
    const f = fixture();
    const response = await f.list({ path: 'src' });

    expect(f.projectFiles).toHaveBeenCalledTimes(1);
    expect(f.operations[0]).toMatchObject({ kind: 'walk', path: '/workspace/src', limit: 10000, maxDepth: 0 });
    expect(paths(response.body)).toEqual(['src/b.ts', 'src/deep']);
  });

  it('shows an empty directory as a directory of its own', async () => {
    const f = fixture();
    const nodes = (await f.list()).body as Node[];
    expect(nodes.find(node => node.path === 'empty')).toEqual({ path: 'empty', type: 'dir' });
  });

  it('carries a size on a file and none on a directory, with paths relative to the workspace', async () => {
    const f = fixture();
    const nodes = (await f.list()).body as Node[];
    expect(nodes.find(node => node.path === 'a.ts')).toEqual({ path: 'a.ts', type: 'file', size: 2 });
    expect(nodes.find(node => node.path === 'src/b.ts')).toEqual({ path: 'src/b.ts', type: 'file', size: 4 });
    expect(nodes.every(node => !node.path.startsWith('/'))).toBe(true);
  });

  it('omits the ignored directories entirely, and the upload leftover with them', async () => {
    const f = fixture();
    const listed = paths((await f.list()).body);
    expect(listed.some(path => path.startsWith('node_modules'))).toBe(false);
    expect(listed.some(path => path.startsWith('.git'))).toBe(false);
    expect(listed).not.toContain('stray.elowen-upload');
  });

  /** `skip` names CHILDREN, so asking for an ignored directory by name still expands it — which is what
   *  the per-directory listing did before, and what the tree view's "open anyway" depends on. */
  it('still expands an ignored directory when it is the one asked for', async () => {
    const f = fixture();
    const response = await f.list({ path: 'node_modules' });
    // One level, like any other expansion: the children of the directory that was asked for.
    expect(paths(response.body)).toEqual(['node_modules/pkg']);
  });

  /** Pins TODAY's behaviour rather than asserting it is right: the guest walk never emits a symlink, so a
   *  link that the per-directory listing used to resolve and show as its target no longer appears in the
   *  tree. Reported to the parent as the one behaviour this change alters; a narrow contract addition on
   *  the core side would be needed to restore it. */
  it('does not show symlinks, to a file or to a directory', async () => {
    const f = fixture();
    const listed = paths((await f.list()).body);
    expect(listed).not.toContain('link-to-file');
    expect(listed).not.toContain('link-to-dir');
    expect(listed.some(path => path.startsWith('link-to-dir/'))).toBe(false);
  });

  it('refuses a truncated answer instead of rendering a partial tree as a complete one', async () => {
    const f = fixture(operation => ({ ...walk(operation as Extract<GuestFileOperation, { kind: 'walk' }>), truncated: true }));
    const response = await f.list();
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'directory listing is too large; select a subdirectory' });
  });

  it('reports a missing path as missing rather than as an empty folder', async () => {
    const f = fixture();
    const response = await f.list({ path: 'gone' });
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'path does not exist' });
  });

  /** The walk answers a file root from its PARENT. Rendering that as the requested folder would show a
   *  sibling listing under the file's name, so the editor refuses it outright. */
  it('refuses a file root instead of answering from its parent directory', async () => {
    const f = fixture();
    const response = await f.list({ path: 'a.ts' });
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'not a directory' });
  });

  it('refuses an entry the guest reports outside the directory that was asked for', async () => {
    const f = fixture(() => ({
      kind: 'walk', root: '/workspace/src', rootKind: 'directory',
      entries: [{ path: '/workspace/elsewhere.ts', kind: 'file', size: 1, mtime: 0 }], truncated: false,
    }));
    const response = await f.list({ path: 'src' });
    expect(response.status).toBe(503);
  });

  it('refuses an entry that leaves the workspace at all', async () => {
    const f = fixture(() => ({
      kind: 'walk', root: '/workspace', rootKind: 'directory',
      entries: [{ path: '/workspace/../escape.ts', kind: 'file', size: 1, mtime: 0 }], truncated: false,
    }));
    expect((await f.list()).status).toBe(400);
  });

  it('rejects a traversing request before asking the guest', async () => {
    const f = fixture();
    const response = await f.list({ path: '../other-project' });
    expect(response.status).toBe(400);
    expect(f.projectFiles).not.toHaveBeenCalled();
  });
});
