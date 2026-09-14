// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CaptureRefused, MAX_CAPTURE_BYTES, MAX_CAPTURE_WIDTH, createSiteCaptureControl,
  normalizeCaptureRequest, validateCaptureHeaders, validateCaptureUrl,
  type CaptureBrowserLike, type CaptureLauncher, type CapturePageLike, type SiteCaptureDeps,
} from '../plugins/browser/src/site-capture.js';
import type {
  HostResolver, PinnedTarget, ProxyChainPinnedAdapter, PinnedProxyServer,
} from '../plugins/browser/src/navigation-policy.js';

const roots: string[] = [];
const tempRoot = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'capture-test-'));
  roots.push(dir);
  return dir;
};
const stubChrome = (dir: string): string => {
  const path = join(dir, 'chrome');
  writeFileSync(path, '#!/bin/sh\nexit 0\n');
  chmodSync(path, 0o755);
  return path;
};
const noopLog = { info() {}, warn() {}, error() {} };
const PUBLIC_ADDRESS = '93.184.216.34';
const publicResolver: HostResolver = { resolve: async () => [{ address: PUBLIC_ADDRESS, family: 4 }] };

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

afterEach(() => { while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true }); });

interface FakeRun {
  userDataDir?: string;
  proxyUrl?: string;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  auth?: { username: string; password: string };
  viewport?: { width: number; height: number; deviceScaleFactor: number };
  url?: string;
  finalUrl: string;
  screenshotOptions?: Record<string, unknown>;
  screenshotCalled: boolean;
  browserClosed: boolean;
  processKilled: boolean;
  proxyClosed: boolean;
  cdpCalls: Array<{ method: string; params?: Record<string, unknown> }>;
  proxyResolve?: (url: string) => Promise<PinnedTarget>;
  pinnedTargets: PinnedTarget[];
}

interface FakeOptions {
  status?: number;
  bytes?: number;
  failClose?: boolean;
  killAvailable?: boolean;
  failProxyClose?: boolean;
  launchGate?: Promise<void>;
  pageGate?: Promise<void>;
  finalUrl?: string;
  requests?: string[];
}

function fakeNetwork(run: FakeRun, options: FakeOptions = {}): ProxyChainPinnedAdapter {
  return {
    available: true,
    async dependencyAvailable() { return true; },
    async createServer(input): Promise<PinnedProxyServer> {
      run.proxyResolve = async (url) => {
        const target = await input.resolve(url);
        run.pinnedTargets.push(target);
        return target;
      };
      return {
        url: 'http://127.0.0.1:32123',
        async close() {
          if (options.failProxyClose) throw new Error('proxy close failed');
          run.proxyClosed = true;
        },
      };
    },
  };
}

function fakeLauncher(options: FakeOptions = {}): { launch: CaptureLauncher; run: FakeRun; proxyAdapter: ProxyChainPinnedAdapter } {
  const run: FakeRun = {
    finalUrl: options.finalUrl ?? 'https://demo.sites.example.com/',
    screenshotCalled: false,
    browserClosed: false,
    processKilled: false,
    proxyClosed: false,
    cdpCalls: [],
    pinnedTargets: [],
  };
  const page: CapturePageLike = {
    async setViewport(viewport) { run.viewport = viewport; },
    async setExtraHTTPHeaders(headers) { run.headers = headers; },
    async authenticate(credentials) { run.auth = credentials; },
    async goto(url) {
      run.url = url;
      await run.proxyResolve?.(url);
      for (const requestUrl of options.requests ?? []) await run.proxyResolve?.(requestUrl);
      await options.pageGate;
      return { status: () => options.status ?? 200 };
    },
    url() { return run.finalUrl; },
    async screenshot(screenshotOptions) {
      run.screenshotCalled = true;
      run.screenshotOptions = screenshotOptions;
      return new Uint8Array(options.bytes ?? 1024);
    },
    async createCDPSession() {
      return { async send(method, params) { run.cdpCalls.push({ method, params }); return {}; } };
    },
  };
  const browser: CaptureBrowserLike = {
    async newPage() { return page; },
    async close() {
      if (options.failClose) throw new Error('wedged browser');
      run.browserClosed = true;
    },
    process: () => options.killAvailable === false ? null : ({ kill() { run.processKilled = true; } }),
  };
  return {
    run,
    proxyAdapter: fakeNetwork(run, options),
    launch: async ({ userDataDir, proxyUrl, signal }) => {
      run.userDataDir = userDataDir;
      run.proxyUrl = proxyUrl;
      run.signal = signal;
      mkdirSync(userDataDir, { recursive: true });
      await options.launchGate;
      return browser;
    },
  };
}

