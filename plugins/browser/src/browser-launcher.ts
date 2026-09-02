import { randomBytes } from 'node:crypto';
import { accessSync, chmodSync, constants, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, readdirSync, realpathSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import type { BrowserConfig } from './config.js';
import { BrowserStore } from './store.js';
import { TabManager } from './tab-manager.js';
import type {
  BrowserLike, BrowserLogger, BrowserProcessFactory, BrowserProxyFactory, ManagedProcessRecord,
  PageLike, ProcessInspector, ProcessSnapshot, ProxyLease,
} from './types.js';

const proxyAuthSetups = new WeakMap<PageLike, Promise<void>>();

export async function installProxyAuthentication(page: PageLike, proxy: ProxyLease): Promise<void> {
  const active = proxyAuthSetups.get(page);
  if (active) return active;
  const setup = (async () => {
    const cdp = await page.createCDPSession();
    cdp.on('Page.javascriptDialogOpening', (raw) => {
      const type = (raw as { type?: unknown }).type;
      // Navigation requested by the agent must pass beforeunload; no browser tool can answer other dialogs.
      void cdp.send('Page.handleJavaScriptDialog', { accept: type === 'beforeunload' }).catch(() => {});
    });
    cdp.on('Fetch.requestPaused', (raw) => {
      const requestId = (raw as { requestId?: unknown }).requestId;
      if (typeof requestId === 'string') void cdp.send('Fetch.continueRequest', { requestId }).catch(() => {});
    });
    cdp.on('Fetch.authRequired', (raw) => {
      const event = raw as { requestId?: unknown; authChallenge?: { source?: unknown } };
      if (typeof event.requestId !== 'string') return;
      const proxyChallenge = event.authChallenge?.source === 'Proxy';
      void cdp.send('Fetch.continueWithAuth', {
        requestId: event.requestId,
        authChallengeResponse: proxyChallenge
          ? { response: 'ProvideCredentials', username: proxy.username, password: proxy.password }
          : { response: 'CancelAuth' },
      }).catch(() => {});
    });
    await Promise.all([
      cdp.send('Page.enable'),
      cdp.send('Fetch.enable', { handleAuthRequests: true }),
    ]);
  })();
  proxyAuthSetups.set(page, setup);
  try { await setup; }
  catch (error) {
    if (proxyAuthSetups.get(page) === setup) proxyAuthSetups.delete(page);
    throw error;
  }
}

const CHROME_CANDIDATES = [
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

export function detectChrome(explicit: string | null): string | null {
  const candidates = explicit ? [explicit] : CHROME_CANDIDATES;
  for (const candidate of candidates) {
    try {
      const resolved = realpathSync(resolve(candidate));
      if (!lstatSync(resolved).isFile()) continue;
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
    } catch { /* try the next candidate */ }
  }
  return null;
}

/** What the kernel and the Chrome package offer the sandbox this launcher refuses to disable.
 *
 *  `namespaces` is the layer Chrome prefers; `setuidHelper` is the older `chrome-sandbox` binary it falls
 *  back to. Both are read from disk — nothing here starts a browser — and neither is conclusive: Chrome
 *  decides at launch, which is why an unprovable environment is reported as something to check rather
 *  than as a failure. */
export interface ChromeSandboxSupport {
  namespaces: boolean;
  setuidHelper: boolean;
}

const readCount = (path: string): number | null => {
  try {
    const value = Number(readFileSync(path, 'utf8').trim());
    return Number.isFinite(value) ? value : null;
  } catch { return null; }
};

export function inspectChromeSandbox(executable: string | null): ChromeSandboxSupport {
  // Debian keeps a separate switch for unprivileged user namespaces; everywhere else the count is the
  // whole answer. A missing file means the kernel does not expose the knob, not that it is disabled.
  const maxUserNamespaces = readCount('/proc/sys/user/max_user_namespaces');
  const unprivilegedClone = readCount('/proc/sys/kernel/unprivileged_userns_clone');
  const namespaces = (maxUserNamespaces === null || maxUserNamespaces > 0) && unprivilegedClone !== 0;
  let setuidHelper = false;
  if (executable) {
    try {
      const helper = join(dirname(executable), 'chrome-sandbox');
      const stat = lstatSync(helper);
      // Owned by root with the setuid bit — anything else is a file Chrome will refuse to use.
      setuidHelper = stat.isFile() && stat.uid === 0 && (stat.mode & 0o4000) !== 0;
    } catch { setuidHelper = false; }
  }
  return { namespaces, setuidHelper };
}

export class LinuxProcessInspector implements ProcessInspector {
  inspect(pid: number): ProcessSnapshot | null {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      const end = stat.lastIndexOf(')');
      if (end < 0) return null;
      const fields = stat.slice(end + 2).trim().split(/\s+/);
      const startedAtTicks = fields[19];
      if (!startedAtTicks) return null;
      const status = readFileSync(`/proc/${pid}/status`, 'utf8');
      const rssKb = Number(/^VmRSS:\s+(\d+)\s+kB$/m.exec(status)?.[1] ?? 0);
      return {
        pid,
        startedAtTicks,
        executablePath: readlinkSync(`/proc/${pid}/exe`),
        args: readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean),
        rssBytes: Number.isFinite(rssKb) ? rssKb * 1024 : undefined,
      };
    } catch {
      return null;
    }
  }

  terminate(pid: number, signal: 'SIGTERM' | 'SIGKILL' = 'SIGTERM'): void {
    process.kill(pid, signal);
  }
}

