import { MAX_BUFFERED_BYTES, MAX_UPLOAD_CHUNK_BYTES } from '../../src/fileTypes';

/** A refusal worth showing the user verbatim. */
export class UploadError extends Error {}

async function refusal(response: Response): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: unknown } | null;
  return typeof body?.error === 'string' ? body.error : `HTTP ${response.status}`;
}

/** Sends one file to the project, in chunks the daemon's body cap can carry.
 *
 *  Sequential on purpose. The server appends and refuses a chunk whose offset does not match what it
 *  already holds, so parallel requests would race into "upload out of order" — and the wire is the
 *  bottleneck here anyway, not the round trip. The download route is a plain anchor for the same
 *  reason this is a plain fetch: neither is a query, so neither belongs in the host's query hooks. */
export async function uploadFile(
  projectId: number,
  path: string,
  file: File,
  options?: { overwrite?: boolean; onProgress?: (sent: number, total: number) => void; signal?: AbortSignal },
): Promise<void> {
  if (file.size > MAX_BUFFERED_BYTES) throw new UploadError('file too large');
  const overwrite = options?.overwrite ? '1' : '0';
  let offset = 0;
  // A do/while, not a while: a zero-byte file is a real file, and a loop keyed on remaining bytes
  // would send nothing at all and report success for something it never created.
  do {
    const chunk = file.slice(offset, offset + MAX_UPLOAD_CHUNK_BYTES);
    const final = offset + chunk.size >= file.size;
    const query = `path=${encodeURIComponent(path)}&offset=${offset}&overwrite=${overwrite}${final ? '&final=1' : ''}`;
    const response = await fetch(`/api/projects/${projectId}/upload?${query}`, {
      method: 'PUT',
      body: chunk,
      headers: { 'content-type': 'application/octet-stream' },
      signal: options?.signal,
    });
    if (!response.ok) throw new UploadError(await refusal(response));
    offset += chunk.size;
    options?.onProgress?.(offset, file.size);
  } while (offset < file.size);
}
