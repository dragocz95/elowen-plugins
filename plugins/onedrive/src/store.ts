import type { PluginDb } from 'elowen/plugin-api';

/** `blocked` is not an error: the mirror worked correctly and stopped to ask a question. It is a separate
 *  state precisely so the UI can offer the answer, instead of inferring intent from an error string. */
export type LinkStatus = 'idle' | 'syncing' | 'error' | 'paused' | 'blocked';

export interface MirrorLink {
  id: number;
  userId: number;
  projectId: number;
  /** `null` = the registered project checkout; otherwise one sandbox worktree of that project. */
  workspaceId: string | null;
  workspaceLabel: string | null;
  /** Relative POSIX path INSIDE that root, or `''` for the whole thing. Mirroring a whole project is
   *  often far more than someone wants in their own OneDrive, so the mirror can be narrowed to one
   *  folder. It is stored, never trusted: the root is re-resolved and re-contained every cycle. */
  subpath: string;
  remoteDriveId: string;
  remoteItemId: string;
  remotePath: string;
  webUrl: string | null;
  enabled: boolean;
  status: LinkStatus;
  error: string | null;
  lastSyncAt: number | null;
  fileCount: number;
  byteCount: number;
  conflictCount: number;
  /** Deletions the owner was shown when the mirror last refused a bulk deletion; 0 when nothing is
   *  pending. A confirmation is answered against this number, so it cannot silently grow. */
  blockedDeletions: number;
  createdAt: number;
}

export interface MirrorItem {
  linkId: number;
  rel: string;
  localSize: number;
  localMtimeMs: number;
  localSha256: string;
  remoteItemId: string;
  remoteEtag: string;
  state: 'synced' | 'conflict';
  conflictCopy: string | null;
  updatedAt: number;
}

const num = (value: unknown): number => (typeof value === 'number' ? value : Number(value ?? 0));
const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const nullableStr = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

function toLink(row: Record<string, unknown>): MirrorLink {
  return {
    id: num(row.id),
    userId: num(row.user_id),
    projectId: num(row.project_id),
    workspaceId: nullableStr(row.workspace_id),
    workspaceLabel: nullableStr(row.workspace_label),
    subpath: str(row.subpath),
    remoteDriveId: str(row.remote_drive_id),
    remoteItemId: str(row.remote_item_id),
    remotePath: str(row.remote_path),
    webUrl: nullableStr(row.web_url),
    enabled: num(row.enabled) === 1,
    status: (str(row.status) || 'idle') as LinkStatus,
    error: nullableStr(row.error),
    lastSyncAt: row.last_sync_at == null ? null : num(row.last_sync_at),
    fileCount: num(row.file_count),
    byteCount: num(row.byte_count),
    conflictCount: num(row.conflict_count),
    blockedDeletions: num(row.blocked_deletions),
    createdAt: num(row.created_at),
  };
}

function toItem(row: Record<string, unknown>): MirrorItem {
  return {
    linkId: num(row.link_id),
    rel: str(row.rel_path),
    localSize: num(row.local_size),
    localMtimeMs: num(row.local_mtime_ms),
    localSha256: str(row.local_sha256),
    remoteItemId: str(row.remote_item_id),
    remoteEtag: str(row.remote_etag),
    state: str(row.state) === 'conflict' ? 'conflict' : 'synced',
    conflictCopy: nullableStr(row.conflict_copy),
    updatedAt: num(row.updated_at),
  };
}

