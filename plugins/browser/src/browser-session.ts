import { randomBytes } from 'node:crypto';
import { captureAccessibilitySnapshot } from './accessibility.js';
import { artifactData, serializeArtifactRef } from './artifact.js';
import {
  captureElement, captureFullPage, captureModelScreenshot, captureViewport, SCREENSHOT_JPEG_QUALITY,
  type CapturedImage, type ImageFormat,
} from './capture.js';
import type { BrowserConfig } from './config.js';
import { InputController } from './input-controller.js';
import { NavigationPolicy } from './navigation-policy.js';
import { readPageFavicon } from './page-favicon.js';
import {
  PageDiagnostics, type ConsoleEntry, type ConsoleQuery, type NetworkEntry, type NetworkQuery,
} from './page-diagnostics.js';
import {
  capturePerformanceMetrics, ProcessTraceLock, TraceRecorder,
  type PerformanceMetrics, type TraceSummary,
} from './performance-probe.js';
import { boundText } from './redaction.js';
import { BrowserStore } from './store.js';
import type { TabManager } from './tab-manager.js';
import type {
  AccessibilitySnapshot, BrowserActionEvent, BrowserArtifactPublisher, BrowserArtifactRef, BrowserClock,
  BrowserLogger, BrowserSessionState, BrowserTabInfo, CDPSessionLike, PageLike,
} from './types.js';

/** A JavaScript expression's result, as data. A page throwing is a legitimate answer to "what does this
 *  expression evaluate to" — the tool failed only if it could not ask. */
export interface EvaluateResult {
  value?: string;
  error?: { text: string; className?: string; line?: number; column?: number };
  truncated: boolean;
  durationMs: number;
}

/** The evaluate tool's own budget for a page's answer. Larger than a console argument because the caller
 *  chose the expression and can aim it; small enough that a `document.body.innerHTML` on a heavy page
 *  cannot spend a whole context window. */
const MAX_EVALUATE_RESULT = 8192;

/** A returned value as text. `returnByValue` already refused anything with a cycle, but a value the page
 *  built to break JSON (a getter that throws, a BigInt) must not turn a diagnostic into an exception the
 *  caller cannot tell apart from the page's own. */
function safeJson(value: unknown): string {
  try { return JSON.stringify(value, null, 2) ?? String(value); }
  catch { return String(value); }
}

/** Bound a wait without touching session state.
 *
 *  `runBoundedOperation` below is the AGENT's deadline and deliberately recycles the browser when it
 *  fires. Everything a PERSON drives needs the opposite: free the caller — and with it the serial queue
 *  slot — while leaving the session alive, because a wedged CDP call must not make "take control",
 *  "release" or "close" unreachable. The abandoned work still runs; only the waiting stops. */
async function withDeadline<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

class SerialQueue {
  private tail: Promise<void> = Promise.resolve();

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(() => {}, () => {});
    return result;
  }
}

interface ControlLease {
  leaseId: string;
  claimedAt: number;
  expiresAt: number;
}

interface AgentWaiter {
  resolve(): void;
  reject(error: unknown): void;
  signal?: AbortSignal;
  abort?: () => void;
}

export interface BrowserSessionDeps {
  id: string;
  ownerUserId: number;
  conversationId: string;
  createdAt: number;
  hardExpiresAt: number;
  page: PageLike;
  tabs: TabManager;
  config: () => BrowserConfig;
  store: BrowserStore;
  artifacts: BrowserArtifactPublisher;
  artifactRef?: BrowserArtifactRef | null;
  /** The tracing lock of the Chrome process this session's tab lives in. Chrome records one trace per
   *  process, so the lock is the process owner's to hand out — a session cannot own what it shares. */
  traceLock: ProcessTraceLock;
  clock: BrowserClock;
  logger: BrowserLogger;
  releasePage(): Promise<void>;
  forceCloseBrowser(): Promise<void>;
  onClosed(id: string): void;
}

export class BrowserSession {
  readonly id: string;
  readonly ownerUserId: number;
  readonly conversationId: string;
  readonly createdAt: number;
  readonly hardExpiresAt: number;
  private stateValue: BrowserSessionState = 'creating';
  private page: PageLike;
  private cdp!: CDPSessionLike;
  private readonly queue = new SerialQueue();
  private readonly waiters = new Set<AgentWaiter>();
  private readonly takeoverWaiters = new Set<AgentWaiter>();
  private readonly listeners = new Map<string, (event: BrowserActionEvent) => Promise<void>>();
  private lease: ControlLease | null = null;
  private controlRevisionValue = 0;
  private controlReasonValue: string | null = null;
  private leaseTimer: NodeJS.Timeout | null = null;
  private hardExpiryTimer: NodeJS.Timeout | null = null;
  private lastActivityAt: number;
  private lastAction: string | null = null;
  private snapshotValue: AccessibilitySnapshot | null = null;
  private faviconPageUrl: string | null = null;
  private faviconDataUrl: string | null = null;
  private faviconGeneration = 0;
  private artifactRef: BrowserArtifactRef | null;
  private input!: InputController;
  private readonly diagnostics: PageDiagnostics;
  private readonly tracer: TraceRecorder;
  /** Undo for the listeners this session put on the CURRENT tab's CDP session, in registration order. */
  private disposeCdpListeners: () => void = () => {};
  private closedPromise: Promise<void> | null = null;

  private constructor(private readonly deps: BrowserSessionDeps) {
    this.diagnostics = new PageDiagnostics(() => deps.clock.now());
    this.tracer = new TraceRecorder(deps.traceLock, () => deps.clock.now(), (reason) => this.recycleBrowser(reason));
    this.id = deps.id;
    this.ownerUserId = deps.ownerUserId;
    this.conversationId = deps.conversationId;
    this.createdAt = deps.createdAt;
    this.hardExpiresAt = deps.hardExpiresAt;
    this.page = deps.page;
    this.artifactRef = deps.artifactRef ?? null;
    this.lastActivityAt = deps.createdAt;
  }

