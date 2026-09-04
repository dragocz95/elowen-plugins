import { randomBytes } from 'node:crypto';
import type { BrowserLike, BrowserLogger, BrowserTabInfo, BrowserTargetLike, PageLike } from './types.js';

interface TabEntry {
  id: string;
  sessionId: string;
  targetId: string;
  openerTargetId: string | null;
  page: PageLike;
  createdAt: number;
  active: boolean;
}

const targetIdOf = (target: BrowserTargetLike | undefined): string => {
  if (!target) return randomBytes(12).toString('base64url');
  const exposed = target.targetId?.();
  if (exposed) return exposed;
  const internal = (target as BrowserTargetLike & { _targetId?: string })._targetId;
  return internal || randomBytes(12).toString('base64url');
};

export class TabManager {
  private readonly tabs = new Map<string, TabEntry>();
  private readonly targetIds = new Set<string>();
  private readonly unownedTimers = new Map<string, NodeJS.Timeout>();
  /** Monotonic ordering of "which session was driven last", used to place a tab a PERSON opened. A
   *  counter rather than a clock: two sessions touched in the same millisecond must still have an order. */
  private readonly sessionActivity = new Map<string, number>();
  private activityTick = 0;
  /** The session whose lease a person currently holds, if any. A tab opened by hand belongs to whoever
   *  is driving, so this outranks mere recency. */
  private userControlSessionId: string | null = null;
  /** How many session primaries are being opened right now. Chrome announces the target before
   *  `registerPrimary` can claim it, and adopting in that window would file a new session's own first
   *  page under the session that happened to be active. */
  private pendingPrimaries = 0;
  private readonly onCreated = (target: BrowserTargetLike): void => { void this.targetCreated(target); };
  private readonly onDestroyed = (target: BrowserTargetLike): void => { this.targetDestroyed(target); };

  constructor(
    private readonly browser: BrowserLike,
    private readonly maxTargets: () => number,
    private readonly logger: BrowserLogger,
    private readonly preparePage: (page: PageLike) => Promise<void> = async () => {},
    private readonly onUnclosableOverflow: () => Promise<void> = async () => {},
  ) {
    for (const target of browser.targets?.() ?? []) this.targetIds.add(targetIdOf(target));
    browser.on?.('targetcreated', this.onCreated);
    browser.on?.('targetdestroyed', this.onDestroyed);
  }