export class OneDriveStore {
  constructor(readonly db: PluginDb) {
    db.migrate([{ version: 1, up: (migration) => migration.exec(`
      CREATE TABLE IF NOT EXISTS p_onedrive_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        project_id INTEGER NOT NULL,
        workspace_id TEXT,
        workspace_label TEXT,
        remote_drive_id TEXT NOT NULL,
        remote_item_id TEXT NOT NULL,
        remote_path TEXT NOT NULL,
        web_url TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'idle',
        error TEXT,
        last_sync_at INTEGER,
        file_count INTEGER NOT NULL DEFAULT 0,
        byte_count INTEGER NOT NULL DEFAULT 0,
        conflict_count INTEGER NOT NULL DEFAULT 0,
        running_owner TEXT,
        running_until INTEGER,
        created_at INTEGER NOT NULL
      );
      -- One mirror per account, project and workspace. The expression keeps the NULL workspace (the
      -- project checkout itself) unique too, which a plain UNIQUE would not: SQLite treats every NULL as
      -- distinct, so the project mirror could otherwise be connected twice and both copies would fight.
      CREATE UNIQUE INDEX IF NOT EXISTS p_onedrive_links_unique
        ON p_onedrive_links (user_id, project_id, COALESCE(workspace_id, ''));

      CREATE TABLE IF NOT EXISTS p_onedrive_items (
        link_id INTEGER NOT NULL,
        rel_path TEXT NOT NULL,
        local_size INTEGER NOT NULL,
        local_mtime_ms INTEGER NOT NULL,
        local_sha256 TEXT NOT NULL,
        remote_item_id TEXT NOT NULL,
        remote_etag TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'synced',
        conflict_copy TEXT,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (link_id, rel_path)
      );

    `) }, { version: 2, up: (migration) => migration.exec(`
      ALTER TABLE p_onedrive_links ADD COLUMN blocked_deletions INTEGER NOT NULL DEFAULT 0;
    `) }, { version: 3, up: (migration) => migration.exec(`
      -- '' means the whole root, which is what every existing mirror already covers, so the default
      -- migrates them without touching a row.
      ALTER TABLE p_onedrive_links ADD COLUMN subpath TEXT NOT NULL DEFAULT '';
    `) }]);
  }

  createLink(input: Omit<MirrorLink, 'id' | 'status' | 'error' | 'lastSyncAt' | 'fileCount' | 'byteCount' | 'conflictCount' | 'blockedDeletions' | 'createdAt' | 'enabled'>): MirrorLink {
    const now = Date.now();
    this.db.prepare(`INSERT INTO p_onedrive_links
      (user_id, project_id, workspace_id, workspace_label, subpath, remote_drive_id, remote_item_id, remote_path, web_url, enabled, status, blocked_deletions, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'idle', 0, ?)
      ON CONFLICT (user_id, project_id, COALESCE(workspace_id, '')) DO UPDATE SET
        enabled = 1, status = 'idle', error = NULL,
        -- A refusal belongs to the mirror that made it. Reconnecting - to another folder especially -
        -- is a new mirror as far as that question goes, so an unanswered count must not survive it.
        blocked_deletions = 0,
        subpath = excluded.subpath,
        remote_drive_id = excluded.remote_drive_id,
        remote_item_id = excluded.remote_item_id,
        remote_path = excluded.remote_path,
        web_url = excluded.web_url,
        workspace_label = excluded.workspace_label`)
      .run(input.userId, input.projectId, input.workspaceId, input.workspaceLabel, input.subpath,
        input.remoteDriveId, input.remoteItemId, input.remotePath, input.webUrl, now);
    return this.linkFor(input.userId, input.projectId, input.workspaceId)!;
  }

  linkFor(userId: number, projectId: number, workspaceId: string | null): MirrorLink | null {
    const row = this.db.prepare(
      `SELECT * FROM p_onedrive_links WHERE user_id = ? AND project_id = ? AND COALESCE(workspace_id, '') = ?`,
    ).get(userId, projectId, workspaceId ?? '');
    return row ? toLink(row as Record<string, unknown>) : null;
  }

  linkById(id: number): MirrorLink | null {
    const row = this.db.prepare('SELECT * FROM p_onedrive_links WHERE id = ?').get(id);
    return row ? toLink(row as Record<string, unknown>) : null;
  }

