// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PuppeteerCoreFactory, detectChrome, installProxyAuthentication } from '../plugins/browser/src/browser-launcher.js';
import { DynamicProxyChainAdapter, EnforcingProxyManager } from '../plugins/browser/src/navigation-policy.js';
import { resolveConfig } from '../plugins/browser/src/config.js';
import { ScreencastHub, StreamBudget } from '../plugins/browser/src/screencast-hub.js';
import type { CDPSessionLike } from '../plugins/browser/src/types.js';

const roots: string[] = [];
let server: Server | null = null;
afterEach(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
  server = null;
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

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
  real('launches sandboxed Chrome through the pinned proxy and emits a CDP frame', async () => {
    const executablePath = detectChrome(null);
    expect(executablePath).toBeTruthy();
    const pageUrl = await fixture();
    const config = () => resolveConfig({
      privateNetworkAllowlist: ['127.0.0.1'],
      chromeExecutable: executablePath,
      browserCloseGraceSeconds: 0,
      webFps: 4,
    });
    const proxy = new EnforcingProxyManager(config, new DynamicProxyChainAdapter(), logger);
    const lease = await proxy.open(1);
    const profile = mkdtempSync(join(tmpdir(), 'elowen-browser-e2e-'));
    roots.push(profile);
    const browser = await new PuppeteerCoreFactory().launch({
      executablePath: executablePath!, userDataDir: profile, proxyUrl: lease.url, viewport: { width: 960, height: 600 },
    });
    try {
      const page = await browser.newPage();
      await installProxyAuthentication(page, lease);
      await page.goto(pageUrl.url, { waitUntil: 'domcontentloaded', timeout: 15_000 });
      expect(await page.title()).toBe('Browser smoke');
      const cdp = await page.createCDPSession();
      await cdp.send('Page.enable');
      const hub = new ScreencastHub(
        cdp as unknown as CDPSessionLike,
        config,
        new StreamBudget(() => config().globalStreamBytesPerSecond),
        logger,
      );
      let resolveFrame!: (frame: { data: string }) => void;
      const frame = new Promise<{ data: string }>((resolve) => { resolveFrame = resolve; });
      await hub.subscribe('static-page-viewer', async (captured) => { resolveFrame(captured); });
      const captured = await Promise.race([
        frame,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('no screencast frame')), 10_000)),
      ]);
      expect(captured.data.length).toBeGreaterThan(100);
      await hub.close();

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
    const browser = await new PuppeteerCoreFactory().launch({
      executablePath: executablePath!, userDataDir: profile, proxyUrl: lease.url, viewport: { width: 800, height: 500 },
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
