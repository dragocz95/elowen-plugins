import { randomBytes } from 'node:crypto';
import { captureAccessibilitySnapshot, captureModelScreenshot } from './accessibility.js';
import { artifactData, serializeArtifactRef } from './artifact.js';
import type { BrowserConfig } from './config.js';
import { InputController, InputRateLimiter, type UserInputEvent } from './input-controller.js';
import { NavigationPolicy } from './navigation-policy.js';
import { ScreencastHub, StreamBudget } from './screencast-hub.js';
import { BrowserStore } from './store.js';
import type { TabManager } from './tab-manager.js';
import type {
  AccessibilitySnapshot, BrowserActionEvent, BrowserArtifactPublisher, BrowserArtifactRef, BrowserClock,
  BrowserLogger, BrowserSessionState, BrowserTabInfo, CDPSessionLike, PageLike, ScreencastFrame,
} from './types.js';

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
  streamBudget: StreamBudget;
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
  private readonly listeners = new Map<string, (event: BrowserActionEvent) => Promise<void>>();
  private lease: ControlLease | null = null;
  private leaseTimer: NodeJS.Timeout | null = null;
  private hardExpiryTimer: NodeJS.Timeout | null = null;
  private lastActivityAt: number;
  private lastAction: string | null = null;
  private snapshotValue: AccessibilitySnapshot | null = null;
  private artifactRef: BrowserArtifactRef | null;
  private screencast!: ScreencastHub;
  private input!: InputController;
  private closedPromise: Promise<void> | null = null;

  private constructor(private readonly deps: BrowserSessionDeps) {
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
      const screenshot = includeScreenshot ? await captureModelScreenshot(this.page) : undefined;
      return screenshot ? { snapshot, screenshot } : { snapshot };
    });
  }

  async navigate(url: string, signal?: AbortSignal): Promise<AccessibilitySnapshot> {
    return this.agentMutation(signal, async () => {
      const policy = new NavigationPolicy(this.deps.config().privateNetworkAllowlist);
      const validated = policy.validateUrl(url);
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

  async tabs(): Promise<BrowserTabInfo[]> {
    return this.queue.run(async () => { this.assertOpen(); return this.deps.tabs.list(this.id); });
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

  claimTakeover(): Promise<{ leaseId: string; expiresAt: number }> {
    return this.queue.run(async () => {
      this.assertOpen();
      if (this.lease && this.lease.expiresAt > this.deps.clock.now()) throw new Error('Browser is already under user control.');
      const now = this.deps.clock.now();
      this.lease = {
        leaseId: randomBytes(24).toString('base64url'),
        claimedAt: now,
        expiresAt: Math.min(now + this.deps.config().takeoverLeaseMs, this.hardExpiresAt),
      };
      this.stateValue = 'user';
      this.scheduleLeaseExpiry();
      this.touch('User took control');
      this.persist({ state: 'user' });
      // The lease id is returned only to the claimant. Broadcasting it would let an older modal adopt and
      // release a newer claim, defeating the generation guarantee the opaque token exists to provide.
      this.emit({ kind: 'control', data: { state: 'user', expiresAt: this.lease.expiresAt } });
      await this.updateArtifact();
      return { leaseId: this.lease.leaseId, expiresAt: this.lease.expiresAt };
    });
  }

  heartbeat(leaseId: string): Promise<{ expiresAt: number }> {
    return this.queue.run(async () => {
      const lease = this.requireLease(leaseId);
      lease.expiresAt = Math.min(this.deps.clock.now() + this.deps.config().takeoverLeaseMs, this.hardExpiresAt);
      this.scheduleLeaseExpiry();
      this.touch();
      return { expiresAt: lease.expiresAt };
    });
  }

  releaseTakeover(leaseId: string): Promise<void> {
    return this.queue.run(async () => { this.requireLease(leaseId); await this.returnToAgent('released'); });
  }

  async requestTakeoverForAgent(signal?: AbortSignal): Promise<AccessibilitySnapshot> {
    if (this.stateValue === 'user') {
      await this.waitForAgent(signal);
      return (await this.snapshot(false, signal)).snapshot;
    }
    const claimed = await this.claimTakeover();
    try {
      await this.waitForAgent(signal);
      return (await this.snapshot(false, signal)).snapshot;
    } catch (error) {
      await this.queue.run(async () => {
        if (this.lease?.leaseId === claimed.leaseId) await this.returnToAgent('aborted');
      });
      throw error;
    }
  }

  dispatchUserInput(leaseId: string, events: readonly UserInputEvent[]): Promise<void> {
    return this.queue.run(async () => {
      this.requireLease(leaseId);
      await this.input.dispatchUserBatch(events);
      this.snapshotValue = null;
      this.touch('User input');
    });
  }

  async subscribeEvents(id: string, send: (event: BrowserActionEvent) => Promise<void>): Promise<() => void> {
    if (this.listeners.has(id)) throw new Error('Browser event subscriber already exists.');
    this.listeners.set(id, send);
    return () => { this.listeners.delete(id); };
  }

  subscribeFrames(id: string, send: (frame: ScreencastFrame) => Promise<void>): Promise<() => Promise<void>> {
    this.viewerActivity();
    return this.screencast.subscribe(id, send);
  }

  viewerActivity(): void {
    if (this.stateValue !== 'closing' && this.stateValue !== 'closed' && this.stateValue !== 'error') this.touch();
  }

  close(reason = 'closed'): Promise<void> {
    if (this.closedPromise) return this.closedPromise;
    this.closedPromise = this.queue.run(async () => {
      if (this.stateValue === 'closed') return;
      this.stateValue = 'closing';
      this.persist({ state: 'closing' });
      this.clearLeaseTimer();
      this.clearHardExpiryTimer();
      this.rejectWaiters(new Error(`Browser session closed: ${reason}`));
      this.emit({ kind: 'closed', data: { reason } });
      try {
        await this.screencast.close();
        this.listeners.clear();
        await this.cdp.detach?.().catch(() => {});
        await this.deps.releasePage();
      } finally {
        this.stateValue = reason === 'browser_error' ? 'error' : 'closed';
        const now = this.deps.clock.now();
        this.deps.store.updateSession(this.id, {
          state: this.stateValue, updatedAt: now, lastActivityAt: now, closedAt: now, closeReason: reason,
        });
        this.deps.onClosed(this.id);
        if (this.artifactRef) await this.deps.artifacts.close(this.artifactRef).catch(() => {});
      }
    });
    return this.closedPromise;
  }

  private async attachPage(page: PageLike): Promise<void> {
    const nextCdp = await page.createCDPSession();
    nextCdp.on('Page.javascriptDialogOpening', (raw) => {
      const type = (raw as { type?: unknown }).type;
      // Navigation requested by the agent must pass beforeunload; no browser tool can answer other dialogs.
      void nextCdp.send('Page.handleJavaScriptDialog', { accept: type === 'beforeunload' }).catch(() => {});
    });
    await Promise.all([
      nextCdp.send('Accessibility.enable'),
      nextCdp.send('DOM.enable'),
      nextCdp.send('Page.enable'),
      nextCdp.send('Browser.setDownloadBehavior', { behavior: 'deny' }),
    ]);
    if (this.cdp) {
      await this.screencast.replaceCdp(nextCdp);
      this.input.replaceCdp(nextCdp);
      await this.cdp.detach?.().catch(() => {});
    } else {
      this.screencast = new ScreencastHub(nextCdp, this.deps.config, this.deps.streamBudget, this.deps.logger);
      this.input = new InputController(
        nextCdp,
        () => ({ width: this.deps.config().maxViewportWidth, height: this.deps.config().viewportHeight }),
        (event) => this.emit(event),
        new InputRateLimiter(() => this.deps.config().maxInputEventsPerSecond, () => this.deps.clock.now()),
      );
    }
    this.page = page;
    this.cdp = nextCdp;
    this.snapshotValue = null;
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

  private waitForAgent(signal?: AbortSignal): Promise<void> {
    if (this.stateValue !== 'user') return Promise.resolve();
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

  private requireLease(leaseId: string): ControlLease {
    this.assertOpen();
    const lease = this.lease;
    if (!lease || this.stateValue !== 'user' || lease.leaseId !== leaseId) throw new Error('Browser control lease is stale or invalid.');
    if (lease.expiresAt <= this.deps.clock.now()) throw new Error('Browser control lease has expired.');
    return lease;
  }

  private async returnToAgent(reason: string): Promise<void> {
    this.lease = null;
    this.clearLeaseTimer();
    this.snapshotValue = null;
    if (this.stateValue !== 'closing' && this.stateValue !== 'closed' && this.stateValue !== 'error') this.stateValue = 'agent';
    this.persist({ state: this.stateValue });
    this.resolveWaiters();
    this.emit({ kind: 'control', data: { state: 'agent', reason } });
    await this.updateArtifact();
  }

  private scheduleLeaseExpiry(): void {
    this.clearLeaseTimer();
    const leaseId = this.lease?.leaseId;
    if (!leaseId) return;
    const delay = Math.max(0, this.lease!.expiresAt - this.deps.clock.now());
    this.leaseTimer = setTimeout(() => {
      void this.queue.run(async () => {
        if (this.lease?.leaseId === leaseId) await this.returnToAgent('expired');
      });
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
    await this.deps.artifacts.update(this.artifactRef, artifactData({
      browserSessionId: this.id,
      state: this.stateValue,
      title: snapshot?.title ?? await this.page.title().catch(() => ''),
      url: snapshot?.url ?? this.page.url(),
      lastAction: this.lastAction,
    }));
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
