import { isAbsolute, relative, sep } from 'node:path';
import type { PluginDb } from 'elowen/plugin-api';

export interface ProjectPreview { id: string; slug: string; projectId: number; port: number; createdAt: string }

export type Visibility = 'private' | 'project' | 'authenticated' | 'public';
type SiteStatus = 'draft' | 'live' | 'failed' | 'deleting';

/** How a published address answers.
 *
 *  `static` is a release copied onto the host and served from those files. `proxy` is an application
 *  running on a loopback port inside the managed Project's own environment, reached through the durable
 *  transport Sandbox establishes for the publication. The kind, not the legacy runtime column, decides
 *  which of the two a row is; the runtime column survives only for rows created before this model and
 *  goes away with the per-site container path. */
export type PublicationKind = 'static' | 'proxy';

/** How a published site answers a request. Unsupported is a quarantined database value, never a
 * fallback to static content. */
type SiteRuntime = 'static' | 'command' | 'php' | 'environment' | 'unsupported';

/** Where a command runtime listens. A unix socket lives inside the plugin's own data directory, which
 *  no confined shell can reach, so only the daemon can talk to it. A loopback port is reachable by any
 *  process on the machine — including a confined one, because the sandbox does not unshare the network
 *  — so it bypasses the site's access rules entirely and is only for runtimes that cannot do better. */
type SiteBind = 'socket' | 'port';

export const VISIBILITIES: readonly Visibility[] = ['private', 'project', 'authenticated', 'public'];

export interface Site {
  id: string;
  slug: string;
  title: string;
  summary: string;
  projectId: number;
  ownerUserId: number;
  visibility: Visibility;
  /** Bumped by every access change. A site session carries the generation it was minted under, so an
   *  edit invalidates sessions issued before it without keeping a session table to sweep. It is a
   *  freshness marker only: whether the viewer may still open the site is re-decided per request. */
  accessGeneration: number;
  /** Normalized path inside the owning Project workspace. Empty only for proxy publications. */
  sourceRel: string;
  spa: boolean;
  /** Which publication model this row follows. See {@link PublicationKind}. */
  kind: PublicationKind;
  /** For a `proxy` publication the port the application listens on INSIDE the Project container; for a
   *  static one the guest path of its folder, which is not read yet and is therefore empty on every row
   *  this plugin creates. The column is text because the two kinds carry different things. */
  target: string;
  runtime: SiteRuntime;
  /** Original database value when runtime is unsupported. */
  unsupportedRuntime?: string | null;
  /** Shell command that starts the server, run inside the release directory. Empty for a static site. */
  startCommand: string;
  bind: SiteBind;
  /** Loopback port for a port-bound runtime; null for a socket-bound one. */
  port: number | null;
  status: SiteStatus;
  currentReleaseId: string | null;
  createdAt: string;
  updatedAt: string;
  createdModel: string;
  lastPublishAt: string | null;
  lastPublishModel: string | null;
  lastError: string | null;
  /** Set when a publish asks for this site's certificate and cleared by the attempt that answers it. It is
   *  how a forked runner — which holds no gateway broker — asks the daemon for ONE site's certificate, and
   *  it overrides the per-slug issuance backoff for that one request. Optional like every other column
   *  added after the table existed: a row is INSERTED without it and reads always carry it. */
  certificateRequestedAt?: string | null;
  /** Why the last issuance attempt the daemon actually made failed, or null when it succeeded. The only
   *  way a process without the broker can learn the authority's own reason. */
  certificateError?: string | null;
}

export interface Release {
  id: string;
  siteId: string;
  createdAt: string;
  model: string;
  fileCount: number;
  sizeBytes: number;
  note: string;
  kind?: 'files' | 'environment-snapshot';
  imageRef?: string | null;
  dataArchive?: string | null;
}

export interface Ticket {
  siteId: string;
  userId: number;
  returnPath: string;
  expiresAt: number;
}


