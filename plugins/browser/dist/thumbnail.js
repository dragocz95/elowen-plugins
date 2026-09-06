/** How long one capture stands in for the session's screen.
 *
 *  The account panel polls, and a list of sessions polls once per session. Without a cache, N sessions on
 *  screen with a second tab open on the same page is 2N rasterizations of live Chrome every interval, all
 *  of them competing with the agent's own CDP traffic. Four seconds is under the panel's five second
 *  interval — so a reader still gets a fresh picture on every poll — while a second reader, a remount or
 *  a refetch triggered by a window regaining focus is served from what was already taken. */
export const THUMBNAIL_TTL_MS = 4_000;
/** A ceiling on how many sessions' stills are held at once. Every entry is one 480 pixel wide JPEG —
 *  tens of kilobytes — so this is a few tens of megabytes at the very worst, and the ordinary case is a
 *  handful of entries: they expire on the TTL and each is dropped when its session closes.
 *
 *  It is set above what the session limits themselves allow (20 accounts × 8 sessions at the widest the
 *  settings go), so evicting is never the normal path — a still that is thrown away here would simply be
 *  taken again. It answers a bug, not a workload: a cache that has somehow outlived its evictions stays
 *  a bounded amount of memory rather than an unbounded one. */
const MAX_THUMBNAIL_ENTRIES = 200;
/** Per-session stills, taken on demand and reused for {@link THUMBNAIL_TTL_MS}.
 *
 *  A failed capture is remembered as an ABSENCE for the same window rather than retried on the next
 *  request: a session whose page cannot be photographed — mid tab switch, a renderer that is busy, a
 *  display that just died — would otherwise be asked again by every open panel, forever, and each of
 *  those asks costs a CDP round trip against a browser that is already in trouble. */
export class ThumbnailCache {
    deps;
    entries = new Map();
    constructor(deps) {
        this.deps = deps;
    }
    get ttl() { return this.deps.ttlMs ?? THUMBNAIL_TTL_MS; }
    /** This session's still: the cached one while it is fresh, otherwise a new capture.
     *
     *  Ownership is NOT checked here. The caller reaching this has already been handed the session object
     *  by the registry's owner check, and the cache is keyed by an id that only that check can produce a
     *  session for. */
    async get(session) {
        const now = this.deps.clock.now();
        this.prune(now);
        const existing = this.entries.get(session.id);
        if (existing?.pending)
            return existing.pending;
        // `prune` already dropped everything past its window, so anything still here is fresh — including an
        // entry whose answer is that there was no picture.
        if (existing)
            return existing.thumbnail;
        const entry = { thumbnail: null, at: now, pending: null };
        entry.pending = this.capture(session, entry);
        this.entries.set(session.id, entry);
        return entry.pending;
    }
    /** Drop a session's still, because the page it is a picture of no longer exists. */
    forget(sessionId) { this.entries.delete(sessionId); }
    /** How many entries are held — for tests, and for anything that wants to assert the eviction works. */
    get size() { return this.entries.size; }
    async capture(session, entry) {
        let thumbnail = null;
        try {
            const image = await session.thumbnail();
            thumbnail = {
                dataUrl: `data:${image.mimeType};base64,${image.data}`,
                width: image.width,
                height: image.height,
                capturedAt: this.deps.clock.now(),
            };
        }
        catch (error) {
            // Not something the reader has to be told: a session that cannot be photographed right now is drawn
            // with the same placeholder as one whose first capture has not landed yet.
            this.deps.logger.debug?.(`browser thumbnail for ${session.id} was not taken: ${error instanceof Error ? error.message : String(error)}`);
        }
        entry.thumbnail = thumbnail;
        entry.pending = null;
        entry.at = this.deps.clock.now();
        // Only if this entry is still the map's. A `forget` during the capture means the session closed, and
        // writing the result back would revive a picture of a dead page with nobody left to evict it.
        if (this.entries.get(session.id) !== entry)
            return thumbnail;
        this.enforceCap();
        return thumbnail;
    }
    prune(now) {
        for (const [id, entry] of this.entries) {
            if (!entry.pending && now - entry.at >= this.ttl)
                this.entries.delete(id);
        }
    }
    enforceCap() {
        for (const [id, entry] of this.entries) {
            if (this.entries.size <= MAX_THUMBNAIL_ENTRIES)
                return;
            if (!entry.pending)
                this.entries.delete(id);
        }
    }
}
