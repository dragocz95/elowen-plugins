export const VISIBILITIES = ['private', 'project', 'authenticated', 'public'];
const asVisibility = (value) => VISIBILITIES.includes(value) ? value : 'private';
const asStatus = (value) => value === 'live' || value === 'failed' || value === 'deleting' ? value : 'draft';
const asRuntime = (value) => {
    if (value === 'static' || value === 'command' || value === 'php' || value === 'environment') {
        return { runtime: value, unsupportedRuntime: null };
    }
    return { runtime: 'unsupported', unsupportedRuntime: value ?? '(null)' };
};
const asEnvironmentDesiredState = (value) => value === 'stopped' || value === 'restarting' ? value : 'running';
const toSite = (row) => {
    const runtime = asRuntime(row.runtime);
    return {
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
        runtime: runtime.runtime,
        unsupportedRuntime: runtime.unsupportedRuntime,
        startCommand: row.start_command ?? '',
        bind: row.bind === 'port' ? 'port' : 'socket',
        port: row.port,
        environmentCpus: row.environment_cpus,
        environmentMemoryMb: row.environment_memory_mb,
        environmentPidsLimit: row.environment_pids_limit,
        environmentDiskSoftMb: row.environment_disk_soft_mb,
        environmentDesiredState: asEnvironmentDesiredState(row.environment_desired_state),
        status: runtime.runtime === 'unsupported' ? 'failed' : asStatus(row.status),
        currentReleaseId: row.current_release_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        createdModel: row.created_model ?? '',
        lastPublishAt: row.last_publish_at,
        lastPublishModel: row.last_publish_model,
        lastError: runtime.runtime === 'unsupported'
            ? `Unsupported site runtime: ${runtime.unsupportedRuntime}`
            : row.last_error,
    };
};
const toRelease = (row) => ({
    id: row.id,
    siteId: row.site_id,
    createdAt: row.created_at,
    model: row.model ?? '',
    fileCount: row.file_count,
    sizeBytes: row.size_bytes,
    note: row.note ?? '',
    kind: row.kind === 'environment-snapshot' ? row.kind : 'files',
    imageRef: row.image_ref,
    dataArchive: row.data_archive,
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
            {
                version: 5,
                // Additive environment metadata. Existing static, command and PHP rows retain every value and
                // behavior; nullable overrides continue to mean the administrator defaults.
                up: (handle) => {
                    handle.exec(`
            ALTER TABLE p_sites_sites ADD COLUMN environment_cpus REAL;
            ALTER TABLE p_sites_sites ADD COLUMN environment_memory_mb INTEGER;
            ALTER TABLE p_sites_sites ADD COLUMN environment_pids_limit INTEGER;
            ALTER TABLE p_sites_sites ADD COLUMN environment_disk_soft_mb INTEGER;
            ALTER TABLE p_sites_sites ADD COLUMN environment_desired_state TEXT NOT NULL DEFAULT 'running';
            ALTER TABLE p_sites_releases ADD COLUMN kind TEXT NOT NULL DEFAULT 'files';
            ALTER TABLE p_sites_releases ADD COLUMN image_ref TEXT;
            ALTER TABLE p_sites_releases ADD COLUMN data_archive TEXT;
          `);
                },
            },
            {
                version: 6,
                // Rollback crosses the daemon-only broker boundary, so the request itself is durable. A single row
                // per site also prevents two restore operations from interleaving across plugin reloads.
                up: (handle) => {
                    handle.exec(`
            CREATE TABLE IF NOT EXISTS p_sites_environment_actions (
              site_id TEXT PRIMARY KEY,
              kind TEXT NOT NULL,
              snapshot_id TEXT NOT NULL,
              restore_data INTEGER NOT NULL DEFAULT 0,
              requested_at TEXT NOT NULL,
              last_error TEXT
            );
          `);
                },
            },
            {
                version: 7,
                // Snapshots use the same daemon-owned durable action slot as rollback. Payloads are bounded by the
                // tool/API boundary and contain no command or host path.
                up: (handle) => {
                    handle.exec(`
            ALTER TABLE p_sites_environment_actions ADD COLUMN include_data INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE p_sites_environment_actions ADD COLUMN note TEXT NOT NULL DEFAULT '';
            ALTER TABLE p_sites_environment_actions ADD COLUMN model TEXT NOT NULL DEFAULT '';
          `);
                },
            },
            {
                version: 8,
                // Exec may run in a forked worker while lifecycle reconciliation runs in the daemon. A bounded
                // database lease makes that exclusion cross-process without persisting commands or output.
                up: (handle) => {
                    handle.exec(`
            CREATE TABLE IF NOT EXISTS p_sites_environment_exec_leases (
              site_id TEXT PRIMARY KEY,
              token TEXT NOT NULL,
              expires_at INTEGER NOT NULL
            );
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
        source_dir, spa, runtime, start_command, bind, port,
        environment_cpus, environment_memory_mb, environment_pids_limit, environment_disk_soft_mb,
        environment_desired_state, status, current_release_id,
        created_at, updated_at, created_model, last_publish_at, last_publish_model, last_error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(site.id, site.slug, site.title, site.summary, site.projectId, site.ownerUserId, site.visibility, site.accessGeneration, site.sourceDir, site.spa ? 1 : 0, site.runtime, site.startCommand, site.bind, site.port, site.environmentCpus ?? null, site.environmentMemoryMb ?? null, site.environmentPidsLimit ?? null, site.environmentDiskSoftMb ?? null, site.environmentDesiredState ?? 'running', site.status, site.currentReleaseId, site.createdAt, site.updatedAt, site.createdModel, site.lastPublishAt, site.lastPublishModel, site.lastError);
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
    countEnvironmentOwnedBy(userId) {
        const row = this.db.prepare(`
      SELECT COUNT(*) AS n FROM p_sites_sites
      WHERE owner_user_id = ? AND runtime = 'environment' AND status <> 'deleting'
    `).get(userId);
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
    liveEnvironmentSites() {
        return this.db.prepare(`
      SELECT * FROM p_sites_sites
      WHERE runtime = 'environment' AND status = 'live'
    `).all().map(toSite);
    }
    environmentSitesForReconcile() {
        return this.db.prepare(`
      SELECT * FROM p_sites_sites
      WHERE runtime = 'environment' AND status <> 'deleting'
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
            bind: 'bind',
            port: 'port',
            startCommand: 'start_command',
            environmentCpus: 'environment_cpus',
            environmentMemoryMb: 'environment_memory_mb',
            environmentPidsLimit: 'environment_pids_limit',
            environmentDiskSoftMb: 'environment_disk_soft_mb',
            environmentDesiredState: 'environment_desired_state',
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
            this.db.prepare('DELETE FROM p_sites_environment_actions WHERE site_id = ?').run(id);
            this.db.prepare('DELETE FROM p_sites_environment_exec_leases WHERE site_id = ?').run(id);
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
      INSERT INTO p_sites_releases (
        id, site_id, created_at, model, file_count, size_bytes, note, kind, image_ref, data_archive
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(release.id, release.siteId, release.createdAt, release.model, release.fileCount, release.sizeBytes, release.note, release.kind ?? 'files', release.imageRef ?? null, release.dataArchive ?? null);
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
    environmentAction(siteId) {
        const row = this.db.prepare('SELECT * FROM p_sites_environment_actions WHERE site_id = ?').get(siteId);
        if (!row || (row.kind !== 'snapshot' && row.kind !== 'rollback'))
            return null;
        const common = {
            siteId: row.site_id,
            snapshotId: row.snapshot_id,
            requestedAt: row.requested_at,
            lastError: row.last_error,
        };
        return row.kind === 'snapshot'
            ? { ...common, kind: 'snapshot', includeData: row.include_data === 1, note: row.note, model: row.model }
            : { ...common, kind: 'rollback', restoreData: row.restore_data === 1 };
    }
    putEnvironmentAction(action) {
        const snapshot = action.kind === 'snapshot';
        this.db.prepare(`
      INSERT INTO p_sites_environment_actions (
        site_id, kind, snapshot_id, restore_data, include_data, note, model, requested_at, last_error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(site_id) DO UPDATE SET
        kind = excluded.kind, snapshot_id = excluded.snapshot_id, restore_data = excluded.restore_data,
        include_data = excluded.include_data, note = excluded.note, model = excluded.model,
        requested_at = excluded.requested_at, last_error = excluded.last_error
    `).run(action.siteId, action.kind, action.snapshotId, !snapshot && action.restoreData ? 1 : 0, snapshot && action.includeData ? 1 : 0, snapshot ? action.note : '', snapshot ? action.model : '', action.requestedAt, action.lastError);
    }
    tryBeginEnvironmentExec(siteId, token, expiresAt) {
        return this.db.transaction(() => {
            const now = Date.now();
            this.db.prepare('DELETE FROM p_sites_environment_exec_leases WHERE expires_at <= ?').run(now);
            const result = this.db.prepare(`
        INSERT INTO p_sites_environment_exec_leases (site_id, token, expires_at)
        SELECT ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM p_sites_sites
          WHERE id = ? AND runtime = 'environment' AND environment_desired_state = 'running'
        )
          AND NOT EXISTS (SELECT 1 FROM p_sites_environment_actions WHERE site_id = ?)
          AND NOT EXISTS (SELECT 1 FROM p_sites_environment_exec_leases WHERE site_id = ?)
      `).run(siteId, token, expiresAt, siteId, siteId, siteId);
            return result.changes === 1;
        });
    }
    endEnvironmentExec(siteId, token) {
        this.db.prepare('DELETE FROM p_sites_environment_exec_leases WHERE site_id = ? AND token = ?').run(siteId, token);
    }
    tryPutEnvironmentAction(action) {
        return this.db.transaction(() => {
            const now = Date.now();
            this.db.prepare('DELETE FROM p_sites_environment_exec_leases WHERE expires_at <= ?').run(now);
            if (this.db.prepare('SELECT 1 FROM p_sites_environment_exec_leases WHERE site_id = ?').get(action.siteId))
                return false;
            const existing = this.db.prepare('SELECT last_error FROM p_sites_environment_actions WHERE site_id = ?')
                .get(action.siteId);
            if (existing?.last_error === null)
                return false;
            if (!existing) {
                const site = this.db.prepare('SELECT environment_desired_state FROM p_sites_sites WHERE id = ? AND runtime = ?')
                    .get(action.siteId, 'environment');
                if (site?.environment_desired_state !== 'running')
                    return false;
            }
            const snapshot = action.kind === 'snapshot';
            const result = this.db.prepare(`
        INSERT INTO p_sites_environment_actions (
          site_id, kind, snapshot_id, restore_data, include_data, note, model, requested_at, last_error
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(site_id) DO UPDATE SET
          kind = excluded.kind, snapshot_id = excluded.snapshot_id, restore_data = excluded.restore_data,
          include_data = excluded.include_data, note = excluded.note, model = excluded.model,
          requested_at = excluded.requested_at, last_error = NULL
        WHERE p_sites_environment_actions.last_error IS NOT NULL
      `).run(action.siteId, action.kind, action.snapshotId, !snapshot && action.restoreData ? 1 : 0, snapshot && action.includeData ? 1 : 0, snapshot ? action.note.slice(0, 200) : '', snapshot ? action.model.slice(0, 200) : '', action.requestedAt, action.lastError);
            if (result.changes !== 1)
                return false;
            this.db.prepare(`
        UPDATE p_sites_sites SET environment_desired_state = 'restarting', updated_at = ? WHERE id = ?
      `).run(new Date().toISOString(), action.siteId);
            return true;
        });
    }
    clearErroredEnvironmentAction(siteId) {
        return this.db.prepare(`
      DELETE FROM p_sites_environment_actions WHERE site_id = ? AND last_error IS NOT NULL
    `).run(siteId).changes === 1;
    }
    tryRequestEnvironmentControl(siteId, desiredState) {
        return this.db.transaction(() => {
            const now = Date.now();
            this.db.prepare('DELETE FROM p_sites_environment_exec_leases WHERE expires_at <= ?').run(now);
            if (this.db.prepare('SELECT 1 FROM p_sites_environment_exec_leases WHERE site_id = ?').get(siteId))
                return false;
            const action = this.db.prepare('SELECT last_error FROM p_sites_environment_actions WHERE site_id = ?')
                .get(siteId);
            if (action?.last_error === null)
                return false;
            if (action)
                this.db.prepare('DELETE FROM p_sites_environment_actions WHERE site_id = ?').run(siteId);
            return this.db.prepare(`
        UPDATE p_sites_sites
        SET environment_desired_state = ?, last_error = NULL, updated_at = ?
        WHERE id = ? AND runtime = 'environment'
      `).run(desiredState, new Date().toISOString(), siteId).changes === 1;
        });
    }
    completeEnvironmentRestart(siteId) {
        const result = this.db.prepare(`
      UPDATE p_sites_sites
      SET environment_desired_state = 'running', status = 'live', last_error = NULL, updated_at = ?
      WHERE id = ? AND environment_desired_state = 'restarting'
    `).run(new Date().toISOString(), siteId);
        return result.changes === 1;
    }
    completeEnvironmentAction(siteId, currentReleaseId) {
        return this.db.transaction(() => {
            const currentRelease = currentReleaseId === undefined ? '' : ', current_release_id = ?';
            const values = currentReleaseId === undefined
                ? [new Date().toISOString(), siteId, siteId]
                : [currentReleaseId, new Date().toISOString(), siteId, siteId];
            const result = this.db.prepare(`
        UPDATE p_sites_sites
        SET environment_desired_state = 'running', status = 'live', last_error = NULL${currentRelease}, updated_at = ?
        WHERE id = ? AND environment_desired_state = 'restarting'
          AND EXISTS (SELECT 1 FROM p_sites_environment_actions WHERE site_id = ?)
      `).run(...values);
            if (result.changes !== 1)
                return false;
            this.db.prepare('DELETE FROM p_sites_environment_actions WHERE site_id = ?').run(siteId);
            return true;
        });
    }
    updateEnvironmentActionError(siteId, error) {
        this.db.prepare('UPDATE p_sites_environment_actions SET last_error = ? WHERE site_id = ?').run(error, siteId);
    }
    deleteEnvironmentAction(siteId) {
        this.db.prepare('DELETE FROM p_sites_environment_actions WHERE site_id = ?').run(siteId);
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
