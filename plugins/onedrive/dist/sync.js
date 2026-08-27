import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, realpath, rename, stat } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { Drive, StaleLocalError } from './drive.js';
import { decide } from './merge.js';
import { buildIgnore, containedIn, containedInEventually, gitIgnoredAmong, hashFile, scanLocal, TRASH_DIR, } from './scan.js';
const LEASE_MS = 5 * 60 * 1000;
/** Renew on ELAPSED TIME, not on a count of files. One large upload can outlast the lease on its own,
 *  and a counter cannot see that happening. */
const RENEW_AFTER_MS = LEASE_MS / 3;
const SETTLE_MS = 2_000;
const MAX_FILES = 20_000;
/** Refuse a cycle that would delete more than this share of what it could actually account for. */
const DELETION_CEILING = 0.34;
/** One deletion is the ordinary case and never needs a second opinion. */
const DELETION_FLOOR = 1;
/** Beyond this many at once, the share stops mattering: losing fifty files is a lot of files however
 *  large the mirror is, and a big project is exactly where a ratio hides a disaster. */
const DELETION_ABSOLUTE = 50;
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
    const base = link.workspaceId
        ? `${root}/workspaces/${projectSlug}/${safeSegment(link.workspaceLabel ?? '')} (${safeSegment(link.workspaceId)})`
        : `${root}/projects/${projectSlug}`;
    // A narrowed mirror keeps the folder it covers in its remote path. Dropping it and putting `docs/`
    // straight at the project root would make two subfolders of one project collide in OneDrive, and would
    // leave the person unable to tell from the folder alone WHICH part of the project they are looking at.
    if (!link.subpath)
        return base;
    return `${base}/${link.subpath.split('/').filter(Boolean).map(safeSegment).join('/')}`;
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
    /** One at a time per LOCAL ROOT, across accounts. A project can be shared, and two people can each
     *  mirror it into their own OneDrive - two different drives, two different links, but ONE directory on
     *  disk. The per-link claim does not see that, so both workers would write the same file and the last
     *  rename would win, silently overwriting the other person's version with no trash copy anywhere. */
    rootLocks = new Map();
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
        const requested = this.deps.store.linksForUser(userId)
            .filter((row) => row.enabled && (!options.only || options.only.has(row.id)));
        for (const link of requested) {
            try {
                await this.syncLink(link, drive, options.confirmDeletions?.has(link.id) === true);
            }
            catch (error) {
                this.deps.log.warn(`onedrive mirror ${link.id}: ${message(error)}`);
                this.deps.store.setStatus(link.id, 'error', message(error));
            }
        }
    }
    /** Run `work` with exclusive use of one local directory. */
    async underRootLock(root, work) {
        const key = await realpath(root).catch(() => root);
        const previous = this.rootLocks.get(key) ?? Promise.resolve();
        const mine = previous.then(work, work);
        this.rootLocks.set(key, mine.catch(() => undefined));
        try {
            return await mine;
        }
        finally {
            if (this.rootLocks.get(key) === undefined)
                this.rootLocks.delete(key);
        }
    }
    async syncLink(link, drive, confirmDeletions) {
        const lease = this.deps.lease ?? { ms: LEASE_MS, renewAfterMs: RENEW_AFTER_MS };
        if (!this.deps.store.claim(link.id, this.owner, lease.ms))
            return;
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
            await this.underRootLock(root, () => this.applyCycle(link, drive, confirmDeletions, root, lease));
        }
        finally {
            this.deps.store.release(link.id, this.owner);
        }
    }
    async applyCycle(link, drive, confirmDeletions, root, lease) {
        const settings = this.deps.settings();
        {
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
            // A file git decided to ignore simply vanishes from `ls-files`, so a path that disappeared may have
            // been added to .gitignore rather than deleted. The scan's own predicate cannot tell those apart -
            // it knows the hard floor and the user's extra patterns, not the project's .gitignore.
            const vanished = [...baseline.keys()].filter((rel) => !scan.files.has(rel) && !scan.skippedPaths.has(rel));
            const gitQuery = scan.fromGit
                ? await gitIgnoredAmong(root, vanished)
                : { ignored: new Set(), ok: true };
            if (!gitQuery.ok) {
                this.deps.store.setStatus(link.id, 'error', 'Git could not say which files it ignores, so this cycle was skipped rather than risk deleting files from OneDrive.');
                return;
            }
            const gitIgnored = gitQuery.ignored;
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
                if (known && !scan.files.has(rel) && (scan.isIgnored(rel) || gitIgnored.has(rel))) {
                    planned.push({ rel, action: 'forget', local: { present: false }, remote: { present: false }, known });
                    accounted += 1;
                    continue;
                }
                // A conflict stays frozen until a person resolves it. Re-deciding would let a later remote edit
                // turn into a plain download and overwrite the local side the conflict was protecting.
                if (known?.state === 'conflict') {
                    const still = remote.get(rel);
                    // Resolving compares against the exact version the conflict was recorded for, and refuses if
                    // OneDrive has moved on. Left alone, that path could never be resolved again - the cycle held
                    // the conflict frozen and never refreshed it. Re-offering it keeps the choice answerable.
                    const stale = still && still.etag !== known.remoteEtag;
                    planned.push({
                        rel,
                        action: stale ? 'reoffer-conflict' : 'conflict-held',
                        local: { present: false },
                        remote: still ? { present: true, itemId: still.id, etag: still.etag, size: still.size } : { present: false },
                        known,
                    });
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
            const excessive = deletions > DELETION_FLOOR
                && (deletions > accounted * DELETION_CEILING || deletions >= DELETION_ABSOLUTE);
            // A confirmation answers the question the person was SHOWN. If more files have gone missing since
            // then, that is a different question and has to be asked again rather than swept along.
            // A confirmation is an answer to a refusal this mirror actually made. Without that, a stale button
            // press - or one made while a mount happened to be empty - would carry authority to delete
            // everything, which is precisely the authority the valve exists to withhold.
            const answersARefusal = confirmDeletions
                && link.status === 'blocked'
                && link.blockedDeletions > 0
                && deletions <= link.blockedDeletions;
            if (excessive && !answersARefusal) {
                this.deps.store.setBlockedDeletions(link.id, deletions);
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
            // Reconnecting can point the SAME row at a different folder while this cycle was listing the old
            // one. Applying anyway would delete from the folder the person just left and then write what it saw
            // there into the new folder's freshly cleared baseline.
            if (current.remoteItemId !== link.remoteItemId
                || current.remoteDriveId !== link.remoteDriveId
                || current.remotePath !== link.remotePath) {
                this.deps.log.warn(`onedrive mirror ${link.id}: was pointed at another folder mid-cycle and stopped`);
                return;
            }
            this.deps.store.setBlockedDeletions(link.id, 0);
            let bytes = 0;
            let renewedAt = Date.now();
            for (const entry of planned) {
                // Losing the claim means another worker has already re-decided this mirror. Anything this cycle
                // still applied would be built on a view that worker has since superseded — including, exactly,
                // overwriting a local edit the other worker just preserved as a conflict.
                if (Date.now() - renewedAt >= lease.renewAfterMs) {
                    if (!this.deps.store.renew(link.id, this.owner, lease.ms)) {
                        this.deps.log.warn(`onedrive mirror ${link.id}: lost its claim mid-cycle and stopped`);
                        return;
                    }
                    renewedAt = Date.now();
                }
                const { rel, local, remote: remoteFile, known } = entry;
                const absolute = join(root, rel);
                try {
                    switch (entry.action) {
                        case 'conflict-held':
                            break;
                        case 'reoffer-conflict': {
                            if (!remoteFile.present || !known)
                                break;
                            const scanned = scan.files.get(rel);
                            if (!scanned)
                                break;
                            await this.keepBoth(drive, link, root, rel, { present: true, size: scanned.size, mtimeMs: scanned.mtimeMs, sha256: await hashFile(absolute) }, remoteFile, root);
                            break;
                        }
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
                            // The other destructive direction, and it needs the same last-moment check: the file may
                            // have been recreated since the scan, and the etag precondition would not notice - it
                            // guards the REMOTE side, and it is the local side that changed.
                            if (existsSync(absolute))
                                break;
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
                            // The listing is a walk, not a snapshot: a file moved between folders while it was running
                            // can be missing from every page and still exist. Ask about this one path before destroying
                            // the local copy of it.
                            if (known?.remoteItemId && await drive.stillExists(known.remoteItemId))
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
                            await this.keepBoth(drive, link, root, rel, local, remoteFile, root);
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
                        await this.keepBoth(drive, link, root, rel, local, remoteFile, root);
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
    }
    /** Keep the local file exactly as it is and bring the remote one down beside it under a free name. */
    async keepBoth(drive, link, root, rel, local, remoteFile, projectRoot) {
        // Asked of the FILESYSTEM, not of the scan. The scan deliberately leaves things out - settling,
        // oversized, unreadable, symlinks - and a name it never mentioned is still a name that exists. The
        // download ends in a replacing rename, so believing the scan here overwrites a real file.
        const copy = conflictName(rel, new Date(), (candidate) => existsSync(join(projectRoot, candidate)));
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
        await trashFile(root, rel);
    }
}
/** Move a file into the mirror's own trash. NEVER unlink: whatever supersedes it - a deletion made in
 *  OneDrive, or a conflict the person resolved the other way - is not a reason to destroy the only copy
 *  of something. The trash directory is itself ignored, so nothing travels straight back up.
 *
 *  The DESTINATION is containment-checked. A project can contain an ignored `.elowen-trash` symlink
 *  pointing anywhere, and `rename` would follow it straight out of the mirror. */
export async function trashFile(root, rel) {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    // Second precision alone is not unique: delete, recreate and delete the same path twice inside one
    // second and the second rename would replace the first file already sitting in the trash. The trash
    // exists so nothing is ever lost, so its own names must not collide.
    let target = join(root, TRASH_DIR, stamp, rel);
    for (let n = 2; existsSync(target); n += 1) {
        // After a few tries the timestamp is clearly not distinguishing anything, so stop counting and take a
        // random name. Falling back to a name already in use would replace an earlier trashed version - in
        // the one directory whose entire purpose is that nothing is ever lost.
        target = n < 100
            ? join(root, TRASH_DIR, `${stamp}-${n}`, rel)
            : join(root, TRASH_DIR, `${stamp}-${randomUUID().slice(0, 8)}`, rel);
    }
    await mkdir(dirname(target), { recursive: true });
    if (!await containedIn(root, dirname(target))) {
        throw new Error('The mirror trash folder resolves outside the project and was not used.');
    }
    await rename(join(root, rel), target);
}
/** Is the file on disk still what the scan measured? Size and mtime are what the rest of the cycle
 *  compares on, so they are what the guard compares on too. */
async function localUnchanged(absolute, local) {
    if (!local.present) {
        // The scan saw no local file. Anything there now arrived since, and is not ours to replace.
        return await stat(absolute).then(() => false, (error) => error?.code === 'ENOENT');
    }
    try {
        const stats = await stat(absolute);
        if (stats.size !== local.size)
            return false;
        // Size and mtime agreeing is not the same as the file being unchanged: an editor can rewrite the same
        // number of bytes, and restoring an mtime is a one-line operation. The hash is already known for the
        // local side, so comparing content costs one read and removes the guess.
        return await hashFile(absolute) === local.sha256;
    }
    catch (error) {
        // Genuinely gone: writing the remote copy in is the right outcome. Anything else - a permission
        // error, an I/O error - is not an answer, and must not be read as permission to overwrite.
        return error?.code === 'ENOENT';
    }
}
function message(error) {
    return error instanceof Error ? error.message : String(error);
}
