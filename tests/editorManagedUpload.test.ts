// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, stat, rename } from 'node:fs/promises';
import { randomBytes, createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import type { PluginContext, PluginApiRequest, PluginApiRoute, PluginHttpResponse, SandboxPreparedExecution } from 'elowen/plugin-api';
// Canonical guest file contract. The installed SDK is STALE until the parent integrates the runtime:
// the union below does not yet carry `write-begin`/`write-chunk`/`write-commit`/`write-abort`, so a
// typecheck of this file fails on those members by design. Do not cast around it, do not import types
// from a sibling checkout — the parent owns the SDK refresh and this import is already the final one.
import type { GuestFileOperation, GuestFileResult } from 'elowen/dist/plugins/environmentTypes.js';
/** Pins the canonical `GUEST_FILE_CHUNK_BYTES` (runtime `environmentTypes.ts`). Kept local only until
 *  the parent SDK refresh exports it; switch to the `elowen/dist` import at the same time as above. */
const GUEST_FILE_CHUNK_BYTES = 524288;
import { registerEditorApi } from '../plugins/editor/src/api.js';
import { MAX_BUFFERED_BYTES, MAX_UPLOAD_CHUNK_BYTES } from '../plugins/editor/src/fileTypes.js';
import { uploadFile, UploadError } from '../plugins/editor/web-src/editor/upload.js';
import { http, HttpResponse, listen, resetHandlers, setDefaults, close } from './ui/http';

/** Mirrors the runtime provider's error shape (`environmentRuntime.mjs`): a guest failure reaches the
 *  plugin as an `Error` carrying the guest's own `code` (from `guestFiles.py`) and a 409 status. */
const guestError = (code: string, message: string) => Object.assign(new Error(message), { code, status: 409 });
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

interface UploadedChunk { offset: number; final: boolean; overwrite: boolean; size: number | null; bytes: Buffer }

/** A managed guest emulation that follows the LANDED canonical contract
 *  (`elowen-environments-runtime/src/plugins/environmentTypes.ts` + `guestFiles.py` + the provider's
 *  `guestFileTransport.mjs`): whole-file `write` with CAS and a 512 KiB transport cap, chunked uploads
 *  via `write-begin`/`write-chunk`/`write-commit`/`write-abort` whose handles are bound to the acting
 *  account, project and target path, one active upload per destination, chunk offsets aligned to
 *  GUEST_FILE_CHUNK_BYTES, idempotent chunk re-sends, commit that re-checks CAS and assembles
 *  atomically, and abort that discards staging. It records every operation with its actor so a test
 *  can assert on what crossed the guest boundary and who drove it. */
async function managedFixture() {
  const root = await mkdtemp(join(tmpdir(), 'elowen-managed-upload-'));
  const operations: GuestFileOperation[] = [];
  const actors: number[] = [];
  const guest = (absolute: string) => absolute.startsWith('/workspace') ? root + absolute.slice('/workspace'.length) : absolute;
  const exists = async (path: string) => { try { await stat(path); return true; } catch { return false; } };
  const versionOf = async (path: string) => sha(await readFile(path));
  const entryOf = async (path: string) => {
    const info = await stat(path);
    return { path, kind: info.isDirectory() ? 'directory' as const : 'file' as const, size: info.size, modifiedAt: info.mtime.toISOString(), version: sha(await readFile(path)) };
  };
  const cas = async (path: string, expectedVersion: string | null, message: 'Destination already exists' | 'Content version no longer matches') => {
    if (expectedVersion === null ? await exists(path) : !await exists(path) || await versionOf(path) !== expectedVersion) {
      throw guestError('version_conflict', message);
    }
  };
  interface UploadHandle { id: string; path: string; destination: string; expectedVersion: string | null; size: number; accountUserId: number; chunks: Map<number, Buffer>; committed: GuestFileResult | null }
  const handles = new Map<string, UploadHandle>();
  const state = { failAborts: false };
  const activeUpload = (path: string) => [...handles.values()].find(handle => handle.path === path && !handle.committed);
  const requireHandle = (operation: { path: string; uploadId?: string }, accountUserId: number): UploadHandle => {
    const handle = handles.get(operation.uploadId ?? '');
    if (!handle) throw guestError('upload_unknown', 'Upload handle is unavailable');
    if (handle.accountUserId !== accountUserId || handle.path !== operation.path) {
      throw guestError('upload_forbidden', 'Upload belongs to another account, Project, generation or path');
    }
    return handle;
  };
  const provider = {
    async prepareExecution(input: { command: { type: string; file: string; args: string[] }; projectRef: unknown }): Promise<SandboxPreparedExecution> {
      expect(input.projectRef).toEqual({ kind: 'managed', projectId: 7 });
      const args = input.command.args.map((value: string) => value.startsWith('/workspace') ? root + value.slice('/workspace'.length) : value);
      return { mode: 'managed', projectRef: { kind: 'managed', projectId: 7 }, cwd: root, home: '/root', displayCwd: '/workspace', roots: ['/'], workspace: null, launch: { type: 'argv', file: `/usr/bin/${input.command.file}`, args, env: { PATH: '/usr/bin:/bin', HOME: root } }, lease: { id: 'test', accountUserId: 11, workspaceId: null, homeGeneration: null, heartbeat() {}, release() {} }, cancel: async () => {}, sanitizeOutput: (text: string) => text.replaceAll(root, '/workspace') };
    },
    async projectFiles(input: { project: { kind: 'managed'; projectId: number }; accountUserId: number; operation: GuestFileOperation }): Promise<GuestFileResult> {
      expect(input.project).toEqual({ kind: 'managed', projectId: 7 });
      const { operation } = input;
      operations.push(operation);
      actors.push(input.accountUserId);
      const path = guest(operation.path);
      if (operation.kind === 'stat') {
        try { return { kind: 'stat', entry: await entryOf(path) }; }
        catch { return { kind: 'stat', entry: null }; }
      }
      if (operation.kind === 'list') {
        const names = (await readdir(path)).sort();
        const after = operation.cursor ? names.filter(name => name > operation.cursor!) : names;
        const page = after.slice(0, operation.limit);
        const entries = await Promise.all(page.map(async name => entryOf(join(path, name))));
        const truncated = after.length > operation.limit;
        return { kind: 'list', entries, truncated, nextCursor: truncated ? page[page.length - 1]! : null };
      }
      if (operation.kind === 'read') {
        const bytes = await readFile(path);
        if (operation.maxBytes > GUEST_FILE_CHUNK_BYTES) throw guestError('invalid_limit', 'Invalid guest operation bound');
        const start = operation.offset ?? 0;
        return { kind: 'read', base64: bytes.subarray(start, start + Math.min(operation.length ?? operation.maxBytes, operation.maxBytes)).toString('base64'), totalBytes: bytes.length, version: sha(bytes) };
      }
      if (operation.kind === 'write') {
        const data = Buffer.from(operation.base64, 'base64');
        if (data.length > GUEST_FILE_CHUNK_BYTES) throw guestError('file_too_large', 'Write exceeds the guest transport limit');
        await cas(path, operation.expectedVersion, operation.expectedVersion === null ? 'Destination already exists' : 'Content version no longer matches');
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, data);
        return { kind: 'write', entry: await entryOf(path) };
      }
      if (operation.kind === 'mkdir') {
        await mkdir(path);
        return { kind: 'mkdir', entry: { ...await entryOf(path), kind: 'directory' } };
      }
      if (operation.kind === 'remove') {
        if (!await exists(path)) throw guestError('not_found', 'No such guest entry');
        if (operation.expectedVersion !== await versionOf(path)) throw guestError('version_conflict', 'Content version no longer matches');
        await rm(path);
        return { kind: 'remove', removed: true };
      }
      if (operation.kind === 'rename') {
        const destination = guest(operation.destination);
        if (!await exists(path)) throw guestError('not_found', 'No such guest entry');
        if (operation.expectedVersion !== await versionOf(path)) throw guestError('version_conflict', 'Content version no longer matches');
        if (await exists(destination)) throw guestError('already_exists', 'Destination already exists');
        await mkdir(dirname(destination), { recursive: true });
        await rename(path, destination);
        return { kind: 'rename', entry: await entryOf(destination) };
      }
      // ---- Chunked upload protocol (canonical `write-begin`/`write-chunk`/`write-commit`/`write-abort`).
      if (operation.kind === 'write-begin') {
        if (activeUpload(operation.path)) throw guestError('upload_conflict', 'An upload already owns this destination');
        await cas(path, operation.expectedVersion, operation.expectedVersion === null ? 'Destination already exists' : 'Content version no longer matches');
        const handle: UploadHandle = { id: randomBytes(16).toString('hex'), path: operation.path, destination: path, expectedVersion: operation.expectedVersion, size: operation.size, accountUserId: input.accountUserId, chunks: new Map(), committed: null };
        handles.set(handle.id, handle);
        return { kind: 'write-begin', uploadId: handle.id, chunkSize: GUEST_FILE_CHUNK_BYTES, received: 0, resolvedPath: path };
      }
      if (operation.kind === 'write-chunk') {
        const handle = requireHandle(operation, input.accountUserId);
        const data = Buffer.from(operation.base64, 'base64');
        if (operation.offset % GUEST_FILE_CHUNK_BYTES !== 0 || !data.length || data.length !== Math.min(GUEST_FILE_CHUNK_BYTES, handle.size - operation.offset)) {
          throw guestError('upload_invalid', 'Invalid upload chunk boundary');
        }
        const previous = handle.chunks.get(operation.offset);
        if (previous && !previous.equals(data)) throw guestError('chunk_conflict', 'Upload chunk already contains different bytes');
        handle.chunks.set(operation.offset, data);
        return { kind: 'write-chunk', received: [...handle.chunks.values()].reduce((total, chunk) => total + chunk.length, 0) };
      }
      if (operation.kind === 'write-commit') {
        const handle = requireHandle(operation, input.accountUserId);
        if (handle.committed) return handle.committed;
        for (let offset = 0; offset < handle.size; offset += GUEST_FILE_CHUNK_BYTES) {
          if (handle.chunks.get(offset)?.length !== Math.min(GUEST_FILE_CHUNK_BYTES, handle.size - offset)) {
            throw guestError('upload_incomplete', 'Upload is missing a complete chunk');
          }
        }
        await cas(path, handle.expectedVersion, handle.expectedVersion === null ? 'Destination already exists' : 'Content version no longer matches');
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, Buffer.concat([...handle.chunks.entries()].sort(([a], [b]) => a - b).map(([, chunk]) => chunk)));
        handle.committed = { kind: 'write-commit', entry: await entryOf(path) };
        return handle.committed;
      }
      if (operation.kind === 'write-abort') {
        // A switchable cleanup refusal: a test sets it to prove the editor surfaces a failed abort
        // instead of answering as if the leaked handle had been released cleanly.
        if (state.failAborts) throw guestError('upload_cleanup_unverified', 'Upload cleanup could not be verified');
        const handle = handles.get(operation.uploadId ?? '');
        if (handle && handle.accountUserId === input.accountUserId) handles.delete(operation.uploadId);
        return { kind: 'write-abort', aborted: true };
      }
      throw guestError('invalid_operation', 'Unknown guest file operation');
    },
  };
  const routes: PluginApiRoute[] = [];
  // ctx.control is resolved fresh for every operation, exactly as the core wires it: `registry.control()`
  // hands back the REGISTERED control object itself (src/plugins/registry.ts `control()` — the same
  // identity on every call, never a per-call proxy), so provider-keyed upload sessions survive across
  // requests and the fixture mirrors that by returning the same provider each time.
  const ctx = { control: () => provider, registerApiRoute: (route: PluginApiRoute) => routes.push(route), host: { projectFiles: () => ({ safe: () => { throw new Error('host route called'); } }), stores: () => ({ projects: { get: () => ({ id: 7, executionKind: 'managed', path: '/host-must-not-be-used' }) } }) } } as unknown as PluginContext;
  registerEditorApi(ctx);
  const upload = async (query: Record<string, string>, bytes: Buffer, accountUserId = 11): Promise<PluginHttpResponse> => {
    const route = routes.find(route => route.rootMount === '/projects/:id/upload' && route.method === 'PUT')!;
    expect(route, 'the editor registers an upload route').toBeTruthy();
    return route.handler({ path: '', params: { id: '7' }, query, headers: {}, auth: { userId: accountUserId, accessibleProjects: [7], admin: false }, json: async () => { throw new Error('upload carries raw bytes'); }, body: async () => bytes } as unknown as PluginApiRequest);
  };
  return { root, operations, actors, state, upload, dispose: () => rm(root, { recursive: true, force: true }) };
}

