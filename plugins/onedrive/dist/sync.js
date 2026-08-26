import { randomUUID } from 'node:crypto';
import { mkdir, rename, stat } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { Drive } from './drive.js';
import { decide } from './merge.js';
import { buildIgnore, containedIn, hashFile, scanLocal, TRASH_DIR } from './scan.js';
const LEASE_MS = 5 * 60 * 1000;
const SETTLE_MS = 2_000;
const MAX_FILES = 20_000;
/** Where a link's files live inside the person's OneDrive, relative to the drive root.
 *
 *  Projects and workspaces are SIBLINGS, never nested. Putting workspaces under the project mirror would
 *  make the project scan try to pull every workspace copy down into the project directory. */
export function remoteRootFor(rootFolder, projectSlug, link) {
    const root = rootFolder.replace(/^\/+|\/+$/g, '') || 'Elowen';
    return link.workspaceId
        ? `${root}/workspaces/${projectSlug}/${safeSegment(link.workspaceLabel ?? link.workspaceId)}`
        : `${root}/projects/${projectSlug}`;
}
export function safeSegment(value) {
    // OneDrive refuses these outright, and a path separator would silently create a nested folder.
    return String(value).replace(/[\\/:*?"<>|#%]+/g, '-').replace(/^\.+|\.+$/g, '').slice(0, 60) || 'workspace';
}
/** The name a remote copy is kept under when both sides moved. Deliberately beside the original and
 *  deliberately visible: a conflict the person never sees is a conflict resolved by coin toss. */
export function conflictName(rel, when) {
    const ext = extname(rel);
    const stamp = when.toISOString().slice(0, 19).replace(/[:T]/g, '-');
    return `${rel.slice(0, rel.length - ext.length)}.onedrive-conflict-${stamp}${ext}`;
}
export class SyncEngine {
    deps;
    running = false;
    owner = `${process.pid}-${randomUUID().slice(0, 8)}`;
    constructor(deps) {
        this.deps = deps;
    }
    /** One pass over every account that has a live mirror. Never throws: a cycle is background work and a
     *  single bad account must not stop the rest or crash the interval. */
    async tick() {
        if (this.running)
            return; // a slow cycle must not overlap itself
        this.running = true;
        try {
            for (const userId of this.deps.store.activeUserIds()) {
                try {
                    await this.syncUser(userId);
                }
                catch (error) {
                    this.deps.log.warn(`onedrive cycle for account ${userId}: ${message(error)}`);
                }
            }
        }
        finally {
            this.running = false;
        }
    }
    async syncUser(userId) {
        const identity = this.deps.identity();
        if (!identity)
            return; // Teams plugin absent or unconfigured: nothing to do, and nothing to complain about
        const graph = await identity.driveGraphFor(userId);
        if (!graph) {
            for (const link of this.deps.store.linksForUser(userId)) {
                if (link.enabled)
                    this.deps.store.setStatus(link.id, 'error', 'Microsoft sign-in is required again.');
            }
            return;
        }
        const drive = await Drive.open(graph);
        const links = this.deps.store.linksForUser(userId).filter((link) => link.enabled);
        if (links.length === 0)
            return;
        const cursor = this.deps.store.cursor(userId, drive.driveId);
        const { items, nextToken } = await drive.delta(cursor);
        const remote = indexRemote(items);
        let everySucceeded = true;
        for (const link of links) {
            try {
                await this.syncLink(link, drive, remote, cursor === null);
            }
            catch (error) {
                everySucceeded = false;
                this.deps.log.warn(`onedrive mirror ${link.id}: ${message(error)}`);
                this.deps.store.setStatus(link.id, 'error', message(error));
            }
        }
        // The cursor moves ONLY when the whole fan-out succeeded. Advancing it after a partial failure would
        // drop the changes the failed mirror never got to see, and nothing would ever go back for them.
        if (everySucceeded && nextToken)
            this.deps.store.setCursor(userId, drive.driveId, nextToken);
    }
    async syncLink(link, drive, remote, fullScan) {
        if (!this.deps.store.claim(link.id, this.owner, LEASE_MS))
            return;
        const settings = this.deps.settings();
        try {
            const root = this.deps.rootFor(link);
            if (!root) {
                // The worktree was removed, the project is gone, or the account lost access to it. Pausing is the
                // honest answer: the mirror is not broken, it simply has nothing to mirror right now.
                this.deps.store.setEnabled(link.id, false);
                this.deps.store.setStatus(link.id, 'paused', 'The mirrored folder is no longer available.');
                return;
            }
            this.deps.store.setStatus(link.id, 'syncing');
            const prefix = `${link.remotePath}/`;
            const baseline = this.deps.store.items(link.id);
            const scan = await scanLocal(root, {
                ignored: buildIgnore(settings.extraIgnore),
                maxBytes: Math.max(1, settings.maxFileMb) * 1024 * 1024,
                settleMs: SETTLE_MS,
                now: Date.now(),
                maxFiles: MAX_FILES,
            });
            // The set of paths worth looking at: everything on disk, everything the baseline knows, and every
            // remote change inside this mirror's own subtree.
            const paths = new Set([...scan.files.keys(), ...baseline.keys()]);
            for (const [path] of remote) {
                if (path.startsWith(prefix))
                    paths.add(path.slice(prefix.length));
            }
            // ⚠️ MASS-DELETION VALVE. A scan reports what it can SEE, and "saw nothing" is indistinguishable from
            // "there is nothing" — an unreadable directory, a mount that has not come back, a checkout mid-clone
            // all scan empty. Believing that would propagate a delete for every file the mirror holds, wiping the
            // person's OneDrive folder from a transient local fault. Refusing costs one skipped cycle; being
            // wrong costs their files, so this fails closed and says why.
            const vanished = [...baseline.keys()].filter((rel) => !scan.files.has(rel)).length;
            const suspicious = baseline.size >= 5 && vanished === baseline.size;
            if (suspicious) {
                this.deps.log.warn(`onedrive mirror ${link.id}: every mirrored file disappeared at once — refusing to propagate ${vanished} deletions`);
                this.deps.store.setStatus(link.id, 'error', 'Every mirrored file disappeared at once. Nothing was deleted in OneDrive; check that the project folder is readable.');
                return;
            }
            let conflicts = 0;
            let bytes = 0;
            for (const rel of paths) {
                const scanned = scan.files.get(rel);
                const known = baseline.get(rel);
                const base = known ? { sha256: known.localSha256, etag: known.remoteEtag } : null;
                const absolute = join(root, rel);
                if (!await containedIn(root, dirname(absolute)))
                    continue; // never write outside the mirror root
                const local = scanned
                    ? {
                        present: true,
                        size: scanned.size,
                        mtimeMs: scanned.mtimeMs,
                        // Hash only when the cheap signals moved: unchanged files are the overwhelming majority.
                        sha256: known && known.localSize === scanned.size && known.localMtimeMs === scanned.mtimeMs
                            ? known.localSha256
                            : await hashFile(absolute),
                    }
                    : { present: false };
                const remoteItem = remote.get(`${prefix}${rel}`);
                // With no cursor yet this delta is the whole drive, so absence really means absent. On an
                // incremental delta absence only means "unchanged", and the baseline is what still describes it.
                const remoteFile = remoteItem && !remoteItem.deleted
                    ? { present: true, itemId: remoteItem.id, etag: remoteItem.etag, size: remoteItem.size }
                    : remoteItem?.deleted
                        ? { present: false }
                        : (!fullScan && known)
                            ? { present: true, itemId: known.remoteItemId, etag: known.remoteEtag, size: known.localSize }
                            : { present: false };
                const decision = decide(local, remoteFile, base);
                if (known?.state === 'conflict' && decision.action === 'none') {
                    conflicts += 1;
                    continue;
                }
                switch (decision.action) {
                    case 'upload': {
                        if (!local.present)
                            break;
                        const uploaded = await drive.upload(`${prefix}${rel}`, absolute);
                        this.deps.store.putItem({
                            linkId: link.id, rel, localSize: local.size, localMtimeMs: local.mtimeMs, localSha256: local.sha256,
                            remoteItemId: uploaded.id, remoteEtag: uploaded.etag, state: 'synced', conflictCopy: null,
                        });
                        bytes += local.size;
                        break;
                    }
                    case 'download': {
                        if (!remoteFile.present)
                            break;
                        await drive.download(remoteFile.itemId, absolute);
                        const stats = await stat(absolute);
                        this.deps.store.putItem({
                            linkId: link.id, rel, localSize: stats.size, localMtimeMs: stats.mtimeMs,
                            localSha256: await hashFile(absolute), remoteItemId: remoteFile.itemId,
                            remoteEtag: remoteFile.etag, state: 'synced', conflictCopy: null,
                        });
                        bytes += stats.size;
                        break;
                    }
                    case 'deleteRemote': {
                        if (known?.remoteItemId)
                            await drive.remove(known.remoteItemId).catch(() => undefined);
                        this.deps.store.dropItem(link.id, rel);
                        break;
                    }
                    case 'trashLocal': {
                        if (!local.present)
                            break;
                        if (!settings.applyRemoteDeletions) {
                            // Deletions from OneDrive are not applied on this instance, so the local copy is the truth
                            // and goes back up. Re-uploading converges; leaving it alone would re-decide forever.
                            const restored = await drive.upload(`${prefix}${rel}`, absolute);
                            this.deps.store.putItem({
                                linkId: link.id, rel, localSize: local.size, localMtimeMs: local.mtimeMs, localSha256: local.sha256,
                                remoteItemId: restored.id, remoteEtag: restored.etag, state: 'synced', conflictCopy: null,
                            });
                            break;
                        }
                        await this.trash(root, rel);
                        this.deps.store.dropItem(link.id, rel);
                        break;
                    }
                    case 'conflict': {
                        if (!local.present || !remoteFile.present)
                            break;
                        const copy = conflictName(rel, new Date());
                        await drive.download(remoteFile.itemId, join(root, copy));
                        // Record BOTH current states so the same conflict is not re-detected next cycle and a second
                        // copy written. The flag stays until a person resolves it; the file itself is already safe.
                        this.deps.store.putItem({
                            linkId: link.id, rel, localSize: local.size, localMtimeMs: local.mtimeMs, localSha256: local.sha256,
                            remoteItemId: remoteFile.itemId, remoteEtag: remoteFile.etag, state: 'conflict', conflictCopy: copy,
                        });
                        conflicts += 1;
                        this.deps.log.info(`onedrive conflict in mirror ${link.id}: ${rel} (both copies kept)`);
                        break;
                    }
                    case 'forget':
                        this.deps.store.dropItem(link.id, rel);
                        break;
                    default:
                        if (known)
                            bytes += known.localSize;
                        break;
                }
            }
            this.deps.store.finish(link.id, {
                status: 'idle', error: null,
                fileCount: this.deps.store.items(link.id).size,
                byteCount: bytes,
                conflictCount: conflicts,
            });
        }
        finally {
            this.deps.store.release(link.id, this.owner);
        }
    }
    /** Move a file the other side deleted into the mirror's own trash. NEVER unlink: a deletion made in
     *  OneDrive is not a reason to destroy something in a project checkout, and the trash directory is
     *  itself ignored, so the copy does not travel straight back up. */
    async trash(root, rel) {
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        const target = join(root, TRASH_DIR, stamp, rel);
        await mkdir(dirname(target), { recursive: true });
        await rename(join(root, rel), target);
    }
}
function indexRemote(items) {
    const map = new Map();
    for (const item of items) {
        if (item.isFolder)
            continue;
        map.set(item.path, item); // later pages win: delta is ordered oldest to newest
    }
    return map;
}
function message(error) {
    return error instanceof Error ? error.message : String(error);
}
