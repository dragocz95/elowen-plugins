export const VISIBILITIES = ['private', 'project', 'authenticated', 'public'];
const asVisibility = (value) => VISIBILITIES.includes(value) ? value : 'private';
const asStatus = (value) => value === 'live' || value === 'failed' || value === 'deleting' ? value : 'draft';
const toSite = (row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary ?? '',
    projectId: row.project_id,
    ownerUserId: row.owner_user_id,
    visibility: asVisibility(row.visibility),
    accessGeneration: row.access_generation,
    sourceDir: row.source_dir,
    spa: row.spa === 1,
    runtime: row.runtime === 'command' ? 'command' : row.runtime === 'php' ? 'php' : 'static',
    startCommand: row.start_command ?? '',
    bind: row.bind === 'port' ? 'port' : 'socket',
    port: row.port,
    status: asStatus(row.status),
    currentReleaseId: row.current_release_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdModel: row.created_model ?? '',
    lastPublishAt: row.last_publish_at,
    lastPublishModel: row.last_publish_model,
    lastError: row.last_error,
});
const toRelease = (row) => ({
    id: row.id,
    siteId: row.site_id,
    createdAt: row.created_at,
    model: row.model ?? '',
    fileCount: row.file_count,
    sizeBytes: row.size_bytes,
    note: row.note ?? '',
});
export class SitesStore {
    db;
    constructor(db) {
        this.db = db;
        db.migrate([
            {
                version: 1,
                up: (handle) => {
                    handle.exec(`
            CREATE TABLE IF NOT EXISTS p_sites_sites (
              id TEXT PRIMARY KEY,
              slug TEXT NOT NULL UNIQUE,
              title TEXT NOT NULL,
              summary TEXT NOT NULL DEFAULT '',
              project_id INTEGER NOT NULL,
              owner_user_id INTEGER NOT NULL,
              visibility TEXT NOT NULL DEFAULT 'private',
              access_generation INTEGER NOT NULL DEFAULT 1,
              source_dir TEXT NOT NULL,
              spa INTEGER NOT NULL DEFAULT 0,
              status TEXT NOT NULL DEFAULT 'draft',
              current_release_id TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              created_model TEXT NOT NULL DEFAULT '',
              last_publish_at TEXT,
              last_publish_model TEXT,
              last_error TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_p_sites_sites_owner ON p_sites_sites (owner_user_id);
            CREATE INDEX IF NOT EXISTS idx_p_sites_sites_project ON p_sites_sites (project_id);

            CREATE TABLE IF NOT EXISTS p_sites_members (
              site_id TEXT NOT NULL,
              user_id INTEGER NOT NULL,
              added_at TEXT NOT NULL,
              PRIMARY KEY (site_id, user_id)
            );
            CREATE INDEX IF NOT EXISTS idx_p_sites_members_user ON p_sites_members (user_id);

            CREATE TABLE IF NOT EXISTS p_sites_releases (
              id TEXT PRIMARY KEY,
              site_id TEXT NOT NULL,
              created_at TEXT NOT NULL,
              model TEXT NOT NULL DEFAULT '',
              file_count INTEGER NOT NULL DEFAULT 0,
              size_bytes INTEGER NOT NULL DEFAULT 0,
              note TEXT NOT NULL DEFAULT ''
            );
            CREATE INDEX IF NOT EXISTS idx_p_sites_releases_site ON p_sites_releases (site_id, created_at DESC);

            CREATE TABLE IF NOT EXISTS p_sites_tickets (
              token_hash TEXT PRIMARY KEY,
              site_id TEXT NOT NULL,
              user_id INTEGER NOT NULL,
              return_path TEXT NOT NULL DEFAULT '',
              expires_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS p_sites_hits (
              site_id TEXT NOT NULL,
              day TEXT NOT NULL,
              count INTEGER NOT NULL DEFAULT 0,
              PRIMARY KEY (site_id, day)
            );
          `);
                },
            },
            {
                version: 2,
                // A site can now answer from a process instead of from files. Existing rows are static, which
                // is what the defaults say, so nothing has to be rewritten.
                up: (handle) => {
                    handle.exec(`
            ALTER TABLE p_sites_sites ADD COLUMN runtime TEXT NOT NULL DEFAULT 'static';
            ALTER TABLE p_sites_sites ADD COLUMN start_command TEXT NOT NULL DEFAULT '';
            ALTER TABLE p_sites_sites ADD COLUMN bind TEXT NOT NULL DEFAULT 'socket';
            ALTER TABLE p_sites_sites ADD COLUMN port INTEGER;
          `);
                },
            },
            {
                version: 3,
                // Two sites must never be handed the same loopback port: readiness would then connect to the
                // neighbour's listener and report a site healthy that never started.
                up: (handle) => {
                    handle.exec(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_p_sites_sites_port
              ON p_sites_sites (port) WHERE port IS NOT NULL;
          `);
                },
            },
            {
                version: 4,
                // Loopback ports share the host network and therefore cannot enforce the site's access boundary.
                // Stop legacy rows from restarting until their owner republishes onto the isolated socket transport.
                up: (handle) => {
                    handle.exec(`
            UPDATE p_sites_sites
              SET bind = 'socket', port = NULL, status = 'failed',
                  last_error = 'Republish this runtime for the isolated socket transport'
              WHERE bind = 'port' OR port IS NOT NULL;
          `);
                },
            },
        ]);
    }
    transaction(fn) {
        return this.db.transaction(fn);
    }
    insertSite(site) {
        this.db.prepare(`
      INSERT INTO p_sites_sites (
        id, slug, title, summary, project_id, owner_user_id, visibility, access_generation,
        source_dir, spa, runtime, start_command, bind, port, status, current_release_id,
        created_at, updated_at, created_model, last_publish_at, last_publish_model, last_error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(site.id, site.slug, site.title, site.summary, site.projectId, site.ownerUserId, site.visibility, site.accessGeneration, site.sourceDir, site.spa ? 1 : 0, site.runtime, site.startCommand, site.bind, site.port, site.status, site.currentReleaseId, site.createdAt, site.updatedAt, site.createdModel, site.lastPublishAt, site.lastPublishModel, site.lastError);
    }
    siteById(id) {
        const row = this.db.prepare('SELECT * FROM p_sites_sites WHERE id = ?').get(id);
        return row ? toSite(row) : null;
    }
    siteBySlug(slug) {
        const row = this.db.prepare('SELECT * FROM p_sites_sites WHERE slug = ?').get(slug);
        return row ? toSite(row) : null;
    }
    slugTaken(slug) {
        return this.db.prepare('SELECT 1 FROM p_sites_sites WHERE slug = ?').get(slug) !== undefined;
    }
    sitesOwnedBy(userId) {
        return this.db.prepare("SELECT * FROM p_sites_sites WHERE owner_user_id = ? AND status <> 'deleting' ORDER BY created_at DESC")
            .all(userId).map(toSite);
    }
    countOwnedBy(userId) {
        const row = this.db.prepare("SELECT COUNT(*) AS n FROM p_sites_sites WHERE owner_user_id = ? AND status <> 'deleting'")
            .get(userId);
        return row?.n ?? 0;
    }
    sitesInProjects(projectIds) {
        if (projectIds.length === 0)
            return [];
        const marks = projectIds.map(() => '?').join(', ');
        return this.db.prepare(`SELECT * FROM p_sites_sites WHERE project_id IN (${marks}) AND status <> 'deleting' ORDER BY created_at DESC`)
            .all(...projectIds).map(toSite);
    }
    sitesSharedWith(userId) {
        return this.db.prepare(`
      SELECT s.* FROM p_sites_sites s
      JOIN p_sites_members m ON m.site_id = s.id
      WHERE m.user_id = ? AND s.status <> 'deleting' ORDER BY s.created_at DESC
    `).all(userId).map(toSite);
    }
    /** Every command site that should be running. What boot reconciliation restarts, because nothing in
     *  the daemon supervises a process across a restart. */
    liveCommandSites() {
        return this.db.prepare(`
      SELECT * FROM p_sites_sites
      WHERE runtime = 'command' AND status = 'live' AND current_release_id IS NOT NULL
    `).all().map(toSite);
    }
    portsInUse() {
        return this.db.prepare('SELECT port FROM p_sites_sites WHERE port IS NOT NULL')
            .all().map((row) => row.port);
    }
    allSites() {
        return this.db.prepare("SELECT * FROM p_sites_sites WHERE status <> 'deleting' ORDER BY created_at DESC").all().map(toSite);
    }
    deletingSites() {
        return this.db.prepare("SELECT * FROM p_sites_sites WHERE status = 'deleting' ORDER BY updated_at").all().map(toSite);
    }
    updateSite(id, patch) {
        const columns = {
            title: 'title',
            summary: 'summary',
            visibility: 'visibility',
            spa: 'spa',
            port: 'port',
            startCommand: 'start_command',
            status: 'status',
            currentReleaseId: 'current_release_id',
            lastPublishAt: 'last_publish_at',
            lastPublishModel: 'last_publish_model',
            lastError: 'last_error',
        };
        const sets = [];
        const values = [];
        for (const [key, value] of Object.entries(patch)) {
            const column = columns[key];
            if (!column)
                continue;
            sets.push(`${column} = ?`);
            values.push(typeof value === 'boolean' ? (value ? 1 : 0) : value ?? null);
        }
        if (sets.length === 0)
            return;
        sets.push('updated_at = ?');
        values.push(new Date().toISOString(), id);
        this.db.prepare(`UPDATE p_sites_sites SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    }
    /** Invalidate every site session issued so far. Called by every change to who may open the site. */
    bumpAccessGeneration(id) {
        this.db.prepare('UPDATE p_sites_sites SET access_generation = access_generation + 1, updated_at = ? WHERE id = ?')
            .run(new Date().toISOString(), id);
    }
    /** Make deletion durable BEFORE touching a process or filesystem. The site disappears from every list,
     * stops authorising immediately, and a crash leaves a row boot reconciliation can finish. Idempotent. */
    beginDelete(id) {
        this.db.transaction(() => {
            this.db.prepare(`
        UPDATE p_sites_sites
        SET status = 'deleting', current_release_id = NULL,
            access_generation = access_generation + 1, updated_at = ?
        WHERE id = ?
      `).run(new Date().toISOString(), id);
            this.db.prepare('DELETE FROM p_sites_members WHERE site_id = ?').run(id);
            this.db.prepare('DELETE FROM p_sites_tickets WHERE site_id = ?').run(id);
            this.db.prepare('DELETE FROM p_sites_hits WHERE site_id = ?').run(id);
        });
    }
    deleteSite(id) {
        this.db.transaction(() => {
            this.db.prepare('DELETE FROM p_sites_members WHERE site_id = ?').run(id);
            this.db.prepare('DELETE FROM p_sites_releases WHERE site_id = ?').run(id);
            this.db.prepare('DELETE FROM p_sites_tickets WHERE site_id = ?').run(id);
            this.db.prepare('DELETE FROM p_sites_hits WHERE site_id = ?').run(id);
            this.db.prepare('DELETE FROM p_sites_sites WHERE id = ?').run(id);
        });
    }
    memberUserIds() {
        return this.db.prepare('SELECT DISTINCT user_id FROM p_sites_members ORDER BY user_id').all()
            .map((row) => row.user_id);
    }
    memberIds(siteId) {
        return this.db.prepare('SELECT user_id FROM p_sites_members WHERE site_id = ? ORDER BY added_at')
            .all(siteId).map((row) => row.user_id);
    }
    isMember(siteId, userId) {
        return this.db.prepare('SELECT 1 FROM p_sites_members WHERE site_id = ? AND user_id = ?')
            .get(siteId, userId) !== undefined;
    }
    addMember(siteId, userId) {
        this.db.prepare('INSERT OR IGNORE INTO p_sites_members (site_id, user_id, added_at) VALUES (?, ?, ?)')
            .run(siteId, userId, new Date().toISOString());
    }
    removeMember(siteId, userId) {
        this.db.prepare('DELETE FROM p_sites_members WHERE site_id = ? AND user_id = ?').run(siteId, userId);
    }
    replaceMembers(siteId, userIds) {
        this.db.transaction(() => {
            this.db.prepare('DELETE FROM p_sites_members WHERE site_id = ?').run(siteId);
            const insert = this.db.prepare('INSERT INTO p_sites_members (site_id, user_id, added_at) VALUES (?, ?, ?)');
            const addedAt = new Date().toISOString();
            for (const userId of [...new Set(userIds)])
                insert.run(siteId, userId, addedAt);
            this.bumpAccessGeneration(siteId);
        });
    }
    insertRelease(release) {
        this.db.prepare(`
      INSERT INTO p_sites_releases (id, site_id, created_at, model, file_count, size_bytes, note)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(release.id, release.siteId, release.createdAt, release.model, release.fileCount, release.sizeBytes, release.note);
    }
    releases(siteId) {
        return this.db.prepare('SELECT * FROM p_sites_releases WHERE site_id = ? ORDER BY created_at DESC')
            .all(siteId).map(toRelease);
    }
    release(siteId, releaseId) {
        const row = this.db.prepare('SELECT * FROM p_sites_releases WHERE site_id = ? AND id = ?')
            .get(siteId, releaseId);
        return row ? toRelease(row) : null;
    }
    deleteRelease(siteId, releaseId) {
        this.db.prepare('DELETE FROM p_sites_releases WHERE site_id = ? AND id = ?').run(siteId, releaseId);
    }
    putTicket(tokenHash, ticket) {
        this.db.prepare(`
      INSERT OR REPLACE INTO p_sites_tickets (token_hash, site_id, user_id, return_path, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(tokenHash, ticket.siteId, ticket.userId, ticket.returnPath, ticket.expiresAt);
    }
    /** Consume a ticket ATOMICALLY: the delete is the claim, so two concurrent redemptions cannot both
     *  succeed. A ticket that is missing, expired or already used answers null identically. */
    takeTicket(tokenHash, now) {
        return this.db.transaction(() => {
            const row = this.db.prepare('SELECT * FROM p_sites_tickets WHERE token_hash = ?').get(tokenHash);
            if (!row)
                return null;
            this.db.prepare('DELETE FROM p_sites_tickets WHERE token_hash = ?').run(tokenHash);
            if (row.expires_at <= now)
                return null;
            return { siteId: row.site_id, userId: row.user_id, returnPath: row.return_path, expiresAt: row.expires_at };
        });
    }
    pruneTickets(now) {
        this.db.prepare('DELETE FROM p_sites_tickets WHERE expires_at <= ?').run(now);
    }
    recordHits(siteId, day, count) {
        this.db.prepare(`
      INSERT INTO p_sites_hits (site_id, day, count) VALUES (?, ?, ?)
      ON CONFLICT(site_id, day) DO UPDATE SET count = count + excluded.count
    `).run(siteId, day, count);
    }
    hits(siteId, sinceDay) {
        return this.db.prepare('SELECT day, count FROM p_sites_hits WHERE site_id = ? AND day >= ? ORDER BY day')
            .all(siteId, sinceDay);
    }
    /** Every site an account owns, for account deletion. */
    siteIdsOwnedBy(userId) {
        return this.db.prepare('SELECT id FROM p_sites_sites WHERE owner_user_id = ?')
            .all(userId).map((row) => row.id);
    }
    siteIdsInProject(projectId) {
        return this.db.prepare('SELECT id FROM p_sites_sites WHERE project_id = ?')
            .all(projectId).map((row) => row.id);
    }
    /** Guest rows of an account that no longer exists. Removing the account must not leave it able to
     *  open anything, and must not leave a dangling row that renders as a blank avatar either. */
    forgetMemberEverywhere(userId) {
        const siteIds = this.db.prepare('SELECT site_id FROM p_sites_members WHERE user_id = ?')
            .all(userId).map((row) => row.site_id);
        this.db.prepare('DELETE FROM p_sites_members WHERE user_id = ?').run(userId);
        return siteIds;
    }
}