export class PuppeteerCoreFactory implements BrowserProcessFactory {
  async dependencyAvailable(): Promise<boolean> {
    const moduleName = 'puppeteer-core';
    try { await import(moduleName); return true; }
    catch { return false; }
  }

  async launch(options: {
    executablePath: string;
    userDataDir: string;
    proxyUrl: string;
    viewport: { width: number; height: number };
  }): Promise<BrowserLike> {
    const moduleName = 'puppeteer-core';
    const loaded = await import(moduleName) as { default?: { launch(options: Record<string, unknown>): Promise<BrowserLike> }; launch?: (options: Record<string, unknown>) => Promise<BrowserLike> };
    const launch = loaded.default?.launch ?? loaded.launch;
    if (!launch) throw new Error('puppeteer-core does not expose launch().');
    return launch({
      executablePath: options.executablePath,
      headless: true,
      pipe: true,
      userDataDir: options.userDataDir,
      // Service accounts often have HOME unset or pointing at a non-existent directory. Chrome wrappers
      // (notably Snap) reject that before CDP starts, and a shared HOME would also cross account state.
      env: { ...process.env, HOME: options.userDataDir },
      defaultViewport: options.viewport,
      dumpio: process.env.ELOWEN_BROWSER_DEBUG === '1',
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
        `--window-size=${options.viewport.width},${options.viewport.height}`,
      ],
    });
  }
}

interface UserBrowser {
  userId: number;
  browser: BrowserLike;
  proxy: ProxyLease;
  tabs: TabManager;
  profilePath: string;
  executablePath: string;
  sessionIds: Set<string>;
}

export interface OpenedBrowserPage {
  page: PageLike;
  tabs: TabManager;
}

export class BrowserPool {
  private readonly browsers = new Map<number, UserBrowser>();
  private readonly launches = new Map<number, Promise<UserBrowser>>();
  private readonly closings = new Map<number, Promise<void>>();
  private readonly closeTimers = new Map<number, NodeJS.Timeout>();
  private readonly profilesRoot: string;
  private readonly profilesRootReal: string;

