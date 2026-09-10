// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, lstatSync, statSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PluginContext, PluginApiRequest, PluginApiRoute } from 'elowen/dist/plugins/api.js';
import type { GuestFileOperation, GuestFileResult, GuestFileStat } from 'elowen/dist/plugins/environmentTypes.js';
import { registerEditorApi } from '../plugins/editor/src/api.js';

/** The project tree view used to be driven from the host: one `list` per directory, each one a container
 *  execution, so a root of four directories paid five crossings and answered in three to ten seconds while
 *  a single directory answered in about 750 ms. It now consumes ONE guest `walk`, and reaches for the
 *  per-directory listing only to see what lies BEHIND a symlink, which the walk reports but never follows.
 *
 *  The provider below is a faithful stand-in for those operations over a REAL directory tree, written from
 *  the guest's own rules rather than from the editor's expectations: depth first with each directory's
 *  children sorted by name, `skip` applied to CHILDREN only, a symlink reported with its OWN size and time
 *  and never descended into, `limit` counting every entry looked at, `maxDepth` counting descent below the
 *  root, and `rootKind` describing the path that was asked for. */

let plain = '';
let linked = '';
let cyclic = '';
let deep = '';
beforeAll(() => {
  plain = mkdtempSync(join(tmpdir(), 'editor-walk-plain-'));
  mkdirSync(join(plain, 'src/deep/deeper'), { recursive: true });
  mkdirSync(join(plain, 'empty'));
  mkdirSync(join(plain, 'node_modules/pkg'), { recursive: true });
  mkdirSync(join(plain, '.git/objects'), { recursive: true });
  writeFileSync(join(plain, 'a.ts'), 'aa');
  writeFileSync(join(plain, 'src/b.ts'), 'bbbb');
  writeFileSync(join(plain, 'src/deep/c.ts'), 'cc');
  writeFileSync(join(plain, 'src/deep/deeper/d.ts'), 'd');
  writeFileSync(join(plain, 'node_modules/pkg/index.js'), 'x');
  writeFileSync(join(plain, '.git/objects/pack'), 'x');
  writeFileSync(join(plain, 'stray.elowen-upload'), 'partial');

  linked = mkdtempSync(join(tmpdir(), 'editor-walk-linked-'));
  mkdirSync(join(linked, 'src/nested'), { recursive: true });
  writeFileSync(join(linked, 'src/a.ts'), 'initial content');
  writeFileSync(join(linked, 'src/nested/b.ts'), 'nested');
  symlinkSync('src', join(linked, 'to-dir'));
  symlinkSync('src/a.ts', join(linked, 'to-file'));
  symlinkSync('missing', join(linked, 'broken'));

  deep = mkdtempSync(join(tmpdir(), 'editor-walk-deep-'));
  mkdirSync(join(deep, 'l1/l2/l3/l4/l5/l6/l7/l8/l9/l10'), { recursive: true });
  symlinkSync('l1', join(deep, 'via'));

  cyclic = mkdtempSync(join(tmpdir(), 'editor-walk-cyclic-'));
  writeFileSync(join(cyclic, 'f.ts'), 'f');
  symlinkSync('.', join(cyclic, 'self'));
});
afterAll(() => {
  for (const root of [plain, linked, cyclic, deep]) if (root) rmSync(root, { recursive: true, force: true });
});

function provider(root: string) {
  const hostPath = (guestPath: string): string => root + guestPath.slice('/workspace'.length);
  const guestOf = (host: string): string => `/workspace${host.slice(root.length)}`;
  const entryOf = (host: string, follow: boolean): GuestFileStat => {
    const info = follow ? statSync(host) : lstatSync(host);
    return {
      path: guestOf(host), size: info.size, modifiedAt: info.mtime.toISOString(),
      kind: info.isDirectory() ? 'directory' : info.isSymbolicLink() ? 'symlink' : info.isFile() ? 'file' : 'other',
    };
  };
  return (operation: GuestFileOperation): GuestFileResult => {
    if (operation.kind === 'stat') {
      try { return { kind: 'stat', entry: entryOf(hostPath(operation.path), operation.followSymlinks === true) }; }
      catch { return { kind: 'stat', entry: null }; }
    }
    if (operation.kind === 'list') {
      // `list` RESOLVES the path it is given, which is how a linked directory is read through the link.
      const dir = hostPath(operation.path);
      const names = readdirSync(dir).sort();
      const after = operation.cursor ? names.filter(name => name > operation.cursor!) : names;
      const page = after.slice(0, operation.limit);
      const more = after.length > page.length;
      return {
        kind: 'list', entries: page.map(name => ({ ...entryOf(join(dir, name), false), path: `${operation.path}/${name}` })),
        truncated: more, nextCursor: more ? page[page.length - 1]! : null,
      };
    }
    if (operation.kind !== 'walk') throw new Error(`unexpected operation ${operation.kind}`);
    const target = hostPath(operation.path);
    let info;
    try { info = lstatSync(target); } catch { return { kind: 'walk', root: operation.path, rootKind: null, entries: [], truncated: false }; }
    const rootKind = info.isDirectory() ? 'directory' as const : info.isSymbolicLink() ? 'symlink' as const : info.isFile() ? 'file' as const : 'other' as const;
    const base = rootKind === 'directory' ? target : join(target, '..');
    const skip = new Set(operation.skip ?? []);
    const maxDepth = operation.maxDepth ?? 64;
    const entries: { path: string; kind: 'file' | 'directory' | 'symlink'; size: number; mtime: number }[] = [];
    let visited = 0;
    let truncated = false;
    const visit = (dir: string, depth: number): void => {
      if (truncated) return;
      for (const name of readdirSync(dir).sort()) {
        if (++visited > operation.limit) { truncated = true; return; }
        const child = join(dir, name);
        const stat = lstatSync(child);
        // The link's OWN facts, and no descent through it.
        if (stat.isSymbolicLink()) { entries.push({ path: guestOf(child), kind: 'symlink', size: stat.size, mtime: stat.mtimeMs }); continue; }
        if (stat.isDirectory()) {
          // Omitted ENTIRELY, not merely left unopened: reporting it would claim it is empty.
          if (skip.has(name)) continue;
          entries.push({ path: guestOf(child), kind: 'directory', size: stat.size, mtime: stat.mtimeMs });
          if (depth < maxDepth) visit(child, depth + 1);
        } else if (stat.isFile()) entries.push({ path: guestOf(child), kind: 'file', size: stat.size, mtime: stat.mtimeMs });
      }
    };
    if (rootKind === 'directory') visit(base, 0);
    return { kind: 'walk', root: guestOf(base), rootKind, entries, truncated };
  };
}

