const bounded = (value, fallback, min, max) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed))
        return fallback;
    return Math.min(max, Math.max(min, Math.round(parsed)));
};
const tokenList = (value) => {
    if (!Array.isArray(value))
        return [];
    return [...new Set(value.filter((item) => typeof item === 'string').map((item) => item.trim()).filter(Boolean))];
};
export function resolveConfig(raw) {
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
        proxyConcurrency: bounded(raw.proxyConcurrency, 24, 1, 200),
        proxyRequestsPerMinute: bounded(raw.proxyRequestsPerMinute, 600, 30, 6000),
        privateNetworkAllowlist: tokenList(raw.privateNetworkAllowlist),
        browserCloseGraceMs: bounded(raw.browserCloseGraceSeconds, 15, 0, 120) * 1000,
        vncDeferMs: bounded(raw.vncDeferMs, 10, 5, 400),
    };
}
