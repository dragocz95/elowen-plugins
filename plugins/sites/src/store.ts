import type { PluginDb } from 'elowen/plugin-api';

export type Visibility = 'private' | 'project' | 'authenticated' | 'public';
type SiteStatus = 'draft' | 'live' | 'failed';

/** How a published site answers a request: from files on disk, or from a process this plugin keeps
 *  running behind a loopback socket. */
type SiteRuntime = 'static' | 'command';

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
  sourceDir: string;
  spa: boolean;
  runtime: SiteRuntime;
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
}

export interface Release {
  id: string;
  siteId: string;
  createdAt: string;
  model: string;
  fileCount: number;
  sizeBytes: number;
  note: string;
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
  source_dir: string;
  spa: number;
  runtime: string | null;
  start_command: string | null;
  bind: string | null;
  port: number | null;
  status: string;
  current_release_id: string | null;
  created_at: string;
  updated_at: string;
  created_model: string;
  last_publish_at: string | null;
  last_publish_model: string | null;
  last_error: string | null;
}

interface ReleaseDbRow {
  id: string;
  site_id: string;
  created_at: string;
  model: string;
  file_count: number;
  size_bytes: number;
  note: string;
}

const asVisibility = (value: string): Visibility =>
  (VISIBILITIES as readonly string[]).includes(value) ? value as Visibility : 'private';

const asStatus = (value: string): SiteStatus =>
  value === 'live' || value === 'failed' ? value : 'draft';

const toSite = (row: SiteDbRow): Site => ({
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
  runtime: row.runtime === 'command' ? 'command' : 'static',
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

const toRelease = (row: ReleaseDbRow): Release => ({
  id: row.id,
  siteId: row.site_id,
  createdAt: row.created_at,
  model: row.model ?? '',
  fileCount: row.file_count,
  sizeBytes: row.size_bytes,
  note: row.note ?? '',
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
    ]);
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn);
  }

  insertSite(site: Site): void {
    this.db.prepare(`
      INSERT INTO p_sites_sites (
        id, slug, title, summary, project_id, owner_user_id, visibility, access_generation,
        source_dir, spa, runtime, start_command, bind, port, status, current_release_id,
        created_at, updated_at, created_model, last_publish_at, last_publish_model, last_error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      site.id, site.slug, site.title, site.summary, site.projectId, site.ownerUserId,
      site.visibility, site.accessGeneration, site.sourceDir, site.spa ? 1 : 0,
      site.runtime, site.startCommand, site.bind, site.port, site.status,
      site.currentReleaseId, site.createdAt, site.updatedAt, site.createdModel,
      site.lastPublishAt, site.lastPublishModel, site.lastError,
    );
  }

  siteById(id: string): Site | null {
    const row = this.db.prepare('SELECT * FROM p_sites_sites WHERE id = ?').get(id) as SiteDbRow | undefined;
    return row ? toSite(row) : null;
  }

  siteBySlug(slug: string): Site | null {
    const row = this.db.prepare('SELECT * FROM p_sites_sites WHERE slug = ?').get(slug) as SiteDbRow | undefined;
    return row ? toSite(row) : null;
  }

  slugTaken(slug: string): boolean {
    return this.db.prepare('SELECT 1 FROM p_sites_sites WHERE slug = ?').get(slug) !== undefined;
  }

  sitesOwnedBy(userId: number): Site[] {
    return (this.db.prepare('SELECT * FROM p_sites_sites WHERE owner_user_id = ? ORDER BY created_at DESC')
      .all(userId) as SiteDbRow[]).map(toSite);
  }

  countOwnedBy(userId: number): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM p_sites_sites WHERE owner_user_id = ?')
      .get(userId) as { n: number } | undefined;
    return row?.n ?? 0;
  }

  sitesInProjects(projectIds: readonly number[]): Site[] {
    if (projectIds.length === 0) return [];
    const marks = projectIds.map(() => '?').join(', ');
    return (this.db.prepare(`SELECT * FROM p_sites_sites WHERE project_id IN (${marks}) ORDER BY created_at DESC`)
      .all(...projectIds) as SiteDbRow[]).map(toSite);
  }

  sitesSharedWith(userId: number): Site[] {
    return (this.db.prepare(`
      SELECT s.* FROM p_sites_sites s
      JOIN p_sites_members m ON m.site_id = s.id
      WHERE m.user_id = ? ORDER BY s.created_at DESC
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

  portsInUse(): number[] {
    return (this.db.prepare('SELECT port FROM p_sites_sites WHERE port IS NOT NULL')
      .all() as { port: number }[]).map((row) => row.port);
  }

  allSites(): Site[] {
    return (this.db.prepare('SELECT * FROM p_sites_sites ORDER BY created_at DESC').all() as SiteDbRow[]).map(toSite);
  }

  updateSite(id: string, patch: Partial<Pick<Site,
    'title' | 'summary' | 'visibility' | 'spa' | 'status' | 'currentReleaseId' | 'port' |
    'startCommand' | 'lastPublishAt' | 'lastPublishModel' | 'lastError'>>): void {
    const columns: Record<string, string> = {
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

  deleteSite(id: string): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM p_sites_members WHERE site_id = ?').run(id);
      this.db.prepare('DELETE FROM p_sites_releases WHERE site_id = ?').run(id);
      this.db.prepare('DELETE FROM p_sites_tickets WHERE site_id = ?').run(id);
      this.db.prepare('DELETE FROM p_sites_hits WHERE site_id = ?').run(id);
      this.db.prepare('DELETE FROM p_sites_sites WHERE id = ?').run(id);
    });
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

  insertRelease(release: Release): void {
    this.db.prepare(`
      INSERT INTO p_sites_releases (id, site_id, created_at, model, file_count, size_bytes, note)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(release.id, release.siteId, release.createdAt, release.model, release.fileCount, release.sizeBytes, release.note);
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

  siteIdsInProject(projectId: number): string[] {
    return (this.db.prepare('SELECT id FROM p_sites_sites WHERE project_id = ?')
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
