import { boundText } from './redaction.js';
import type { CDPSessionLike } from './types.js';

/** Performance counters and a bounded timeline trace.
 *
 *  Tracing is the one diagnostic here that is stateful across tool calls — start, do something, stop —
 *  because that is the only way to measure an INTERACTION rather than a moment. Everything that state
 *  makes possible to get wrong is handled in one place: the process-wide lock that stops two sessions
 *  from starting a trace in the same Chrome, the deadline that stops a forgotten trace from running until
 *  the session dies, and the teardown that ends it on a tab switch, a close, or a browser that went away. */

/** Raised when the browser's tracing state can no longer be established: a command that timed out may
 *  still land, a trace we believe ended may still be recording, a stream we could not close may still be
 *  held. Distinct from an ordinary failure because the answer is different — this one is not retried, it
 *  is recovered from by recycling the Chrome process. */
export class TraceStateUnknownError extends Error {
  constructor(readonly reason: string) {
    super(`The browser's tracing state could not be established (${reason}). The browser session will be recycled.`);
    this.name = 'TraceStateUnknownError';
  }
}

/** Chrome runs ONE tracing session per browser process, so this is a property of the process, not of the
 *  page that asked. Owned by whoever owns the process (the pool) and handed to sessions as a capability:
 *  a lock living in the session would be one lock per tab over a resource there is one of. */
export class ProcessTraceLock {
  private ownerId: string | null = null;
  private taintReason: string | null = null;

  /** Reports who holds it, so the refusal can name the session instead of saying "busy". */
  get holder(): string | null { return this.ownerId; }
  /** Why this process can no longer be trusted to trace, or null while it can. */
  get tainted(): string | null { return this.taintReason; }

  acquire(sessionId: string): void {
    // Tainted is terminal for this process. A command that timed out is not a command that failed: it
    // may land a second later and leave Chrome recording with nobody who knows it. Handing the lock to
    // the next caller would let them start a trace on top of one that may already exist, and read back a
    // measurement of something else entirely. Only a new Chrome makes the state knowable again.
    if (this.taintReason !== null) {
      throw new Error(
        `This account's browser can no longer be traced (${this.taintReason}). `
        + 'It is being recycled; start a new browser session and try again.',
      );
    }
    if (this.ownerId !== null && this.ownerId !== sessionId) {
      throw new Error('A performance trace is already running for this account\'s browser. Stop it before starting another.');
    }
    this.ownerId = sessionId;
  }

  /** Give the lock back after an outcome we could actually observe. */
  release(sessionId: string): void {
    if (this.ownerId === sessionId) this.ownerId = null;
  }

  /** Give it back as UNUSABLE. The holder is cleared so nothing waits on it, but nobody else may take
   *  it: the process itself is what has to go. */
  taint(sessionId: string, reason: string): void {
    if (this.taintReason === null) this.taintReason = reason;
    if (this.ownerId === sessionId) this.ownerId = null;
  }
}

/** Timeline categories, fixed. A caller-supplied category list is a raw tracing configuration by another
 *  name, and the disabled-by-default groups can multiply the trace volume by orders of magnitude. */
const TRACE_CATEGORIES = [
  'devtools.timeline',
  'disabled-by-default-devtools.timeline',
  'blink.user_timing',
  'loading',
  'v8.execute',
].join(',');

/** Read cap for the trace stream. A busy page produces tens of megabytes per second of wall time; past
 *  this the aggregate stops improving and the drain starts competing with the operation deadline. */
const MAX_TRACE_BYTES = 8 * 1024 * 1024;
/** Deadlines of this module's own, deliberately far below the session's 45 second safety net: a trace
 *  that hangs must fail as a trace, while the session is still healthy enough to run the next tool. */
const TRACE_START_TIMEOUT_MS = 5_000;
const TRACE_END_TIMEOUT_MS = 5_000;
const TRACE_DRAIN_TIMEOUT_MS = 10_000;
const TRACE_IO_CLOSE_TIMEOUT_MS = 2_000;
/** Much shorter than the drain: this one runs inside a tab switch and inside `close()`, where nobody is
 *  waiting for a measurement any more — only for the browser to stop holding a buffer for it. */