  constructor(private readonly deps: {
    dataDir: string;
    config: () => BrowserConfig;
    store: BrowserStore;
    proxyFactory: BrowserProxyFactory;
    processFactory: BrowserProcessFactory;
    processInspector: ProcessInspector;
    logger: BrowserLogger;
  }) {
    mkdirSync(deps.dataDir, { recursive: true, mode: 0o700 });
    const dataRoot = realpathSync(deps.dataDir);
    this.profilesRoot = join(dataRoot, 'profiles');
    mkdirSync(this.profilesRoot, { recursive: true, mode: 0o700 });
    const stat = lstatSync(this.profilesRoot);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('The browser profiles root is not a trusted directory.');
    chmodSync(this.profilesRoot, 0o700);
    this.profilesRootReal = realpathSync(this.profilesRoot);
    if (!this.profilesRootReal.startsWith(`${dataRoot}${sep}`)) throw new Error('The browser profiles root escapes the plugin data directory.');
  }

  /** Whether the profiles root is still the private, writable directory the constructor demanded — the
   *  one condition every launch depends on and the one an operator can silently break later (a restored
   *  backup, a container remount, a chmod).
   *
   *  Reports the state, never the location: the answer is `name`, the directory's own last segment, so an
   *  admin can recognize it without the panel printing the data root, and never a per-account profile
   *  path. Read-only — it stats, it does not repair. */
  storageStatus(): { ok: boolean; writable: boolean; private: boolean; name: string } {
    const name = basename(this.profilesRootReal);
    try {
      const stat = lstatSync(this.profilesRoot);
      const intact = stat.isDirectory() && !stat.isSymbolicLink() && realpathSync(this.profilesRoot) === this.profilesRootReal;
      const isPrivate = (stat.mode & 0o077) === 0;
      let writable = false;
      try { accessSync(this.profilesRootReal, constants.W_OK | constants.X_OK); writable = true; }
      catch { writable = false; }
      return { ok: intact && isPrivate && writable, writable, private: isPrivate, name };
    } catch {
      return { ok: false, writable: false, private: false, name };
    }
  }

  profilePath(userId: number): string {
    if (!Number.isSafeInteger(userId) || userId < 1) throw new Error('Browser profile owner is invalid.');
    this.assertProfilesRoot();
    return join(this.profilesRootReal, `u-${userId}`);
  }

  activeUserCount(): number { return new Set([...this.browsers.keys(), ...this.launches.keys(), ...this.closings.keys()]).size; }

  activeSessionCount(userId: number): number { return this.browsers.get(userId)?.sessionIds.size ?? 0; }

  hasActiveUser(userId: number): boolean { return this.browsers.has(userId) || this.launches.has(userId) || this.closings.has(userId); }

  isHealthy(userId: number): boolean {
    const browser = this.browsers.get(userId)?.browser;
    return browser ? browser.connected !== false : true;
  }

  rssBytes(userId: number): number {
    const processRecord = this.deps.store.process(userId);
    if (!processRecord) return 0;
    return this.deps.processInspector.inspect(processRecord.pid)?.rssBytes ?? 0;
  }

  async openPage(userId: number, sessionId: string): Promise<OpenedBrowserPage> {
    const managed = await this.acquire(userId);
    this.cancelClose(userId);
    if (managed.sessionIds.has(sessionId)) throw new Error('Browser session already owns a page.');
    try {
      const page = await managed.browser.newPage();
      const config = this.deps.config();
      await installProxyAuthentication(page, managed.proxy);
      await page.setViewport?.({ width: config.maxViewportWidth, height: config.viewportHeight });
      await page.goto('about:blank', { waitUntil: 'load', timeout: 15_000 });
      managed.tabs.registerPrimary(sessionId, page);
      managed.sessionIds.add(sessionId);
      return { page, tabs: managed.tabs };
    } catch (error) {
      if (managed.sessionIds.size === 0) await this.closeUser(userId);
      throw error;
    }
  }

