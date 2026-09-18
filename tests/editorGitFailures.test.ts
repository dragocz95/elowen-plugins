// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProjectStore } from 'elowen/dist/store/projectStore.js';
import { EventBus } from 'elowen/dist/api/sse.js';
import { createServer } from 'elowen/dist/api/server.js';
import { FakeClock } from 'elowen/dist/shared/clock.js';
import { ConfigStore } from 'elowen/dist/store/configStore.js';
import { openDb } from 'elowen/dist/store/db.js';
import { loadPlugins } from 'elowen/dist/plugins/loader.js';
import { PluginRegistryProvider } from 'elowen/dist/plugins/pluginsProvider.js';
import { safeProjectPath } from 'elowen/dist/integrations/projectFiles.js';

// RBUG-02: a git invocation that fails for a real reason (a corrupt object, a locked index, a missing
// binary) must not read back the same as a clean tree. `files.ts` used to swallow every failure from
// `git status`, `git diff`, `git show` and `git log` alike and answer 200 with an empty result — this
// suite proves the seven git helpers now tell a real failure apart from "not a repository" (which stays
// a legitimate empty 200) and surface it as 503.
function makeApp() {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'elowen','/o')").run();
  const projects = new ProjectStore(db);
  const app = createServer({
    bus: new EventBus(), engine: null as any, spawn: null as any, tmux: null as any,
    project: { id: 1, path: '/o' }, fallback: { program: 'claude-code', model: 'sonnet' },
    clock: new FakeClock(0), config: new ConfigStore(db), projects,
    plugins: new PluginRegistryProvider(() => loadPlugins({
      dirs: [join(fileURLToPath(new URL('..', import.meta.url)), 'plugins')], enabled: ['editor'], logger: { info() {}, warn() {}, error() {} },
      host: { stores: { projects } as never, projectFiles: { safe: safeProjectPath } },
    })),
    pluginDirs: [join(fileURLToPath(new URL('..', import.meta.url)), 'plugins')],
  });
  return { app, projects };
}

/** Corrupts the repository's own HEAD commit object on disk — a failure `git` itself attests with
 *  "fatal: loose object ... is corrupt" (exit 128), never with "not a git repository". This is the real
 *  git binary hitting a real bad object, not a mocked failure. It breaks every command that has to walk
 *  a commit or tree object: `log`, `show HEAD:path`, `show <hash>` and `diff HEAD`. */
function corruptHeadObject(root: string): void {
  const hash = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const objectPath = join(root, '.git', 'objects', hash.slice(0, 2), hash.slice(2));
  chmodSync(objectPath, 0o644);
  writeFileSync(objectPath, 'not a zlib stream');
}

/** Corrupts the on-disk index — a real, unmocked "fatal: .git/index: index file smaller than expected"
 *  (exit 128). It breaks every command that reads the index directly: `status` and a working-tree diff
 *  against it (`diff -- path`, which never touches HEAD and survives `corruptHeadObject` untouched). */
function corruptIndex(root: string): void {
  const indexPath = join(root, '.git', 'index');
  chmodSync(indexPath, 0o644);
  writeFileSync(indexPath, 'not an index');
}

describe('editor git routes distinguish a real git failure from a clean/empty tree', () => {
  let sandbox: string;
  let root: string;
  let app: ReturnType<typeof makeApp>['app'];
  let id: number;

  beforeEach(async () => {
    sandbox = mkdtempSync(join(tmpdir(), 'elowen-git-failures-'));
    root = join(sandbox, 'root');
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'f.txt'), 'hi\n');
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'a@b.com'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'a'], { cwd: root });
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: root });
    const made = makeApp();
    app = made.app;
    id = (await (await app.request('/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: 'tmp', path: root }) })).json()).id;
  });
  afterEach(() => rmSync(sandbox, { recursive: true, force: true }));

  it('sanity: corrupting the HEAD object makes git itself fail with exit 128, not "not a repository"', () => {
    corruptHeadObject(root);
    let failed = false;
    try { execFileSync('git', ['-C', root, 'log', '-n1'], { stdio: 'pipe' }); }
    catch (error: any) {
      failed = true;
      expect(error.status).toBe(128);
      expect(String(error.stderr)).toContain('is corrupt');
      expect(String(error.stderr)).not.toMatch(/not a git repository/i);
    }
    expect(failed).toBe(true);
  });

  it('GET /changed answers 200 with an empty list for a project that is not a git repository at all', async () => {
    // No git init here — a fresh temp dir the beforeEach did not touch.
    const bareSandbox = mkdtempSync(join(tmpdir(), 'elowen-git-none-'));
    const bareRoot = join(bareSandbox, 'root');
    mkdirSync(bareRoot, { recursive: true });
    const bareId = (await (await app.request('/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: 'bare', path: bareRoot }) })).json()).id;
    const res = await app.request(`/projects/${bareId}/changed`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ changed: [] });
    rmSync(bareSandbox, { recursive: true, force: true });
  });

  it('GET /changed answers 503 (not 200 "clean") when git itself fails', async () => {
    corruptHeadObject(root);
    const res = await app.request(`/projects/${id}/changed`);
    expect(res.status).toBe(503);
    const body = await res.json() as { error: string };
    expect(body.error).toBeTruthy();
  });

  it('GET /changes (working diff) answers 503 on a real git failure', async () => {
    corruptHeadObject(root);
    const res = await app.request(`/projects/${id}/changes`);
    expect(res.status).toBe(503);
  });

  it('GET /commits answers 503 on a real git failure', async () => {
    corruptHeadObject(root);
    const res = await app.request(`/projects/${id}/commits`);
    expect(res.status).toBe(503);
  });

  it('GET /commit/:hash answers 503 on a real git failure', async () => {
    const hash = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    corruptHeadObject(root);
    const res = await app.request(`/projects/${id}/commit/${hash}`);
    expect(res.status).toBe(503);
  });

  it('GET /head (file at HEAD) answers 503 on a real git failure', async () => {
    corruptHeadObject(root);
    const res = await app.request(`/projects/${id}/head?path=${encodeURIComponent('f.txt')}`);
    expect(res.status).toBe(503);
  });

  it('GET /diff (working file diff) answers 503 on a real git failure', async () => {
    // `git diff -- path` compares the working tree to the INDEX and never touches HEAD, so it survives
    // a corrupt commit object untouched — it needs its own failure mode.
    corruptIndex(root);
    const res = await app.request(`/projects/${id}/diff?path=${encodeURIComponent('f.txt')}`);
    expect(res.status).toBe(503);
  });
});
