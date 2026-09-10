// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { PluginContext, PluginApiRequest, PluginApiRoute, PluginHttpResponse } from 'elowen/dist/plugins/api.js';
import type { GuestFileOperation, GuestFileResult } from 'elowen/dist/plugins/environmentTypes.js';
import { registerEditorApi } from '../plugins/editor/src/api.js';

/** What the editor is allowed to say when a guest upload is refused.
 *
 *  The provider's message is assembled where the failure happened, and it has carried a raw errno, the
 *  staging directory and the candidate filename — an upload into a directory that did not exist once
 *  answered a browser with `[Errno 2] No such file or directory: '/workspace/…/.elowen-upload-bf62…'`.
 *  The code is the contract; the wording and the status belong to the editor. These tests hold that
 *  line from the outside: nothing the provider wrote may appear in an HTTP body, whatever the code. */

/** The text a provider must never be able to push through, whatever it tags the failure with. */
const LEAK = "[Errno 2] No such file or directory: '/workspace/vision/.elowen-upload-bf62eedef357d06cec70a6cabf16313b'";

const guestFailure = (code: string, message: string, status = 409) =>
  Object.assign(new Error(message), { code, status });

function fixture(handle: (operation: GuestFileOperation) => GuestFileResult) {
  const routes: PluginApiRoute[] = [];
  const operations: GuestFileOperation[] = [];
  const projectFiles = vi.fn(async ({ operation }: { operation: GuestFileOperation }) => {
    operations.push(operation);
    return handle(operation);
  });
  const safe = vi.fn(() => { throw new Error('host filesystem must not be used'); });
  const ctx = {
    control: () => ({ projectFiles }),
    registerApiRoute: (route: PluginApiRoute) => routes.push(route),
    host: { projectFiles: () => ({ safe }), stores: () => ({ projects: { get: () => ({ id: 7, executionKind: 'managed', path: '/host-must-not-be-used' }) } }) },
  } as unknown as PluginContext;
  registerEditorApi(ctx);
  const upload = (bytes: Buffer, overwrite: boolean): Promise<PluginHttpResponse> => {
    const route = routes.find(r => r.rootMount === '/projects/:id/upload' && r.method === 'PUT')!;
    return route.handler({
      path: '', params: { id: '7' },
      query: { path: 'dir/file.bin', offset: '0', size: String(bytes.length), final: '1', overwrite: overwrite ? '1' : '0' },
      headers: {}, auth: { userId: 11, accessibleProjects: [7], admin: false },
      json: async () => { throw new Error('upload carries raw bytes'); }, body: async () => bytes,
    } as unknown as PluginApiRequest);
  };
  return { upload, operations, safe };
}

/** Answers everything the upload path needs, then fails the step under test. */
const failingAt = (failure: Error, kind: GuestFileOperation['kind'] = 'write-begin') =>
  (operation: GuestFileOperation): GuestFileResult => {
    if (operation.kind === kind) throw failure;
    if (operation.kind === 'stat') return { kind: 'stat', entry: { path: '/workspace/dir/file.bin', kind: 'file', size: 4, modifiedAt: '2026-01-01T00:00:00.000Z', version: 'v1' } };
    if (operation.kind === 'write-begin') return { kind: 'write-begin', uploadId: 'u1', chunkSize: 524288, received: 0, resolvedPath: '/workspace/dir/file.bin' };
    if (operation.kind === 'write-abort') return { kind: 'write-abort', aborted: true };
    throw new Error(`unexpected operation ${operation.kind}`);
  };

const body = (response: PluginHttpResponse): string => JSON.stringify(response.body);

