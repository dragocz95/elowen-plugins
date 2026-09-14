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
      request: vi.fn(),
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

  it('uses one sentinel entry without treating more than 20,000 visited paths as complete', async () => {
    const entries = Array.from({ length: 20_001 }, (_, index) => ({
      path: `/demo/f-${String(index).padStart(5, '0')}`,
      kind: 'file' as const,
      size: 1,
      mtime: 1,
    }));
    let returned = entries.slice(0, 20_000);
    const projectFiles = vi.fn(async ({ operation }: { operation: { kind: string; limit?: number } }) => {
      if (operation.kind !== 'walk') throw new Error(`unexpected ${operation.kind}`);
      if (operation.limit !== 20_001) throw new Error('invalid_limit: Invalid guest operation bound');
      return { kind: 'walk' as const, root: '/demo', rootKind: 'directory' as const, entries: returned, truncated: false };
    });
    const transport = new ManagedMirror({ projectFiles } as never, { kind: 'managed', projectId: 41 }, 7,
      { root: '/demo', generation: 9, state: 'running', workspaceId: null });

    const exact = await transport.walk({ limit: 20_000 });
    expect(exact.entries).toHaveLength(20_000);
    expect(exact.complete).toBe(true);

    returned = entries;
    const over = await transport.walk({ limit: 20_000 });
    expect(over.entries).toHaveLength(20_000);
    expect(over.complete).toBe(false);
  });

  it('pipes the managed launch request into Git before waiting for its result', async () => {
    const release = vi.fn();
    const sandbox = {
      prepareExecution: vi.fn(async () => ({
        mode: 'managed',
        projectRef: { kind: 'managed', projectId: 41 },
        cwd: process.cwd(),
        launch: {
          type: 'argv' as const,
          file: process.execPath,
          args: ['-e', `
            let input = '';
            const deadline = setTimeout(() => { process.stderr.write('missing stdin'); process.exit(9); }, 100);
            process.stdin.setEncoding('utf8');
            process.stdin.on('data', chunk => { input += chunk; });
            process.stdin.on('end', () => { clearTimeout(deadline); process.stdout.write(input); });
          `],
          env: process.env,
        },
        stdin: 'framed managed request',
        cancel: vi.fn(),
        lease: { release, heartbeat: vi.fn() },
        sanitizeOutput: (text: string) => text,
      })),
    } as never;
    const transport = new ManagedMirror(sandbox, { kind: 'managed', projectId: 41 }, 7,
      { root: '/demo', generation: 9, state: 'running', workspaceId: null });

    await expect(transport.git(['status'])).resolves.toEqual({
      stdout: 'framed managed request', stderr: '', code: 0,
    });
    expect(release).toHaveBeenCalledOnce();
  });

  it('cancels and releases a prepared Git command that does not settle', async () => {
    const cancel = vi.fn(async () => {});
    const release = vi.fn();
    const sandbox = {
      prepareExecution: vi.fn(async () => ({
        mode: 'managed',
        projectRef: { kind: 'managed', projectId: 41 },
        cwd: process.cwd(),
        launch: {
          type: 'argv' as const,
          file: process.execPath,
          args: ['-e', 'process.stdin.resume(); setInterval(() => {}, 1000)'],
          env: process.env,
        },
        stdin: 'framed managed request',
        cancel,
        lease: { release, heartbeat: vi.fn() },
        sanitizeOutput: (text: string) => text,
      })),
    } as never;
    const transport = new ManagedMirror(sandbox, { kind: 'managed', projectId: 41 }, 7,
      { root: '/demo', generation: 9, state: 'running', workspaceId: null }, '', null, 25);

    await expect(transport.git(['status'])).resolves.toMatchObject({ code: 1, stderr: 'Managed Git command timed out' });
    expect(cancel).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });
});
