import { randomUUID } from 'node:crypto';
import { mkdir, rename, stat } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { Drive, StaleLocalError } from './drive.js';
import { decide } from './merge.js';
import { buildIgnore, containedIn, containedInEventually, hashFile, scanLocal, TRASH_DIR, } from './scan.js';
const LEASE_MS = 5 * 60 * 1000;
/** Renew well inside the lease, and often enough that a slow file cannot let it lapse unnoticed. */
const RENEW_EVERY = 25;
const SETTLE_MS = 2_000;
const MAX_FILES = 20_000;
/** Refuse a cycle that would delete more than this share of what it could actually account for. */
const DELETION_CEILING = 0.34;
/** One deletion is the ordinary case and never needs a second opinion. */
const DELETION_FLOOR = 1;
/** Where a link's files live inside the person's OneDrive, relative to the drive root.
 *
 *  Projects and workspaces are SIBLINGS, never nested: putting workspaces under the project mirror would
 *  make the project scan try to pull every workspace copy down into the project directory.
 *
 *  A workspace folder carries its WHOLE id as well as its label. Sandbox does not require labels to be
 *  unique, and two workspaces resolving to one folder would have them silently overwriting and deleting
 *  each other's files — the label is for the person, the id is what makes the folder actually theirs. */
export function remoteRootFor(rootFolder, projectSlug, link) {
    const root = rootFolder.replace(/^\/+|\/+$/g, '') || 'Elowen';
    if (!link.workspaceId)
        return `${root}/projects/${projectSlug}`;
    const label = safeSegment(link.workspaceLabel ?? '');
    return `${root}/workspaces/${projectSlug}/${label} (${safeSegment(link.workspaceId)})`;
}
export function safeSegment(value) {
    // OneDrive refuses these outright, and a path separator would silently create a nested folder.
    return String(value).replace(/[\\/:*?"<>|#%]+/g, '-').replace(/^\.+|\.+$/g, '').trim().slice(0, 64) || 'workspace';
}
/** The name a remote copy is kept under when both sides moved. Deliberately beside the original and
 *  deliberately visible: a conflict the person never sees is a conflict resolved by coin toss.
 *
 *  `taken` lets the caller reject a name already in use. Second precision alone is not unique, and a
 *  conflict copy that overwrites an earlier conflict copy destroys the very thing it was made to save. */
export function conflictName(rel, when, taken = () => false) {
    const ext = extname(rel);
    const stem = rel.slice(0, rel.length - ext.length);
    const stamp = when.toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const base = `${stem}.onedrive-conflict-${stamp}`;
    if (!taken(`${base}${ext}`))
        return `${base}${ext}`;
    for (let n = 2; n < 1000; n += 1) {
        if (!taken(`${base}-${n}${ext}`))
            return `${base}-${n}${ext}`;
    }
    throw new Error(`Could not find an unused conflict name for ${rel}.`);
}
export class SyncEngine {
    deps;
    /** One in-flight cycle per ACCOUNT. The interval and the "sync now" button both land here, and two
     *  passes over the same drive would each see the other's half-finished work as a change. */
    inFlight = new Map();
    owner = `${process.pid}-${randomUUID().slice(0, 8)}`;
    constructor(deps) {
        this.deps = deps;
    }
    async tick() {
        for (const userId of this.deps.store.activeUserIds()) {
            try {
                await this.syncUser(userId);
            }
            catch (error) {
                this.deps.log.warn(`onedrive cycle for account ${userId}: ${message(error)}`);
            }
        }
    }
    /** Coalescing entry point: a second caller joins the run already happening rather than starting one. */
    syncUser(userId, options = {}) {
        const running = this.inFlight.get(userId);
        if (running)
            return running;
        const started = this.runUser(userId, options).finally(() => this.inFlight.delete(userId));
        this.inFlight.set(userId, started);
        return started;
    }
    async runUser(userId, options) {
        const identity = this.deps.identity();
        if (!identity)
            return; // Teams plugin absent or unconfigured: nothing to do, nothing to complain about
        const graph = await identity.driveGraphFor(userId);
        if (!graph) {
            for (const link of this.deps.store.linksForUser(userId)) {
                if (link.enabled)
                    this.deps.store.setStatus(link.id, 'error', 'Microsoft sign-in is required again.');
            }
            return;
        }
        const drive = await Drive.open(graph);
        for (const link of this.deps.store.linksForUser(userId).filter((row) => row.enabled)) {
            try {
                await this.syncLink(link, drive, options.confirmDeletions?.has(link.id) === true);
            }
            catch (error) {
                this.deps.log.warn(`onedrive mirror ${link.id}: ${message(error)}`);
                this.deps.store.setStatus(link.id, 'error', message(error));
            }
        }
    }
    async syncLink(link, drive, confirmDeletions) {
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
            // The mirror was connected to ONE drive. If the account is later rebound to a different Microsoft
            // identity, `/me/drive` answers with somebody else's drive — and every path in this link's baseline
            // would then be applied to a stranger's files. Stop instead.
            if (link.remoteDriveId && link.remoteDriveId !== drive.driveId) {
                this.deps.store.setEnabled(link.id, false);
                this.deps.store.setStatus(link.id, 'paused', 'This mirror belongs to a different Microsoft account. Connect it again.');
                return;
            }
            this.deps.store.setStatus(link.id, 'syncing');
            const maxBytes = Math.max(1, settings.maxFileMb) * 1024 * 1024;
            const baseline = this.deps.store.items(link.id);
            const scan = await scanLocal(root, {
                ignored: buildIgnore(settings.extraIgnore),
                maxBytes,
                settleMs: SETTLE_MS,
                now: Date.now(),
                maxFiles: MAX_FILES,
            });
            // A scan that KNOWS it did not see everything cannot be used to decide that anything is gone.
            // Uploading from a partial view would be harmless; deleting from one is not, and both are decided
            // together, so the whole cycle waits for a view it can trust.
            if (!scan.complete) {
                this.deps.store.setStatus(link.id, 'error', 'Part of the project folder could not be read, so this cycle was skipped rather than risk deleting files from OneDrive.');
                return;
            }
            // What EXISTS in OneDrive, not what changed there. A truncated listing is refused outright rather
            // than mistaken for a complete one — the difference is a phantom deletion of everything past the cap.
            const listing = await drive.listTree(link.remoteItemId);
            if (listing.truncated) {
                this.deps.store.setStatus(link.id, 'error', 'The OneDrive folder could not be listed completely, so this cycle was skipped rather than risk deleting files.');
                return;
            }
            const remote = listing.files;
            const paths = new Set([...scan.files.keys(), ...baseline.keys(), ...remote.keys()]);
            const planned = [];
            let accounted = 0;
            for (const rel of paths) {
                const known = baseline.get(rel);
                // A skipped file is one this scan chose not to look at. It is NOT a deleted file, and reading it
                // as one deletes the OneDrive copy of a file that is sitting on disk untouched.
                if (scan.skippedPaths.has(rel))
                    continue;
                // A file that became ignored since it was mirrored is not deleted either — it is still on disk,
                // just out of scope now. Forget it and leave both copies alone.
                if (known && !scan.files.has(rel) && scan.isIgnored(rel)) {
                    planned.push({ rel, action: 'forget', local: { present: false }, remote: { present: false }, known });
                    accounted += 1;
                    continue;
                }
                // A conflict stays frozen until a person resolves it. Re-deciding would let a later remote edit
                // turn into a plain download and overwrite the local side the conflict was protecting.
                if (known?.state === 'conflict') {
                    planned.push({ rel, action: 'conflict-held', local: { present: false }, remote: { present: false }, known });
                    continue;
                }
                const absolute = join(root, rel);
                if (!await containedInEventually(root, absolute))
                    continue;
                const scanned = scan.files.get(rel);
                const base = known ? { sha256: known.localSha256, etag: known.remoteEtag } : null;
                const local = scanned
                    ? {
                        present: true,
                        size: scanned.size,
                        mtimeMs: scanned.mtimeMs,
                        sha256: known && known.localSize === scanned.size && known.localMtimeMs === scanned.mtimeMs
                            ? known.localSha256
                            : await hashFile(absolute),
                    }
                    : { present: false };
                const item = remote.get(rel);
                // A remote file too large to mirror is left ALONE in both directions. Downloading it would create
                // a local file the next scan skips, which the cycle after that would read as a deletion.
                if (item && item.size > maxBytes)
                    continue;
                const remoteFile = item
                    ? { present: true, itemId: item.id, etag: item.etag, size: item.size }
                    : { present: false };
                if (known)
                    accounted += 1;
                planned.push({ rel, action: decide(local, remoteFile, base).action, local, remote: remoteFile, known });
            }
            // ⚠️ DELETION VALVE. A scan reports what it can SEE, and "saw nothing" is indistinguishable from
            // "there is nothing". The completeness check above catches the faults the scan can detect, but not
            // every one — a bind mount replaced by an empty directory reads as a perfectly successful scan of an
            // empty project. So the share is checked too, against the paths this cycle could actually ACCOUNT
            // for rather than against every baseline row: counting skipped and frozen paths in the denominator
            // is how a mirror with many conflicts would dilute its way past the check.
            //
            // It is a question, not a verdict. Emptying a project on purpose is legitimate, so the refusal
            // explains itself and Sync now carries the confirmation through.
            const deletions = planned.filter((entry) => entry.action === 'deleteRemote').length;
            if (!confirmDeletions && deletions > DELETION_FLOOR && deletions > accounted * DELETION_CEILING) {
                this.deps.log.warn(`onedrive mirror ${link.id}: refusing to delete ${deletions} of ${accounted} mirrored files in one cycle`);
                this.deps.store.setStatus(link.id, 'blocked', `${deletions} of ${accounted} mirrored files disappeared locally at once. Nothing was deleted in OneDrive. If that was intentional, choose Sync now to confirm; otherwise check that the project folder is complete.`);
                return;
            }
            // Listing and hashing take time, and a person can disconnect or pause the mirror while they run.
            // Re-read the row before ANY of it is applied: acting on a mirror that no longer exists would keep
            // uploading and deleting after the user said stop, and would leave orphan baseline rows behind.
            const current = this.deps.store.linkById(link.id);
            if (!current || !current.enabled)
                return;
            let bytes = 0;
            let applied = 0;
            for (const entry of planned) {
                // Losing the claim means another worker has already re-decided this mirror. Anything this cycle
                // still applied would be built on a view that worker has since superseded — including, exactly,
                // overwriting a local edit the other worker just preserved as a conflict.
                applied += 1;
                if (applied % RENEW_EVERY === 0 && !this.deps.store.renew(link.id, this.owner, LEASE_MS)) {
                    this.deps.log.warn(`onedrive mirror ${link.id}: lost its claim mid-cycle and stopped`);
                    return;
                }
                const { rel, local, remote: remoteFile, known } = entry;
                const absolute = join(root, rel);
                try {
                    switch (entry.action) {
                        case 'conflict-held':
                            break;
                        case 'upload': {
                            if (!local.present)
                                break;
                            // Conditional on what we last saw, so a remote edit made since the listing is reported as a
                            // precondition failure and re-merged next cycle instead of being silently overwritten.
                            const uploaded = await drive.upload(`${link.remotePath}/${rel}`, absolute, known?.remoteEtag || undefined, !remoteFile.present);
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
                            // The guard answers "is the local file still what the scan measured?" at the last possible
                            // moment. Someone saving during the download is a divergence, not something to overwrite.
                            await drive.download(remoteFile.itemId, absolute, () => localUnchanged(absolute, local));
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
                            if (!known?.remoteItemId) {
                                this.deps.store.dropItem(link.id, rel);
                                break;
                            }
                            // A failed delete must NOT drop the baseline: the file is still there, and forgetting it
                            // makes it invisible to every later cycle, so recreating the path would overwrite it.
                            await drive.remove(known.remoteItemId, known.remoteEtag || undefined);
                            this.deps.store.dropItem(link.id, rel);
                            break;
                        }
                        case 'trashLocal': {
                            if (!local.present)
                                break;
                            if (!settings.applyRemoteDeletions) {
                                const restored = await drive.upload(`${link.remotePath}/${rel}`, absolute, undefined, true);
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
                            // With no baseline, "both sides have this file" is indistinguishable from "both sides have
                            // the SAME file" - which is the normal state on a first connect, and on every reconnect,
                            // since disconnecting drops the baseline. Comparing content first turns that from a pile of
                            // conflicts into nothing to do. Only worth asking when the sizes already agree.
                            if (!known && local.size === remoteFile.size && await drive.sha256(remoteFile.itemId) === local.sha256) {
                                this.deps.store.putItem({
                                    linkId: link.id, rel, localSize: local.size, localMtimeMs: local.mtimeMs, localSha256: local.sha256,
                                    remoteItemId: remoteFile.itemId, remoteEtag: remoteFile.etag, state: 'synced', conflictCopy: null,
                                });
                                bytes += local.size;
                                break;
                            }
                            await this.keepBoth(drive, link, root, rel, local, remoteFile, (name) => scan.files.has(name));
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
                catch (error) {
                    if (error instanceof StaleLocalError && local.present && remoteFile.present) {
                        // Saved underneath us mid-download. Both versions matter; neither is thrown away.
                        await this.keepBoth(drive, link, root, rel, local, remoteFile, (name) => scan.files.has(name));
                        continue;
                    }
                    // One file failing is not a reason to abandon the rest of the mirror, but it IS a reason to
                    // leave that file's baseline exactly as it was so the next cycle re-decides it from scratch.
                    this.deps.log.warn(`onedrive mirror ${link.id}: ${rel}: ${message(error)}`);
                }
            }
            const after = this.deps.store.items(link.id);
            this.deps.store.finish(link.id, {
                status: 'idle',
                error: null,
                fileCount: after.size,
                byteCount: bytes,
                // Counted from the BASELINE, not from this cycle's plan. A conflicted file the scan happened to
                // skip would otherwise vanish from the count, and the UI would hide the only control that can
                // resolve it while the path stayed frozen forever.
                conflictCount: [...after.values()].filter((item) => item.state === 'conflict').length,
            });
        }
        finally {
            this.deps.store.release(link.id, this.owner);
        }
    }
    /** Keep the local file exactly as it is and bring the remote one down beside it under a free name. */
    async keepBoth(drive, link, root, rel, local, remoteFile, exists) {
        const copy = conflictName(rel, new Date(), exists);
        await drive.download(remoteFile.itemId, join(root, copy));
        this.deps.store.putItem({
            linkId: link.id, rel, localSize: local.size, localMtimeMs: local.mtimeMs, localSha256: local.sha256,
            remoteItemId: remoteFile.itemId, remoteEtag: remoteFile.etag, state: 'conflict', conflictCopy: copy,
        });
        this.deps.log.info(`onedrive conflict in mirror ${link.id}: ${rel} (both copies kept)`);
    }
    /** Move a file the other side deleted into the mirror's own trash. NEVER unlink: a deletion made in
     *  OneDrive is not a reason to destroy something in a project checkout, and the trash directory is
     *  itself ignored, so the copy does not travel straight back up.
     *
     *  The DESTINATION is containment-checked too. A project can contain an ignored `.elowen-trash` symlink
     *  pointing anywhere, and `rename` would follow it straight out of the mirror. */
    async trash(root, rel) {
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        const target = join(root, TRASH_DIR, stamp, rel);
        await mkdir(dirname(target), { recursive: true });
        if (!await containedIn(root, dirname(target))) {
            throw new Error('The mirror trash folder resolves outside the project and was not used.');
        }
        await rename(join(root, rel), target);
    }
}
/** Is the file on disk still what the scan measured? Size and mtime are what the rest of the cycle
 *  compares on, so they are what the guard compares on too. */
async function localUnchanged(absolute, local) {
    if (!local.present) {
        // The scan saw no local file. Anything there now arrived since, and is not ours to replace.
        return await stat(absolute).then(() => false, () => true);
    }
    try {
        const stats = await stat(absolute);
        return stats.size === local.size && stats.mtimeMs === local.mtimeMs;
    }
    catch {
        return true; // deleted meanwhile: writing the remote copy in is the right outcome
    }
}
function message(error) {
    return error instanceof Error ? error.message : String(error);
}
