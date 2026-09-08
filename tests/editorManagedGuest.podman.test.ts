// @vitest-environment node
/** The editor's managed HTTP surface against a REAL guest: listing, read, save, chunked upload and the
 *  raw download that serves it back. The existing editor suites answer these from an in-process
 *  provider, so they say nothing about the guest actually holding the bytes. Opt-in, private store. */
import { it, expect } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { PodmanClient, SpawnExecutor, isolatedPodmanOptions } from 'elowen/plugins/sandbox/lib/podman.mjs';
import { createEnvironmentRuntime } from 'elowen/plugins/sandbox/lib/environmentRuntime.mjs';
import { initSandboxDb } from 'elowen/plugins/sandbox/lib/db.mjs';
import { openDb } from 'elowen/dist/store/db.js';
import { makePluginDb } from 'elowen/dist/store/pluginDb.js';
import { managedEditorRequest } from '../plugins/editor/src/managed.js';

const PROJECT_ID = 7;
const ACTOR = 1;

it.runIf(process.env.ELOWEN_TEST_PODMAN === '1')('serves the editor from a real guest environment', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'edt-'));
  const isolation = isolatedPodmanOptions(join(scratch, 'pm'), `edt-${randomBytes(6).toString('hex')}`, { useUserSessionBus: true });
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
    const runtimeCtx: any = { db: () => db, currentAccountUserId: () => ACTOR, currentAccess: () => ({ readOnly: false }), config: {}, host: { stores: () => ({
      usersRead: { list: () => [{ id: ACTOR }], mayUsePlugin: () => true, isAdmin: () => true },
      userProjects: { canAccess: (_u: number, id: number) => id === PROJECT_ID, canManage: (_u: number, id: number) => id === PROJECT_ID },
      projects: { get: (id: number) => (id === PROJECT_ID ? project : undefined), beginDeletion: () => true, finishDeletion: () => true },
    }) } };
    initSandboxDb(runtimeCtx);
    const runtime = createEnvironmentRuntime({ ctx: runtimeCtx, db, dataDir: join(scratch, 'sandbox'), namespace: paths.namespace, podman: client, daemon: true });

    stage = 'environment start';
    const started = await runtime.requestEnvironment({ project: projectRef, accountUserId: ACTOR, action: { kind: 'start' } });
    await runtime.reconcile();
    assert.equal((await runtime.environmentOperation({ accountUserId: ACTOR, operationId: started.id }))?.status, 'succeeded');

    const sandbox = {
      ...runtime.control,
      prepareExecution: (input: any, options?: { accountUserId?: number }) =>
        runtime.prepareExecution({ ...input, projectRef: input.projectRef ?? projectRef }, options?.accountUserId ?? ACTOR),
    };
    const ctx: any = {
      currentAccess: () => ({ projectRef }), currentAccountUserId: () => ACTOR,
      control: (name: string) => (name === 'sandbox' ? sandbox : null),
      logger: { info() {}, warn() {}, error() {} },
      host: { projectFiles: () => ({ safe: () => true }) },
    };
    const call = (mount: string, method: string, req: Partial<{ query: Record<string, string>; headers: Record<string, string>; body: () => Promise<Buffer>; json: () => Promise<unknown> }> = {}) =>
      managedEditorRequest(ctx, {
        auth: { userId: ACTOR }, query: {}, headers: {}, body: async () => Buffer.alloc(0), json: async () => ({}), ...req,
      } as any, PROJECT_ID, mount, method);

    stage = 'save a file through the editor';
    // version null is "create": the save refuses to guess a base version it never read.
    const saved: any = await call('/projects/:id/file', 'PUT', { json: async () => ({ path: '/workspace/note.txt', content: 'editor wrote this\n', version: null }) });
    expect(saved.status ?? 200).toBe(200);

    stage = 'a save without a version is refused rather than overwriting blindly';
    const blind: any = await call('/projects/:id/file', 'PUT', { json: async () => ({ path: '/workspace/note.txt', content: 'clobber' }) });
    expect(blind.status).toBe(409);

    stage = 'the listing shows it';
    const listed: any = await call('/projects/:id/files', 'GET', { query: { path: '/workspace' } });
    expect(JSON.stringify(listed.body)).toContain('note.txt');

    stage = 'reading it back returns the guest content';
    const opened: any = await call('/projects/:id/file', 'GET', { query: { path: '/workspace/note.txt' } });
    expect(opened.body.content).toContain('editor wrote this');

    stage = 'chunked upload lands the whole file in the guest';
    const payload = Buffer.from(`upload-${'x'.repeat(5000)}-end`);
    const half = Math.floor(payload.length / 2);
    const first: any = await call('/projects/:id/upload', 'PUT', {
      query: { path: '/workspace/upload.bin', offset: '0', size: String(payload.length) },
      body: async () => payload.subarray(0, half),
    });
    expect(first.status ?? 200).toBe(200);
    const last: any = await call('/projects/:id/upload', 'PUT', {
      query: { path: '/workspace/upload.bin', offset: String(half), size: String(payload.length), final: '1' },
      body: async () => payload.subarray(half),
    });
    expect(last.status ?? 200).toBe(200);

    stage = 'raw download serves exactly what was uploaded';
    const raw: any = await call('/projects/:id/raw', 'GET', { query: { path: '/workspace/upload.bin', download: '1' } });
    const served = Buffer.isBuffer(raw.body) ? raw.body : Buffer.from(raw.body ?? '');
    expect(served.length).toBe(payload.length);
    expect(served.equals(payload)).toBe(true);
    expect(String(raw.headers?.['content-disposition'] ?? '')).toContain('upload.bin');

    stage = 'a byte range is honoured rather than silently ignored';
    const ranged: any = await call('/projects/:id/raw', 'GET', { query: { path: '/workspace/upload.bin' }, headers: { range: 'bytes=0-9' } });
    expect(ranged.status).toBe(206);
    expect(Buffer.from(ranged.body).length).toBe(10);

    stage = 'a managed editor request without a provider refuses';
    const orphan: any = await managedEditorRequest(
      { ...ctx, control: () => null } as any,
      { auth: { userId: ACTOR }, query: {}, headers: {}, body: async () => Buffer.alloc(0), json: async () => ({}) } as any,
      PROJECT_ID, '/projects/:id/files', 'GET',
    );
    expect(orphan.status).toBe(503);

    stage = 'teardown';
    const deleted = await runtime.requestEnvironment({ project: projectRef, accountUserId: ACTOR, action: { kind: 'delete' } });
    await runtime.reconcile();
    assert.equal((await runtime.environmentOperation({ accountUserId: ACTOR, operationId: deleted.id }))?.status, 'succeeded');
    await runtime.dispose();
  } catch (error) {
    console.error(`Managed editor stage failed: ${stage}`);
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
}, 900_000);
