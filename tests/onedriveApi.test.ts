// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { PluginDb } from 'elowen/plugin-api';
import { OneDriveStore } from '../plugins/onedrive/src/store.js';
import { registerApi } from '../plugins/onedrive/src/api.js';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function pluginDb(): PluginDb {
  const raw = new Database(':memory:');
  const migrate = (steps: { version: number; up: (m: { exec(sql: string): void }) => void }[]) => {
    for (const step of steps) step.up({ exec: (sql: string) => { raw.exec(sql); } });
  };
  return {
    migrate,
    exec: (sql: string) => { raw.exec(sql); },
    prepare: (sql: string) => raw.prepare(sql) as never,
    transaction: ((fn: () => unknown) => raw.transaction(fn)) as never,
  } as unknown as PluginDb;
}

/** A request shaped the way the daemon actually hands one over: `body` is a FUNCTION returning the raw
 *  bytes and `json()` is the parser over it. Building the fixture any other way is how a route that never
 *  reads its payload passes its tests and then rejects every real call as missing a field. */
function request(payload: unknown, extra: { userId?: number; query?: Record<string, string> } = {}) {
  const bytes = Buffer.from(JSON.stringify(payload));
  let consumed = false;
  return {
    method: 'POST',
    path: '',
    query: extra.query ?? {},
    headers: { 'content-type': 'application/json' },
    body: async () => {
      // The daemon reads the request stream once. A handler that asks twice must not get a second copy,
      // or a bug where it does would never show up here.
      if (consumed) throw new Error('request body already consumed');
      consumed = true;
      return bytes;
    },
    json: async <T>() => {
      if (consumed) throw new Error('request body already consumed');
      consumed = true;
      return JSON.parse(bytes.toString('utf8')) as T;
    },
    params: {},
    auth: { userId: extra.userId ?? 7, isAdmin: false },
  } as never;
}

/** Minimal drive behind the resolve route: it holds one item and answers the version lookup honestly,
 *  because "has OneDrive moved on?" is the question that route now turns on. */
function fakeGraph(item: { id: string; etag: string; body: string }) {
  const uploads: { path: string; ifMatch?: string }[] = [];
  return {
    uploads,
    item,
    graph: {
      json: vi.fn(async (method: string, path: string, options?: { ifMatch?: string }) => {
        if (path.startsWith('/me/drive')) return { id: 'drive-1' };
        if (method === 'PUT' && path.includes(':/content')) {
          uploads.push({ path, ifMatch: options?.ifMatch });
          if (options?.ifMatch && options.ifMatch !== item.etag) {
            throw Object.assign(new Error('precondition failed'), { status: 412 });
          }
          return { id: item.id, eTag: 'etag-after-upload', name: 'plan.md', size: 1, parentReference: { path: '/drive/root:' } };
        }
        if (method === 'GET' && path.includes('/items/')) return { id: item.id, eTag: item.etag };
        return { id: 'folder-1' };
      }),
      binary: vi.fn(async () => ({ body: new Uint8Array(Buffer.from(item.body)), contentType: 'text/plain' })),
      request: vi.fn(),
    },
  };
}

function harness(drive?: ReturnType<typeof fakeGraph>, root = '/tmp/demo') {
  const store = new OneDriveStore(pluginDb());
  const routes = new Map<string, (req: never) => Promise<{ status?: number; body?: unknown }>>();
  const ctx = {
    db: () => null,
    config: {},
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    control: vi.fn((name: string) => (name === 'microsoftIdentity' && drive
      ? { identityFor: () => ({ linked: true }), driveGraphFor: async () => drive.graph }
      : undefined)),
    host: {
      stores: () => ({
        userProjects: { canAccess: () => true },
        projects: { get: (id: number) => ({ id, slug: 'demo', path: root }) },
      }),
    },
    registerApiRoute: (route: { path: string; method: string; handler: (req: never) => Promise<unknown> }) => {
      routes.set(`${route.method} ${route.path}`, route.handler as never);
    },
  };
  const engine = { syncUser: vi.fn(async () => undefined) };

  registerApi({
    ctx: ctx as never,
    store,
    engine: engine as never,
    settings: () => ({ rootFolder: 'Elowen', maxFileMb: 10, extraIgnore: '', applyRemoteDeletions: true }),
    rootFor: () => root,
    baseFor: () => root,
    withinBase: (base: string, subpath: string) => (subpath ? `${base}/${subpath}` : base),
    workspacesOf: () => [],
  });

  return { store, routes, engine, ctx };
}