function fixture(root: string, override?: (operation: GuestFileOperation) => GuestFileResult) {
  const routes: PluginApiRoute[] = [];
  const operations: GuestFileOperation[] = [];
  const guest = provider(root);
  const safe = vi.fn(() => { throw new Error('host filesystem must not be used'); });
  const projectFiles = vi.fn(async ({ operation }: { operation: GuestFileOperation }) => {
    operations.push(operation);
    return override ? override(operation) : guest(operation);
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
const kinds = (operations: GuestFileOperation[]): string[] => operations.map(operation => operation.kind);

describe('managed project tree over one guest walk', () => {
  it('answers a link-free project root in EXACTLY ONE guest call, eight levels deep', async () => {
    const f = fixture(plain);
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
    const f = fixture(plain);
    const response = await f.list({ path: 'src' });

    expect(f.projectFiles).toHaveBeenCalledTimes(1);
    expect(f.operations[0]).toMatchObject({ kind: 'walk', path: '/workspace/src', limit: 10000, maxDepth: 0 });
    expect(paths(response.body)).toEqual(['src/b.ts', 'src/deep']);
  });

  it('shows an empty directory as a directory of its own', async () => {
    const f = fixture(plain);
    const nodes = (await f.list()).body as Node[];
    expect(nodes.find(node => node.path === 'empty')).toEqual({ path: 'empty', type: 'dir' });
  });

  it('carries a size on a file and none on a directory, with paths relative to the workspace', async () => {
    const f = fixture(plain);
    const nodes = (await f.list()).body as Node[];
    expect(nodes.find(node => node.path === 'a.ts')).toEqual({ path: 'a.ts', type: 'file', size: 2 });
    expect(nodes.find(node => node.path === 'src/b.ts')).toEqual({ path: 'src/b.ts', type: 'file', size: 4 });
    expect(nodes.every(node => !node.path.startsWith('/'))).toBe(true);
  });

  it('omits the ignored directories entirely, and the upload leftover with them', async () => {
    const f = fixture(plain);
    const listed = paths((await f.list()).body);
    expect(listed.some(path => path.startsWith('node_modules'))).toBe(false);
    expect(listed.some(path => path.startsWith('.git'))).toBe(false);
    expect(listed).not.toContain('stray.elowen-upload');
  });

  /** `skip` names CHILDREN, so asking for an ignored directory by name still expands it — which is what
   *  the per-directory listing did before, and what the tree view's "open anyway" depends on. */
  it('still expands an ignored directory when it is the one asked for', async () => {
    const f = fixture(plain);
    const response = await f.list({ path: 'node_modules' });
    // One level, like any other expansion: the children of the directory that was asked for.
    expect(paths(response.body)).toEqual(['node_modules/pkg']);
  });

  it('refuses a truncated answer instead of rendering a partial tree as a complete one', async () => {
    const guest = provider(plain);
    const f = fixture(plain, operation => ({ ...(guest(operation) as Extract<GuestFileResult, { kind: 'walk' }>), truncated: true }));
    const response = await f.list();
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'directory listing is too large; select a subdirectory' });
  });

  it('reports a missing path as missing rather than as an empty folder', async () => {
    const f = fixture(plain);
    const response = await f.list({ path: 'gone' });
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'path does not exist' });
  });

  /** The walk answers a file root from its PARENT. Rendering that as the requested folder would show a
   *  sibling listing under the file's name, so the editor refuses it outright. */
  it('refuses a file root instead of answering from its parent directory', async () => {
    const f = fixture(plain);
    const response = await f.list({ path: 'a.ts' });
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'not a directory' });
  });

  it('refuses an entry the guest reports outside the directory that was asked for', async () => {
    const f = fixture(plain, () => ({
      kind: 'walk', root: '/workspace/src', rootKind: 'directory',
      entries: [{ path: '/workspace/elsewhere.ts', kind: 'file', size: 1, mtime: 0 }], truncated: false,
    }));
    const response = await f.list({ path: 'src' });
    expect(response.status).toBe(503);
  });

  it('refuses an entry that leaves the workspace at all', async () => {
    const f = fixture(plain, () => ({
      kind: 'walk', root: '/workspace', rootKind: 'directory',
      entries: [{ path: '/workspace/../escape.ts', kind: 'file', size: 1, mtime: 0 }], truncated: false,
    }));
    expect((await f.list()).status).toBe(400);
  });

  it('rejects a traversing request before asking the guest', async () => {
    const f = fixture(plain);
    const response = await f.list({ path: '../other-project' });
    expect(response.status).toBe(400);
    expect(f.projectFiles).not.toHaveBeenCalled();
  });
});

