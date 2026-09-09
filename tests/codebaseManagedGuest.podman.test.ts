// @vitest-environment node
/** The semantic code index against a REAL guest: the plugin's own tools walk and read a managed
 *  project's /workspace through the Sandbox provider, key the rows by the project id, and answer a
 *  search from them. The unit suite proves the same logic over an in-process provider; this proves the
 *  guest actually hands over the bytes and refuses a non-member. Opt-in, private store. */
import { it, expect, vi } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { PodmanClient, SpawnExecutor, isolatedPodmanOptions } from 'elowen/plugins/sandbox/lib/podman.mjs';
import { createEnvironmentRuntime } from 'elowen/plugins/sandbox/lib/environmentRuntime.mjs';
import { initSandboxDb } from 'elowen/plugins/sandbox/lib/db.mjs';
import { openDb } from 'elowen/dist/store/db.js';
import { makePluginDb } from 'elowen/dist/store/pluginDb.js';
import { register } from '../plugins/codebase/index.mjs';

const PROJECT_ID = 7;
const ACTOR = 1;
/** A linked account that is not a member of the project. */
const OUTSIDER = 2;
const VOCAB = ['cosine', 'similarity', 'vector', 'dot', 'product', 'background', 'job', 'embedding', 'queue', 'missing', 'memory'];
const fakeVec = (text: string) => Float32Array.from(VOCAB.map((w) => (text.toLowerCase().match(new RegExp(w, 'g'))?.length ?? 0)));

type Tool = { name: string; execute(id: string, params: Record<string, unknown>): Promise<any> };