function controlOver(
  dir: string,
  fake: ReturnType<typeof fakeLauncher>,
  overrides: Partial<SiteCaptureDeps> = {},
) {
  return createSiteCaptureControl({
    dataDir: () => dir,
    chromeExecutable: () => stubChrome(dir),
    logger: noopLog,
    proxyConcurrency: () => 96,
    proxyRequestsPerMinute: () => 3000,
    launch: fake.launch,
    proxyAdapter: fake.proxyAdapter,
    resolver: publicResolver,
    dependencyAvailable: async () => true,
    networkDependencyAvailable: async () => true,
    ...overrides,
  });
}

const request = (overrides: Record<string, unknown> = {}) => ({
  url: 'https://demo.sites.example.com/',
  viewport: { width: 1280, height: 800 },
  ...overrides,
}) as Parameters<ReturnType<typeof controlOver>['capture']>[0];

describe('browserCapture — exact public HTTPS origin', () => {
  it('takes one hostname-based absolute HTTPS URL and nothing else', () => {
    expect(validateCaptureUrl('https://demo.sites.example.com/').hostname).toBe('demo.sites.example.com');
    expect(() => validateCaptureUrl('http://demo.sites.example.com/')).toThrow(CaptureRefused);
    expect(() => validateCaptureUrl('https://127.0.0.1/')).toThrow(CaptureRefused);
    expect(() => validateCaptureUrl('https://10.1.2.3/')).toThrow(CaptureRefused);
    expect(() => validateCaptureUrl('https://169.254.169.254/')).toThrow(CaptureRefused);
    expect(() => validateCaptureUrl('https://93.184.216.34/')).toThrow(CaptureRefused);
    expect(() => validateCaptureUrl('/relative')).toThrow(CaptureRefused);
    expect(() => validateCaptureUrl('file:///etc/passwd')).toThrow(CaptureRefused);
    expect(() => validateCaptureUrl('data:text/html,<p>hi')).toThrow(CaptureRefused);
    expect(() => validateCaptureUrl(`https://demo.test/${'a'.repeat(4000)}`)).toThrow(CaptureRefused);
  });

  it('refuses URL credentials and hosts resolving to loopback, private or link-local addresses', async () => {
    expect(() => validateCaptureUrl('https://user:pass@demo.sites.example.com/')).toThrow(CaptureRefused);
    for (const address of ['127.0.0.1', '10.2.3.4', '169.254.169.254', '::1', 'fe80::1']) {
      const dir = tempRoot();
      const fake = fakeLauncher();
      const resolver: HostResolver = { resolve: async () => [{ address, family: address.includes(':') ? 6 : 4 }] };
      await expect(controlOver(dir, fake, { resolver }).capture(request())).rejects.toThrow(/blocked network address/);
      expect(fake.run.userDataDir).toBeUndefined();
    }
  });

  it('pins the first validated address and never resolves again through the capture proxy', async () => {
    const dir = tempRoot();
    const fake = fakeLauncher();
    let calls = 0;
    const resolver: HostResolver = {
      resolve: async () => {
        calls += 1;
        return calls === 1
          ? [{ address: PUBLIC_ADDRESS, family: 4 }]
          : [{ address: '127.0.0.1', family: 4 }];
      },
    };
    await controlOver(dir, fake, { resolver }).capture(request());
    expect(calls).toBe(1);
    expect(fake.run.pinnedTargets).not.toHaveLength(0);
    expect(fake.run.pinnedTargets.every((target) => target.addresses.map((entry) => entry.address).join(',') === PUBLIC_ADDRESS)).toBe(true);
  });

  it('blocks cross-origin redirects and subresources before Chrome can accept an error page as success', async () => {
    for (const other of ['https://other.example/', 'https://127.0.0.1/', 'https://10.0.0.5/', 'https://169.254.169.254/']) {
      const dir = tempRoot();
      const fake = fakeLauncher({ requests: [other] });
      await expect(controlOver(dir, fake).capture(request())).rejects.toThrow(/permits only/);
      expect(fake.run.screenshotCalled).toBe(false);
      expect(fake.run.browserClosed).toBe(true);
      expect(fake.run.proxyClosed).toBe(true);
    }
  });

  it('checks the final document origin even if a browser reports a successful response', async () => {
    const dir = tempRoot();
    const fake = fakeLauncher({ finalUrl: 'chrome-error://chromewebdata/' });
    await expect(controlOver(dir, fake).capture(request())).rejects.toThrow(/redirected to another origin/);
    expect(fake.run.screenshotCalled).toBe(false);
  });
});

