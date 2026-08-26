// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PluginDb } from 'elowen/plugin-api';
import { OneDriveStore } from '../plugins/onedrive/src/store.js';
import { SyncEngine, conflictName, remoteRootFor, safeSegment } from '../plugins/onedrive/src/sync.js';
import { execFileSync } from 'node:child_process';
import { TRASH_DIR, gitIgnoredAmong, scanLocal } from '../plugins/onedrive/src/scan.js';
import { Drive } from '../plugins/onedrive/src/drive.js';

const originalListTree = Drive.prototype.listTree;
import type { MicrosoftDriveGraph } from '../plugins/onedrive/src/coreSeams.js';

const roots: string[] = [];

/** Write a file and back-date it out of the sync engine's settle window, which deliberately holds back
 *  anything touched in the last couple of seconds so a half-written file is never uploaded. */
function settled(path: string, body: string): void {
  writeFileSync(path, body);
  const old = new Date(Date.now() - 3_600_000);
  utimesSync(path, old, old);
}
afterEach(() => { while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true }); });

function pluginDb(): PluginDb {
  const raw = new Database(':memory:');
  raw.exec('CREATE TABLE plugin_migrations(version INTEGER PRIMARY KEY)');
  const handle = {
    exec: (sql: string) => raw.exec(sql),
    prepare: (sql: string) => {
      const statement = raw.prepare(sql);
      return {
        run: (...params: unknown[]) => statement.run(...params),
        get: (...params: unknown[]) => statement.get(...params),
        all: (...params: unknown[]) => statement.all(...params),
      };
    },
    migrate: (steps: { version: number; up(db: PluginDb): void }[]) => {
      for (const step of steps) {
        if (raw.prepare('SELECT 1 FROM plugin_migrations WHERE version=?').get(step.version)) continue;
        raw.transaction(() => {
          step.up(handle as unknown as PluginDb);
          raw.prepare('INSERT INTO plugin_migrations(version) VALUES (?)').run(step.version);
        })();
      }
    },
    appliedVersion: () => 1,
    transaction: <T>(fn: () => T) => raw.transaction(fn)(),
  };
  return handle as unknown as PluginDb;
}

/** A drive that lives in a Map, served the way Graph serves it: a folder LISTING, not a change feed.
 *  DELETE really removes the entry, so a test that claims nothing was deleted is actually testing that. */
