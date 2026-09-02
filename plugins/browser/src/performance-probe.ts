import { boundText } from './redaction.js';
import type { CDPSessionLike } from './types.js';

/** Performance counters and a bounded timeline trace.
 *
 *  Tracing is the one diagnostic here that is stateful across tool calls — start, do something, stop —
 *  because that is the only way to measure an INTERACTION rather than a moment. Everything that state
 *  makes possible to get wrong is handled in one place: the process-wide lock that stops two sessions
 *  from starting a trace in the same Chrome, the deadline that stops a forgotten trace from running until
 *  the session dies, and the teardown that ends it on a tab switch, a close, or a browser that went away. */

/** Chrome runs ONE tracing session per browser process, so this is a property of the process, not of the
 *  page that asked. Owned by whoever owns the process (the pool) and handed to sessions as a capability:
 *  a lock living in the session would be one lock per tab over a resource there is one of. */
export class ProcessTraceLock {
  private ownerId: string | null = null;

  /** Reports who holds it, so the refusal can name the session instead of saying "busy". */
  get holder(): string | null { return this.ownerId; }

  acquire(sessionId: string): void {
    if (this.ownerId !== null && this.ownerId !== sessionId) {
      throw new Error('A performance trace is already running for this account\'s browser. Stop it before starting another.');
    }
    this.ownerId = sessionId;
  }

  release(sessionId: string): void {
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
const TRACE_DRAIN_TIMEOUT_MS = 10_000;
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
    this.complete?.(typeof handle === 'string' ? handle : null);
    this.complete = null;
  };

  constructor(private readonly lock: ProcessTraceLock, private readonly now: () => number) {}

  get running(): boolean { return this.active !== null; }

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
      this.lock.release(sessionId);
      throw error;
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
    try {
      await cdp.send('Tracing.end');
      const handle = await withTimeout(streamHandle, TRACE_DRAIN_TIMEOUT_MS, 'The browser did not finish the trace in time.');
      if (!handle) return summarizeTraceEvents([], false);
      const { text, truncated } = await withTimeout(readStream(cdp, handle), TRACE_DRAIN_TIMEOUT_MS, 'The trace could not be read in time.');
      return summarizeTraceEvents(parseTraceEvents(text), truncated);
    } finally {
      this.finish();
    }
  }

  /** End a trace nobody is going to stop: the tab moved, the session closed, the browser went away.
   *
   *  `Tracing.end` is not the end of it. The trace was started with `ReturnAsStream`, so Chrome answers
   *  by handing back a stream HANDLE, and a handle nobody reads and nobody closes is a buffer the browser
   *  keeps for as long as it lives — which, on a tab switch, is the rest of the session. So this waits
   *  briefly for the completion event and closes whatever handle it names.
   *
   *  Briefly, and fail-closed: a browser that is already gone will never send the event, and a teardown
   *  that waited on it — or threw when it did not come — would hold the process-wide tracing lock for the
   *  rest of the daemon's life. The lock is released either way. */
  async abandon(): Promise<void> {
    const active = this.active;
    const cdp = this.cdp;
    if (!active || !cdp) {
      this.finish();
      return;
    }
    const streamHandle = new Promise<string | null>((resolve) => { this.complete = resolve; });
    try {
      await cdp.send('Tracing.end');
      const handle = await withTimeout(streamHandle, TRACE_ABANDON_TIMEOUT_MS, 'abandoned trace did not complete');
      if (handle) await cdp.send('IO.close', { handle });
    } catch {
      // Nothing here is worth failing a tab switch or a close over: the measurement was already lost the
      // moment its tab went away, and the only thing that must survive is the release below.
    } finally {
      this.finish();
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
    await cdp.send('IO.close', { handle }).catch(() => {});
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
