export interface BrowserConfig {
  chromeExecutable: string | null;
  maxActiveUsers: number;
  maxSessionsPerUser: number;
  idleTimeoutMs: number;
  hardSessionLimitMs: number;
  /** The virtual display an account's Chrome is drawn on, and therefore the framebuffer a viewer sees.
   *  NOT the page viewport: a native Chrome window spends 87px of it on the tab strip and the address
   *  bar, so the page is that much shorter. Anything that needs the page's own box asks Chrome. */
  maxViewportWidth: number;
  viewportHeight: number;
  takeoverLeaseMs: number;
  /** How many live view connections one session may fan out to. Each is a full RFB stream of the whole
   *  framebuffer — the VNC server cannot downscale per client — so this is a bandwidth limit as much as
   *  a policy one. */
  maxViewersPerSession: number;
  maxChromeRssBytesPerUser: number;
  maxTargetsPerUser: number;
  /** How many sockets Chrome may hold open through the egress proxy at once. Sized for a PERSON browsing,
   *  not for an agent fetching one page at a time: a single image-heavy site opens six connections per
   *  host across a dozen hosts and CDNs, and a request over this limit is refused in a way Chrome can only
   *  report as ERR_TUNNEL_CONNECTION_FAILED — with images silently missing rather than an error page. */
  proxyConcurrency: number;
  proxyRequestsPerMinute: number;
  privateNetworkAllowlist: string[];
  browserCloseGraceMs: number;
  /** How long x11vnc coalesces framebuffer updates before sending, in milliseconds.
   *
   *  The one number worth exposing, because it is the whole latency/bandwidth trade and the right answer
   *  depends on the link rather than on the host. Measured here at 1280x800: 10 ms reaches 88 ms
   *  click-to-pixel and costs 589 kB/s while scrolling; 40 ms costs 373 kB/s but 146 ms. The default is
   *  10 — this exists so a person driving a page feels the page, and bandwidth is the thing being spent
   *  to get that. */
  vncDeferMs: number;
}

const bounded = (value: unknown, fallback: number, min: number, max: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
};

const tokenList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean))];
};

export function resolveConfig(raw: Record<string, unknown>): BrowserConfig {
  const width = bounded(raw.maxViewportWidth, 1280, 800, 1920);
  return {
    chromeExecutable: typeof raw.chromeExecutable === 'string' && raw.chromeExecutable.trim() ? raw.chromeExecutable.trim() : null,
    maxActiveUsers: bounded(raw.maxActiveUsers, 4, 1, 20),
    maxSessionsPerUser: bounded(raw.maxSessionsPerUser, 2, 1, 8),
    idleTimeoutMs: bounded(raw.idleTimeoutMinutes, 10, 1, 60) * 60_000,
    hardSessionLimitMs: bounded(raw.hardSessionLimitMinutes, 60, 5, 240) * 60_000,
    maxViewportWidth: width,
    viewportHeight: Math.max(500, Math.round(width * 0.625)),
    takeoverLeaseMs: bounded(raw.takeoverLeaseSeconds, 120, 30, 600) * 1000,
    maxViewersPerSession: bounded(raw.maxViewersPerSession, 4, 1, 8),
    maxChromeRssBytesPerUser: bounded(raw.maxChromeRssMb, 768, 256, 2048) * 1048576,
    maxTargetsPerUser: bounded(raw.maxTargetsPerUser, 12, 4, 32),
    proxyConcurrency: bounded(raw.proxyConcurrency, 96, 1, 200),
    proxyRequestsPerMinute: bounded(raw.proxyRequestsPerMinute, 3000, 30, 6000),
    privateNetworkAllowlist: tokenList(raw.privateNetworkAllowlist),
    browserCloseGraceMs: bounded(raw.browserCloseGraceSeconds, 15, 0, 120) * 1000,
    vncDeferMs: bounded(raw.vncDeferMs, 10, 5, 400),
  };
}