describe('browserCapture — headers and bounds', () => {
  it('passes ordinary headers and proxy authentication through separate channels', async () => {
    expect(validateCaptureHeaders({ 'x-elowen-site-capture': 'token' })).toEqual({ 'x-elowen-site-capture': 'token' });
    const dir = tempRoot();
    const fake = fakeLauncher();
    await controlOver(dir, fake).capture(request({ headers: { 'x-elowen-site-capture': 'abc' } }));
    expect(fake.run.headers).toEqual({ 'x-elowen-site-capture': 'abc' });
    expect(fake.run.auth?.username).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(fake.run.auth?.password).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(fake.run.proxyUrl).toBe('http://127.0.0.1:32123');
  });

  it('refuses transport headers and injected values', () => {
    expect(() => validateCaptureHeaders({ host: 'other.test' })).toThrow(CaptureRefused);
    expect(() => validateCaptureHeaders({ Host: 'other.test' })).toThrow(CaptureRefused);
    expect(() => validateCaptureHeaders({ 'proxy-authorization': 'x' })).toThrow(CaptureRefused);
    expect(() => validateCaptureHeaders({ 'x-a': 'good\r\nx-evil: yes' })).toThrow(CaptureRefused);
    expect(() => validateCaptureHeaders({ 'x bad name': 'v' })).toThrow(CaptureRefused);
  });

  it('refuses viewport, deadline and format values outside the contract', () => {
    expect(() => normalizeCaptureRequest(request({ viewport: { width: 10, height: 10 } }))).toThrow(CaptureRefused);
    expect(() => normalizeCaptureRequest(request({ viewport: { width: MAX_CAPTURE_WIDTH + 1, height: 800 } }))).toThrow(CaptureRefused);
    expect(() => normalizeCaptureRequest(request({ viewport: { width: 1280.5, height: 800 } }))).toThrow(CaptureRefused);
    expect(() => normalizeCaptureRequest(request({ viewport: { width: 1280, height: 800, deviceScaleFactor: 4 } }))).toThrow(CaptureRefused);
    expect(() => normalizeCaptureRequest(request({ timeoutMs: 1 }))).toThrow(CaptureRefused);
    expect(() => normalizeCaptureRequest(request({ timeoutMs: 600_000 }))).toThrow(CaptureRefused);
    expect(() => normalizeCaptureRequest(request({ format: 'gif' }))).toThrow(CaptureRefused);
  });

  it('clamps byte storage and refuses oversized or error responses', async () => {
    expect(normalizeCaptureRequest(request({ maxBytes: 10 * MAX_CAPTURE_BYTES })).maxBytes).toBe(MAX_CAPTURE_BYTES);
    const tooLarge = fakeLauncher({ bytes: 5000 });
    await expect(controlOver(tempRoot(), tooLarge).capture(request({ maxBytes: 1000 }))).rejects.toThrow(/over the/);
    const errorPage = fakeLauncher({ status: 404 });
    await expect(controlOver(tempRoot(), errorPage).capture(request())).rejects.toThrow(/404/);
    expect(errorPage.run.screenshotCalled).toBe(false);
  });

  it('denies downloads and returns the requested rendered dimensions', async () => {
    const dir = tempRoot();
    const fake = fakeLauncher();
    const result = await controlOver(dir, fake).capture(request({ viewport: { width: 1200, height: 750, deviceScaleFactor: 2 } }));
    expect(result).toMatchObject({ mimeType: 'image/webp', width: 2400, height: 1500 });
    expect(fake.run.cdpCalls).toContainEqual({ method: 'Browser.setDownloadBehavior', params: { behavior: 'deny' } });
    expect(fake.run.screenshotOptions).toMatchObject({ type: 'webp', fullPage: false, captureBeyondViewport: false });
  });
});

