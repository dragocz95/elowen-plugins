import { boundBytes, boundText, isTextualMime, pickResponseHeaders, sanitizeUrl } from './redaction.js';
import type { CDPSessionLike } from './types.js';

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

export type ConsoleLevel = 'error' | 'warning' | 'info' | 'log' | 'debug';
export const CONSOLE_LEVELS: readonly ConsoleLevel[] = ['error', 'warning', 'info', 'log', 'debug'];

export interface ConsoleEntry {
  seq: number;
  kind: 'console' | 'exception' | 'log';
  level: ConsoleLevel;
  timestamp: number;
  text: string;
  /** Where it came from, already reduced to origin+path. */
  url?: string;
  line?: number;
}

export interface NetworkEntry {
  requestId: string;
  seq: number;
  method: string;
  url: string;
  resourceType: string;
  startedAt: number;
  status?: number;
  mimeType?: string;
  protocol?: string;
  fromCache?: boolean;
  headers?: Record<string, string>;
  encodedBytes?: number;
  totalMs?: number;
  failure?: { errorText: string; canceled: boolean; blockedReason?: string; corsError?: string };
}

/** One bounded, FIFO window over a stream that never ends. Overflow is COUNTED: a diagnostic that
 *  silently forgot the first half of the evidence is worse than one that says how much it dropped. */
class Ring<T> {
  private readonly items: T[] = [];
  private droppedCount = 0;

  constructor(private readonly limit: number) {}

  push(item: T): void {
    this.items.push(item);
    while (this.items.length > this.limit) {
      this.items.shift();
      this.droppedCount += 1;
    }
  }

  get dropped(): number { return this.droppedCount; }
  get size(): number { return this.items.length; }
  all(): readonly T[] { return this.items; }
  find(match: (item: T) => boolean): T | undefined { return this.items.find(match); }
  clear(): void {
    this.items.length = 0;
    this.droppedCount = 0;
  }
}

const CONSOLE_LEVEL_BY_TYPE: Record<string, ConsoleLevel> = {
  error: 'error', assert: 'error',
  warning: 'warning', warn: 'warning',
  info: 'info', count: 'info', timeEnd: 'info',
  debug: 'debug', trace: 'debug',
};

interface RemoteObject {
  type?: string;
  subtype?: string;
  value?: unknown;
  unserializableValue?: string;
  description?: string;
  className?: string;
}

/** One console argument as text, WITHOUT asking the page for more of it.
 *
 *  A `RemoteObject` for an object arrives as a handle plus a preview; resolving that handle means
 *  `Runtime.getProperties` on live page state, recursively, with no natural bottom — a devtools front-end
 *  can afford that because a human expands one node at a time. Here it would be an unbounded read of the
 *  page's memory into a transcript, so the preview Chrome already sent is the whole budget. Object ids are
 *  never emitted: they are meaningless to the reader and are a handle into the page. */
function describeArg(arg: RemoteObject | undefined): string {
  if (!arg) return '';
  if (arg.unserializableValue) return boundText(arg.unserializableValue, MAX_ARG_TEXT);
  if (arg.type === 'string') return boundText(String(arg.value ?? ''), MAX_ARG_TEXT);
  if (arg.value !== undefined && arg.type !== 'object') return boundText(String(arg.value), MAX_ARG_TEXT);
  if (arg.description) return boundText(arg.description, MAX_ARG_TEXT);
  return boundText(arg.className ?? arg.subtype ?? arg.type ?? 'value', MAX_ARG_TEXT);
}

interface StackFrame { url?: string; lineNumber?: number }

const topFrame = (stack: unknown): StackFrame | undefined => {
  const frames = (stack as { callFrames?: StackFrame[] } | undefined)?.callFrames;
  return Array.isArray(frames) ? frames[0] : undefined;
};

export interface ConsoleQuery {
  levels?: readonly ConsoleLevel[];
  limit: number;
  since?: number;
}

export interface NetworkQuery {
  filter: 'all' | 'failed' | 'errors' | 'slow';
  urlContains?: string;
  resourceTypes?: readonly string[];
  limit: number;
  since?: number;
}

/** A request is "slow" past this, which is the threshold at which a page stops feeling like it works. */
const SLOW_MS = 1000;

export class PageDiagnostics {
  private readonly console = new Ring<ConsoleEntry>(CONSOLE_BUFFER_SIZE);
  private readonly network = new Ring<NetworkEntry>(NETWORK_BUFFER_SIZE);
  private readonly pending = new Map<string, NetworkEntry>();
  private disposers: (() => void)[] = [];
  private cdp: CDPSessionLike | null = null;
  private seq = 0;
  private closed = false;

  constructor(private readonly now: () => number) {}

