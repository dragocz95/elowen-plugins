// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PluginDb } from 'elowen/plugin-api';
import { OneDriveStore } from '../plugins/onedrive/src/store.js';
import { SyncEngine, conflictName, remoteRootFor, safeSegment } from '../plugins/onedrive/src/sync.js';
import { TRASH_DIR } from '../plugins/onedrive/src/scan.js';
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
      if (path.includes('/children') && method === 'GET') return childrenOf(path);
      if (path.endsWith('/content') && method === 'PUT') {
        const remote = decodeURIComponent(path.replace(/^.*\/root:\//, '').replace(/:\/content$/, ''));
        counter += 1;
        const entry = { id: `id-${counter}`, etag: `etag-${counter}`, body: Buffer.from(String(options?.body ?? '')) };
        files.set(remote, entry);
        return { id: entry.id, eTag: entry.etag, name: remote.split('/').pop(), size: entry.body.length, parentReference: { path: '/drive/root:' } };
      }
      if (method === 'DELETE') {
        const id = decodeURIComponent(path.replace(/^.*\/items\//, ''));
        for (const [key, entry] of files) if (entry.id === id) files.delete(key);
        return null;
      }
      if (method === 'POST' && path.includes('/children')) return { id: 'folder-new' };
      return { id: 'folder-1', webUrl: 'https://onedrive.example/folder' };
    }),
    binary: vi.fn(async (path: string) => {
      const id = decodeURIComponent(path.replace(/^.*\/items\//, '').replace(/\/content$/, ''));
      const found = [...files.values()].find((entry) => entry.id === id);
      return { body: new Uint8Array(found?.body ?? Buffer.from('remote')), contentType: 'application/octet-stream' };
    }),
    request: vi.fn(async () => new Response(null, { status: 200 })),
  };

  /** Put a file into OneDrive as if somebody else did, so the next listing reports it. */
  const put = (rel: string, body: string, id = `remote-${++counter}`, etag = `etag-r${counter}`) => {
    files.set(`Elowen/projects/demo/${rel}`, { id, etag, body: Buffer.from(body) });
  };
  const drop = (rel: string) => { files.delete(`Elowen/projects/demo/${rel}`); };

  return { graph, files, put, drop };
}

function harness(options: { applyRemoteDeletions?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'onedrive-sync-'));
  roots.push(root);
  const store = new OneDriveStore(pluginDb());
  const drive = fakeDrive();
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const engine = new SyncEngine({
    store,
    identity: () => ({ identityFor: () => ({ linked: true }), driveGraphFor: async () => drive.graph }),
    rootFor: () => root,
    settings: () => ({
      rootFolder: 'Elowen', maxFileMb: 10, extraIgnore: '',
      applyRemoteDeletions: options.applyRemoteDeletions !== false,
    }),
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

    // A conflict must stay FROZEN until a person resolves it. If OneDrive changes again, re-deciding
    // would turn it into a plain download and overwrite the local side the conflict was protecting.
    drive.put('plan.md', 'remote edit two\n', 'id-remote2', 'etag-remote2');
    await engine.syncUser(7);
    expect(readFileSync(join(root, 'plan.md'), 'utf8')).toBe('local edit\n');
    expect(readdirSync(root).filter((name) => name.includes('onedrive-conflict'))).toHaveLength(1);
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
    expect(row.status).toBe('error');
    expect(row.error).toMatch(/disappeared locally at once/);
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