/** The behaviour that predates the walk entirely: a link is shown as what it POINTS AT. The walk reports
 *  links but never follows them, so the editor resolves each one itself and reads a linked directory
 *  through the link path. */
describe('symlinks in the managed project tree', () => {
  it("shows a link to a file as a file carrying its TARGET's size", async () => {
    const f = fixture(linked);
    const nodes = (await f.list()).body as Node[];
    expect(nodes.find(node => node.path === 'to-file')).toEqual({ path: 'to-file', type: 'file', size: 15 });
  });

  it('shows a link to a directory as a directory and lists what is behind it', async () => {
    const f = fixture(linked);
    const listed = paths((await f.list()).body);
    expect(listed).toEqual([
      'src', 'src/a.ts', 'src/nested', 'src/nested/b.ts',
      'to-dir', 'to-dir/a.ts', 'to-dir/nested', 'to-dir/nested/b.ts', 'to-file',
    ]);
  });

  it('drops a link that points nowhere', async () => {
    const f = fixture(linked);
    expect(paths((await f.list()).body)).not.toContain('broken');
  });

  /** The whole point of the change: an ordinary tree is one call, and only the links cost more — one stat
   *  each, plus a listing per directory behind a linked one. */
  it('costs one walk plus one stat per link, and lists nothing outside a linked subtree', async () => {
    const f = fixture(linked);
    await f.list();
    expect(kinds(f.operations).filter(kind => kind === 'walk')).toEqual(['walk']);
    expect(kinds(f.operations).filter(kind => kind === 'stat')).toHaveLength(3);
    expect(f.operations.filter(operation => operation.kind === 'list').map(operation => operation.path))
      .toEqual(['/workspace/to-dir', '/workspace/to-dir/nested']);
  });

  it('expands one directory without descending through any link below it', async () => {
    const f = fixture(linked);
    const response = await f.list({ path: 'src' });
    expect(paths(response.body)).toEqual(['src/a.ts', 'src/nested']);
    expect(kinds(f.operations)).toEqual(['walk']);
  });

  /** A link pointing back at its own ancestor terminates on the depth bound, which is what bounded it
   *  before the walk existed too. */
  it('bottoms out on a cycle at the depth a real tree bottoms out at', async () => {
    const f = fixture(cyclic);
    const listed = paths((await f.list()).body);
    expect(listed).toContain('self/self/f.ts');
    expect(Math.max(...listed.map(path => path.split('/').length))).toBe(9);
  });

  /** The depth bound is one count, kept in two places now: the walk's `maxDepth` for the real tree and the
   *  fallback's own descent for what is behind a link. This proves the two agree, level for level. */
  it('cuts a linked subtree off at exactly the depth the real one is cut off at', async () => {
    const f = fixture(deep);
    const listed = paths((await f.list()).body);
    const direct = listed.filter(path => path.startsWith('l1'));
    const behind = listed.filter(path => path.startsWith('via'));
    expect(Math.max(...direct.map(path => path.split('/').length))).toBe(9);
    expect(behind.map(path => path.replace(/^via/, 'l1'))).toEqual(direct);
  });

  it('refuses a linked subtree that pushes the view past its node cap', async () => {
    const guest = provider(cyclic);
    const f = fixture(cyclic, operation => {
      if (operation.kind !== 'list') return guest(operation);
      // A linked directory that answers with more entries than the whole view may hold.
      const entries = Array.from({ length: 10001 }, (_, index) => ({
        path: `${operation.path}/f${index}.ts`, kind: 'file' as const, size: 1, modifiedAt: '2026-01-01T00:00:00.000Z',
      }));
      return { kind: 'list', entries, truncated: false, nextCursor: null };
    });
    const response = await f.list();
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'directory listing is too large; select a subdirectory' });
  });
});
