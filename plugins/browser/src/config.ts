export interface BrowserConfig {
  chromeExecutable: string | null;
  maxActiveUsers: number;
  maxSessionsPerUser: number;
  idleTimeoutMs: number;
  hardSessionLimitMs: number;
  webFps: number;
  cliFps: number;
  jpegQuality: number;
  maxViewportWidth: number;
  viewportHeight: number;
  takeoverLeaseMs: number;
  maxViewersPerSession: number;
  globalStreamBytesPerSecond: number;
  maxFrameBytes: number;
  maxChromeRssBytesPerUser: number;
  maxTargetsPerUser: number;
  proxyConcurrency: number;
  proxyRequestsPerMinute: number;
  privateNetworkAllowlist: string[];
  browserCloseGraceMs: number;
  maxInputEventsPerSecond: number;
  /** PILOT (ELOWEN_BROWSER_VNC). Off by default: with this false nothing in vnc-display.ts,
   *  vnc-bridge.ts or the VNC surface runs, and the screencast path below is the only live one. */
  vncEnabled: boolean;
  /** x11vnc framebuffer poll interval and update coalescing window, in milliseconds. Measured on this
   *  host: 20/40 costs 373 kB/s while scrolling, which is roughly today's screencast at 353 kB/s, for a
   *  146 ms click-to-pixel time against the screencast's 42 ms. Lowering `defer` buys latency back at a
   *  steep price — 10/10 reaches 88 ms but 589 kB/s. */
  vncPollMs: number;
  vncDeferMs: number;
  /** Tight quality (0-9) and compression (0-9) the CLIENT asks for. Quality 4 is close to the JPEG 70
   *  the screencast uses; quality 6 costs 60% more bytes for a difference nobody reported seeing. */
  vncQualityLevel: number;
  vncCompressionLevel: number;
  /** How long a minted WebSocket ticket may be redeemed for. One connection, once. */
  vncTicketTtlMs: number;
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
    webFps: bounded(raw.webFps, 8, 1, 15),
    cliFps: bounded(raw.cliFps, 2, 1, 5),
    jpegQuality: bounded(raw.jpegQuality, 70, 40, 90),
    maxViewportWidth: width,
    viewportHeight: Math.max(500, Math.round(width * 0.625)),
    takeoverLeaseMs: bounded(raw.takeoverLeaseSeconds, 120, 30, 600) * 1000,
    maxViewersPerSession: bounded(raw.maxViewersPerSession, 4, 1, 8),
    globalStreamBytesPerSecond: bounded(raw.globalStreamMegabits, 12, 2, 50) * 125_000,
    maxFrameBytes: bounded(raw.maxFrameKilobytes, 750, 100, 2000) * 1024,
    maxChromeRssBytesPerUser: bounded(raw.maxChromeRssMb, 768, 256, 2048) * 1048576,
    maxTargetsPerUser: bounded(raw.maxTargetsPerUser, 12, 4, 32),
    proxyConcurrency: bounded(raw.proxyConcurrency, 24, 1, 200),
    proxyRequestsPerMinute: bounded(raw.proxyRequestsPerMinute, 600, 30, 6000),
    privateNetworkAllowlist: tokenList(raw.privateNetworkAllowlist),
    browserCloseGraceMs: bounded(raw.browserCloseGraceSeconds, 15, 0, 120) * 1000,
    maxInputEventsPerSecond: bounded(raw.maxInputEventsPerSecond, 60, 10, 240),
    vncEnabled: raw.vncEnabled === true,
    vncPollMs: bounded(raw.vncPollMs, 20, 5, 200),
    vncDeferMs: bounded(raw.vncDeferMs, 40, 5, 400),
    vncQualityLevel: bounded(raw.vncQualityLevel, 4, 0, 9),
    vncCompressionLevel: bounded(raw.vncCompressionLevel, 6, 0, 9),
    vncTicketTtlMs: bounded(raw.vncTicketTtlSeconds, 15, 5, 120) * 1000,
  };
}
