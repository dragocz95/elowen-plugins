// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CaptureRefused, MAX_CAPTURE_BYTES, MAX_CAPTURE_WIDTH, createSiteCaptureControl,
  normalizeCaptureRequest, validateCaptureHeaders, validateCaptureUrl,
  type CaptureBrowserLike, type CaptureLauncher, type CapturePageLike,
} from '../plugins/browser/src/site-capture.js';

/** The `browserCapture` control: the seam that lets ONE approved sibling get a picture of a page the host
 *  serves, without ever touching an account's browser.
 *
 *  Everything asserted here is a refusal or a containment, because that is what this control is. The
 *  picture itself is Chrome's job; what makes the seam safe to publish is that a caller cannot widen the
 *  target, cannot carry an identity into the render, and cannot leave a browser or a profile behind. */

const roots: string[] = [];
const tempRoot = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'capture-test-'));
  roots.push(dir);
  return dir;
};
/** `detectChrome` wants a real executable file; the launcher is injected, so it is never run. */
const stubChrome = (dir: string): string => {
  const path = join(dir, 'chrome');
  writeFileSync(path, '#!/bin/sh\nexit 0\n');
  chmodSync(path, 0o755);
  return path;
};
const noopLog = { info() {}, warn() {}, error() {} };

afterEach(() => { while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true }); });

interface FakeRun {
  allowedHost?: string;
  userDataDir?: string;
  headers?: Record<string, string>;
  viewport?: { width: number; height: number; deviceScaleFactor: number };
  url?: string;
  screenshotOptions?: Record<string, unknown>;
  closed: boolean;
}

function fakeLauncher(options: { status?: number; bytes?: number; failClose?: boolean } = {}): { launch: CaptureLauncher; run: FakeRun } {
  const run: FakeRun = { closed: false };
  const page: CapturePageLike = {
    async setViewport(viewport) { run.viewport = viewport; },
    async setExtraHTTPHeaders(headers) { run.headers = headers; },
    async goto(url) { run.url = url; return { status: () => options.status ?? 200 }; },
    async screenshot(screenshotOptions) {
      run.screenshotOptions = screenshotOptions;
      return new Uint8Array(options.bytes ?? 1024);
    },
  };
  const browser: CaptureBrowserLike = {
    async newPage() { return page; },
    async close() {
      if (options.failClose) throw new Error('wedged');
      run.closed = true;
    },
    process: () => null,
  };
  return {
    run,
    launch: async ({ allowedHost, userDataDir }) => {
      run.allowedHost = allowedHost;
      run.userDataDir = userDataDir;
      return browser;
    },
  };
}

const controlOver = (dir: string, launch: CaptureLauncher) => createSiteCaptureControl({
  dataDir: () => dir,
  chromeExecutable: () => stubChrome(dir),
  logger: noopLog,
  launch,
  dependencyAvailable: async () => true,
});

const request = (overrides: Record<string, unknown> = {}) => ({
  url: 'https://demo.sites.example.com/',
  viewport: { width: 1280, height: 800 },
  ...overrides,
}) as Parameters<ReturnType<typeof controlOver>['capture']>[0];

describe('browserCapture — the target a capture is allowed to open', () => {
  it('takes an absolute http(s) URL and nothing else', () => {
    expect(validateCaptureUrl('https://demo.sites.example.com/').hostname).toBe('demo.sites.example.com');
    expect(() => validateCaptureUrl('/relative')).toThrow(CaptureRefused);
    expect(() => validateCaptureUrl('file:///etc/passwd')).toThrow(CaptureRefused);
    expect(() => validateCaptureUrl('data:text/html,<p>hi')).toThrow(CaptureRefused);
    expect(() => validateCaptureUrl(`https://demo.test/${'a'.repeat(4000)}`)).toThrow(CaptureRefused);
  });

  /** Credentials in a URL are a way to make a request carry an identity, which is the one thing a capture
   *  must never do: the render is nobody, on purpose. */
  it('refuses a URL carrying credentials', () => {
    expect(() => validateCaptureUrl('https://user:pass@demo.sites.example.com/')).toThrow(CaptureRefused);
  });

  /** The resolver rule is the containment. Anything the page reaches for that is not this host simply
   *  fails to resolve, so a redirect, an image or a `fetch()` cannot become a request somewhere else. */
  it('confines the browser name resolver to the target host', async () => {
    const dir = tempRoot();
    const { launch, run } = fakeLauncher();
    await controlOver(dir, launch).capture(request());
    expect(run.allowedHost).toBe('demo.sites.example.com');
  });
});

describe('browserCapture — headers a caller may set', () => {
  it('passes ordinary headers through', () => {
    expect(validateCaptureHeaders({ 'x-elowen-site-capture': 'token' })).toEqual({ 'x-elowen-site-capture': 'token' });
  });

  /** `Host` decides which virtual host answers, so a caller that could set it could turn a validated
   *  target into a different one without the URL ever changing. */
  it('refuses the headers that would redirect the request', () => {
    expect(() => validateCaptureHeaders({ host: 'other.test' })).toThrow(CaptureRefused);
    expect(() => validateCaptureHeaders({ Host: 'other.test' })).toThrow(CaptureRefused);
    expect(() => validateCaptureHeaders({ 'proxy-authorization': 'x' })).toThrow(CaptureRefused);
  });

  it('refuses a value that could inject another header', () => {
    expect(() => validateCaptureHeaders({ 'x-a': 'good\r\nx-evil: yes' })).toThrow(CaptureRefused);
    expect(() => validateCaptureHeaders({ 'x bad name': 'v' })).toThrow(CaptureRefused);
  });

  it('applies the caller headers to the navigation', async () => {
    const dir = tempRoot();
    const { launch, run } = fakeLauncher();
    await controlOver(dir, launch).capture(request({ headers: { 'x-elowen-site-capture': 'abc' } }));
    expect(run.headers).toEqual({ 'x-elowen-site-capture': 'abc' });
  });
});