  /** Bind to a tab's CDP session and turn on the domains this reads.
   *
   *  `Network.enable` is given explicit, modest buffer sizes rather than zero. Zero is the tempting
   *  answer — we never want to hold bodies — but that buffer is exactly what `Network.getResponseBody`
   *  reads from, so zeroing it does not make body retrieval safe, it makes it impossible, and the opt-in
   *  body detail this plugin offers would fail on every request instead of only on the ones a caller
   *  never asked about. Bounded is the honest position: Chrome holds at most this much, we hold none of
   *  it, and nothing is copied out except the one body somebody explicitly asks for.
   *
   *  All of it or none of it. Enabling a domain can fail — a tab that navigated away mid-attach, a target
   *  that is already detaching — and a collector left holding listeners on a session whose domains never
   *  came up is the worst of both: it keeps that CDP session (and its page) alive through the handlers,
   *  and it answers later reads with a silence the caller cannot tell from a quiet page.
   *
   *  So the domains go up FIRST, on a session this collector is not yet listening to, and only a
   *  complete success moves the listeners. Binding first and enabling afterwards looks equivalent and is
   *  not: enabling `Runtime` starts delivering that tab's console immediately, so a partial success —
   *  two domains up, the third refused — would already have written the new tab's messages into the
   *  buffers of the old one, and the rollback would put back a history that had been edited. The cost is
   *  the events between the last enable and the bind, which is a few milliseconds of a page that has not
   *  been looked at yet; the alternative corrupts evidence somebody is going to read.
   *
   *  What follows the enables is synchronous and cannot fail halfway: unbind, bind, clear, commit. */
  async attach(cdp: CDPSessionLike): Promise<void> {
    if (this.closed) return;
    // `allSettled`, not `all`: `all` rejects on the first failure while the others are still in flight,
    // and the two still travelling would be enabling domains on a session nobody is going to listen to.
    const results = await Promise.allSettled([
      cdp.send('Runtime.enable'),
      cdp.send('Log.enable'),
      cdp.send('Network.enable', { maxTotalBufferSize: 10_485_760, maxResourceBufferSize: 1_048_576 }),
    ]);
    const failure = results.find((result) => result.status === 'rejected');
    if (failure) throw failure.reason;
    // Committed. Nothing below awaits, so the collector cannot be observed between two of these lines.
    this.bindAll(cdp);
    this.cdp = cdp;
    // Each tab is its own document, its own console and its own request ids. Carrying the previous tab's
    // entries across would attribute them to a page that never produced them, and a stale request id
    // would answer a body lookup with another tab's response.
    this.console.clear();
    this.network.clear();
    this.pending.clear();
  }

  /** Put the listeners back on a session this collector was already attached to.
   *
   *  No enables and no clearing: that session's domains were never turned off, so re-running `attach`
   *  against it would send commands nobody needs and throw away the very entries the caller is falling
   *  back to. This is the rollback path for an attach that failed on a DIFFERENT session. */
  rebind(cdp: CDPSessionLike): void {
    if (this.closed) return;
    this.bindAll(cdp);
    this.cdp = cdp;
  }

  /** Let go of the current tab without ending the collector: no listeners, no cdp, no entries. Used to
   *  roll a failed attach back to nothing rather than to a half-bound state. */
  detach(): void {
    this.disposeListeners();
    this.cdp = null;
    this.console.clear();
    this.network.clear();
    this.pending.clear();
  }

  /** Stop listening and forget everything, for good. Called from the session's own teardown, so a closed
   *  session leaves no handler on a CDP object the garbage collector would otherwise keep alive. */
  close(): void {
    this.closed = true;
    this.detach();
  }

  /** Registered listeners, for the test that asserts teardown actually tears down. */
  get listenerCount(): number { return this.disposers.length; }

  private bindAll(cdp: CDPSessionLike): void {
    this.disposeListeners();
    this.bind(cdp, 'Runtime.consoleAPICalled', (raw) => this.onConsoleApi(raw));
    this.bind(cdp, 'Runtime.exceptionThrown', (raw) => this.onException(raw));
    this.bind(cdp, 'Log.entryAdded', (raw) => this.onLogEntry(raw));
    this.bind(cdp, 'Network.requestWillBeSent', (raw) => this.onRequest(raw));
    this.bind(cdp, 'Network.responseReceived', (raw) => this.onResponse(raw));
    this.bind(cdp, 'Network.loadingFinished', (raw) => this.onFinished(raw));
    this.bind(cdp, 'Network.loadingFailed', (raw) => this.onFailed(raw));
  }

  private bind(cdp: CDPSessionLike, event: string, handler: (payload: unknown) => void): void {
    cdp.on(event, handler);
    this.disposers.push(() => cdp.off(event, handler));
  }

  private disposeListeners(): void {
    for (const dispose of this.disposers) dispose();
    this.disposers = [];
  }

  private push(entry: Omit<ConsoleEntry, 'seq'>): void {
    this.console.push({ ...entry, seq: ++this.seq });
  }