  linksForProject(userId: number, projectId: number): MirrorLink[] {
    return this.db.prepare('SELECT * FROM p_onedrive_links WHERE user_id = ? AND project_id = ? ORDER BY workspace_id IS NOT NULL, workspace_label, id')
      .all(userId, projectId).map((row) => toLink(row as Record<string, unknown>));
  }

  linksForUser(userId: number): MirrorLink[] {
    return this.db.prepare('SELECT * FROM p_onedrive_links WHERE user_id = ? ORDER BY id')
      .all(userId).map((row) => toLink(row as Record<string, unknown>));
  }

  /** Accounts with at least one live mirror — the work list a background cycle iterates, read from a
   *  column rather than from an ambient identity the worker does not have. */
  activeUserIds(): number[] {
    return this.db.prepare('SELECT DISTINCT user_id FROM p_onedrive_links WHERE enabled = 1')
      .all().map((row) => num((row as Record<string, unknown>).user_id));
  }

  enabledLinks(): MirrorLink[] {
    return this.db.prepare('SELECT * FROM p_onedrive_links WHERE enabled = 1 ORDER BY COALESCE(last_sync_at, 0)')
      .all().map((row) => toLink(row as Record<string, unknown>));
  }

  /** Take the lock on one mirror, or report that somebody else holds it.
   *
   *  The daemon and a forked runner both load this plugin, so "one worker at a time" cannot be enforced
   *  by a variable in one process. The claim is a conditional UPDATE — the row itself decides — and it
   *  carries an expiry so a worker killed mid-cycle releases it by simply not being there any more. */
  claim(linkId: number, owner: string, leaseMs: number, now = Date.now()): boolean {
    const result = this.db.prepare(
      `UPDATE p_onedrive_links SET running_owner = ?, running_until = ?
       WHERE id = ? AND enabled = 1 AND (running_until IS NULL OR running_until < ?)`,
    ).run(owner, now + leaseMs, linkId, now);
    return result.changes === 1;
  }

  /** Extend a claim this worker still holds, and report whether it still holds it.
   *
   *  A lease that expires MID-CYCLE is worse than no lease: another worker takes the row, forms its own
   *  plan, and the first worker then applies a plan built from state that has since been re-decided —
   *  overwriting exactly what the second one just protected. The cycle renews as it works, and a renewal
   *  that returns false means it was displaced and must stop touching files immediately. */
  /** How many deletions the owner was SHOWN when the mirror last refused a bulk deletion. A confirmation
   *  answers that question and no larger one, so the number has to outlive the request that raised it. */
  setBlockedDeletions(linkId: number, count: number): void {
    this.db.prepare('UPDATE p_onedrive_links SET blocked_deletions = ? WHERE id = ?').run(count, linkId);
  }

  renew(linkId: number, owner: string, leaseMs: number, now = Date.now()): boolean {
    const result = this.db.prepare(
      'UPDATE p_onedrive_links SET running_until = ? WHERE id = ? AND running_owner = ? AND running_until >= ?',
    ).run(now + leaseMs, linkId, owner, now);
    return result.changes === 1;
  }

  /** Forget everything this mirror believed about the remote side. Used when a link is pointed at a
   *  DIFFERENT folder: the old baseline describes files that folder never had, and comparing against it
   *  would read every local file as remotely deleted and empty the project into the trash. */
  clearItems(linkId: number): void {
    this.db.prepare('DELETE FROM p_onedrive_items WHERE link_id = ?').run(linkId);
  }

  /** Drop every claim, whoever holds it. Only ever called at boot: this process has just started, so no
   *  cycle can be running, and any claim in the table belongs to a worker that is definitively gone.
   *  Waiting out its lease would leave the mirror idle for minutes for no reason. */
  releaseAllClaims(): void {
    this.db.prepare('UPDATE p_onedrive_links SET running_owner = NULL, running_until = NULL').run();
  }

