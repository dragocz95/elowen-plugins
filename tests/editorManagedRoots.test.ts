// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import type { PluginContext, PluginApiRequest, PluginApiRoute } from 'elowen/dist/plugins/api.js';
import { registerEditorApi } from '../plugins/editor/src/api.js';
import { parseEditorRoot, EDITOR_ROOTS, isVirtualGuestPath } from '../plugins/editor/src/editorRoots.js';

/** The two roots a MANAGED project offers the editor.
 *
 *  The defect these cover: the managed transport asked the guest for `/workspace` whatever the project
 *  was. `/workspace` belongs to the base image and every project's copy of it is empty, so a project
 *  mounted at its own slug-derived directory answered its file tree with nothing — an environment full
 *  of files reported as an empty project. Nothing errored; the view was simply blank.
 */

const PROJECT_ID = 7;
const OTHER_ID = 8;

interface GuestCall { kind: string; path?: string; [key: string]: unknown }
interface Prepared { cwd: string; argv: string[] }

function fixture(options: {
  slug?: string;
  executionKind?: 'host' | 'managed';
  files?: (op: GuestCall) => unknown;
  admin?: boolean;
  allowed?: number[] | null;
} = {}) {
  const routes: PluginApiRoute[] = [];
  const operations: GuestCall[] = [];
  const prepared: Prepared[] = [];
  const safe = vi.fn(() => { throw new Error('host filesystem must not be used'); });
  const project = {
    id: PROJECT_ID,
    slug: options.slug ?? 'sdilene',
    path: options.executionKind === 'host' ? '/srv/host-project' : '',
    executionKind: options.executionKind ?? 'managed',
  };
  const provider = {
    projectFiles: async ({ operation }: { operation: GuestCall }) => {
      operations.push(operation);
      return options.files ? options.files(operation) : { kind: operation.kind };
    },
    prepareExecution: async (input: { cwd: string; command: { args?: string[]; file?: string } }) => {
      prepared.push({ cwd: input.cwd, argv: [input.command.file ?? '', ...(input.command.args ?? [])] });
      return {
        // The real provider answers with the HOST directory the launcher runs in and reports the guest
        // directory separately — the guest path is where the command lands INSIDE the container, and
        // spawning at it on the host would fail on a directory that does not exist there.
        //
        // The launch consumes its stdin and exits cleanly: the transport writes the request half to the
        // child, and a program that exits before reading it fails on a broken pipe instead of exercising
        // the path under test.
        mode: 'managed', projectRef: { kind: 'managed', projectId: PROJECT_ID }, cwd: '/tmp', displayCwd: input.cwd,
        launch: { type: 'command', command: 'cat >/dev/null', env: {} }, stdin: '',
        cancel: async () => undefined, sanitizeOutput: (text: string) => text,
        lease: { release: async () => undefined, heartbeat: async () => undefined },
      };
    },
  };
  const ctx = {
    host: { projectFiles: () => ({ safe }), stores: () => ({ projects: { get: (id: number) => (id === PROJECT_ID ? project : null) } }) },
    control: () => provider,
    registerApiRoute: (route: PluginApiRoute) => routes.push(route),
  } as unknown as PluginContext;
  registerEditorApi(ctx);
  const call = (mount: string, method = 'GET', query: Record<string, string> = {}, input: unknown = undefined, id = String(PROJECT_ID)) => {
    const route = routes.find(r => r.rootMount === `/projects/:id/${mount}` && r.method === method)!;
    return route.handler({
      path: '', params: { id }, query, headers: {},
      auth: { admin: options.admin ?? false, accessibleProjects: options.allowed === undefined ? [PROJECT_ID, OTHER_ID] : options.allowed, userId: 11 },
      json: async () => input,
      body: async () => Buffer.alloc(0),
    } as unknown as PluginApiRequest);
  };
  return { call, safe, operations, prepared };
}

const walk = (root: string, entries: { path: string; kind: 'file' | 'directory'; size?: number }[]) =>
  (op: GuestCall) => op.kind === 'walk'
    ? { kind: 'walk', root, rootKind: 'directory', truncated: false, entries: entries.map(e => ({ ...e, size: e.size ?? 0, mtime: 0 })) }
    : { kind: op.kind };
const paths = (body: unknown): string[] => (body as { path: string }[]).map(node => node.path).sort();

