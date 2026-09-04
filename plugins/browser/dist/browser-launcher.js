import { randomBytes } from 'node:crypto';
import { accessSync, chmodSync, constants, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, readdirSync, realpathSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { ProcessTraceLock } from './performance-probe.js';
import { TabManager } from './tab-manager.js';
const proxyAuthSetups = new WeakMap();
export async function installProxyAuthentication(page, proxy) {
    const active = proxyAuthSetups.get(page);
    if (active)
        return active;
    const setup = (async () => {
        const cdp = await page.createCDPSession();
        cdp.on('Page.javascriptDialogOpening', (raw) => {
            const type = raw.type;
            // Navigation requested by the agent must pass beforeunload; no browser tool can answer other dialogs.
            void cdp.send('Page.handleJavaScriptDialog', { accept: type === 'beforeunload' }).catch(() => { });
        });
        cdp.on('Fetch.requestPaused', (raw) => {
            const requestId = raw.requestId;
            if (typeof requestId === 'string')
                void cdp.send('Fetch.continueRequest', { requestId }).catch(() => { });
        });
        cdp.on('Fetch.authRequired', (raw) => {
            const event = raw;
            if (typeof event.requestId !== 'string')
                return;
            const proxyChallenge = event.authChallenge?.source === 'Proxy';
            void cdp.send('Fetch.continueWithAuth', {
                requestId: event.requestId,
                authChallengeResponse: proxyChallenge
                    ? { response: 'ProvideCredentials', username: proxy.username, password: proxy.password }
                    : { response: 'CancelAuth' },
            }).catch(() => { });
        });
        await Promise.all([
            cdp.send('Page.enable'),
            cdp.send('Fetch.enable', { handleAuthRequests: true }),
        ]);
    })();
    proxyAuthSetups.set(page, setup);
    try {
        await setup;
    }
    catch (error) {
        if (proxyAuthSetups.get(page) === setup)
            proxyAuthSetups.delete(page);
        throw error;
    }
}
const CHROME_CANDIDATES = [
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
];
export function detectChrome(explicit) {
    const candidates = explicit ? [explicit] : CHROME_CANDIDATES;
    for (const candidate of candidates) {
        try {
            const resolved = realpathSync(resolve(candidate));
            if (!lstatSync(resolved).isFile())
                continue;
            accessSync(resolved, constants.X_OK);
            // Google packages expose `google-chrome[-stable]` as a shell wrapper next to the real `chrome` ELF.
            // Running the wrapper under a system account can fail before CDP on its desktop/XDG setup. The sibling
            // binary is the same browser payload without that user-session bootstrap and keeps the Chrome sandbox.
            if (basename(resolved).startsWith('google-chrome')) {
                const binary = join(dirname(resolved), 'chrome');
                if (existsSync(binary) && lstatSync(binary).isFile()) {
                    accessSync(binary, constants.X_OK);
                    return binary;
                }
            }
            return resolved;
        }
        catch { /* try the next candidate */ }
    }
    return null;
}
export class LinuxProcessInspector {
    inspect(pid) {
        try {
            const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
            const end = stat.lastIndexOf(')');
            if (end < 0)
                return null;
            const fields = stat.slice(end + 2).trim().split(/\s+/);
            const startedAtTicks = fields[19];
            if (!startedAtTicks)
                return null;
            const status = readFileSync(`/proc/${pid}/status`, 'utf8');
            const rssKb = Number(/^VmRSS:\s+(\d+)\s+kB$/m.exec(status)?.[1] ?? 0);
            return {
                pid,
                startedAtTicks,
                executablePath: readlinkSync(`/proc/${pid}/exe`),
                args: readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean),
                rssBytes: Number.isFinite(rssKb) ? rssKb * 1024 : undefined,
            };
        }
        catch {
            return null;
        }
    }
    terminate(pid, signal = 'SIGTERM') {
        process.kill(pid, signal);
    }
}
export class PuppeteerCoreFactory {
    /** Loadable AND usable: `launch()` below refuses a module without that export, so a probe that only
     *  checked the import would report a dependency the very next launch rejects. */
    async dependencyAvailable() {
        const moduleName = 'puppeteer-core';
        try {
            const loaded = await import(moduleName);
            return typeof (loaded.default?.launch ?? loaded.launch) === 'function';
        }
        catch {
            return false;
        }
    }
    async launch(options) {
        const moduleName = 'puppeteer-core';
        const loaded = await import(moduleName);
        const launch = loaded.default?.launch ?? loaded.launch;
        if (!launch)
            throw new Error('puppeteer-core does not expose launch().');
        return launch({
            executablePath: options.executablePath,
            // Always headed. A headless Chrome has no window, and a window is the only thing that turns a
            // replayed X event into input Chrome cannot tell from a keyboard.
            headless: false,
            pipe: true,
            userDataDir: options.userDataDir,
            // Service accounts often have HOME unset or pointing at a non-existent directory. Chrome wrappers
            // (notably Snap) reject that before CDP starts, and a shared HOME would also cross account state.
            env: {
                ...process.env,
                HOME: options.userDataDir,
                DISPLAY: options.display.display,
                XAUTHORITY: options.display.xauthPath,
            },
            // The WINDOW decides the viewport. Forcing one through CDP would emulate a size the window does not
            // have, so the page would render for one box and be photographed inside another — and the picture
            // a viewer sees is the window.
            defaultViewport: null,
            dumpio: process.env.ELOWEN_BROWSER_DEBUG === '1',
            // The one thing that actually removes the automation infobar. Measured on this host at 1280x800:
            // Chrome's own UI is 143px with it, 87px without. `--disable-infobars` is a no-op — measured at
            // 143px with and without it — so it is deliberately not in the argument list below pretending to
            // help. The remaining 87px is the tab strip and the address bar, which STAY: the point of a real
            // display is a real browser, tabs and all.
            ignoreDefaultArgs: ['--enable-automation'],
            args: [
                `--proxy-server=${options.proxyUrl}`,
                '--proxy-bypass-list=<-loopback>',
                '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
                '--disable-quic',
                '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
                '--webrtc-ip-handling-policy=disable_non_proxied_udp',
                '--disable-background-networking',
                '--disable-component-update',
                '--disable-default-apps',
                '--disable-sync',
                '--metrics-recording-only',
                '--no-first-run',
                '--no-default-browser-check',
                // One window filling the display, at its origin. There is no window manager on this display, so
                // nothing will move, resize or decorate it afterwards. Chrome insets the result by a pixel when
                // the requested size equals the screen; that seam is left alone deliberately, because asking for
                // one pixel more would push the same pixel off the far edge and clip the PAGE instead.
                '--window-position=0,0',
                `--window-size=${options.viewport.width},${options.viewport.height}`,
            ],
        });
    }
}
export class BrowserPool {
    deps;
    browsers = new Map();
    launches = new Map();
    closings = new Map();
    closeTimers = new Map();
    profilesRoot;
    profilesRootReal;
    constructor(deps) {
        this.deps = deps;
        mkdirSync(deps.dataDir, { recursive: true, mode: 0o700 });
        const dataRoot = realpathSync(deps.dataDir);
        this.profilesRoot = join(dataRoot, 'profiles');
        mkdirSync(this.profilesRoot, { recursive: true, mode: 0o700 });
        const stat = lstatSync(this.profilesRoot);
        if (!stat.isDirectory() || stat.isSymbolicLink())
            throw new Error('The browser profiles root is not a trusted directory.');
        chmodSync(this.profilesRoot, 0o700);
        this.profilesRootReal = realpathSync(this.profilesRoot);
        if (!this.profilesRootReal.startsWith(`${dataRoot}${sep}`))
            throw new Error('The browser profiles root escapes the plugin data directory.');
    }
    /** Whether the profiles root is still the private, writable directory the constructor demanded — the
     *  one condition every launch depends on and the one an operator can silently break later (a restored
     *  backup, a container remount, a chmod).
     *
     *  One discriminated state rather than a set of booleans: a root that is GONE cannot also be judged
     *  private or writable, and reading `private: false` off a failed stat is how a missing directory ends
     *  up reported — and remediated — as a world-readable one. Reports the state, never the location.
     *  Read-only: it stats, it does not repair. */
    storageStatus() {
        let stat;
        try {
            stat = lstatSync(this.profilesRoot);
        }
        catch {
            return { state: 'missing' };
        }
        try {
            if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(this.profilesRoot) !== this.profilesRootReal) {
                return { state: 'missing' };
            }
        }
        catch {
            return { state: 'missing' };
        }
        if ((stat.mode & 0o077) !== 0)
            return { state: 'exposed' };
        try {
            accessSync(this.profilesRootReal, constants.W_OK | constants.X_OK);
        }
        catch {
            return { state: 'unwritable' };
        }
        return { state: 'ready' };
    }
    profilePath(userId) {
        if (!Number.isSafeInteger(userId) || userId < 1)
            throw new Error('Browser profile owner is invalid.');
        this.assertProfilesRoot();
        return join(this.profilesRootReal, `u-${userId}`);
    }
    activeUserCount() { return new Set([...this.browsers.keys(), ...this.launches.keys(), ...this.closings.keys()]).size; }
    activeSessionCount(userId) { return this.browsers.get(userId)?.sessionIds.size ?? 0; }
    hasActiveUser(userId) { return this.browsers.has(userId) || this.launches.has(userId) || this.closings.has(userId); }
    isHealthy(userId) {
        const browser = this.browsers.get(userId)?.browser;
        return browser ? browser.connected !== false : true;
    }
    rssBytes(userId) {
        const processRecord = this.deps.store.process(userId);
        if (!processRecord)
            return 0;
        return this.deps.processInspector.inspect(processRecord.pid)?.rssBytes ?? 0;
    }
    async openPage(userId, sessionId) {
        const managed = await this.acquire(userId);
        this.cancelClose(userId);
        if (managed.sessionIds.has(sessionId))
            throw new Error('Browser session already owns a page.');
        try {
            const page = await managed.browser.newPage();
            await installProxyAuthentication(page, managed.proxy);
            // Deliberately NO setViewport. The tab is a real tab in a real window, and its size is whatever
            // the window leaves after the tab strip and the address bar. Emulating a viewport here would make
            // the page lay itself out for a box the window does not have, so the framebuffer a person watches
            // and the box a screenshot is clipped to would disagree.
            await page.goto('about:blank', { waitUntil: 'load', timeout: 15_000 });
            managed.tabs.registerPrimary(sessionId, page);
            managed.sessionIds.add(sessionId);
            return { page, tabs: managed.tabs, traceLock: managed.traceLock };
        }
        catch (error) {
            if (managed.sessionIds.size === 0)
                await this.closeUser(userId);
            throw error;
        }
    }
    async releasePage(userId, sessionId) {
        const managed = this.browsers.get(userId);
        if (!managed || !managed.sessionIds.delete(sessionId))
            return;
        await managed.tabs.closeSession(sessionId);
        if (managed.sessionIds.size !== 0)
            return;
        const grace = this.deps.config().browserCloseGraceMs;
        if (grace === 0) {
            await this.closeUser(userId);
            return;
        }
        const timer = setTimeout(() => { void this.closeUser(userId); }, grace);
        timer.unref();
        this.closeTimers.set(userId, timer);
    }
    async closeUser(userId) {
        const existing = this.closings.get(userId);
        if (existing)
            return existing;
        const closing = (async () => {
            this.cancelClose(userId);
            const pending = this.launches.get(userId);
            if (pending)
                await pending.catch(() => { });
            const managed = this.browsers.get(userId);
            if (!managed)
                return;
            managed.tabs.dispose();
            const record = this.deps.store.process(userId);
            const [browserResult, proxyResult] = await Promise.allSettled([managed.browser.close(), managed.proxy.close()]);
            if (browserResult.status === 'fulfilled' && await this.processExited(record))
                this.deps.store.deleteProcess(userId);
            else if (record)
                this.deps.logger.warn(`browser process ${record.pid} for user ${userId} did not confirm exit; keeping its ownership record`);
            if (browserResult.status === 'rejected')
                this.deps.logger.warn(`browser cleanup failed for user ${userId}: ${String(browserResult.reason)}`);
            if (proxyResult.status === 'rejected')
                this.deps.logger.warn(`browser proxy cleanup failed for user ${userId}: ${String(proxyResult.reason)}`);
            // The display outlives nothing: Chrome is the only client, so an X server left running would be a
            // 58 MiB leak per account that no later launch would ever reuse.
            await this.deps.displays.release(userId).catch((error) => {
                this.deps.logger.warn(`browser vnc display cleanup failed for user ${userId}: ${String(error)}`);
            });
            this.browsers.delete(userId);
        })();
        this.closings.set(userId, closing);
        try {
            await closing;
        }
        finally {
            if (this.closings.get(userId) === closing)
                this.closings.delete(userId);
        }
    }
    async closeAll() {
        for (const timer of this.closeTimers.values())
            clearTimeout(timer);
        this.closeTimers.clear();
        const users = [...new Set([...this.browsers.keys(), ...this.launches.keys(), ...this.closings.keys()])];
        await Promise.allSettled(users.map((userId) => this.closeUser(userId)));
        await this.deps.proxyFactory.closeAll();
    }
    clearProfile(userId) {
        if (this.hasActiveUser(userId))
            throw new Error('Close all browser sessions before clearing the profile.');
        const profile = this.profilePath(userId);
        if (!existsSync(profile))
            return;
        const stat = lstatSync(profile);
        if (!stat.isDirectory() || stat.isSymbolicLink())
            throw new Error('The managed browser profile path is not a real directory.');
        const tombstone = join(this.profilesRootReal, `.delete-u-${userId}-${randomBytes(8).toString('hex')}`);
        renameSync(profile, tombstone);
        rmSync(tombstone, { recursive: true, force: true });
    }
    profileSize(userId) {
        const root = this.profilePath(userId);
        if (!existsSync(root))
            return 0;
        const rootStat = lstatSync(root);
        if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
            throw new Error('The managed browser profile path is not a real directory.');
        let total = 0;
        const queue = [root];
        let visited = 0;
        while (queue.length > 0 && visited < 100_000) {
            const current = queue.pop();
            visited += 1;
            const entries = (() => {
                try {
                    return readdirSync(current, { withFileTypes: true, encoding: 'utf8' });
                }
                catch {
                    return [];
                }
            })();
            for (const entry of entries) {
                const path = join(current, entry.name);
                if (entry.isDirectory())
                    queue.push(path);
                else if (entry.isFile()) {
                    try {
                        total += lstatSync(path).size;
                    }
                    catch { /* file changed while measuring */ }
                }
            }
        }
        return queue.length > 0 ? Number.MAX_SAFE_INTEGER : total;
    }
    async acquire(userId) {
        const closing = this.closings.get(userId);
        if (closing)
            await closing;
        const active = this.browsers.get(userId);
        if (active)
            return active;
        const pending = this.launches.get(userId);
        if (pending)
            return pending;
        const previous = this.deps.store.process(userId);
        if (previous && this.processRecordMatches(previous)) {
            throw new Error('The previous account browser has not exited yet.');
        }
        if (previous)
            this.deps.store.deleteProcess(userId);
        if (this.activeUserCount() >= this.deps.config().maxActiveUsers)
            throw new Error('The browser active-user limit has been reached.');
        const launch = this.launchUser(userId);
        this.launches.set(userId, launch);
        try {
            return await launch;
        }
        finally {
            this.launches.delete(userId);
        }
    }
    async launchUser(userId) {
        const config = this.deps.config();
        const executablePath = detectChrome(config.chromeExecutable);
        if (!executablePath)
            throw new Error('No supported Chrome or Chromium executable was found.');
        const profilePath = this.profilePath(userId);
        mkdirSync(profilePath, { recursive: true, mode: 0o700 });
        const profileStat = lstatSync(profilePath);
        if (!profileStat.isDirectory() || profileStat.isSymbolicLink() || dirname(realpathSync(profilePath)) !== this.profilesRootReal) {
            throw new Error('The managed browser profile path is not a real directory.');
        }
        chmodSync(profilePath, 0o700);
        // The display comes up BEFORE the proxy and before Chrome: a browser launched against a display
        // that is not serving yet fails inside Chrome's ozone layer, where the error says only "Missing X
        // server" and nothing about which account or why.
        const display = await this.deps.displays.acquire(userId);
        let proxy;
        try {
            proxy = await this.deps.proxyFactory.open(userId);
        }
        catch (error) {
            await this.deps.displays.release(userId).catch(() => { });
            throw error;
        }
        let browser;
        try {
            browser = await this.deps.processFactory.launch({
                executablePath,
                userDataDir: profilePath,
                proxyUrl: proxy.url,
                viewport: { width: display.width, height: display.height },
                display: { display: display.display, xauthPath: display.xauthPath },
            });
        }
        catch (error) {
            await proxy.close().catch(() => { });
            await this.deps.displays.release(userId).catch(() => { });
            throw error;
        }
        const tabs = new TabManager(browser, () => this.deps.config().maxTargetsPerUser, this.deps.logger, (page) => installProxyAuthentication(page, proxy), () => this.closeUser(userId));
        if (tabs.targetCount() > config.maxTargetsPerUser) {
            tabs.dispose();
            await Promise.allSettled([browser.close(), proxy.close()]);
            throw new Error('The browser profile opened more Chrome targets than the configured account limit.');
        }
        const managed = {
            userId, browser, proxy, tabs, profilePath, executablePath,
            sessionIds: new Set(), traceLock: new ProcessTraceLock(),
        };
        this.browsers.set(userId, managed);
        try {
            this.recordProcess(managed);
        }
        catch (error) {
            this.browsers.delete(userId);
            tabs.dispose();
            await Promise.allSettled([browser.close(), proxy.close()]);
            throw error;
        }
        return managed;
    }
    recordProcess(managed) {
        const pid = managed.browser.process?.()?.pid;
        if (!pid)
            throw new Error('Chrome launched without an inspectable process ID.');
        const snapshot = this.deps.processInspector.inspect(pid);
        if (!snapshot)
            throw new Error('Chrome launched without an inspectable process record.');
        const record = {
            userId: managed.userId,
            pid,
            startedAtTicks: snapshot.startedAtTicks,
            executablePath: snapshot.executablePath,
            profilePath: managed.profilePath,
            createdAt: Date.now(),
        };
        this.deps.store.saveProcess(record);
    }
    assertProfilesRoot() {
        const stat = lstatSync(this.profilesRoot);
        if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(this.profilesRoot) !== this.profilesRootReal) {
            throw new Error('The browser profiles root changed unexpectedly.');
        }
    }
    processRecordMatches(record) {
        const snapshot = this.deps.processInspector.inspect(record.pid);
        return !!snapshot
            && snapshot.startedAtTicks === record.startedAtTicks
            && snapshot.executablePath === record.executablePath
            && snapshot.args.includes(`--user-data-dir=${record.profilePath}`);
    }
    async processExited(record) {
        if (!record)
            return false;
        for (let attempt = 0; attempt < 40; attempt += 1) {
            if (!this.processRecordMatches(record))
                return true;
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return !this.processRecordMatches(record);
    }
    cancelClose(userId) {
        const timer = this.closeTimers.get(userId);
        if (!timer)
            return;
        clearTimeout(timer);
        this.closeTimers.delete(userId);
    }
}
