// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { EventEmitter } from 'node:events';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PluginDb } from 'elowen/plugin-api';
import { requireBrowserToolOwner } from '../plugins/browser/src/ownership.js';
import {
  DynamicProxyChainAdapter, NavigationPolicy, NavigationPolicyError, type HostResolver,
  type ProxyChainPrepareRequest, type ProxyChainPrepareResult, type ProxyChainServerLike,
} from '../plugins/browser/src/navigation-policy.js';
import { resolveConfig, type BrowserConfig } from '../plugins/browser/src/config.js';
import { BrowserStore } from '../plugins/browser/src/store.js';
import { BrowserPool } from '../plugins/browser/src/browser-launcher.js';
import { ScreencastHub, StreamBudget } from '../plugins/browser/src/screencast-hub.js';
import { BrowserSession } from '../plugins/browser/src/browser-session.js';
import { TabManager } from '../plugins/browser/src/tab-manager.js';
import { UNAVAILABLE_ARTIFACT_PUBLISHER } from '../plugins/browser/src/artifact.js';
import { registerBrowserApi } from '../plugins/browser/src/api.js';
import { registerBrowserTools } from '../plugins/browser/src/tools.js';
import type {
  BrowserLike, BrowserLogger, BrowserProcessFactory, BrowserProxyFactory, CDPSessionLike, PageLike, ProcessInspector,
} from '../plugins/browser/src/types.js';

const roots: string[] = [];
afterEach(() => { while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true }); });

const logger: BrowserLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function pluginDb(): PluginDb {
  const raw = new Database(':memory:');
  raw.exec('CREATE TABLE plugin_migrations(version INTEGER PRIMARY KEY)');
  const handle = {
    exec: (sql: string) => raw.exec(sql),
    prepare: (sql: string) => {
      const statement = raw.prepare(sql);
      return {
        run: (...params: unknown[]) => statement.run(...params),
        get: (...params: unknown[]) => statement.get(...params),
        all: (...params: unknown[]) => statement.all(...params),
      };
    },
    migrate: (steps: { version: number; up(db: PluginDb): void }[]) => {
      for (const step of steps) if (!raw.prepare('SELECT 1 FROM plugin_migrations WHERE version=?').get(step.version)) {
        raw.transaction(() => { step.up(handle as PluginDb); raw.prepare('INSERT INTO plugin_migrations(version) VALUES (?)').run(step.version); })();
      }
    },
    appliedVersion: () => Number((raw.prepare('SELECT max(version) version FROM plugin_migrations').get() as { version: number | null }).version ?? 0),
    transaction: <T>(fn: () => T) => raw.transaction(fn)(),
  };
  return handle as PluginDb;
}

class FakeCdp extends EventEmitter implements CDPSessionLike {
  readonly calls: { method: string; params?: Record<string, unknown> }[] = [];
  async send<T = Record<string, unknown>>(method: string, params?: Record<string, unknown>): Promise<T> {
    this.calls.push(params ? { method, params } : { method });
    if (method === 'Accessibility.getFullAXTree') {
      return { nodes: [{ nodeId: 'root', role: { value: 'RootWebArea' }, name: { value: 'Test page' }, childIds: ['button'] }, { nodeId: 'button', role: { value: 'button' }, name: { value: 'Continue' }, backendDOMNodeId: 7 }] } as T;
    }
    if (method === 'DOM.getBoxModel') return { model: { border: [10, 10, 30, 10, 30, 30, 10, 30] } } as T;
    return {} as T;
  }
  off(event: string, listener: (payload: unknown) => void): this { return super.off(event, listener); }
  async detach(): Promise<void> {}
}

let targetSequence = 0;
let processSequence = 5000;
const fakeProcesses = new Map<number, { executablePath: string; profilePath: string }>();
class FakePage implements PageLike {
  readonly cdp = new FakeCdp();
  private currentUrl = 'about:blank';
  private closed = false;
  credentials: { username: string; password: string } | null = null;
  readonly id = `target-${++targetSequence}`;
  url(): string { return this.currentUrl; }
  async title(): Promise<string> { return 'Test page'; }
  async goto(url: string): Promise<void> { this.currentUrl = url; }
  async close(): Promise<void> { this.closed = true; }
  isClosed(): boolean { return this.closed; }
  async createCDPSession(): Promise<CDPSessionLike> { return this.cdp; }
  async setViewport(): Promise<void> {}
  async authenticate(credentials: { username: string; password: string }): Promise<void> { this.credentials = credentials; }
  target() { return { type: () => 'page', url: () => this.currentUrl, page: async () => this, targetId: () => this.id }; }
}

