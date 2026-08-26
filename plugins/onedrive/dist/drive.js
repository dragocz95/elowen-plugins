import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, rename, mkdir, stat, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { PART_PREFIX } from './scan.js';
/** Microsoft's own boundary for a plain content PUT. Above it an upload session is required, and the
 *  chunk size must be a multiple of 320 KiB — their documented requirement, not a tuning choice. */
const SIMPLE_UPLOAD_MAX = 4 * 1024 * 1024;
const CHUNK = 320 * 1024 * 10;
const asRecord = (value) => (value && typeof value === 'object' ? value : {});
/** Only a genuine "it is not there" may be read as absence. Every other failure — throttling, an outage,
 *  a revoked grant — must propagate, because treating it as absence is how a mirror deletes files. */
export function isNotFound(error) {
    const status = error?.status;
    return status === 404;
}
/** Percent-encode each path segment for a Graph `root:/…:` addressing expression. Encoding the whole
 *  path in one go would escape the separators too and address a single oddly named file. */
export function encodePath(path) {
    return path.split('/').filter(Boolean).map(encodeURIComponent).join('/');
}
/** Turn one Graph item into the shape the merge cares about. `parentReference.path` arrives as
 *  `/drive/root:/Elowen/projects/site`, so the mirror-relative path is what follows `root:`. */