it.runIf(process.env.ELOWEN_TEST_PODMAN === '1')('indexes and searches a managed project through the guest', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'cbg-'));
  const isolation = isolatedPodmanOptions(join(scratch, 'pm'), `cbg-${randomBytes(6).toString('hex')}`, { useUserSessionBus: true });
  const paths = isolation.isolation;
  const client = new PodmanClient(isolation);
  const sql = openDb(':memory:');
  let engineVerified = false;
  let stage = 'engine';
  try {
    const info = await client.info();
    assert.equal(info.graphRoot, paths.storage);
    engineVerified = true;

    const db = makePluginDb(sql, 'sandbox', { canMigrate: true });
    const project: any = { id: PROJECT_ID, executionKind: 'managed', lifecycle: 'active' };
    const projectRef = { kind: 'managed' as const, projectId: PROJECT_ID };
    let actingAccount = ACTOR;
    const runtimeCtx: any = { db: () => db, currentAccountUserId: () => actingAccount, currentAccess: () => ({ readOnly: false }), config: {}, host: { stores: () => ({
      usersRead: { list: () => [{ id: ACTOR }, { id: OUTSIDER }], mayUsePlugin: () => true, isAdmin: (id: number) => id === ACTOR },
      userProjects: { canAccess: (u: number, id: number) => id === PROJECT_ID && u === ACTOR, canManage: (u: number, id: number) => id === PROJECT_ID && u === ACTOR },
      projects: { get: (id: number) => (id === PROJECT_ID ? project : undefined), beginDeletion: () => true, finishDeletion: () => true },
    }) } };
    initSandboxDb(runtimeCtx);
    const runtime = createEnvironmentRuntime({ ctx: runtimeCtx, db, dataDir: join(scratch, 'sandbox'), namespace: paths.namespace, podman: client, daemon: true });

    stage = 'environment start';
    const started = await runtime.requestEnvironment({ project: projectRef, accountUserId: ACTOR, action: { kind: 'start' } });
    await runtime.reconcile();
    assert.equal((await runtime.environmentOperation({ accountUserId: ACTOR, operationId: started.id }))?.status, 'succeeded');

    stage = 'seed the guest workspace';
    const guestWrite = async (path: string, text: string) => {
      // The guest mkdir is not recursive: create every missing ancestor, nearest the root first.
      const missing: string[] = [];
      for (let dir = path.slice(0, path.lastIndexOf('/')); dir !== '/workspace'; dir = dir.slice(0, dir.lastIndexOf('/'))) {
        const parent = await runtime.control.projectFiles({ project: projectRef, accountUserId: ACTOR, operation: { kind: 'stat', path: dir } });
        if (parent.kind === 'stat' && parent.entry) break;
        missing.unshift(dir);
      }
      for (const dir of missing) await runtime.control.projectFiles({ project: projectRef, accountUserId: ACTOR, operation: { kind: 'mkdir', path: dir } });
      return runtime.control.projectFiles({ project: projectRef, accountUserId: ACTOR, operation: { kind: 'write', path, base64: Buffer.from(text).toString('base64'), expectedVersion: null } });
    };
    await guestWrite('/workspace/src/math.ts', 'export function cosineSimilarity(a, b) {\n  // cosine similarity of two vector inputs: dot product over norms\n  return dot(a, b);\n}\n');
    await guestWrite('/workspace/src/queue.ts', 'export class EmbeddingQueue {\n  // background job that fills in missing memory embedding vectors\n}\n');
    await guestWrite('/workspace/node_modules/dep/index.js', 'cosine cosine cosine vector vector\n');

    stage = 'register the plugin against the provider';
    const sandbox = runtime.control;
    const tools: Tool[] = [];
    let pluginAccount = ACTOR;
    const hostGuard = vi.fn(() => { throw new Error('HOST PATH GUARD REACHED'); });
    const embedBatch = vi.fn(async (texts: string[]) => texts.map(fakeVec));
    // The daemon's ctx.dataDir() creates the plugin's directory; the stand-in has to as well.
    const dataDir = join(scratch, 'codebase');
    mkdirSync(dataDir, { recursive: true });
    const ctx: any = {
      config: {}, logger: { info() {}, warn() {}, error() {} }, dataDir: () => dataDir,
      registerTool: (tool: Tool) => tools.push(tool), registerPlatform() {}, registerProjectRemoved() {},
      isAdminSession: () => true,
      currentAccess: () => ({ projectRef }), currentAccountUserId: () => pluginAccount,
      control: (name: string) => (name === 'sandbox' ? sandbox : undefined),
      allowedRoots: () => ['/workspace'], defaultCwd: () => '/workspace',
      assertPathAllowed: hostGuard,
      embeddings: { isConfigured: () => true, descriptor: () => ({ provider: 'p', model: 'fake-1', dimensions: VOCAB.length }), embed: async (text: string) => fakeVec(text), embedBatch },
    };
    register(ctx);
    const run = (name: string, params: Record<string, unknown>) => tools.find((t) => t.name === name)!.execute('t', params);

    stage = 'reindex walks and reads the guest';
    const reindexed = await run('CodebaseReindex', {});
    expect(reindexed.details?.ok, JSON.stringify(reindexed.content)).toBe(true);
    expect(reindexed.details.filesChanged).toBe(2);
    expect(reindexed.details.chunksEmbedded).toBeGreaterThan(0);
    // Embedding stayed central: the provider only ever saw guest text, and every vector was made here.
    expect(embedBatch).toHaveBeenCalled();
    const index = new Database(join(dataDir, 'index.db'), { readonly: true });
    expect(index.prepare('SELECT DISTINCT repo FROM chunks').all()).toEqual([{ repo: `managed:${PROJECT_ID}` }]);
    expect(index.prepare('SELECT DISTINCT path FROM chunks ORDER BY path').all()).toEqual([{ path: 'src/math.ts' }, { path: 'src/queue.ts' }]);
    index.close();

    stage = 'search answers from the guest-built index with guest-relative paths';
    const found = await run('CodebaseSearch', { query: 'cosine similarity of two vectors', k: 3 });
    expect(found.details?.ok, JSON.stringify(found.content)).toBe(true);
    expect(found.content[0].text.split('\n')[0]).toMatch(/^src\/math\.ts:1-/);

    stage = 'an unchanged workspace costs no reads and no embeddings';
    embedBatch.mockClear();
    const again = await run('CodebaseReindex', {});
    expect(again.details).toMatchObject({ ok: true, filesChanged: 0, chunksEmbedded: 0 });
    expect(embedBatch).not.toHaveBeenCalled();

    stage = 'a non-member is denied at the project boundary';
    pluginAccount = OUTSIDER;
    actingAccount = OUTSIDER;
    const denied = await run('CodebaseSearch', { query: 'cosine similarity', k: 3 });
    expect(denied.details?.ok).toBe(false);
    expect(JSON.stringify(denied)).toMatch(/Project access is denied/);
    const deniedReindex = await run('CodebaseReindex', {});
    expect(deniedReindex.details?.ok).toBe(false);
    expect(JSON.stringify(deniedReindex)).toMatch(/Project access is denied/);
    pluginAccount = ACTOR;
    actingAccount = ACTOR;

    stage = 'no host path guard was ever consulted';
    expect(hostGuard).not.toHaveBeenCalled();

    stage = 'teardown';
    const deleted = await runtime.requestEnvironment({ project: projectRef, accountUserId: ACTOR, action: { kind: 'delete' } });
    await runtime.reconcile();
    assert.equal((await runtime.environmentOperation({ accountUserId: ACTOR, operationId: deleted.id }))?.status, 'succeeded');
    await runtime.dispose();
  } catch (error) {
    console.error(`Managed codebase stage failed: ${stage}`);
    throw error;
  } finally {
    sql.close();
    if (engineVerified) {
      const reset = await new SpawnExecutor().run('/usr/bin/podman',
        ['--root', paths.storage, '--runroot', paths.runroot, '--tmpdir', paths.tmp, '--storage-driver', 'vfs', 'system', 'reset', '--force'],
        { env: { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: paths.home, XDG_RUNTIME_DIR: paths.runtime, TMPDIR: paths.tmp,
          ...(paths.userBus ? { DBUS_SESSION_BUS_ADDRESS: `unix:path=${paths.userBus.path}` } : {}) },
        timeoutMs: 180_000, outputLimitBytes: 1024 * 1024 });
      if (reset.code !== 0) throw new Error(`private Podman cleanup failed; retained ${scratch}: ${reset.stderr}`);
    }
    rmSync(scratch, { recursive: true, force: true });
  }
}, 1_500_000);
