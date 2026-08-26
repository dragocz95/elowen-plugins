const num = (value) => (typeof value === 'number' ? value : Number(value ?? 0));
const str = (value) => (typeof value === 'string' ? value : '');
const nullableStr = (value) => (typeof value === 'string' && value !== '' ? value : null);
function toLink(row) {
    return {
        id: num(row.id),
        userId: num(row.user_id),
        projectId: num(row.project_id),
        workspaceId: nullableStr(row.workspace_id),
        workspaceLabel: nullableStr(row.workspace_label),
        remoteDriveId: str(row.remote_drive_id),
        remoteItemId: str(row.remote_item_id),
        remotePath: str(row.remote_path),
        webUrl: nullableStr(row.web_url),
        enabled: num(row.enabled) === 1,
        status: (str(row.status) || 'idle'),
        error: nullableStr(row.error),
        lastSyncAt: row.last_sync_at == null ? null : num(row.last_sync_at),
        fileCount: num(row.file_count),
        byteCount: num(row.byte_count),
        conflictCount: num(row.conflict_count),
        createdAt: num(row.created_at),
    };
}
function toItem(row) {
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
    db;
    constructor(db) {
        this.db = db;
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

    `) }]);
    }
    createLink(input) {
        const now = Date.now();
        this.db.prepare(`INSERT INTO p_onedrive_links
      (user_id, project_id, workspace_id, workspace_label, remote_drive_id, remote_item_id, remote_path, web_url, enabled, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'idle', ?)
      ON CONFLICT (user_id, project_id, COALESCE(workspace_id, '')) DO UPDATE SET
        enabled = 1, status = 'idle', error = NULL,
        remote_drive_id = excluded.remote_drive_id,
        remote_item_id = excluded.remote_item_id,
        remote_path = excluded.remote_path,
        web_url = excluded.web_url,
        workspace_label = excluded.workspace_label`)
            .run(input.userId, input.projectId, input.workspaceId, input.workspaceLabel, input.remoteDriveId, input.remoteItemId, input.remotePath, input.webUrl, now);
        return this.linkFor(input.userId, input.projectId, input.workspaceId);
    }
    linkFor(userId, projectId, workspaceId) {
        const row = this.db.prepare(`SELECT * FROM p_onedrive_links WHERE user_id = ? AND project_id = ? AND COALESCE(workspace_id, '') = ?`).get(userId, projectId, workspaceId ?? '');
        return row ? toLink(row) : null;
    }
    linkById(id) {
        const row = this.db.prepare('SELECT * FROM p_onedrive_links WHERE id = ?').get(id);
        return row ? toLink(row) : null;
    }
    linksForProject(userId, projectId) {
        return this.db.prepare('SELECT * FROM p_onedrive_links WHERE user_id = ? AND project_id = ? ORDER BY workspace_id IS NOT NULL, workspace_label, id')
            .all(userId, projectId).map((row) => toLink(row));
    }
    linksForUser(userId) {
        return this.db.prepare('SELECT * FROM p_onedrive_links WHERE user_id = ? ORDER BY id')
            .all(userId).map((row) => toLink(row));
    }
    /** Accounts with at least one live mirror — the work list a background cycle iterates, read from a
     *  column rather than from an ambient identity the worker does not have. */
    activeUserIds() {
        return this.db.prepare('SELECT DISTINCT user_id FROM p_onedrive_links WHERE enabled = 1')
            .all().map((row) => num(row.user_id));
    }
    enabledLinks() {
        return this.db.prepare('SELECT * FROM p_onedrive_links WHERE enabled = 1 ORDER BY COALESCE(last_sync_at, 0)')
            .all().map((row) => toLink(row));
    }
    /** Take the lock on one mirror, or report that somebody else holds it.
     *
     *  The daemon and a forked runner both load this plugin, so "one worker at a time" cannot be enforced
     *  by a variable in one process. The claim is a conditional UPDATE — the row itself decides — and it
     *  carries an expiry so a worker killed mid-cycle releases it by simply not being there any more. */
    claim(linkId, owner, leaseMs, now = Date.now()) {
        const result = this.db.prepare(`UPDATE p_onedrive_links SET running_owner = ?, running_until = ?
       WHERE id = ? AND enabled = 1 AND (running_until IS NULL OR running_until < ?)`).run(owner, now + leaseMs, linkId, now);
        return result.changes === 1;
    }
    /** Extend a claim this worker still holds, and report whether it still holds it.
     *
     *  A lease that expires MID-CYCLE is worse than no lease: another worker takes the row, forms its own
     *  plan, and the first worker then applies a plan built from state that has since been re-decided —
     *  overwriting exactly what the second one just protected. The cycle renews as it works, and a renewal
     *  that returns false means it was displaced and must stop touching files immediately. */
    renew(linkId, owner, leaseMs, now = Date.now()) {
        const result = this.db.prepare('UPDATE p_onedrive_links SET running_until = ? WHERE id = ? AND running_owner = ? AND running_until >= ?').run(now + leaseMs, linkId, owner, now);
        return result.changes === 1;
    }
    /** Forget everything this mirror believed about the remote side. Used when a link is pointed at a
     *  DIFFERENT folder: the old baseline describes files that folder never had, and comparing against it
     *  would read every local file as remotely deleted and empty the project into the trash. */
    clearItems(linkId) {
        this.db.prepare('DELETE FROM p_onedrive_items WHERE link_id = ?').run(linkId);
    }
    release(linkId, owner) {
        this.db.prepare('UPDATE p_onedrive_links SET running_owner = NULL, running_until = NULL WHERE id = ? AND running_owner = ?')
            .run(linkId, owner);
    }
    finish(linkId, patch) {
        this.db.prepare(`UPDATE p_onedrive_links SET status = ?, error = ?, file_count = ?, byte_count = ?, conflict_count = ?, last_sync_at = ?
       WHERE id = ?`).run(patch.status, patch.error, patch.fileCount, patch.byteCount, patch.conflictCount, Date.now(), linkId);
    }
    setStatus(linkId, status, error = null) {
        this.db.prepare('UPDATE p_onedrive_links SET status = ?, error = ? WHERE id = ?').run(status, error, linkId);
    }
    setEnabled(linkId, enabled) {
        this.db.prepare('UPDATE p_onedrive_links SET enabled = ?, status = ? WHERE id = ?')
            .run(enabled ? 1 : 0, enabled ? 'idle' : 'paused', linkId);
    }
    /** Remove a mirror and its baseline. The remote folder is deliberately LEFT ALONE: disconnecting is an
     *  Elowen-side decision and must never reach into somebody's OneDrive and delete their files. */
    removeLink(linkId) {
        this.db.transaction(() => {
            this.db.prepare('DELETE FROM p_onedrive_items WHERE link_id = ?').run(linkId);
            this.db.prepare('DELETE FROM p_onedrive_links WHERE id = ?').run(linkId);
        });
    }
    removeProject(projectId) {
        const ids = this.db.prepare('SELECT id FROM p_onedrive_links WHERE project_id = ?').all(projectId)
            .map((row) => num(row.id));
        for (const id of ids)
            this.removeLink(id);
    }
    removeUser(userId) {
        const ids = this.db.prepare('SELECT id FROM p_onedrive_links WHERE user_id = ?').all(userId)
            .map((row) => num(row.id));
        for (const id of ids)
            this.removeLink(id);
    }
    items(linkId) {
        const rows = this.db.prepare('SELECT * FROM p_onedrive_items WHERE link_id = ?').all(linkId);
        return new Map(rows.map((row) => {
            const item = toItem(row);
            return [item.rel, item];
        }));
    }
    conflicts(linkId) {
        return this.db.prepare(`SELECT * FROM p_onedrive_items WHERE link_id = ? AND state = 'conflict' ORDER BY rel_path`)
            .all(linkId).map((row) => toItem(row));
    }
    putItem(item) {
        this.db.prepare(`INSERT INTO p_onedrive_items
       (link_id, rel_path, local_size, local_mtime_ms, local_sha256, remote_item_id, remote_etag, state, conflict_copy, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (link_id, rel_path) DO UPDATE SET
         local_size = excluded.local_size, local_mtime_ms = excluded.local_mtime_ms,
         local_sha256 = excluded.local_sha256, remote_item_id = excluded.remote_item_id,
         remote_etag = excluded.remote_etag, state = excluded.state,
         conflict_copy = excluded.conflict_copy, updated_at = excluded.updated_at`).run(item.linkId, item.rel, item.localSize, item.localMtimeMs, item.localSha256, item.remoteItemId, item.remoteEtag, item.state, item.conflictCopy, Date.now());
    }
    dropItem(linkId, rel) {
        this.db.prepare('DELETE FROM p_onedrive_items WHERE link_id = ? AND rel_path = ?').run(linkId, rel);
    }
}
