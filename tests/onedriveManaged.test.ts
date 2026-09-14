// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { PluginDb } from 'elowen/plugin-api';
import { OneDriveStore } from '../plugins/onedrive/src/store.js';
import { SyncEngine } from '../plugins/onedrive/src/sync.js';
import { ManagedMirror } from '../plugins/onedrive/src/managed.js';

function pluginDb(): PluginDb {
  const raw = new Database(':memory:');
  const handle = {
    exec: (sql: string) => raw.exec(sql),
    prepare: (sql: string) => {
      const statement = raw.prepare(sql);
      return { run: (...params: unknown[]) => statement.run(...params), get: (...params: unknown[]) => statement.get(...params), all: (...params: unknown[]) => statement.all(...params) };
    },
    migrate: (steps: { version: number; up(db: PluginDb): void }[]) => { for (const step of steps) { step.up(handle as unknown as PluginDb); } },
    appliedVersion: () => 0,
    transaction: <T>(fn: () => T) => raw.transaction(fn)(),
  };
  return handle as unknown as PluginDb;
}

describe('OneDrive managed Project transport', () => {
  it('syncs a managed link without requesting or using a host project path', async () => {
    const store = new OneDriveStore(pluginDb());
    const link = store.createLink({ subpath: '', userId: 7, projectId: 41, workspaceId: null, workspaceLabel: null, remoteDriveId: 'drive-1', remoteItemId: 'folder-1', remotePath: 'Elowen/projects/demo', webUrl: null });
    const projectFiles = vi.fn(async ({ operation }: { operation: { kind: string } }) => {
      if (operation.kind === 'walk') return { kind: 'walk', root: '/demo', rootKind: 'directory', entries: [], truncated: false };
      throw new Error(`unexpected ${operation.kind}`);
    });
    const sandbox = {
      projectFiles,
      prepareExecution: vi.fn(async () => ({ mode: 'managed', cwd: '/demo', launch: { type: 'argv' as const, file: process.execPath, args: ['-e', ''], env: {} }, lease: { release: vi.fn() } })),
    } as never;
    const transport = new ManagedMirror(sandbox, { kind: 'managed', projectId: 41 }, 7, { root: '/demo', generation: 9, state: 'running', workspaceId: null });
    await transport.walk({ limit: 20 });
    const managed = {
      root: '/demo',
      lockKey: 'managed:41:project',
      walk: vi.fn(async () => ({ entries: [], complete: true })),
      git: vi.fn(async () => ({ stdout: '', stderr: '', code: 0 })),
    } as unknown as ManagedMirror;
    const graph = {
      json: vi.fn(async (method: string, path: string) => {
        if (path.startsWith('/me/drive')) return { id: 'drive-1' };
        if (method === 'GET' && path.includes('/children')) return { value: [] };
        if (method === 'GET' && path.includes('/items/folder-1')) return { id: 'folder-1' };
        return { id: 'folder-1' };
      }),
      binary: vi.fn(),
    };
    const rootFor = vi.fn(() => { throw new Error('host project path was requested'); });
    const engine = new SyncEngine({
      store,
      identity: () => ({ driveGraphFor: async () => graph, identityFor: () => ({ linked: true }) }),
      rootFor,
      baseFor: () => null,
      managedFor: async () => managed,
      settings: () => ({ rootFolder: 'Elowen', maxFileMb: 10, extraIgnore: [], applyRemoteDeletions: true }),
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await engine.syncUser(7);

    expect(rootFor).not.toHaveBeenCalled();
    expect(projectFiles).toHaveBeenCalledWith(expect.objectContaining({
      project: { kind: 'managed', projectId: 41 }, accountUserId: 7, expectedGeneration: 9, root: '/demo', startIfNeeded: false,
    }));
    expect(store.linkById(link.id)?.status).toBe('idle');
  });
});
