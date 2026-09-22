import { randomBytes, randomUUID } from 'node:crypto';
import { isAbsolute, relative, sep } from 'node:path';
import type { PluginDb } from 'elowen/plugin-api';
import type { SiteHostname } from './hostname.js';

export interface ProjectPreview { id: string; slug: string; projectId: number; port: number; createdAt: string }

export type Visibility = 'private' | 'project' | 'authenticated' | 'public';
type SiteStatus = 'draft' | 'live' | 'failed' | 'deleting';

/** How a published address answers.
 *
 *  `static` is a release copied onto the host and served from those files. `proxy` is an application
 *  running on a loopback port inside the managed Project's own environment, reached through the durable
 *  transport Sandbox establishes for the publication. The legacy runtime columns remain only for schema
 *  compatibility and audit; active rows always carry the historical `static` value. */
type PublicationKind = 'static' | 'proxy';

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
  status: SiteStatus;
  currentReleaseId: string | null;
  createdAt: string;
  updatedAt: string;
  createdModel: string;
  lastPublishAt: string | null;
  lastPublishModel: string | null;
  lastError: string | null;
  primaryCustomHostnameId: string | null;
}

type SiteHostnameKind = 'generated' | 'custom';
export type SiteHostnameOwnershipState = 'unchecked' | 'missing' | 'mismatch' | 'ready' | 'unavailable';
export type SiteHostnameDnsState = 'unchecked' | 'missing' | 'misdirected' | 'ready' | 'unavailable';
export type SiteHostnameCertificateState =
  | 'none' | 'requested' | 'issuing' | 'ready' | 'authority_refused'
  | 'rate_limited' | 'renewal_blocked' | 'expired';