describe('browser upload transport', () => {
  const recorded: UploadedChunk[] = [];
  beforeAll(() => listen());
  beforeEach(() => { recorded.length = 0; });
  afterEach(resetHandlers);
  afterAll(close);
  const serve = (respond: (chunk: UploadedChunk) => Response = () => HttpResponse.json({ ok: true, written: 0 })) => {
    setDefaults(http.put('/api/projects/7/upload', async ({ request, url }) => {
      const query = url.searchParams;
      const totalSize = query.get('size');
      const chunk: UploadedChunk = { offset: Number(query.get('offset')), final: query.get('final') === '1', overwrite: query.get('overwrite') === '1', size: totalSize === null ? null : Number(totalSize), bytes: Buffer.from(await request.arrayBuffer()) };
      recorded.push(chunk);
      return respond(chunk);
    }));
  };

  it('carries a large file as bounded sequential chunks and marks only the last as final', async () => {
    serve();
    const payload = new Uint8Array(5 * 1024 * 1024 + 7).map((_, i) => i % 251);
    const progress: Array<[number, number]> = [];
    await uploadFile(7, 'assets/blob.bin', new File([payload], 'blob.bin'), { onProgress: (sent, total) => progress.push([sent, total]) });
    expect(recorded.map(chunk => chunk.offset)).toEqual([0, MAX_UPLOAD_CHUNK_BYTES, 2 * MAX_UPLOAD_CHUNK_BYTES]);
    expect(recorded.map(chunk => chunk.final)).toEqual([false, false, true]);
    expect(recorded.every(chunk => chunk.bytes.length <= MAX_UPLOAD_CHUNK_BYTES)).toBe(true);
    // Every request declares the file's total size: the managed transport opens its guest upload with
    // write-begin, and the canonical begin must know the size up front, before the last chunk arrives.
    expect(recorded.every(chunk => chunk.size === payload.length)).toBe(true);
    expect(Buffer.concat(recorded.map(chunk => chunk.bytes)).equals(Buffer.from(payload))).toBe(true);
    expect(progress.at(-1)).toEqual([payload.length, payload.length]);
  });

  it('refuses a file above the 50 MiB upload cap before a single byte is sent', async () => {
    serve();
    await expect(uploadFile(7, 'big.bin', new File([new Uint8Array(MAX_BUFFERED_BYTES + 1)], 'big.bin'))).rejects.toThrow('file too large');
    expect(recorded).toHaveLength(0);
  });

  it('sends a zero-byte file as one final empty chunk so it still lands', async () => {
    serve();
    await uploadFile(7, 'empty.txt', new File([], 'empty.txt'));
    expect(recorded).toEqual([{ offset: 0, final: true, overwrite: false, size: 0, bytes: Buffer.alloc(0) }]);
  });

  it('surfaces the server refusal verbatim as an UploadError', async () => {
    serve(() => HttpResponse.json({ error: 'upload out of order' }, { status: 400 }));
    const error = await uploadFile(7, 'blob.bin', new File([new Uint8Array(16)], 'blob.bin')).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UploadError);
    expect((error as Error).message).toBe('upload out of order');
  });
});

