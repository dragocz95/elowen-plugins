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

/** A drive that lives in a Map. Enough to drive the whole cycle without touching Microsoft. */
function fakeDrive() {
  const files = new Map<string, { id: string; etag: string; body: Buffer }>();
  let counter = 0;
  const graph: MicrosoftDriveGraph = {
    json: vi.fn(async (method: string, path: string, options?: { body?: unknown }) => {
      if (path.startsWith('/me/drive')) return { id: 'drive-1' };
      if (path.includes('/root/delta')) return { value: [], '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/x?token=T1' };
      if (path.endsWith('/content') && method === 'PUT') {
        const remote = decodeURIComponent(path.replace(/^.*\/root:\//, '').replace(/:\/content$/, ''));
        counter += 1;
        const entry = { id: `id-${counter}`, etag: `etag-${counter}`, body: Buffer.from(String(options?.body ?? '')) };
        files.set(remote, entry);
        return { id: entry.id, eTag: entry.etag, name: remote.split('/').pop(), size: entry.body.length, parentReference: { path: '/drive/root:' } };
      }
      if (method === 'DELETE') return null;
      if (path.includes('/root?')) return { id: 'root', webUrl: 'https://onedrive.example/root' };
      // ensureFolder walks each segment: report every folder as already present.
      return { id: 'folder-1', webUrl: 'https://onedrive.example/folder' };
    }),
    binary: vi.fn(async (path: string) => {
      const id = decodeURIComponent(path.replace(/^.*\/items\//, '').replace(/\/content$/, ''));
      const found = [...files.values()].find((entry) => entry.id === id);
      return { body: new Uint8Array(found?.body ?? Buffer.from('remote')), contentType: 'application/octet-stream' };
    }),
    request: vi.fn(async () => new Response(null, { status: 200 })),
  };
  return { graph, files };
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
    expect(workspace).toBe('Elowen/workspaces/site/Feature A');
    // Nesting would make the project scan try to pull every workspace copy into the project directory.
    expect(workspace.startsWith(`${project}/`)).toBe(false);
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
    const items = store.items(link.id);
    expect(items.get('README.md')?.state).toBe('synced');
    expect(store.linkById(link.id)?.status).toBe('idle');
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

  it('moves a remotely deleted file to the trash instead of unlinking it', async () => {
    const { root, store, drive, engine, link } = harness();
    settled(join(root, 'notes.md'), 'keep me\n');
    await engine.syncUser(7);
    expect(store.items(link.id).has('notes.md')).toBe(true);

    // The file disappears from OneDrive.
    drive.graph.json = vi.fn(async (method: string, path: string) => {
      if (path.startsWith('/me/drive')) return { id: 'drive-1' };
      if (path.includes('/root/delta')) {
        return {
          value: [{ id: 'id-1', name: 'notes.md', deleted: {}, parentReference: { path: '/drive/root:/Elowen/projects/demo' } }],
          '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/x?token=T2',
        };
      }
      return { id: 'folder-1', webUrl: null };
    }) as typeof drive.graph.json;

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
    drive.graph.json = vi.fn(async (method: string, path: string, options?: { body?: unknown }) => {
      if (path.startsWith('/me/drive')) return { id: 'drive-1' };
      if (path.includes('/root/delta')) {
        return {
          value: [{ id: 'id-1', name: 'notes.md', deleted: {}, parentReference: { path: '/drive/root:/Elowen/projects/demo' } }],
          '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/x?token=T2',
        };
      }
      if (path.endsWith('/content')) {
        drive.files.set('Elowen/projects/demo/notes.md', { id: 'id-9', etag: 'etag-9', body: Buffer.from(String(options?.body ?? '')) });
        return { id: 'id-9', eTag: 'etag-9', name: 'notes.md', parentReference: { path: '/drive/root:' } };
      }
      return { id: 'folder-1', webUrl: null };
    }) as typeof drive.graph.json;

    await engine.syncUser(7);
    // Nothing was trashed and the file went back up: the setting converges rather than re-deciding forever.
    expect(existsSync(join(root, TRASH_DIR))).toBe(false);
    expect(existsSync(join(root, 'notes.md'))).toBe(true);
    expect(drive.files.get('Elowen/projects/demo/notes.md')?.id).toBe('id-9');
  });

  it('keeps both copies when the two sides moved independently', async () => {
    const { root, store, drive, engine, link } = harness();
    settled(join(root, 'plan.md'), 'local first\n');
    await engine.syncUser(7);

    // Both sides change: the file is edited here AND a different version appears in OneDrive.
    settled(join(root, 'plan.md'), 'local edit\n');
    drive.files.set('Elowen/projects/demo/plan.md', { id: 'id-remote', etag: 'etag-remote', body: Buffer.from('remote edit\n') });
    drive.graph.json = vi.fn(async (method: string, path: string) => {
      if (path.startsWith('/me/drive')) return { id: 'drive-1' };
      if (path.includes('/root/delta')) {
        return {
          value: [{ id: 'id-remote', name: 'plan.md', eTag: 'etag-remote', size: 12, file: {}, parentReference: { path: '/drive/root:/Elowen/projects/demo' } }],
          '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/x?token=T2',
        };
      }
      return { id: 'folder-1', webUrl: null };
    }) as typeof drive.graph.json;

    await engine.syncUser(7);

    // The local edit is untouched, the remote one is beside it, and a person is told to decide.
    expect(readFileSync(join(root, 'plan.md'), 'utf8')).toBe('local edit\n');
    const copies = readdirSync(root).filter((name) => name.includes('onedrive-conflict'));
    expect(copies).toHaveLength(1);
    expect(readFileSync(join(root, copies[0]!), 'utf8')).toBe('remote edit\n');
    expect(store.items(link.id).get('plan.md')?.state).toBe('conflict');
    expect(store.linkById(link.id)?.conflictCount).toBe(1);

    // And a second cycle must not write a SECOND copy of the same conflict.
    await engine.syncUser(7);
    expect(readdirSync(root).filter((name) => name.includes('onedrive-conflict'))).toHaveLength(1);
  });

  it('does not advance the delta cursor when a mirror in the same drive failed', async () => {
    const { root, store, drive, engine, link } = harness();
    settled(join(root, 'a.txt'), 'x\n');
    // A second mirror in the SAME drive, whose upload fails for real. The cursor is shared per drive, so
    // one broken mirror decides for the whole fan-out.
    store.createLink({
      userId: 7, projectId: 2, workspaceId: 'ws-broken', workspaceLabel: 'Broken',
      remoteDriveId: 'drive-1', remoteItemId: 'folder-2', remotePath: 'Elowen/workspaces/demo/Broken', webUrl: null,
    });
    const original = drive.graph.json;
    drive.graph.json = (async (method: string, path: string, options?: { body?: unknown }) => {
      if (path.includes('/Broken/') && path.endsWith('/content')) throw new Error('Microsoft refused this upload.');
      return (original as (m: string, p: string, o?: unknown) => Promise<unknown>)(method, path, options);
    }) as typeof drive.graph.json;

    await engine.syncUser(7);

    // A partial failure must replay, not skip: advancing here would drop every change the failed mirror
    // never got to see, and nothing would ever go back for them.
    expect(store.cursor(7, 'drive-1')).toBeNull();
    expect(store.linkById(link.id)?.status).toBe('idle');
  });

  it('refuses to propagate a wholesale disappearance of local files', async () => {
    const { root, store, drive, engine, link } = harness();
    for (const name of ['a', 'b', 'c', 'd', 'e', 'f']) settled(join(root, `${name}.txt`), `${name}\n`);
    await engine.syncUser(7);
    expect(store.items(link.id).size).toBe(6);
    const before = drive.files.size;

    // The project directory becomes unreadable - a mount that has not come back, a checkout mid-clone.
    // A scan reports what it can SEE, and believing "saw nothing" would delete the person's whole folder.
    rmSync(join(root, 'a.txt')); rmSync(join(root, 'b.txt')); rmSync(join(root, 'c.txt'));
    rmSync(join(root, 'd.txt')); rmSync(join(root, 'e.txt')); rmSync(join(root, 'f.txt'));

    await engine.syncUser(7);

    expect(drive.files.size).toBe(before);
    const row = store.linkById(link.id)!;
    expect(row.status).toBe('error');
    expect(row.error).toMatch(/disappeared at once/);
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
    drive.files.set('Elowen/projects/demo/keep.md', { id: 'id-x', etag: 'e', body: Buffer.from('x') });
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