describe('editor upload refusals are an allowlist, not a passthrough', () => {
  it.each([
    ['upload_forbidden', 403, 'this upload does not belong to this destination'],
    ['upload_conflict', 409, 'another upload already owns this destination'],
    ['upload_expired', 409, 'upload expired and must be started again'],
    ['upload_pending', 409, 'upload is not ready for chunks'],
    ['environment_busy', 409, 'the project environment changed while this upload was starting'],
    ['upload_unknown', 409, 'upload handle is unavailable'],
    ['upload_invalid', 409, 'upload state is not valid for this step'],
    ['upload_completed', 409, 'upload is already committed'],
    ['upload_incomplete', 409, 'upload is missing chunks and cannot be committed'],
    ['upload_cleanup_unverified', 409, 'upload staging could not be verified'],
    ['chunk_conflict', 409, 'a different chunk already occupies this offset'],
    ['resolution_drift', 409, 'upload destination changed while the upload was open'],
    ['not_directory', 409, 'upload destination is inside something that is not a directory'],
    ['invalid_path', 400, 'invalid upload destination'],
    ['invalid_operation', 400, 'invalid upload operation'],
    ['invalid_upload', 400, 'invalid upload handle'],
    ['invalid_chunk', 400, 'invalid upload chunk'],
    ['invalid_size', 400, 'invalid upload size'],
    ['version_required', 400, 'a content version is required'],
    ['file_too_large', 413, 'file is too large to upload'],
  ])('answers %s as %i with its own wording', async (code, status, message) => {
    const f = fixture(failingAt(guestFailure(code, LEAK, status)));
    const response = await f.upload(Buffer.from('data'), true);

    expect(response.status).toBe(status);
    expect(response.body).toEqual({ error: message });
    expect(body(response)).not.toContain('Errno');
    expect(body(response)).not.toContain('.elowen-upload');
    expect(f.safe).not.toHaveBeenCalled();
  });

  /** The regression this table exists for. */
  it('never lets an unrecognised code carry the guest errno and staging path to the browser', async () => {
    const f = fixture(failingAt(guestFailure('guest_upload_error', LEAK)));
    const response = await f.upload(Buffer.from('data'), true);

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: 'project environment operation failed' });
    expect(body(response)).not.toContain('Errno');
    expect(body(response)).not.toContain('.elowen-upload');
    expect(body(response)).not.toContain('/workspace');
  });

  /** A protocol violation is the transport talking to itself. Nobody at a browser can act on it, so it
   *  is not in the table and must not become a 4xx that looks like the caller's fault. */
  it.each(['guest_protocol'])('keeps %s internal', async code => {
    const f = fixture(failingAt(guestFailure(code, LEAK)));
    const response = await f.upload(Buffer.from('data'), true);
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: 'project environment operation failed' });
  });

  /** The lookup key is a string the provider chose, so it can be the name of something every object
   *  inherits. None of these is a refusal the editor knows, and each one must end where any other
   *  unknown code ends. */
  it.each(['constructor', 'toString', '__proto__'])('treats the inherited name %s as unknown', async code => {
    const f = fixture(failingAt(guestFailure(code, LEAK, 409)));
    const response = await f.upload(Buffer.from('data'), true);

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: 'project environment operation failed' });
    expect(body(response)).not.toContain('Errno');
    expect(body(response)).not.toContain('.elowen-upload');
    expect(body(response)).not.toContain('/workspace');
  });

  it('does not repeat a failure that carries no code at all', async () => {
    const f = fixture(failingAt(Object.assign(new Error(LEAK), { status: 409 })));
    const response = await f.upload(Buffer.from('data'), true);

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: 'project environment operation failed' });
    expect(body(response)).not.toContain('Errno');
  });

  /** The status a provider happens to attach is not authority: only a code in the table is. */
  it('ignores a 4xx status attached to a code the editor does not know', async () => {
    const f = fixture(failingAt(guestFailure('upload_teapot', LEAK, 418)));
    const response = await f.upload(Buffer.from('data'), true);
    expect(response.status).toBe(503);
    expect(body(response)).not.toContain('Errno');
  });

  /** The gate is the operation, not just the code: a stat that somehow answers with an UPLOAD code is
   *  not an upload refusal and must not be dressed as one. `not_directory` is the one exception, and it
   *  is not an exception to this rule but a separate decision the preflight makes deliberately. */
  it('does not translate an upload code raised by a non-upload operation', async () => {
    const f = fixture(operation => {
      if (operation.kind === 'stat') throw guestFailure('upload_conflict', LEAK);
      throw new Error(`unexpected operation ${operation.kind}`);
    });
    const response = await f.upload(Buffer.from('data'), true);
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: 'project environment operation failed' });
  });
});

