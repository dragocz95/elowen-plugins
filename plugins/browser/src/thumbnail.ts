import type { CapturedImage } from './capture.js';
import type { BrowserClock, BrowserLogger } from './types.js';

/** How long one capture stands in for the session's screen.
 *
 *  Two readers draw this still and they want opposite things from the window. The account panel refreshes
 *  once per five seconds, and a still that outlives its own window is a picture of the past. The
 *  transcript's card, below the width where its live view floats, draws this still as the session's
 *  SCREEN, and it asks again on exactly this window — the route names it back (`refreshMs`), so the
 *  card's cadence is this one value rather than a second constant in a bundle that could drift from it.
 *
 *  What is being spent here is not bytes but a rasterization of a live Chrome, so this is the fastest the
 *  preview may be renewed rather than a free knob: a second and a half reads as live without the capture
 *  competing with the page the agent is working on. It stays under the panel's five second poll, so a
 *  reader of either surface still gets a fresh picture on every ask, and the cache is what keeps the cost
 *  from multiplying — a list of sessions with a second tab open on the same page, a remount, or a refetch
 *  triggered by a window regaining focus is served from what was already taken. */
export const THUMBNAIL_TTL_MS = 1_500;

/** How long an answer a client has already been handed may still be shown as the session's screen.
 *
 *  The window above says how OFTEN to ask; this says how long an ANSWER stays good, and they are different
 *  questions. Taking the picture is not instant and it cannot be cancelled: the session's own capture gives
 *  up after five seconds (`BrowserSession.thumbnail`), so an answer can describe the screen as it was that
 *  long ago, and the next answer is one window away on top of it. A client that cannot renew its picture
 *  inside this bound is not looking at the session any more — so the bound is the server's to name, and it
 *  is named here rather than guessed in a browser bundle, which is also what keeps a merely SLOW capture
 *  from being called a dead one. */
export const THUMBNAIL_LIVE_MS = 7_000;

/** A ceiling on how many sessions' stills are held at once. Every entry is one 480 pixel wide JPEG —
 *  tens of kilobytes — so this is a few tens of megabytes at the very worst, and the ordinary case is a
 *  handful of entries: they expire on the TTL and each is dropped when its session closes.
 *
 *  It is set above what the session limits themselves allow (20 accounts × 8 sessions at the widest the
 *  settings go), so evicting is never the normal path — a still that is thrown away here would simply be
 *  taken again. It answers a bug, not a workload: a cache that has somehow outlived its evictions stays
 *  a bounded amount of memory rather than an unbounded one. */
const MAX_THUMBNAIL_ENTRIES = 200;

/** What a reader gets: the still, the box it should be drawn in, and when it was taken. */
export interface SessionThumbnail {
  /** A `data:image/jpeg;base64,…` URL — small enough to inline, and the same shape the session card
   *  already uses for a page's favicon, so nothing new has to carry bytes to the browser. */
  dataUrl: string;
  width: number;
  height: number;
  capturedAt: number;
}

interface CacheEntry {
  /** The answer, which is deliberately allowed to be "there is no picture right now". */
  thumbnail: SessionThumbnail | null;
  /** When the attempt that produced this answer ENDED — so the window bounds the RATE of captures.
   *
   *  Timing it from the START would be worse than useless against the case it most has to survive: a
   *  renderer that has stopped answering. The session's capture gives up after its own deadline, which
   *  is LONGER than this window, so an entry stamped at the start is already expired the moment the
   *  failure lands — and the next poll launches another screenshot at a browser that never finished the
   *  last one. `Page.captureScreenshot` has no cancellation, so those pile up. */
  at: number;
  /** The capture in flight, while there is one. Two readers arriving together cost one screenshot. */
  pending: Promise<SessionThumbnail | null> | null;
}

/** The session a capture is asked of — only what this cache needs, so its behaviour can be exercised
 *  without a browser. */
export interface ThumbnailSource {
  readonly id: string;
  thumbnail(): Promise<CapturedImage>;
}

/** Per-session stills, taken on demand and reused for {@link THUMBNAIL_TTL_MS}.
 *
 *  A failed capture is remembered as an ABSENCE for the same window rather than retried on the next
 *  request: a session whose page cannot be photographed — mid tab switch, a renderer that is busy, a
 *  display that just died — would otherwise be asked again by every open panel, forever, and each of
 *  those asks costs a CDP round trip against a browser that is already in trouble. */
export class ThumbnailCache {
  private readonly entries = new Map<string, CacheEntry>();

  constructor(private readonly deps: {
    clock: BrowserClock;
    logger: BrowserLogger;
    ttlMs?: number;
  }) {}

  private get ttl(): number { return this.deps.ttlMs ?? THUMBNAIL_TTL_MS; }

  /** This session's still: the cached one while it is fresh, otherwise a new capture.
   *
   *  Ownership is NOT checked here. The caller reaching this has already been handed the session object
   *  by the registry's owner check, and the cache is keyed by an id that only that check can produce a
   *  session for. */
  async get(session: ThumbnailSource): Promise<SessionThumbnail | null> {
    const now = this.deps.clock.now();
    this.prune(now);
    const existing = this.entries.get(session.id);
    if (existing?.pending) return existing.pending;
    // `prune` already dropped everything past its window, so anything still here is fresh — including an
    // entry whose answer is that there was no picture.
    if (existing) return existing.thumbnail;
    const entry: CacheEntry = { thumbnail: null, at: now, pending: null };
    entry.pending = this.capture(session, entry);
    this.entries.set(session.id, entry);
    return entry.pending;
  }

  /** Drop a session's still, because the page it is a picture of no longer exists. */
  forget(sessionId: string): void { this.entries.delete(sessionId); }

  /** How many entries are held — for tests, and for anything that wants to assert the eviction works. */
  get size(): number { return this.entries.size; }

  private async capture(session: ThumbnailSource, entry: CacheEntry): Promise<SessionThumbnail | null> {
    let thumbnail: SessionThumbnail | null = null;
    try {
      const image = await session.thumbnail();
      thumbnail = {
        dataUrl: `data:${image.mimeType};base64,${image.data}`,
        width: image.width,
        height: image.height,
        capturedAt: this.deps.clock.now(),
      };
    } catch (error) {
      // Not something the reader has to be told: a session that cannot be photographed right now is drawn
      // with the same placeholder as one whose first capture has not landed yet.
      this.deps.logger.debug?.(`browser thumbnail for ${session.id} was not taken: ${error instanceof Error ? error.message : String(error)}`);
    }
    entry.thumbnail = thumbnail;
    entry.pending = null;
    entry.at = this.deps.clock.now();
    // Only if this entry is still the map's. A `forget` during the capture means the session closed, and
    // writing the result back would revive a picture of a dead page with nobody left to evict it.
    if (this.entries.get(session.id) !== entry) return thumbnail;
    this.enforceCap();
    return thumbnail;
  }

  private prune(now: number): void {
    for (const [id, entry] of this.entries) {
      if (!entry.pending && now - entry.at >= this.ttl) this.entries.delete(id);
    }
  }

  private enforceCap(): void {
    for (const [id, entry] of this.entries) {
      if (this.entries.size <= MAX_THUMBNAIL_ENTRIES) return;
      if (!entry.pending) this.entries.delete(id);
    }
  }
}