function fakeDrive() {
  const files = new Map<string, { id: string; etag: string; body: Buffer }>();
  let counter = 0;
  /** Items that EXIST but are deliberately absent from the listing - what a file moved between folders
   *  mid-walk looks like from here. */
  const hidden = new Map<string, { id: string; etag: string; body: Buffer }>();
  const state: {
    lastDelete: { id: string; ifMatch?: string } | null;
    onDownload?: () => void;
    onList?: () => void;
  } = { lastDelete: null };

  const childrenOf = (folder: string) => {
    // The mirror root is addressed by item id; this fake collapses that to one folder holding flat paths.
    const prefix = 'Elowen/projects/demo/';
    const out: Record<string, unknown>[] = [];
    for (const [path, entry] of files) {
      if (!path.startsWith(prefix)) continue;
      const rel = path.slice(prefix.length);
      if (rel.includes('/')) continue;
      out.push({ id: entry.id, name: rel, eTag: entry.etag, size: entry.body.length, file: {} });
    }
    return { value: out };
  };

  const graph: MicrosoftDriveGraph = {
    json: vi.fn(async (method: string, path: string, options?: { body?: unknown }) => {
      if (path.startsWith('/me/drive')) return { id: 'drive-1' };
      const itemLookup = /\/items\/([^/?]+)(\?|$)/.exec(path);
      if (itemLookup && method === 'GET' && !path.includes('/children') && !path.endsWith('/content')) {
        const id = decodeURIComponent(itemLookup[1]!);
        if (id === 'folder-1') return { id: 'folder-1', webUrl: 'https://onedrive.example/folder' };
        const found = [...files.values(), ...hidden.values()].find((entry) => entry.id === id);
        if (!found) throw Object.assign(new Error('not found'), { status: 404 });
        return { id, eTag: found.etag };
      }
      if (path.includes('/children') && method === 'GET') {
        const page = childrenOf(path);
        // Lets a test change OneDrive AFTER the cycle has taken its listing - the window every
        // precondition exists to cover.
        state.onList?.();
        return page;
      }
      if (path.includes(':/content') && method === 'PUT') {
        // `?@microsoft.graph.conflictBehavior=fail` rides on the URL, so strip the query before decoding.
        const bare = path.split('?')[0]!;
        const remote = decodeURIComponent(bare.replace(/^.*\/root:\//, '').replace(/:\/content$/, ''));
        if (path.includes('conflictBehavior=fail') && files.has(remote)) {
          throw Object.assign(new Error('conflict'), { status: 409 });
        }
        counter += 1;
        const entry = { id: `id-${counter}`, etag: `etag-${counter}`, body: Buffer.from(String(options?.body ?? '')) };
        files.set(remote, entry);
        return { id: entry.id, eTag: entry.etag, name: remote.split('/').pop(), size: entry.body.length, parentReference: { path: '/drive/root:' } };
      }
      if (method === 'DELETE') {
        const id = decodeURIComponent(path.replace(/^.*\/items\//, ''));
        state.lastDelete = { id, ifMatch: options?.ifMatch };
        // Graph honours the precondition: a stale etag means somebody changed it since we looked.
        for (const [key, entry] of files) {
          if (entry.id !== id) continue;
          if (options?.ifMatch && options.ifMatch !== entry.etag) {
            throw Object.assign(new Error('precondition failed'), { status: 412 });
          }
          files.delete(key);
        }
        return null;
      }
      if (method === 'POST' && path.includes('/children')) return { id: 'folder-new' };
      return { id: 'folder-1', webUrl: 'https://onedrive.example/folder' };
    }),
    binary: vi.fn(async (path: string) => {
      const id = decodeURIComponent(path.replace(/^.*\/items\//, '').replace(/\/content$/, ''));
      const found = [...files.values()].find((entry) => entry.id === id);
      // Lets a test act in the window between reading the bytes and replacing the local file.
      state.onDownload?.();
      return { body: new Uint8Array(found?.body ?? Buffer.from('remote')), contentType: 'application/octet-stream' };
    }),
    request: vi.fn(async () => new Response(null, { status: 200 })),
  };

  /** Put a file into OneDrive as if somebody else did, so the next listing reports it. */
  const put = (rel: string, body: string, id = `remote-${++counter}`, etag = `etag-r${counter}`) => {
    files.set(`Elowen/projects/demo/${rel}`, { id, etag, body: Buffer.from(body) });
  };
  const drop = (rel: string) => { files.delete(`Elowen/projects/demo/${rel}`); };

  return {
    graph, files, hidden, put, drop,
    get lastDelete() { return state.lastDelete; },
    set onDownload(fn: (() => void) | undefined) { state.onDownload = fn; },
    get onDownload() { return state.onDownload; },
    set onList(fn: (() => void) | undefined) { state.onList = fn; },
    get onList() { return state.onList; },
  };
}

let settings = { rootFolder: 'Elowen', maxFileMb: 10, extraIgnore: '', applyRemoteDeletions: true };

function harness(options: { applyRemoteDeletions?: boolean; lease?: { ms: number; renewAfterMs: number } } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'onedrive-sync-'));
  roots.push(root);
  const store = new OneDriveStore(pluginDb());
  const drive = fakeDrive();
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  settings = {
    rootFolder: 'Elowen', maxFileMb: 10, extraIgnore: '',
    applyRemoteDeletions: options.applyRemoteDeletions !== false,
  };
  const engine = new SyncEngine({
    store,
    identity: () => ({ identityFor: () => ({ linked: true }), driveGraphFor: async () => drive.graph }),
    rootFor: () => root,
    settings: () => settings,
    ...(options.lease ? { lease: options.lease } : {}),
    log,
  });
  const link = store.createLink({
    userId: 7, projectId: 1, workspaceId: null, workspaceLabel: null,
    remoteDriveId: 'drive-1', remoteItemId: 'folder-1', remotePath: 'Elowen/projects/demo', webUrl: null,
  });
  return { root, store, drive, engine, link, log };
}

describe('onedrive remote layout', () => {
  it('keeps a workspace mirror beside the project mirror, never inside it', () => {
    const project = remoteRootFor('Elowen', 'site', { workspaceId: null, workspaceLabel: null } as never);
    const workspace = remoteRootFor('Elowen', 'site', { workspaceId: 'ws1', workspaceLabel: 'Feature A' } as never);
    expect(project).toBe('Elowen/projects/site');
    expect(workspace).toBe('Elowen/workspaces/site/Feature A (ws1)');
    // Nesting would make the project scan try to pull every workspace copy into the project directory.
    expect(workspace.startsWith(`${project}/`)).toBe(false);
  });

  it('gives two identically labelled workspaces different folders', () => {
    // Sandbox does not require labels to be unique. Two mirrors resolving to one folder would silently
    // overwrite and delete each other's files, so the folder carries the id the label cannot supply.
    const a = remoteRootFor('Elowen', 'site', { workspaceId: 'ws-aaa', workspaceLabel: 'Fix' } as never);
    const b = remoteRootFor('Elowen', 'site', { workspaceId: 'ws-bbb', workspaceLabel: 'Fix' } as never);
    expect(a).not.toBe(b);
    // And a label whose sanitized form collides still separates on the id.
    const slash = remoteRootFor('Elowen', 'site', { workspaceId: 'ws-ccc', workspaceLabel: 'feature/a' } as never);
    const colon = remoteRootFor('Elowen', 'site', { workspaceId: 'ws-ddd', workspaceLabel: 'feature:a' } as never);
    expect(slash).not.toBe(colon);
  });

  it('refuses characters OneDrive rejects, and a separator that would create a folder', () => {
    expect(safeSegment('a/b')).toBe('a-b');
    expect(safeSegment('what?:*')).toBe('what-');
    expect(safeSegment('')).toBe('workspace');
    expect(conflictName('docs/notes.md', new Date('2026-08-27T01:02:03Z')))
      .toBe('docs/notes.onedrive-conflict-2026-08-27-01-02-03.md');
  });
});

describe('onedrive and git ignore rules', () => {
  const repo = () => {
    const root = mkdtempSync(join(tmpdir(), 'onedrive-git-'));
    roots.push(root);
    execFileSync('git', ['-C', root, 'init', '-q']);
    return root;
  };

  it('asks git itself which vanished paths it decided to ignore', async () => {
    const root = repo();
    settled(join(root, 'kept.md'), 'kept\n');
    settled(join(root, 'noisy.log'), 'noise\n');
    const before = await gitIgnoredAmong(root, ['kept.md', 'noisy.log']);
    expect(before.ok).toBe(true);
    expect([...before.ignored]).toEqual([]);

    // A file added to .gitignore simply DISAPPEARS from `git ls-files`. Nothing in the scan can tell that
    // apart from a deletion, so without asking git the mirror would delete its OneDrive copy.
    settled(join(root, '.gitignore'), 'noisy.log\n');
    const after = await gitIgnoredAmong(root, ['kept.md', 'noisy.log']);
    expect(after.ok).toBe(true);
    expect([...after.ignored]).toEqual(['noisy.log']);
  });

  it('reports failure rather than an empty answer when git cannot say', async () => {
    const root = mkdtempSync(join(tmpdir(), 'onedrive-nogit-'));
    roots.push(root);
    // Not a repository at all: git cannot answer. An empty set would be read as "nothing is excused",
    // and every vanished path would then be deleted from OneDrive - so an empty set must NOT pass for an
    // answer. The caller checks `ok` and skips the cycle.
    const result = await gitIgnoredAmong(root, ['whatever.md']);
    expect(result.ok).toBe(false);
    expect([...result.ignored]).toEqual([]);
  });
});

describe('onedrive local scan completeness', () => {
  it('reports itself incomplete when the walk hits its cap', async () => {
    const root = mkdtempSync(join(tmpdir(), 'onedrive-scan-'));
    roots.push(root);
    for (let n = 0; n < 10; n += 1) settled(join(root, `f-${n}.txt`), `${n}\n`);

    // Not a repository, so the bounded walk decides the file set - and a walk that stopped at its cap has
    // NOT seen the project. Saying so is what stops the caller reading the files it never reached as
    // deleted and removing them from OneDrive.
    const capped = await scanLocal(root, { ignored: () => false, maxBytes: 1e9, settleMs: 0, now: Date.now(), maxFiles: 3 });
    expect(capped.complete).toBe(false);

    const full = await scanLocal(root, { ignored: () => false, maxBytes: 1e9, settleMs: 0, now: Date.now(), maxFiles: 100 });
    expect(full.complete).toBe(true);
    expect(full.files.size).toBe(10);
  });

  it('marks a file it could not stat as skipped rather than absent', async () => {
    const root = mkdtempSync(join(tmpdir(), 'onedrive-scan-'));
    roots.push(root);
    settled(join(root, 'real.txt'), 'x\n');
    symlinkSync('/nowhere/at/all', join(root, 'broken.txt'));

    const result = await scanLocal(root, { ignored: () => false, maxBytes: 1e9, settleMs: 0, now: Date.now(), maxFiles: 100 });
    // A symlink is never followed: mirroring its target would copy a file from outside the project.
    expect(result.skippedPaths.has('broken.txt')).toBe(true);
    expect(result.files.has('real.txt')).toBe(true);
  });
});

describe('onedrive sync cycle', () => {
  it('uploads what the project holds and records a baseline for it', async () => {
    const { root, store, drive, engine, link } = harness();
    settled(join(root, 'README.md'), '# hello\n');
    await engine.syncUser(7);

    expect([...drive.files.keys()]).toEqual(['Elowen/projects/demo/README.md']);
    expect(store.items(link.id).get('README.md')?.state).toBe('synced');
    expect(store.linkById(link.id)?.status).toBe('idle');
  });

  it('brings down a file somebody added in OneDrive', async () => {
    const { root, store, drive, engine, link } = harness();
    drive.put('from-phone.md', 'written on a phone\n');
    await engine.syncUser(7);
    expect(readFileSync(join(root, 'from-phone.md'), 'utf8')).toBe('written on a phone\n');
    expect(store.items(link.id).has('from-phone.md')).toBe(true);
  });

  it('never lets two workers run the same mirror at once', () => {
    const { store, link } = harness();
    expect(store.claim(link.id, 'worker-a', 60_000)).toBe(true);
    // A second worker - a forked runner, or the daemon after a reload - must be turned away by the ROW,
    // because a variable in one process cannot see the other one at all.
    expect(store.claim(link.id, 'worker-b', 60_000)).toBe(false);
    store.release(link.id, 'worker-a');
    expect(store.claim(link.id, 'worker-b', 60_000)).toBe(true);
  });

  it('lets an expired claim be taken over, so a killed worker does not wedge the mirror', () => {
    const { store, link } = harness();
    const now = Date.now();
    expect(store.claim(link.id, 'dead', 1_000, now)).toBe(true);
    expect(store.claim(link.id, 'alive', 1_000, now + 500)).toBe(false);
    expect(store.claim(link.id, 'alive', 1_000, now + 2_000)).toBe(true);
  });

  it('coalesces a manual sync into the cycle already running for that account', async () => {
    const { root, engine, drive } = harness();
    settled(join(root, 'a.txt'), 'a\n');
    // The interval and the "sync now" button both land here. Two passes over one drive would each read
    // the other's half-finished work as a change.
    const [first, second] = [engine.syncUser(7), engine.syncUser(7)];
    expect(first).toBe(second);
    await Promise.all([first, second]);
    expect(drive.files.size).toBe(1);
  });

  it('moves a remotely deleted file to the trash instead of unlinking it', async () => {
    const { root, store, drive, engine, link } = harness();
    settled(join(root, 'notes.md'), 'keep me\n');
    await engine.syncUser(7);
    expect(store.items(link.id).has('notes.md')).toBe(true);

    drive.drop('notes.md');
    await engine.syncUser(7);

    expect(existsSync(join(root, 'notes.md'))).toBe(false);
    const trashed = readdirSync(join(root, TRASH_DIR));
    expect(trashed).toHaveLength(1);
    // The content is intact, not merely "not deleted".
    expect(readFileSync(join(root, TRASH_DIR, trashed[0]!, 'notes.md'), 'utf8')).toBe('keep me\n');
    expect(store.items(link.id).has('notes.md')).toBe(false);
  });

  it('restores the local copy instead of trashing it when remote deletions are not applied', async () => {
    const { root, drive, engine } = harness({ applyRemoteDeletions: false });
    settled(join(root, 'notes.md'), 'keep me\n');
    await engine.syncUser(7);
    drive.drop('notes.md');

    await engine.syncUser(7);
    // Nothing was trashed and the file went back up: the setting converges rather than re-deciding forever.
    expect(existsSync(join(root, TRASH_DIR))).toBe(false);
    expect(existsSync(join(root, 'notes.md'))).toBe(true);
    expect(drive.files.has('Elowen/projects/demo/notes.md')).toBe(true);
  });

  it('deletes the OneDrive copy of a file genuinely removed from the project', async () => {
    const { root, store, drive, engine, link } = harness();
    settled(join(root, 'gone.md'), 'bye\n');
    await engine.syncUser(7);
    expect(drive.files.has('Elowen/projects/demo/gone.md')).toBe(true);

    rmSync(join(root, 'gone.md'));
    await engine.syncUser(7);
    // The fake really removes the entry, so this asserts the delete happened rather than that a counter
    // stayed the same.
    expect(drive.files.has('Elowen/projects/demo/gone.md')).toBe(false);
    expect(store.items(link.id).has('gone.md')).toBe(false);
  });

  it('does not read a skipped file as a deleted one', async () => {
    const { root, drive, engine } = harness();
    settled(join(root, 'doc.md'), 'v1\n');
    await engine.syncUser(7);
    expect(drive.files.has('Elowen/projects/demo/doc.md')).toBe(true);

    // Saved a moment ago, so the settle window holds it back. "Not looked at" must never mean "gone":
    // reading it as a deletion would remove the OneDrive copy of a file sitting right there on disk.
    writeFileSync(join(root, 'doc.md'), 'v2 just saved\n');
    await engine.syncUser(7);
    expect(drive.files.has('Elowen/projects/demo/doc.md')).toBe(true);
  });

  it('leaves a file larger than the limit alone on BOTH sides', async () => {
    const { root, drive, engine, store, link } = harness();
    drive.files.set('Elowen/projects/demo/big.bin', { id: 'big', etag: 'e', body: Buffer.alloc(20 * 1024 * 1024) });
    await engine.syncUser(7);
    // Downloading it would create a local file the next scan skips, which the cycle after that would read
    // as a deletion - the advertised limit would become a way to lose the file.
    expect(existsSync(join(root, 'big.bin'))).toBe(false);
    expect(drive.files.has('Elowen/projects/demo/big.bin')).toBe(true);
    expect(store.items(link.id).has('big.bin')).toBe(false);
  });

  it('keeps both copies when the two sides moved independently, and then freezes', async () => {
    const { root, store, drive, engine, link } = harness();
    settled(join(root, 'plan.md'), 'local first\n');
    await engine.syncUser(7);

    settled(join(root, 'plan.md'), 'local edit\n');
    drive.put('plan.md', 'remote edit\n', 'id-remote', 'etag-remote');
    await engine.syncUser(7);

    expect(readFileSync(join(root, 'plan.md'), 'utf8')).toBe('local edit\n');
    const copies = readdirSync(root).filter((name) => name.includes('onedrive-conflict'));
    expect(copies).toHaveLength(1);
    expect(readFileSync(join(root, copies[0]!), 'utf8')).toBe('remote edit\n');
    expect(store.items(link.id).get('plan.md')?.state).toBe('conflict');

    // A conflict never turns back into a plain download - that would overwrite the local side it exists
    // to protect. But it must not freeze SOLID either: resolving compares against the version the
    // conflict was recorded for, so if OneDrive moves on again and nothing refreshes it, that path can
    // never be resolved at all. The newer remote version is kept beside the others instead.
    drive.put('plan.md', 'remote edit two\n', 'id-remote2', 'etag-remote2');
    await engine.syncUser(7);

    expect(readFileSync(join(root, 'plan.md'), 'utf8')).toBe('local edit\n');
    const kept = readdirSync(root).filter((name) => name.includes('onedrive-conflict')).sort();
    expect(kept).toHaveLength(2);
    // Both OneDrive versions survive; neither replaced the other.
    expect(kept.map((name) => readFileSync(join(root, name), 'utf8')).sort())
      .toEqual(['remote edit\n', 'remote edit two\n']);
    expect(store.items(link.id).get('plan.md')?.state).toBe('conflict');
    expect(store.linkById(link.id)?.conflictCount).toBe(1);
  });

  it('refuses to propagate a wholesale disappearance of local files', async () => {
    const { root, store, drive, engine, link } = harness();
    for (const name of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) settled(join(root, `${name}.txt`), `${name}\n`);
    await engine.syncUser(7);
    expect(store.items(link.id).size).toBe(8);
    const before = drive.files.size;

    // The project directory becomes unreadable - a mount that has not come back, a checkout mid-clone.
    // A scan reports what it can SEE, and believing "saw nothing" would delete the person's whole folder.
    for (const name of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) rmSync(join(root, `${name}.txt`));

    await engine.syncUser(7);

    expect(drive.files.size).toBe(before);
    const row = store.linkById(link.id)!;
    // `blocked` is a QUESTION, not a failure: the mirror worked correctly and stopped to ask. It is a
    // separate state so the UI can offer the answer instead of parsing an error string for intent.
    expect(row.status).toBe('blocked');
    expect(row.error).toMatch(/disappeared locally at once/);
  });

  it('carries out the deletions once their owner confirms them', async () => {
    const { root, store, drive, engine, link } = harness();
    for (const name of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) settled(join(root, `${name}.txt`), `${name}\n`);
    await engine.syncUser(7);
    for (const name of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) rmSync(join(root, `${name}.txt`));
    await engine.syncUser(7);
    expect(store.linkById(link.id)?.status).toBe('blocked');

    // Emptying a project on purpose is legitimate. The valve must be answerable, or it is just a mirror
    // that permanently stops working the first time somebody deletes a directory.
    await engine.syncUser(7, { confirmDeletions: new Set([link.id]) });
    expect(drive.files.size).toBe(0);
    expect(store.linkById(link.id)?.status).toBe('idle');
  });

  it('keeps a file that became ignored instead of deleting its OneDrive copy', async () => {
    const { root, store, drive, engine, link } = harness();
    settled(join(root, 'notes.md'), 'notes\n');
    settled(join(root, 'secret.env'), 'k=v\n');
    await engine.syncUser(7);
    expect(drive.files.has('Elowen/projects/demo/secret.env')).toBe(true);

    // Newly ignored is not deleted: the file is still on disk, just out of scope. Treating the two alike
    // would delete a file from OneDrive the moment somebody widened their ignore list.
    settings.extraIgnore = '*.env';
    await engine.syncUser(7);

    expect(existsSync(join(root, 'secret.env'))).toBe(true);
    expect(drive.files.has('Elowen/projects/demo/secret.env')).toBe(true);
    expect(store.items(link.id).has('secret.env')).toBe(false);
  });

  it('keeps both versions when the local file is saved during the download', async () => {
    const { root, store, drive, engine, link } = harness();
    settled(join(root, 'race.md'), 'original\n');
    await engine.syncUser(7);

    drive.put('race.md', 'from onedrive\n', 'id-remote', 'etag-remote');
    // The scan measured the file; somebody saves it again while the replacement is in flight. Overwriting
    // would destroy an edit that was never anywhere else.
    drive.onDownload = () => { settled(join(root, 'race.md'), 'saved while downloading\n'); };
    await engine.syncUser(7);
    drive.onDownload = undefined;

    expect(readFileSync(join(root, 'race.md'), 'utf8')).toBe('saved while downloading\n');
    expect(store.items(link.id).get('race.md')?.state).toBe('conflict');
    expect(readdirSync(root).filter((name) => name.includes('onedrive-conflict'))).toHaveLength(1);
  });

  it('adopts a file that is already identical on both sides instead of calling it a conflict', async () => {
    const { root, store, drive, engine, link } = harness();
    settled(join(root, 'same.md'), 'identical\n');
    await engine.syncUser(7);
    expect(store.items(link.id).get('same.md')?.state).toBe('synced');

    // Disconnecting drops the baseline, so on reconnect both sides have the file and nothing says they
    // agree. Without a content comparison every single file comes back as a conflict - safe, but it turns
    // reconnecting into a pile of busywork nobody asked for.
    store.clearItems(link.id);
    await engine.syncUser(7);

    expect(store.items(link.id).get('same.md')?.state).toBe('synced');
    expect(readdirSync(root).filter((name) => name.includes('onedrive-conflict'))).toHaveLength(0);
    expect(store.linkById(link.id)?.conflictCount).toBe(0);
  });

  it('still reports a conflict when the two sides only look alike', async () => {
    const { root, store, drive, engine, link } = harness();
    settled(join(root, 'same.md'), 'aaaaaaaa\n');
    await engine.syncUser(7);

    store.clearItems(link.id);
    // Same length, different content. Size agreeing is what makes the comparison worth doing, never what
    // decides the answer.
    drive.put('same.md', 'bbbbbbbb\n', 'id-other', 'etag-other');
    await engine.syncUser(7);

    expect(store.items(link.id).get('same.md')?.state).toBe('conflict');
    expect(readFileSync(join(root, 'same.md'), 'utf8')).toBe('aaaaaaaa\n');
    expect(readdirSync(root).filter((name) => name.includes('onedrive-conflict'))).toHaveLength(1);
  });

  it('checks the one path before trashing it, rather than trusting the whole listing', async () => {
    const { root, store, drive, engine, link } = harness();
    settled(join(root, 'moved.md'), 'still there\n');
    await engine.syncUser(7);
    const entry = drive.files.get('Elowen/projects/demo/moved.md')!;

    // A listing is a WALK, not a snapshot: a file moved between folders while it ran can be missing from
    // every page and still exist. Trashing the local copy on that basis loses a file nobody touched.
    drive.files.delete('Elowen/projects/demo/moved.md');
    drive.hidden.set(entry.id, entry);
    await engine.syncUser(7);

    expect(existsSync(join(root, 'moved.md'))).toBe(true);
    expect(existsSync(join(root, TRASH_DIR))).toBe(false);
    expect(store.items(link.id).has('moved.md')).toBe(true);
  });

  it('refuses the whole cycle when OneDrive returns a file with no version tag', async () => {
    const { root, store, drive, engine, link } = harness();
    settled(join(root, 'a.txt'), 'a\n');
    await engine.syncUser(7);
    const before = drive.files.size;

    // Every upload and delete is conditional on that tag. A file without one would silently turn the
    // precondition off and let this cycle clobber a change made since the listing.
    drive.files.get('Elowen/projects/demo/a.txt')!.etag = '';
    rmSync(join(root, 'a.txt'));
    await engine.syncUser(7);

    expect(drive.files.size).toBe(before);
    expect(store.linkById(link.id)?.status).toBe('error');
  });

  it('gives each trashed version its own folder even within the same second', async () => {
    const { root, drive, engine } = harness();
    settled(join(root, 'notes.md'), 'first\n');
    await engine.syncUser(7);
    drive.drop('notes.md');
    await engine.syncUser(7);

    settled(join(root, 'notes.md'), 'second\n');
    await engine.syncUser(7);
    drive.drop('notes.md');
    await engine.syncUser(7);

    // The trash exists so nothing is ever lost, so its own names must not collide with each other.
    const versions = readdirSync(join(root, TRASH_DIR))
      .map((dir) => readFileSync(join(root, TRASH_DIR, dir, 'notes.md'), 'utf8'))
      .sort();
    expect(versions).toEqual(['first\n', 'second\n']);
  });

  it('asks before deleting a large number of files even when the share looks small', async () => {
    const { root, store, drive, engine, link } = harness();
    for (let n = 0; n < 200; n += 1) settled(join(root, `f-${n}.txt`), `${n}\n`);
    await engine.syncUser(7);
    const before = drive.files.size;

    // 60 of 200 is 30% - under the ratio, and still sixty files. A big project is exactly where a share
    // hides a disaster, so the absolute count has to matter too.
    for (let n = 0; n < 60; n += 1) rmSync(join(root, `f-${n}.txt`));
    await engine.syncUser(7);

    expect(drive.files.size).toBe(before);
    expect(store.linkById(link.id)?.status).toBe('blocked');
  });

  it('will not let a confirmation cover more deletions than it was given for', async () => {
    const { root, store, drive, engine, link } = harness();
    for (const name of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) settled(join(root, `${name}.txt`), `${name}\n`);
    await engine.syncUser(7);
    for (const name of ['a', 'b', 'c', 'd']) rmSync(join(root, `${name}.txt`));
    await engine.syncUser(7);
    expect(store.linkById(link.id)?.status).toBe('blocked');
    const shown = store.linkById(link.id)!.blockedDeletions;
    expect(shown).toBe(4);

    // More files vanish between the person reading the message and pressing the button. That is a
    // different question from the one they answered, so it has to be asked again.
    for (const name of ['e', 'f', 'g']) rmSync(join(root, `${name}.txt`));
    await engine.syncUser(7, { confirmDeletions: new Set([link.id]) });

    expect(drive.files.size).toBe(8);
    expect(store.linkById(link.id)?.status).toBe('blocked');
    expect(store.linkById(link.id)?.blockedDeletions).toBe(7);
  });

  it('will not act on a confirmation that answers no refusal', async () => {
    const { root, store, drive, engine, link } = harness();
    for (const name of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) settled(join(root, `${name}.txt`), `${name}\n`);
    await engine.syncUser(7);
    expect(store.linkById(link.id)?.status).toBe('idle');

    for (const name of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) rmSync(join(root, `${name}.txt`));
    // A confirmation is an ANSWER. Arriving without a question - a stale button press, or one made while
    // a mount happened to be empty - it would otherwise carry authority to delete the whole mirror,
    // which is exactly the authority the valve exists to withhold.
    await engine.syncUser(7, { confirmDeletions: new Set([link.id]) });

    expect(drive.files.size).toBe(8);
    expect(store.linkById(link.id)?.status).toBe('blocked');
  });

  it('does not delete the OneDrive copy of a file that came back before the delete', async () => {
    const { root, store, drive, engine, link } = harness();
    settled(join(root, 'flaky.md'), 'v1\n');
    await engine.syncUser(7);

    rmSync(join(root, 'flaky.md'));
    // Recreated between the scan and the delete. The etag precondition cannot catch this - it guards the
    // REMOTE side, and it is the local side that changed - so the deletion needs its own last look.
    drive.onList = () => { settled(join(root, 'flaky.md'), 'back again\n'); drive.onList = undefined; };
    await engine.syncUser(7);

    expect(drive.files.has('Elowen/projects/demo/flaky.md')).toBe(true);
    expect(existsSync(join(root, 'flaky.md'))).toBe(true);
    expect(store.items(link.id).has('flaky.md')).toBe(true);
  });

  it('serialises two mirrors that share one project directory', async () => {
    const { root, store, engine, link } = harness();
    // A project can be SHARED: two people, two OneDrives, two links - one directory on disk. The
    // per-link claim cannot see that, so both cycles would write the same files and the last rename
    // would win, quietly overwriting the other person's version with no trash copy anywhere.
    // A DIFFERENT account, deliberately: cycles for one account are already sequential, so a same-account
    // pair would pass this test with the lock removed. Two accounts are what nothing else serialises.
    const second = store.createLink({
      userId: 8, projectId: 1, workspaceId: null, workspaceLabel: null,
      remoteDriveId: 'drive-1', remoteItemId: 'folder-1', remotePath: 'Elowen/projects/demo', webUrl: null,
    });
    settled(join(root, 'shared.md'), 'shared\n');

    let concurrent = 0;
    let peak = 0;
    const spy = vi.spyOn(Drive.prototype, 'listTree').mockImplementation(async function listTree(this: Drive, ...args) {
      concurrent += 1; peak = Math.max(peak, concurrent);
      await new Promise((resolve) => setTimeout(resolve, 30));
      concurrent -= 1;
      return originalListTree.apply(this, args as never);
    });
    await Promise.all([engine.syncUser(7), engine.syncUser(8)]);
    spy.mockRestore();

    expect(peak).toBe(1);
    expect(store.linkById(link.id)?.status).toBe('idle');
    expect(store.linkById(second.id)?.status).toBe('idle');
  });

  it('refuses to mirror two names that OneDrive would treat as one', async () => {
    const { root, drive, engine } = harness();
    // OneDrive matches case-insensitively; Linux does not. Mirroring both would upload them over each
    // other and then trash whichever lost, so neither is touched.
    settled(join(root, 'Readme.md'), 'upper\n');
    settled(join(root, 'readme.md'), 'lower\n');
    settled(join(root, 'other.md'), 'fine\n');
    await engine.syncUser(7);

    expect(readFileSync(join(root, 'Readme.md'), 'utf8')).toBe('upper\n');
    expect(readFileSync(join(root, 'readme.md'), 'utf8')).toBe('lower\n');
    expect([...drive.files.keys()]).toEqual(['Elowen/projects/demo/other.md']);
  });

  it('deletes conditionally, so an edit made in OneDrive since the listing survives', async () => {
    const { root, store, drive, engine, link } = harness();
    settled(join(root, 'doomed.md'), 'v1\n');
    await engine.syncUser(7);
    const entry = drive.files.get('Elowen/projects/demo/doomed.md')!;
    const seen = entry.etag;

    rmSync(join(root, 'doomed.md'));
    // Somebody edits it in OneDrive in the window between the listing and the delete. The local copy is
    // already gone, so an unconditional delete would destroy the only remaining copy of that edit.
    drive.onList = () => {
      entry.etag = 'etag-edited-since';
      entry.body = Buffer.from('edited elsewhere\n');
      drive.onList = undefined;
    };
    await engine.syncUser(7);

    expect(drive.lastDelete?.ifMatch).toBe(seen);
    expect(drive.files.has('Elowen/projects/demo/doomed.md')).toBe(true);
    // The precondition failing must not drop the baseline either: a forgotten file is invisible to every
    // later cycle, so recreating that path would overwrite it without anyone noticing.
    expect(store.items(link.id).has('doomed.md')).toBe(true);
  });

  it('lets a remote edit win over a local deletion instead of deleting it', async () => {
    const { root, drive, engine } = harness();
    settled(join(root, 'shared.md'), 'v1\n');
    await engine.syncUser(7);

    rmSync(join(root, 'shared.md'));
    // Deleted here, edited there. Content beats a stale deletion: the edit is the newer intention and
    // the only copy of that work, so it comes back rather than being erased.
    drive.put('shared.md', 'edited elsewhere\n', 'id-new', 'etag-new');
    await engine.syncUser(7);

    expect(drive.files.has('Elowen/projects/demo/shared.md')).toBe(true);
    expect(readFileSync(join(root, 'shared.md'), 'utf8')).toBe('edited elsewhere\n');
  });

  it('never overwrites a file that already carries the conflict name', () => {
    const taken = new Set(['plan.onedrive-conflict-2026-01-01-00-00-00.md']);
    const first = conflictName('plan.md', new Date('2026-01-01T00:00:00Z'), (c) => taken.has(c));
    // Second precision is not unique. A conflict copy that overwrites an earlier conflict copy destroys
    // exactly the thing conflict copies exist to preserve.
    expect(first).toBe('plan.onedrive-conflict-2026-01-01-00-00-00-2.md');
    expect(taken.has(first)).toBe(false);
  });

  it('stops applying as soon as another worker takes the mirror over', async () => {
    // Renewal is driven by ELAPSED TIME, because one large upload can outlast a lease on its own and a
    // counter of files cannot see that happening. Zero here means every file re-checks the claim.
    const { root, store, drive, engine, link } = harness({ lease: { ms: 60_000, renewAfterMs: 0 } });
    for (let n = 0; n < 10; n += 1) settled(join(root, `f-${n}.txt`), `${n}\n`);
    // Losing the claim means somebody else has re-decided this mirror. Anything this cycle still applied
    // would be built on a view that worker has already superseded - including overwriting a local edit it
    // has just preserved as a conflict.
    const spy = vi.spyOn(store, 'renew').mockReturnValue(false);
    await engine.syncUser(7);
    spy.mockRestore();
    expect(drive.files.size).toBe(0);
    expect(store.linkById(link.id)?.status).toBe('syncing');
  });

  it('still deletes a small number of genuinely removed files', async () => {
    const { root, drive, engine } = harness();
    for (const name of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) settled(join(root, `${name}.txt`), `${name}\n`);
    await engine.syncUser(7);
    // Two of eight is ordinary work, not a catastrophe: the valve must not make normal deletion impossible.
    rmSync(join(root, 'a.txt')); rmSync(join(root, 'b.txt'));
    await engine.syncUser(7);
    expect(drive.files.has('Elowen/projects/demo/a.txt')).toBe(false);
    expect(drive.files.has('Elowen/projects/demo/c.txt')).toBe(true);
  });

  it('refuses a truncated listing rather than treating the rest as deleted', async () => {
    const { root, store, engine, link, drive } = harness();
    settled(join(root, 'x.txt'), 'x\n');
    await engine.syncUser(7);
    const before = drive.files.size;

    const originalListTree = (await import('../plugins/onedrive/src/drive.js')).Drive.prototype.listTree;
    const spy = vi.spyOn((await import('../plugins/onedrive/src/drive.js')).Drive.prototype, 'listTree')
      .mockResolvedValue({ files: new Map(), truncated: true });
    await engine.syncUser(7);
    spy.mockRestore();
    expect(originalListTree).toBeTypeOf('function');

    expect(drive.files.size).toBe(before);
    expect(store.linkById(link.id)?.status).toBe('error');
  });

  it('stops applying a cycle whose mirror was disconnected while it ran', async () => {
    const { root, store, drive, engine, link } = harness();
    settled(join(root, 'late.md'), 'late\n');
    // Listing and hashing take time, and a person can disconnect while they run.
    const spy = vi.spyOn((await import('../plugins/onedrive/src/drive.js')).Drive.prototype, 'listTree')
      .mockImplementation(async () => { store.removeLink(link.id); return { files: new Map(), truncated: false }; });
    await engine.syncUser(7);
    spy.mockRestore();
    expect(drive.files.size).toBe(0);
    expect(store.linkById(link.id)).toBeNull();
  });

  it('pauses a mirror whose folder is gone instead of reporting it broken', async () => {
    const { store, link } = harness();
    const engine = new SyncEngine({
      store,
      identity: () => ({ identityFor: () => ({ linked: true }), driveGraphFor: async () => fakeDrive().graph }),
      rootFor: () => null,
      settings: () => ({ rootFolder: 'Elowen', maxFileMb: 10, extraIgnore: '', applyRemoteDeletions: true }),
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    await engine.syncUser(7);
    const row = store.linkById(link.id)!;
    expect(row.enabled).toBe(false);
    expect(row.status).toBe('paused');
  });

  it('reports an account that must sign in again without touching its files', async () => {
    const { store, link } = harness();
    const engine = new SyncEngine({
      store,
      identity: () => ({ identityFor: () => ({ linked: true }), driveGraphFor: async () => null }),
      rootFor: () => '/tmp',
      settings: () => ({ rootFolder: 'Elowen', maxFileMb: 10, extraIgnore: '', applyRemoteDeletions: true }),
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    await engine.syncUser(7);
    expect(store.linkById(link.id)?.status).toBe('error');
  });

  it('does nothing at all when no plugin owns the Microsoft identity', async () => {
    const { store, link } = harness();
    const engine = new SyncEngine({
      store,
      identity: () => undefined,
      rootFor: () => '/tmp',
      settings: () => ({ rootFolder: 'Elowen', maxFileMb: 10, extraIgnore: '', applyRemoteDeletions: true }),
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    await engine.tick();
    // Teams absent is a legitimate runtime state, not an error to report on every mirror.
    expect(store.linkById(link.id)?.status).toBe('idle');
  });

  it('leaves the remote folder alone when a mirror is disconnected', () => {
    const { store, link, drive } = harness();
    drive.put('keep.md', 'x');
    store.removeLink(link.id);
    expect(store.linkById(link.id)).toBeNull();
    // Disconnecting is an Elowen-side decision. Reaching into somebody's OneDrive and deleting their
    // files because they switched a mirror off would be the wrong kind of tidy.
    expect(drive.files.has('Elowen/projects/demo/keep.md')).toBe(true);
  });
});

describe('onedrive project and account removal', () => {
  it('drops every mirror of a removed project and account', () => {
    const { store } = harness();
    store.createLink({
      userId: 7, projectId: 9, workspaceId: null, workspaceLabel: null,
      remoteDriveId: 'd', remoteItemId: 'i', remotePath: 'Elowen/projects/other', webUrl: null,
    });
    expect(store.linksForUser(7)).toHaveLength(2);
    store.removeProject(9);
    expect(store.linksForUser(7)).toHaveLength(1);
    store.removeUser(7);
    expect(store.linksForUser(7)).toHaveLength(0);
  });
});