describe('managed upload parity', () => {
  // Managed parity of the app-path upload route against the LANDED canonical chunked-upload contract:
  // the browser's multipart chunks must cross the guest boundary as a write-begin/write-chunk/
  // write-commit sequence, every guest chunk inside GUEST_FILE_CHUNK_BYTES and aligned to it, with CAS
  // at begin and commit, abort on failure and no staging left behind.
  it('carries a chunk sequence through the managed boundary within every transport bound', async () => {
    const f = await managedFixture();
    try {
      const payload = Buffer.alloc(3 * GUEST_FILE_CHUNK_BYTES, 7);
      const size = String(payload.length);
      // Three SEPARATE requests: the upload session opened by the first must stay resolvable for the
      // second and third even though every request resolves ctx.control anew — the core hands back the
      // registered control object itself (src/plugins/registry.ts `control()`), so the provider-keyed
      // session map holds and a fresh proxy identity is never part of the contract.
      expect((await f.upload({ path: 'blob.bin', offset: '0', final: '0', overwrite: '0', size }, payload.subarray(0, GUEST_FILE_CHUNK_BYTES))).body).toMatchObject({ ok: true });
      expect((await f.upload({ path: 'blob.bin', offset: String(GUEST_FILE_CHUNK_BYTES), final: '0', overwrite: '0', size }, payload.subarray(GUEST_FILE_CHUNK_BYTES, 2 * GUEST_FILE_CHUNK_BYTES))).body).toMatchObject({ ok: true });
      expect((await f.upload({ path: 'blob.bin', offset: String(2 * GUEST_FILE_CHUNK_BYTES), final: '1', overwrite: '0', size }, payload.subarray(2 * GUEST_FILE_CHUNK_BYTES))).body).toMatchObject({ ok: true });
      expect((await readFile(join(f.root, 'blob.bin'))).equals(payload)).toBe(true);
      // The guest saw the canonical upload sequence: begin first (CAS against a fresh destination),
      // aligned 512 KiB chunks, commit last — and no whole-file write at any point.
      const kinds = f.operations.map(op => op.kind);
      expect(kinds[0]).toBe('write-begin');
      expect(kinds[kinds.length - 1]).toBe('write-commit');
      expect(kinds.filter(kind => kind === 'write')).toEqual([]);
      for (const op of f.operations) {
        if (op.kind === 'write-begin') expect(op.size).toBe(payload.length);
        if (op.kind === 'write-chunk') {
          expect(op.offset % GUEST_FILE_CHUNK_BYTES).toBe(0);
          expect(Buffer.from(op.base64, 'base64').length).toBeLessThanOrEqual(GUEST_FILE_CHUNK_BYTES);
          expect(op.path.startsWith('/workspace/')).toBe(true);
        }
      }
      // An assembled upload leaves no half-written marker behind: it is listed nowhere.
      expect((await readdir(f.root)).filter(name => name.includes('.elowen-upload'))).toEqual([]);
    } finally { await f.dispose(); }
  });

  it('refuses an out-of-order managed chunk without touching the destination', async () => {
    const f = await managedFixture();
    try {
      const result = await f.upload({ path: 'blob.bin', offset: String(2 * MAX_UPLOAD_CHUNK_BYTES), final: '0', overwrite: '0', size: String(2 * MAX_UPLOAD_CHUNK_BYTES + 16) }, Buffer.alloc(16));
      expect(result.status).toBe(400);
      expect(result.body).toEqual({ error: 'upload out of order' });
      expect(f.operations).toHaveLength(0);
      await expect(readFile(join(f.root, 'blob.bin'))).rejects.toThrow();
    } finally { await f.dispose(); }
  });

  it('refuses a chunk above the shared browser split before the guest sees it', async () => {
    const f = await managedFixture();
    try {
      const result = await f.upload({ path: 'blob.bin', offset: '0', final: '0', overwrite: '0', size: String(MAX_UPLOAD_CHUNK_BYTES + 1) }, Buffer.alloc(MAX_UPLOAD_CHUNK_BYTES + 1));
      expect(result.status).toBe(400);
      expect(result.body).toEqual({ error: 'chunk too large' });
      expect(f.operations).toHaveLength(0);
    } finally { await f.dispose(); }
  });

  it('keeps the original file and releases the handle when the final chunk hits an occupied destination', async () => {
    const f = await managedFixture();
    try {
      await writeFile(join(f.root, 'blob.bin'), 'original');
      const result = await f.upload({ path: 'blob.bin', offset: '0', final: '1', overwrite: '0', size: '16' }, Buffer.alloc(16, 9));
      expect(result.status).toBe(400);
      expect(result.body).toEqual({ error: 'already exists' });
      expect(await readFile(join(f.root, 'blob.bin'), 'utf8')).toBe('original');
      // Recovery: whatever handle the route opened for the upload must be aborted, not leaked — a
      // leaked handle would own the destination and block every later upload with upload_conflict.
      expect(f.operations.some(op => op.kind === 'write-begin')).toBe(f.operations.some(op => op.kind === 'write-abort'));
      expect((await readdir(f.root)).filter(name => name.includes('.elowen-upload'))).toEqual([]);
    } finally { await f.dispose(); }
  });

  it('binds every upload operation to the acting account and refuses a second owner for one destination', async () => {
    const f = await managedFixture();
    try {
      const payload = Buffer.alloc(GUEST_FILE_CHUNK_BYTES + 4, 3);
      const size = String(payload.length);
      expect((await f.upload({ path: 'blob.bin', offset: '0', final: '0', overwrite: '0', size }, payload.subarray(0, GUEST_FILE_CHUNK_BYTES))).body).toMatchObject({ ok: true });
      // Every operation so far carried the uploader's own account identity, so the runtime can bind
      // the handle to it — no other account may advance or complete this upload.
      expect(f.actors.every(actor => actor === 11)).toBe(true);
      // A second account beginning an upload of the same destination must surface the runtime's
      // refusal as a client error while the first upload stays unharmed and resumable.
      const second = await f.upload({ path: 'blob.bin', offset: '0', final: '0', overwrite: '0', size: '8' }, Buffer.alloc(8, 5), 12);
      expect(second.status).toBeGreaterThanOrEqual(400);
      expect(second.status).toBeLessThan(500);
      expect((await f.upload({ path: 'blob.bin', offset: String(GUEST_FILE_CHUNK_BYTES), final: '1', overwrite: '0', size }, payload.subarray(GUEST_FILE_CHUNK_BYTES))).body).toMatchObject({ ok: true });
      expect((await readFile(join(f.root, 'blob.bin'))).equals(payload)).toBe(true);
    } finally { await f.dispose(); }
  });

  it('aborts the handle when the final chunk arrives incomplete', async () => {
    const f = await managedFixture();
    try {
      const size = String(2 * GUEST_FILE_CHUNK_BYTES);
      expect((await f.upload({ path: 'blob.bin', offset: '0', final: '0', overwrite: '0', size }, Buffer.alloc(GUEST_FILE_CHUNK_BYTES, 1))).body).toMatchObject({ ok: true });
      // The last request cannot complete the declared size: the upload must fail as a client error AND
      // release its handle, so the destination is never left half-owned or half-written.
      const result = await f.upload({ path: 'blob.bin', offset: String(GUEST_FILE_CHUNK_BYTES), final: '1', overwrite: '0', size }, Buffer.alloc(1024, 2));
      expect(result.status).toBeGreaterThanOrEqual(400);
      expect(result.status).toBeLessThan(500);
      const kinds = f.operations.map(op => op.kind);
      expect(kinds[kinds.length - 1]).toBe('write-abort');
      await expect(readFile(join(f.root, 'blob.bin'))).rejects.toThrow();
      expect((await readdir(f.root)).filter(name => name.includes('.elowen-upload'))).toEqual([]);
    } finally { await f.dispose(); }
  });

  it('refuses mismatched size or offset without corrupting the destination', async () => {
    const f = await managedFixture();
    try {
      await writeFile(join(f.root, 'kept.txt'), 'keep');
      const size = String(2 * GUEST_FILE_CHUNK_BYTES);
      expect((await f.upload({ path: 'kept.txt', offset: '0', final: '0', overwrite: '1', size }, Buffer.alloc(GUEST_FILE_CHUNK_BYTES, 1))).body).toMatchObject({ ok: true });
      // A request whose declared size no longer matches the open session is a broken client: refuse it
      // while the previous file version stays byte-for-byte intact — the write never touched it.
      const mismatched = await f.upload({ path: 'kept.txt', offset: String(GUEST_FILE_CHUNK_BYTES), final: '1', overwrite: '1', size: String(3 * GUEST_FILE_CHUNK_BYTES) }, Buffer.alloc(GUEST_FILE_CHUNK_BYTES, 2));
      expect(mismatched.status).toBe(400);
      expect(mismatched.body).toEqual({ error: 'upload out of order' });
      expect(await readFile(join(f.root, 'kept.txt'), 'utf8')).toBe('keep');
      expect((await readdir(f.root)).filter(name => name.includes('.elowen-upload'))).toEqual([]);
      // The session survives the refused request, so the honest client can resume: the corrected final
      // chunk completes the overwrite in one atomic version-checked commit.
      const expected = Buffer.concat([Buffer.alloc(GUEST_FILE_CHUNK_BYTES, 1), Buffer.alloc(GUEST_FILE_CHUNK_BYTES, 3)]);
      expect((await f.upload({ path: 'kept.txt', offset: String(GUEST_FILE_CHUNK_BYTES), final: '1', overwrite: '1', size }, expected.subarray(GUEST_FILE_CHUNK_BYTES))).body).toMatchObject({ ok: true });
      expect((await readFile(join(f.root, 'kept.txt'))).equals(expected)).toBe(true);
      expect((await readdir(f.root)).filter(name => name.includes('.elowen-upload'))).toEqual([]);
    } finally { await f.dispose(); }
  });

  it('surfaces a failed cleanup abort instead of swallowing it', async () => {
    const f = await managedFixture();
    try {
      const size = String(2 * GUEST_FILE_CHUNK_BYTES);
      expect((await f.upload({ path: 'blob.bin', offset: '0', final: '0', overwrite: '0', size }, Buffer.alloc(GUEST_FILE_CHUNK_BYTES, 1))).body).toMatchObject({ ok: true });
      // The incomplete final chunk fails, and now the recovery abort fails too. A leaked handle owns
      // the destination and blocks every later upload, so the response may not read as a clean client
      // refusal — the cleanup failure must reach the surface (a server-side error), not vanish.
      f.state.failAborts = true;
      const result = await f.upload({ path: 'blob.bin', offset: String(GUEST_FILE_CHUNK_BYTES), final: '1', overwrite: '0', size }, Buffer.alloc(1024, 2));
      expect(result.status).toBeGreaterThanOrEqual(500);
      expect(typeof (result.body as { error?: unknown }).error).toBe('string');
    } finally { await f.dispose(); }
  });
});