export interface SiteHostnameRecord {
  id: string;
  siteId: string;
  kind: SiteHostnameKind;
  hostname: string;
  ownershipToken: string | null;
  ownershipState: SiteHostnameOwnershipState;
  ownershipObserved: string[];
  ownershipCheckedAt: string | null;
  ownershipErrorDetail: string | null;
  ownershipVerifiedAt: string | null;
  ownershipExpiresAt: string | null;
  dnsState: SiteHostnameDnsState;
  dnsObserved: string[];
  dnsCheckedAt: string | null;
  dnsNextCheckAt: string | null;
  dnsErrorDetail: string | null;
  dnsAttempts: number;
  certificateState: SiteHostnameCertificateState;
  certificateRequestedAt: string | null;
  certificateErrorCode: string | null;
  certificateErrorDetail: string | null;
  certificateRetryAt: string | null;
  certificateNotAfter: string | null;
  certificateFailures: number;
  removalRequestedAt: string | null;
  createdAt: string;
  updatedAt: string;
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

/** Whether a stored picture of the page exists, and what the last attempt to take one did.
 *
 *  `failed` is not the same as "no picture": a capture that fails leaves the last good image exactly where
 *  it was, so a row can be `failed` and still have bytes to show. That is what keeps a transient failure
 *  from blanking a register somebody is looking at. */
type PreviewImageState = 'none' | 'ready' | 'failed';

export interface SitePreviewImage {
  siteId: string;
  state: PreviewImageState;
  /** Bumped by every stored image. It is the cache key a client fetches with, so two captures can never
   *  be confused for one another however fast they land. */
  version: number;
  capturedAt: string | null;
  width: number | null;
  height: number | null;
  bytes: number | null;
  mime: string | null;
  /** Why the last attempt failed, or null when it succeeded. */
  lastError: string | null;
  /** Epoch milliseconds before which this site must not be captured again. */
  nextAttemptAt: number;
  /** When a capture was last asked for and by whom, so a queued request survives a reload and so a
   *  manager pressing Refresh twice is answered with the first request instead of a second browser. */
  requestedAt: number | null;
  requestedBy: string | null;
  attempts: number;
}

interface PreviewImageDbRow {
  site_id: string;
  state: string;
  version: number;
  captured_at: string | null;
  width: number | null;
  height: number | null;
  bytes: number | null;
  mime: string | null;
  last_error: string | null;
  next_attempt_at: number;
  requested_at: number | null;
  requested_by: string | null;
  attempts: number;
}

const toPreviewImage = (row: PreviewImageDbRow): SitePreviewImage => ({
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
  primary_custom_hostname_id: string | null;
}

interface SiteHostnameDbRow {
  id: string;
  site_id: string;
  kind: string;
  hostname: string;
  ownership_token: string | null;
  ownership_state: string;
  ownership_observed_json: string;
  ownership_checked_at: string | null;
  ownership_error_detail: string | null;
  ownership_verified_at: string | null;
  ownership_expires_at: string | null;
  dns_state: string;
  dns_observed_json: string;
  dns_checked_at: string | null;
  dns_next_check_at: string | null;
  dns_error_detail: string | null;
  dns_attempts: number;
  certificate_state: string;
  certificate_requested_at: string | null;
  certificate_error_code: string | null;
  certificate_error_detail: string | null;
  certificate_retry_at: string | null;
  certificate_not_after: string | null;
  certificate_failures: number;
  removal_requested_at: string | null;
  created_at: string;
  updated_at: string;
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

/** A row written before the publication model existed is a static publication, which is exactly what
 *  the migration's default says and what the serving path did for it. */
const asPublicationKind = (value: string | null): PublicationKind => value === 'proxy' ? 'proxy' : 'static';

const toSite = (row: SiteDbRow): Site => ({
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
    primaryCustomHostnameId: row.primary_custom_hostname_id,
});


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

const HOSTNAME_KINDS = new Set<SiteHostnameKind>(['generated', 'custom']);
const HOSTNAME_OWNERSHIP_STATES = new Set<SiteHostnameOwnershipState>(['unchecked', 'missing', 'mismatch', 'ready', 'unavailable']);
const HOSTNAME_DNS_STATES = new Set<SiteHostnameDnsState>(['unchecked', 'missing', 'misdirected', 'ready', 'unavailable']);
const HOSTNAME_CERTIFICATE_STATES = new Set<SiteHostnameCertificateState>([
  'none', 'requested', 'issuing', 'ready', 'authority_refused', 'rate_limited',
  'renewal_blocked', 'expired',
]);
const CUSTOM_HOSTNAME_LIMIT = 10;
const OWNERSHIP_RESERVATION_MS = 24 * 60 * 60 * 1000;

const enumValue = <T extends string>(value: string, allowed: ReadonlySet<T>, field: string): T => {
  if (!allowed.has(value as T)) throw new Error(`Invalid stored ${field}: ${value}`);
  return value as T;
};

const observedDnsValues = (json: string): string[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Invalid stored DNS observation JSON');
  }
  if (!Array.isArray(parsed) || parsed.length > 32
    || parsed.some((value) => typeof value !== 'string' || value.length === 0 || value.length > 253)) {
    throw new Error('Invalid stored DNS observation values');
  }
  return parsed;
};

const toHostname = (row: SiteHostnameDbRow): SiteHostnameRecord => ({
  id: row.id,
  siteId: row.site_id,
  kind: enumValue(row.kind, HOSTNAME_KINDS, 'hostname kind'),
  hostname: row.hostname,
  ownershipToken: row.ownership_token,
  ownershipState: enumValue(row.ownership_state, HOSTNAME_OWNERSHIP_STATES, 'ownership state'),
  ownershipObserved: observedDnsValues(row.ownership_observed_json),
  ownershipCheckedAt: row.ownership_checked_at,
  ownershipErrorDetail: row.ownership_error_detail,
  ownershipVerifiedAt: row.ownership_verified_at,
  ownershipExpiresAt: row.ownership_expires_at,
  dnsState: enumValue(row.dns_state, HOSTNAME_DNS_STATES, 'DNS state'),
  dnsObserved: observedDnsValues(row.dns_observed_json),
  dnsCheckedAt: row.dns_checked_at,
  dnsNextCheckAt: row.dns_next_check_at,
  dnsErrorDetail: row.dns_error_detail,
  dnsAttempts: row.dns_attempts,
  certificateState: enumValue(row.certificate_state, HOSTNAME_CERTIFICATE_STATES, 'certificate state'),
  certificateRequestedAt: row.certificate_requested_at,
  certificateErrorCode: row.certificate_error_code,
  certificateErrorDetail: row.certificate_error_detail,
  certificateRetryAt: row.certificate_retry_at,
  certificateNotAfter: row.certificate_not_after,
  certificateFailures: row.certificate_failures,
  removalRequestedAt: row.removal_requested_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export type HostnameClaimErrorCode = 'domain_claimed' | 'hostname_limit' | 'site_unavailable';

export class HostnameClaimError extends Error {
  constructor(readonly code: HostnameClaimErrorCode, message: string) {
    super(message);
    this.name = 'HostnameClaimError';
  }
}

export interface SitesStoreOptions {
  hostnameBase?: string | null;
  now?: () => number;
  randomId?: () => string;
  randomToken?: () => string;
}

export class SitesStore {
  private readonly hostnameBase: string | null;
  private readonly now: () => number;
  private readonly randomId: () => string;
  private readonly randomToken: () => string;

  constructor(private readonly db: PluginDb, options: SitesStoreOptions = {}) {
    this.hostnameBase = options.hostnameBase ?? null;
    this.now = options.now ?? Date.now;
    this.randomId = options.randomId ?? randomUUID;
    this.randomToken = options.randomToken ?? (() => randomBytes(32).toString('base64url'));
    const hostnameBase = this.hostnameBase;
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
      {
        version: 20,
        up: (handle) => {
          const sites = handle.prepare(`
            SELECT id, slug, status, certificate_requested_at, certificate_error, created_at, updated_at
            FROM p_sites_sites
            WHERE runtime = 'static'
          `).all() as {
            id: string;
            slug: string;
            status: string;
            certificate_requested_at: string | null;
            certificate_error: string | null;
            created_at: string;
            updated_at: string;
          }[];
          handle.exec(`
            ALTER TABLE p_sites_sites ADD COLUMN primary_custom_hostname_id TEXT;

            CREATE TABLE p_sites_hostnames (
              id TEXT PRIMARY KEY,
              site_id TEXT NOT NULL,
              kind TEXT NOT NULL CHECK (kind IN ('generated', 'custom')),
              hostname TEXT NOT NULL,
              ownership_token TEXT,
              ownership_verified_at TEXT,
              ownership_expires_at TEXT,
              dns_state TEXT NOT NULL CHECK (dns_state IN ('unchecked', 'missing', 'misdirected', 'ready', 'unavailable')),
              dns_observed_json TEXT NOT NULL DEFAULT '[]',
              dns_checked_at TEXT,
              dns_next_check_at TEXT,
              certificate_state TEXT NOT NULL CHECK (certificate_state IN (
                'none', 'requested', 'issuing', 'ready', 'authority_refused',
                'rate_limited', 'renewal_blocked', 'expired'
              )),
              certificate_requested_at TEXT,
              certificate_error_code TEXT,
              certificate_error_detail TEXT,
              certificate_retry_at TEXT,
              certificate_not_after TEXT,
              removal_requested_at TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              CHECK (
                (kind = 'generated' AND ownership_token IS NULL AND ownership_verified_at IS NULL AND ownership_expires_at IS NULL)
                OR
                (kind = 'custom' AND ownership_token IS NOT NULL AND (
                  (ownership_verified_at IS NULL AND ownership_expires_at IS NOT NULL)
                  OR ownership_verified_at IS NOT NULL
                ))
              )
            );
            CREATE UNIQUE INDEX idx_p_sites_hostnames_hostname
              ON p_sites_hostnames (hostname COLLATE NOCASE);
            CREATE UNIQUE INDEX idx_p_sites_hostnames_generated
              ON p_sites_hostnames (site_id) WHERE kind = 'generated';
            CREATE INDEX idx_p_sites_hostnames_site ON p_sites_hostnames (site_id);
            CREATE INDEX idx_p_sites_hostnames_ownership_expiry ON p_sites_hostnames (ownership_expires_at);
            CREATE INDEX idx_p_sites_hostnames_dns_next_check ON p_sites_hostnames (dns_next_check_at);
            CREATE INDEX idx_p_sites_hostnames_certificate_retry ON p_sites_hostnames (certificate_retry_at);
            CREATE INDEX idx_p_sites_hostnames_removal ON p_sites_hostnames (removal_requested_at);
          `);

          if (hostnameBase !== null) {
            const insert = handle.prepare(`
              INSERT INTO p_sites_hostnames (
                id, site_id, kind, hostname,
                ownership_token, ownership_verified_at, ownership_expires_at,
                dns_state, dns_observed_json, dns_checked_at, dns_next_check_at,
                certificate_state, certificate_requested_at,
                certificate_error_code, certificate_error_detail,
                certificate_retry_at, certificate_not_after, removal_requested_at,
                created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            for (const site of sites) {
              const failed = site.certificate_error !== null && site.certificate_error !== '';
              const state: SiteHostnameCertificateState = failed
                ? 'authority_refused'
                : site.certificate_requested_at !== null ? 'requested' : 'none';
              insert.run(
                site.id + ':generated',
                site.id,
                'generated',
                site.slug + '.' + hostnameBase,
                null,
                null,
                null,
                'unchecked',
                '[]',
                null,
                null,
                state,
                site.certificate_requested_at,
                failed ? 'authority_refused' : null,
                failed ? site.certificate_error : null,
                null,
                null,
                site.status === 'deleting' ? site.updated_at : null,
                site.created_at,
                site.updated_at,
              );
            }
          }

          handle.exec(`
            ALTER TABLE p_sites_sites DROP COLUMN certificate_requested_at;
            ALTER TABLE p_sites_sites DROP COLUMN certificate_error;
          `);
        },
      },
      {
        version: 21,
        // Retry ownership belongs to the hostname row. Keeping the counters beside the durable next-attempt
        // timestamps means a plugin reload resumes the same exponential schedule instead of starting over.
        up: handle => handle.exec(`
          ALTER TABLE p_sites_hostnames ADD COLUMN dns_attempts INTEGER NOT NULL DEFAULT 0;
          ALTER TABLE p_sites_hostnames ADD COLUMN certificate_failures INTEGER NOT NULL DEFAULT 0;
        `),
      },
      {
        version: 22,
        // The setup screen must survive reloads without reinterpreting a generic DNS state. Ownership and
        // routing observations are separate facts, including bounded resolver details for unavailable checks.
        up: handle => handle.exec(`
          ALTER TABLE p_sites_hostnames ADD COLUMN ownership_state TEXT NOT NULL DEFAULT 'unchecked';
          ALTER TABLE p_sites_hostnames ADD COLUMN ownership_observed_json TEXT NOT NULL DEFAULT '[]';
          ALTER TABLE p_sites_hostnames ADD COLUMN ownership_checked_at TEXT;
          ALTER TABLE p_sites_hostnames ADD COLUMN ownership_error_detail TEXT;
          ALTER TABLE p_sites_hostnames ADD COLUMN dns_error_detail TEXT;
          UPDATE p_sites_hostnames
          SET ownership_state = 'ready'
          WHERE ownership_verified_at IS NOT NULL;
        `),
      },
    ]);
    if (hostnameBase !== null && this.db.appliedVersion() >= 20) {
      this.reconcileGeneratedHostnames(hostnameBase);
    }
  }

  private reconcileGeneratedHostnames(hostnameBase: string): void {
    this.db.transaction(() => {
      const sites = this.db.prepare(`
        SELECT id, slug, status, created_at, updated_at
        FROM p_sites_sites
        WHERE runtime = 'static'
          AND NOT EXISTS (
            SELECT 1 FROM p_sites_hostnames
            WHERE p_sites_hostnames.site_id = p_sites_sites.id
              AND p_sites_hostnames.kind = 'generated'
          )
      `).all() as {
        id: string;
        slug: string;
        status: string;
        created_at: string;
        updated_at: string;
      }[];
      const insert = this.db.prepare(`
        INSERT INTO p_sites_hostnames (
          id, site_id, kind, hostname,
          ownership_token, ownership_verified_at, ownership_expires_at,
          dns_state, dns_observed_json, dns_checked_at, dns_next_check_at,
          certificate_state, certificate_requested_at,
          certificate_error_code, certificate_error_detail,
          certificate_retry_at, certificate_not_after, removal_requested_at,
          created_at, updated_at
        ) VALUES (?, ?, 'generated', ?, NULL, NULL, NULL, 'unchecked', '[]', NULL, NULL,
          'none', NULL, NULL, NULL, NULL, NULL, ?, ?, ?)
      `);
      for (const site of sites) {
        insert.run(
          site.id + ':generated',
          site.id,
          site.slug + '.' + hostnameBase,
          site.status === 'deleting' ? site.updated_at : null,
          site.created_at,
          site.updated_at,
        );
      }
    });
  }

  migrateSourceReferences(projectRoot: (projectId: number) => string | null): void {
    const columns = this.db.prepare("PRAGMA table_info('p_sites_sites')").all() as { name: string }[];
    const hasLegacy = columns.some((column) => column.name === 'source_dir');
    if (!hasLegacy) {
      const invalid = this.db.prepare("SELECT id FROM p_sites_sites WHERE source_rel IS NULL AND runtime = 'static'").get() as { id: string } | undefined;
      if (invalid) throw new Error(`Site ${invalid.id} has no Project-relative source reference`);
      return;
    }
    this.db.transaction(() => {
      const rows = this.db.prepare('SELECT id, slug, project_id, kind, runtime, source_dir, source_rel FROM p_sites_sites').all() as {
        id: string; slug: string; project_id: number; kind: string | null; runtime: string; source_dir: string; source_rel: string | null;
      }[];
      const update = this.db.prepare('UPDATE p_sites_sites SET source_rel = ? WHERE id = ?');
      for (const row of rows) {
        if (row.runtime !== 'static') {
          if (row.source_rel === null) update.run(row.source_dir, row.id);
          continue;
        }
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
    this.db.transaction(() => {
      const legacyColumn = (this.db.prepare("PRAGMA table_info('p_sites_sites')").all() as { name: string }[])
        .some((column) => column.name === 'source_dir');
      this.db.prepare(`
        INSERT INTO p_sites_sites (
          id, slug, title, summary, project_id, owner_user_id, visibility, access_generation,
          ${legacyColumn ? 'source_dir, ' : ''}source_rel, spa, kind, target, runtime, start_command, bind, port,
          environment_cpus, environment_memory_mb, environment_pids_limit,
          environment_desired_state, status, current_release_id,
          created_at, updated_at, created_model, last_publish_at, last_publish_model, last_error,
          primary_custom_hostname_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${legacyColumn ? "'', " : ''}?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        site.id, site.slug, site.title, site.summary, site.projectId, site.ownerUserId,
        site.visibility, site.accessGeneration, site.sourceRel, site.spa ? 1 : 0,
        site.kind, site.target, 'static', '', 'socket', null,
        null, null, null, 'running', site.status,
        site.currentReleaseId, site.createdAt, site.updatedAt, site.createdModel,
        site.lastPublishAt, site.lastPublishModel, site.lastError, null,
      );
      if (this.hostnameBase !== null) {
        this.db.prepare(`
          INSERT INTO p_sites_hostnames (
            id, site_id, kind, hostname,
            ownership_token, ownership_verified_at, ownership_expires_at,
            dns_state, dns_observed_json, dns_checked_at, dns_next_check_at,
            certificate_state, certificate_requested_at,
            certificate_error_code, certificate_error_detail,
            certificate_retry_at, certificate_not_after, removal_requested_at,
            created_at, updated_at
          ) VALUES (?, ?, 'generated', ?, NULL, NULL, NULL, 'unchecked', '[]', NULL, NULL,
            'none', NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)
        `).run(site.id + ':generated', site.id, site.slug + '.' + this.hostnameBase, site.createdAt, site.updatedAt);
      }
    });
  }



  hostnameById(id: string): SiteHostnameRecord | null {
    const row = this.db.prepare('SELECT * FROM p_sites_hostnames WHERE id = ?').get(id) as SiteHostnameDbRow | undefined;
    return row ? toHostname(row) : null;
  }

  hostnamesForSite(siteId: string): SiteHostnameRecord[] {
    return (this.db.prepare(`
      SELECT * FROM p_sites_hostnames
      WHERE site_id = ?
      ORDER BY CASE kind WHEN 'generated' THEN 0 ELSE 1 END, created_at, id
    `).all(siteId) as SiteHostnameDbRow[]).map(toHostname);
  }

  generatedHostname(siteId: string): SiteHostnameRecord | null {
    const row = this.db.prepare("SELECT * FROM p_sites_hostnames WHERE site_id = ? AND kind = 'generated'")
      .get(siteId) as SiteHostnameDbRow | undefined;
    return row ? toHostname(row) : null;
  }

  customHostnames(siteId: string): SiteHostnameRecord[] {
    return (this.db.prepare("SELECT * FROM p_sites_hostnames WHERE site_id = ? AND kind = 'custom' ORDER BY created_at, id")
      .all(siteId) as SiteHostnameDbRow[]).map(toHostname);
  }

  allCustomHostnames(): SiteHostnameRecord[] {
    return (this.db.prepare(`
      SELECT * FROM p_sites_hostnames
      WHERE kind = 'custom' AND removal_requested_at IS NULL
      ORDER BY created_at, id
    `).all() as SiteHostnameDbRow[]).map(toHostname);
  }

  customHostnamesDueForDns(at = this.now()): SiteHostnameRecord[] {
    const now = new Date(at).toISOString();
    return (this.db.prepare(`
      SELECT * FROM p_sites_hostnames
      WHERE kind = 'custom' AND removal_requested_at IS NULL
        AND (dns_next_check_at IS NULL OR dns_next_check_at <= ?)
      ORDER BY COALESCE(dns_next_check_at, created_at), id
    `).all(now) as SiteHostnameDbRow[]).map(toHostname);
  }

  hostnamesPendingRemoval(): SiteHostnameRecord[] {
    return (this.db.prepare(`
      SELECT * FROM p_sites_hostnames
      WHERE removal_requested_at IS NOT NULL
      ORDER BY removal_requested_at, id
    `).all() as SiteHostnameDbRow[]).map(toHostname);
  }

  expireUnverifiedHostnameReservations(): number {
    const now = new Date(this.now()).toISOString();
    return Number(this.db.prepare(`
      DELETE FROM p_sites_hostnames
      WHERE kind = 'custom'
        AND ownership_verified_at IS NULL
        AND ownership_expires_at <= ?
        AND removal_requested_at IS NULL
    `).run(now).changes);
  }

  claimCustomHostname(siteId: string, hostname: SiteHostname): SiteHostnameRecord {
    try {
      return this.db.transaction(() => {
        this.expireUnverifiedHostnameReservations();
        const site = this.db.prepare("SELECT status FROM p_sites_sites WHERE id = ? AND runtime = 'static'")
          .get(siteId) as { status: string } | undefined;
        if (!site || site.status === 'deleting') {
          throw new HostnameClaimError('site_unavailable', 'The Site is unavailable for a hostname claim.');
        }
        const count = this.db.prepare("SELECT COUNT(*) AS count FROM p_sites_hostnames WHERE site_id = ? AND kind = 'custom'")
          .get(siteId) as { count: number };
        if (count.count >= CUSTOM_HOSTNAME_LIMIT) {
          throw new HostnameClaimError('hostname_limit', `A Site may have at most ${CUSTOM_HOSTNAME_LIMIT} custom hostnames.`);
        }

        const nowMs = this.now();
        const now = new Date(nowMs).toISOString();
        const id = this.randomId();
        this.db.prepare(`
          INSERT INTO p_sites_hostnames (
            id, site_id, kind, hostname,
            ownership_token, ownership_verified_at, ownership_expires_at,
            dns_state, dns_observed_json, dns_checked_at, dns_next_check_at,
            certificate_state, certificate_requested_at,
            certificate_error_code, certificate_error_detail,
            certificate_retry_at, certificate_not_after, removal_requested_at,
            created_at, updated_at
          ) VALUES (?, ?, 'custom', ?, ?, NULL, ?, 'unchecked', '[]', NULL, NULL,
            'none', NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)
        `).run(
          id,
          siteId,
          hostname.ascii,
          this.randomToken(),
          new Date(nowMs + OWNERSHIP_RESERVATION_MS).toISOString(),
          now,
          now,
        );
        const claimed = this.hostnameById(id);
        if (!claimed) throw new Error('The hostname claim was not stored');
        return claimed;
      });
    } catch (error) {
      if (error instanceof HostnameClaimError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('UNIQUE constraint failed') && message.includes('p_sites_hostnames.hostname')) {
        throw new HostnameClaimError('domain_claimed', 'This hostname is already reserved by another Site.');
      }
      throw error;
    }
  }

  recordHostnameOwnership(
    id: string,
    state: SiteHostnameOwnershipState,
    observed: readonly string[],
    detail: string | null = null,
  ): void {
    if (!HOSTNAME_OWNERSHIP_STATES.has(state)) throw new Error(`Invalid ownership state: ${state}`);
    const json = JSON.stringify(observed);
    observedDnsValues(json);
    const now = new Date(this.now()).toISOString();
    const result = this.db.prepare(`
      UPDATE p_sites_hostnames
      SET ownership_state = ?, ownership_observed_json = ?, ownership_checked_at = ?,
          ownership_error_detail = ?, updated_at = ?
      WHERE id = ? AND kind = 'custom' AND removal_requested_at IS NULL
    `).run(state, json, now, detail?.slice(0, 600) ?? null, now, id);
    if (result.changes !== 1) throw new Error('The hostname is absent or being removed.');
  }

  verifyHostnameOwnership(id: string): void {
    const now = new Date(this.now()).toISOString();
    const result = this.db.prepare(`
      UPDATE p_sites_hostnames
      SET ownership_state = 'ready', ownership_verified_at = ?, ownership_expires_at = NULL,
          ownership_error_detail = NULL, updated_at = ?
      WHERE id = ? AND kind = 'custom' AND ownership_verified_at IS NULL
        AND ownership_expires_at > ? AND removal_requested_at IS NULL
    `).run(now, now, id, now);
    if (result.changes === 1) return;
    const verified = this.db.prepare(`
      SELECT 1
      FROM p_sites_hostnames
      WHERE id = ? AND kind = 'custom' AND ownership_verified_at IS NOT NULL
        AND removal_requested_at IS NULL
    `).get(id);
    if (verified) return;
    throw new Error('The hostname reservation is absent, expired or being removed.');
  }

  recordHostnameDns(
    id: string,
    state: SiteHostnameDnsState,
    observed: readonly string[],
    nextCheckAt: string | null = null,
    detail: string | null = null,
  ): void {
    if (!HOSTNAME_DNS_STATES.has(state)) throw new Error(`Invalid DNS state: ${state}`);
    const json = JSON.stringify(observed);
    observedDnsValues(json);
    const now = new Date(this.now()).toISOString();
    const result = this.db.prepare(`
      UPDATE p_sites_hostnames
      SET dns_state = ?, dns_observed_json = ?, dns_checked_at = ?, dns_next_check_at = ?,
          dns_error_detail = ?, dns_attempts = dns_attempts + 1, updated_at = ?
      WHERE id = ? AND removal_requested_at IS NULL
    `).run(state, json, now, nextCheckAt, detail?.slice(0, 600) ?? null, now, id);
    if (result.changes !== 1) throw new Error('The hostname is absent or being removed.');
  }

  recordHostnameCertificate(
    id: string,
    update: {
      state: SiteHostnameCertificateState;
      errorCode?: string | null;
      errorDetail?: string | null;
      retryAt?: string | null;
      notAfter?: string | null;
    },
  ): void {
    if (!HOSTNAME_CERTIFICATE_STATES.has(update.state)) {
      throw new Error(`Invalid certificate state: ${update.state}`);
    }
    this.db.transaction(() => {
      const row = this.db.prepare('SELECT * FROM p_sites_hostnames WHERE id = ?').get(id) as SiteHostnameDbRow | undefined;
      if (!row || row.removal_requested_at !== null) throw new Error('The hostname is absent or being removed.');
      if (update.state === 'ready' && row.kind === 'custom'
        && (row.ownership_verified_at === null || row.dns_state !== 'ready')) {
        throw new Error('A custom hostname must have verified ownership and ready DNS before its certificate is ready.');
      }
      const now = new Date(this.now()).toISOString();
      const failure = update.state === 'authority_refused' || update.state === 'rate_limited';
      this.db.prepare(`
        UPDATE p_sites_hostnames
        SET certificate_state = ?,
            certificate_requested_at = CASE
              WHEN ? IN ('requested', 'issuing') THEN COALESCE(certificate_requested_at, ?)
              WHEN ? = 'ready' THEN NULL
              ELSE certificate_requested_at
            END,
            certificate_error_code = ?,
            certificate_error_detail = ?,
            certificate_retry_at = ?,
            certificate_not_after = COALESCE(?, certificate_not_after),
            certificate_failures = CASE WHEN ? = 'ready' THEN 0 WHEN ? THEN certificate_failures + 1 ELSE certificate_failures END,
            updated_at = ?
        WHERE id = ?
      `).run(
        update.state,
        update.state,
        now,
        update.state,
        update.errorCode ?? null,
        update.errorDetail?.slice(0, 600) ?? null,
        update.retryAt ?? null,
        update.notAfter ?? null,
        update.state,
        failure ? 1 : 0,
        now,
        id,
      );
      if (update.state === 'ready' && row.kind === 'custom') {
        this.db.prepare(`
          UPDATE p_sites_sites SET primary_custom_hostname_id = ?, updated_at = ?
          WHERE id = ? AND primary_custom_hostname_id IS NULL
        `).run(id, now, row.site_id);
      }
    });
  }

  setPrimaryCustomHostname(siteId: string, hostnameId: string | null): void {
    this.db.transaction(() => {
      if (hostnameId !== null) {
        const row = this.db.prepare(`
          SELECT 1 FROM p_sites_hostnames
          WHERE id = ? AND site_id = ? AND kind = 'custom'
            AND certificate_state = 'ready' AND removal_requested_at IS NULL
        `).get(hostnameId, siteId);
        if (!row) throw new Error('The primary hostname must be a ready custom hostname of this Site.');
      }
      const now = new Date(this.now()).toISOString();
      const updated = this.db.prepare(`
        UPDATE p_sites_sites SET primary_custom_hostname_id = ?, updated_at = ?
        WHERE id = ? AND status <> 'deleting'
      `).run(hostnameId, now, siteId);
      if (updated.changes !== 1) throw new Error('The Site is absent or being deleted.');
    });
  }

  requestHostnameRemoval(id: string): void {
    this.db.transaction(() => {
      const row = this.db.prepare('SELECT site_id FROM p_sites_hostnames WHERE id = ?')
        .get(id) as { site_id: string } | undefined;
      if (!row) throw new Error('The hostname does not exist.');
      const now = new Date(this.now()).toISOString();
      this.db.prepare(`
        UPDATE p_sites_hostnames
        SET removal_requested_at = COALESCE(removal_requested_at, ?), updated_at = ?
        WHERE id = ?
      `).run(now, now, id);
      this.db.prepare(`
        UPDATE p_sites_sites SET primary_custom_hostname_id = NULL, updated_at = ?
        WHERE id = ? AND primary_custom_hostname_id = ?
      `).run(now, row.site_id, id);
    });
  }

  completeHostnameRemoval(id: string): void {
    const result = this.db.prepare('DELETE FROM p_sites_hostnames WHERE id = ? AND removal_requested_at IS NOT NULL').run(id);
    if (result.changes !== 1) throw new Error('Hostname cleanup has not been requested.');
  }

  requestGeneratedCertificate(siteId: string, requestedAt: string): void {
    this.db.prepare(`
      UPDATE p_sites_hostnames
      SET certificate_state = 'requested', certificate_requested_at = ?, updated_at = ?
      WHERE site_id = ? AND kind = 'generated'
    `).run(requestedAt, requestedAt, siteId);
  }

  clearGeneratedCertificateRequest(siteId: string): void {
    const now = new Date(this.now()).toISOString();
    this.db.prepare(`
      UPDATE p_sites_hostnames
      SET certificate_state = 'none', certificate_requested_at = NULL,
          certificate_error_code = NULL, certificate_error_detail = NULL, updated_at = ?
      WHERE site_id = ? AND kind = 'generated'
    `).run(now, siteId);
  }

  failGeneratedCertificate(siteId: string, detail: string): void {
    const now = new Date(this.now()).toISOString();
    this.db.prepare(`
      UPDATE p_sites_hostnames
      SET certificate_state = 'authority_refused', certificate_requested_at = NULL,
          certificate_error_code = 'authority_refused', certificate_error_detail = ?, updated_at = ?
      WHERE site_id = ? AND kind = 'generated'
    `).run(detail, now, siteId);
  }


  siteById(id: string): Site | null {
    const row = this.db.prepare("SELECT * FROM p_sites_sites WHERE id = ? AND runtime = 'static'").get(id) as SiteDbRow | undefined;
    return row ? toSite(row) : null;
  }

  siteBySlug(slug: string): Site | null {
    const row = this.db.prepare("SELECT * FROM p_sites_sites WHERE slug = ? AND runtime = 'static'").get(slug) as SiteDbRow | undefined;
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
    return (this.db.prepare("SELECT * FROM p_sites_sites WHERE owner_user_id = ? AND runtime = 'static' AND status <> 'deleting' ORDER BY created_at DESC")
      .all(userId) as SiteDbRow[]).map(toSite);
  }

  countOwnedBy(userId: number): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM p_sites_sites WHERE owner_user_id = ? AND runtime = 'static' AND status <> 'deleting'")
      .get(userId) as { n: number } | undefined;
    return row?.n ?? 0;
  }


  sitesInProjects(projectIds: readonly number[]): Site[] {
    if (projectIds.length === 0) return [];
    const marks = projectIds.map(() => '?').join(', ');
    return (this.db.prepare(`SELECT * FROM p_sites_sites WHERE project_id IN (${marks}) AND runtime = 'static' AND status <> 'deleting' ORDER BY created_at DESC`)
      .all(...projectIds) as SiteDbRow[]).map(toSite);
  }

  sitesSharedWith(userId: number): Site[] {
    return (this.db.prepare(`
      SELECT s.* FROM p_sites_sites s
      JOIN p_sites_members m ON m.site_id = s.id
      WHERE m.user_id = ? AND s.runtime = 'static' AND s.status <> 'deleting' ORDER BY s.created_at DESC
    `).all(userId) as SiteDbRow[]).map(toSite);
  }

  /** Every proxy publication that is expected to answer. A draft is not: its transport must not be kept
   *  alive before anybody published it. A `failed` one IS, because that is how the row recovers once the
   *  application inside the Project answers again. */
  proxySitesForReconcile(): Site[] {
    return (this.db.prepare(`
      SELECT * FROM p_sites_sites
      WHERE kind = 'proxy' AND runtime = 'static' AND status IN ('live', 'failed')
    `).all() as SiteDbRow[]).map(toSite);
  }

  allSites(): Site[] {
    return (this.db.prepare("SELECT * FROM p_sites_sites WHERE runtime = 'static' AND status <> 'deleting' ORDER BY created_at DESC").all() as SiteDbRow[]).map(toSite);
  }

  deletingSites(): Site[] {
    return (this.db.prepare("SELECT * FROM p_sites_sites WHERE runtime = 'static' AND status = 'deleting' ORDER BY updated_at").all() as SiteDbRow[]).map(toSite);
  }

  updateSite(id: string, patch: Partial<Pick<Site,
    'title' | 'summary' | 'visibility' | 'status' | 'currentReleaseId' |
    'lastPublishAt' | 'lastPublishModel' | 'lastError'>>): void {
    const columns: Record<string, string> = {
      title: 'title',
      summary: 'summary',
      visibility: 'visibility',
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

  /** Make deletion durable BEFORE touching a process or filesystem. The site disappears from every list,
   * stops authorising immediately, and a crash leaves a row boot reconciliation can finish. Idempotent. */
  beginDelete(id: string): void {
    this.db.transaction(() => {
      const now = new Date(this.now()).toISOString();
      this.db.prepare(`
        UPDATE p_sites_sites
        SET status = 'deleting', current_release_id = NULL, primary_custom_hostname_id = NULL,
            access_generation = access_generation + 1, updated_at = ?
        WHERE id = ?
      `).run(now, id);
      this.db.prepare(`
        UPDATE p_sites_hostnames
        SET removal_requested_at = COALESCE(removal_requested_at, ?), updated_at = ?
        WHERE site_id = ?
      `).run(now, now, id);
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

  deleteSite(id: string): void {
    this.db.transaction(() => {
      if (this.db.prepare('SELECT 1 FROM p_sites_hostnames WHERE site_id = ?').get(id)) {
        throw new Error('Site hostname cleanup must finish before the Site row is deleted.');
      }
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

  /** The stored picture of one Site's page, or null when none was ever taken. */
  previewImage(siteId: string): SitePreviewImage | null {
    const row = this.db.prepare('SELECT * FROM p_sites_previews WHERE site_id = ?').get(siteId) as PreviewImageDbRow | undefined;
    return row ? toPreviewImage(row) : null;
  }

  /** Remember that a capture was asked for. It survives a plugin reload, so a request that was in flight
   *  when the plugin went away is still visible as one rather than silently forgotten. */
  markPreviewImageRequested(siteId: string, cause: string, now: number): void {
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
  storePreviewImage(siteId: string, image: { bytes: number; mime: string; width: number; height: number }, now: number): number {
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
  failPreviewImage(siteId: string, message: string, nextAttemptAt: number): void {
    this.db.prepare(`
      INSERT INTO p_sites_previews (site_id, state, version, last_error, next_attempt_at, requested_at, requested_by, attempts)
      VALUES (?, 'failed', 0, ?, ?, NULL, NULL, 1)
      ON CONFLICT(site_id) DO UPDATE SET
        state = 'failed', last_error = excluded.last_error, next_attempt_at = excluded.next_attempt_at,
        requested_at = NULL, requested_by = NULL, attempts = p_sites_previews.attempts + 1
    `).run(siteId, message, nextAttemptAt);
  }

  deletePreviewImage(siteId: string): void {
    this.db.prepare('DELETE FROM p_sites_previews WHERE site_id = ?').run(siteId);
  }

  /** Write the one outstanding capture grant of a Site. A new capture replaces the previous one, so a
   *  grant that was never claimed cannot be replayed after a second capture was asked for. */
  putCaptureGrant(tokenHash: string, siteId: string, accessGeneration: number, expiresAt: number): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM p_sites_capture_grants WHERE site_id = ?').run(siteId);
      this.db.prepare('INSERT INTO p_sites_capture_grants (token_hash, site_id, access_generation, expires_at) VALUES (?, ?, ?, ?)')
        .run(tokenHash, siteId, accessGeneration, expiresAt);
    });
  }

  /** Claim a capture grant. The delete IS the claim, so two requests presenting the same token cannot both
   *  be answered, and a token that is unknown, expired or minted under an older access generation is
   *  refused identically — consuming it either way, so nothing can be probed by replay. */
  takeCaptureGrant(tokenHash: string, siteId: string, accessGeneration: number, now: number): boolean {
    return this.db.transaction(() => {
      const row = this.db.prepare('SELECT site_id AS siteId, access_generation AS accessGeneration, expires_at AS expiresAt FROM p_sites_capture_grants WHERE token_hash = ?')
        .get(tokenHash) as { siteId: string; accessGeneration: number; expiresAt: number } | undefined;
      if (!row) return false;
      this.db.prepare('DELETE FROM p_sites_capture_grants WHERE token_hash = ?').run(tokenHash);
      return row.siteId === siteId && row.accessGeneration === accessGeneration && row.expiresAt > now;
    });
  }

  pruneCaptureGrants(now: number): void {
    this.db.prepare('DELETE FROM p_sites_capture_grants WHERE expires_at <= ?').run(now);
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

  /** Active publications an account owns, for account deletion. Retired runtime rows remain audit data. */
  siteIdsOwnedBy(userId: number): string[] {
    return (this.db.prepare("SELECT id FROM p_sites_sites WHERE owner_user_id = ? AND runtime = 'static'")
      .all(userId) as { id: string }[]).map((row) => row.id);
  }

  /** The active publications that keep a Project alive. A site queued for deletion is not one of them:
   *  counting it here would let the preflight allow a Project removal that the post-removal hook then
   *  refuses, after the Project row is already gone. */
  siteIdsInProject(projectId: number): string[] {
    return (this.db.prepare("SELECT id FROM p_sites_sites WHERE project_id = ? AND runtime = 'static' AND status <> 'deleting'")
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
