// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { PluginDb } from 'elowen/plugin-api';
import { OneDriveStore } from '../plugins/onedrive/src/store.js';
import { SyncEngine } from '../plugins/onedrive/src/sync.js';
import { testSession } from './helpers/managedSession.js';
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
  it('re-reads a managed file only when the walk says it changed', async () => {
    const store = new OneDriveStore(pluginDb());
    const link = store.createLink({ subpath: '', userId: 7, projectId: 41, workspaceId: null, workspaceLabel: null, remoteDriveId: 'drive-1', remoteItemId: 'folder-1', remotePath: 'Elowen/projects/demo', webUrl: null });
    store.putItem({ linkId: link.id, rel: 'README.md', localSize: 12, localMtimeMs: 1_000, localSha256: 'sha-readme', remoteItemId: 'item-1', remoteEtag: 'tag-1', state: 'synced', conflictCopy: null });
    let mtimeMs = 1_000;
    const hash = vi.fn(async () => ({ sha256: 'sha-readme', size: 12, version: 'v1' }));
    const managed = {
      root: '/demo',
      lockKey: 'managed:41:project',
      walk: vi.fn(async () => ({ entries: [{ rel: 'README.md', path: '/demo/README.md', kind: 'file' as const, size: 12, mtimeMs }], complete: true })),
      git: vi.fn(async () => ({ stdout: 'README.md\0', stderr: '', code: 0 })),
      hash,
    } as unknown as ManagedMirror;
    const graph = {
      json: vi.fn(async (method: string, path: string) => {
        if (path.startsWith('/me/drive')) return { id: 'drive-1' };
        if (method === 'GET' && path.includes('/children')) {
          return { value: [{ id: 'item-1', name: 'README.md', eTag: 'tag-1', size: 12, file: {} }] };
        }
        return { id: 'folder-1' };
      }),
      binary: vi.fn(),
      request: vi.fn(),
    };
    const engine = new SyncEngine({
      store,
      identity: () => ({ driveGraphFor: async () => graph, identityFor: () => ({ linked: true }) }),
      rootFor: () => null,
      baseFor: () => null,
      managedFor: async () => managed,
      settings: () => ({ rootFolder: 'Elowen', maxFileMb: 10, extraIgnore: [], applyRemoteDeletions: true }),
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    // An idle mirror: the guest already answered size and mtime, and the baseline holds the hash those
    // two values were recorded for. Reading the file back out of the container adds nothing.
    await engine.syncUser(7);
    expect(hash).not.toHaveBeenCalled();
    expect(store.linkById(link.id)?.status).toBe('idle');

    // A file the walk reports as touched is read again, because now the baseline cannot answer for it.
    mtimeMs = 2_000;
    await engine.syncUser(7);
    expect(hash).toHaveBeenCalledTimes(1);
    expect(store.linkById(link.id)?.status).toBe('idle');
  });

  it('waits out an environment that is busy with lifecycle work instead of asking every cycle', async () => {
    const store = new OneDriveStore(pluginDb());
    const link = store.createLink({ subpath: '', userId: 7, projectId: 41, workspaceId: null, workspaceLabel: null, remoteDriveId: 'drive-1', remoteItemId: 'folder-1', remotePath: 'Elowen/projects/demo', webUrl: null });
    const managedFor = vi.fn(async () => {
      throw Object.assign(new Error('Environment lifecycle work is pending; retry after the operation completes'), { code: 'environment_pending', status: 503 });
    });
    const graph = {
      json: vi.fn(async (_method: string, path: string) => (path.startsWith('/me/drive') ? { id: 'drive-1' } : { id: 'folder-1' })),
      binary: vi.fn(),
      request: vi.fn(),
    };
    const engine = new SyncEngine({
      store,
      identity: () => ({ driveGraphFor: async () => graph, identityFor: () => ({ linked: true }) }),
      rootFor: () => null,
      baseFor: () => null,
      managedFor: managedFor as never,
      settings: () => ({ rootFolder: 'Elowen', maxFileMb: 10, extraIgnore: [], applyRemoteDeletions: true }),
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await engine.syncUser(7);
    await engine.syncUser(7);
    expect(managedFor).toHaveBeenCalledTimes(1);
    // A busy environment is not a broken mirror, so nothing is reported as an error.
    expect(store.linkById(link.id)?.status).toBe('idle');

    // "Sync now" names the mirror explicitly and is never held back by the backoff.
    await engine.syncUser(7, { only: new Set([link.id]) });
    expect(managedFor).toHaveBeenCalledTimes(2);
  });

  it('syncs a managed link without requesting or using a host project path', async () => {
    const store = new OneDriveStore(pluginDb());
    const link = store.createLink({ subpath: '', userId: 7, projectId: 41, workspaceId: null, workspaceLabel: null, remoteDriveId: 'drive-1', remoteItemId: 'folder-1', remotePath: 'Elowen/projects/demo', webUrl: null });
    const projectFiles = vi.fn(async ({ operation }: { operation: { kind: string } }) => {
      if (operation.kind === 'walk') return { kind: 'walk', root: '/demo', rootKind: 'directory', entries: [], truncated: false };
      throw new Error(`unexpected ${operation.kind}`);
    });
    const sandbox = {
      projectFiles,
      prepareExecution: vi.fn(async () => ({ mode: 'managed', cwd: '/demo', ...testSession(process.execPath, ['-e', '']), lease: { release: vi.fn() } })),
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
      project: { kind: 'managed', projectId: 41 }, accountUserId: 7, expectedGeneration: 9, startIfNeeded: false,
    }));
    // No root travels with the request: the runtime resolves an operation's namespace from its entry
    // point and overwrites anything a caller names, so sending one only looked like confinement control.
    for (const [input] of projectFiles.mock.calls) {
      expect(input).not.toHaveProperty('root');
      expect(input.operation).not.toHaveProperty('root');
    }
    expect(store.linkById(link.id)?.status).toBe('idle');
  });

  it('does not delete a vanished file from OneDrive when the ignore check never reached a verdict', async () => {
    const store = new OneDriveStore(pluginDb());
    const link = store.createLink({ subpath: '', userId: 7, projectId: 41, workspaceId: null, workspaceLabel: null, remoteDriveId: 'drive-1', remoteItemId: 'folder-1', remotePath: 'Elowen/projects/demo', webUrl: null });
    store.putItem({ linkId: link.id, rel: 'secret.env', localSize: 4, localMtimeMs: 1_000, localSha256: 'sha-env', remoteItemId: 'item-1', remoteEtag: 'tag-1', state: 'synced', conflictCopy: null });
    // `ls-files` answers, so the scan IS a git inventory and `secret.env` is simply no longer in it.
    // Whether that means deleted or newly ignored is exactly what check-ignore is asked — and under the
    // managed contract that command can end with no exit status at all: a cancelled guest process, an
    // environment stopped mid-cycle, a lost privileged transport. `git check-ignore` says "not ignored"
    // with exactly 1, so a null code must never be allowed to read as one.
    const git = vi.fn(async (args: readonly string[]) => (args[0] === 'check-ignore'
      ? { stdout: '', stderr: 'Managed Git command timed out', code: null }
      : { stdout: '', stderr: '', code: 0 }));
    const managed = {
      root: '/demo',
      lockKey: 'managed:41:project',
      walk: vi.fn(async () => ({ entries: [], complete: true })),
      git,
      stat: vi.fn(async () => null),
    } as unknown as ManagedMirror;
    const graph = {
      json: vi.fn(async (method: string, path: string) => {
        if (path.startsWith('/me/drive')) return { id: 'drive-1' };
        if (method === 'GET' && path.includes('/children')) {
          return { value: [{ id: 'item-1', name: 'secret.env', eTag: 'tag-1', size: 4, file: {} }] };
        }
        return { id: 'folder-1' };
      }),
      binary: vi.fn(),
      request: vi.fn(),
    };
    const engine = new SyncEngine({
      store,
      identity: () => ({ driveGraphFor: async () => graph, identityFor: () => ({ linked: true }) }),
      rootFor: () => null,
      baseFor: () => null,
      managedFor: async () => managed,
      settings: () => ({ rootFolder: 'Elowen', maxFileMb: 10, extraIgnore: [], applyRemoteDeletions: true }),
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await engine.syncUser(7);

    expect(git).toHaveBeenCalledWith(['check-ignore', '--no-index', '--', 'secret.env']);
    // The person's OneDrive copy is untouched and the baseline still remembers it, so the next healthy
    // cycle can still tell deleted from ignored.
    expect(graph.json.mock.calls.filter(([method]) => method === 'DELETE')).toEqual([]);
    expect(store.items(link.id).get('secret.env')?.remoteItemId).toBe('item-1');
    expect(store.linkById(link.id)?.status).toBe('error');
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
        ...testSession(process.execPath, ['-e', `
            let input = '';
            const deadline = setTimeout(() => { process.stderr.write('missing stdin'); process.exit(9); }, 100);
            process.stdin.setEncoding('utf8');
            process.stdin.on('data', chunk => { input += chunk; });
            process.stdin.on('end', () => { clearTimeout(deadline); process.stdout.write(input); });
          `], process.cwd(), 'provider prefix'),
        lease: { release, heartbeat: vi.fn() },
        sanitizeOutput: (text: string) => text,
      })),
    } as never;
    const transport = new ManagedMirror(sandbox, { kind: 'managed', projectId: 41 }, 7,
      { root: '/demo', generation: 9, state: 'running', workspaceId: null });

    await expect(transport.git(['status'])).resolves.toEqual({
      stdout: 'provider prefix', stderr: '', code: 0,
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
        ...testSession(process.execPath, ['-e', 'process.stdin.resume(); setInterval(() => {}, 1000)'], process.cwd(), undefined, cancel),
        lease: { release, heartbeat: vi.fn() },
        sanitizeOutput: (text: string) => text,
      })),
    } as never;
    const transport = new ManagedMirror(sandbox, { kind: 'managed', projectId: 41 }, 7,
      { root: '/demo', generation: 9, state: 'running', workspaceId: null }, '', null, 25);

    // A null code, never 1: an interrupted command produced no exit status, and 1 is a meaningful Git
    // answer that a caller such as `check-ignore` acts on.
    await expect(transport.git(['status'])).resolves.toMatchObject({ code: null, stderr: 'Managed Git command timed out' });
    expect(cancel).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });
});