const TRACE_ABANDON_TIMEOUT_MS = 1_500;

export interface TraceSummary {
  durationMs: number;
  events: number;
  truncated: boolean;
  longTasks: { count: number; longestMs: number };
  totals: { scriptMs: number; layoutMs: number; styleMs: number; paintMs: number };
  topEvents: { name: string; count: number; totalMs: number }[];
}

interface TraceEvent { name?: string; ph?: string; dur?: number; ts?: number; cat?: string }

const LONG_TASK_MS = 50;
const SCRIPT_EVENTS = new Set(['EvaluateScript', 'FunctionCall', 'v8.run', 'v8.compile', 'RunMicrotasks']);
const LAYOUT_EVENTS = new Set(['Layout', 'UpdateLayoutTree']);
const STYLE_EVENTS = new Set(['ParseAuthorStyleSheet', 'RecalculateStyles', 'ScheduleStyleRecalculation']);
const PAINT_EVENTS = new Set(['Paint', 'PaintImage', 'CompositeLayers', 'Rasterize']);

/** Reduce raw trace events to the handful of numbers a reader can act on.
 *
 *  Pure, and separate from the transport, because this is the part worth testing: the raw trace never
 *  leaves the daemon — it is megabytes of internal Chrome vocabulary that would bury the answer — so this
 *  aggregate IS the diagnostic, and it has to be right without a browser in the room. */
export function summarizeTraceEvents(events: readonly TraceEvent[], truncated: boolean): TraceSummary {
  const byName = new Map<string, { count: number; totalMs: number }>();
  const totals = { scriptMs: 0, layoutMs: 0, styleMs: 0, paintMs: 0 };
  let longTasks = 0;
  let longestMs = 0;
  let first = Number.POSITIVE_INFINITY;
  let last = 0;

  for (const event of events) {
    // Complete events ('X') carry a duration; the begin/end and instant phases would double-count.
    const ms = event.ph === 'X' && typeof event.dur === 'number' ? event.dur / 1000 : 0;
    if (typeof event.ts === 'number') {
      first = Math.min(first, event.ts);
      last = Math.max(last, event.ts + (event.dur ?? 0));
    }
    const name = event.name ?? 'unknown';
    if (ms > 0) {
      const bucket = byName.get(name) ?? { count: 0, totalMs: 0 };
      bucket.count += 1;
      bucket.totalMs += ms;
      byName.set(name, bucket);
      if (SCRIPT_EVENTS.has(name)) totals.scriptMs += ms;
      else if (LAYOUT_EVENTS.has(name)) totals.layoutMs += ms;
      else if (STYLE_EVENTS.has(name)) totals.styleMs += ms;
      else if (PAINT_EVENTS.has(name)) totals.paintMs += ms;
      if (name === 'RunTask' && ms >= LONG_TASK_MS) {
        longTasks += 1;
        longestMs = Math.max(longestMs, ms);
      }
    }
  }

  const round = (value: number) => Math.round(value * 10) / 10;
  return {
    durationMs: Number.isFinite(first) ? round((last - first) / 1000) : 0,
    events: events.length,
    truncated,
    longTasks: { count: longTasks, longestMs: round(longestMs) },
    totals: {
      scriptMs: round(totals.scriptMs), layoutMs: round(totals.layoutMs),
      styleMs: round(totals.styleMs), paintMs: round(totals.paintMs),
    },
    topEvents: [...byName.entries()]
      .map(([name, bucket]) => ({ name: boundText(name, 64), count: bucket.count, totalMs: round(bucket.totalMs) }))
      .sort((a, b) => b.totalMs - a.totalMs)
      .slice(0, 5),
  };
}

export interface PerformanceMetrics {
  jsHeapUsedBytes?: number;
  jsHeapTotalBytes?: number;
  documents?: number;
  nodes?: number;
  listeners?: number;
  layoutCount?: number;
  recalcStyleCount?: number;
  taskDurationMs?: number;
  navigation?: {
    dnsMs?: number; connectMs?: number; ttfbMs?: number; responseMs?: number;
    domContentLoadedMs?: number; loadMs?: number; firstContentfulPaintMs?: number;
  };
}