describe('onedrive api routes', () => {
  it('reads the JSON payload the daemon actually delivers', async () => {
    const { store, routes, engine } = harness();
    const link = store.createLink({
      subpath: '',
      userId: 7, projectId: 1, workspaceId: null, workspaceLabel: null,
      remoteDriveId: 'drive-1', remoteItemId: 'folder-1', remotePath: 'Elowen/projects/demo', webUrl: null,
    });

    // Every mutating route reads its id from the body. Reading `req.body` as if it were the parsed object
    // yields nothing, and the route then rejects a perfectly valid call as missing a field - which is what
    // shipped, and what no unit test noticed because none of them called a route.
    const response = await routes.get('POST sync-now')!(request({ id: link.id }) as never);
    expect(response.status ?? 200).toBe(200);
    expect(engine.syncUser).toHaveBeenCalledWith(7, { confirmDeletions: undefined });
  });

  it('passes a bulk-deletion confirmation through for that one mirror only', async () => {
    const { store, routes, engine } = harness();
    const mine = store.createLink({
      subpath: '',
      userId: 7, projectId: 1, workspaceId: null, workspaceLabel: null,
      remoteDriveId: 'd', remoteItemId: 'f', remotePath: 'p', webUrl: null,
    });
    const other = store.createLink({
      subpath: '',
      userId: 7, projectId: 2, workspaceId: null, workspaceLabel: null,
      remoteDriveId: 'd', remoteItemId: 'f2', remotePath: 'p2', webUrl: null,
    });

    await routes.get('POST sync-now')!(request({ id: mine.id, confirmDeletions: true }) as never);
    const [, options] = engine.syncUser.mock.calls.at(-1)!;
    // Confirming one mirror must not authorise deleting from another that happens to belong to the same
    // account and runs in the same cycle.
    expect([...(options as { confirmDeletions: Set<number> }).confirmDeletions]).toEqual([mine.id]);
    expect((options as { confirmDeletions: Set<number> }).confirmDeletions.has(other.id)).toBe(false);
  });

  it('refuses to touch a mirror belonging to somebody else in a shared project', async () => {
    const { store, routes } = harness();
    const theirs = store.createLink({
      subpath: '',
      userId: 99, projectId: 1, workspaceId: null, workspaceLabel: null,
      remoteDriveId: 'd', remoteItemId: 'f', remotePath: 'p', webUrl: null,
    });

    // Project access is granted to both people; the mirror points into ONE person's personal OneDrive.
    // Ownership is therefore a separate question, and the answer must not leak that the mirror exists.
    const response = await routes.get('POST disconnect')!(request({ id: theirs.id }) as never);
    expect(response.status).toBe(404);
    expect(store.linkById(theirs.id)).not.toBeNull();
  });

  it('pauses and resumes from the payload rather than defaulting to one of them', async () => {
    const { store, routes } = harness();
    const link = store.createLink({
      subpath: '',
      userId: 7, projectId: 1, workspaceId: null, workspaceLabel: null,
      remoteDriveId: 'd', remoteItemId: 'f', remotePath: 'p', webUrl: null,
    });

    await routes.get('POST pause')!(request({ id: link.id, enabled: false }) as never);
    expect(store.linkById(link.id)?.enabled).toBe(false);

    await routes.get('POST pause')!(request({ id: link.id, enabled: true }) as never);
    expect(store.linkById(link.id)?.enabled).toBe(true);
  });

  it('answers a request with no usable body with the field it wanted', async () => {
    const { routes } = harness();
    const response = await routes.get('POST connect')!(request('not an object') as never);
    expect(response.status).toBe(400);
    expect((response.body as { error: string }).error).toMatch(/projectId/);
  });
});