  async releasePage(userId: number, sessionId: string): Promise<void> {
    const managed = this.browsers.get(userId);
    if (!managed || !managed.sessionIds.delete(sessionId)) return;
    await managed.tabs.closeSession(sessionId);
    if (managed.sessionIds.size !== 0) return;
    const grace = this.deps.config().browserCloseGraceMs;
    if (grace === 0) {
      await this.closeUser(userId);
      return;
    }
    const timer = setTimeout(() => { void this.closeUser(userId); }, grace);
    timer.unref();
    this.closeTimers.set(userId, timer);
  }

  async closeUser(userId: number): Promise<void> {
    const existing = this.closings.get(userId);
    if (existing) return existing;
    const closing = (async () => {
      this.cancelClose(userId);
      const pending = this.launches.get(userId);
      if (pending) await pending.catch(() => {});
      const managed = this.browsers.get(userId);
      if (!managed) return;
      managed.tabs.dispose();
      const record = this.deps.store.process(userId);
      const [browserResult, proxyResult] = await Promise.allSettled([managed.browser.close(), managed.proxy.close()]);
      if (browserResult.status === 'fulfilled' && await this.processExited(record)) this.deps.store.deleteProcess(userId);
      else if (record) this.deps.logger.warn(`browser process ${record.pid} for user ${userId} did not confirm exit; keeping its ownership record`);
      if (browserResult.status === 'rejected') this.deps.logger.warn(`browser cleanup failed for user ${userId}: ${String(browserResult.reason)}`);
      if (proxyResult.status === 'rejected') this.deps.logger.warn(`browser proxy cleanup failed for user ${userId}: ${String(proxyResult.reason)}`);
      this.browsers.delete(userId);
    })();
    this.closings.set(userId, closing);
    try { await closing; }
    finally { if (this.closings.get(userId) === closing) this.closings.delete(userId); }
  }

  async closeAll(): Promise<void> {
    for (const timer of this.closeTimers.values()) clearTimeout(timer);
    this.closeTimers.clear();
    const users = [...new Set([...this.browsers.keys(), ...this.launches.keys(), ...this.closings.keys()])];
    await Promise.allSettled(users.map((userId) => this.closeUser(userId)));
    await this.deps.proxyFactory.closeAll();
  }

  clearProfile(userId: number): void {
    if (this.hasActiveUser(userId)) throw new Error('Close all browser sessions before clearing the profile.');
    const profile = this.profilePath(userId);
    if (!existsSync(profile)) return;
    const stat = lstatSync(profile);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('The managed browser profile path is not a real directory.');
    const tombstone = join(this.profilesRootReal, `.delete-u-${userId}-${randomBytes(8).toString('hex')}`);
    renameSync(profile, tombstone);
    rmSync(tombstone, { recursive: true, force: true });
  }