const METRIC_KEYS: Record<string, keyof Omit<PerformanceMetrics, 'navigation'>> = {
  JSHeapUsedSize: 'jsHeapUsedBytes',
  JSHeapTotalSize: 'jsHeapTotalBytes',
  Documents: 'documents',
  Nodes: 'nodes',
  JSEventListeners: 'listeners',
  LayoutCount: 'layoutCount',
  RecalcStyleCount: 'recalcStyleCount',
};

/** The page's own navigation timing, read with a FIXED expression.
 *
 *  It runs the same `Runtime.evaluate` the evaluate tool does, but the expression is this plugin's, not a
 *  caller's — which is what keeps "metrics" a typed diagnostic rather than a second, unlabelled way to
 *  run arbitrary script. */
const NAVIGATION_TIMING_EXPRESSION = `(() => {
  const nav = performance.getEntriesByType('navigation')[0];
  const paint = performance.getEntriesByType('paint').find((entry) => entry.name === 'first-contentful-paint');
  if (!nav) return paint ? { firstContentfulPaintMs: paint.startTime } : {};
  return {
    dnsMs: nav.domainLookupEnd - nav.domainLookupStart,
    connectMs: nav.connectEnd - nav.connectStart,
    ttfbMs: nav.responseStart - nav.requestStart,
    responseMs: nav.responseEnd - nav.responseStart,
    domContentLoadedMs: nav.domContentLoadedEventEnd,
    loadMs: nav.loadEventEnd,
    ...(paint ? { firstContentfulPaintMs: paint.startTime } : {}),
  };
})()`;

export async function capturePerformanceMetrics(cdp: CDPSessionLike): Promise<PerformanceMetrics> {
  await cdp.send('Performance.enable').catch(() => {});
  const response = await cdp.send<{ metrics?: { name?: string; value?: number }[] }>('Performance.getMetrics');
  const metrics: PerformanceMetrics = {};
  for (const metric of response.metrics ?? []) {
    const key = METRIC_KEYS[metric.name ?? ''];
    if (key && typeof metric.value === 'number') metrics[key] = Math.round(metric.value);
    if (metric.name === 'TaskDuration' && typeof metric.value === 'number') metrics.taskDurationMs = Math.round(metric.value * 1000);
  }
  const timing = await cdp.send<{ result?: { value?: Record<string, number> } }>('Runtime.evaluate', {
    expression: NAVIGATION_TIMING_EXPRESSION,
    returnByValue: true,
    awaitPromise: false,
  }).catch(() => ({ result: undefined }));
  const value = timing.result?.value;
  if (value && typeof value === 'object') {
    const rounded: Record<string, number> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry === 'number' && Number.isFinite(entry) && entry >= 0) rounded[key] = Math.round(entry);
    }
    if (Object.keys(rounded).length) metrics.navigation = rounded;
  }
  return metrics;
}

const withTimeout = <T>(work: Promise<T>, ms: number, message: string): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
    timer.unref();
  });
  return Promise.race([work, deadline]).finally(() => { if (timer) clearTimeout(timer); }) as Promise<T>;
};

/** A trace in flight, bound to one CDP session.
 *
 *  Holds no trace data between calls — only the fact that Chrome is recording and the handle needed to
 *  stop it. The bytes exist for as long as the drain runs and are summarized before they are dropped;
 *  nothing is written to disk, and the raw stream never becomes a value any caller can reach. */
export class TraceRecorder {
  private cdp: CDPSessionLike | null = null;
  private active: { sessionId: string; startedAt: number } | null = null;
  private complete: ((streamHandle: string | null) => void) | null = null;
  private readonly onComplete = (raw: unknown): void => {
    const handle = (raw as { stream?: unknown }).stream;
    const stream = typeof handle === 'string' ? handle : null;
    const waiter = this.complete;
    this.complete = null;
    if (waiter) {
      waiter(stream);
      return;
    }
    // The completion arrived after whoever was waiting for it gave up. The handle is still a live buffer
    // in the browser, and there is no second event to remind us of it — so it is closed here, on the way
    // past, or Chrome holds those bytes for the life of the process.
    if (stream) void this.cdp?.send('IO.close', { handle: stream }).catch(() => {});
  };

