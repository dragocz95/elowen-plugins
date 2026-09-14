import { randomBytes, randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { isIP } from 'node:net';
import { join } from 'node:path';
import { detectChrome } from './browser-launcher.js';
import {
  DynamicProxyChainAdapter,
  NavigationPolicy,
  NavigationPolicyError,
  type HostResolver,
  type PinnedTarget,
  type ProxyChainPinnedAdapter,
  type PinnedProxyServer,
} from './navigation-policy.js';

/** One rendering of one host-derived URL, for a sibling plugin that needs a picture of a page the host
 *  already serves. Registered as the core-known `browserCapture` control.
 *
 *  This is deliberately NOT the account browser. A session in that pool is a person's own browser: their
 *  profile, their cookies, their proxy lease, their live view. Reusing it to photograph a published page
 *  would put another plugin's request inside somebody's signed-in browser. A capture instead gets a fresh
 *  process, a throwaway profile, no display, no downloads and one process-wide proxy pinned to one public
 *  HTTPS origin. The proxy owns every document, redirect, subresource, fetch, socket and worker request.
 *
 *  The contract mirrors `BrowserCaptureControl` in core's plugin API. It is restated here because the
 *  registry compiles against the last published `elowen` package until the matching core release lands. */

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

interface BrowserCaptureControl {
  available(): boolean;
  capture(request: BrowserCaptureRequest): Promise<BrowserCaptureResult>;
}

export interface SiteCaptureControl extends BrowserCaptureControl {
  dispose(): Promise<void>;
}

const MIN_CAPTURE_EDGE = 160;
export const MAX_CAPTURE_WIDTH = 1920;
const MAX_CAPTURE_HEIGHT = 1440;
const MAX_CAPTURE_SCALE = 2;
const MIN_CAPTURE_TIMEOUT_MS = 1_000;
const MAX_CAPTURE_TIMEOUT_MS = 30_000;
const DEFAULT_CAPTURE_TIMEOUT_MS = 15_000;
export const MAX_CAPTURE_BYTES = 1_572_864;
const DEFAULT_CAPTURE_BYTES = 524_288;
const CAPTURE_WEBP_QUALITY = 72;
const CAPTURE_DISPOSE_WAIT_MS = 5_000;
const FORBIDDEN_HEADERS = new Set(['host', 'content-length', 'connection']);
const HEADER_NAME = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;
const MAX_HEADER_VALUE = 4096;
const MAX_URL_LENGTH = 2048;

export class CaptureRefused extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CaptureRefused';
  }
}

export interface CaptureBrowserLike {
  newPage(): Promise<CapturePageLike>;
  close(): Promise<void>;
  process?(): { kill(signal?: NodeJS.Signals): void } | null;
}
export interface CapturePageLike {
  setViewport(viewport: { width: number; height: number; deviceScaleFactor: number }): Promise<void>;
  setExtraHTTPHeaders(headers: Record<string, string>): Promise<void>;
  authenticate(credentials: { username: string; password: string }): Promise<void>;
  goto(url: string, options: { waitUntil: string; timeout: number }): Promise<{ status(): number } | null>;
  url(): string;
  screenshot(options: Record<string, unknown>): Promise<Uint8Array>;
  createCDPSession(): Promise<{ send(method: string, params?: Record<string, unknown>): Promise<unknown> }>;
}
export type CaptureLauncher = (options: {
  executablePath: string;
  userDataDir: string;
  proxyUrl: string;
  signal: AbortSignal;
}) => Promise<CaptureBrowserLike>;

export interface SiteCaptureDeps {
  dataDir(): string;
  chromeExecutable(): string | null;
  logger: { info(m: string): void; warn(m: string): void; error(m: string): void };
  proxyConcurrency(): number;
  proxyRequestsPerMinute(): number;
  launch?: CaptureLauncher;
  proxyAdapter?: ProxyChainPinnedAdapter;
  resolver?: HostResolver;
  dependencyAvailable?(): Promise<boolean>;
  networkDependencyAvailable?(): Promise<boolean>;
  removeProfile?(path: string): void;
}

/** A Site publication has one hostname-based HTTPS origin. Literal addresses are never publication names,
 *  and accepting one would create a second path around the hostname and origin checks below. */
export function validateCaptureUrl(raw: string): URL {
  if (typeof raw !== 'string' || raw.length === 0) throw new CaptureRefused('A capture needs a URL.');
  if (raw.length > MAX_URL_LENGTH) throw new CaptureRefused('The capture URL is too long.');
  let url: URL;
  try { url = new URL(raw); } catch { throw new CaptureRefused('The capture URL is not absolute.'); }
  if (url.protocol !== 'https:') throw new CaptureRefused('A capture reads one published HTTPS page.');
  if (url.username !== '' || url.password !== '') throw new CaptureRefused('A capture URL must not carry credentials.');
  if (url.hostname === '' || isIP(url.hostname) !== 0) throw new CaptureRefused('A capture URL must name a published hostname.');
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
    throw new CaptureRefused(`A capture viewport is between ${MIN_CAPTURE_EDGE} and ${MAX_CAPTURE_WIDTH}×${MAX_CAPTURE_HEIGHT} CSS pixels.`);
  }
  if (!(scale >= 1) || scale > MAX_CAPTURE_SCALE) throw new CaptureRefused(`A capture renders between 1× and ${MAX_CAPTURE_SCALE}×.`);
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