describe('the compare-and-swap answers survive the allowlist', () => {
  /** A conflict on an upload opened against a FRESH destination can only be an occupied destination:
   *  there was no version to be stale. Derived from the request, not from the provider's wording, which
   *  is now one fixed string for both halves of the conflict. */
  it('reports an occupied destination as already exists when the upload was not an overwrite', async () => {
    const f = fixture(failingAt(guestFailure('version_conflict', 'Destination already exists')));
    const response = await f.upload(Buffer.from('data'), false);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'already exists' });
    // A fresh-destination upload opens the compare-and-swap against no version at all.
    expect(f.operations.find(o => o.kind === 'write-begin')).toMatchObject({ expectedVersion: null });
  });

  it('reports a stale version as a content version conflict when the upload was an overwrite', async () => {
    const f = fixture(failingAt(guestFailure('version_conflict', 'Content version no longer matches')));
    const response = await f.upload(Buffer.from('data'), true);

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: 'content version conflict' });
    expect(f.operations.find(o => o.kind === 'write-begin')).toMatchObject({ expectedVersion: 'v1' });
  });

  /** The abort is what keeps a failed upload from owning its destination, and it still runs for a
   *  refusal the allowlist rewrote. */
  it('releases the guest handle after a refusal, and keeps the refusal as the answer', async () => {
    const f = fixture(operation => {
      if (operation.kind === 'write-chunk') throw guestFailure('chunk_conflict', LEAK);
      if (operation.kind === 'write-begin') return { kind: 'write-begin', uploadId: 'u1', chunkSize: 4, received: 0, resolvedPath: '/workspace/dir/file.bin' };
      if (operation.kind === 'write-abort') return { kind: 'write-abort', aborted: true };
      if (operation.kind === 'stat') return { kind: 'stat', entry: { path: '/workspace/dir/file.bin', kind: 'file', size: 4, modifiedAt: '2026-01-01T00:00:00.000Z', version: 'v1' } };
      throw new Error(`unexpected operation ${operation.kind}`);
    });
    const response = await f.upload(Buffer.from('12345678'), true);

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: 'a different chunk already occupies this offset' });
    expect(f.operations.map(o => o.kind)).toContain('write-abort');
    expect(body(response)).not.toContain('Errno');
  });
});

/** A destination whose ANCESTOR is not a directory. The guest names that fact with the same code
 *  wherever it establishes it: a followed stat resolving through a file says so, and so does the step
 *  that builds an upload's ancestry. Both spellings of the same request must arrive at the same refusal,
 *  and an overwrite must not turn it into something else on the way. */