  /** `onStateUnknown` is told once, when this browser's tracing state stops being knowable. The recorder
   *  cannot fix that itself: only the owner of the Chrome process can replace it. */
  constructor(
    private readonly lock: ProcessTraceLock,
    private readonly now: () => number,
    private readonly onStateUnknown: (reason: string) => void = () => {},
  ) {}

  get running(): boolean { return this.active !== null; }

  /** Mark the process unusable, tell its owner, and produce the error to raise. */
  private taint(sessionId: string, reason: string): TraceStateUnknownError {
    this.lock.taint(sessionId, reason);
    this.active = null;
    this.complete = null;
    this.onStateUnknown(reason);
    return new TraceStateUnknownError(reason);
  }

  attach(cdp: CDPSessionLike): void {
    if (this.cdp) this.cdp.off('Tracing.tracingComplete', this.onComplete);
    this.cdp = cdp;
    cdp.on('Tracing.tracingComplete', this.onComplete);
  }

  async start(sessionId: string): Promise<{ startedAt: number }> {
    if (!this.cdp) throw new Error('Browser session is closed.');
    if (this.active) throw new Error('A performance trace is already running for this browser session.');
    this.lock.acquire(sessionId);
    try {
      await withTimeout(this.cdp.send('Tracing.start', {
        categories: TRACE_CATEGORIES,
        transferMode: 'ReturnAsStream',
        options: 'record-until-full',
      }), TRACE_START_TIMEOUT_MS, 'The browser did not start tracing in time.');
    } catch (error) {
      // NOT a plain release. A `Tracing.start` that timed out has not necessarily failed — it may land a
      // moment later and leave Chrome recording with nobody holding the other end. Freeing the lock here
      // would let the next caller start a second trace on top of that one and read back a measurement of
      // something else. The state is unknown, and only a new Chrome makes it knowable again.
      throw this.taint(sessionId, error instanceof Error ? error.message : 'the trace could not be started');
    }
    this.active = { sessionId, startedAt: this.now() };
    return { startedAt: this.active.startedAt };
  }

  async stop(sessionId: string): Promise<TraceSummary> {
    const active = this.active;
    if (!active || active.sessionId !== sessionId) throw new Error('No performance trace is running for this browser session.');
    if (!this.cdp) throw new Error('Browser session is closed.');
    const cdp = this.cdp;
    const streamHandle = new Promise<string | null>((resolve) => { this.complete = resolve; });
    let handle: string | null = null;
    try {
      // Every step gets a deadline of its own, all of them far below the session's 45 second net: a
      // tracing command that hangs must fail as a trace while the session is still able to run the next
      // tool, not take the whole session down with it.
      await withTimeout(cdp.send('Tracing.end'), TRACE_END_TIMEOUT_MS, 'The browser did not accept the end of the trace in time.');
      handle = await withTimeout(streamHandle, TRACE_DRAIN_TIMEOUT_MS, 'The browser did not finish the trace in time.');
    } catch (error) {
      // A trace we asked to end and did not see end may still be recording. Unknown, not failed.
      throw this.taint(sessionId, error instanceof Error ? error.message : 'the trace could not be ended');
    }
    if (!handle) {
      this.finish();
      return summarizeTraceEvents([], false);
    }
    try {
      const { text, truncated } = await withTimeout(readStream(cdp, handle), TRACE_DRAIN_TIMEOUT_MS, 'The trace could not be read in time.');
      const summary = summarizeTraceEvents(parseTraceEvents(text), truncated);
      this.finish();
      return summary;
    } catch (error) {
      // The trace ended, but its stream is in a state we cannot describe: a read that timed out leaves a
      // handle we may or may not have closed, and a buffer the browser may still be holding.
      throw this.taint(sessionId, error instanceof Error ? error.message : 'the trace could not be read');
    }
  }

