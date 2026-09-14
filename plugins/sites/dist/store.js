import { isAbsolute, relative, sep } from 'node:path';
export const VISIBILITIES = ['private', 'project', 'authenticated', 'public'];
const toPreviewImage = (row) => ({
    siteId: row.site_id,
    state: row.state === 'ready' ? 'ready' : row.state === 'failed' ? 'failed' : 'none',
    version: row.version,
    capturedAt: row.captured_at,
    width: row.width,
    height: row.height,
    bytes: row.bytes,
    mime: row.mime,
    lastError: row.last_error,
    nextAttemptAt: row.next_attempt_at,
    requestedAt: row.requested_at,
    requestedBy: row.requested_by,
    attempts: row.attempts,
});
const asVisibility = (value) => VISIBILITIES.includes(value) ? value : 'private';
const asStatus = (value) => value === 'live' || value === 'failed' || value === 'deleting' ? value : 'draft';
/** A row written before the publication model existed is a static publication, which is exactly what
 *  the migration's default says and what the serving path did for it. */
const asPublicationKind = (value) => value === 'proxy' ? 'proxy' : 'static';
const toSite = (row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary ?? '',
    projectId: row.project_id,
    ownerUserId: row.owner_user_id,
    visibility: asVisibility(row.visibility),
    accessGeneration: row.access_generation,
    sourceRel: row.source_rel,
    spa: row.spa === 1,
    kind: asPublicationKind(row.kind),
    target: row.target ?? '',
    status: asStatus(row.status),
    currentReleaseId: row.current_release_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdModel: row.created_model ?? '',
    lastPublishAt: row.last_publish_at,
    lastPublishModel: row.last_publish_model,
    lastError: row.last_error,
    certificateRequestedAt: row.certificate_requested_at,
    certificateError: row.certificate_error,
});
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
                // Historical environment metadata remains in the schema for audit compatibility. Retired rows
                // keep their stored values, but current Sites code never exposes or executes them.
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
            {
                version: 9,
                // Converting a live site's runtime spans a container build, a legacy process stop and a column
                // flip, so it cannot be one call: a crash between any two of those must leave the site either
                // fully legacy or fully converted, never guessing. This slot records the undo material BEFORE
                // the first side effect, which is the only reason a rollback can restore the exact command and
                // release the site had. Purely additive: no existing row is read or rewritten.
                up: (handle) => {
                    handle.exec(`
            CREATE TABLE IF NOT EXISTS p_sites_runtime_migrations (
              site_id TEXT PRIMARY KEY,
              stage TEXT NOT NULL,
              from_runtime TEXT NOT NULL,
              from_release_id TEXT,
              from_start_command TEXT NOT NULL DEFAULT '',
              from_bind TEXT NOT NULL DEFAULT 'socket',
              from_port INTEGER,
              recipe TEXT NOT NULL,
              content_digest TEXT,
              requested_at TEXT NOT NULL,
              last_error TEXT
            );
          `);
                },
            },
            {
                version: 10,
                // A conversion crosses several destructive boundaries, and every one of them needs a durable
                // answer to "did this already happen": whether the legacy runtime is stopped and owed a restart,
                // how far a rollback got before it failed, and which archive is authoritative for the writes the
                // container made. Purely additive.
                up: (handle) => {
                    handle.exec(`
            ALTER TABLE p_sites_runtime_migrations ADD COLUMN final_digest TEXT;
            ALTER TABLE p_sites_runtime_migrations ADD COLUMN legacy_home TEXT;
            ALTER TABLE p_sites_runtime_migrations ADD COLUMN broker_prepared INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE p_sites_runtime_migrations ADD COLUMN legacy_stopped INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE p_sites_runtime_migrations ADD COLUMN rollback_stage TEXT NOT NULL DEFAULT 'none';
            ALTER TABLE p_sites_runtime_migrations ADD COLUMN rollback_archive TEXT;
          `);
                },
            },
            {
                version: 11,
                up: (handle) => handle.exec(`
          CREATE TABLE p_sites_runtime_records (
            site_id TEXT NOT NULL,
            record_key TEXT NOT NULL,
            value TEXT NOT NULL,
            PRIMARY KEY (site_id, record_key)
          );
        `),
            },
            {
                version: 12,
                up: handle => handle.exec(`CREATE TABLE p_sites_project_previews (
          id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, project_id INTEGER NOT NULL,
          port INTEGER NOT NULL, created_at TEXT NOT NULL, UNIQUE(project_id, port)
        );`),
            },
            {
                version: 13,
                // The disk figure was never a limit: no container setting carried it, so a per-site value could not
                // change anything the runtime did. The setting, its copy and every read of the column are gone;
                // this drops the column they left behind.
                up: handle => handle.exec('ALTER TABLE p_sites_sites DROP COLUMN environment_disk_soft_mb;'),
            },
            {
                version: 14,
                // A publication now says what it IS, not which container serves it: `static` answers from a copied
                // release, `proxy` from an application inside the managed Project's own environment. Purely
                // additive — every existing row is a static publication by the default and keeps its values. The
                // legacy runtime columns remain for audit compatibility after their executable paths are retired.
                up: handle => handle.exec(`
          ALTER TABLE p_sites_sites ADD COLUMN kind TEXT NOT NULL DEFAULT 'static';
          ALTER TABLE p_sites_sites ADD COLUMN target TEXT NOT NULL DEFAULT '';
        `),
            },
            {
                version: 15,
                // Completed conversions remain as an audit trail. Rollback intent is durable too, so an API request
                // may return before the daemon performs the long-running restore and destructive retirement.
                up: handle => handle.exec(`
          ALTER TABLE p_sites_runtime_migrations ADD COLUMN rollback_restore_data INTEGER NOT NULL DEFAULT 1;
          ALTER TABLE p_sites_runtime_migrations ADD COLUMN rollback_requested INTEGER NOT NULL DEFAULT 0;
          ALTER TABLE p_sites_runtime_migrations ADD COLUMN completed_at TEXT;
        `),
            },
            {
                version: 16,
                // Durable Sandbox request ids belong to one conversion attempt. A completed rollback may convert the
                // same Site again, so the Site id alone cannot identify operations in the next runtime generation.
                up: handle => handle.exec(`
          ALTER TABLE p_sites_runtime_migrations ADD COLUMN attempt_id TEXT NOT NULL DEFAULT '';
          UPDATE p_sites_runtime_migrations SET attempt_id = site_id || ':' || requested_at WHERE attempt_id = '';
        `),
            },
            {
                version: 17,
                // Backfilled at plugin boot where the owning Project paths are available. Until that succeeds no Site
                // row is read, so an invalid absolute legacy source cannot be mistaken for a relative reference.
                up: handle => handle.exec('ALTER TABLE p_sites_sites ADD COLUMN source_rel TEXT;'),
            },
            {
                version: 18,
                // Publication readiness, as opposed to a claim about it. The request column is the seam a forked
                // runner asks through; the error column is the only way a process without the privileged broker can
                // learn why an issuance attempt failed. Both default to null, so every existing site starts out as
                // "nothing requested, nothing failed" and its state is decided by the certificate actually served.
                up: handle => handle.exec(`
          ALTER TABLE p_sites_sites ADD COLUMN certificate_requested_at TEXT;
          ALTER TABLE p_sites_sites ADD COLUMN certificate_error TEXT;
        `),
            },
            {
                version: 19,
                // A register that shows a picture of each published page. One row per Site, holding the metadata of
                // the ONE image a Site may keep: a capture replaces both together, so a row can never describe an
                // image that is not the one on disk. The grant table is the other half of that: a one-use,
                // site-and-generation-bound token the capture presents through the published hostname, which is
                // how a page behind an access rule is rendered without inventing a visitor for it. Purely additive.
                up: handle => handle.exec(`
          CREATE TABLE IF NOT EXISTS p_sites_previews (
            site_id TEXT PRIMARY KEY,
            state TEXT NOT NULL DEFAULT 'none',
            version INTEGER NOT NULL DEFAULT 0,
            captured_at TEXT,
            width INTEGER,
            height INTEGER,
            bytes INTEGER,
            mime TEXT,
            last_error TEXT,
            next_attempt_at INTEGER NOT NULL DEFAULT 0,
            requested_at INTEGER,
            requested_by TEXT,
            attempts INTEGER NOT NULL DEFAULT 0
          );
          CREATE TABLE IF NOT EXISTS p_sites_capture_grants (
            token_hash TEXT PRIMARY KEY,
            site_id TEXT NOT NULL,
            access_generation INTEGER NOT NULL,
            expires_at INTEGER NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_p_sites_capture_grants_site ON p_sites_capture_grants (site_id);
        `),
            },
        ]);
    }
    migrateSourceReferences(projectRoot) {
        const columns = this.db.prepare("PRAGMA table_info('p_sites_sites')").all();
        const hasLegacy = columns.some((column) => column.name === 'source_dir');
        if (!hasLegacy) {
            const invalid = this.db.prepare("SELECT id FROM p_sites_sites WHERE source_rel IS NULL AND runtime = 'static'").get();
            if (invalid)
                throw new Error(`Site ${invalid.id} has no Project-relative source reference`);
            return;
        }
        this.db.transaction(() => {
            const rows = this.db.prepare('SELECT id, slug, project_id, kind, runtime, source_dir, source_rel FROM p_sites_sites').all();
            const update = this.db.prepare('UPDATE p_sites_sites SET source_rel = ? WHERE id = ?');
            for (const row of rows) {
                if (row.runtime !== 'static') {
                    if (row.source_rel === null)
                        update.run(row.source_dir, row.id);
                    continue;
                }
                if (row.source_rel !== null)
                    continue;
                if (row.kind === 'proxy' && row.source_dir === '') {
                    update.run('', row.id);
                    continue;
                }
                const root = projectRoot(row.project_id);
                if (!root || !isAbsolute(root) || !isAbsolute(row.source_dir)) {
                    throw new Error(`Site ${row.slug} cannot migrate its source because Project ${row.project_id} has no host source root`);
                }
                const rel = relative(root, row.source_dir);
                if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
                    throw new Error(`Site ${row.slug} source ${row.source_dir} is outside Project ${row.project_id} root ${root}`);
                }
                update.run(rel.split(sep).join('/'), row.id);
            }
            this.db.prepare('ALTER TABLE p_sites_sites DROP COLUMN source_dir').run();
        });
    }
    projectPreview(projectId, port) {
        return this.db.prepare('SELECT id, slug, project_id AS projectId, port, created_at AS createdAt FROM p_sites_project_previews WHERE project_id = ? AND port = ?').get(projectId, port) ?? null;
    }
    previewBySlug(slug) {
        return this.db.prepare('SELECT id, slug, project_id AS projectId, port, created_at AS createdAt FROM p_sites_project_previews WHERE slug = ?').get(slug) ?? null;
    }
    previewById(id) {
        return this.db.prepare('SELECT id, slug, project_id AS projectId, port, created_at AS createdAt FROM p_sites_project_previews WHERE id = ?').get(id) ?? null;
    }
    insertPreview(preview) {
        this.db.prepare('INSERT INTO p_sites_project_previews (id, slug, project_id, port, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(project_id, port) DO NOTHING').run(preview.id, preview.slug, preview.projectId, preview.port, preview.createdAt);
    }
    allPreviews() {
        return this.db.prepare('SELECT id, slug, project_id AS projectId, port, created_at AS createdAt FROM p_sites_project_previews').all();
    }
    previewsInProject(projectId) {
        return this.db.prepare('SELECT id, slug, project_id AS projectId, port, created_at AS createdAt FROM p_sites_project_previews WHERE project_id = ?').all(projectId);
    }
    deletePreviews(projectId) {
        this.db.transaction(() => {
            this.db.prepare('DELETE FROM p_sites_tickets WHERE site_id IN (SELECT id FROM p_sites_project_previews WHERE project_id = ?)').run(projectId);
            this.db.prepare('DELETE FROM p_sites_project_previews WHERE project_id = ?').run(projectId);
        });
    }
    transaction(fn) {
        return this.db.transaction(fn);
    }
    insertSite(site) {
        const legacyColumn = this.db.prepare("PRAGMA table_info('p_sites_sites')").all()
            .some((column) => column.name === 'source_dir');
        this.db.prepare(`
      INSERT INTO p_sites_sites (
        id, slug, title, summary, project_id, owner_user_id, visibility, access_generation,
        ${legacyColumn ? 'source_dir, ' : ''}source_rel, spa, kind, target, runtime, start_command, bind, port,
        environment_cpus, environment_memory_mb, environment_pids_limit,
        environment_desired_state, status, current_release_id,
        created_at, updated_at, created_model, last_publish_at, last_publish_model, last_error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${legacyColumn ? "'', " : ''}?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(site.id, site.slug, site.title, site.summary, site.projectId, site.ownerUserId, site.visibility, site.accessGeneration, site.sourceRel, site.spa ? 1 : 0, site.kind, site.target, 'static', '', 'socket', null, null, null, null, 'running', site.status, site.currentReleaseId, site.createdAt, site.updatedAt, site.createdModel, site.lastPublishAt, site.lastPublishModel, site.lastError);
    }
    siteById(id) {
        const row = this.db.prepare("SELECT * FROM p_sites_sites WHERE id = ? AND runtime = 'static'").get(id);
        return row ? toSite(row) : null;
    }
    siteBySlug(slug) {
        const row = this.db.prepare("SELECT * FROM p_sites_sites WHERE slug = ? AND runtime = 'static'").get(slug);
        return row ? toSite(row) : null;
    }
    /** Internal cleanup lookup. Dormant legacy environment rows are deliberately absent from ordinary readers. */
    siteForCleanup(id) {
        const row = this.db.prepare('SELECT * FROM p_sites_sites WHERE id = ?').get(id);
        return row ? toSite(row) : null;
    }
    slugTaken(slug) {
        return this.db.prepare('SELECT 1 FROM p_sites_sites WHERE slug = ?').get(slug) !== undefined;
    }
    sitesOwnedBy(userId) {
        return this.db.prepare("SELECT * FROM p_sites_sites WHERE owner_user_id = ? AND runtime = 'static' AND status <> 'deleting' ORDER BY created_at DESC")
            .all(userId).map(toSite);
    }
    countOwnedBy(userId) {
        const row = this.db.prepare("SELECT COUNT(*) AS n FROM p_sites_sites WHERE owner_user_id = ? AND runtime = 'static' AND status <> 'deleting'")
            .get(userId);
        return row?.n ?? 0;
    }
    sitesInProjects(projectIds) {
        if (projectIds.length === 0)
            return [];
        const marks = projectIds.map(() => '?').join(', ');
        return this.db.prepare(`SELECT * FROM p_sites_sites WHERE project_id IN (${marks}) AND runtime = 'static' AND status <> 'deleting' ORDER BY created_at DESC`)
            .all(...projectIds).map(toSite);
    }
    sitesSharedWith(userId) {
        return this.db.prepare(`
      SELECT s.* FROM p_sites_sites s
      JOIN p_sites_members m ON m.site_id = s.id
      WHERE m.user_id = ? AND s.runtime = 'static' AND s.status <> 'deleting' ORDER BY s.created_at DESC
    `).all(userId).map(toSite);
    }
    /** Every proxy publication that is expected to answer. A draft is not: its transport must not be kept
     *  alive before anybody published it. A `failed` one IS, because that is how the row recovers once the
     *  application inside the Project answers again. */
    proxySitesForReconcile() {
        return this.db.prepare(`
      SELECT * FROM p_sites_sites
      WHERE kind = 'proxy' AND runtime = 'static' AND status IN ('live', 'failed')
    `).all().map(toSite);
    }
    allSites() {
        return this.db.prepare("SELECT * FROM p_sites_sites WHERE runtime = 'static' AND status <> 'deleting' ORDER BY created_at DESC").all().map(toSite);
    }
    deletingSites() {
        return this.db.prepare("SELECT * FROM p_sites_sites WHERE runtime = 'static' AND status = 'deleting' ORDER BY updated_at").all().map(toSite);
    }
    updateSite(id, patch) {
        const columns = {
            title: 'title',
            summary: 'summary',
            visibility: 'visibility',
            spa: 'spa',
            status: 'status',
            currentReleaseId: 'current_release_id',
            lastPublishAt: 'last_publish_at',
            lastPublishModel: 'last_publish_model',
            lastError: 'last_error',
            certificateRequestedAt: 'certificate_requested_at',
            certificateError: 'certificate_error',
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
            // The picture this Site kept goes with it, and so does any grant minted for a capture of it: a
            // tombstone that still answered with a photograph of the deleted page would be the one read path
            // the durable delete marker had not closed.
            this.db.prepare('DELETE FROM p_sites_previews WHERE site_id = ?').run(id);
            this.db.prepare('DELETE FROM p_sites_capture_grants WHERE site_id = ?').run(id);
        });
    }
    deleteSite(id) {
        this.db.transaction(() => {
            this.db.prepare('DELETE FROM p_sites_members WHERE site_id = ?').run(id);
            this.db.prepare('DELETE FROM p_sites_releases WHERE site_id = ?').run(id);
            this.db.prepare('DELETE FROM p_sites_tickets WHERE site_id = ?').run(id);
            this.db.prepare('DELETE FROM p_sites_hits WHERE site_id = ?').run(id);
            this.db.prepare('DELETE FROM p_sites_previews WHERE site_id = ?').run(id);
            this.db.prepare('DELETE FROM p_sites_capture_grants WHERE site_id = ?').run(id);
            this.db.prepare('DELETE FROM p_sites_environment_actions WHERE site_id = ?').run(id);
            this.db.prepare('DELETE FROM p_sites_environment_exec_leases WHERE site_id = ?').run(id);
            this.db.prepare('DELETE FROM p_sites_runtime_migrations WHERE site_id = ?').run(id);
            this.db.prepare('DELETE FROM p_sites_runtime_records WHERE site_id = ?').run(id);
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
    /** The stored picture of one Site's page, or null when none was ever taken. */
    previewImage(siteId) {
        const row = this.db.prepare('SELECT * FROM p_sites_previews WHERE site_id = ?').get(siteId);
        return row ? toPreviewImage(row) : null;
    }
    /** Remember that a capture was asked for. It survives a plugin reload, so a request that was in flight
     *  when the plugin went away is still visible as one rather than silently forgotten. */
    markPreviewImageRequested(siteId, cause, now) {
        this.db.prepare(`
      INSERT INTO p_sites_previews (site_id, state, version, next_attempt_at, requested_at, requested_by)
      VALUES (?, 'none', 0, 0, ?, ?)
      ON CONFLICT(site_id) DO UPDATE SET requested_at = excluded.requested_at, requested_by = excluded.requested_by
    `).run(siteId, now, cause);
    }
    /** Record the image that is now on disk, and make it the one this Site serves.
     *
     *  Called only AFTER the bytes have been replaced atomically, and the version is bumped here rather than
     *  passed in, so the metadata always describes the image a client will fetch with that version. */
    storePreviewImage(siteId, image, now) {
        return this.db.transaction(() => {
            const version = (this.previewImage(siteId)?.version ?? 0) + 1;
            this.db.prepare(`
        INSERT INTO p_sites_previews (site_id, state, version, captured_at, width, height, bytes, mime, last_error, next_attempt_at, requested_at, requested_by, attempts)
        VALUES (?, 'ready', ?, ?, ?, ?, ?, ?, NULL, 0, NULL, NULL, 0)
        ON CONFLICT(site_id) DO UPDATE SET
          state = 'ready', version = excluded.version, captured_at = excluded.captured_at,
          width = excluded.width, height = excluded.height, bytes = excluded.bytes, mime = excluded.mime,
          last_error = NULL, next_attempt_at = 0, requested_at = NULL, requested_by = NULL, attempts = 0
      `).run(siteId, version, new Date(now).toISOString(), image.width, image.height, image.bytes, image.mime);
            return version;
        });
    }
    /** Record a failed attempt. The stored image, its version and its capture time are deliberately left
     *  alone: a picture that was true a minute ago is still worth showing, and the failure is what says so. */
    failPreviewImage(siteId, message, nextAttemptAt) {
        this.db.prepare(`
      INSERT INTO p_sites_previews (site_id, state, version, last_error, next_attempt_at, requested_at, requested_by, attempts)
      VALUES (?, 'failed', 0, ?, ?, NULL, NULL, 1)
      ON CONFLICT(site_id) DO UPDATE SET
        state = 'failed', last_error = excluded.last_error, next_attempt_at = excluded.next_attempt_at,
        requested_at = NULL, requested_by = NULL, attempts = p_sites_previews.attempts + 1
    `).run(siteId, message, nextAttemptAt);
    }
    deletePreviewImage(siteId) {
        this.db.prepare('DELETE FROM p_sites_previews WHERE site_id = ?').run(siteId);
    }
    /** Write the one outstanding capture grant of a Site. A new capture replaces the previous one, so a
     *  grant that was never claimed cannot be replayed after a second capture was asked for. */
    putCaptureGrant(tokenHash, siteId, accessGeneration, expiresAt) {
        this.db.transaction(() => {
            this.db.prepare('DELETE FROM p_sites_capture_grants WHERE site_id = ?').run(siteId);
            this.db.prepare('INSERT INTO p_sites_capture_grants (token_hash, site_id, access_generation, expires_at) VALUES (?, ?, ?, ?)')
                .run(tokenHash, siteId, accessGeneration, expiresAt);
        });
    }
    /** Claim a capture grant. The delete IS the claim, so two requests presenting the same token cannot both
     *  be answered, and a token that is unknown, expired or minted under an older access generation is
     *  refused identically — consuming it either way, so nothing can be probed by replay. */
    takeCaptureGrant(tokenHash, siteId, accessGeneration, now) {
        return this.db.transaction(() => {
            const row = this.db.prepare('SELECT site_id AS siteId, access_generation AS accessGeneration, expires_at AS expiresAt FROM p_sites_capture_grants WHERE token_hash = ?')
                .get(tokenHash);
            if (!row)
                return false;
            this.db.prepare('DELETE FROM p_sites_capture_grants WHERE token_hash = ?').run(tokenHash);
            return row.siteId === siteId && row.accessGeneration === accessGeneration && row.expiresAt > now;
        });
    }
    pruneCaptureGrants(now) {
        this.db.prepare('DELETE FROM p_sites_capture_grants WHERE expires_at <= ?').run(now);
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
    /** Active publications an account owns, for account deletion. Retired runtime rows remain audit data. */
    siteIdsOwnedBy(userId) {
        return this.db.prepare("SELECT id FROM p_sites_sites WHERE owner_user_id = ? AND runtime = 'static'")
            .all(userId).map((row) => row.id);
    }
    /** The active publications that keep a Project alive. A site queued for deletion is not one of them:
     *  counting it here would let the preflight allow a Project removal that the post-removal hook then
     *  refuses, after the Project row is already gone. */
    siteIdsInProject(projectId) {
        return this.db.prepare("SELECT id FROM p_sites_sites WHERE project_id = ? AND runtime = 'static' AND status <> 'deleting'")
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
