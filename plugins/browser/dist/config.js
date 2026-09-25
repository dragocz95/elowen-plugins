import { clampConfig } from 'elowen-plugin-shared/configNumber';
// Numeric fields with a positive schema minimum share the fallback/clamp rule; this plugin rounds first.
const roundedConfig = (value, fallback, min, max) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed))
        return fallback;
    // An explicit zero below a positive minimum used to clamp up, not trigger the shared fallback.
    return clampConfig(Math.round(parsed) || min, fallback, min, max);
};
const tokenList = (value) => {
    if (!Array.isArray(value))
        return [];
    return [...new Set(value.filter((item) => typeof item === 'string').map((item) => item.trim()).filter(Boolean))];
};
export function resolveConfig(raw) {
    const width = roundedConfig(raw.maxViewportWidth, 1280, 800, 1920);
    return {
        chromeExecutable: typeof raw.chromeExecutable === 'string' && raw.chromeExecutable.trim() ? raw.chromeExecutable.trim() : null,
        maxActiveUsers: roundedConfig(raw.maxActiveUsers, 4, 1, 20),
        maxSessionsPerUser: roundedConfig(raw.maxSessionsPerUser, 2, 1, 8),
        idleTimeoutMs: roundedConfig(raw.idleTimeoutMinutes, 10, 1, 60) * 60_000,
        hardSessionLimitMs: roundedConfig(raw.hardSessionLimitMinutes, 60, 5, 240) * 60_000,
        maxViewportWidth: width,
        viewportHeight: Math.max(500, Math.round(width * 0.625)),
        takeoverLeaseMs: roundedConfig(raw.takeoverLeaseSeconds, 120, 30, 600) * 1000,
        maxViewersPerSession: roundedConfig(raw.maxViewersPerSession, 4, 1, 8),
        maxChromeRssBytesPerUser: roundedConfig(raw.maxChromeRssMb, 768, 256, 2048) * 1048576,
        maxTargetsPerUser: roundedConfig(raw.maxTargetsPerUser, 12, 4, 32),
        proxyConcurrency: roundedConfig(raw.proxyConcurrency, 96, 1, 200),
        proxyRequestsPerMinute: roundedConfig(raw.proxyRequestsPerMinute, 3000, 30, 6000),
        privateNetworkAllowlist: tokenList(raw.privateNetworkAllowlist),
        // Zero explicitly disables the grace period; the shared helper would replace it with 15.
        browserCloseGraceMs: (Number.isFinite(Number(raw.browserCloseGraceSeconds))
            ? Math.min(120, Math.max(0, Math.round(Number(raw.browserCloseGraceSeconds))))
            : 15) * 1000,
        vncDeferMs: roundedConfig(raw.vncDeferMs, 10, 5, 400),
    };
}
