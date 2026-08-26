// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PluginDb } from 'elowen/plugin-api';

/** The scan module is replaced WHOLESALE for this file, which is why it is a file of its own: the cycle
 *  imports `scanLocal` as a binding, so a spy on the namespace never reaches it and the test passes while
 *  proving nothing. Everything else keeps its real behaviour. */
vi.mock('../plugins/onedrive/src/scan.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../plugins/onedrive/src/scan.js')>();
  return {
    ...actual,
    scanLocal: vi.fn(async (root: string, options) => ({
      ...await actual.scanLocal(root, options),
      complete: false,
    })),
  };
});

const { OneDriveStore } = await import('../plugins/onedrive/src/store.js');
const { SyncEngine } = await import('../plugins/onedrive/src/sync.js');

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

describe('a local scan that admits it saw only part of the project', () => {
  it('stops the cycle instead of deleting whatever it did not reach', async () => {
    const root = mkdtempSync(join(tmpdir(), 'onedrive-partial-'));
    try {
      writeFileSync(join(root, 'kept.txt'), 'kept\n');
      const old = new Date(Date.now() - 3_600_000);
      utimesSync(join(root, 'kept.txt'), old, old);

      const store = new OneDriveStore(pluginDb());
      const link = store.createLink({
        userId: 7, projectId: 1, workspaceId: null, workspaceLabel: null,
        remoteDriveId: 'drive-1', remoteItemId: 'folder-1', remotePath: 'Elowen/projects/demo', webUrl: null,
      });
      // Baseline says two files were mirrored. The scan can only see one and knows it is incomplete, so
      // the missing one must NOT be read as deleted.
      for (const rel of ['kept.txt', 'unreachable.txt']) {
        store.putItem({
          linkId: link.id, rel, localSize: 6, localMtimeMs: 1, localSha256: 'x',
          remoteItemId: `item-${rel}`, remoteEtag: 'e', state: 'synced', conflictCopy: null,
        });
      }

      const json = vi.fn(async (_m: string, path: string) => {
        if (path.startsWith('/me/drive')) return { id: 'drive-1' };
        if (path.includes('/children')) return { value: [] };
        return { id: 'folder-1' };
      });
      const engine = new SyncEngine({
        store,
        identity: () => ({
          identityFor: () => ({ linked: true }),
          driveGraphFor: async () => ({ json, binary: vi.fn(), request: vi.fn() }),
        }) as never,
        rootFor: () => root,
        settings: () => ({ rootFolder: 'Elowen', maxFileMb: 10, extraIgnore: '', applyRemoteDeletions: true }),
        log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      });

      await engine.syncUser(7);

      // Nothing was deleted and nothing was uploaded: an incomplete view is not acted on at all.
      expect(json.mock.calls.some(([method]) => method === 'DELETE')).toBe(false);
      expect(json.mock.calls.some(([method]) => method === 'PUT')).toBe(false);
      expect(store.items(link.id).size).toBe(2);
      expect(store.linkById(link.id)?.status).toBe('error');
      expect(store.linkById(link.id)?.error).toMatch(/could not be read/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
