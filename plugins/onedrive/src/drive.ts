import { createReadStream } from 'node:fs';
import { open, rename, mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { MicrosoftDriveGraph } from './coreSeams.js';

/** Microsoft's own boundary for a plain content PUT. Above it an upload session is required, and the
 *  chunk size must be a multiple of 320 KiB — their documented requirement, not a tuning choice. */
const SIMPLE_UPLOAD_MAX = 4 * 1024 * 1024;
const CHUNK = 320 * 1024 * 10;

export interface DriveItem {
  id: string;
  name: string;
  etag: string;
  size: number;
  isFolder: boolean;
  /** Path relative to the drive root, without a leading slash: `Elowen/projects/site/README.md`. */
  path: string;
  deleted: boolean;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  (value && typeof value === 'object' ? value as Record<string, unknown> : {});

/** Percent-encode each path segment for a Graph `root:/…:` addressing expression. Encoding the whole
 *  path in one go would escape the separators too and address a single oddly named file. */
export function encodePath(path: string): string {
  return path.split('/').filter(Boolean).map(encodeURIComponent).join('/');
}

/** Turn one delta entry into the shape the merge cares about. `parentReference.path` arrives as
 *  `/drive/root:/Elowen/projects/site`, so the mirror-relative path is what follows `root:`. */
export function itemFromDelta(raw: unknown): DriveItem | null {
  const value = asRecord(raw);
  const id = typeof value.id === 'string' ? value.id : '';
  const name = typeof value.name === 'string' ? value.name : '';
  if (!id || !name) return null;
  const parent = asRecord(value.parentReference);
  const parentPath = typeof parent.path === 'string' ? parent.path : '';
  const marker = parentPath.indexOf('root:');
  const prefix = marker === -1 ? '' : decodeURIComponent(parentPath.slice(marker + 'root:'.length)).replace(/^\/+/, '');
  return {
    id,
    name,
    etag: typeof value.eTag === 'string' ? value.eTag : (typeof value.cTag === 'string' ? value.cTag : ''),
    size: typeof value.size === 'number' ? value.size : 0,
    isFolder: 'folder' in value,
    path: prefix ? `${prefix}/${name}` : name,
    deleted: 'deleted' in value,
  };
}

export class Drive {
  constructor(private readonly graph: MicrosoftDriveGraph, readonly driveId: string) {}

  static async open(graph: MicrosoftDriveGraph): Promise<Drive> {
    const me = asRecord(await graph.json('GET', '/me/drive?$select=id'));
    const id = typeof me.id === 'string' ? me.id : '';
    if (!id) throw new Error('Microsoft did not return a drive for this account.');
    return new Drive(graph, id);
  }

  private base(): string { return `/drives/${encodeURIComponent(this.driveId)}`; }

  /** Create every missing folder along `path` and return the leaf. Idempotent by construction: an
   *  existing folder answers the GET and is left exactly as it is. */
  async ensureFolder(path: string): Promise<{ id: string; webUrl: string | null }> {
    const segments = path.split('/').filter(Boolean);
    let current = '';
    let item: Record<string, unknown> = asRecord(await this.graph.json('GET', `${this.base()}/root?$select=id,webUrl`));
    for (const segment of segments) {
      const next = current ? `${current}/${segment}` : segment;
      try {
        item = asRecord(await this.graph.json('GET', `${this.base()}/root:/${encodePath(next)}?$select=id,webUrl`));
      } catch {
        const parentId = typeof item.id === 'string' ? item.id : '';
        item = asRecord(await this.graph.json('POST', `${this.base()}/items/${encodeURIComponent(parentId)}/children`, {
          body: { name: segment, folder: {}, '@microsoft.graph.conflictBehavior': 'replace' },
        }));
      }
      current = next;
    }
    return {
      id: typeof item.id === 'string' ? item.id : '',
      webUrl: typeof item.webUrl === 'string' ? item.webUrl : null,
    };
  }

  /** Every change in the whole drive since `token`.
   *
   *  Deliberately taken at the ROOT rather than on each mirrored folder: root delta is universally
   *  supported, one stream serves a person's project and all their workspaces, and the caller filters to
   *  the subtree it owns. `nextToken` is returned rather than stored, so the caller can persist it only
   *  after the cycle it belongs to has actually succeeded. */
  async delta(token: string | null): Promise<{ items: DriveItem[]; nextToken: string | null }> {
    let url = token
      ? `${this.base()}/root/delta?token=${encodeURIComponent(token)}`
      : `${this.base()}/root/delta`;
    const items: DriveItem[] = [];
    let nextToken: string | null = null;

    for (let page = 0; page < 200; page++) {
      const body = asRecord(await this.graph.json('GET', url));
      for (const raw of Array.isArray(body.value) ? body.value : []) {
        const item = itemFromDelta(raw);
        if (item) items.push(item);
      }
      const deltaLink = typeof body['@odata.deltaLink'] === 'string' ? body['@odata.deltaLink'] : '';
      if (deltaLink) {
        nextToken = new URL(deltaLink).searchParams.get('token');
        break;
      }
      const nextLink = typeof body['@odata.nextLink'] === 'string' ? body['@odata.nextLink'] : '';
      if (!nextLink) break;
      const parsed = new URL(nextLink);
      url = `${parsed.pathname.replace(/^\/v1\.0/, '')}${parsed.search}`;
    }
    return { items, nextToken };
  }

  async upload(remotePath: string, absolute: string, ifMatch?: string): Promise<DriveItem> {
    const size = (await stat(absolute)).size;
    return size <= SIMPLE_UPLOAD_MAX
      ? this.uploadSmall(remotePath, absolute, ifMatch)
      : this.uploadLarge(remotePath, absolute, size);
  }

  private async uploadSmall(remotePath: string, absolute: string, ifMatch?: string): Promise<DriveItem> {
    const handle = await open(absolute, 'r');
    try {
      const body = await handle.readFile();
      const raw = await this.graph.json('PUT', `${this.base()}/root:/${encodePath(remotePath)}:/content`, {
        body, contentType: 'application/octet-stream', ...(ifMatch ? { ifMatch } : {}),
      });
      return itemFromDelta(raw) ?? { id: '', name: '', etag: '', size: 0, isFolder: false, path: remotePath, deleted: false };
    } finally {
      await handle.close();
    }
  }

  private async uploadLarge(remotePath: string, absolute: string, size: number): Promise<DriveItem> {
    const session = asRecord(await this.graph.json('POST', `${this.base()}/root:/${encodePath(remotePath)}:/createUploadSession`, {
      body: { item: { '@microsoft.graph.conflictBehavior': 'replace' } },
    }));
    const uploadUrl = typeof session.uploadUrl === 'string' ? session.uploadUrl : '';
    if (!uploadUrl) throw new Error('Microsoft did not open an upload session.');

    let offset = 0;
    let last: unknown = null;
    const stream = createReadStream(absolute, { highWaterMark: CHUNK });
    for await (const chunk of stream) {
      const buffer = chunk as Buffer;
      // The upload URL is pre-authenticated and MUST be called without the bearer, so this one request
      // goes out directly rather than through the scoped Graph client.
      const response = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'content-length': String(buffer.byteLength),
          'content-range': `bytes ${offset}-${offset + buffer.byteLength - 1}/${size}`,
        },
        body: new Uint8Array(buffer),
      });
      if (!response.ok && response.status !== 202) {
        throw new Error(`Microsoft refused an upload chunk (${response.status}).`);
      }
      offset += buffer.byteLength;
      if (response.status !== 202) last = await response.json().catch(() => null);
    }
    return itemFromDelta(last) ?? { id: '', name: '', etag: '', size, isFolder: false, path: remotePath, deleted: false };
  }

  /** Fetch one item into `absolute`. Written to a sibling temporary file and renamed, so a reader never
   *  observes a half-written file and an interrupted download leaves the previous content intact. */
  async download(itemId: string, absolute: string): Promise<void> {
    const { body } = await this.graph.binary(`${this.base()}/items/${encodeURIComponent(itemId)}/content`, {
      maxBytes: 1024 * 1024 * 1024,
    });
    await mkdir(dirname(absolute), { recursive: true });
    const temporary = join(dirname(absolute), `.onedrive-${process.pid}-${Date.now()}.part`);
    const handle = await open(temporary, 'w');
    try {
      await handle.writeFile(body);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, absolute);
  }

  async remove(itemId: string): Promise<void> {
    await this.graph.json('DELETE', `${this.base()}/items/${encodeURIComponent(itemId)}`);
  }

  async itemAt(remotePath: string): Promise<DriveItem | null> {
    try {
      return itemFromDelta(await this.graph.json('GET', `${this.base()}/root:/${encodePath(remotePath)}`));
    } catch {
      return null;
    }
  }
}