class FakeBrowser extends EventEmitter implements BrowserLike {
  readonly pages: FakePage[] = [];
  private readonly pid = ++processSequence;
  constructor(processInfo?: { executablePath: string; profilePath: string }) {
    super();
    if (processInfo) fakeProcesses.set(this.pid, processInfo);
  }
  process() { return { pid: this.pid }; }
  async newPage(): Promise<PageLike> {
    const page = new FakePage();
    this.pages.push(page);
    this.emit('targetcreated', page.target());
    return page;
  }
  async close(): Promise<void> { for (const page of this.pages) await page.close(); fakeProcesses.delete(this.pid); }
  targets() { return []; }
  on(event: string, listener: (target: any) => void): this { return super.on(event, listener); }
  off(event: string, listener: (target: any) => void): this { return super.off(event, listener); }
}

const config = (patch: Partial<BrowserConfig> = {}): BrowserConfig => ({ ...resolveConfig({ browserCloseGraceSeconds: 0 }), ...patch });

describe('browser plugin contract', () => {
  it('publishes manifest 0.1.0, matching locales and committed backend artifacts', () => {
    const root = join(import.meta.dirname, '..', 'plugins', 'browser');
    const manifest = JSON.parse(readFileSync(join(root, 'elowen-plugin.json'), 'utf8')) as { version: string; userGrantable: boolean; entry: string; provides: { tools: string[]; apiRoutes: string[] } };
    expect(manifest.version).toBe('0.1.0');
    expect(manifest.userGrantable).toBe(true);
    expect(manifest.provides.tools).toHaveLength(11);
    expect(manifest.provides.apiRoutes).toHaveLength(11);
    expect(existsSync(join(root, manifest.entry))).toBe(true);
    const launcherSource = readFileSync(join(root, 'src', 'browser-launcher.ts'), 'utf8');
    expect(launcherSource).toContain('--proxy-bypass-list=<-loopback>');
    expect(launcherSource).toContain('--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1');
    expect(launcherSource).toContain('--disable-quic');
    for (const locale of ['cs', 'sk']) {
      const translation = JSON.parse(readFileSync(join(root, 'i18n', `${locale}.json`), 'utf8')) as { description?: string; fields?: Record<string, unknown> };
      expect(translation.description).toBeTruthy();
      expect(translation.fields?.privateNetworkAllowlist).toBeTruthy();
    }
  });
});

describe('browser ownership', () => {
  const context = (identity: any, contribution: number | null = identity?.elowenUserId ?? null) => ({
    currentIdentity: () => identity,
    currentSessionId: () => 'brain-1',
    currentContributionUserId: () => contribution,
  });

  it('accepts only linked private human turns', () => {
    expect(requireBrowserToolOwner(context({ elowenUserId: 7, conversation: 'own' }) as any)).toEqual({ userId: 7, conversationId: 'brain-1' });
    expect(() => requireBrowserToolOwner(context({ conversation: 'direct' }) as any)).toThrow(/linked Elowen account/);
    expect(() => requireBrowserToolOwner(context({ elowenUserId: 7, conversation: 'shared' }) as any)).toThrow(/shared rooms/);
    expect(() => requireBrowserToolOwner(context({ elowenUserId: 7, conversation: 'delegated' }) as any)).toThrow(/delegated child/);
    expect(() => requireBrowserToolOwner(context({ elowenUserId: 7, conversation: 'direct' }, 8) as any)).toThrow(/delegated child/);
  });
});

describe('browser tool and API denial behavior', () => {
  it('throws from tools instead of returning failure text', async () => {
    const tools: any[] = [];
    const ctx = {
      currentIdentity: () => null,
      currentSessionId: () => 'brain-1',
      currentContributionUserId: () => null,
      registerTool: (tool: unknown) => tools.push(tool),
    };
    registerBrowserTools(ctx as any, {} as any);
    const open = tools.find((tool) => tool.name === 'BrowserOpen');
    await expect(open.execute('call-1', {}, undefined)).rejects.toThrow(/linked Elowen account/);
  });

  it('uses authenticated API ownership and hides foreign sessions', async () => {
    const routes: any[] = [];
    const ctx = { registerApiRoute: (route: unknown) => routes.push(route) };
    const registry = { getOwned: () => { throw new Error('Browser session not found.'); } };
    registerBrowserApi(ctx as any, registry as any);
    const route = routes.find((item) => item.path === 'session' && item.method === 'GET');
    const response = await route.handler({
      auth: { userId: 2, admin: false, tokenScope: 'user', accessibleProjects: [] },
      query: { sessionId: 'foreign-session' }, params: {}, method: 'GET', path: '', headers: {},
      body: async () => Buffer.alloc(0), json: async () => ({ userId: 1 }),
    });
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'Browser session not found.' });
  });
});

