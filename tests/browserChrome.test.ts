// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { PluginDb } from 'elowen/plugin-api';
import { PuppeteerCoreFactory, detectChrome, installProxyAuthentication } from '../plugins/browser/src/browser-launcher.js';
import { DynamicProxyChainAdapter, EnforcingProxyManager } from '../plugins/browser/src/navigation-policy.js';
import { resolveConfig } from '../plugins/browser/src/config.js';
import { VirtualDisplayPool } from '../plugins/browser/src/virtual-display.js';
import { BrowserStore } from '../plugins/browser/src/store.js';
import type { ProcessInspector } from '../plugins/browser/src/types.js';

const roots: string[] = [];
const displayPools: VirtualDisplayPool[] = [];
let server: Server | null = null;
afterEach(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
  server = null;
  while (displayPools.length) await displayPools.pop()!.releaseAll();
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

/** Enough of a database for the display pool to write its ownership record into. */
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
    appliedVersion: () => 0,
    transaction: <T>(fn: () => T) => raw.transaction(fn)(),
  };
  return handle as PluginDb;
}

const inspector: ProcessInspector = { inspect: () => null, terminate: () => {} };

/** A managed browser is always headed now, so even this proxy smoke test needs a display to draw on. */
async function display(): Promise<{ display: string; xauthPath: string; width: number; height: number }> {
  const dir = mkdtempSync(join(tmpdir(), 'elowen-browser-display-'));
  roots.push(dir);
  const pool = new VirtualDisplayPool({
    dataDir: dir, config: () => resolveConfig({}), store: new BrowserStore(pluginDb()), processInspector: inspector, logger,
  });
  displayPools.push(pool);
  return pool.acquire(1);
}

const real = process.env.ELOWEN_BROWSER_E2E === '1' ? it : it.skip;
const logger = { debug() {}, info() {}, warn() {}, error() {} };

async function fixture(): Promise<{ url: string }> {
  server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    if (request.url === '/alert') {
      response.end('<!doctype html><script>alert("hello");document.title="Alert handled"</script>');
      return;
    }
    if (request.url === '/beforeunload') {
      response.end('<!doctype html><title>Form page</title><script>onbeforeunload=()=>"unsaved"</script>');
      return;
    }
    if (request.url === '/landed') {
      response.end('<!doctype html><title>Landed</title>');
      return;
    }
    response.end('<!doctype html><title>Browser smoke</title><button id="continue">Continue</button>');
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture did not bind');
  return { url: `http://127.0.0.1:${address.port}/` };
}

describe('browser real Chrome flow', () => {
  real('launches sandboxed Chrome on a private display through the pinned proxy', async () => {
    const executablePath = detectChrome(null);
    expect(executablePath).toBeTruthy();
    const pageUrl = await fixture();
    const config = () => resolveConfig({
      privateNetworkAllowlist: ['127.0.0.1'],
      chromeExecutable: executablePath,
      browserCloseGraceSeconds: 0,
    });
    const proxy = new EnforcingProxyManager(config, new DynamicProxyChainAdapter(), logger);
    const lease = await proxy.open(1);
    const profile = mkdtempSync(join(tmpdir(), 'elowen-browser-e2e-'));
    roots.push(profile);
    const screen = await display();
    const browser = await new PuppeteerCoreFactory().launch({
      executablePath: executablePath!,
      userDataDir: profile,
      proxyUrl: lease.url,
      viewport: { width: screen.width, height: screen.height },
      display: { display: screen.display, xauthPath: screen.xauthPath },
    });
    try {
      const page = await browser.newPage();
      await installProxyAuthentication(page, lease);
      await page.goto(pageUrl.url, { waitUntil: 'domcontentloaded', timeout: 15_000 });
      expect(await page.title()).toBe('Browser smoke');

      await page.goto(`${pageUrl.url}alert`, { waitUntil: 'domcontentloaded', timeout: 5_000 });
      expect(await page.title()).toBe('Alert handled');
      await page.goto(`${pageUrl.url}beforeunload`, { waitUntil: 'domcontentloaded', timeout: 5_000 });
      await page.goto(`${pageUrl.url}landed`, { waitUntil: 'domcontentloaded', timeout: 5_000 });
      expect(await page.title()).toBe('Landed');
    } finally {
      await browser.close();
      await lease.close();
      await proxy.closeAll();
    }
  }, 30_000);

  real('refuses a loopback destination when it is not explicitly allowlisted', async () => {
    const executablePath = detectChrome(null);
    expect(executablePath).toBeTruthy();
    const pageUrl = await fixture();
    const config = () => resolveConfig({ privateNetworkAllowlist: [], chromeExecutable: executablePath, browserCloseGraceSeconds: 0 });
    const proxy = new EnforcingProxyManager(config, new DynamicProxyChainAdapter(), logger);
    const lease = await proxy.open(1);
    const profile = mkdtempSync(join(tmpdir(), 'elowen-browser-deny-'));
    roots.push(profile);
    const screen = await display();
    const browser = await new PuppeteerCoreFactory().launch({
      executablePath: executablePath!,
      userDataDir: profile,
      proxyUrl: lease.url,
      viewport: { width: screen.width, height: screen.height },
      display: { display: screen.display, xauthPath: screen.xauthPath },
    });
    try {
      const page = await browser.newPage();
      await installProxyAuthentication(page, lease);
      const response = await page.goto(pageUrl.url, { waitUntil: 'domcontentloaded', timeout: 10_000 }) as { ok?(): boolean; status?(): number } | null;
      expect(response?.ok?.()).toBe(false);
      expect(response?.status?.()).toBeGreaterThanOrEqual(400);
      expect(await page.title()).not.toBe('Browser smoke');
    } finally {
      await browser.close();
      await lease.close();
      await proxy.closeAll();
    }
  }, 20_000);
});