describe('browserCapture — timeout and lifecycle ownership', () => {
  it('keeps the slot until a launch that completed after timeout is closed and its profile is removed', async () => {
    const dir = tempRoot();
    const launchGate = deferred<void>();
    const fake = fakeLauncher({ launchGate: launchGate.promise });
    const control = controlOver(dir, fake);
    const first = control.capture(request({ timeoutMs: 1_000 }));
    await pause(1_050);
    expect(fake.run.signal?.aborted).toBe(true);
    await expect(control.capture(request())).rejects.toThrow(/already running/);
    launchGate.resolve();
    await expect(first).rejects.toThrow(/did not finish in time/);
    expect(fake.run.browserClosed).toBe(true);
    expect(existsSync(fake.run.userDataDir!)).toBe(false);

    const next = fakeLauncher();
    const nextControl = controlOver(tempRoot(), next);
    await expect(nextControl.capture(request())).resolves.toBeTruthy();
  });

  it('disposes deterministically while launch is pending', async () => {
    const dir = tempRoot();
    const launchGate = deferred<void>();
    const fake = fakeLauncher({ launchGate: launchGate.promise });
    const control = controlOver(dir, fake);
    const capture = control.capture(request());
    await pause(0);
    const disposal = control.dispose();
    expect(fake.run.signal?.aborted).toBe(true);
    launchGate.resolve();
    await disposal;
    await expect(capture).rejects.toThrow(/stopping/);
    expect(fake.run.browserClosed).toBe(true);
    expect(fake.run.proxyClosed).toBe(true);
    expect(existsSync(fake.run.userDataDir!)).toBe(false);
    expect(control.available()).toBe(false);
  });

  it('disposes during an active page capture and keeps concurrency at one', async () => {
    const dir = tempRoot();
    const pageGate = deferred<void>();
    const fake = fakeLauncher({ pageGate: pageGate.promise });
    const control = controlOver(dir, fake);
    const capture = control.capture(request());
    await pause(0);
    await expect(control.capture(request())).rejects.toThrow(/already running/);
    const disposal = control.dispose();
    pageGate.resolve();
    await disposal;
    await expect(capture).rejects.toThrow(/stopping/);
    expect(fake.run.browserClosed).toBe(true);
    expect(fake.run.proxyClosed).toBe(true);
  });
});

describe('browserCapture — cleanup and availability', () => {
  it('closes the browser and proxy and removes the throwaway profile after success or failure', async () => {
    for (const status of [200, 500]) {
      const dir = tempRoot();
      const fake = fakeLauncher({ status });
      const capture = controlOver(dir, fake).capture(request());
      if (status === 200) await capture;
      else await expect(capture).rejects.toThrow(/500/);
      expect(fake.run.browserClosed).toBe(true);
      expect(fake.run.proxyClosed).toBe(true);
      expect(existsSync(fake.run.userDataDir!)).toBe(false);
    }
  });

  it('kills a browser that refuses graceful close', async () => {
    const fake = fakeLauncher({ failClose: true });
    await controlOver(tempRoot(), fake).capture(request());
    expect(fake.run.processKilled).toBe(true);
  });

  it('turns profile or proxy cleanup failure into capture failure', async () => {
    const profile = fakeLauncher();
    await expect(controlOver(tempRoot(), profile, { removeProfile: () => { throw new Error('profile busy'); } }).capture(request()))
      .rejects.toThrow(/cleanup failed/);
    const proxy = fakeLauncher({ failProxyClose: true });
    await expect(controlOver(tempRoot(), proxy).capture(request())).rejects.toThrow(/cleanup failed/);
  });

  it('reports unavailable without Chrome or either runtime dependency', async () => {
    const dir = tempRoot();
    const fake = fakeLauncher();
    const noChrome = createSiteCaptureControl({
      dataDir: () => dir,
      chromeExecutable: () => join(dir, 'no-such-chrome'),
      logger: noopLog,
      proxyConcurrency: () => 96,
      proxyRequestsPerMinute: () => 3000,
      launch: fake.launch,
      proxyAdapter: fake.proxyAdapter,
      dependencyAvailable: async () => true,
      networkDependencyAvailable: async () => true,
    });
    expect(noChrome.available()).toBe(false);

    const unavailable = controlOver(tempRoot(), fake, { networkDependencyAvailable: async () => false });
    await pause(0);
    expect(unavailable.available()).toBe(false);
  });
});
