import { randomUUID } from 'node:crypto';
import { mkdir, rename, stat } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import type { MicrosoftIdentityControl } from './coreSeams.js';
import { Drive, type DriveItem } from './drive.js';
import { decide, type Baseline, type LocalFile, type RemoteFile } from './merge.js';
import { buildIgnore, containedIn, hashFile, scanLocal, TRASH_DIR } from './scan.js';
import type { MirrorLink, OneDriveStore } from './store.js';

const LEASE_MS = 15 * 60 * 1000;
const SETTLE_MS = 2_000;
const MAX_FILES = 20_000;
/** Refuse a cycle that would delete more than this share of a mirror at once. */
const DELETION_CEILING = 0.34;
const DELETION_FLOOR = 4;

export interface SyncSettings {
  rootFolder: string;
  maxFileMb: number;
  extraIgnore: string;
  applyRemoteDeletions: boolean;
}

export interface SyncDeps {
  store: OneDriveStore;
  identity: () => MicrosoftIdentityControl | undefined;
  rootFor: (link: MirrorLink) => string | null;
  settings: () => SyncSettings;
  log: { info(m: string): void; warn(m: string): void; error(m: string): void };
}

/** Where a link's files live inside the person's OneDrive, relative to the drive root.
 *
 *  Projects and workspaces are SIBLINGS, never nested: putting workspaces under the project mirror would
 *  make the project scan try to pull every workspace copy down into the project directory.
 *
 *  A workspace folder carries its ID as well as its label. Sandbox does not require labels to be unique,
 *  and two workspaces resolving to one folder would have them silently overwriting and deleting each
 *  other's files — the label is for the person, the id is what makes the folder actually theirs. */
export function remoteRootFor(rootFolder: string, projectSlug: string, link: MirrorLink): string {
  const root = rootFolder.replace(/^\/+|\/+$/g, '') || 'Elowen';
  if (!link.workspaceId) return `${root}/projects/${projectSlug}`;
  const label = safeSegment(link.workspaceLabel ?? '');
  return `${root}/workspaces/${projectSlug}/${label} (${safeSegment(link.workspaceId).slice(0, 12)})`;
}