describe('onedrive conflict resolution', () => {
  const setup = (body = 'from onedrive\n') => {
    const root = mkdtempSync(join(tmpdir(), 'onedrive-resolve-'));
    const drive = fakeGraph({ id: 'item-1', etag: 'etag-1', body });
    const h = harness(drive, root);
    const link = h.store.createLink({
      subpath: '',
      userId: 7, projectId: 1, workspaceId: null, workspaceLabel: null,
      remoteDriveId: 'drive-1', remoteItemId: 'folder-1', remotePath: 'Elowen/projects/demo', webUrl: null,
    });
    writeFileSync(join(root, 'plan.md'), 'local version\n');
    writeFileSync(join(root, 'plan.conflict.md'), body);
    h.store.putItem({
      linkId: link.id, rel: 'plan.md', localSize: 14, localMtimeMs: 1, localSha256: 'x',
      remoteItemId: 'item-1', remoteEtag: 'etag-1', state: 'conflict', conflictCopy: 'plan.conflict.md',
    });
    return { ...h, link, root, drive };
  };

  it('keeps the local version by uploading it conditionally', async () => {
    const { routes, store, link, drive, root } = setup();
    const response = await routes.get('POST conflicts/resolve')!(
      request({ id: link.id, rel: 'plan.md', keep: 'local' }) as never);

    expect(response.status ?? 200).toBe(200);
    // Conditional on the exact version this conflict was about, so a third edit made in OneDrive since is
    // refused by Graph rather than destroyed.
    expect(drive.uploads[0]?.ifMatch).toBe('etag-1');
    expect(store.items(link.id).get('plan.md')?.state).toBe('synced');
    expect(readFileSync(join(root, 'plan.md'), 'utf8')).toBe('local version\n');
    // The OneDrive version lost, but it is still somebody's work: filed away, not deleted.
    expect(existsSync(join(root, 'plan.conflict.md'))).toBe(false);
    expect(existsSync(join(root, '.elowen-trash'))).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it('keeps the OneDrive version by promoting the copy already on disk', async () => {
    const { routes, store, link, drive, root } = setup();
    const response = await routes.get('POST conflicts/resolve')!(
      request({ id: link.id, rel: 'plan.md', keep: 'remote' }) as never);

    expect(response.status ?? 200).toBe(200);
    expect(readFileSync(join(root, 'plan.md'), 'utf8')).toBe('from onedrive\n');
    // Promoting the copy that was already compared, NOT a second download that could differ again.
    expect(drive.graph.binary).not.toHaveBeenCalled();
    // And the local version it replaced was preserved rather than overwritten out of existence.
    expect(existsSync(join(root, '.elowen-trash'))).toBe(true);
    expect(store.items(link.id).get('plan.md')?.state).toBe('synced');
    rmSync(root, { recursive: true, force: true });
  });

  it('refuses when OneDrive moved on after the conflict was reported', async () => {
    const { routes, store, link, drive, root } = setup();
    drive.item.etag = 'etag-someone-else';

    const response = await routes.get('POST conflicts/resolve')!(
      request({ id: link.id, rel: 'plan.md', keep: 'remote' }) as never);

    // The person would be choosing between two versions when a third has appeared. Asking again is the
    // only honest answer, and the conflict stays frozen meanwhile.
    expect(response.status).toBe(409);
    expect((response.body as { error: string }).error).toMatch(/changed since/);
    expect(store.items(link.id).get('plan.md')?.state).toBe('conflict');
    expect(readFileSync(join(root, 'plan.md'), 'utf8')).toBe('local version\n');
    rmSync(root, { recursive: true, force: true });
  });
});