describe('browser network policy', () => {
  it('denies private, loopback, metadata and mixed DNS answers', async () => {
    const resolver: HostResolver = { resolve: async () => [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.8', family: 4 }] };
    await expect(new NavigationPolicy([], resolver).resolve('https://example.com')).rejects.toBeInstanceOf(NavigationPolicyError);
    await expect(new NavigationPolicy([]).resolve('http://127.0.0.1')).rejects.toThrow(/blocked network/);
    await expect(new NavigationPolicy([]).resolve('http://[::1]')).rejects.toThrow(/blocked network/);
    await expect(new NavigationPolicy([]).resolve('http://[::ffff:127.0.0.1]')).rejects.toThrow(/blocked network/);
    await expect(new NavigationPolicy([]).resolve('http://[::ffff:10.0.0.1]')).rejects.toThrow(/blocked network/);
    await expect(new NavigationPolicy([]).resolve('http://[::ffff:169.254.169.254]')).rejects.toThrow(/blocked network/);
    await expect(new NavigationPolicy([]).resolve('http://169.254.169.254/latest/meta-data')).rejects.toThrow(/blocked network/);
    expect(() => new NavigationPolicy([]).validateUrl('file:///etc/passwd')).toThrow(/Only http and https/);
  });

  it('allows only explicit private host or CIDR exceptions', async () => {
    const resolver: HostResolver = { resolve: async () => [{ address: '10.20.30.40', family: 4 }] };
    await expect(new NavigationPolicy(['dev.internal'], resolver).resolve('https://dev.internal')).resolves.toMatchObject({ address: '10.20.30.40' });
    await expect(new NavigationPolicy(['10.20.0.0/16'], resolver).resolve('https://other.internal')).resolves.toMatchObject({ address: '10.20.30.40' });
    await expect(new NavigationPolicy(['10.21.0.0/16'], resolver).resolve('https://other.internal')).rejects.toThrow(/blocked network/);
  });

  it('pins proxy-chain lookup to the approved IP across DNS rebinding', async () => {
    let prepare!: (request: ProxyChainPrepareRequest) => Promise<ProxyChainPrepareResult>;
    class FakeProxyServer implements ProxyChainServerLike {
      port = 3210;
      constructor(options: { prepareRequestFunction(request: ProxyChainPrepareRequest): Promise<ProxyChainPrepareResult> }) {
        prepare = options.prepareRequestFunction;
      }
      async listen(): Promise<void> {}
      async close(): Promise<void> {}
    }
    const adapter = new DynamicProxyChainAdapter(async () => ({ Server: FakeProxyServer as any }));
    let addresses = [{ address: '93.184.216.34', family: 4 as const }];
    const policy = new NavigationPolicy([], { resolve: async () => addresses });
    const server = await adapter.createServer({
      username: 'browser-user', password: 'secret', maxConcurrency: 2, requestsPerMinute: 20,
      resolve: (url) => policy.resolve(url),
    });
    expect(server.url).toBe('http://127.0.0.1:3210');
    const prepared = await prepare({
      username: 'browser-user', password: 'secret', hostname: 'example.com', port: 443, isHttp: false, connectionId: 'c1',
    });
    expect(prepared.ipFamily).toBe(4);
    addresses = [{ address: '10.0.0.8', family: 4 }];
    await expect(policy.resolve('https://example.com')).rejects.toThrow(/blocked network/);
    const lookup = (hostname: string) => new Promise<{ address: string; family: number }>((resolve, reject) => {
      prepared.dnsLookup!(hostname, {}, (error, address, family) => {
        if (error) reject(error);
        else resolve({ address: address as string, family: family! });
      });
    });
    await expect(lookup('example.com')).resolves.toEqual({ address: '93.184.216.34', family: 4 });
    await expect(lookup('other.example.com')).rejects.toMatchObject({ code: 'ENOTFOUND' });
    await server.close();
  });
});

describe('browser process pool', () => {
  it('deduplicates concurrent launches per user and isolates profile paths', async () => {
    const root = mkdtempSync(join(tmpdir(), 'browser-pool-')); roots.push(root);
    const executable = join(root, 'chrome'); writeFileSync(executable, '#!/bin/sh\n'); chmodSync(executable, 0o755);
    const store = new BrowserStore(pluginDb());
    let launches = 0;
    const processFactory: BrowserProcessFactory = {
      dependencyAvailable: async () => true,
      launch: async (options) => {
        launches += 1;
        await tick();
        return new FakeBrowser({ executablePath: options.executablePath, profilePath: options.userDataDir });
      },
    };
    const proxyFactory: BrowserProxyFactory = {
      safePinningAvailable: true,
      open: async (userId) => ({ url: 'http://127.0.0.1:3000', username: `u${userId}`, password: 'secret', close: async () => {} }),
      closeAll: async () => {},
    };
    const processInspector: ProcessInspector = {
      inspect: (pid) => {
        const record = fakeProcesses.get(pid);
        return record ? {
          pid, startedAtTicks: String(pid), executablePath: record.executablePath,
          args: [`--user-data-dir=${record.profilePath}`], rssBytes: 1024,
        } : null;
      },
      terminate: () => {},
    };
    const pool = new BrowserPool({ dataDir: root, config: () => config({ chromeExecutable: executable }), store, proxyFactory, processFactory, processInspector, logger });
    const opened = await Promise.all([pool.openPage(1, 's1'), pool.openPage(1, 's2')]);
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(opened.every(({ page }) => !page.isClosed?.())).toBe(true);
    expect(opened.map(({ page }) => (page as FakePage).credentials)).toEqual([null, null]);
    const firstPage = opened[0]!.page as FakePage;
    expect(firstPage.cdp.calls.some((call) => call.method === 'Fetch.enable')).toBe(true);
    firstPage.cdp.emit('Fetch.authRequired', { requestId: 'proxy-auth', authChallenge: { source: 'Proxy' } });
    firstPage.cdp.emit('Fetch.authRequired', { requestId: 'server-auth', authChallenge: { source: 'Server' } });
    await tick();
    expect(firstPage.cdp.calls.find((call) => call.method === 'Fetch.continueWithAuth' && call.params?.requestId === 'proxy-auth')?.params)
      .toMatchObject({ authChallengeResponse: { response: 'ProvideCredentials', username: 'u1', password: 'secret' } });
    expect(firstPage.cdp.calls.find((call) => call.method === 'Fetch.continueWithAuth' && call.params?.requestId === 'server-auth')?.params)
      .toMatchObject({ authChallengeResponse: { response: 'CancelAuth' } });
    expect(launches).toBe(1);
    expect(pool.activeSessionCount(1)).toBe(2);
    await pool.openPage(2, 's3');
    expect(launches).toBe(2);
    expect(pool.profilePath(1)).toBe(join(root, 'profiles', 'u-1'));
    expect(pool.profilePath(2)).toBe(join(root, 'profiles', 'u-2'));
    await pool.closeAll();
  });
});

describe('screencast hub', () => {
  it('ACKs every frame and keeps only the latest pending frame per subscriber', async () => {
    const cdp = new FakeCdp();
    const budget = new StreamBudget(() => 10_000_000);
    const hub = new ScreencastHub(cdp, () => config({ maxViewersPerSession: 1 }), budget, logger);
    const delivered: string[] = [];
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const unsubscribe = await hub.subscribe('viewer-1', async (frame) => {
      delivered.push(frame.data);
      if (delivered.length === 1) await firstBlocked;
    });
    await expect(hub.subscribe('viewer-2', async () => {})).rejects.toThrow(/viewer limit/);
    cdp.emit('Page.screencastFrame', { sessionId: 1, data: 'one', metadata: { deviceWidth: 100, deviceHeight: 80 } });
    cdp.emit('Page.screencastFrame', { sessionId: 2, data: 'two', metadata: { deviceWidth: 100, deviceHeight: 80 } });
    cdp.emit('Page.screencastFrame', { sessionId: 3, data: 'three', metadata: { deviceWidth: 100, deviceHeight: 80 } });
    await tick();
    releaseFirst();
    await tick(); await tick();
    expect(cdp.calls.filter((call) => call.method === 'Page.screencastFrameAck')).toHaveLength(3);
    expect(delivered).toEqual(['one', 'three']);
    await unsubscribe();
    expect(cdp.calls.some((call) => call.method === 'Page.stopScreencast')).toBe(true);
    await hub.close();
  });
});

describe('browser takeover state machine', () => {
  async function createSession() {
    const store = new BrowserStore(pluginDb());
    const now = Date.now();
    store.createSession({
      id: 'session-1234567890', ownerUserId: 1, conversationId: 'brain-1', artifactRef: null,
      primaryTargetId: null, state: 'creating', createdAt: now, updatedAt: now, lastActivityAt: now,
      hardExpiresAt: now + 60_000, closedAt: null, closeReason: null,
    });
    const browser = new FakeBrowser();
    const page = await browser.newPage() as FakePage;
    const tabs = new TabManager(browser, () => 12, logger);
    tabs.registerPrimary('session-1234567890', page);
    const session = await BrowserSession.create({
      id: 'session-1234567890', ownerUserId: 1, conversationId: 'brain-1', createdAt: now, hardExpiresAt: now + 60_000,
      page, tabs, config: () => config({ takeoverLeaseMs: 30_000 }), store, artifacts: UNAVAILABLE_ARTIFACT_PUBLISHER,
      streamBudget: new StreamBudget(() => 10_000_000), clock: { now: () => Date.now(), sleep: async () => {} }, logger,
      releasePage: async () => { await tabs.closeSession('session-1234567890'); }, forceCloseBrowser: async () => {}, onClosed: () => {},
    });
    const events: any[] = [];
    await session.subscribeEvents('test-events', async (event) => { events.push(event); });
    return { session, page, events };
  }

  it('rejects concurrent claims and keeps stale leases unable to heartbeat or release without broadcasting the token', async () => {
    const { session, events } = await createSession();
    const first = await session.claimTakeover();
    expect(session.currentLease).toEqual({ expiresAt: first.expiresAt });
    expect(events.at(-1)).toMatchObject({ kind: 'control', data: { state: 'user', expiresAt: first.expiresAt } });
    expect(events.at(-1).data).not.toHaveProperty('leaseId');
    await expect(session.claimTakeover()).rejects.toThrow(/already under user control/);
    await session.releaseTakeover(first.leaseId);
    const second = await session.claimTakeover();
    expect(first.leaseId).not.toBe(second.leaseId);
    await expect(session.heartbeat(first.leaseId)).rejects.toThrow(/stale or invalid/);
    await expect(session.releaseTakeover(first.leaseId)).rejects.toThrow(/stale or invalid/);
    await session.releaseTakeover(second.leaseId);
    expect(session.state).toBe('agent');
    await session.close();
  });

  it('pauses agent reads and invalidates cached snapshots after user input', async () => {
    const { session, page } = await createSession();
    await session.snapshot(false);
    const before = page.cdp.calls.filter((call) => call.method === 'Accessibility.getFullAXTree').length;
    const lease = await session.claimTakeover();
    const pending = session.snapshot(false);
    await tick();
    expect(page.cdp.calls.filter((call) => call.method === 'Accessibility.getFullAXTree')).toHaveLength(before);
    await session.dispatchUserInput(lease.leaseId, [{ type: 'key', action: 'down', key: 'Enter' }]);
    await session.releaseTakeover(lease.leaseId);
    await pending;
    expect(page.cdp.calls.filter((call) => call.method === 'Accessibility.getFullAXTree')).toHaveLength(before + 1);
    await session.close();
  });

  it('serializes agent input behind takeover and abort returns control', async () => {
    const { session, page } = await createSession();
    const lease = await session.claimTakeover();
    const pressing = session.pressKey('Enter', undefined);
    await tick();
    expect(page.cdp.calls.some((call) => call.method === 'Input.dispatchKeyEvent')).toBe(false);
    await session.releaseTakeover(lease.leaseId);
    await pressing;
    expect(page.cdp.calls.filter((call) => call.method === 'Input.dispatchKeyEvent')).toHaveLength(2);

    const controller = new AbortController();
    const takeover = session.requestTakeoverForAgent(controller.signal);
    await tick();
    controller.abort(new Error('tool aborted'));
    await expect(takeover).rejects.toThrow(/tool aborted/);
    expect(session.state).toBe('agent');
    expect(session.currentLease).toBeNull();
    await session.close();
  });
});