  /** Announce that a session primary is about to be opened, so the target it creates is not mistaken for
   *  a tab a person opened. Call the returned disposer once the page is registered — or once opening it
   *  has failed, which is why it is a disposer and not a second method. */
  expectPrimary(): () => void {
    this.pendingPrimaries += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.pendingPrimaries = Math.max(0, this.pendingPrimaries - 1);
    };
  }

  /** A person took this session over. Their next hand-opened tab belongs here rather than with whichever
   *  session the agent touched most recently. */
  markUserControl(sessionId: string): void {
    this.userControlSessionId = sessionId;
    this.touchSession(sessionId);
  }

  clearUserControl(sessionId: string): void {
    if (this.userControlSessionId === sessionId) this.userControlSessionId = null;
  }

  registerPrimary(sessionId: string, page: PageLike): string {
    const targetId = targetIdOf(page.target?.());
    const unownedTimer = this.unownedTimers.get(targetId);
    if (unownedTimer) clearTimeout(unownedTimer);
    this.unownedTimers.delete(targetId);
    this.targetIds.add(targetId);
    // One entry per target. Adoption and this claim race for the same page — Chrome announces the target
    // before the caller can register it — and two entries for one tab would list the same page twice and
    // leave a second, unclosable record behind when it goes.
    for (const [id, existing] of this.tabs) if (existing.targetId === targetId) this.tabs.delete(id);
    const tab: TabEntry = {
      id: randomBytes(16).toString('base64url'),
      sessionId,
      targetId,
      openerTargetId: null,
      page,
      createdAt: Date.now(),
      active: true,
    };
    for (const current of this.tabs.values()) if (current.sessionId === sessionId) current.active = false;
    this.tabs.set(tab.id, tab);
    this.touchSession(sessionId);
    return tab.id;
  }

  activePage(sessionId: string): PageLike | null {
    return [...this.tabs.values()].find((tab) => tab.sessionId === sessionId && tab.active)?.page ?? null;
  }

  async list(sessionId: string): Promise<BrowserTabInfo[]> {
    const entries = [...this.tabs.values()].filter((tab) => tab.sessionId === sessionId).sort((a, b) => a.createdAt - b.createdAt);
    return Promise.all(entries.map(async (tab) => ({
      id: tab.id,
      sessionId: tab.sessionId,
      targetId: tab.targetId,
      openerTargetId: tab.openerTargetId,
      title: await tab.page.title().catch(() => ''),
      url: tab.page.url(),
      active: tab.active,
    })));
  }

  select(sessionId: string, tabId: string): PageLike {
    const selected = this.tabs.get(tabId);
    if (!selected || selected.sessionId !== sessionId) throw new Error('Browser tab not found.');
    for (const tab of this.tabs.values()) if (tab.sessionId === sessionId) tab.active = tab.id === tabId;
    this.touchSession(sessionId);
    return selected.page;
  }

  async closeTab(sessionId: string, tabId: string): Promise<void> {
    const tab = this.tabs.get(tabId);
    if (!tab || tab.sessionId !== sessionId) throw new Error('Browser tab not found.');
    this.tabs.delete(tabId);
    this.targetIds.delete(tab.targetId);
    await tab.page.close().catch(() => {});
    const remaining = [...this.tabs.values()].filter((entry) => entry.sessionId === sessionId);
    if (remaining.length > 0 && !remaining.some((entry) => entry.active)) remaining[remaining.length - 1]!.active = true;
  }

  async closeSession(sessionId: string): Promise<void> {
    const ids = [...this.tabs.values()].filter((tab) => tab.sessionId === sessionId).map((tab) => tab.id);
    await Promise.allSettled(ids.map((id) => this.closeTab(sessionId, id)));
    this.clearUserControl(sessionId);
    this.sessionActivity.delete(sessionId);
  }

  targetCount(): number { return this.targetIds.size; }

  dispose(): void {
    this.browser.off?.('targetcreated', this.onCreated);
    this.browser.off?.('targetdestroyed', this.onDestroyed);
    for (const timer of this.unownedTimers.values()) clearTimeout(timer);
    this.unownedTimers.clear();
    this.tabs.clear();
    this.targetIds.clear();
    this.sessionActivity.clear();
    this.userControlSessionId = null;
  }

  private async targetCreated(target: BrowserTargetLike): Promise<void> {
    const targetId = targetIdOf(target);
    this.targetIds.add(targetId);
    const overLimit = (): boolean => this.targetIds.size > this.maxTargets();
    if (target.type() !== 'page') {
      if (!overLimit()) return;
      // A worker or other non-page target owns no tab, so there is nothing to evict in its place.
      await this.onUnclosableOverflow().catch(() => {});
      this.targetIds.delete(targetId);
      this.logger.warn('browser target limit reached on a non-page target; closed the account browser');
      return;
    }
    const openerTargetId = targetIdOf(target.opener?.() ?? undefined);
    const opener = [...this.tabs.values()].find((tab) => tab.targetId === openerTargetId);
    const page = await target.page().catch(() => null);
    if (!page) {
      if (!overLimit()) return;
      await this.onUnclosableOverflow().catch(() => {});
      this.targetIds.delete(targetId);
      this.logger.warn('browser target limit reached on a non-page target; closed the account browser');
      return;
    }
    try { await this.preparePage(page); }
    catch (error) {
      await page.close().catch(() => {});
      this.targetIds.delete(targetId);
      this.logger.warn(`browser could not prepare a new page target: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    // Chrome is a shared screen now, so a page target without an opener is usually a person pressing
    // Ctrl+T rather than a stray target: it belongs to whoever is driving this account's browser.
    const sessionId = opener?.sessionId ?? this.adoptionSessionId();
    if (overLimit() && !await this.evictOldestInactive(sessionId)) {
      await page.close().catch(() => {});
      this.targetIds.delete(targetId);
      this.logger.warn('browser target limit reached; closed the newest target');
      return;
    }
    if (sessionId === null) {
      const timer = setTimeout(() => {
        this.unownedTimers.delete(targetId);
        if ([...this.tabs.values()].some((tab) => tab.targetId === targetId)) return;
        void page.close().catch(() => {});
        this.targetIds.delete(targetId);
        this.logger.warn('browser opened an unowned page target with no live session to adopt it; it was closed');
      }, 5_000);
      timer.unref();
      this.unownedTimers.set(targetId, timer);
      return;
    }
    // The other side of the same race: a primary claimed while this ran already owns the target.
    if ([...this.tabs.values()].some((tab) => tab.targetId === targetId)) return;
    if (!opener) this.logger.info(`browser adopted a user-opened tab into session ${sessionId}`);
    const tab: TabEntry = {
      id: randomBytes(16).toString('base64url'),
      sessionId,
      targetId,
      openerTargetId: opener ? openerTargetId : null,
      page,
      createdAt: Date.now(),
      active: true,
    };
    for (const current of this.tabs.values()) if (current.sessionId === sessionId) current.active = false;
    this.tabs.set(tab.id, tab);
    this.touchSession(sessionId);
  }

  private touchSession(sessionId: string): void {
    this.activityTick += 1;
    this.sessionActivity.set(sessionId, this.activityTick);
  }

  /** Which session should take a tab that Chrome reports with no opener. The lease holder first — that is
   *  the person whose hands are on this browser — then the most recently driven live session. Null means
   *  the account has no live session, and the tab genuinely belongs to nobody. */
  private adoptionSessionId(): string | null {
    if (this.pendingPrimaries > 0) return null;
    const live = new Set([...this.tabs.values()].map((tab) => tab.sessionId));
    if (this.userControlSessionId && live.has(this.userControlSessionId)) return this.userControlSessionId;
    let best: string | null = null;
    let bestTick = -1;
    for (const sessionId of live) {
      const tick = this.sessionActivity.get(sessionId) ?? 0;
      if (tick > bestTick) { bestTick = tick; best = sessionId; }
    }
    return best;
  }

  /** Make room for one more tab by dropping the session's oldest tab that nobody is looking at. Closing
   *  the tab a person just opened is the one eviction that reads as a bug rather than as a limit. */
  private async evictOldestInactive(sessionId: string | null): Promise<boolean> {
    if (sessionId === null) return false;
    const candidate = [...this.tabs.values()]
      .filter((tab) => tab.sessionId === sessionId && !tab.active)
      .sort((a, b) => a.createdAt - b.createdAt)[0];
    if (!candidate) return false;
    this.tabs.delete(candidate.id);
    this.targetIds.delete(candidate.targetId);
    await candidate.page.close().catch(() => {});
    this.logger.warn(`browser target limit reached; closed the oldest inactive tab of session ${sessionId}`);
    return true;
  }

  private targetDestroyed(target: BrowserTargetLike): void {
    const targetId = targetIdOf(target);
    const timer = this.unownedTimers.get(targetId);
    if (timer) clearTimeout(timer);
    this.unownedTimers.delete(targetId);
    this.targetIds.delete(targetId);
    let removed: TabEntry | null = null;
    for (const [id, tab] of this.tabs) if (tab.targetId === targetId) {
      removed = tab;
      this.tabs.delete(id);
    }
    if (removed?.active) {
      const remaining = [...this.tabs.values()].filter((tab) => tab.sessionId === removed!.sessionId);
      if (remaining.length > 0) remaining[remaining.length - 1]!.active = true;
    }
  }
}