  static async create(deps: BrowserSessionDeps): Promise<BrowserSession> {
    const session = new BrowserSession(deps);
    await session.attachPage(deps.page);
    session.stateValue = 'agent';
    session.persist({ state: 'agent' });
    session.scheduleHardExpiry();
    return session;
  }

  get state(): BrowserSessionState { return this.stateValue; }
  get lastActivity(): number { return this.lastActivityAt; }
  get currentLease(): { expiresAt: number } | null {
    return this.lease ? { expiresAt: this.lease.expiresAt } : null;
  }
  get controlRevision(): number { return this.controlRevisionValue; }
  get controlReason(): string | null { return this.controlReasonValue; }
  get currentFavicon(): string | null { return this.faviconDataUrl; }

  /** Whether this lease is the one currently driving the session.
   *
   *  The live view transport asks per input message, so control changing hands takes effect on the next
   *  message rather than at the next reconnect. It compares a token the caller already holds and never
   *  hands one out, so it cannot become a way to learn a lease id. */
  holdsLease(leaseId: string): boolean {
    return this.stateValue === 'user'
      && this.lease?.leaseId === leaseId
      && this.lease.expiresAt > this.deps.clock.now();
  }

  async setArtifact(ref: BrowserArtifactRef | null): Promise<void> {
    if (this.stateValue === 'closing' || this.stateValue === 'closed' || this.stateValue === 'error') {
      if (ref) await this.deps.artifacts.close(ref).catch(() => {});
      return;
    }
    this.artifactRef = ref;
    this.persist({ artifactRef: serializeArtifactRef(ref) });
    await this.updateArtifact();
  }

  async snapshot(includeScreenshot = false, signal?: AbortSignal): Promise<{ snapshot: AccessibilitySnapshot; screenshot?: string }> {
    return this.runAgentOperation(signal, async () => {
      const snapshot = await this.captureSnapshot();
      const screenshot = includeScreenshot ? await captureModelScreenshot(this.cdp, SCREENSHOT_JPEG_QUALITY) : undefined;
      return screenshot ? { snapshot, screenshot } : { snapshot };
    });
  }

  async navigate(url: string, signal?: AbortSignal): Promise<AccessibilitySnapshot> {
    return this.agentMutation(signal, async () => {
      const policy = new NavigationPolicy(this.deps.config().privateNetworkAllowlist);
      const validated = policy.validateUrl(url);
      // The proxy enforces this again at dial time. Resolving here is for the caller: a blocked literal or
      // DNS answer must be a clear tool refusal, not a successful navigation to the proxy's generic 500 page.
      await policy.resolve(validated.toString());
      await this.page.goto(validated.toString(), { waitUntil: 'domcontentloaded', timeout: 30_000 });
      this.emit({ kind: 'action', data: { action: 'navigate', target: validated.hostname } });
      return this.finishMutation(`Navigated to ${validated.hostname}`);
    });
  }

  async click(ref: string, signal?: AbortSignal): Promise<AccessibilitySnapshot> {
    return this.agentMutation(signal, async () => {
      const snapshot = await this.ensureSnapshot();
      const element = snapshot.elements.get(ref);
      if (!element) throw new Error(`Accessibility element ${ref} was not found in the latest snapshot.`);
      await this.input.click(element);
      return this.finishMutation(`Clicked ${element.name || element.role}`);
    });
  }

  async fill(ref: string, value: string, signal?: AbortSignal): Promise<AccessibilitySnapshot> {
    return this.agentMutation(signal, async () => {
      const snapshot = await this.ensureSnapshot();
      const element = snapshot.elements.get(ref);
      if (!element) throw new Error(`Accessibility element ${ref} was not found in the latest snapshot.`);
      await this.input.fill(element, value);
      return this.finishMutation(`Filled ${element.name || element.role}`);
    });
  }

  async pressKey(key: string, modifiers: string[] | undefined, signal?: AbortSignal): Promise<AccessibilitySnapshot> {
    return this.agentMutation(signal, async () => {
      await this.input.pressKey(key, modifiers);
      return this.finishMutation(`Pressed ${key}`);
    });
  }

  async scroll(deltaX: number, deltaY: number, signal?: AbortSignal): Promise<AccessibilitySnapshot> {
    return this.agentMutation(signal, async () => {
      await this.input.scroll(deltaX, deltaY);
      return this.finishMutation('Scrolled the page');
    });
  }

  async waitFor(text: string, timeoutMs: number, signal?: AbortSignal): Promise<AccessibilitySnapshot> {
    const needle = text.trim().toLowerCase();
    if (!needle) throw new Error('Wait text cannot be empty.');
    const deadline = this.deps.clock.now() + Math.max(100, Math.min(timeoutMs, 60_000));
    while (true) {
      if (signal?.aborted) throw signal.reason ?? new Error('Browser wait aborted.');
      const current = await this.snapshot(false, signal);
      if (current.snapshot.text.toLowerCase().includes(needle)) return current.snapshot;
      if (this.deps.clock.now() >= deadline) throw new Error(`Timed out waiting for ${JSON.stringify(text)}.`);
      await this.deps.clock.sleep(250, signal);
    }
  }

