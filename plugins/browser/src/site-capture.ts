import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { detectChrome } from './browser-launcher.js';

/** One rendering of one host-derived URL, for a sibling plugin that needs a picture of a page the host
 *  already serves. Registered as the core-known `browserCapture` control.
 *
 *  This is deliberately NOT the account browser. A session in that pool is a person's own browser: their
 *  profile, their cookies, their proxy lease, their live view. Reusing it to photograph a published page
 *  would put another plugin's request inside somebody's signed-in browser, which is precisely the thing
 *  no amount of careful calling makes safe. A capture instead gets a browser of its own that has never
 *  been anybody: a fresh process, a throwaway profile removed afterwards, no display, no proxy lease, no
 *  downloads, and a name resolver that can reach exactly one host and nothing else.
 *
 *  The contract mirrors `BrowserCaptureControl` in core's plugin API. It is restated here because the
 *  registry compiles against the published `elowen` package, which does not carry the type until the core
 *  release that introduces it lands — the same reason `plugins/sites/src/coreSeams.ts` exists. */

export interface BrowserCaptureRequest {
  url: string;
  headers?: Readonly<Record<string, string>>;
  viewport: { width: number; height: number; deviceScaleFactor?: number };
  timeoutMs?: number;
  format?: 'png' | 'webp';
  maxBytes?: number;
}

interface BrowserCaptureResult {
  image: Uint8Array;
  mimeType: 'image/png' | 'image/webp';
  width: number;
  height: number;
}

export interface BrowserCaptureControl {
  available(): boolean;
  capture(request: BrowserCaptureRequest): Promise<BrowserCaptureResult>;
}

/** Bounds. Every one of these is a refusal rather than a silent adjustment: a caller that asked for a
 *  2000px-wide capture and got 1600 would store a picture whose dimensions it does not know, and the
 *  metadata it saves beside the image would describe a different image than the one on disk. */
const MIN_CAPTURE_EDGE = 160;
export const MAX_CAPTURE_WIDTH = 1920;
const MAX_CAPTURE_HEIGHT = 1440;
const MAX_CAPTURE_SCALE = 2;
const MIN_CAPTURE_TIMEOUT_MS = 1_000;
const MAX_CAPTURE_TIMEOUT_MS = 30_000;
const DEFAULT_CAPTURE_TIMEOUT_MS = 15_000;
/** The ceiling on what any caller may ask to keep, whatever it passes as `maxBytes`. */
export const MAX_CAPTURE_BYTES = 1_572_864;
const DEFAULT_CAPTURE_BYTES = 524_288;
const CAPTURE_WEBP_QUALITY = 72;
/** A header name a caller may not set: it decides which virtual host answers, so it is the one field that
 *  could turn a validated target into a different one. `proxy-*` is refused for the same reason. */
const FORBIDDEN_HEADERS = new Set(['host', 'content-length', 'connection']);
const HEADER_NAME = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;
const MAX_HEADER_VALUE = 4096;
const MAX_URL_LENGTH = 2048;

export class CaptureRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CaptureRefused';
  }
}

/** The minimum of puppeteer-core this module drives. Declared structurally so a test can supply its own
 *  launcher without the dependency being installed. */
export interface CaptureBrowserLike {
  newPage(): Promise<CapturePageLike>;
  close(): Promise<void>;
  process?(): { kill(signal?: NodeJS.Signals): void } | null;
}
export interface CapturePageLike {
  setViewport(viewport: { width: number; height: number; deviceScaleFactor: number }): Promise<void>;
  setExtraHTTPHeaders(headers: Record<string, string>): Promise<void>;
  goto(url: string, options: { waitUntil: string; timeout: number }): Promise<{ status(): number } | null>;
  screenshot(options: Record<string, unknown>): Promise<Uint8Array>;
  createCDPSession?(): Promise<{ send(method: string, params?: Record<string, unknown>): Promise<unknown> }>;
}
export type CaptureLauncher = (options: {
  executablePath: string;
  userDataDir: string;
  allowedHost: string;
}) => Promise<CaptureBrowserLike>;

export interface SiteCaptureDeps {
  dataDir(): string;
  chromeExecutable(): string | null;
  logger: { info(m: string): void; warn(m: string): void; error(m: string): void };
  /** Injected by tests. Production launches puppeteer-core. */
  launch?: CaptureLauncher;
  /** Injected by tests so the dependency probe is deterministic. */
  dependencyAvailable?(): Promise<boolean>;
}

/** A URL this control is willing to open.
 *
 *  The consumer is required to derive it server-side, and the registry only hands this control to one
 *  plugin — but "the caller is trusted" is an argument, not a control, so the shape is checked here too.
 *  Credentials in the URL are refused outright: they are a way to make a request carry an identity, which
 *  is the one thing a capture must never do. */
