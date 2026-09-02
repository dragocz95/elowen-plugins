import { boundBytes, boundText, isTextualMime, pickResponseHeaders, sanitizeUrl } from './redaction.js';
/** What the page said and what the page fetched, collected as it happens.
 *
 *  Collection is continuous rather than on demand because the interesting event has almost always already
 *  happened: "the click did nothing" is answered by the exception thrown at the time of the click, and a
 *  collector that starts listening when somebody asks can only report the silence afterwards. What that
 *  costs is bounded here — metadata only, fixed-size rings, no bodies retained by us — and every number
 *  below is a cap the tools cannot raise. */
export const CONSOLE_BUFFER_SIZE = 200;
const NETWORK_BUFFER_SIZE = 300;
const MAX_ENTRY_TEXT = 2000;
const MAX_CONSOLE_ARGS = 8;
const MAX_ARG_TEXT = 512;
/** The one body a caller explicitly asked for, and no more of it than a reader can use. */
export const MAX_BODY_BYTES = 65_536;
export const CONSOLE_LEVELS = ['error', 'warning', 'info', 'log', 'debug'];
/** One bounded, FIFO window over a stream that never ends. Overflow is COUNTED: a diagnostic that
 *  silently forgot the first half of the evidence is worse than one that says how much it dropped. */
class Ring {
    limit;
    items = [];
    droppedCount = 0;
    constructor(limit) {
        this.limit = limit;
    }
    push(item) {
        this.items.push(item);
        while (this.items.length > this.limit) {
            this.items.shift();
            this.droppedCount += 1;
        }
    }
    get dropped() { return this.droppedCount; }
    get size() { return this.items.length; }
    all() { return this.items; }
    find(match) { return this.items.find(match); }
    clear() {
        this.items.length = 0;
        this.droppedCount = 0;
    }
}
const CONSOLE_LEVEL_BY_TYPE = {
    error: 'error', assert: 'error',
    warning: 'warning', warn: 'warning',
    info: 'info', count: 'info', timeEnd: 'info',
    debug: 'debug', trace: 'debug',
};
/** One console argument as text, WITHOUT asking the page for more of it.
 *
 *  A `RemoteObject` for an object arrives as a handle plus a preview; resolving that handle means
 *  `Runtime.getProperties` on live page state, recursively, with no natural bottom — a devtools front-end
 *  can afford that because a human expands one node at a time. Here it would be an unbounded read of the
 *  page's memory into a transcript, so the preview Chrome already sent is the whole budget. Object ids are
 *  never emitted: they are meaningless to the reader and are a handle into the page. */