describe('the typed root selector', () => {
  it('accepts exactly the two root names and defaults an absent one', () => {
    expect(EDITOR_ROOTS).toEqual(['project', 'system']);
    expect(parseEditorRoot(undefined)).toBe('project');
    expect(parseEditorRoot('')).toBe('project');
    expect(parseEditorRoot('project')).toBe('project');
    expect(parseEditorRoot('system')).toBe('system');
  });
  // Falling back to the project root here is what would turn "show me the environment" into "here are
  // four repository files", which is the failure nobody notices.
  it.each(['/', 'System', 'host', '../system', 'constructor', '__proto__', 'toString'])('refuses %s rather than falling back', value => {
    expect(parseEditorRoot(value)).toBeNull();
  });
  it('names the kernel filesystems the system root does not serve', () => {
    for (const path of ['/proc', '/proc/1/mem', '/sys', '/sys/kernel', '/dev', '/dev/sda', '/run', '/run/lock']) expect(isVirtualGuestPath(path)).toBe(true);
    for (const path of ['/etc', '/etc/hosts', '/sdilene', '/development', '/procedures', '/systemd', '/devices', '/runner']) expect(isVirtualGuestPath(path)).toBe(false);
  });
});

describe('the project root of a managed project', () => {
  // The regression itself: a project whose slug is not "workspace" must be read at its own directory.
  it('walks the canonical slug-derived directory and returns a non-empty tree', async () => {
    const f = fixture({ slug: 'sdilene', files: walk('/sdilene', [
      { path: '/sdilene/README.md', kind: 'file', size: 12 },
      { path: '/sdilene/src', kind: 'directory' },
      { path: '/sdilene/src/app.ts', kind: 'file', size: 40 },
    ]) });
    const response = await f.call('files');
    expect(paths(response.body)).toEqual(['README.md', 'src', 'src/app.ts']);
    expect(f.operations[0]).toMatchObject({ kind: 'walk', path: '/sdilene', maxDepth: 8 });
    expect(f.operations.some(op => String(op.path).startsWith('/workspace'))).toBe(false);
  });
  it.each([
    ['sdilene', '/sdilene'],
    ['Kolin', '/kolin'],
    ['my project', '/my-project'],
  ])('derives %s as %s, the directory the container itself mounts', async (slug, root) => {
    const f = fixture({ slug, files: walk(root, [{ path: `${root}/a.ts`, kind: 'file', size: 1 }]) });
    expect(paths((await f.call('files')).body)).toEqual(['a.ts']);
    expect(f.operations[0]).toMatchObject({ path: root });
  });
  // A slug that names a base-image directory cannot be a mount target, so the canonical rule falls back
  // to the registry identity. Project creation refuses such a slug now; rows that predate it remain.
  it('falls back to the registry identity for a slug the image already owns', async () => {
    const f = fixture({ slug: 'etc', files: walk('/project-7', [{ path: '/project-7/a.ts', kind: 'file', size: 1 }]) });
    expect(paths((await f.call('files')).body)).toEqual(['a.ts']);
    expect(f.operations[0]).toMatchObject({ path: '/project-7' });
  });
  it('reads and writes at the canonical root, carrying the content version', async () => {
    const f = fixture({ files: op => op.kind === 'read'
      ? { kind: 'read', base64: Buffer.from('hello').toString('base64'), totalBytes: 5, version: 'v1' }
      : { kind: 'write', entry: { version: 'v2' } } });
    expect((await f.call('file', 'GET', { path: 'src/a.ts', root: 'project' })).body).toMatchObject({ content: 'hello', version: 'v1' });
    expect(f.operations[0]).toMatchObject({ kind: 'read', path: '/sdilene/src/a.ts' });
    expect((await f.call('file', 'PUT', { root: 'project' }, { path: 'src/a.ts', content: 'next', version: 'v1' })).body).toEqual({ ok: true, version: 'v2' });
    expect(f.operations[1]).toMatchObject({ kind: 'write', path: '/sdilene/src/a.ts', expectedVersion: 'v1' });
  });
  it('runs Git at the canonical root rather than at /workspace', async () => {
    const f = fixture();
    await f.call('changes', 'GET', { root: 'project' });
    expect(f.prepared[0]?.cwd).toBe('/sdilene');
    expect(f.prepared[0]?.argv).toEqual(['git', '-C', '/sdilene', 'diff', '--no-ext-diff', '--no-textconv', 'HEAD']);
  });
});