describe('a non-directory ancestor is the same refusal with or without overwrite', () => {
  const statSaysNotDirectory = (operation: GuestFileOperation): GuestFileResult => {
    if (operation.kind === 'stat') throw guestFailure('not_directory', 'Path resolves through something that is not a directory');
    if (operation.kind === 'write-begin') throw guestFailure('not_directory', 'Upload destination is inside something that is not a directory');
    if (operation.kind === 'write-abort') return { kind: 'write-abort', aborted: true };
    throw new Error(`unexpected operation ${operation.kind}`);
  };

  it('answers 409 with the static message when the overwrite preflight names it', async () => {
    const f = fixture(statSaysNotDirectory);
    const response = await f.upload(Buffer.from('data'), true);

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: 'upload destination is inside something that is not a directory' });
    // The preflight settled it, so the upload was never opened.
    expect(f.operations.some(o => o.kind === 'write-begin')).toBe(false);
    expect(f.operations.filter(o => o.kind === 'stat')).toHaveLength(1);
  });

  it('answers 409 with the same message when a fresh upload names it at write-begin', async () => {
    const f = fixture(statSaysNotDirectory);
    const response = await f.upload(Buffer.from('data'), false);

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: 'upload destination is inside something that is not a directory' });
    // A fresh destination has no version to ask for, so the first thing it does is open the upload.
    expect(f.operations.filter(o => o.kind === 'stat')).toHaveLength(0);
  });

  /** The preflight translates exactly one code. Anything else is what it is, and none of it opens an
   *  upload it has no version for. */
  it.each([
    ['permission_denied', 403],
    ['guest_file_error', 409],
    ['environment_busy', 409],
    ['project_gone', 500],
  ])('rethrows %s untouched, and opens no upload', async (code, status) => {
    const f = fixture(operation => {
      if (operation.kind === 'stat') throw Object.assign(new Error(LEAK), { code, status });
      throw new Error(`unexpected operation ${operation.kind}`);
    });
    const response = await f.upload(Buffer.from('data'), true);

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: 'project environment operation failed' });
    expect(body(response)).not.toContain('Errno');
    expect(body(response)).not.toContain('.elowen-upload');
    expect(f.operations.some(o => o.kind === 'write-begin')).toBe(false);
  });

  /** An access refusal is a decision about the caller and keeps its own meaning through the preflight. */
  it('lets a project refusal through as the 403 it is', async () => {
    const f = fixture(operation => {
      if (operation.kind === 'stat') throw Object.assign(new Error('Project access is denied'), { code: 'project_forbidden', status: 403 });
      throw new Error(`unexpected operation ${operation.kind}`);
    });
    const response = await f.upload(Buffer.from('data'), true);
    expect(response.status).toBe(403);
    expect(f.operations.some(o => o.kind === 'write-begin')).toBe(false);
  });
});

/** An overwrite through a link versions against what the link points at, and a link pointing nowhere is
 *  a destination that is not there. Neither goes near the preflight's one translation. */
describe('symlink destinations are unchanged by the preflight', () => {
  const withStat = (entry: GuestFileResult) => (operation: GuestFileOperation): GuestFileResult => {
    if (operation.kind === 'stat') {
      expect(operation.followSymlinks).toBe(true);
      return entry;
    }
    if (operation.kind === 'write-begin') return { kind: 'write-begin', uploadId: 'u1', chunkSize: 524288, received: 0, resolvedPath: '/workspace/dir/file.bin' };
    if (operation.kind === 'write-chunk') return { kind: 'write-chunk', received: 4 };
    if (operation.kind === 'write-commit') return { kind: 'write-commit', entry: { path: '/workspace/dir/file.bin', kind: 'file', size: 4, modifiedAt: '2026-01-01T00:00:00.000Z', version: 'v2' } };
    throw new Error(`unexpected operation ${operation.kind}`);
  };

  it("versions an overwrite against the link's target", async () => {
    const f = fixture(withStat({ kind: 'stat', entry: { path: '/workspace/dir/file.bin', kind: 'file', size: 9, modifiedAt: '2026-01-01T00:00:00.000Z', version: 'target-v1' } }));
    const response = await f.upload(Buffer.from('data'), true);

    expect(response.body).toMatchObject({ ok: true });
    expect(f.operations.find(o => o.kind === 'write-begin')).toMatchObject({ expectedVersion: 'target-v1' });
  });

  it('treats a link that points nowhere as a destination that is not there', async () => {
    const f = fixture(withStat({ kind: 'stat', entry: null }));
    const response = await f.upload(Buffer.from('data'), true);

    expect(response.body).toMatchObject({ ok: true });
    expect(f.operations.find(o => o.kind === 'write-begin')).toMatchObject({ expectedVersion: null });
  });
});