interface SiteDbRow {
  id: string;
  slug: string;
  title: string;
  summary: string;
  project_id: number;
  owner_user_id: number;
  visibility: string;
  access_generation: number;
  source_rel: string;
  spa: number;
  kind: string | null;
  target: string | null;
  runtime: string | null;
  start_command: string | null;
  bind: string | null;
  port: number | null;
  environment_cpus: number | null;
  environment_memory_mb: number | null;
  environment_pids_limit: number | null;
  environment_desired_state: string | null;
  status: string;
  current_release_id: string | null;
  created_at: string;
  updated_at: string;
  created_model: string;
  last_publish_at: string | null;
  last_publish_model: string | null;
  last_error: string | null;
  certificate_requested_at: string | null;
  certificate_error: string | null;
}

interface ReleaseDbRow {
  id: string;
  site_id: string;
  created_at: string;
  model: string;
  file_count: number;
  size_bytes: number;
  note: string;
  kind: string | null;
  image_ref: string | null;
  data_archive: string | null;
}

const asVisibility = (value: string): Visibility =>
  (VISIBILITIES as readonly string[]).includes(value) ? value as Visibility : 'private';

const asStatus = (value: string): SiteStatus =>
  value === 'live' || value === 'failed' || value === 'deleting' ? value : 'draft';

const asRuntime = (value: string | null): { runtime: SiteRuntime; unsupportedRuntime: string | null } => {
  if (value === 'static' || value === 'command' || value === 'php') {
    return { runtime: value, unsupportedRuntime: null };
  }
  return { runtime: 'unsupported', unsupportedRuntime: value ?? '(null)' };
};


/** A row written before the publication model existed is a static publication, which is exactly what
 *  the migration's default says and what the serving path did for it. */
const asPublicationKind = (value: string | null): PublicationKind => value === 'proxy' ? 'proxy' : 'static';

const toSite = (row: SiteDbRow): Site => {
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
    sourceRel: row.source_rel,
    spa: row.spa === 1,
    kind: asPublicationKind(row.kind),
    target: row.target ?? '',
    runtime: runtime.runtime,
    unsupportedRuntime: runtime.unsupportedRuntime,
    startCommand: row.start_command ?? '',
    bind: row.bind === 'port' ? 'port' : 'socket',
    port: row.port,
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
    certificateRequestedAt: row.certificate_requested_at,
    certificateError: row.certificate_error,
  };
};


