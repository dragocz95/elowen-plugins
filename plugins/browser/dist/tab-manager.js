import { randomBytes } from 'node:crypto';
const targetIdOf = (target) => {
    if (!target)
        return randomBytes(12).toString('base64url');
    const exposed = target.targetId?.();
    if (exposed)
        return exposed;
    const internal = target._targetId;
    return internal || randomBytes(12).toString('base64url');
};
export class TabManager {
    browser;
    maxTargets;
    logger;
    preparePage;
    onUnclosableOverflow;
    tabs = new Map();
    targetIds = new Set();
    unownedTimers = new Map();
    onCreated = (target) => { void this.targetCreated(target); };
    onDestroyed = (target) => { this.targetDestroyed(target); };
    constructor(browser, maxTargets, logger, preparePage = async () => { }, onUnclosableOverflow = async () => { }) {
        this.browser = browser;
        this.maxTargets = maxTargets;
        this.logger = logger;
        this.preparePage = preparePage;
        this.onUnclosableOverflow = onUnclosableOverflow;
        for (const target of browser.targets?.() ?? [])
            this.targetIds.add(targetIdOf(target));
        browser.on?.('targetcreated', this.onCreated);
        browser.on?.('targetdestroyed', this.onDestroyed);
    }
    registerPrimary(sessionId, page) {
        const targetId = targetIdOf(page.target?.());
        const unownedTimer = this.unownedTimers.get(targetId);
        if (unownedTimer)
            clearTimeout(unownedTimer);
        this.unownedTimers.delete(targetId);
        this.targetIds.add(targetId);
        const tab = {
            id: randomBytes(16).toString('base64url'),
            sessionId,
            targetId,
            openerTargetId: null,
            page,
            createdAt: Date.now(),
            active: true,
        };
        for (const current of this.tabs.values())
            if (current.sessionId === sessionId)
                current.active = false;
        this.tabs.set(tab.id, tab);
        return tab.id;
    }
    activePage(sessionId) {
        return [...this.tabs.values()].find((tab) => tab.sessionId === sessionId && tab.active)?.page ?? null;
    }
    async list(sessionId) {
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
    select(sessionId, tabId) {
        const selected = this.tabs.get(tabId);
        if (!selected || selected.sessionId !== sessionId)
            throw new Error('Browser tab not found.');
        for (const tab of this.tabs.values())
            if (tab.sessionId === sessionId)
                tab.active = tab.id === tabId;
        return selected.page;
    }
    async closeTab(sessionId, tabId) {
        const tab = this.tabs.get(tabId);
        if (!tab || tab.sessionId !== sessionId)
            throw new Error('Browser tab not found.');
        this.tabs.delete(tabId);
        this.targetIds.delete(tab.targetId);
        await tab.page.close().catch(() => { });
        const remaining = [...this.tabs.values()].filter((entry) => entry.sessionId === sessionId);
        if (remaining.length > 0 && !remaining.some((entry) => entry.active))
            remaining[remaining.length - 1].active = true;
    }
    async closeSession(sessionId) {
        const ids = [...this.tabs.values()].filter((tab) => tab.sessionId === sessionId).map((tab) => tab.id);
        await Promise.allSettled(ids.map((id) => this.closeTab(sessionId, id)));
    }
    targetCount() { return this.targetIds.size; }
    dispose() {
        this.browser.off?.('targetcreated', this.onCreated);
        this.browser.off?.('targetdestroyed', this.onDestroyed);
        for (const timer of this.unownedTimers.values())
            clearTimeout(timer);
        this.unownedTimers.clear();
        this.tabs.clear();
        this.targetIds.clear();
    }
    async targetCreated(target) {
        const targetId = targetIdOf(target);
        this.targetIds.add(targetId);
        if (this.targetIds.size > this.maxTargets()) {
            const page = await target.page().catch(() => null);
            if (page)
                await page.close().catch(() => { });
            else
                await this.onUnclosableOverflow().catch(() => { });
            this.targetIds.delete(targetId);
            this.logger.warn(page
                ? 'browser target limit reached; closed the newest target'
                : 'browser target limit reached on a non-page target; closed the account browser');
            return;
        }
        if (target.type() !== 'page')
            return;
        const openerTargetId = targetIdOf(target.opener?.() ?? undefined);
        const opener = [...this.tabs.values()].find((tab) => tab.targetId === openerTargetId);
        const page = await target.page().catch(() => null);
        if (!page)
            return;
        try {
            await this.preparePage(page);
        }
        catch (error) {
            await page.close().catch(() => { });
            this.targetIds.delete(targetId);
            this.logger.warn(`browser could not prepare a new page target: ${error instanceof Error ? error.message : String(error)}`);
            return;
        }
        if (!opener) {
            const timer = setTimeout(() => {
                this.unownedTimers.delete(targetId);
                if ([...this.tabs.values()].some((tab) => tab.targetId === targetId))
                    return;
                void page.close().catch(() => { });
                this.targetIds.delete(targetId);
                this.logger.warn('browser opened an unowned page target; it was closed');
            }, 5_000);
            timer.unref();
            this.unownedTimers.set(targetId, timer);
            return;
        }
        const tab = {
            id: randomBytes(16).toString('base64url'),
            sessionId: opener.sessionId,
            targetId,
            openerTargetId,
            page,
            createdAt: Date.now(),
            active: true,
        };
        for (const current of this.tabs.values())
            if (current.sessionId === opener.sessionId)
                current.active = false;
        this.tabs.set(tab.id, tab);
    }
    targetDestroyed(target) {
        const targetId = targetIdOf(target);
        const timer = this.unownedTimers.get(targetId);
        if (timer)
            clearTimeout(timer);
        this.unownedTimers.delete(targetId);
        this.targetIds.delete(targetId);
        let removed = null;
        for (const [id, tab] of this.tabs)
            if (tab.targetId === targetId) {
                removed = tab;
                this.tabs.delete(id);
            }
        if (removed?.active) {
            const remaining = [...this.tabs.values()].filter((tab) => tab.sessionId === removed.sessionId);
            if (remaining.length > 0)
                remaining[remaining.length - 1].active = true;
        }
    }
}