export function itemFromGraph(raw) {
    const value = asRecord(raw);
    const id = typeof value.id === 'string' ? value.id : '';
    const name = typeof value.name === 'string' ? value.name : '';
    if (!id || !name)
        return null;
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
/** The local file changed while its replacement was being fetched. Not a failure of the download - a
 *  signal that the two sides diverged and the cycle must merge rather than overwrite. */
export class StaleLocalError extends Error {
    path;
    constructor(path) {
        super(`The local file changed while it was being downloaded: ${path}`);
        this.path = path;
        this.name = 'StaleLocalError';
    }
}
export class Drive {
    graph;
    driveId;
    constructor(graph, driveId) {
        this.graph = graph;
        this.driveId = driveId;
    }
    static async open(graph) {
        const me = asRecord(await graph.json('GET', '/me/drive?$select=id'));
        const id = typeof me.id === 'string' ? me.id : '';
        if (!id)
            throw new Error('Microsoft did not return a drive for this account.');
        return new Drive(graph, id);
    }
    base() { return `/drives/${encodeURIComponent(this.driveId)}`; }
    /** Create every missing folder along `path` and return the leaf. Idempotent by construction: an
     *  existing folder answers the GET and is left exactly as it is. */
    async ensureFolder(path) {
        const segments = path.split('/').filter(Boolean);
        let current = '';
        let item = asRecord(await this.graph.json('GET', `${this.base()}/root?$select=id,webUrl`));
        for (const segment of segments) {
            const next = current ? `${current}/${segment}` : segment;
            try {
                item = asRecord(await this.graph.json('GET', `${this.base()}/root:/${encodePath(next)}?$select=id,webUrl`));
            }
            catch (error) {
                // ONLY a 404 means "create it". Swallowing every error here would turn a throttle or an outage
                // into a second folder with the same name, and the mirror would then have two homes.
                if (!isNotFound(error))
                    throw error;
                const parentId = typeof item.id === 'string' ? item.id : '';
                item = asRecord(await this.graph.json('POST', `${this.base()}/items/${encodeURIComponent(parentId)}/children`, {
                    body: { name: segment, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' },
                }));
            }
            current = next;
        }
        return {
            id: typeof item.id === 'string' ? item.id : '',
            webUrl: typeof item.webUrl === 'string' ? item.webUrl : null,
        };
    }
    /** Every FILE currently under one mirror folder, keyed by its path relative to that folder.
     *
     *  Deliberately a full listing rather than a delta. A delta answers "what changed", and absence from it
     *  means UNCHANGED — but the mirror needs to know what EXISTS, and the two are only the same thing when
     *  a complete history has been replayed without a gap. Any truncation, any newly connected mirror
     *  sharing a cursor, any partially failed cycle turns "absent from the delta" into a phantom deletion,
     *  which on this code path means deleting somebody's files. Listing costs more requests and cannot lie.
     *
     *  A folder that does not exist yet reads as empty rather than throwing: that is the state of a mirror
     *  connected a moment ago. `truncated` is reported rather than swallowed, because a partial listing must
     *  never be mistaken for a complete one by the caller that decides what to delete. */
    async listTree(folderId, limit = 20_000) {
        const files = new Map();
        // The mirror root missing is a real event - somebody deleted the folder in OneDrive - but reading it
        // as an empty listing would move that person's whole project into the local trash. Say so instead.
        try {
            await this.graph.json('GET', `${this.base()}/items/${encodeURIComponent(folderId)}?$select=id`);
        }
        catch (error) {
            if (isNotFound(error))
                throw new Error('The mirrored OneDrive folder no longer exists. Connect the mirror again.');
            throw error;
        }
        const queue = [{ id: folderId, prefix: '' }];
        let truncated = false;
        while (queue.length > 0) {
            const current = queue.shift();
            let url = `${this.base()}/items/${encodeURIComponent(current.id)}/children?$top=200&$select=id,name,eTag,cTag,size,file,folder`;
            while (url) {
                let body;
                try {
                    body = asRecord(await this.graph.json('GET', url));
                }
                catch (error) {
                    // A folder that vanished mid-walk makes this listing an inconsistent snapshot, and the caller
                    // uses the listing to decide what to DELETE. Report it as truncated rather than letting the
                    // missing subtree read as "those files do not exist".
                    if (isNotFound(error)) {
                        truncated = true;
                        break;
                    }
                    throw error;
                }
                // An answer we cannot parse is not an empty folder. Guessing "empty" here deletes local files.
                if (!Array.isArray(body.value))
                    throw new Error('Microsoft returned a folder listing this mirror cannot read.');
                for (const raw of body.value) {
                    const value = asRecord(raw);
                    const name = typeof value.name === 'string' ? value.name : '';
                    const id = typeof value.id === 'string' ? value.id : '';
                    if (!name || !id)
                        throw new Error('Microsoft returned a folder entry without an id or a name.');
                    const tag = typeof value.eTag === 'string' ? value.eTag : (typeof value.cTag === 'string' ? value.cTag : '');
                    // Every mutating call downstream is conditional on this. An entry without one would silently
                    // turn `If-Match` off and let an upload or a delete clobber a change made since the listing.
                    if (!('folder' in value) && !tag) {
                        throw new Error('Microsoft returned a file with no version tag, so this cycle cannot be applied safely.');
                    }
                    const path = current.prefix ? `${current.prefix}/${name}` : name;
                    if ('folder' in value) {
                        queue.push({ id, prefix: path });
                        continue;
                    }
                    if (files.size >= limit) {
                        truncated = true;
                        break;
                    }
                    files.set(path, {
                        id,
                        name,
                        etag: tag,
                        size: typeof value.size === 'number' ? value.size : 0,
                        isFolder: false,
                        path,
                        deleted: false,
                    });
                }
                if (truncated)
                    break;
                const nextLink = typeof body['@odata.nextLink'] === 'string' ? body['@odata.nextLink'] : '';
                if (!nextLink) {
                    url = null;
                    break;
                }
                const parsed = new URL(nextLink);
                url = `${parsed.pathname.replace(/^\/v1\.0/, '')}${parsed.search}`;
            }
            if (truncated)
                break;
        }
        return { files, truncated };
    }
    /** `ifMatch` is the etag this mirror last saw. Without it an edit made in OneDrive since the listing
     *  would be overwritten silently; with it Graph answers 412 and the next cycle merges properly.
     *
     *  `expectNew` covers the case with no etag to send: the mirror believes the file does not exist there
     *  at all. `fail` makes Graph refuse if somebody created it in the meantime, which again becomes a
     *  merge next cycle instead of a replaced file. */
    /** Does this item still exist? Asked about ONE path, immediately before that path is destroyed on the
     *  other side, because a folder listing is a walk and not a snapshot: a file moved between folders
     *  while the walk was in progress can be absent from every page while still existing. Deleting on the
     *  strength of that is how a mirror loses a file nobody touched. */
    async stillExists(itemId) {
        return await this.currentTag(itemId) !== null;
    }
    /** The item's CURRENT version tag, or null when it is genuinely gone. Anything else throws: a throttle
     *  or an outage is not an answer about whether somebody else has changed a file. */
    async currentTag(itemId) {
        try {
            const item = asRecord(await this.graph.json('GET', `${this.base()}/items/${encodeURIComponent(itemId)}?$select=id,eTag,cTag`));
            return typeof item.eTag === 'string' ? item.eTag : (typeof item.cTag === 'string' ? item.cTag : '');
        }
        catch (error) {
            if (isNotFound(error))
                return null;
            throw error;
        }
    }
    async upload(remotePath, absolute, ifMatch, expectNew = false) {
        const size = (await stat(absolute)).size;
        return size <= SIMPLE_UPLOAD_MAX
            ? this.uploadSmall(remotePath, absolute, ifMatch, expectNew)
            : this.uploadLarge(remotePath, absolute, size, ifMatch, expectNew);
    }
    async uploadSmall(remotePath, absolute, ifMatch, expectNew = false) {
        const handle = await open(absolute, 'r');
        try {
            const body = await handle.readFile();
            const behavior = expectNew && !ifMatch ? '?%40microsoft.graph.conflictBehavior=fail' : '';
            const raw = await this.graph.json('PUT', `${this.base()}/root:/${encodePath(remotePath)}:/content${behavior}`, {
                body, contentType: 'application/octet-stream', ...(ifMatch ? { ifMatch } : {}),
            });
            return itemFromGraph(raw) ?? { id: '', name: '', etag: '', size: 0, isFolder: false, path: remotePath, deleted: false };
        }
        finally {
            await handle.close();
        }
    }
    async uploadLarge(remotePath, absolute, size, ifMatch, expectNew = false) {
        // The precondition belongs on the SESSION, not on the chunks: Graph evaluates it when the session is
        // created and again when it commits, so a remote edit made mid-upload still fails the commit rather
        // than replacing the newer content.
        const session = asRecord(await this.graph.json('POST', `${this.base()}/root:/${encodePath(remotePath)}:/createUploadSession`, {
            body: { item: { '@microsoft.graph.conflictBehavior': expectNew && !ifMatch ? 'fail' : 'replace' } },
            ...(ifMatch ? { ifMatch } : {}),
        }));
        const uploadUrl = typeof session.uploadUrl === 'string' ? session.uploadUrl : '';
        if (!uploadUrl)
            throw new Error('Microsoft did not open an upload session.');
        let offset = 0;
        let last = null;
        const stream = createReadStream(absolute, { highWaterMark: CHUNK });
        for await (const chunk of stream) {
            const buffer = chunk;
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
            if (response.status !== 202)
                last = await response.json().catch(() => null);
        }
        return itemFromGraph(last) ?? { id: '', name: '', etag: '', size, isFolder: false, path: remotePath, deleted: false };
    }
    /** Fetch one item into `absolute`. Written to a sibling temporary file and renamed, so a reader never
     *  observes a half-written file and an interrupted download leaves the previous content intact. */
    async download(itemId, absolute, guard) {
        const { body } = await this.graph.binary(`${this.base()}/items/${encodeURIComponent(itemId)}/content`, {
            maxBytes: 1024 * 1024 * 1024,
        });
        await mkdir(dirname(absolute), { recursive: true });
        // The temporary name carries the PART_PREFIX the ignore floor knows, so a crash between writing and
        // renaming leaves a file the next scan will never mistake for project content and upload.
        const temporary = join(dirname(absolute), `${PART_PREFIX}${process.pid}-${Date.now()}`);
        try {
            const handle = await open(temporary, 'w');
            try {
                await handle.writeFile(body);
                await handle.sync();
            }
            finally {
                await handle.close();
            }
            // Downloading takes time, and the local file may have been saved since it was scanned. The guard
            // is checked as late as possible - after the bytes are on disk, immediately before they replace
            // anything - because that is the only point where the answer is still current.
            if (guard && !await guard()) {
                await unlink(temporary).catch(() => undefined);
                throw new StaleLocalError(absolute);
            }
            await rename(temporary, absolute);
        }
        catch (error) {
            await unlink(temporary).catch(() => undefined);
            throw error;
        }
    }
    /** Content hash of a remote item, WITHOUT writing it into the project.
     *
     *  Used to answer "are these two files actually the same?" when there is no baseline to compare
     *  against - on a first connect, or after a disconnect and reconnect. Without it every already-matching
     *  file is reported as a conflict, which is safe but turns reconnecting into a pile of busywork. */
    async sha256(itemId) {
        const { body } = await this.graph.binary(`${this.base()}/items/${encodeURIComponent(itemId)}/content`, {
            maxBytes: 1024 * 1024 * 1024,
        });
        return createHash('sha256').update(Buffer.from(body)).digest('hex');
    }
    /** Conditional on the etag the mirror last saw. An unconditional delete would destroy an edit somebody
     *  made in OneDrive between the listing and this call - and since the local copy is already gone, that
     *  version would exist nowhere. */
    async remove(itemId, ifMatch) {
        await this.graph.json('DELETE', `${this.base()}/items/${encodeURIComponent(itemId)}`, {
            ...(ifMatch ? { ifMatch } : {}),
        });
    }
}
