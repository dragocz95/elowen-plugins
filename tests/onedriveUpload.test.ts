// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { FileHandle } from 'node:fs/promises';
import { Drive, uploadTimeoutMs } from '../plugins/onedrive/src/drive.js';
import type { MicrosoftDriveGraph, MicrosoftGraphRequestOptions } from '../plugins/onedrive/src/coreSeams.js';

interface Call {
  method: string;
  path: string;
  options?: MicrosoftGraphRequestOptions;
}

/** A file of a given size without the bytes. `uploadSmall` reads through the handle and `uploadLarge`
 *  walks it in chunks, so a handle that simply fills whatever buffer it is handed exercises both paths
 *  at sizes it would be absurd to actually allocate. */
function fakeFile(size: number): { handle: FileHandle; size: number } {
  const handle = {
    async read(buffer: Buffer, offset: number, length: number, position: number) {
      const remaining = Math.max(0, size - position);
      const bytesRead = Math.min(length, remaining);
      buffer.fill(0x61, offset, offset + bytesRead);
      return { bytesRead, buffer };
    },
  };
  return { handle: handle as unknown as FileHandle, size };
}

const conflict = () => Object.assign(new Error('The specified item name already exists.'), {
  status: 409, code: 'nameAlreadyExists',
});
const notFound = () => Object.assign(new Error('not found'), { status: 404 });

/** A Graph double that records every call and answers from `handlers`, in order of registration. */
function fakeGraph(handler: (call: Call) => unknown): { graph: MicrosoftDriveGraph; calls: Call[] } {
  const calls: Call[] = [];
  const graph: MicrosoftDriveGraph = {
    json: async (method, path, options) => {
      calls.push({ method, path, options });
      return handler({ method, path, options });
    },
    binary: async () => ({ body: new Uint8Array(), contentType: 'application/octet-stream' }),
    request: async () => new Response(null, { status: 200 }),
  };
  return { graph, calls };
}

const uploaded = (id: string) => ({ id, name: 'big.zip', eTag: `etag-${id}`, size: 1, file: {} });

describe('onedrive upload routing', () => {
  it('sends a file past the old 4 MiB boundary as one PUT instead of an upload session', async () => {
    const { graph, calls } = fakeGraph(({ path }) => {
      if (path.includes('createUploadSession')) throw new Error('should not open an upload session');
      return uploaded('id-1');
    });

    const item = await new Drive(graph, 'drive-1').upload('folder-1', 'marketing/big.zip', fakeFile(15 * 1024 * 1024), undefined, true);

    expect(item.id).toBe('id-1');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe('PUT');
    expect(calls[0]!.path).toContain(':/content');
  });

  it('still opens an upload session above the size Graph accepts in one PUT', async () => {
    const { graph, calls } = fakeGraph(({ path }) => {
      if (path.includes('createUploadSession')) throw new Error('session opened');
      return uploaded('id-1');
    });

    await expect(
      new Drive(graph, 'drive-1').upload('folder-1', 'huge.bin', fakeFile(251 * 1024 * 1024), undefined, true),
    ).rejects.toThrow('session opened');
    expect(calls[0]!.path).toContain('createUploadSession');
  });

  it('gives the upload a deadline that grows with the file instead of the default JSON one', async () => {
    const { graph, calls } = fakeGraph(() => uploaded('id-1'));

    await new Drive(graph, 'drive-1').upload('folder-1', 'big.zip', fakeFile(20 * 1024 * 1024), undefined, true);

    expect(calls[0]!.options?.timeoutMs).toBe(uploadTimeoutMs(20 * 1024 * 1024));
    // Well past the 15 s the Graph client would otherwise impose, which alone would abort this upload.
    expect(calls[0]!.options!.timeoutMs!).toBeGreaterThan(60_000);
  });
});

describe('onedrive upload name-conflict recovery', () => {
  it('stops a dead upload session holding a name from blocking the file forever', async () => {
    let attempts = 0;
    const { graph, calls } = fakeGraph(({ method, path }) => {
      if (method === 'GET') throw notFound();
      attempts += 1;
      // The reservation from an interrupted session refuses the create, but the folder listing that
      // decided this file was new cannot see it, so every later cycle asks exactly the same question.
      if (path.includes('conflictBehavior=fail')) throw conflict();
      return uploaded('id-2');
    });

    const item = await new Drive(graph, 'drive-1').upload('folder-1', 'marketing-zip/1.zip', fakeFile(1024), undefined, true);

    expect(item.id).toBe('id-2');
    expect(attempts).toBe(2);
    // The overwrite is allowed only because Graph was asked, and answered that nothing is there.
    expect(calls.map((call) => call.method)).toEqual(['PUT', 'GET', 'PUT']);
    expect(calls[2]!.path).not.toContain('conflictBehavior=fail');
  });

  it('refuses to overwrite a file that really is at the path', async () => {
    let puts = 0;
    const { graph } = fakeGraph(({ method }) => {
      if (method === 'GET') return { id: 'somebody-elses-file' };
      puts += 1;
      throw conflict();
    });

    await expect(
      new Drive(graph, 'drive-1').upload('folder-1', 'marketing-zip/1.zip', fakeFile(1024), undefined, true),
    ).rejects.toThrow('already exists');
    // One attempt only: a real item is a merge for the next cycle, never something to replace.
    expect(puts).toBe(1);
  });

  it('leaves a conflict alone when the mirror knew the file was there', async () => {
    let gets = 0;
    const { graph } = fakeGraph(({ method }) => {
      if (method === 'GET') { gets += 1; return { id: 'x' }; }
      throw conflict();
    });

    // With an etag the upload is a conditional replace, so a conflict means something this recovery
    // must not touch. It must not even ask.
    await expect(
      new Drive(graph, 'drive-1').upload('folder-1', 'a.zip', fakeFile(1024), 'etag-known', true),
    ).rejects.toThrow('already exists');
    expect(gets).toBe(0);
  });
});
