import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CAPTURE_HEADER, mintTicket } from './access.js';
import { siteUrl, type SitesConfig } from './config.js';
import type { Site, SitePreviewImage, SitesStore } from './store.js';

/** A picture of a published page, kept beside the Site it belongs to.
 *
 *  A register of published pages is a column of identical rectangles without one, and the card's plate was
 *  built with a band for exactly this. What takes the picture is the Browser plugin's `browserCapture`
 *  control — a throwaway browser with its own profile, no account and a resolver that reaches one host —
 *  and what this module owns is everything around it: when a capture is worth taking, what it is allowed
 *  to point at, where the one image per Site is kept, and what happens when it fails.
 *
 *  The capture leaves through the site's OWN published hostname, through the same gateway every visitor
 *  takes. That is what makes the picture the page a visitor would actually get, and it is why a capture
 *  has to be authorised: the site may be private, or shared with one colleague, or behind a Project. The
 *  authorisation is a one-use grant bound to the Site and to its access generation, spent by the first
 *  request that presents it; see `serve.ts`. Nothing here can name a URL of its own choosing. */

interface BrowserCaptureLike {
  available(): boolean;
  capture(request: {
    url: string;
    headers?: Readonly<Record<string, string>>;
    viewport: { width: number; height: number; deviceScaleFactor?: number };
    timeoutMs?: number;
    format?: 'png' | 'webp';
    maxBytes?: number;
  }): Promise<{ image: Uint8Array; mimeType: 'image/png' | 'image/webp'; width: number; height: number }>;
}

/** How long a minted grant may be presented for. It exists to be spent by the very next request a capture
 *  makes, so this only has to outlast a browser launch. */
export const CAPTURE_GRANT_TTL_MS = 60_000;

/** How old a stored picture may be before a register asks for another one. */
export const PREVIEW_IMAGE_TTL_MS = 6 * 3600_000;

/** How long a request counts as in flight. A request is a durable row, so a process that went away
 *  mid-capture would otherwise leave its Site looking busy for good. */
const PREVIEW_IN_FLIGHT_MS = 2 * 60_000;

/** The wait after a failure, doubling per attempt and capped. A page that is down stays down for a while,
 *  and a register somebody left open must not launch a browser over it every few seconds. */
const PREVIEW_RETRY_BASE_MS = 60_000;
const PREVIEW_RETRY_MAX_MS = 30 * 60_000;

/** The most one stored picture may weigh. It is the browser control's own ceiling for a capture, restated
 *  because this is what ends up on disk: a picture is a bounded artifact, not a screenshot somebody can
 *  make arbitrarily expensive.
 *
 *  One image per Site is what keeps the whole feature bounded — no history, no second file, nothing to
 *  sweep — so this ceiling is also the ceiling on what a Site's register entry costs. */
export const PREVIEW_IMAGE_MAX_BYTES = 1_572_864;

/** How often one Site may be pictured, whatever asked. A person pressing Refresh in the drawer is the
 *  only caller that can ask twice in a row, and the second press is answered with the first request. */
export const PREVIEW_MANUAL_REFRESH_MIN_MS = 30_000;

/** The viewport a picture is taken at: a desktop layout, wider than the plate, and short enough that the
 *  band a card shows is the top of the page rather than a letterboxed whole document. */
const CAPTURE_VIEWPORT = { width: 1280, height: 800 };
const CAPTURE_TIMEOUT_MS = 20_000;
/** WebP: a page's top band at this size lands well inside the cap, and the plate shows it at card width. */
const CAPTURE_FORMAT = 'webp' as const;

/** What a card needs to know about the picture behind it.
 *
 *  `stale` and `failed` are states of the INFORMATION, not of the site: both keep the last image, and a
 *  card that has one shows it with the caveat rather than falling back to a monogram. */
export interface PreviewImageView {
  state: 'none' | 'pending' | 'ready' | 'stale' | 'failed';
  /** Cache key of the stored image; 0 when there is none. */
  version: number;
  capturedAt: string | null;
  width: number | null;
  height: number | null;
}

export type PreviewRequestCause = 'manual' | 'publish' | 'lazy';

export type PreviewRequestOutcome =
  | { ok: true }
  | { ok: false; reason: string; retryAfterMs?: number };