  private onConsoleApi(raw: unknown): void {
    const payload = raw as { type?: string; args?: RemoteObject[]; stackTrace?: unknown };
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

  private onException(raw: unknown): void {
    const details = (raw as { exceptionDetails?: {
      text?: string; url?: string; lineNumber?: number; stackTrace?: unknown; exception?: RemoteObject;
    } }).exceptionDetails ?? {};
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

  private onLogEntry(raw: unknown): void {
    const entry = (raw as { entry?: { level?: string; text?: string; url?: string; lineNumber?: number } }).entry ?? {};
    this.push({
      kind: 'log',
      level: CONSOLE_LEVEL_BY_TYPE[entry.level ?? ''] ?? 'info',
      timestamp: this.now(),
      text: boundText(entry.text ?? '', MAX_ENTRY_TEXT),
      ...(entry.url ? { url: sanitizeUrl(entry.url) } : {}),
      ...(typeof entry.lineNumber === 'number' ? { line: entry.lineNumber + 1 } : {}),
    });
  }

  private onRequest(raw: unknown): void {
    const payload = raw as { requestId?: string; type?: string; request?: { url?: string; method?: string } };
    if (typeof payload.requestId !== 'string') return;
    const entry: NetworkEntry = {
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

  private entryOf(raw: unknown): NetworkEntry | undefined {
    const requestId = (raw as { requestId?: string }).requestId;
    return typeof requestId === 'string' ? this.pending.get(requestId) : undefined;
  }

  private onResponse(raw: unknown): void {
    const entry = this.entryOf(raw);
    if (!entry) return;
    const response = (raw as { response?: {
      status?: number; mimeType?: string; protocol?: string; fromDiskCache?: boolean; headers?: unknown;
    } }).response ?? {};
    entry.status = typeof response.status === 'number' ? response.status : undefined;
    entry.mimeType = response.mimeType ? boundText(response.mimeType, 128) : undefined;
    entry.protocol = response.protocol ? boundText(response.protocol, 32) : undefined;
    entry.fromCache = response.fromDiskCache === true;
    entry.headers = pickResponseHeaders(response.headers);
  }

  private onFinished(raw: unknown): void {
    const entry = this.entryOf(raw);
    if (!entry) return;
    const encoded = (raw as { encodedDataLength?: number }).encodedDataLength;
    if (typeof encoded === 'number') entry.encodedBytes = Math.round(encoded);
    entry.totalMs = Math.max(0, this.now() - entry.startedAt);
    this.pending.delete(entry.requestId);
  }

  private onFailed(raw: unknown): void {
    const entry = this.entryOf(raw);
    if (!entry) return;
    const payload = raw as { errorText?: string; canceled?: boolean; blockedReason?: string; corsErrorStatus?: { corsError?: string } };
    entry.failure = {
      errorText: boundText(payload.errorText ?? 'failed', 256),
      canceled: payload.canceled === true,
      ...(payload.blockedReason ? { blockedReason: boundText(payload.blockedReason, 64) } : {}),
      ...(payload.corsErrorStatus?.corsError ? { corsError: boundText(payload.corsErrorStatus.corsError, 64) } : {}),
    };
    entry.totalMs = Math.max(0, this.now() - entry.startedAt);
    this.pending.delete(entry.requestId);
  }

  consoleEntries(query: ConsoleQuery): { entries: ConsoleEntry[]; dropped: number; buffered: number } {
    const levels = query.levels && query.levels.length ? new Set(query.levels) : null;
    const matched = this.console.all().filter((entry) =>
      (!levels || levels.has(entry.level))
      && (query.since === undefined || entry.timestamp >= query.since));
    return {
      // The newest are the ones worth the budget, but they read in the order they happened.
      entries: matched.slice(-query.limit),
      dropped: this.console.dropped,
      buffered: this.console.size,
    };
  }

  networkEntries(query: NetworkQuery): { entries: NetworkEntry[]; dropped: number; buffered: number; counts: { total: number; failed: number; errors: number; slow: number } } {
    const all = this.network.all();
    const isFailed = (entry: NetworkEntry) => entry.failure !== undefined;
    const isError = (entry: NetworkEntry) => isFailed(entry) || (entry.status !== undefined && entry.status >= 400);
    const isSlow = (entry: NetworkEntry) => (entry.totalMs ?? 0) >= SLOW_MS;
    const needle = query.urlContains?.toLowerCase();
    const types = query.resourceTypes && query.resourceTypes.length ? new Set(query.resourceTypes) : null;
    const matched = all.filter((entry) =>
      (query.since === undefined || entry.startedAt >= query.since)
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

  request(requestId: string): NetworkEntry | undefined {
    return this.network.find((entry) => entry.requestId === requestId);
  }

  clearConsole(): void { this.console.clear(); }
  clearNetwork(): void {
    this.network.clear();
    this.pending.clear();
  }

  /** The body of ONE request, on explicit demand.
   *
   *  Text only, and only what the server itself declared as text: a decoded binary body is noise the
   *  reader pays for by the token. Truncated to a fixed budget rather than streamed, and never cached —
   *  the copy that exists is the one being returned. */
  async responseBody(requestId: string, mimeType: string | undefined): Promise<{ body: string; truncated: boolean; bytes: number }> {
    if (!this.cdp) throw new Error('Browser session is closed.');
    if (!isTextualMime(mimeType)) {
      throw new Error(`The response is ${mimeType ?? 'of unknown type'}, which is not text. Only textual responses can be returned.`);
    }
    const response = await this.cdp.send<{ body?: string; base64Encoded?: boolean }>('Network.getResponseBody', { requestId });
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