  profileSize(userId: number): number {
    const root = this.profilePath(userId);
    if (!existsSync(root)) return 0;
    const rootStat = lstatSync(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('The managed browser profile path is not a real directory.');
    let total = 0;
    const queue = [root];
    let visited = 0;
    while (queue.length > 0 && visited < 100_000) {
      const current = queue.pop()!;
      visited += 1;
      const entries = (() => {
        try { return readdirSync(current, { withFileTypes: true, encoding: 'utf8' }); }
        catch { return []; }
      })();
      for (const entry of entries) {
        const path = join(current, entry.name);
        if (entry.isDirectory()) queue.push(path);
        else if (entry.isFile()) {
          try { total += lstatSync(path).size; }
          catch { /* file changed while measuring */ }
        }
      }
    }
    return queue.length > 0 ? Number.MAX_SAFE_INTEGER : total;
  }

  private async acquire(userId: number): Promise<UserBrowser> {
    const closing = this.closings.get(userId);
    if (closing) await closing;
    const active = this.browsers.get(userId);
    if (active) return active;
    const pending = this.launches.get(userId);
    if (pending) return pending;
    const previous = this.deps.store.process(userId);
    if (previous && this.processRecordMatches(previous)) {
      throw new Error('The previous account browser has not exited yet.');
    }
    if (previous) this.deps.store.deleteProcess(userId);
    if (this.activeUserCount() >= this.deps.config().maxActiveUsers) throw new Error('The browser active-user limit has been reached.');
    const launch = this.launchUser(userId);
    this.launches.set(userId, launch);
    try { return await launch; }
    finally { this.launches.delete(userId); }
  }

  private async launchUser(userId: number): Promise<UserBrowser> {
    const config = this.deps.config();
    const executablePath = detectChrome(config.chromeExecutable);
    if (!executablePath) throw new Error('No supported Chrome or Chromium executable was found.');
    const profilePath = this.profilePath(userId);
    mkdirSync(profilePath, { recursive: true, mode: 0o700 });
    const profileStat = lstatSync(profilePath);
    if (!profileStat.isDirectory() || profileStat.isSymbolicLink() || dirname(realpathSync(profilePath)) !== this.profilesRootReal) {
      throw new Error('The managed browser profile path is not a real directory.');
    }
    chmodSync(profilePath, 0o700);
    const proxy = await this.deps.proxyFactory.open(userId);
    let browser: BrowserLike;
    try {
      browser = await this.deps.processFactory.launch({
        executablePath,
        userDataDir: profilePath,
        proxyUrl: proxy.url,
        viewport: { width: config.maxViewportWidth, height: config.viewportHeight },
      });
    } catch (error) {
      await proxy.close().catch(() => {});
      throw error;
    }
    const tabs = new TabManager(
      browser,
      () => this.deps.config().maxTargetsPerUser,
      this.deps.logger,
      (page) => installProxyAuthentication(page, proxy),
      () => this.closeUser(userId),
    );
    if (tabs.targetCount() > config.maxTargetsPerUser) {
      tabs.dispose();
      await Promise.allSettled([browser.close(), proxy.close()]);
      throw new Error('The browser profile opened more Chrome targets than the configured account limit.');
    }
    const managed: UserBrowser = { userId, browser, proxy, tabs, profilePath, executablePath, sessionIds: new Set() };
    this.browsers.set(userId, managed);
    try { this.recordProcess(managed); }
    catch (error) {
      this.browsers.delete(userId);
      tabs.dispose();
      await Promise.allSettled([browser.close(), proxy.close()]);
      throw error;
    }
    return managed;
  }

  private recordProcess(managed: UserBrowser): void {
    const pid = managed.browser.process?.()?.pid;
    if (!pid) throw new Error('Chrome launched without an inspectable process ID.');
    const snapshot = this.deps.processInspector.inspect(pid);
    if (!snapshot) throw new Error('Chrome launched without an inspectable process record.');
    const record: ManagedProcessRecord = {
      userId: managed.userId,
      pid,
      startedAtTicks: snapshot.startedAtTicks,
      executablePath: snapshot.executablePath,
      profilePath: managed.profilePath,
      createdAt: Date.now(),
    };
    this.deps.store.saveProcess(record);
  }

  private assertProfilesRoot(): void {
    const stat = lstatSync(this.profilesRoot);
    if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(this.profilesRoot) !== this.profilesRootReal) {
      throw new Error('The browser profiles root changed unexpectedly.');
    }
  }

  private processRecordMatches(record: ManagedProcessRecord): boolean {
    const snapshot = this.deps.processInspector.inspect(record.pid);
    return !!snapshot
      && snapshot.startedAtTicks === record.startedAtTicks
      && snapshot.executablePath === record.executablePath
      && snapshot.args.includes(`--user-data-dir=${record.profilePath}`);
  }

  private async processExited(record: ManagedProcessRecord | null): Promise<boolean> {
    if (!record) return false;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (!this.processRecordMatches(record)) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return !this.processRecordMatches(record);
  }

  private cancelClose(userId: number): void {
    const timer = this.closeTimers.get(userId);
    if (!timer) return;
    clearTimeout(timer);
    this.closeTimers.delete(userId);
  }
}