export function validateCaptureUrl(raw: string): URL {
  if (typeof raw !== 'string' || raw.length === 0) throw new CaptureRefused('A capture needs a URL.');
  if (raw.length > MAX_URL_LENGTH) throw new CaptureRefused('The capture URL is too long.');
  let url: URL;
  try { url = new URL(raw); } catch { throw new CaptureRefused('The capture URL is not absolute.'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new CaptureRefused(`A capture reads http(s) pages, not ${url.protocol.replace(':', '')}.`);
  }
  if (url.username !== '' || url.password !== '') {
    throw new CaptureRefused('A capture URL must not carry credentials.');
  }
  if (url.hostname === '') throw new CaptureRefused('The capture URL names no host.');
  return url;
}

export function validateCaptureHeaders(headers: Readonly<Record<string, string>> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (!HEADER_NAME.test(name)) throw new CaptureRefused(`"${name}" is not a usable header name.`);
    if (FORBIDDEN_HEADERS.has(name.toLowerCase()) || name.toLowerCase().startsWith('proxy-')) {
      throw new CaptureRefused(`The "${name}" header is decided by the transport, not by the caller.`);
    }
    if (typeof value !== 'string' || value.length > MAX_HEADER_VALUE || /[\r\n\0]/.test(value)) {
      throw new CaptureRefused(`The "${name}" header value is not usable.`);
    }
    out[name] = value;
  }
  return out;
}

interface NormalizedRequest {
  url: URL;
  headers: Record<string, string>;
  width: number;
  height: number;
  scale: number;
  timeoutMs: number;
  format: 'png' | 'webp';
  maxBytes: number;
}

export function normalizeCaptureRequest(request: BrowserCaptureRequest): NormalizedRequest {
  const url = validateCaptureUrl(request.url);
  const headers = validateCaptureHeaders(request.headers);
  const { width, height, deviceScaleFactor } = request.viewport ?? {};
  const scale = deviceScaleFactor ?? 1;
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    throw new CaptureRefused('A capture viewport is two whole numbers of CSS pixels.');
  }
  if (width < MIN_CAPTURE_EDGE || width > MAX_CAPTURE_WIDTH || height < MIN_CAPTURE_EDGE || height > MAX_CAPTURE_HEIGHT) {
    throw new CaptureRefused(
      `A capture viewport is between ${MIN_CAPTURE_EDGE} and ${MAX_CAPTURE_WIDTH}×${MAX_CAPTURE_HEIGHT} CSS pixels.`,
    );
  }
  if (!(scale >= 1) || scale > MAX_CAPTURE_SCALE) {
    throw new CaptureRefused(`A capture renders between 1× and ${MAX_CAPTURE_SCALE}×.`);
  }
  const format = request.format ?? 'webp';
  if (format !== 'png' && format !== 'webp') throw new CaptureRefused('A capture is a PNG or a WebP.');
  const timeoutMs = request.timeoutMs ?? DEFAULT_CAPTURE_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs < MIN_CAPTURE_TIMEOUT_MS || timeoutMs > MAX_CAPTURE_TIMEOUT_MS) {
    throw new CaptureRefused(`A capture deadline is between ${MIN_CAPTURE_TIMEOUT_MS} and ${MAX_CAPTURE_TIMEOUT_MS} ms.`);
  }
  const requested = request.maxBytes ?? DEFAULT_CAPTURE_BYTES;
  if (!Number.isFinite(requested) || requested <= 0) throw new CaptureRefused('A capture byte cap is a positive number.');
  return { url, headers, width, height, scale, timeoutMs, format, maxBytes: Math.min(requested, MAX_CAPTURE_BYTES) };
}

/** Launch a browser that can reach exactly one hostname.
 *
 *  `--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE <host>` is the same containment the account pool uses
 *  for loopback, turned the other way round: every name fails to resolve except the one this capture is
 *  for. It is Chrome refusing, not this module remembering to check, which is why a redirect, an `<img>`
 *  or a `fetch()` inside the page cannot reach anything else either. */
const puppeteerLauncher: CaptureLauncher = async ({ executablePath, userDataDir, allowedHost }) => {
  const moduleName = 'puppeteer-core';
  const loaded = await import(moduleName) as {
    default?: { launch(options: Record<string, unknown>): Promise<CaptureBrowserLike> };
    launch?: (options: Record<string, unknown>) => Promise<CaptureBrowserLike>;
  };
  const launch = loaded.default?.launch ?? loaded.launch;
  if (!launch) throw new Error('puppeteer-core does not expose launch().');
  return launch({
    executablePath,
    // Headless on purpose. A capture has no viewer, no input and no live view, so the virtual display the
    // account pool needs would be an X server per screenshot for nobody to look at.
    headless: 'shell',
    pipe: true,
    userDataDir,
    env: { ...process.env, HOME: userDataDir, DISPLAY: '' },
    defaultViewport: null,
    args: [
      `--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE ${allowedHost}`,
      '--test-type',
      '--disable-quic',
      '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-default-apps',
      '--disable-extensions',
      '--disable-sync',
      '--disable-dev-shm-usage',
      '--mute-audio',
      '--metrics-recording-only',
      '--no-first-run',
      '--no-default-browser-check',
      '--force-color-profile=srgb',
      '--hide-scrollbars',
    ],
  });
};