const toRelease = (row: ReleaseDbRow): Release => ({
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
  constructor(private readonly db: PluginDb) {
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
        // additive — every existing row is a static publication by the default, keeps its values and is
        // served exactly as before, and the legacy runtime columns stay until the per-site container path
        // and the last converted row are gone.
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
    ]);
  }

  migrateSourceReferences(projectRoot: (projectId: number) => string | null): void {
    const columns = this.db.prepare("PRAGMA table_info('p_sites_sites')").all() as { name: string }[];
    const hasLegacy = columns.some((column) => column.name === 'source_dir');
    if (!hasLegacy) {
      const invalid = this.db.prepare('SELECT id FROM p_sites_sites WHERE source_rel IS NULL').get() as { id: string } | undefined;
      if (invalid) throw new Error(`Site ${invalid.id} has no Project-relative source reference`);
      return;
    }
    this.db.transaction(() => {
      const rows = this.db.prepare('SELECT id, slug, project_id, kind, source_dir, source_rel FROM p_sites_sites').all() as {
        id: string; slug: string; project_id: number; kind: string | null; source_dir: string; source_rel: string | null;
      }[];
      const update = this.db.prepare('UPDATE p_sites_sites SET source_rel = ? WHERE id = ?');
      for (const row of rows) {
        if (row.source_rel !== null) continue;
        if (row.kind === 'proxy' && row.source_dir === '') { update.run('', row.id); continue; }
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

  projectPreview(projectId: number, port: number): ProjectPreview | null {
    return this.db.prepare('SELECT id, slug, project_id AS projectId, port, created_at AS createdAt FROM p_sites_project_previews WHERE project_id = ? AND port = ?').get(projectId, port) as ProjectPreview | undefined ?? null;
  }
  previewBySlug(slug: string): ProjectPreview | null {
    return this.db.prepare('SELECT id, slug, project_id AS projectId, port, created_at AS createdAt FROM p_sites_project_previews WHERE slug = ?').get(slug) as ProjectPreview | undefined ?? null;
  }
  previewById(id: string): ProjectPreview | null {
    return this.db.prepare('SELECT id, slug, project_id AS projectId, port, created_at AS createdAt FROM p_sites_project_previews WHERE id = ?').get(id) as ProjectPreview | undefined ?? null;
  }
  insertPreview(preview: ProjectPreview): void {
    this.db.prepare('INSERT INTO p_sites_project_previews (id, slug, project_id, port, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(project_id, port) DO NOTHING').run(preview.id, preview.slug, preview.projectId, preview.port, preview.createdAt);
  }
  allPreviews(): ProjectPreview[] {
    return this.db.prepare('SELECT id, slug, project_id AS projectId, port, created_at AS createdAt FROM p_sites_project_previews').all() as ProjectPreview[];
  }
  previewsInProject(projectId: number): ProjectPreview[] {
    return this.db.prepare('SELECT id, slug, project_id AS projectId, port, created_at AS createdAt FROM p_sites_project_previews WHERE project_id = ?').all(projectId) as ProjectPreview[];
  }
  deletePreviews(projectId: number): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM p_sites_tickets WHERE site_id IN (SELECT id FROM p_sites_project_previews WHERE project_id = ?)').run(projectId);
      this.db.prepare('DELETE FROM p_sites_project_previews WHERE project_id = ?').run(projectId);
    });
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn);
  }

  insertSite(site: Site): void {
    const legacyColumn = (this.db.prepare("PRAGMA table_info('p_sites_sites')").all() as { name: string }[])
      .some((column) => column.name === 'source_dir');
    this.db.prepare(`
      INSERT INTO p_sites_sites (
        id, slug, title, summary, project_id, owner_user_id, visibility, access_generation,
        ${legacyColumn ? 'source_dir, ' : ''}source_rel, spa, kind, target, runtime, start_command, bind, port,
        environment_cpus, environment_memory_mb, environment_pids_limit,
        environment_desired_state, status, current_release_id,
        created_at, updated_at, created_model, last_publish_at, last_publish_model, last_error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${legacyColumn ? "'', " : ''}?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      site.id, site.slug, site.title, site.summary, site.projectId, site.ownerUserId,
      site.visibility, site.accessGeneration, site.sourceRel, site.spa ? 1 : 0,
      site.kind, site.target, site.runtime, site.startCommand, site.bind, site.port,
      null, null, null, 'running', site.status,
      site.currentReleaseId, site.createdAt, site.updatedAt, site.createdModel,
      site.lastPublishAt, site.lastPublishModel, site.lastError,
    );
  }

  siteById(id: string): Site | null {
    const row = this.db.prepare("SELECT * FROM p_sites_sites WHERE id = ? AND runtime <> 'environment'").get(id) as SiteDbRow | undefined;
    return row ? toSite(row) : null;
  }

  siteBySlug(slug: string): Site | null {
    const row = this.db.prepare("SELECT * FROM p_sites_sites WHERE slug = ? AND runtime <> 'environment'").get(slug) as SiteDbRow | undefined;
    return row ? toSite(row) : null;
  }

  /** Internal cleanup lookup. Dormant legacy environment rows are deliberately absent from ordinary readers. */
  siteForCleanup(id: string): Site | null {
    const row = this.db.prepare('SELECT * FROM p_sites_sites WHERE id = ?').get(id) as SiteDbRow | undefined;
    return row ? toSite(row) : null;
  }

  slugTaken(slug: string): boolean {
    return this.db.prepare('SELECT 1 FROM p_sites_sites WHERE slug = ?').get(slug) !== undefined;
  }

  sitesOwnedBy(userId: number): Site[] {
    return (this.db.prepare("SELECT * FROM p_sites_sites WHERE owner_user_id = ? AND runtime <> 'environment' AND status <> 'deleting' ORDER BY created_at DESC")
      .all(userId) as SiteDbRow[]).map(toSite);
  }

  countOwnedBy(userId: number): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM p_sites_sites WHERE owner_user_id = ? AND runtime <> 'environment' AND status <> 'deleting'")
      .get(userId) as { n: number } | undefined;
    return row?.n ?? 0;
  }


  sitesInProjects(projectIds: readonly number[]): Site[] {
    if (projectIds.length === 0) return [];
    const marks = projectIds.map(() => '?').join(', ');
    return (this.db.prepare(`SELECT * FROM p_sites_sites WHERE project_id IN (${marks}) AND runtime <> 'environment' AND status <> 'deleting' ORDER BY created_at DESC`)
      .all(...projectIds) as SiteDbRow[]).map(toSite);
  }

  sitesSharedWith(userId: number): Site[] {
    return (this.db.prepare(`
      SELECT s.* FROM p_sites_sites s
      JOIN p_sites_members m ON m.site_id = s.id
      WHERE m.user_id = ? AND s.runtime <> 'environment' AND s.status <> 'deleting' ORDER BY s.created_at DESC
    `).all(userId) as SiteDbRow[]).map(toSite);
  }

  /** Every command site that should be running. What boot reconciliation restarts, because nothing in
   *  the daemon supervises a process across a restart. */
  liveCommandSites(): Site[] {
    return (this.db.prepare(`
      SELECT * FROM p_sites_sites
      WHERE runtime = 'command' AND status = 'live' AND current_release_id IS NOT NULL
    `).all() as SiteDbRow[]).map(toSite);
  }


  /** Every proxy publication that is expected to answer. A draft is not: its transport must not be kept
   *  alive before anybody published it. A `failed` one IS, because that is how the row recovers once the
   *  application inside the Project answers again. */
  proxySitesForReconcile(): Site[] {
    return (this.db.prepare(`
      SELECT * FROM p_sites_sites
      WHERE kind = 'proxy' AND runtime <> 'environment' AND status IN ('live', 'failed')
    `).all() as SiteDbRow[]).map(toSite);
  }

  portsInUse(): number[] {
    return (this.db.prepare("SELECT port FROM p_sites_sites WHERE runtime <> 'environment' AND port IS NOT NULL")
      .all() as { port: number }[]).map((row) => row.port);
  }

  allSites(): Site[] {
    return (this.db.prepare("SELECT * FROM p_sites_sites WHERE runtime <> 'environment' AND status <> 'deleting' ORDER BY created_at DESC").all() as SiteDbRow[]).map(toSite);
  }

  deletingSites(): Site[] {
    return (this.db.prepare("SELECT * FROM p_sites_sites WHERE status = 'deleting' ORDER BY updated_at").all() as SiteDbRow[]).map(toSite);
  }

  updateSite(id: string, patch: Partial<Pick<Site,
    'title' | 'summary' | 'visibility' | 'spa' | 'status' | 'currentReleaseId' | 'bind' | 'port' |
    'startCommand' | 'lastPublishAt' | 'lastPublishModel' | 'lastError' |
    'certificateRequestedAt' | 'certificateError'>>): void {
    const columns: Record<string, string> = {
      title: 'title',
      summary: 'summary',
      visibility: 'visibility',
      spa: 'spa',
      bind: 'bind',
      port: 'port',
      startCommand: 'start_command',
      status: 'status',
      currentReleaseId: 'current_release_id',
      lastPublishAt: 'last_publish_at',
      lastPublishModel: 'last_publish_model',
      lastError: 'last_error',
      certificateRequestedAt: 'certificate_requested_at',
      certificateError: 'certificate_error',
    };
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [key, value] of Object.entries(patch)) {
      const column = columns[key];
      if (!column) continue;
      sets.push(`${column} = ?`);
      values.push(typeof value === 'boolean' ? (value ? 1 : 0) : value ?? null);
    }
    if (sets.length === 0) return;
    sets.push('updated_at = ?');
    values.push(new Date().toISOString(), id);
    this.db.prepare(`UPDATE p_sites_sites SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  /** Invalidate every site session issued so far. Called by every change to who may open the site. */
  bumpAccessGeneration(id: string): void {
    this.db.prepare('UPDATE p_sites_sites SET access_generation = access_generation + 1, updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), id);
  }

  /** Make deletion durable BEFORE touching a process or filesystem. The site disappears from every list,
   * stops authorising immediately, and a crash leaves a row boot reconciliation can finish. Idempotent. */
  beginDelete(id: string): void {
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

  deleteSite(id: string): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM p_sites_members WHERE site_id = ?').run(id);
      this.db.prepare('DELETE FROM p_sites_releases WHERE site_id = ?').run(id);
      this.db.prepare('DELETE FROM p_sites_tickets WHERE site_id = ?').run(id);
      this.db.prepare('DELETE FROM p_sites_hits WHERE site_id = ?').run(id);
      this.db.prepare('DELETE FROM p_sites_environment_actions WHERE site_id = ?').run(id);
      this.db.prepare('DELETE FROM p_sites_environment_exec_leases WHERE site_id = ?').run(id);
      this.db.prepare('DELETE FROM p_sites_runtime_migrations WHERE site_id = ?').run(id);
      this.db.prepare('DELETE FROM p_sites_runtime_records WHERE site_id = ?').run(id);
      this.db.prepare('DELETE FROM p_sites_sites WHERE id = ?').run(id);
    });
  }

  memberUserIds(): number[] {
    return (this.db.prepare('SELECT DISTINCT user_id FROM p_sites_members ORDER BY user_id').all() as { user_id: number }[])
      .map((row) => row.user_id);
  }

  memberIds(siteId: string): number[] {
    return (this.db.prepare('SELECT user_id FROM p_sites_members WHERE site_id = ? ORDER BY added_at')
      .all(siteId) as { user_id: number }[]).map((row) => row.user_id);
  }

  isMember(siteId: string, userId: number): boolean {
    return this.db.prepare('SELECT 1 FROM p_sites_members WHERE site_id = ? AND user_id = ?')
      .get(siteId, userId) !== undefined;
  }

  addMember(siteId: string, userId: number): void {
    this.db.prepare('INSERT OR IGNORE INTO p_sites_members (site_id, user_id, added_at) VALUES (?, ?, ?)')
      .run(siteId, userId, new Date().toISOString());
  }

  removeMember(siteId: string, userId: number): void {
    this.db.prepare('DELETE FROM p_sites_members WHERE site_id = ? AND user_id = ?').run(siteId, userId);
  }

  replaceMembers(siteId: string, userIds: number[]): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM p_sites_members WHERE site_id = ?').run(siteId);
      const insert = this.db.prepare('INSERT INTO p_sites_members (site_id, user_id, added_at) VALUES (?, ?, ?)');
      const addedAt = new Date().toISOString();
      for (const userId of [...new Set(userIds)]) insert.run(siteId, userId, addedAt);
      this.bumpAccessGeneration(siteId);
    });
  }

  insertRelease(release: Release): void {
    this.db.prepare(`
      INSERT INTO p_sites_releases (
        id, site_id, created_at, model, file_count, size_bytes, note, kind, image_ref, data_archive
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      release.id, release.siteId, release.createdAt, release.model, release.fileCount, release.sizeBytes,
      release.note, release.kind ?? 'files', release.imageRef ?? null, release.dataArchive ?? null,
    );
  }

  releases(siteId: string): Release[] {
    return (this.db.prepare('SELECT * FROM p_sites_releases WHERE site_id = ? ORDER BY created_at DESC')
      .all(siteId) as ReleaseDbRow[]).map(toRelease);
  }

  release(siteId: string, releaseId: string): Release | null {
    const row = this.db.prepare('SELECT * FROM p_sites_releases WHERE site_id = ? AND id = ?')
      .get(siteId, releaseId) as ReleaseDbRow | undefined;
    return row ? toRelease(row) : null;
  }

  deleteRelease(siteId: string, releaseId: string): void {
    this.db.prepare('DELETE FROM p_sites_releases WHERE site_id = ? AND id = ?').run(siteId, releaseId);
  }

  putTicket(tokenHash: string, ticket: Ticket): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO p_sites_tickets (token_hash, site_id, user_id, return_path, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(tokenHash, ticket.siteId, ticket.userId, ticket.returnPath, ticket.expiresAt);
  }

  /** Consume a ticket ATOMICALLY: the delete is the claim, so two concurrent redemptions cannot both
   *  succeed. A ticket that is missing, expired or already used answers null identically. */
  takeTicket(tokenHash: string, now: number): Ticket | null {
    return this.db.transaction(() => {
      const row = this.db.prepare('SELECT * FROM p_sites_tickets WHERE token_hash = ?').get(tokenHash) as
        { site_id: string; user_id: number; return_path: string; expires_at: number } | undefined;
      if (!row) return null;
      this.db.prepare('DELETE FROM p_sites_tickets WHERE token_hash = ?').run(tokenHash);
      if (row.expires_at <= now) return null;
      return { siteId: row.site_id, userId: row.user_id, returnPath: row.return_path, expiresAt: row.expires_at };
    });
  }

  pruneTickets(now: number): void {
    this.db.prepare('DELETE FROM p_sites_tickets WHERE expires_at <= ?').run(now);
  }

  recordHits(siteId: string, day: string, count: number): void {
    this.db.prepare(`
      INSERT INTO p_sites_hits (site_id, day, count) VALUES (?, ?, ?)
      ON CONFLICT(site_id, day) DO UPDATE SET count = count + excluded.count
    `).run(siteId, day, count);
  }

  hits(siteId: string, sinceDay: string): { day: string; count: number }[] {
    return this.db.prepare('SELECT day, count FROM p_sites_hits WHERE site_id = ? AND day >= ? ORDER BY day')
      .all(siteId, sinceDay) as { day: string; count: number }[];
  }

  /** Every site an account owns, for account deletion. */
  siteIdsOwnedBy(userId: number): string[] {
    return (this.db.prepare('SELECT id FROM p_sites_sites WHERE owner_user_id = ?')
      .all(userId) as { id: string }[]).map((row) => row.id);
  }

  /** The sites that keep a Project alive, by the SAME selector the runtime's `projectDependents`
   *  preflight uses. A site queued for deletion is not one of them: counting it here would let the
   *  preflight allow a Project removal that the post-removal hook then refuses, after the Project row
   *  is already gone. */
  siteIdsInProject(projectId: number): string[] {
    return (this.db.prepare("SELECT id FROM p_sites_sites WHERE project_id = ? AND runtime <> 'environment' AND status <> 'deleting'")
      .all(projectId) as { id: string }[]).map((row) => row.id);
  }

  /** Guest rows of an account that no longer exists. Removing the account must not leave it able to
   *  open anything, and must not leave a dangling row that renders as a blank avatar either. */
  forgetMemberEverywhere(userId: number): string[] {
    const siteIds = (this.db.prepare('SELECT site_id FROM p_sites_members WHERE user_id = ?')
      .all(userId) as { site_id: string }[]).map((row) => row.site_id);
    this.db.prepare('DELETE FROM p_sites_members WHERE user_id = ?').run(userId);
    return siteIds;
  }
}