describe('browserCapture — the bounds of one capture', () => {
  it('refuses a viewport outside the rendering bounds', () => {
    expect(() => normalizeCaptureRequest(request({ viewport: { width: 10, height: 10 } }))).toThrow(CaptureRefused);
    expect(() => normalizeCaptureRequest(request({ viewport: { width: MAX_CAPTURE_WIDTH + 1, height: 800 } }))).toThrow(CaptureRefused);
    expect(() => normalizeCaptureRequest(request({ viewport: { width: 1280.5, height: 800 } }))).toThrow(CaptureRefused);
    expect(() => normalizeCaptureRequest(request({ viewport: { width: 1280, height: 800, deviceScaleFactor: 4 } }))).toThrow(CaptureRefused);
  });

  it('refuses an unusable deadline or format', () => {
    expect(() => normalizeCaptureRequest(request({ timeoutMs: 1 }))).toThrow(CaptureRefused);
    expect(() => normalizeCaptureRequest(request({ timeoutMs: 600_000 }))).toThrow(CaptureRefused);
    expect(() => normalizeCaptureRequest(request({ format: 'gif' }))).toThrow(CaptureRefused);
  });

  /** A caller may ask for less than the ceiling, never for more: the cap is the control's, not the
   *  caller's, because the disk it protects is the host's. */
  it('clamps the byte cap to the control ceiling', () => {
    expect(normalizeCaptureRequest(request({ maxBytes: 10 * MAX_CAPTURE_BYTES })).maxBytes).toBe(MAX_CAPTURE_BYTES);
    expect(normalizeCaptureRequest(request({ maxBytes: 1024 })).maxBytes).toBe(1024);
  });

  it('refuses an image over the cap rather than re-encoding it', async () => {
    const dir = tempRoot();
    const { launch } = fakeLauncher({ bytes: 5000 });
    await expect(controlOver(dir, launch).capture(request({ maxBytes: 1000 }))).rejects.toThrow(/over the/);
  });

  /** A refusal page is not a picture of the site. Keeping one would show a person a preview of an error
   *  with nothing to say that is what they are looking at. */
  it('refuses a page that answered with an error status', async () => {
    const dir = tempRoot();
    const { launch } = fakeLauncher({ status: 404 });
    await expect(controlOver(dir, launch).capture(request())).rejects.toThrow(/404/);
  });

  it('returns the rendered size and mime type it was asked for', async () => {
    const dir = tempRoot();
    const { launch, run } = fakeLauncher();
    const result = await controlOver(dir, launch).capture(request({ viewport: { width: 1200, height: 750, deviceScaleFactor: 2 } }));
    expect(result.mimeType).toBe('image/webp');
    expect(result).toMatchObject({ width: 2400, height: 1500 });
    expect(run.screenshotOptions).toMatchObject({ type: 'webp', fullPage: false, captureBeyondViewport: false });
  });
});

describe('browserCapture — what a capture leaves behind', () => {
  it('closes the browser and removes the throwaway profile', async () => {
    const dir = tempRoot();
    const { launch, run } = fakeLauncher();
    await controlOver(dir, launch).capture(request());
    expect(run.closed).toBe(true);
    expect(run.userDataDir?.startsWith(join(dir, 'capture'))).toBe(true);
    expect(existsSync(run.userDataDir!)).toBe(false);
  });

  it('cleans up after a capture that failed', async () => {
    const dir = tempRoot();
    const { launch, run } = fakeLauncher({ status: 500 });
    await expect(controlOver(dir, launch).capture(request())).rejects.toThrow(CaptureRefused);
    expect(run.closed).toBe(true);
    expect(existsSync(run.userDataDir!)).toBe(false);
  });

  /** A browser that ignored `close()` must not keep the profile alive underneath the removal. */
  it('removes the profile even when the browser refuses to close', async () => {
    const dir = tempRoot();
    const { launch, run } = fakeLauncher({ failClose: true });
    await controlOver(dir, launch).capture(request());
    expect(existsSync(run.userDataDir!)).toBe(false);
  });

  /** One browser at a time, refused rather than queued: a consumer bug must not be able to fork a Chrome
   *  per site. The queue belongs to the consumer, which knows what is due and in what order. */
  it('refuses a second capture while one is running', async () => {
    const dir = tempRoot();
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const control = controlOver(dir, async ({ allowedHost, userDataDir }) => ({
      async newPage() {
        return {
          async setViewport() {},
          async setExtraHTTPHeaders() {},
          async goto() { await gate; return { status: () => 200 }; },
          async screenshot() { return new Uint8Array(16); },
        } satisfies CapturePageLike;
      },
      async close() { void allowedHost; void userDataDir; },
    } satisfies CaptureBrowserLike));

    const first = control.capture(request());
    await expect(control.capture(request())).rejects.toThrow(/already running/);
    release();
    await first;
    // …and the slot is free again once the first one finished.
    await expect(control.capture(request())).resolves.toBeTruthy();
  });
});

describe('browserCapture — availability', () => {
  it('reports unavailable when no browser is installed', () => {
    const dir = tempRoot();
    const control = createSiteCaptureControl({
      dataDir: () => dir,
      chromeExecutable: () => join(dir, 'no-such-chrome'),
      logger: noopLog,
      launch: fakeLauncher().launch,
      dependencyAvailable: async () => true,
    });
    expect(control.available()).toBe(false);
  });
});