  /** Every diagnostic below runs through `runAgentOperation`, exactly like a click: it waits out a user
   *  takeover, queues behind other agent work on this session, refuses a closed one, and inherits the
   *  45 second safety deadline. Reading the page while its owner is driving it would both report a state
   *  the agent did not produce and contend for the CDP session the user's input is travelling on. */
  async screenshot(
    area: 'viewport' | 'fullPage' | 'element',
    format: ImageFormat,
    ref: string | undefined,
    signal?: AbortSignal,
  ): Promise<CapturedImage> {
    return this.runAgentOperation(signal, async () => {
      const quality = SCREENSHOT_JPEG_QUALITY;
      if (area === 'viewport') return captureViewport(this.cdp, format, quality);
      if (area === 'fullPage') return captureFullPage(this.cdp, format, quality);
      if (!ref) throw new Error('An element ref is required to capture an element.');
      const snapshot = await this.ensureSnapshot();
      const element = snapshot.elements.get(ref);
      if (!element) throw new Error(`Accessibility element ${ref} was not found in the latest snapshot.`);
      return captureElement(this.cdp, element, format, quality);
    });
  }

  /** Run an expression in the page's MAIN world — the same world the browser's own console types into.
   *
   *  An isolated world would be the safer-sounding choice and the useless one: it shares the DOM but not
   *  the page's globals, so every question worth asking a live application ("what is in the store", "why
   *  is this handler not bound") comes back undefined. The expression can therefore read and change the
   *  current origin, which is a deliberate product decision — it is the capability, not a side effect.
   *
   *  What stays bounded is what comes BACK: a serialized value, capped, with the page's own exception
   *  returned as data rather than raised as a tool failure. No object handles are returned, so nothing
   *  here hands out a reference into the page for a later call to dereference. */
  async evaluate(expression: string, timeoutMs: number, awaitPromise: boolean, signal?: AbortSignal): Promise<EvaluateResult> {
    return this.runAgentOperation(signal, async () => {
      const startedAt = this.deps.clock.now();
      const response = await this.cdp.send<{
        result?: { type?: string; subtype?: string; value?: unknown; description?: string; unserializableValue?: string };
        exceptionDetails?: { text?: string; lineNumber?: number; columnNumber?: number; exception?: { className?: string; description?: string } };
      }>('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise,
        userGesture: false,
        timeout: timeoutMs,
        // The page owns this world; a throw here is the page's answer, and Chrome reports it in
        // `exceptionDetails` rather than by failing the command.
        silent: false,
      });
      const durationMs = Math.max(0, this.deps.clock.now() - startedAt);
      if (response.exceptionDetails) {
        const details = response.exceptionDetails;
        return {
          error: {
            text: boundText(details.exception?.description ?? details.text ?? 'Uncaught exception', 2000),
            ...(details.exception?.className ? { className: boundText(details.exception.className, 64) } : {}),
            ...(typeof details.lineNumber === 'number' ? { line: details.lineNumber + 1 } : {}),
            ...(typeof details.columnNumber === 'number' ? { column: details.columnNumber + 1 } : {}),
          },
          truncated: false,
          durationMs,
        };
      }
      const result = response.result ?? {};
      const raw = result.unserializableValue
        ?? (result.value === undefined
          // `returnByValue` cannot serialize a DOM node or a function; Chrome sends a description
          // instead, which is what a console would print. The object id it also sends is never read.
          ? (result.subtype === 'null' ? 'null' : result.description ?? String(result.type ?? 'undefined'))
          : typeof result.value === 'string' ? result.value : safeJson(result.value));
      return {
        value: boundText(raw, MAX_EVALUATE_RESULT),
        truncated: raw.length > MAX_EVALUATE_RESULT,
        durationMs,
      };
    });
  }

  async consoleEntries(query: ConsoleQuery, signal?: AbortSignal): Promise<{ entries: ConsoleEntry[]; dropped: number; buffered: number }> {
    return this.runAgentOperation(signal, async () => this.diagnostics.consoleEntries(query));
  }

  async clearConsole(signal?: AbortSignal): Promise<void> {
    return this.runAgentOperation(signal, async () => { this.diagnostics.clearConsole(); });
  }

  async networkEntries(query: NetworkQuery, signal?: AbortSignal) {
    return this.runAgentOperation(signal, async () => this.diagnostics.networkEntries(query));
  }

  async clearNetwork(signal?: AbortSignal): Promise<void> {
    return this.runAgentOperation(signal, async () => { this.diagnostics.clearNetwork(); });
  }

  /** One request in full, and its body only when the caller asked for one. */
  async networkRequest(requestId: string, includeBody: boolean, signal?: AbortSignal): Promise<{
    entry: NetworkEntry; body?: { text: string; truncated: boolean; bytes: number };
  }> {
    return this.runAgentOperation(signal, async () => {
      const entry = this.diagnostics.request(requestId);
      if (!entry) throw new Error('That request is not in this session\'s recent network buffer.');
      if (!includeBody) return { entry };
      const body = await this.diagnostics.responseBody(requestId, entry.mimeType);
      return { entry, body: { text: body.body, truncated: body.truncated, bytes: body.bytes } };
    });
  }

  async performanceMetrics(signal?: AbortSignal): Promise<PerformanceMetrics> {
    return this.runAgentOperation(signal, () => capturePerformanceMetrics(this.cdp));
  }

  async startTrace(signal?: AbortSignal): Promise<{ startedAt: number }> {
    return this.runAgentOperation(signal, () => this.tracer.start(this.id));
  }

  async stopTrace(signal?: AbortSignal): Promise<TraceSummary> {
    return this.runAgentOperation(signal, () => this.tracer.stop(this.id));
  }

  get traceRunning(): boolean { return this.tracer.running; }

  /** Everything a first look needs, gathered once: what the page IS, what it complained about, what it
   *  failed to load, and how heavy it is. Composed from the same collectors the individual tools read, so
   *  the audit can never disagree with the tool a reader checks it against. */
  async audit(includeScreenshot: boolean, signal?: AbortSignal): Promise<{
    title: string; url: string;
    console: { entries: ConsoleEntry[]; dropped: number; buffered: number };
    network: ReturnType<PageDiagnostics['networkEntries']>;
    metrics: PerformanceMetrics;
    image?: CapturedImage;
  }> {
    return this.runAgentOperation(signal, async () => {
      const snapshot = await this.ensureSnapshot();
      return {
        title: snapshot.title,
        url: snapshot.url,
        console: this.diagnostics.consoleEntries({ levels: ['error', 'warning'], limit: 10 }),
        network: this.diagnostics.networkEntries({ filter: 'errors', limit: 10 }),
        metrics: await capturePerformanceMetrics(this.cdp),
        ...(includeScreenshot
          ? { image: await captureViewport(this.cdp, 'jpeg', SCREENSHOT_JPEG_QUALITY) }
          : {}),
      };
    });
  }

  async tabs(): Promise<BrowserTabInfo[]> {
    // A read for the session panel, deliberately OFF the serial queue: it does no page work, and
    // queued behind one it made GET /session hang for as long as a stuck input or navigation held
    // the queue — in production, until the takeover lease expired.
    this.assertOpen();
    return withDeadline(this.deps.tabs.list(this.id), 2_000, 'Browser tab list did not answer in time.');
  }

  async agentTabs(signal?: AbortSignal): Promise<BrowserTabInfo[]> {
    return this.runAgentOperation(signal, () => this.deps.tabs.list(this.id));
  }

  async selectTab(tabId: string, signal?: AbortSignal): Promise<AccessibilitySnapshot> {
    return this.agentMutation(signal, async () => {
      const page = this.deps.tabs.select(this.id, tabId);
      await this.attachPage(page);
      this.emit({ kind: 'tab', data: { action: 'select', tabId } });
      return this.finishMutation('Selected another browser tab');
    });
  }

  async closeTab(tabId: string, signal?: AbortSignal): Promise<AccessibilitySnapshot> {
    return this.agentMutation(signal, async () => {
      if ((await this.deps.tabs.list(this.id)).length <= 1) throw new Error('Use BrowserClose to close the last tab in a browser session.');
      await this.deps.tabs.closeTab(this.id, tabId);
      const active = this.deps.tabs.activePage(this.id);
      if (!active) throw new Error('The browser session has no active tab.');
      await this.attachPage(active);
      this.emit({ kind: 'tab', data: { action: 'close', tabId } });
      return this.finishMutation('Closed a browser tab');
    });
  }

  /** Hand the session to the person asking for it, NOW.
   *
   *  This deliberately does not enter the serial queue. Claiming control changes session state; it
   *  performs no browser I/O, and queueing it behind an agent operation meant a click during a 30s
   *  `page.goto` left the request hanging for as long as that navigation took — with nothing in the
   *  HTTP path to bound it. The agent operation already in flight is unaffected: every agent turn
   *  re-checks `stateValue` inside the queue and steps aside once it sees `user`. */
  async claimTakeover(): Promise<{ leaseId: string; expiresAt: number; controlRevision: number }> {
    this.assertOpen();
    if (this.lease && this.lease.expiresAt > this.deps.clock.now()) throw new Error('Browser is already under user control.');
    const now = this.deps.clock.now();
    const controlRevision = ++this.controlRevisionValue;
    this.controlReasonValue = null;
    this.lease = {
      leaseId: randomBytes(24).toString('base64url'),
      claimedAt: now,
      expiresAt: Math.min(now + this.deps.config().takeoverLeaseMs, this.hardExpiresAt),
    };
    this.stateValue = 'user';
    this.scheduleLeaseExpiry();
    this.deps.logger.info(`browser session ${this.id} control → user (revision ${controlRevision}, lease until ${new Date(this.lease.expiresAt).toISOString()})`);
    this.touch('User took control');
    this.persist({ state: 'user' });
    // The lease id is returned only to the claimant. Broadcasting it would let an older modal adopt and
    // release a newer claim, defeating the generation guarantee the opaque token exists to provide.
    this.emit({ kind: 'control', data: { state: 'user', expiresAt: this.lease.expiresAt, controlRevision } });
    // The artifact is a cosmetic projection. Awaiting it here would put page I/O back on the path that
    // must stay instant, so it runs beside the claim and can only ever be late, never blocking.
    void this.updateArtifact().catch(() => {});
    return { leaseId: this.lease.leaseId, expiresAt: this.lease.expiresAt, controlRevision };
  }

  async heartbeat(leaseId: string): Promise<{ expiresAt: number; controlRevision: number }> {
    // Navigation deliberately owns the serial queue until Chrome settles. A heartbeat is only a lease
    // renewal and must not wait behind that network operation, or a slow page can expire its own driver.
    const lease = this.requireLease(leaseId);
    lease.expiresAt = Math.min(this.deps.clock.now() + this.deps.config().takeoverLeaseMs, this.hardExpiresAt);
    this.scheduleLeaseExpiry();
    this.touch();
    return { expiresAt: lease.expiresAt, controlRevision: this.controlRevisionValue };
  }

  async releaseTakeover(leaseId: string): Promise<void> {
    // Off the queue for the same reason as the claim: giving control back is how a person escapes a
    // session whose queue is held by something that is not answering.
    this.requireLease(leaseId);
    await this.returnToAgent('released');
  }

  async requestTakeoverForAgent(signal?: AbortSignal): Promise<AccessibilitySnapshot> {
    if (this.stateValue === 'user') {
      await this.waitForAgent(signal);
      return (await this.snapshot(false, signal)).snapshot;
    }
    this.assertOpen();
    this.touch('Waiting for user control');
    this.controlReasonValue = 'requested';
    const controlRevision = ++this.controlRevisionValue;
    this.emit({ kind: 'control', data: { state: 'agent', reason: this.controlReasonValue, controlRevision } });
    const released = this.waitForTakeoverRelease(signal);
    void released.catch(() => {});
    try {
      await this.updateArtifact();
      await released;
      return (await this.snapshot(false, signal)).snapshot;
    } catch (error) {
      this.rejectTakeoverWaiters(error);
      await this.queue.run(async () => {
        if (this.stateValue === 'user' && this.lease) await this.returnToAgent('aborted');
        else if (this.stateValue === 'agent') {
          this.touch('Takeover request cancelled');
          this.controlReasonValue = 'cancelled';
          const controlRevision = ++this.controlRevisionValue;
          this.emit({ kind: 'control', data: { state: 'agent', reason: this.controlReasonValue, controlRevision } });
          await this.updateArtifact();
        }
      });
      throw error;
    }
  }

  /** A person driving this session does not pass through here.
   *
   *  Their pointer and keyboard reach Chrome as native X input through the VNC server, so there is no
   *  batch to deliver, no coordinate to map onto a viewport, and no "the page moved under you" case to
   *  report: input lands on whatever the window actually shows, exactly as it does on a desktop. What a
   *  lease still governs is whether the transport forwards those RFB messages at all.
   *
   *  The back, forward and reload controls below stay, because they are the card's own buttons rather
   *  than something the person pressed inside the page. */
  dispatchUserNavigation(leaseId: string, action: 'back' | 'forward' | 'reload'): Promise<void> {
    return this.queue.run(async () => {
      this.requireLease(leaseId);
      const options = { waitUntil: 'domcontentloaded', timeout: 30_000 };
      const beforeUrl = this.page.url();
      const beforeLoader = await this.mainFrameLoaderId();
      let navigationError: unknown = null;
      try {
        if (action === 'back') {
          if (!this.page.goBack) throw new Error('Browser history navigation is unavailable.');
          await this.page.goBack(options);
        } else if (action === 'forward') {
          if (!this.page.goForward) throw new Error('Browser history navigation is unavailable.');
          await this.page.goForward(options);
        } else {
          if (!this.page.reload) throw new Error('Browser page reload is unavailable.');
          await this.page.reload(options);
        }
      } catch (error) {
        navigationError = error;
      }
      let afterLoader = await this.mainFrameLoaderId();
      let committed = this.page.url() !== beforeUrl || (!!beforeLoader && !!afterLoader && beforeLoader !== afterLoader);
      if (navigationError && !committed) {
        // Puppeteer's timeout does not cancel the renderer navigation. Stop it before reporting failure,
        // then re-check the committed document after Chrome acknowledges the cancellation.
        if (!await this.stopLoading()) {
          this.recycleBrowser('navigation cancellation could not be confirmed', 'navigation_state_unknown');
          throw new Error('Browser navigation state is unknown; the browser is being recycled.');
        }
        afterLoader = await this.mainFrameLoaderId();
        committed = this.page.url() !== beforeUrl || (!!beforeLoader && !!afterLoader && beforeLoader !== afterLoader);
      }
      if (navigationError && !committed) {
        this.snapshotValue = null;
        this.touch();
        throw navigationError;
      }
      await this.finishMutation(action === 'reload' ? 'Reloaded the page' : `Navigated ${action}`);
    });
  }

  async subscribeEvents(id: string, send: (event: BrowserActionEvent) => Promise<void>): Promise<() => void> {
    if (this.listeners.has(id)) throw new Error('Browser event subscriber already exists.');
    this.listeners.set(id, send);
    return () => { this.listeners.delete(id); };
  }

  viewerActivity(): void {
    if (this.stateValue !== 'closing' && this.stateValue !== 'closed' && this.stateValue !== 'error') this.touch();
  }

  close(reason = 'closed'): Promise<void> {
    if (this.closedPromise) return this.closedPromise;
    // Mark the intent SYNCHRONOUSLY. The drain below is bounded and teardown proceeds without the
    // queue, so anything queued from this moment on must already fail `assertOpen` rather than reach a
    // page that is being detached.
    if (this.stateValue !== 'closed') this.stateValue = 'closing';
    this.closedPromise = this.closeSession(reason);
    return this.closedPromise;
  }

  /** Tear the session down, waiting only briefly for an orderly turn.
   *
   *  A close that queues unconditionally cannot end a session whose queue is held by a CDP call that
   *  never settles — and that is the one case where closing is the only remaining recovery. So the
   *  orderly slot is requested with a deadline, and teardown proceeds either way. */
  private async closeSession(reason: string): Promise<void> {
    await withDeadline(this.queue.run(async () => {}), 5_000, 'queue drain timed out').catch(() => {});
    return (async () => {
      if (this.stateValue === 'closed') return;
      this.stateValue = 'closing';
      this.persist({ state: 'closing' });
      this.clearLeaseTimer();
      this.clearHardExpiryTimer();
      const closeError = new Error(`Browser session closed: ${reason}`);
      this.rejectWaiters(closeError);
      this.rejectTakeoverWaiters(closeError);
      this.emit({ kind: 'closed', data: { reason } });
      try {
        // Teardown talks to a browser that may already be unresponsive — that is often WHY we are
        // closing — so it is bounded and best effort. The `finally` below is what must always run.
        await withDeadline((async () => {
        // Order matters: end the trace while the CDP session can still carry the command, then drop
        // every listener, then detach. A trace left running would hold the account's process-wide lock
        // with no session left to stop it.
        //
        // The outcome is deliberately not read here. A close has nothing left to decide: an 'unknown'
        // has already tainted the lock and asked for the process to be recycled, and turning that into a
        // failure would abort the rest of THIS teardown — the listeners, the page — over a recovery that
        // is already under way.
        await this.tracer.abandon();
        this.tracer.detach();
        this.diagnostics.close();
        this.disposeCdpListeners();
        this.listeners.clear();
        await this.cdp.detach?.().catch(() => {});
        await this.deps.releasePage();
      })(), 10_000, 'Browser teardown timed out.');
      } catch (error) {
        this.deps.logger.warn(`browser session ${this.id} teardown was incomplete: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        this.stateValue = reason === 'browser_error' ? 'error' : 'closed';
        const now = this.deps.clock.now();
        this.deps.store.updateSession(this.id, {
          state: this.stateValue, updatedAt: now, lastActivityAt: now, closedAt: now, closeReason: reason,
        });
        this.deps.onClosed(this.id);
        if (this.artifactRef) await this.deps.artifacts.close(this.artifactRef).catch(() => {});
      }
    })();
  }

  private async attachPage(page: PageLike): Promise<void> {
    const nextCdp = await page.createCDPSession();
    const onDialog = (raw: unknown): void => {
      const type = (raw as { type?: unknown }).type;
      // Navigation requested by the agent must pass beforeunload; no browser tool can answer other dialogs.
      void nextCdp.send('Page.handleJavaScriptDialog', { accept: type === 'beforeunload' }).catch(() => {});
    };
    nextCdp.on('Page.javascriptDialogOpening', onDialog);
    // Held so the switch below, and the close above, can take it back off. A handler kept on a CDP
    // session the session no longer uses is the one reference that stops the old tab being collected.
    const disposeDialog = () => nextCdp.off('Page.javascriptDialogOpening', onDialog);
    // Undo for everything already moved onto the new session, newest first. A tab switch touches several
    // subsystems in sequence and any of them can fail against a target that is already going away; a
    // half-switched session — the input controller on the new tab, the collector on neither, dialogs
    // answered twice — is worse than a switch that simply did not happen, because nothing afterwards can
    // tell.
    const previousCdp: CDPSessionLike | undefined = this.cdp;
    const undo: (() => void | Promise<void>)[] = [disposeDialog];
    try {
      await Promise.all([
        nextCdp.send('Accessibility.enable'),
        nextCdp.send('DOM.enable'),
        nextCdp.send('Page.enable'),
        nextCdp.send('Browser.setDownloadBehavior', { behavior: 'deny' }),
      ]);
      if (previousCdp) {
        // A trace records the browser, but it was started from the tab that is going away and stopped
        // through its session. Ending it here costs a measurement nobody can collect any more; leaving it
        // running would hold the process-wide lock against every other tab until the session closes.
        //
        // An abandon that could not establish what Chrome is doing has already condemned this browser
        // process and asked for it to be recycled. Carrying on with the switch would move the input
        // controller and the collector onto a tab of a browser that is being closed underneath them —
        // so the switch stops here and unwinds, and the caller is told why.
        if (await this.tracer.abandon() === 'unknown') {
          throw new Error('The browser is being recycled because its tracing state could not be established.');
        }
        // Every undo goes on the stack BEFORE the step that needs it. `replaceCdp` mutates the subsystem
        // it is called on, so registering the restore afterwards leaves the one window where that
        // subsystem is already on the new tab with nothing recorded to put it back.
        undo.push(() => this.input.replaceCdp(previousCdp));
        this.input.replaceCdp(nextCdp);
        // The collector rebinds to the new session BEFORE the old is detached: unsubscribing from a
        // detached session is a silent no-op in some CDP transports, and the listeners would survive as
        // the only thing still holding the old session alive.
        undo.push(() => this.diagnostics.rebind(previousCdp));
        await this.diagnostics.attach(nextCdp);
        // Past this point nothing awaits and nothing throws: the tracer swap is two listener calls, and
        // the detach below already swallows its own failure. A commit that cannot fail halfway is what
        // lets the collector's own commit be the last risky step of the switch.
        undo.push(() => this.tracer.attach(previousCdp));
        this.tracer.attach(nextCdp);
        this.disposeCdpListeners();
        await previousCdp.detach?.().catch(() => {});
      } else {
        this.input = new InputController(
          nextCdp,
          // The FRAMEBUFFER, which the page is drawn inside but is not the same as. It is used only to
          // pick a point that is certainly within the page and to bound a scroll delta, and the display
          // is always at least as large as the page, so both hold. Anything that needs the page's real
          // box — every screenshot, every element clip — asks Chrome for its layout metrics instead.
          () => ({ width: this.deps.config().maxViewportWidth, height: this.deps.config().viewportHeight }),
          (event) => this.emit(event),
        );
        undo.push(() => this.diagnostics.detach());
        await this.diagnostics.attach(nextCdp);
        undo.push(() => this.tracer.detach());
        this.tracer.attach(nextCdp);
      }
    } catch (error) {
      for (const step of undo.reverse()) await Promise.resolve().then(step).catch(() => {});
      await nextCdp.detach?.().catch(() => {});
      throw error;
    }
    this.page = page;
    this.cdp = nextCdp;
    this.disposeCdpListeners = disposeDialog;
    this.snapshotValue = null;
    this.faviconPageUrl = null;
    this.faviconDataUrl = null;
    this.faviconGeneration += 1;
  }

  private agentMutation<T>(signal: AbortSignal | undefined, operation: () => Promise<T>): Promise<T> {
    return this.runAgentOperation(signal, operation);
  }

  private async runAgentOperation<T>(signal: AbortSignal | undefined, operation: () => Promise<T>): Promise<T> {
    while (true) {
      await this.waitForAgent(signal);
      const result = await this.queue.run(async () => {
        this.assertOpen();
        if (this.stateValue === 'user') return { retry: true as const };
        return { retry: false as const, value: await this.runBoundedOperation(operation) };
      });
      if (!result.retry) return result.value;
    }
  }

  private async runBoundedOperation<T>(operation: () => Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | null = null;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Browser operation exceeded its 45 second safety deadline.')), 45_000);
      timer.unref();
    });
    try {
      return await Promise.race([operation(), timeout]);
    } catch (error) {
      if (error instanceof Error && error.message.includes('45 second safety deadline')) {
        this.stateValue = 'error';
        this.persist({ state: 'error' });
        void this.deps.forceCloseBrowser().finally(() => { void this.close('operation_timeout'); });
      }
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Throw this browser process away, because something about it can no longer be established.
   *
   *  Used when tracing state becomes unknown: Chrome may still be recording a trace nobody holds, or
   *  holding a stream nobody can close, and there is no command that answers "are you?". Recycling the
   *  process is the only thing that makes the answer knowable again — the same recovery the 45 second
   *  operation deadline already takes, for the same reason. Fire and forget: the caller is a teardown
   *  path or a failing tool, and neither can wait for a browser to die. */
  private recycleBrowser(reason: string, closeReason = 'trace_state_unknown'): void {
    this.deps.logger.warn(`browser session ${this.id} is being recycled: ${reason}`);
    // The process is closed even when this session is ALREADY ending: the Chrome process outlives its
    // sessions — the pool keeps it for the account's other tabs and for the close grace window — so a
    // session that discovers the unknown state on its way out is still the only one in a position to say
    // that this browser must not be reused. Only the session-level bookkeeping is skipped.
    const alreadyEnding = this.stateValue === 'closing' || this.stateValue === 'closed' || this.stateValue === 'error';
    if (!alreadyEnding) {
      this.stateValue = 'error';
      this.persist({ state: 'error' });
    }
    void this.deps.forceCloseBrowser().finally(() => {
      if (!alreadyEnding) void this.close(closeReason);
    });
  }

  private waitForTakeoverRelease(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(signal.reason ?? new Error('Browser takeover request aborted.'));
    return new Promise<void>((resolve, reject) => {
      const waiter: AgentWaiter = { resolve, reject, signal };
      if (signal) {
        waiter.abort = () => {
          this.takeoverWaiters.delete(waiter);
          reject(signal.reason ?? new Error('Browser takeover request aborted.'));
        };
        signal.addEventListener('abort', waiter.abort, { once: true });
      }
      this.takeoverWaiters.add(waiter);
    });
  }

  private waitForAgent(signal?: AbortSignal): Promise<void> {
    if (this.stateValue !== 'user') return Promise.resolve();
    // An abort that already fired never emits its event again, so parking on it here waited forever.
    // The retry loop in runAgentOperation reaches this a SECOND time after a takeover, which is exactly
    // when a cancelled turn arrives — the path that left a tool hanging with no deadline above it.
    if (signal?.aborted) return Promise.reject(signal.reason ?? new Error('Browser action aborted while waiting for user control.'));
    return new Promise<void>((resolve, reject) => {
      const waiter: AgentWaiter = { resolve, reject, signal };
      if (signal) {
        waiter.abort = () => {
          this.waiters.delete(waiter);
          reject(signal.reason ?? new Error('Browser action aborted while waiting for user control.'));
        };
        signal.addEventListener('abort', waiter.abort, { once: true });
      }
      this.waiters.add(waiter);
    });
  }

  private resolveWaiters(): void {
    for (const waiter of this.waiters) {
      if (waiter.abort && waiter.signal) waiter.signal.removeEventListener('abort', waiter.abort);
      waiter.resolve();
    }
    this.waiters.clear();
  }

  private rejectWaiters(error: unknown): void {
    for (const waiter of this.waiters) {
      if (waiter.abort && waiter.signal) waiter.signal.removeEventListener('abort', waiter.abort);
      waiter.reject(error);
    }
    this.waiters.clear();
  }

  private resolveTakeoverWaiters(): void {
    for (const waiter of this.takeoverWaiters) {
      if (waiter.abort && waiter.signal) waiter.signal.removeEventListener('abort', waiter.abort);
      waiter.resolve();
    }
    this.takeoverWaiters.clear();
  }

  private rejectTakeoverWaiters(error: unknown): void {
    for (const waiter of this.takeoverWaiters) {
      if (waiter.abort && waiter.signal) waiter.signal.removeEventListener('abort', waiter.abort);
      waiter.reject(error);
    }
    this.takeoverWaiters.clear();
  }

  private requireLease(leaseId: string): ControlLease {
    this.assertOpen();
    const lease = this.lease;
    if (!lease || this.stateValue !== 'user' || lease.leaseId !== leaseId) throw new Error('Browser control lease is stale or invalid.');
    if (lease.expiresAt <= this.deps.clock.now()) throw new Error('Browser control lease has expired.');
    return lease;
  }

  private async returnToAgent(reason: string): Promise<void> {
    const controlRevision = ++this.controlRevisionValue;
    this.controlReasonValue = reason;
    this.lease = null;
    this.clearLeaseTimer();
    this.snapshotValue = null;
    if (this.stateValue !== 'closing' && this.stateValue !== 'closed' && this.stateValue !== 'error') this.stateValue = 'agent';
    this.persist({ state: this.stateValue });
    this.deps.logger.info(`browser session ${this.id} control → agent (${reason}, revision ${controlRevision})`);
    this.resolveWaiters();
    this.resolveTakeoverWaiters();
    this.emit({ kind: 'control', data: { state: 'agent', reason, controlRevision } });
    await this.updateArtifact();
  }

  private scheduleLeaseExpiry(): void {
    this.clearLeaseTimer();
    const leaseId = this.lease?.leaseId;
    if (!leaseId) return;
    const delay = Math.max(0, this.lease!.expiresAt - this.deps.clock.now());
    this.leaseTimer = setTimeout(() => {
      // Expiry returns an abandoned session to the agent. Running it through the serial queue made the
      // recovery depend on the queue draining — precisely what fails when a session is stuck.
      if (this.lease?.leaseId !== leaseId) return;
      if (this.lease.expiresAt <= this.deps.clock.now()) void this.returnToAgent('expired').catch(() => {});
      else this.scheduleLeaseExpiry();
    }, delay);
    this.leaseTimer.unref();
  }

  private clearLeaseTimer(): void {
    if (this.leaseTimer) clearTimeout(this.leaseTimer);
    this.leaseTimer = null;
  }

  private scheduleHardExpiry(): void {
    const delay = Math.max(0, this.hardExpiresAt - this.deps.clock.now());
    this.hardExpiryTimer = setTimeout(() => {
      void this.deps.forceCloseBrowser().finally(() => { void this.close('hard_expiry'); });
    }, delay);
    this.hardExpiryTimer.unref();
  }

  private clearHardExpiryTimer(): void {
    if (this.hardExpiryTimer) clearTimeout(this.hardExpiryTimer);
    this.hardExpiryTimer = null;
  }

  private async stopLoading(): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      return await Promise.race([
        this.cdp.send('Page.stopLoading').then(() => true).catch(() => false),
        new Promise<false>((resolve) => {
          timer = setTimeout(() => resolve(false), 1_000);
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async mainFrameLoaderId(): Promise<string | null> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      const tree = await Promise.race([
        this.cdp.send<{ frameTree?: { frame?: { loaderId?: string } } }>('Page.getFrameTree').catch(() => ({ frameTree: undefined })),
        new Promise<{ frameTree?: undefined }>((resolve) => {
          timer = setTimeout(() => resolve({ frameTree: undefined }), 1_000);
          timer.unref?.();
        }),
      ]);
      return typeof tree.frameTree?.frame?.loaderId === 'string' ? tree.frameTree.frame.loaderId : null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async captureSnapshot(): Promise<AccessibilitySnapshot> {
    const snapshot = await captureAccessibilitySnapshot(this.cdp, this.page, { now: this.deps.clock.now() });
    this.snapshotValue = snapshot;
    this.touch();
    await this.updateArtifact(snapshot);
    return snapshot;
  }

  private ensureSnapshot(): Promise<AccessibilitySnapshot> {
    return this.snapshotValue ? Promise.resolve(this.snapshotValue) : this.captureSnapshot();
  }

  private async finishMutation(action: string): Promise<AccessibilitySnapshot> {
    this.snapshotValue = null;
    this.touch(action);
    return this.captureSnapshot();
  }

  private touch(action?: string): void {
    this.lastActivityAt = this.deps.clock.now();
    if (action) this.lastAction = action;
    this.persist({ lastActivityAt: this.lastActivityAt });
  }

  private persist(patch: { state?: BrowserSessionState; artifactRef?: string | null; lastActivityAt?: number }): void {
    this.deps.store.updateSession(this.id, { ...patch, updatedAt: this.deps.clock.now() });
  }

  private async updateArtifact(snapshot = this.snapshotValue): Promise<void> {
    if (!this.artifactRef) return;
    const url = snapshot?.url ?? this.page.url();
    const title = snapshot?.title ?? await withDeadline(this.page.title(), 2_000, 'title read timed out').catch(() => '');
    let refreshFavicon = false;
    if (this.faviconPageUrl !== url) {
      this.faviconPageUrl = url;
      this.faviconDataUrl = null;
      this.emit({ kind: 'favicon', data: { favicon: null } });
      this.faviconGeneration += 1;
      refreshFavicon = true;
    }
    try {
      await this.deps.artifacts.update(this.artifactRef, artifactData({
        browserSessionId: this.id,
        state: this.stateValue,
        title,
        url,
        favicon: this.faviconDataUrl,
        lastAction: this.lastAction,
      }));
    } catch (error) {
      this.deps.logger.warn(`browser artifact update failed for session ${this.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (refreshFavicon) this.refreshFavicon(url, this.faviconGeneration, this.cdp);
  }

  /** Favicon discovery is cosmetic. It never holds an agent/user operation, and a result from a page or
   *  CDP session that has since moved on cannot overwrite the current page's identity. */
  private refreshFavicon(url: string, generation: number, cdp: CDPSessionLike): void {
    void readPageFavicon(cdp).then(async (favicon) => {
      if (!favicon || generation !== this.faviconGeneration || cdp !== this.cdp || this.page.url() !== url) return;
      if (this.stateValue === 'closing' || this.stateValue === 'closed' || this.stateValue === 'error') return;
      const ref = this.artifactRef;
      if (!ref) return;
      this.faviconDataUrl = favicon;
      this.emit({ kind: 'favicon', data: { favicon } });
      await this.deps.artifacts.update(ref, artifactData({
        browserSessionId: this.id,
        state: this.stateValue,
        title: await this.page.title().catch(() => ''),
        url,
        favicon,
        lastAction: this.lastAction,
      }));
    }).catch(() => {});
  }

  private emit(event: BrowserActionEvent): void {
    for (const listener of this.listeners.values()) void listener(event).catch(() => {});
  }

  private assertOpen(): void {
    if (this.stateValue === 'closing' || this.stateValue === 'closed' || this.stateValue === 'error') {
      throw new Error('Browser session is closed.');
    }
    if (this.page.isClosed?.()) throw new Error('Browser page is closed.');
  }
}