export interface PreviewImageDeps {
  store: SitesStore;
  /** One Site's own directory. The picture lives beside its releases and goes when they do. */
  siteDir(siteId: string): string;
  project(id: number): { executionKind: string; lifecycle: string } | null | undefined;
  /** The Browser plugin's capture control, resolved at call time so a reload is picked up. Named for what
   *  it is rather than `control` so no reader can mistake it for the Sandbox seam: a missing one is a
   *  reason a picture cannot be taken, never a failure of the plugin itself. */
  captureControl(): BrowserCaptureLike | undefined;
  config(): SitesConfig;
  now?(): number;
  logger?: { warn(message: string): void };
}

export class SitePreviewImageService {
  /** Sites waiting for a capture, in the order they were asked for. */
  private readonly queued = new Set<string>();
  private running: Promise<void> | null = null;

  constructor(private readonly deps: PreviewImageDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /** Whether this instance could ever picture this Site, and why not when it could not.
   *
   *  Every branch here is a fact about the deployment or the publication, never about a request: a capture
   *  has no URL to supply, no host to choose and no port to name, because none of those are a caller's to
   *  decide. What it has is the Site row, and the address the gateway derives from it. */
  private unavailableReason(site: Site): string | null {
    if (site.status === 'deleting') return 'that site is being deleted';
    if (site.status !== 'live') return 'the site has not been published yet';
    if (siteUrl(this.deps.config(), site.slug) === null) {
      return 'this instance has no site address to take a picture through, because its domain gateway is not ready';
    }
    if (site.kind === 'proxy') {
      const project = this.deps.project(site.projectId);
      if (!project || project.executionKind !== 'managed' || project.lifecycle !== 'active') {
        return `Project ${site.projectId} is not an active managed Project, so there is nothing to render`;
      }
    } else if (!site.currentReleaseId) {
      // A legacy file publication with no release behind it answers 404 at its own address. Saying so is
      // better than launching a browser to photograph the 404.
      return 'this release has no published files left to show';
    }
    const control = this.deps.captureControl();
    if (!control) return 'the Browser plugin is not available on this instance, so nothing can render the page';
    if (!control.available()) return 'this instance has no browser to render pages with';
    return null;
  }

  private imagePath(siteId: string): string {
    return join(this.deps.siteDir(siteId), 'preview');
  }

  private hasBytes(siteId: string): boolean {
    try {
      const stat = statSync(this.imagePath(siteId));
      return stat.isFile() && stat.size > 0 && stat.size <= PREVIEW_IMAGE_MAX_BYTES;
    } catch {
      return false;
    }
  }

  /** The stored image, for the endpoint that hands it to a browser. Null when there is none to hand out. */
  read(siteId: string): { bytes: Uint8Array; mime: string; version: number } | null {
    const row = this.deps.store.previewImage(siteId);
    if (!row || row.version === 0 || !row.mime) return null;
    const path = this.imagePath(siteId);
    try {
      const stat = statSync(path);
      if (!stat.isFile() || stat.size === 0 || stat.size > PREVIEW_IMAGE_MAX_BYTES) return null;
      return { bytes: readFileSync(path), mime: row.mime, version: row.version };
    } catch {
      return null;
    }
  }

  /** What a register shows for one Site, decided from the row and the file that is actually there. */
  view(siteId: string, at = this.now()): PreviewImageView {
    const row = this.deps.store.previewImage(siteId);
    const busy = this.busy(siteId, at);
    if (!row || row.version === 0 || !this.hasBytes(siteId)) {
      return { state: busy ? 'pending' : 'none', version: 0, capturedAt: null, width: null, height: null };
    }
    return {
      state: row.state === 'failed' ? 'failed' : this.fresh(row, at) ? 'ready' : 'stale',
      version: row.version,
      capturedAt: row.capturedAt,
      width: row.width,
      height: row.height,
    };
  }

  /** Why the last attempt failed, or why there can never be a picture, for a manager reading the drawer. */
  notice(site: Site): string | null {
    const row = this.deps.store.previewImage(site.id);
    if (row?.lastError) return row.lastError;
    return this.hasBytes(site.id) ? null : this.unavailableReason(site);
  }

  /** Ask for a picture of one Site now.
   *
   *  A deliberate ask (a publish, a manager pressing Refresh) is told why it cannot be done; the lazy path
   *  below never speaks, because a register being opened is not a place for a refusal about a picture. */
  request(siteId: string, cause: PreviewRequestCause): PreviewRequestOutcome {
    const at = this.now();
    const site = this.deps.store.siteById(siteId);
    if (!site) return { ok: false, reason: 'that site no longer exists' };
    const reason = this.unavailableReason(site);
    if (reason) return { ok: false, reason };
    if (this.busy(siteId, at)) return { ok: false, reason: 'a picture of this site is already being taken' };

    if (cause === 'manual') {
      const row = this.deps.store.previewImage(siteId);
      const lastAsked = row?.requestedAt ?? (row?.capturedAt ? Date.parse(row.capturedAt) : null);
      if (lastAsked !== null && Number.isFinite(lastAsked) && at - lastAsked < PREVIEW_MANUAL_REFRESH_MIN_MS) {
        return {
          ok: false,
          reason: 'a picture of this site was taken a moment ago',
          retryAfterMs: PREVIEW_MANUAL_REFRESH_MIN_MS - (at - lastAsked),
        };
      }
    }

    this.enqueue(site, cause, at);
    return { ok: true };
  }

  /** The lazy half: whatever a register is looking at, ask for pictures that are missing or no longer
   *  current from the LAST time a register was open.
   *
   *  The TTL queue exists because nothing else in this plugin runs on a clock. A capture costs a browser,
   *  so it happens when somebody is looking, not on a timer over Sites nobody opened. */
  ensureFresh(sites: readonly Site[], at = this.now()): void {
    for (const site of sites) {
      if (this.busy(site.id, at)) continue;
      const row = this.deps.store.previewImage(site.id);
      if (row && row.nextAttemptAt > at) continue;
      if (row && this.fresh(row, at)) continue;
      if (this.unavailableReason(site)) continue;
      this.enqueue(site, 'lazy', at);
    }
  }

  /** Wait for everything queued to finish. Used by tests; the plugin never needs to. */
  async settled(): Promise<void> {
    while (this.running) await this.running;
  }

  /** A stored picture is current when it was taken inside the TTL and the last attempt did not fail: a
   *  failure marks the picture as worth retrying even when its bytes are still perfectly good. */
  private fresh(row: SitePreviewImage, at: number): boolean {
    return row.state === 'ready' && row.capturedAt !== null && at - Date.parse(row.capturedAt) < PREVIEW_IMAGE_TTL_MS;
  }

  /** Whether a capture of this Site is running or waiting. The row is what survives a reload, so a request
   *  recorded by a process that then went away stops counting once it is old. */
  private busy(siteId: string, at: number): boolean {
    if (this.queued.has(siteId)) return true;
    const row = this.deps.store.previewImage(siteId);
    return row?.requestedAt != null && at - row.requestedAt < PREVIEW_IN_FLIGHT_MS;
  }

  private enqueue(site: Site, cause: PreviewRequestCause, at: number): void {
    this.deps.store.markPreviewImageRequested(site.id, cause, at);
    this.queued.add(site.id);
    this.pump();
  }

  private pump(): void {
    if (this.running) return;
    this.running = this.drain().finally(() => {
      this.running = null;
      // A Site asked for while the loop was finishing is not dropped on the floor.
      if (this.queued.size > 0) this.pump();
    });
  }

  /** One capture at a time, deliberately: a capture is a browser, and the control refuses a second one
   *  anyway. Concurrency one is also what makes the backoff meaningful — two sites cannot race each other
   *  into a retry storm. */
  private async drain(): Promise<void> {
    for (;;) {
      const next = this.queued.values().next();
      if (next.done) return;
      this.queued.delete(next.value);
      const site = this.deps.store.siteById(next.value);
      if (!site) continue;
      await this.attempt(site);
    }
  }

  private async attempt(site: Site): Promise<void> {
    const reason = this.unavailableReason(site);
    if (reason) {
      // Recorded rather than queued: the drawer explains it, and the retry below is what stops a register
      // from asking again on every read.
      this.deps.store.failPreviewImage(site.id, reason, this.now() + PREVIEW_RETRY_MAX_MS);
      return;
    }
    const control = this.deps.captureControl();
    const address = siteUrl(this.deps.config(), site.slug);
    if (!control || address === null) return;

    // The grant is minted per attempt, one per Site, and replaced by the next attempt: a token that was
    // never spent cannot be replayed after a later capture was asked for.
    const grant = mintTicket();
    this.deps.store.putCaptureGrant(
      grant.tokenHash, site.id, site.accessGeneration, this.now() + CAPTURE_GRANT_TTL_MS,
    );

    try {
      const captured = await control.capture({
        url: address,
        headers: { [CAPTURE_HEADER]: grant.token },
        viewport: CAPTURE_VIEWPORT,
        timeoutMs: CAPTURE_TIMEOUT_MS,
        format: CAPTURE_FORMAT,
        maxBytes: PREVIEW_IMAGE_MAX_BYTES,
      });
      const image = checkCapturedImage(captured);
      const current = this.deps.store.siteById(site.id);
      // The Site may have been deleted while the browser was rendering it. Writing the file would be
      // harmless, but recording the row would resurrect metadata for a Site that is gone.
      if (!current || current.status === 'deleting') return;
      this.writeImage(site.id, image.bytes);
      this.deps.store.storePreviewImage(site.id, {
        bytes: image.bytes.byteLength, mime: image.mime, width: image.width, height: image.height,
      }, this.now());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const attempts = this.deps.store.previewImage(site.id)?.attempts ?? 0;
      const at = this.now();
      this.deps.store.failPreviewImage(site.id, message, at + retryDelay(attempts));
      this.deps.logger?.warn(`no picture of site ${site.slug} yet: ${message}`);
    }
  }

  /** Replace the one image this Site keeps.
   *
   *  Written to a sibling and renamed over the target: a reader sees the previous picture or this one, and
   *  a crash mid-write leaves the previous one in place rather than a truncated file that would be served
   *  as a picture. The metadata row is written by the caller only after this returns, so the version a
   *  client fetches with always names bytes that are already there. */
  private writeImage(siteId: string, bytes: Uint8Array): void {
    const directory = this.deps.siteDir(siteId);
    mkdirSync(directory, { recursive: true });
    const target = this.imagePath(siteId);
    const temporary = `${target}.${randomUUID()}`;
    try {
      writeImageFile(temporary, bytes);
      renameSync(temporary, target);
    } finally {
      rmSync(temporary, { force: true });
    }
  }
}

/** Wait before the next attempt: doubling from the base, capped. Attempts counts what has failed so far. */
export function retryDelay(attempts: number): number {
  const grown = PREVIEW_RETRY_BASE_MS * 2 ** Math.max(0, Math.min(attempts, 8));
  return Math.min(PREVIEW_RETRY_MAX_MS, grown);
}

/** Everything a picture has to be before a byte of it is trusted.
 *
 *  The control is another plugin, and a picture is what a browser hands back; the size, the type and the
 *  dimensions are what the metadata row will claim about the file, so an answer that does not hold up is
 *  refused here rather than described wrongly for as long as the row lives. */
function checkCapturedImage(captured: { image: Uint8Array; mimeType: string; width: number; height: number }): {
  bytes: Uint8Array; mime: string; width: number; height: number;
} {
  const bytes = captured.image;
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) throw new Error('the capture returned no image');
  if (bytes.byteLength > PREVIEW_IMAGE_MAX_BYTES) {
    throw new Error(`the capture is ${Math.round(bytes.byteLength / 1024)} KiB, above the ${Math.round(PREVIEW_IMAGE_MAX_BYTES / 1024)} KiB a picture may weigh`);
  }
  if (captured.mimeType !== 'image/png' && captured.mimeType !== 'image/webp') {
    throw new Error(`the capture returned ${captured.mimeType}, which is not a picture this register can show`);
  }
  if (!Number.isInteger(captured.width) || !Number.isInteger(captured.height) || captured.width <= 0 || captured.height <= 0) {
    throw new Error('the capture described no image dimensions');
  }
  return { bytes, mime: captured.mimeType, width: captured.width, height: captured.height };
}

/** Kept beside the module's other filesystem calls so the mode is stated once: the daemon account owns the
 *  plugin data directory, and nothing here is a secret — it is a picture of a page that whoever may open
 *  the page may already see. */
function writeImageFile(path: string, bytes: Uint8Array): void {
  writeFileSync(path, bytes, { mode: 0o644 });
}