describe('the system root of a managed project', () => {
  it('lists the guest filesystem one level deep, project mount included', async () => {
    const f = fixture({ files: walk('/', [
      { path: '/etc', kind: 'directory' },
      { path: '/usr', kind: 'directory' },
      { path: '/sdilene', kind: 'directory' },
    ]) });
    const response = await f.call('files', 'GET', { root: 'system' });
    // The mount appears as a sibling of the base image's directories and keeps its own name — the two
    // roots stay separate rather than one pretending to contain the other.
    expect(paths(response.body)).toEqual(['etc', 'sdilene', 'usr']);
    expect(f.operations[0]).toMatchObject({ kind: 'walk', path: '/', maxDepth: 0, skip: [] });
  });
  it('reads a file of the base image at its own guest path', async () => {
    const f = fixture({ files: () => ({ kind: 'read', base64: Buffer.from('127.0.0.1 localhost').toString('base64'), totalBytes: 19, version: 'h1' }) });
    expect((await f.call('file', 'GET', { path: 'etc/hosts', root: 'system' })).body).toMatchObject({ content: '127.0.0.1 localhost' });
    expect(f.operations[0]).toMatchObject({ kind: 'read', path: '/etc/hosts' });
  });
  it('writes into the environment, because the guest already belongs to the project', async () => {
    const f = fixture({ files: () => ({ kind: 'write', entry: { version: 'w1' } }) });
    expect((await f.call('file', 'PUT', { root: 'system' }, { path: 'etc/profile.d/project.sh', content: 'export X=1', version: null })).status).toBe(200);
    expect(f.operations.at(-1)).toMatchObject({ kind: 'write', path: '/etc/profile.d/project.sh' });
    // The directory is prepared in the guest, at the root the request selected.
    expect(f.prepared[0]).toEqual({ cwd: '/', argv: ['mkdir', '-p', '--', '/etc/profile.d'] });
  });
  // A listing of `/` legitimately reports the kernel filesystems as entries. Refusing the ENTRY, rather
  // than only a request for one, turned "this directory is not browsable" into a 400 for the whole root.
  it('drops the kernel filesystems from the listing instead of failing on them', async () => {
    const f = fixture({ files: walk('/', [
      { path: '/proc', kind: 'directory' }, { path: '/sys', kind: 'directory' },
      { path: '/dev', kind: 'directory' }, { path: '/run', kind: 'directory' },
      { path: '/etc', kind: 'directory' }, { path: '/sdilene', kind: 'directory' },
    ]) });
    const response = await f.call('files', 'GET', { root: 'system' });
    expect(response.status).toBeUndefined();
    expect(paths(response.body)).toEqual(['etc', 'sdilene']);
  });
  it('does not apply the repository ignores to a filesystem that is not a checkout', async () => {
    const f = fixture({ files: walk('/', [{ path: '/dist', kind: 'directory' }, { path: '/.cache', kind: 'directory' }]) });
    expect(paths((await f.call('files', 'GET', { root: 'system' })).body)).toEqual(['.cache', 'dist']);
  });
  it('reports version history as unavailable instead of running Git at /', async () => {
    const f = fixture();
    for (const mount of ['changes', 'changed', 'diff', 'head', 'commits']) {
      const response = await f.call(mount, 'GET', { path: 'etc/hosts', root: 'system' });
      expect(response).toMatchObject({ status: 409, body: { error: 'version history is available only in the project root' } });
    }
    expect(f.prepared).toEqual([]);
  });
  // The Git refusal explains version history, so it must answer for the Git mounts and for nothing else.
  // A non-Git operation under the system root keeps its own contract.
  it('scopes the version-history refusal to the Git operations', async () => {
    const f = fixture({ files: () => ({ kind: 'stat', entry: { path: '/etc/hosts', kind: 'file', size: 4, version: 'v1' } }) });
    const response = await f.call('office-preview', 'GET', { path: 'etc/hosts', root: 'system' });
    expect(response).toMatchObject({ status: 415, body: { error: 'unsupported office file' } });
  });
  it.each(['proc/1/mem', 'sys/kernel/notes', 'dev/sda', 'run/lock'])('refuses the kernel filesystem %s before any guest crossing', async path => {
    const f = fixture();
    const response = await f.call('file', 'GET', { path, root: 'system' });
    expect(response).toMatchObject({ status: 400, body: { error: 'virtual filesystem paths are unavailable' } });
    expect(f.operations).toEqual([]);
  });
});