const puppeteerLauncher: CaptureLauncher = async ({ executablePath, userDataDir, proxyUrl, signal }) => {
  const moduleName = 'puppeteer-core';
  const loaded = await import(moduleName) as {
    default?: { launch(options: Record<string, unknown>): Promise<CaptureBrowserLike> };
    launch?: (options: Record<string, unknown>) => Promise<CaptureBrowserLike>;
  };
  const launch = loaded.default?.launch ?? loaded.launch;
  if (!launch) throw new Error('puppeteer-core does not expose launch().');
  return launch({
    executablePath,
    headless: 'shell',
    pipe: true,
    userDataDir,
    signal,
    env: { ...process.env, HOME: userDataDir, DISPLAY: '' },
    defaultViewport: null,
    args: [
      `--proxy-server=${proxyUrl}`,
      '--proxy-bypass-list=<-loopback>',
      '--test-type',
      '--disable-quic',
      '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
      '--webrtc-ip-handling-policy=disable_non_proxied_udp',
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

function exactOriginResolver(target: PinnedTarget): (url: string) => Promise<PinnedTarget> {
  const allowedOrigin = target.url.origin;
  return async (raw) => {
    let candidate: URL;
    try { candidate = new URL(raw); }
    catch { throw new NavigationPolicyError('The capture proxy received an invalid destination.'); }
    if (candidate.origin !== allowedOrigin) {
      throw new NavigationPolicyError(`The capture proxy permits only ${allowedOrigin}.`);
    }
    return target;
  };
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : new CaptureRefused('The capture was cancelled.');
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface ActiveCapture {
  abort: AbortController;
  browser: CaptureBrowserLike | null;
  profile: string;
  proxy: PinnedProxyServer | null;
  settled: Promise<void>;
}

async function cleanupCapture(active: ActiveCapture, deps: SiteCaptureDeps): Promise<void> {
  const errors: Error[] = [];
  if (active.browser) {
    try { await active.browser.close(); }
    catch (closeError) {
      const process = active.browser.process?.();
      if (!process) errors.push(closeError instanceof Error ? closeError : new Error(errorText(closeError)));
      else {
        try { process.kill('SIGKILL'); }
        catch (killError) { errors.push(killError instanceof Error ? killError : new Error(errorText(killError))); }
      }
    }
  }
  if (active.proxy) {
    try { await active.proxy.close(); }
    catch (error) { errors.push(error instanceof Error ? error : new Error(errorText(error))); }
  }
  try { (deps.removeProfile ?? ((path) => rmSync(path, { recursive: true, force: true })))(active.profile); }
  catch (error) { errors.push(error instanceof Error ? error : new Error(errorText(error))); }
  if (errors.length > 0) {
    const detail = errors.map(errorText).join('; ');
    deps.logger.error(`browser capture cleanup failed: ${detail}`);
    throw new CaptureRefused(`The capture cleanup failed: ${detail}`, { cause: errors[0] });
  }
}

async function runCapture(
  active: ActiveCapture,
  normalized: NormalizedRequest,
  executablePath: string,
  deps: SiteCaptureDeps,
  launch: CaptureLauncher,
  proxyAdapter: ProxyChainPinnedAdapter,
): Promise<BrowserCaptureResult> {
  let result: BrowserCaptureResult | null = null;
  let failure: unknown = null;
  try {
    throwIfAborted(active.abort.signal);
    const target = await new NavigationPolicy([], deps.resolver).resolve(normalized.url.href);
    throwIfAborted(active.abort.signal);
    const username = randomBytes(18).toString('base64url');
    const password = randomBytes(24).toString('base64url');
    active.proxy = await proxyAdapter.createServer({
      username,
      password,
      maxConcurrency: deps.proxyConcurrency(),
      requestsPerMinute: deps.proxyRequestsPerMinute(),
      resolve: exactOriginResolver(target),
      onRejected: (reason, host, detail) => {
        if (reason === 'auth') return;
        deps.logger.warn(`browser capture proxy refused ${host} [${reason}]${detail ? `: ${detail}` : ''}`);
      },
    });
    throwIfAborted(active.abort.signal);
    active.browser = await launch({
      executablePath,
      userDataDir: active.profile,
      proxyUrl: active.proxy.url,
      signal: active.abort.signal,
    });
    throwIfAborted(active.abort.signal);
    const page = await active.browser.newPage();
    await page.authenticate({ username, password });
    await page.setViewport({ width: normalized.width, height: normalized.height, deviceScaleFactor: normalized.scale });
    if (Object.keys(normalized.headers).length > 0) await page.setExtraHTTPHeaders(normalized.headers);
    const cdp = await page.createCDPSession();
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'deny' });
    throwIfAborted(active.abort.signal);

    const response = await page.goto(target.url.href, { waitUntil: 'networkidle2', timeout: normalized.timeoutMs });
    throwIfAborted(active.abort.signal);
    if (!response) throw new CaptureRefused('The page did not produce a document response.');
    const status = response.status();
    if (status >= 400) throw new CaptureRefused(`The page answered ${status}, so there is nothing to picture.`);
    let finalUrl: URL;
    try { finalUrl = new URL(page.url()); }
    catch { throw new CaptureRefused('The browser did not finish on the published page.'); }
    if (finalUrl.origin !== target.url.origin) {
      throw new CaptureRefused('The published page redirected to another origin.');
    }

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
    result = {
      image,
      mimeType: normalized.format === 'png' ? 'image/png' : 'image/webp',
      width: Math.round(normalized.width * normalized.scale),
      height: Math.round(normalized.height * normalized.scale),
    };
  } catch (error) {
    failure = error instanceof CaptureRefused
      ? error
      : new CaptureRefused(`The published page could not be captured: ${errorText(error)}`, { cause: error });
  }

  try { await cleanupCapture(active, deps); }
  catch (cleanupError) {
    if (failure) throw new AggregateError([failure, cleanupError], errorText(failure), { cause: failure });
    throw cleanupError;
  }
  if (failure) throw failure;
  return result!;
}

export function createSiteCaptureControl(deps: SiteCaptureDeps): SiteCaptureControl {
  const proxyAdapter = deps.proxyAdapter ?? new DynamicProxyChainAdapter();
  let dependencyOk: boolean | null = null;
  const browserProbe = deps.dependencyAvailable ?? (async () => {
    const moduleName = 'puppeteer-core';
    try {
      const loaded = await import(moduleName) as { default?: { launch?: unknown }; launch?: unknown };
      return typeof (loaded.default?.launch ?? loaded.launch) === 'function';
    } catch { return false; }
  });
  const networkProbe = deps.networkDependencyAvailable ?? (() => proxyAdapter.dependencyAvailable());
  void Promise.all([browserProbe(), networkProbe()])
    .then(([browserOk, networkOk]) => { dependencyOk = browserOk && networkOk; })
    .catch(() => { dependencyOk = false; });

  const launch = deps.launch ?? puppeteerLauncher;
  let active: ActiveCapture | null = null;
  let disposed = false;

  return {
    available(): boolean {
      return !disposed && detectChrome(deps.chromeExecutable()) !== null && dependencyOk !== false;
    },

    async capture(request: BrowserCaptureRequest): Promise<BrowserCaptureResult> {
      const normalized = normalizeCaptureRequest(request);
      const executablePath = detectChrome(deps.chromeExecutable());
      if (!executablePath) throw new CaptureRefused('No browser is installed for this instance to render with.');
      if (disposed) throw new CaptureRefused('The browser capture service is stopping.');
      if (active) throw new CaptureRefused('A capture is already running.');

      const operation: ActiveCapture = {
        abort: new AbortController(),
        browser: null,
        profile: join(deps.dataDir(), 'capture', randomUUID()),
        proxy: null,
        settled: Promise.resolve(),
      };
      active = operation;
      const work = runCapture(operation, normalized, executablePath, deps, launch, proxyAdapter)
        .then((value) => ({ ok: true as const, value }), (error) => ({ ok: false as const, error }));
      operation.settled = work.then(() => undefined);
      const timeoutError = new CaptureRefused('The capture did not finish in time.');
      let timer: NodeJS.Timeout | null = null;
      const deadline = new Promise<{ timeout: true }>((resolve) => {
        timer = setTimeout(() => {
          operation.abort.abort(timeoutError);
          resolve({ timeout: true });
        }, normalized.timeoutMs);
        timer.unref?.();
      });

      try {
        const first = await Promise.race([work, deadline]);
        if ('timeout' in first) {
          const late = await work;
          if (!late.ok && late.error !== timeoutError && !(late.error instanceof AggregateError && late.error.cause === timeoutError)) {
            throw late.error;
          }
          throw timeoutError;
        }
        if (!first.ok) throw first.error;
        return first.value;
      } finally {
        if (timer) clearTimeout(timer);
        await operation.settled;
        if (active === operation) active = null;
      }
    },

    async dispose(): Promise<void> {
      disposed = true;
      const operation = active;
      if (!operation) return;
      operation.abort.abort(new CaptureRefused('The browser capture service is stopping.'));
      let timer: NodeJS.Timeout | null = null;
      const bounded = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), CAPTURE_DISPOSE_WAIT_MS);
        timer.unref?.();
      });
      const outcome = await Promise.race([operation.settled.then(() => 'settled' as const), bounded]);
      if (timer) clearTimeout(timer);
      if (outcome === 'timeout') {
        try { operation.browser?.process?.()?.kill('SIGKILL'); }
        catch (error) { deps.logger.error(`browser capture process could not be killed during disposal: ${errorText(error)}`); }
        deps.logger.error('browser capture cleanup exceeded the disposal deadline; late launch cleanup remains attached');
      }
    },
  };
}