export function safeSegment(value: string): string {
  // OneDrive refuses these outright, and a path separator would silently create a nested folder.
  return String(value).replace(/[\\/:*?"<>|#%]+/g, '-').replace(/^\.+|\.+$/g, '').trim().slice(0, 48) || 'workspace';
}

/** The name a remote copy is kept under when both sides moved. Deliberately beside the original and
 *  deliberately visible: a conflict the person never sees is a conflict resolved by coin toss. */
export function conflictName(rel: string, when: Date): string {
  const ext = extname(rel);
  const stamp = when.toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `${rel.slice(0, rel.length - ext.length)}.onedrive-conflict-${stamp}${ext}`;
}

export class SyncEngine {
  /** One in-flight cycle per ACCOUNT. The interval and the "sync now" button both land here, and two
   *  passes over the same drive would each see the other's half-finished work as a change. */
  private readonly inFlight = new Map<number, Promise<void>>();
  readonly owner = `${process.pid}-${randomUUID().slice(0, 8)}`;

  constructor(private readonly deps: SyncDeps) {}

  async tick(): Promise<void> {
    for (const userId of this.deps.store.activeUserIds()) {
      try {
        await this.syncUser(userId);
      } catch (error) {
        this.deps.log.warn(`onedrive cycle for account ${userId}: ${message(error)}`);
      }
    }
  }

  /** Coalescing entry point: a second caller joins the run already happening rather than starting one. */
  syncUser(userId: number): Promise<void> {
    const running = this.inFlight.get(userId);
    if (running) return running;
    const started = this.runUser(userId).finally(() => this.inFlight.delete(userId));
    this.inFlight.set(userId, started);
    return started;
  }

  private async runUser(userId: number): Promise<void> {
    const identity = this.deps.identity();
    if (!identity) return; // Teams plugin absent or unconfigured: nothing to do, nothing to complain about
    const graph = await identity.driveGraphFor(userId);
    if (!graph) {
      for (const link of this.deps.store.linksForUser(userId)) {
        if (link.enabled) this.deps.store.setStatus(link.id, 'error', 'Microsoft sign-in is required again.');
      }
      return;
    }

    const drive = await Drive.open(graph);
    for (const link of this.deps.store.linksForUser(userId).filter((row) => row.enabled)) {
      try {
        await this.syncLink(link, drive);
      } catch (error) {
        this.deps.log.warn(`onedrive mirror ${link.id}: ${message(error)}`);
        this.deps.store.setStatus(link.id, 'error', message(error));
      }
    }
  }

  private async syncLink(link: MirrorLink, drive: Drive): Promise<void> {
    if (!this.deps.store.claim(link.id, this.owner, LEASE_MS)) return;
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

      // What EXISTS in OneDrive, not what changed there. A truncated listing is refused outright rather
      // than mistaken for a complete one — the difference is a phantom deletion of everything past the cap.
      const listing = await drive.listTree(link.remoteItemId);
      if (listing.truncated) {
        this.deps.store.setStatus(link.id, 'error', 'This OneDrive folder holds more files than the mirror can list at once.');
        return;
      }
      const remote = listing.files;

      const paths = new Set<string>([...scan.files.keys(), ...baseline.keys(), ...remote.keys()]);

      // Decide everything BEFORE acting, so the deletion valve sees the whole picture rather than the
      // part of it that happens to come first in iteration order.
      const planned: { rel: string; action: string; local: LocalFile; remote: RemoteFile; known: ReturnType<typeof baseline.get> }[] = [];
      for (const rel of paths) {
        // A skipped file is one this scan chose not to look at. It is NOT a deleted file, and reading it
        // as one deletes the OneDrive copy of a file that is sitting on disk untouched.
        if (scan.skippedPaths.has(rel)) continue;

        const known = baseline.get(rel);
        // A conflict stays frozen until a person resolves it. Re-deciding would let a later remote edit
        // turn into a plain download and overwrite the local side the conflict was protecting.
        if (known?.state === 'conflict') { planned.push({ rel, action: 'conflict-held', local: { present: false }, remote: { present: false }, known }); continue; }

        const absolute = join(root, rel);
        if (!await containedIn(root, dirname(absolute))) continue;

        const scanned = scan.files.get(rel);
        const base: Baseline = known ? { sha256: known.localSha256, etag: known.remoteEtag } : null;
        const local: LocalFile = scanned
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
        if (item && item.size > maxBytes) continue;
        const remoteFile: RemoteFile = item
          ? { present: true, itemId: item.id, etag: item.etag, size: item.size }
          : { present: false };

        planned.push({ rel, action: decide(local, remoteFile, base).action, local, remote: remoteFile, known });
      }

      // ⚠️ DELETION VALVE. A scan reports what it can SEE, and "saw nothing" is indistinguishable from
      // "there is nothing": an unreadable directory, a mount that has not come back, a checkout mid-clone
      // all look the same from here. Believing the wrong one wipes the person's OneDrive folder because of
      // a transient local fault. A share of a mirror disappearing at once is refused and explained;
      // deleting a few files is ordinary work and passes.
      const deletions = planned.filter((entry) => entry.action === 'deleteRemote').length;
      if (deletions > DELETION_FLOOR && deletions > baseline.size * DELETION_CEILING) {
        this.deps.log.warn(`onedrive mirror ${link.id}: refusing to delete ${deletions} of ${baseline.size} mirrored files in one cycle`);
        this.deps.store.setStatus(link.id, 'error',
          `${deletions} mirrored files disappeared locally at once. Nothing was deleted in OneDrive; check that the project folder is complete, then sync again.`);
        return;
      }

      // Listing and hashing take time, and a person can disconnect or pause the mirror while they run.
      // Re-read the row before ANY of it is applied: acting on a mirror that no longer exists would keep
      // uploading and deleting after the user said stop, and would leave orphan baseline rows behind.
      const current = this.deps.store.linkById(link.id);
      if (!current || !current.enabled) return;

      let conflicts = 0;
      let bytes = 0;
      for (const entry of planned) {
        const { rel, local, remote: remoteFile, known } = entry;
        const absolute = join(root, rel);
        switch (entry.action) {
          case 'conflict-held':
            conflicts += 1;
            break;
          case 'upload': {
            if (!local.present) break;
            // Conditional on what we last saw, so a remote edit made since the listing is reported as a
            // precondition failure and re-merged next cycle instead of being silently overwritten.
            const uploaded = await drive.upload(`${link.remotePath}/${rel}`, absolute, known?.remoteEtag);
            this.deps.store.putItem({
              linkId: link.id, rel, localSize: local.size, localMtimeMs: local.mtimeMs, localSha256: local.sha256,
              remoteItemId: uploaded.id, remoteEtag: uploaded.etag, state: 'synced', conflictCopy: null,
            });
            bytes += local.size;
            break;
          }
          case 'download': {
            if (!remoteFile.present) break;
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
            if (!known?.remoteItemId) { this.deps.store.dropItem(link.id, rel); break; }
            // A failed delete must NOT drop the baseline: the file is still there, and forgetting it makes
            // it invisible to every later cycle, so recreating the path would overwrite it unnoticed.
            await drive.remove(known.remoteItemId);
            this.deps.store.dropItem(link.id, rel);
            break;
          }
          case 'trashLocal': {
            if (!local.present) break;
            if (!settings.applyRemoteDeletions) {
              const restored = await drive.upload(`${link.remotePath}/${rel}`, absolute);
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
            if (!local.present || !remoteFile.present) break;
            const copy = conflictName(rel, new Date());
            await drive.download(remoteFile.itemId, join(root, copy));
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
            if (known) bytes += known.localSize;
            break;
        }
      }

      this.deps.store.finish(link.id, {
        status: 'idle', error: null,
        fileCount: this.deps.store.items(link.id).size,
        byteCount: bytes,
        conflictCount: conflicts,
      });
    } finally {
      this.deps.store.release(link.id, this.owner);
    }
  }

  /** Move a file the other side deleted into the mirror's own trash. NEVER unlink: a deletion made in
   *  OneDrive is not a reason to destroy something in a project checkout, and the trash directory is
   *  itself ignored, so the copy does not travel straight back up.
   *
   *  The DESTINATION is containment-checked too. A project can contain an ignored `.elowen-trash` symlink
   *  pointing anywhere, and `rename` would follow it straight out of the mirror. */
  private async trash(root: string, rel: string): Promise<void> {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const target = join(root, TRASH_DIR, stamp, rel);
    await mkdir(dirname(target), { recursive: true });
    if (!await containedIn(root, dirname(target))) {
      throw new Error('The mirror trash folder resolves outside the project and was not used.');
    }
    await rename(join(root, rel), target);
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type { DriveItem };
