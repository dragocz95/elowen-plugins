import { createHash } from 'node:crypto';
import { open, rename, mkdir, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { PART_PREFIX } from './scan.js';
/** Microsoft's own boundary for a plain content PUT. Graph documents `PUT /content` as supporting files
 *  up to 250 MB, and only above it is an upload session required; the 320 KiB chunk multiple is likewise
 *  their documented requirement, not a tuning choice.
 *
 *  Sitting far below the real ceiling bought nothing and cost reliability. A session is a multi-request
 *  dance, and its reservation on the file NAME outlives a connection that dies mid-flight: the folder
 *  listing cannot see a half-finished session, so the mirror keeps believing the file is new, keeps
 *  creating it with `fail`, and keeps being told the name already exists. That is a permanent loop no
 *  cycle can leave. A single PUT either lands or does not, so every file Graph will take that way goes
 *  that way. */
const SIMPLE_UPLOAD_MAX = 250 * 1024 * 1024;
const CHUNK = 320 * 1024 * 10;
/** A chunk PUT goes straight to a pre-authenticated storage URL, outside the Graph client and its own
 *  bounds. Without a deadline one stalled connection holds the cycle open for as long as the socket lives,
 *  and the interval walks accounts one at a time - so a single hung upload stops every mirror on the
 *  instance, not just this one. */
const CHUNK_TIMEOUT_MS = 120_000;
/** How long ONE content PUT may take. The Graph client's default deadline is sized for a JSON round trip
 *  and would abort a large upload long before a healthy link had finished it — raising the simple-upload
 *  ceiling without this would just move the failure. So the deadline follows the file: a fixed grace for
 *  the round trip plus the time the body needs at a deliberately pessimistic floor rate. Nothing waits
 *  this long in the normal case; it is the point at which a stalled socket is given up on. */
const UPLOAD_FLOOR_BYTES_PER_SECOND = 256 * 1024;
const UPLOAD_GRACE_MS = 60_000;
export const uploadTimeoutMs = (size) => UPLOAD_GRACE_MS + Math.ceil(Math.max(size, 0) / UPLOAD_FLOOR_BYTES_PER_SECOND) * 1_000;
const asRecord = (value) => (value && typeof value === 'object' ? value : {});
/** Only a genuine "it is not there" may be read as absence. Every other failure — throttling, an outage,
 *  a revoked grant — must propagate, because treating it as absence is how a mirror deletes files. */
export function isNotFound(error) {
    const status = error?.status;
    return status === 404;
}
/** Graph's "that name is already taken", the answer to a create that was told to refuse a collision.
 *  Matched on the code as well as the status, because 409 also covers conflicts this must not react to —
 *  and what it drives is a retry that overwrites. */
export function isNameConflict(error) {
    const value = error;
    return value?.status === 409 && value?.code === 'nameAlreadyExists';
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
    /** Where one mirrored file lives, expressed RELATIVE TO THE MIRROR FOLDER'S ITEM ID.
     *
     *  Graph item ids survive a move or a rename; paths do not. Addressing `root:/<stored path>` meant that
     *  the moment somebody dragged the mirror folder somewhere else in OneDrive, uploads kept writing to the
     *  old location - recreating the folder they had just moved - while the listing, which already went by
     *  item id, read the new one. The mirror split in two and neither half was wrong on its own terms. */
    itemAddress(folderId, rel) {
        return `${this.base()}/items/${encodeURIComponent(folderId)}:/${encodePath(rel)}`;
    }
    /** The same address in the form that takes a trailing action (`…:/content`, `…:/createUploadSession`). */
    itemPath(folderId, rel) {
        return `${this.itemAddress(folderId, rel)}:`;
    }
    /** Is there a real, addressable item at this path? Asked only when Graph has just refused to create one
     *  because the name is taken, while the folder listing said the name was free.
     *
     *  Those two answers are not a contradiction: a listing cannot see the name an unfinished upload session
     *  is holding. So a 404 here is the signature of an upload of OURS that died mid-flight, leaving a
     *  reservation and nothing a user can see — and a real item is a real item, which the mirror must merge
     *  rather than overwrite. */
    async itemIdAt(folderId, rel) {
        try {
            const item = asRecord(await this.graph.json('GET', `${this.itemAddress(folderId, rel)}?$select=id`));
            return typeof item.id === 'string' && item.id ? item.id : null;
        }
        catch (error) {
            if (isNotFound(error))
                return null;
            throw error;
        }
    }
    /** Uploads from an ALREADY-OPEN descriptor. The caller opened it under `O_NOFOLLOW` and verified it, so
     *  the bytes sent are the bytes that were checked - reopening the path here would hand a symlink swapped
     *  in since then a way out of the project. */
    async upload(folderId, rel, file, ifMatch, expectNew = false) {
        const send = (asNew) => file.size <= SIMPLE_UPLOAD_MAX
            ? this.uploadSmall(folderId, rel, file, ifMatch, asNew)
            : this.uploadLarge(folderId, rel, file, ifMatch, asNew);
        try {
            return await send(expectNew);
        }
        catch (error) {
            // `expectNew` refuses to overwrite something this mirror has never seen, and that refusal stays
            // intact: the retry below happens ONLY once Graph has confirmed there is nothing at the path to
            // overwrite. Without it the refusal is permanent rather than protective — the name stays reserved
            // by our own dead upload session, every later cycle asks the same question and gets the same no,
            // and the file never syncs again.
            if (!expectNew || ifMatch || !isNameConflict(error))
                throw error;
            if (await this.itemIdAt(folderId, rel) !== null)
                throw error;
            return await send(false);
        }
    }
    async uploadSmall(folderId, rel, file, ifMatch, expectNew = false) {
        const body = Buffer.allocUnsafe(file.size);
        let read = 0;
        while (read < file.size) {
            const { bytesRead } = await file.handle.read(body, read, file.size - read, read);
            if (bytesRead === 0)
                break;
            read += bytesRead;
        }
        const behavior = expectNew && !ifMatch ? '?%40microsoft.graph.conflictBehavior=fail' : '';
        const raw = await this.graph.json('PUT', `${this.itemPath(folderId, rel)}/content${behavior}`, {
            body: body.subarray(0, read), contentType: 'application/octet-stream',
            timeoutMs: uploadTimeoutMs(read), ...(ifMatch ? { ifMatch } : {}),
        });
        return itemFromGraph(raw) ?? { id: '', name: '', etag: '', size: read, isFolder: false, path: rel, deleted: false };
    }
    async uploadLarge(folderId, rel, file, ifMatch, expectNew = false) {
        const size = file.size;
        // The precondition belongs on the SESSION, not on the chunks: Graph evaluates it when the session is
        // created and again when it commits, so a remote edit made mid-upload still fails the commit rather
        // than replacing the newer content.
        const session = asRecord(await this.graph.json('POST', `${this.itemPath(folderId, rel)}/createUploadSession`, {
            body: { item: { '@microsoft.graph.conflictBehavior': expectNew && !ifMatch ? 'fail' : 'replace' } },
            ...(ifMatch ? { ifMatch } : {}),
        }));
        const uploadUrl = typeof session.uploadUrl === 'string' ? session.uploadUrl : '';
        if (!uploadUrl)
            throw new Error('Microsoft did not open an upload session.');
        let offset = 0;
        let last = null;
        const buffer = Buffer.allocUnsafe(CHUNK);
        while (offset < size) {
            const { bytesRead } = await file.handle.read(buffer, 0, Math.min(CHUNK, size - offset), offset);
            if (bytesRead === 0)
                break;
            // The upload URL is pre-authenticated and MUST be called without the bearer, so this one request
            // goes out directly rather than through the scoped Graph client.
            const response = await fetch(uploadUrl, {
                method: 'PUT',
                headers: {
                    'content-length': String(bytesRead),
                    'content-range': `bytes ${offset}-${offset + bytesRead - 1}/${size}`,
                },
                body: new Uint8Array(buffer.subarray(0, bytesRead)),
                signal: AbortSignal.timeout(CHUNK_TIMEOUT_MS),
            });
            if (!response.ok && response.status !== 202) {
                throw new Error(`Microsoft refused an upload chunk (${response.status}).`);
            }
            offset += bytesRead;
            if (response.status !== 202)
                last = await response.json().catch(() => null);
        }
        return itemFromGraph(last) ?? { id: '', name: '', etag: '', size, isFolder: false, path: rel, deleted: false };
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