export function createSiteCaptureControl(deps: SiteCaptureDeps): BrowserCaptureControl {
  let dependencyOk: boolean | null = null;
  const probe = deps.dependencyAvailable ?? (async () => {
    // Indirect on purpose, exactly as `PuppeteerCoreFactory` does: the dependency is optional and
    // resolved at runtime, and a literal specifier would make the bundler and the dependency graph treat
    // it as a hard import of a package this plugin can legitimately run without.
    const moduleName = 'puppeteer-core';
    try {
      const loaded = await import(moduleName) as { default?: { launch?: unknown }; launch?: unknown };
      return typeof (loaded.default?.launch ?? loaded.launch) === 'function';
    } catch { return false; }
  });
  void probe().then((ok) => { dependencyOk = ok; }).catch(() => { dependencyOk = false; });

  // One capture at a time, refused rather than queued. The consumer owns the queue — it is the one that
  // knows which sites are due and in what order — and a second queue here would only add a place for work
  // to pile up invisibly behind a browser that is already slow.
  let busy = false;

  const launch = deps.launch ?? puppeteerLauncher;

  return {
    available(): boolean {
      return detectChrome(deps.chromeExecutable()) !== null && dependencyOk !== false;
    },

    async capture(request: BrowserCaptureRequest): Promise<BrowserCaptureResult> {
      const normalized = normalizeCaptureRequest(request);
      const executablePath = detectChrome(deps.chromeExecutable());
      if (!executablePath) throw new CaptureRefused('No browser is installed for this instance to render with.');
      if (busy) throw new CaptureRefused('A capture is already running.');
      busy = true;

      const profile = join(deps.dataDir(), 'capture', randomUUID());
      // Held on an object rather than in a local: the browser is opened inside the raced closure below,
      // and a plain `let` reads as never-assigned to control-flow analysis by the time the cleanup runs.
      const opened: { browser: CaptureBrowserLike | null } = { browser: null };
      const deadline = new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new CaptureRefused('The capture did not finish in time.')), normalized.timeoutMs).unref?.();
      });

      try {
        return await Promise.race([deadline, (async (): Promise<BrowserCaptureResult> => {
          opened.browser = await launch({ executablePath, userDataDir: profile, allowedHost: normalized.url.hostname });
          const page = await opened.browser.newPage();
          await page.setViewport({ width: normalized.width, height: normalized.height, deviceScaleFactor: normalized.scale });
          if (Object.keys(normalized.headers).length > 0) await page.setExtraHTTPHeaders(normalized.headers);
          // A capture keeps nothing. Denying downloads stops a page whose entry point is a file response
          // from writing one into the throwaway profile while the screenshot waits for a document.
          const cdp = await page.createCDPSession?.();
          await cdp?.send('Browser.setDownloadBehavior', { behavior: 'deny' }).catch(() => undefined);

          const response = await page.goto(normalized.url.href, { waitUntil: 'networkidle2', timeout: normalized.timeoutMs });
          const status = response?.status() ?? 0;
          // A refusal page is not a picture of the site. Storing one would show a person a preview of an
          // error and give no sign that is what they were looking at.
          if (status >= 400) throw new CaptureRefused(`The page answered ${status}, so there is nothing to picture.`);

          const image = await page.screenshot({
            type: normalized.format,
            ...(normalized.format === 'webp' ? { quality: CAPTURE_WEBP_QUALITY } : {}),
            fullPage: false,
            captureBeyondViewport: false,
            encoding: 'binary',
          });
          const bytes = image.byteLength;
          if (bytes > normalized.maxBytes) {
            throw new CaptureRefused(`The capture is ${Math.round(bytes / 1024)} KiB, over the ${Math.round(normalized.maxBytes / 1024)} KiB limit.`);
          }
          return {
            image,
            mimeType: normalized.format === 'png' ? 'image/png' : 'image/webp',
            width: Math.round(normalized.width * normalized.scale),
            height: Math.round(normalized.height * normalized.scale),
          };
        })()]);
      } finally {
        busy = false;
        // Close, then make sure. A browser that ignored `close()` because the page is wedged would keep
        // the profile directory alive underneath the removal below.
        try { await opened.browser?.close(); } catch { opened.browser?.process?.()?.kill('SIGKILL'); }
        try { rmSync(profile, { recursive: true, force: true }); }
        catch (error) { deps.logger.warn(`capture profile ${profile} was left behind: ${error instanceof Error ? error.message : String(error)}`); }
      }
    },
  };
}