  /** End a trace nobody is going to stop: the tab moved, the session closed, the browser went away.
   *
   *  `Tracing.end` is not the end of it. The trace was started with `ReturnAsStream`, so Chrome answers
   *  by handing back a stream HANDLE, and a handle nobody reads and nobody closes is a buffer the browser
   *  keeps for as long as it lives — which, on a tab switch, is the rest of the session. So this waits
   *  briefly for the completion event and closes whatever handle it names.
   *
   *  Briefly, and it never throws: a tab switch and a close must complete either way. What differs is
   *  what the lock is given back AS. An abandon that saw the trace end and closed its stream releases the
   *  lock — the process is fine and its next tab may trace. An abandon that timed out did not observe
   *  anything: Chrome may still be recording, may still hold the stream, and the only honest answer is
   *  that this process can no longer be trusted to trace, which its owner is told so it can recycle it. */
  async abandon(): Promise<void> {
    const active = this.active;
    const cdp = this.cdp;
    if (!active || !cdp) {
      this.finish();
      return;
    }
    const streamHandle = new Promise<string | null>((resolve) => { this.complete = resolve; });
    try {
      await withTimeout(cdp.send('Tracing.end'), TRACE_ABANDON_TIMEOUT_MS, 'the abandoned trace could not be ended');
      const handle = await withTimeout(streamHandle, TRACE_ABANDON_TIMEOUT_MS, 'the abandoned trace did not complete');
      if (handle) {
        await withTimeout(cdp.send('IO.close', { handle }), TRACE_IO_CLOSE_TIMEOUT_MS, 'the abandoned trace stream could not be closed');
      }
      this.finish();
    } catch (error) {
      this.taint(active.sessionId, error instanceof Error ? error.message : 'the abandoned trace did not complete');
    }
  }

  detach(): void {
    if (this.cdp) this.cdp.off('Tracing.tracingComplete', this.onComplete);
    this.cdp = null;
  }

  private finish(): void {
    if (this.active) this.lock.release(this.active.sessionId);
    this.active = null;
    this.complete = null;
  }
}

async function readStream(cdp: CDPSessionLike, handle: string): Promise<{ text: string; truncated: boolean }> {
  const chunks: string[] = [];
  let bytes = 0;
  let truncated = false;
  try {
    for (;;) {
      const chunk = await cdp.send<{ data?: string; base64Encoded?: boolean; eof?: boolean }>('IO.read', { handle, size: 262_144 });
      const data = typeof chunk.data === 'string'
        ? (chunk.base64Encoded === true ? Buffer.from(chunk.data, 'base64').toString('utf8') : chunk.data)
        : '';
      bytes += Buffer.byteLength(data, 'utf8');
      if (bytes > MAX_TRACE_BYTES) {
        truncated = true;
        break;
      }
      chunks.push(data);
      if (chunk.eof === true) break;
    }
  } finally {
    // A stream we could not close is a buffer the browser keeps, so this failure is not swallowed: it
    // rides out of the `finally` and lands the caller in the same unknown state as an unfinished read.
    await withTimeout(cdp.send('IO.close', { handle }), TRACE_IO_CLOSE_TIMEOUT_MS, 'the trace stream could not be closed');
  }
  return { text: chunks.join(''), truncated };
}

/** A trace stream is one JSON document, and a truncated one is not parseable. Rather than fail the whole
 *  measurement on the cap this module imposed itself, fall back to scanning the complete event objects
 *  out of the prefix that did arrive. */
function parseTraceEvents(text: string): TraceEvent[] {
  if (!text) return [];
  try {
    const parsed: unknown = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed as TraceEvent[];
    const events = (parsed as { traceEvents?: unknown }).traceEvents;
    if (Array.isArray(events)) return events as TraceEvent[];
    return [];
  } catch {
    const events: TraceEvent[] = [];
    for (const match of text.matchAll(/\{"pid":.*?\}(?=,\{"pid":|\s*\]|$)/g)) {
      try { events.push(JSON.parse(match[0]) as TraceEvent); } catch { /* a half-written tail */ }
    }
    return events;
  }
}
