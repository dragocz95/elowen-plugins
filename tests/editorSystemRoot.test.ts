// @vitest-environment node
/** The editor's admin-only system root: `/projects/-1/...` serves the whole server filesystem.
 *
 *  The gate is what most of this file is about, so it runs against the REAL tenancy wiring (UserStore +
 *  UserProjectStore, bearer tokens) rather than the open-mode server the other editor route suites use —
 *  in open mode every caller is an admin and a 403 could never be observed. The first account created is
 *  the instance admin; the second is an ordinary member. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from 'elowen/dist/store/db.js';
import { loadPlugins } from 'elowen/dist/plugins/loader.js';
import { PluginRegistryProvider } from 'elowen/dist/plugins/pluginsProvider.js';
import { createServer } from 'elowen/dist/api/server.js';
import { ConfigStore } from 'elowen/dist/store/configStore.js';
import { UserStore } from 'elowen/dist/store/userStore.js';
import { ProjectStore } from 'elowen/dist/store/projectStore.js';
import { UserProjectStore } from 'elowen/dist/store/userProjectStore.js';
import { EventBus } from 'elowen/dist/api/sse.js';
import { FakeClock } from 'elowen/dist/shared/clock.js';
import { safeProjectPath } from 'elowen/dist/integrations/projectFiles.js';
import type { PluginHostWiring } from 'elowen/dist/plugins/registry.js';
import { deleteProjectEntry, listProjectFiles, safeSystemPath, writeProjectFile } from '../plugins/editor/src/files.js';
import { SYSTEM_PROJECT_ID } from '../plugins/editor/src/systemRoot.js';

const pluginsDir = join(fileURLToPath(new URL('..', import.meta.url)), 'plugins');
const logger = { info() {}, warn() {}, error() {} };

interface FileNode { path: string; type: 'file' | 'dir'; size?: number }

function serverWith(projectPath: string) {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'elowen',?)").run(projectPath);
  const users = new UserStore(db);
  const admin = users.create('admin', 'pw');
  const member = users.create('member', 'pw');
  const userProjects = new UserProjectStore(db);
  // The member is a fully legitimate user of project 1 — the point being that project access is exactly
  // what the system root does NOT follow from.
  userProjects.assign(member.id, 1);
  const projects = new ProjectStore(db);
  const host: PluginHostWiring = { stores: { projects } as never, projectFiles: { safe: safeProjectPath } };
  const app = createServer({
    bus: new EventBus(),
    tmux: null as never, project: { id: 1, path: projectPath }, fallback: { program: 'claude-code', model: 'sonnet' },
    clock: new FakeClock(0), config: new ConfigStore(db), users, projects, userProjects,
    plugins: new PluginRegistryProvider(() => loadPlugins({ dirs: [pluginsDir], enabled: ['editor'], logger, host })),
    pluginDirs: [pluginsDir],
  });
  return { app, adminToken: users.issueToken(admin.id), memberToken: users.issueToken(member.id) };
}

describe('editor system root', () => {
  let root: string;
  let outside: string;
  let fixtureDir: string;
  let fixtureFile: string;
  let app: ReturnType<typeof serverWith>['app'];
  let adminToken: string;
  let memberToken: string;

  const as = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });
  const get = (path: string, token: string) => app.request(path, as(token));

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'elowen-system-root-'));
    outside = mkdtempSync(join(tmpdir(), 'elowen-system-outside-'));
    fixtureDir = relative('/', outside);
    fixtureFile = join(fixtureDir, 'host.txt');
    writeFileSync(join(outside, 'host.txt'), 'System root fixture\n');
    mkdirSync(join(outside, 'nested'));
    writeFileSync(join(outside, 'nested', 'hidden.txt'), 'Not walked');
    ({ app, adminToken, memberToken } = serverWith(root));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it('lists the filesystem root for an admin, one level deep', async () => {
    const res = await get(`/projects/${SYSTEM_PROJECT_ID}/files`, adminToken);
    expect(res.status).toBe(200);
    const tree = await res.json() as FileNode[];
    const paths = tree.map((node) => node.path);
    const fixtureTopLevel = fixtureDir.split('/')[0];
    expect(paths).toContain(fixtureTopLevel);
    expect(paths).not.toContain('dev');
    expect(paths).not.toContain('proc');
    expect(paths).not.toContain('run');
    expect(paths).not.toContain('sys');
    expect(tree.find((node) => node.path === fixtureTopLevel)?.type).toBe('dir');
    // ONE level and not one more. Two levels below `/` is already tens of thousands of entries, so a
    // listing that started descending here would not be slow, it would be unusable.
    expect(paths.filter((path) => path.includes('/'))).toEqual([]);
  });

  it('reads a file anywhere on the machine for an admin', async () => {
    const res = await get(`/projects/${SYSTEM_PROJECT_ID}/file?path=${encodeURIComponent(fixtureFile)}`, adminToken);
    expect(res.status).toBe(200);
    expect((await res.json() as { content: string }).content).toBe('System root fixture\n');
  });

  it('expands one directory at a time, with paths relative to the root', async () => {
    const res = await get(`/projects/${SYSTEM_PROJECT_ID}/files?path=${encodeURIComponent(fixtureDir)}`, adminToken);
    expect(res.status).toBe(200);
    const paths = (await res.json() as FileNode[]).map((node) => node.path);
    expect(paths).toEqual([join(fixtureDir, 'nested'), fixtureFile]);
    // The level below the requested one is not walked either.
    expect(paths).not.toContain(join(fixtureDir, 'nested', 'hidden.txt'));
  });

  it('expands a symlinked directory through the system root', async () => {
    symlinkSync(join(outside, 'nested'), join(outside, 'linked'));
    const listing = await (await get(`/projects/${SYSTEM_PROJECT_ID}/files?path=${encodeURIComponent(fixtureDir)}`, adminToken)).json() as FileNode[];
    const linked = join(fixtureDir, 'linked');
    expect(listing.find((node) => node.path === linked)?.type).toBe('dir');
    const res = await get(`/projects/${SYSTEM_PROJECT_ID}/files?path=${encodeURIComponent(linked)}`, adminToken);
    expect(res.status).toBe(200);
    expect((await res.json() as FileNode[]).map((node) => node.path)).toEqual([join(linked, 'hidden.txt')]);
  });

  it('refuses the reserved id for a non-admin, however the id is spelled', async () => {
    // A member of a real project is still not an operator of the machine. Every entry point refuses,
    // not just the listing — and the numeric spellings of the same id refuse alike.
    for (const path of [
      `/projects/${SYSTEM_PROJECT_ID}/files`,
      `/projects/${SYSTEM_PROJECT_ID}/file?path=${encodeURIComponent(fixtureFile)}`,
      `/projects/${SYSTEM_PROJECT_ID}/raw?path=${encodeURIComponent(fixtureFile)}`,
      `/projects/${SYSTEM_PROJECT_ID}/changed`,
      '/projects/-1.0/files',
      '/projects/-01/files',
      '/projects/%2D1/files',
    ]) {
      const res = await get(path, memberToken);
      expect([path, res.status]).toEqual([path, 403]);
      expect(await res.json()).toEqual({ error: 'forbidden' });
    }
  });

  it('leaves the member\'s own project working exactly as before', async () => {
    writeFileSync(join(root, 'note.md'), '# hi\n');
    const res = await get('/projects/1/files', memberToken);
    expect(res.status).toBe(200);
    expect((await res.json() as FileNode[]).map((node) => node.path)).toContain('note.md');
  });

  it('confines `..` to the root instead of climbing out of it', async () => {
    const rootListing = await (await get(`/projects/${SYSTEM_PROJECT_ID}/files`, adminToken)).json() as FileNode[];
    const climbed = await get(`/projects/${SYSTEM_PROJECT_ID}/files?path=${encodeURIComponent('../../..')}`, adminToken);
    expect(climbed.status).toBe(200);
    // `/..` is `/`: the traversal lands back on the root rather than anywhere above it.
    expect(await climbed.json()).toEqual(rootListing);

    const file = await get(`/projects/${SYSTEM_PROJECT_ID}/file?path=${encodeURIComponent(`../../../${fixtureFile}`)}`, adminToken);
    expect(file.status).toBe(200);
    const direct = await get(`/projects/${SYSTEM_PROJECT_ID}/file?path=${encodeURIComponent(fixtureFile)}`, adminToken);
    expect(await file.json()).toEqual(await direct.json());
  });

  it('answers every git route cleanly for a root that is not a repository', async () => {
    // `/` has no repository behind it. Each of these must be an empty answer with a 200, never a 500
    // carrying a git stack trace — and, because the plugin does not invoke git here at all, never a
    // repository discovered somewhere above or below the root either.
    const changed = await get(`/projects/${SYSTEM_PROJECT_ID}/changed`, adminToken);
    expect(changed.status).toBe(200);
    expect(await changed.json()).toEqual({ changed: [] });

    const commits = await get(`/projects/${SYSTEM_PROJECT_ID}/commits`, adminToken);
    expect(commits.status).toBe(200);
    expect(await commits.json()).toEqual({ commits: [] });

    const changes = await get(`/projects/${SYSTEM_PROJECT_ID}/changes`, adminToken);
    expect(changes.status).toBe(200);
    expect(await changes.json()).toEqual({ diff: '' });

    const head = await get(`/projects/${SYSTEM_PROJECT_ID}/head?path=${encodeURIComponent(fixtureFile)}`, adminToken);
    expect(head.status).toBe(200);
    expect(await head.json()).toEqual({ content: '' });
  });

  it('keeps every other non-positive id a plain 404', async () => {
    // Only the one reserved id means anything; 0 and the rest stay what they always were.
    for (const id of [0, -2, -5]) {
      const res = await get(`/projects/${id}/files`, adminToken);
      expect([id, res.status]).toEqual([id, 404]);
    }
  });
});

describe('system path guard', () => {
  it('normalises instead of comparing, because nothing can be above `/`', () => {
    expect(safeSystemPath('/', 'etc/hostname')).toBe('/etc/hostname');
    expect(safeSystemPath('/', '../../etc/hostname')).toBe('/etc/hostname');
    expect(safeSystemPath('/', '')).toBe('/');
  });

  it('refuses any root but `/`, so it can never stand in for the host guard', () => {
    // The guard is only CORRECT at the filesystem root; handed a project root it would silently drop
    // the containment check the host's own guard performs.
    expect(() => safeSystemPath('/var/www', 'x')).toThrow(/invalid path/);
  });

  it('keeps kernel virtual filesystems out of an editor running on the synchronous daemon thread', () => {
    for (const path of ['dev/null', 'proc/self/environ', 'run/systemd', 'sys/kernel']) {
      expect(() => safeSystemPath('/', path)).toThrow(/virtual filesystem/);
    }
    expect(safeSystemPath('/', 'etc/hostname')).toBe('/etc/hostname');
  });
});

describe('listing tolerance', () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'elowen-listing-')); });
  afterEach(() => {
    // Restore the mode first or the temp tree cannot be removed.
    try { chmodSync(join(root, 'locked'), 0o755); } catch { /* the case that did not create it */ }
    rmSync(root, { recursive: true, force: true });
  });

  it('skips what it cannot read instead of failing the whole listing', () => {
    writeFileSync(join(root, 'readable.txt'), 'ok');
    symlinkSync(join(root, 'gone.txt'), join(root, 'dangling'));
    mkdirSync(join(root, 'locked'));
    writeFileSync(join(root, 'locked', 'inside.txt'), 'secret');
    chmodSync(join(root, 'locked'), 0o000);

    const nodes = listProjectFiles(root);
    const paths = nodes.map((node) => node.path);
    // The daemon user cannot read everything under a system root, and a dangling symlink has nothing to
    // stat at all. Either one used to throw out of the walk and cost the caller the entire directory.
    expect(paths).toContain('readable.txt');
    expect(paths).toContain('locked');
    expect(paths).not.toContain('dangling');
    expect(paths).not.toContain(join('locked', 'inside.txt'));
  });

  it('does not present or overwrite a device target as an editable regular file', () => {
    symlinkSync('/dev/null', join(root, 'device'));
    writeFileSync(join(root, 'regular.txt'), 'ok');
    const paths = listProjectFiles(root).map((node) => node.path);
    expect(paths).toContain('regular.txt');
    expect(paths).not.toContain('device');
    const safe = (base: string, rel: string) => join(base, rel);
    expect(() => writeProjectFile(safe, root, 'device', 'nope')).toThrow(/unsupported file type/);
    expect(() => deleteProjectEntry(safe, root, 'device')).not.toThrow();
    // Deleting the symlink is safe; the device target itself remains untouched.
    expect(existsSync('/dev/null')).toBe(true);
  });

  it('shows a symlinked directory as a directory, and does not follow one that escapes the root', () => {
    const outside = mkdtempSync(join(tmpdir(), 'elowen-outside-'));
    writeFileSync(join(outside, 'secret.txt'), 'SECRET');
    try {
      mkdirSync(join(root, 'real'));
      writeFileSync(join(root, 'real', 'inside.txt'), 'fine');
      symlinkSync(join(root, 'real'), join(root, 'inward'));
      symlinkSync(outside, join(root, 'outward'));

      const nodes = listProjectFiles(root);
      const paths = nodes.map((node) => node.path);
      // Most of the top of a Linux root is symlinks (/bin, /lib, /sbin). Listing them as files whose
      // size happened to be the folder's made the first screen of the system root mostly unopenable.
      expect(nodes.find((node) => node.path === 'inward')?.type).toBe('dir');
      expect(nodes.find((node) => node.path === 'outward')?.type).toBe('dir');
      // The inward link's target was already walked under its own name, so it is not walked again —
      // one directory, listed once.
      expect(paths).toContain(join('real', 'inside.txt'));
      expect(paths).not.toContain(join('inward', 'inside.txt'));
      // Following the escaping link would spell out, to somebody who may reach nothing but this
      // project, the names of files outside it.
      expect(paths).not.toContain(join('outward', 'secret.txt'));
      expect(listProjectFiles(root, 0, join(root, 'outward'))).toEqual([]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('walks a symlink loop once instead of once per level of depth budget', () => {
    mkdirSync(join(root, 'a'));
    writeFileSync(join(root, 'a', 'file.txt'), 'x');
    symlinkSync(root, join(root, 'a', 'loop'));
    const paths = listProjectFiles(root).map((node) => node.path);
    expect(paths).toContain(join('a', 'file.txt'));
    expect(paths).toContain(join('a', 'loop'));
    // The loop points back at a real path already walked, so it is listed and left alone.
    expect(paths.filter((path) => path.includes('loop/'))).toEqual([]);
  });
});