describe('confinement of each root', () => {
  it.each(['../etc/passwd', '../../etc/passwd', 'src/../../escape', '..'])('refuses traversal out of the project root for %s', async path => {
    const f = fixture();
    expect((await f.call('file', 'GET', { path, root: 'project' })).status).toBe(400);
    expect(f.operations).toEqual([]);
  });
  // `/` has nothing above it, so `..` there is normalised away rather than refused — and what it
  // normalises TO is still a guest path. The guarantee this states is that it can never become a HOST
  // path: the host guard is untouched and the guest is asked for a path inside its own filesystem.
  it.each([
    ['../escape', '/escape'],
    ['etc/../../escape', '/escape'],
    ['../../../etc/hosts', '/etc/hosts'],
  ])('normalises %s to the guest path %s under the system root', async (path, resolved) => {
    const f = fixture({ files: () => ({ kind: 'read', base64: '', totalBytes: 0, version: 'v0' }) });
    await f.call('file', 'GET', { path, root: 'system' });
    expect(f.operations[0]).toMatchObject({ kind: 'read', path: resolved });
    expect(f.safe).not.toHaveBeenCalled();
  });
  it.each(['project', 'system'])('refuses a NUL byte and a backslash under the %s root', async root => {
    const f = fixture();
    expect((await f.call('file', 'GET', { path: 'a\0b', root })).status).toBe(400);
    expect((await f.call('file', 'GET', { path: 'a\\b', root })).status).toBe(400);
    expect(f.operations).toEqual([]);
  });
  // One request names one root, so a move has one base for both ends and cannot cross into the other.
  it('resolves both ends of a rename inside the selected root only', async () => {
    const f = fixture({ files: op => op.kind === 'stat' ? { kind: 'stat', entry: { path: '/sdilene/a.ts', kind: 'file', size: 1, version: 'v1' } } : { kind: op.kind } });
    expect((await f.call('rename', 'POST', { root: 'project' }, { from: 'a.ts', to: '../etc/passwd' })).status).toBe(400);
    expect((await f.call('copy', 'POST', { root: 'project' }, { from: '../etc/passwd', to: 'a.ts' })).status).toBe(400);
    expect(f.operations).toEqual([]);
  });
  it.each([
    ['project', '/sdilene'],
    ['system', '/'],
  ])('refuses replacing, renaming or deleting the %s root itself', async (root, base) => {
    const f = fixture({ files: op => op.kind === 'stat' ? { kind: 'stat', entry: { path: base, kind: 'directory', size: 0, version: 'v1' } } : { kind: op.kind } });
    // `.` resolves to the root directory itself, which is the one destination no operation may take.
    expect((await f.call('entry', 'DELETE', { path: '.', root })).status).toBe(400);
    expect((await f.call('new-file', 'POST', { root }, { path: '.' })).status).toBe(400);
    expect((await f.call('dir', 'POST', { root }, { path: '.' })).status).toBe(400);
    expect((await f.call('rename', 'POST', { root }, { from: '.', to: 'elsewhere' })).status).toBe(400);
    expect((await f.call('rename', 'POST', { root }, { from: 'elsewhere', to: '.' })).status).toBe(400);
    expect((await f.call('copy', 'POST', { root }, { from: 'elsewhere', to: '.' })).status).toBe(400);
    expect((await f.call('file', 'PUT', { root }, { path: '.', content: '', version: null })).status).toBe(400);
    // An upload is a write like any other: the root is not a destination it may open a handle against.
    expect((await f.call('upload', 'PUT', { path: '.', offset: '0', size: '0', final: '1', root })).status).toBe(400);
    // Nothing reached the guest and nothing was executed in it.
    expect(f.operations).toEqual([]);
    expect(f.prepared).toEqual([]);
  });
});

describe('which projects have a second root', () => {
  it('refuses the system root for a host project, whose tree is the project directory', async () => {
    const f = fixture({ executionKind: 'host', admin: true });
    const response = await f.call('files', 'GET', { root: 'system' });
    expect(response).toEqual({ status: 400, body: { error: 'this project does not have that root' } });
  });
  it('leaves a host project on its host branch when no root is named', async () => {
    const f = fixture({ executionKind: 'host', admin: true });
    // The request is served from the host filesystem, never through the guest transport. The fixture's
    // host path does not exist, so the host listing raises — which is itself the proof that the host
    // branch ran. Broader host coverage lives in tests/editorProjectFiles.test.ts.
    const response = await f.call('files', 'GET', { path: 'src' });
    expect(response).toMatchObject({ status: 400 });
    expect(f.safe).toHaveBeenCalled();
    expect(f.operations).toEqual([]);
  });
  it('refuses an unknown root name for every project', async () => {
    const f = fixture();
    expect((await f.call('files', 'GET', { root: 'host' }))).toEqual({ status: 400, body: { error: 'unknown editor root' } });
    expect(f.operations).toEqual([]);
  });
  it('refuses a project the caller is not assigned to before resolving any root', async () => {
    const f = fixture({ allowed: [OTHER_ID] });
    expect((await f.call('files', 'GET', { root: 'system' })).status).toBe(403);
    expect(f.operations).toEqual([]);
  });
  // The reserved id already means "the host filesystem"; naming a root there would be a second way to
  // say the same thing, and `system` there must never be read as a managed project's guest root.
  it('refuses a named root on the reserved host system id', async () => {
    const f = fixture({ admin: true, allowed: null });
    expect((await f.call('files', 'GET', { root: 'system' }, undefined, '-1')).status).toBe(400);
  });
});