  release(linkId: number, owner: string): void {
    this.db.prepare('UPDATE p_onedrive_links SET running_owner = NULL, running_until = NULL WHERE id = ? AND running_owner = ?')
      .run(linkId, owner);
  }

  finish(linkId: number, patch: { status: LinkStatus; error: string | null; fileCount: number; byteCount: number; conflictCount: number }): void {
    this.db.prepare(
      `UPDATE p_onedrive_links SET status = ?, error = ?, file_count = ?, byte_count = ?, conflict_count = ?, last_sync_at = ?
       WHERE id = ?`,
    ).run(patch.status, patch.error, patch.fileCount, patch.byteCount, patch.conflictCount, Date.now(), linkId);
  }

  setStatus(linkId: number, status: LinkStatus, error: string | null = null): void {
    this.db.prepare('UPDATE p_onedrive_links SET status = ?, error = ? WHERE id = ?').run(status, error, linkId);
  }

  setEnabled(linkId: number, enabled: boolean): void {
    this.db.prepare('UPDATE p_onedrive_links SET enabled = ?, status = ? WHERE id = ?')
      .run(enabled ? 1 : 0, enabled ? 'idle' : 'paused', linkId);
  }

  /** Remove a mirror and its baseline. The remote folder is deliberately LEFT ALONE: disconnecting is an
   *  Elowen-side decision and must never reach into somebody's OneDrive and delete their files. */
  removeLink(linkId: number): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM p_onedrive_items WHERE link_id = ?').run(linkId);
      this.db.prepare('DELETE FROM p_onedrive_links WHERE id = ?').run(linkId);
    });
  }

  removeProject(projectId: number): void {
    const ids = this.db.prepare('SELECT id FROM p_onedrive_links WHERE project_id = ?').all(projectId)
      .map((row) => num((row as Record<string, unknown>).id));
    for (const id of ids) this.removeLink(id);
  }

  removeUser(userId: number): void {
    const ids = this.db.prepare('SELECT id FROM p_onedrive_links WHERE user_id = ?').all(userId)
      .map((row) => num((row as Record<string, unknown>).id));
    for (const id of ids) this.removeLink(id);
  }

  items(linkId: number): Map<string, MirrorItem> {
    const rows = this.db.prepare('SELECT * FROM p_onedrive_items WHERE link_id = ?').all(linkId);
    return new Map(rows.map((row) => {
      const item = toItem(row as Record<string, unknown>);
      return [item.rel, item];
    }));
  }

  conflicts(linkId: number): MirrorItem[] {
    return this.db.prepare(`SELECT * FROM p_onedrive_items WHERE link_id = ? AND state = 'conflict' ORDER BY rel_path`)
      .all(linkId).map((row) => toItem(row as Record<string, unknown>));
  }

  putItem(item: Omit<MirrorItem, 'updatedAt'>): void {
    this.db.prepare(
      `INSERT INTO p_onedrive_items
       (link_id, rel_path, local_size, local_mtime_ms, local_sha256, remote_item_id, remote_etag, state, conflict_copy, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (link_id, rel_path) DO UPDATE SET
         local_size = excluded.local_size, local_mtime_ms = excluded.local_mtime_ms,
         local_sha256 = excluded.local_sha256, remote_item_id = excluded.remote_item_id,
         remote_etag = excluded.remote_etag, state = excluded.state,
         conflict_copy = excluded.conflict_copy, updated_at = excluded.updated_at`,
    ).run(item.linkId, item.rel, item.localSize, item.localMtimeMs, item.localSha256,
      item.remoteItemId, item.remoteEtag, item.state, item.conflictCopy, Date.now());
  }

  dropItem(linkId: number, rel: string): void {
    this.db.prepare('DELETE FROM p_onedrive_items WHERE link_id = ? AND rel_path = ?').run(linkId, rel);
  }

}