function describeArg(arg) {
    if (!arg)
        return '';
    if (arg.unserializableValue)
        return boundText(arg.unserializableValue, MAX_ARG_TEXT);
    if (arg.type === 'string')
        return boundText(String(arg.value ?? ''), MAX_ARG_TEXT);
    if (arg.value !== undefined && arg.type !== 'object')
        return boundText(String(arg.value), MAX_ARG_TEXT);
    if (arg.description)
        return boundText(arg.description, MAX_ARG_TEXT);
    return boundText(arg.className ?? arg.subtype ?? arg.type ?? 'value', MAX_ARG_TEXT);
}
const topFrame = (stack) => {
    const frames = stack?.callFrames;
    return Array.isArray(frames) ? frames[0] : undefined;
};
/** A request is "slow" past this, which is the threshold at which a page stops feeling like it works. */
const SLOW_MS = 1000;
export class PageDiagnostics {
    now;
    console = new Ring(CONSOLE_BUFFER_SIZE);
    network = new Ring(NETWORK_BUFFER_SIZE);
    pending = new Map();
    disposers = [];
    cdp = null;
    seq = 0;
    closed = false;
    constructor(now) {
        this.now = now;
    }
    /** Bind to a tab's CDP session and turn on the domains this reads.
     *
     *  `Network.enable` is given explicit, modest buffer sizes rather than zero. Zero is the tempting
     *  answer — we never want to hold bodies — but that buffer is exactly what `Network.getResponseBody`
     *  reads from, so zeroing it does not make body retrieval safe, it makes it impossible, and the opt-in
     *  body detail this plugin offers would fail on every request instead of only on the ones a caller
     *  never asked about. Bounded is the honest position: Chrome holds at most this much, we hold none of
     *  it, and nothing is copied out except the one body somebody explicitly asks for. */
    async attach(cdp) {
        if (this.closed)
            return;
        this.disposeListeners();
        this.cdp = cdp;
        // Each tab is its own document, its own console and its own request ids. Carrying the previous tab's
        // entries across would attribute them to a page that never produced them, and a stale request id
        // would answer a body lookup with another tab's response.
        this.console.clear();
        this.network.clear();
        this.pending.clear();
        this.bind(cdp, 'Runtime.consoleAPICalled', (raw) => this.onConsoleApi(raw));
        this.bind(cdp, 'Runtime.exceptionThrown', (raw) => this.onException(raw));
        this.bind(cdp, 'Log.entryAdded', (raw) => this.onLogEntry(raw));
        this.bind(cdp, 'Network.requestWillBeSent', (raw) => this.onRequest(raw));
        this.bind(cdp, 'Network.responseReceived', (raw) => this.onResponse(raw));
        this.bind(cdp, 'Network.loadingFinished', (raw) => this.onFinished(raw));
        this.bind(cdp, 'Network.loadingFailed', (raw) => this.onFailed(raw));
        await Promise.all([
            cdp.send('Runtime.enable'),
            cdp.send('Log.enable'),
            cdp.send('Network.enable', { maxTotalBufferSize: 10_485_760, maxResourceBufferSize: 1_048_576 }),
        ]);
    }
    /** Stop listening and forget everything. Called from the session's own teardown, so a closed session
     *  leaves no handler on a CDP object the garbage collector would otherwise keep alive through it. */
    close() {
        this.closed = true;
        this.disposeListeners();
        this.cdp = null;
        this.console.clear();
        this.network.clear();
        this.pending.clear();
    }
    /** Registered listeners, for the test that asserts teardown actually tears down. */
    get listenerCount() { return this.disposers.length; }
    bind(cdp, event, handler) {
        cdp.on(event, handler);
        this.disposers.push(() => cdp.off(event, handler));
    }
    disposeListeners() {
        for (const dispose of this.disposers)
            dispose();
        this.disposers = [];
    }
    push(entry) {
        this.console.push({ ...entry, seq: ++this.seq });
    }
    onConsoleApi(raw) {
        const payload = raw;
        const args = (payload.args ?? []).slice(0, MAX_CONSOLE_ARGS).map(describeArg).filter(Boolean);
        const frame = topFrame(payload.stackTrace);
        this.push({
            kind: 'console',
            level: CONSOLE_LEVEL_BY_TYPE[payload.type ?? ''] ?? 'log',
            timestamp: this.now(),
            text: boundText(args.join(' '), MAX_ENTRY_TEXT),
            ...(frame?.url ? { url: sanitizeUrl(frame.url) } : {}),
            ...(typeof frame?.lineNumber === 'number' ? { line: frame.lineNumber + 1 } : {}),
        });
    }
    onException(raw) {
        const details = raw.exceptionDetails ?? {};
        const described = describeArg(details.exception);
        const text = [details.text, described].filter(Boolean).join(': ');
        const frame = topFrame(details.stackTrace);
        this.push({
            kind: 'exception',
            level: 'error',
            timestamp: this.now(),
            text: boundText(text || 'Uncaught exception', MAX_ENTRY_TEXT),
            ...(details.url || frame?.url ? { url: sanitizeUrl(details.url ?? frame?.url) } : {}),
            ...(typeof details.lineNumber === 'number' ? { line: details.lineNumber + 1 } : {}),
        });
    }
    onLogEntry(raw) {
        const entry = raw.entry ?? {};
        this.push({
            kind: 'log',
            level: CONSOLE_LEVEL_BY_TYPE[entry.level ?? ''] ?? 'info',
            timestamp: this.now(),
            text: boundText(entry.text ?? '', MAX_ENTRY_TEXT),
            ...(entry.url ? { url: sanitizeUrl(entry.url) } : {}),
            ...(typeof entry.lineNumber === 'number' ? { line: entry.lineNumber + 1 } : {}),
        });
    }
    onRequest(raw) {
        const payload = raw;
        if (typeof payload.requestId !== 'string')
            return;
        const entry = {
            requestId: payload.requestId,
            seq: ++this.seq,
            method: boundText(String(payload.request?.method ?? 'GET'), 16),
            url: sanitizeUrl(payload.request?.url),
            resourceType: boundText(String(payload.type ?? 'Other'), 32),
            startedAt: this.now(),
        };
        this.pending.set(entry.requestId, entry);
        this.network.push(entry);
    }
    entryOf(raw) {
        const requestId = raw.requestId;
        return typeof requestId === 'string' ? this.pending.get(requestId) : undefined;
    }
    onResponse(raw) {
        const entry = this.entryOf(raw);
        if (!entry)
            return;
        const response = raw.response ?? {};
        entry.status = typeof response.status === 'number' ? response.status : undefined;
        entry.mimeType = response.mimeType ? boundText(response.mimeType, 128) : undefined;
        entry.protocol = response.protocol ? boundText(response.protocol, 32) : undefined;
        entry.fromCache = response.fromDiskCache === true;
        entry.headers = pickResponseHeaders(response.headers);
    }
    onFinished(raw) {
        const entry = this.entryOf(raw);
        if (!entry)
            return;
        const encoded = raw.encodedDataLength;
        if (typeof encoded === 'number')
            entry.encodedBytes = Math.round(encoded);
        entry.totalMs = Math.max(0, this.now() - entry.startedAt);
        this.pending.delete(entry.requestId);
    }
    onFailed(raw) {
        const entry = this.entryOf(raw);
        if (!entry)
            return;
        const payload = raw;
        entry.failure = {
            errorText: boundText(payload.errorText ?? 'failed', 256),
            canceled: payload.canceled === true,
            ...(payload.blockedReason ? { blockedReason: boundText(payload.blockedReason, 64) } : {}),
            ...(payload.corsErrorStatus?.corsError ? { corsError: boundText(payload.corsErrorStatus.corsError, 64) } : {}),
        };
        entry.totalMs = Math.max(0, this.now() - entry.startedAt);
        this.pending.delete(entry.requestId);
    }
    consoleEntries(query) {
        const levels = query.levels && query.levels.length ? new Set(query.levels) : null;
        const matched = this.console.all().filter((entry) => (!levels || levels.has(entry.level))
            && (query.since === undefined || entry.timestamp >= query.since));
        return {
            // The newest are the ones worth the budget, but they read in the order they happened.
            entries: matched.slice(-query.limit),
            dropped: this.console.dropped,
            buffered: this.console.size,
        };
    }
    networkEntries(query) {
        const all = this.network.all();
        const isFailed = (entry) => entry.failure !== undefined;
        const isError = (entry) => isFailed(entry) || (entry.status !== undefined && entry.status >= 400);
        const isSlow = (entry) => (entry.totalMs ?? 0) >= SLOW_MS;
        const needle = query.urlContains?.toLowerCase();
        const types = query.resourceTypes && query.resourceTypes.length ? new Set(query.resourceTypes) : null;
        const matched = all.filter((entry) => (query.since === undefined || entry.startedAt >= query.since)
            && (!needle || entry.url.toLowerCase().includes(needle))
            && (!types || types.has(entry.resourceType))
            && (query.filter === 'all'
                || (query.filter === 'failed' && isFailed(entry))
                || (query.filter === 'errors' && isError(entry))
                || (query.filter === 'slow' && isSlow(entry))));
        return {
            entries: matched.slice(-query.limit),
            dropped: this.network.dropped,
            buffered: this.network.size,
            counts: {
                total: all.length,
                failed: all.filter(isFailed).length,
                errors: all.filter(isError).length,
                slow: all.filter(isSlow).length,
            },
        };
    }
    request(requestId) {
        return this.network.find((entry) => entry.requestId === requestId);
    }
    clearConsole() { this.console.clear(); }
    clearNetwork() {
        this.network.clear();
        this.pending.clear();
    }
    /** The body of ONE request, on explicit demand.
     *
     *  Text only, and only what the server itself declared as text: a decoded binary body is noise the
     *  reader pays for by the token. Truncated to a fixed budget rather than streamed, and never cached —
     *  the copy that exists is the one being returned. */
    async responseBody(requestId, mimeType) {
        if (!this.cdp)
            throw new Error('Browser session is closed.');
        if (!isTextualMime(mimeType)) {
            throw new Error(`The response is ${mimeType ?? 'of unknown type'}, which is not text. Only textual responses can be returned.`);
        }
        const response = await this.cdp.send('Network.getResponseBody', { requestId });
        const raw = typeof response.body === 'string' ? response.body : '';
        // A server can label a body as text and still send it base64'd through CDP. Decoding it is fine —
        // the mime type already promised text — but the size cap applies to what the reader receives.
        const text = response.base64Encoded === true ? Buffer.from(raw, 'base64').toString('utf8') : raw;
        // Bytes, not characters: the cap is a payload budget, and counting characters would let a body of
        // accented text or emoji through at several times the size it claims to be.
        const bounded = boundBytes(text, MAX_BODY_BYTES);
        return { body: bounded.text, truncated: bounded.truncated, bytes: bounded.bytes };
    }
}
