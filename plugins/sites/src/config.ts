import type { Visibility } from './store.js';

export interface SitesConfig {
  defaultVisibility: Visibility;
  allowPublicSites: boolean;
  publishers: 'everyone' | 'admins';
  maxAssetBytes: number;
  maxSiteBytes: number;
  maxSitesPerAccount: number;
  releasesKept: number;
  sessionTtlHours: number;
  /** Whether a site may be a process this plugin keeps running, rather than files on disk. Off by
   *  default: it puts agent-authored code on the network, and the confinement around it is a namespace,
   *  not a separate machine account. */
  allowCommandRuntime: boolean;
  allowEnvironments: boolean;
  environmentNetwork: 'isolated' | 'shared';
  environmentCpus: number;
  environmentMemoryMb: number;
  environmentPidsLimit: number;
  environmentDiskSoftMb: number;
  maxEnvironmentsPerAccount: number;
  runtimeNetwork: 'isolated' | 'shared';
  allowLoopbackPorts: boolean;
  loopbackPortMin: number;
  loopbackPortMax: number;
  startTimeoutSeconds: number;
  requestTimeoutSeconds: number;
  maxResponseBytes: number;
  /** Base hostname sites get their own subdomain under, or null when the gateway is not provisioned.
   *  A site is addressed at `<slug>.<siteHostBase>`, so every site is its OWN origin: one published
   *  page cannot read another's, and none of them is same-origin with the app.
   *
   *  Null is not a second serving mode. It means this instance cannot serve published sites at all,
   *  and every path that would need an address refuses instead of falling back to the app's origin —
   *  a page there would be same-origin with the app's session cookie. */
  siteHostBase: string | null;
  /** Scheme for site URLs, following the app's own. */
  siteScheme: string;
  /** Origin the Elowen app itself is on, without a trailing slash. */
  appBaseUrl: string;
}

const bounded = (value: unknown, fallback: number, min: number, max: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
};

const boundedFloat = (value: unknown, fallback: number, min: number, max: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed * 100) / 100));
};

export interface EnvironmentLimitOverrides {
  environmentCpus?: number | null;
  environmentMemoryMb?: number | null;
  environmentPidsLimit?: number | null;
  environmentDiskSoftMb?: number | null;
}

const ENVIRONMENT_LIMITS = {
  environmentCpus: { min: 0.25, max: 8, decimals: true },
  environmentMemoryMb: { min: 128, max: 32768, decimals: false },
  environmentPidsLimit: { min: 16, max: 4096, decimals: false },
  environmentDiskSoftMb: { min: 256, max: 131072, decimals: false },
} as const;

export function environmentLimitOverrides(raw: Record<string, unknown>): EnvironmentLimitOverrides {
  const out: EnvironmentLimitOverrides = {};
  for (const [key, bounds] of Object.entries(ENVIRONMENT_LIMITS) as
    [keyof EnvironmentLimitOverrides, (typeof ENVIRONMENT_LIMITS)[keyof typeof ENVIRONMENT_LIMITS]][]) {
    if (!(key in raw)) continue;
    if (raw[key] === null) { out[key] = null; continue; }
    const parsed = Number(raw[key]);
    if (!Number.isFinite(parsed)) throw new Error(`${key} must be a finite number or null`);
    const value = Math.min(bounds.max, Math.max(bounds.min, bounds.decimals ? Math.round(parsed * 100) / 100 : Math.round(parsed)));
    out[key] = value;
  }
  return out;
}

const VISIBILITY_DEFAULTS = new Set(['private', 'project', 'authenticated']);

/** Normalise a configured origin, or null when it is unusable.
 *
 *  A hostname that is not an absolute http(s) origin cannot be turned into a link, and guessing one from
 *  a request header is exactly the trick that lets a visitor choose where a sign-in redirect points. */
const asOrigin = (value: unknown): string | null => {
  if (typeof value !== 'string' || value.trim() === '') return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
};

/** The broker derives this from trusted install metadata. The plugin accepts only that already-bare
 * hostname and only beside an HTTPS app: a config form or request header never gets to choose where
 * another person's site links point. */
const asGatewayHost = (value: string | null | undefined, appScheme: string): string | null => {
  if (appScheme !== 'https:' || !value) return null;
  const host = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9.-]+$/.test(host) && host.includes('.') ? host : null;
};

/** Read the plugin's settings into the shape the rest of the plugin uses.
 *
 *  Every value is re-validated here because the daemon stores whatever the settings form sent: it
 *  enforces neither `required` nor the `min`/`max` the schema declares. */
export function resolveConfig(
  raw: Record<string, unknown>,
  publicWebUrl: string | null,
  gatewayHostBase: string | null = null,
): SitesConfig {
  const appOrigin = asOrigin(publicWebUrl) ?? '';
  const appScheme = appOrigin.startsWith('http://') ? 'http:' : 'https:';
  const siteHostBase = asGatewayHost(gatewayHostBase, appScheme);
  const defaultVisibility = typeof raw.defaultVisibility === 'string' && VISIBILITY_DEFAULTS.has(raw.defaultVisibility)
    ? raw.defaultVisibility as Visibility
    : 'private';
  const requestedPortMin = bounded(raw.loopbackPortMin, 41000, 1024, 65535);
  const requestedPortMax = bounded(raw.loopbackPortMax, 41999, 1024, 65535);
  const [loopbackPortMin, loopbackPortMax] = requestedPortMin <= requestedPortMax
    ? [requestedPortMin, requestedPortMax]
    : [41000, 41999];
  return {
    defaultVisibility,
    allowPublicSites: raw.allowPublicSites !== false,
    publishers: raw.publishers === 'admins' ? 'admins' : 'everyone',
    maxAssetBytes: bounded(raw.maxAssetMb, 8, 1, 64) * 1048576,
    maxSiteBytes: bounded(raw.maxSiteMb, 200, 1, 4096) * 1048576,
    maxSitesPerAccount: bounded(raw.maxSitesPerAccount, 20, 1, 500),
    releasesKept: bounded(raw.releasesKept, 5, 1, 50),
    sessionTtlHours: bounded(raw.sessionTtlHours, 12, 1, 720),
    allowCommandRuntime: raw.allowCommandRuntime === true,
    allowEnvironments: raw.allowEnvironments === true,
    environmentNetwork: raw.environmentNetwork === 'isolated' ? 'isolated' : 'shared',
    environmentCpus: boundedFloat(raw.environmentCpus, 1, ENVIRONMENT_LIMITS.environmentCpus.min, ENVIRONMENT_LIMITS.environmentCpus.max),
    environmentMemoryMb: bounded(raw.environmentMemoryMb, 1024, ENVIRONMENT_LIMITS.environmentMemoryMb.min, ENVIRONMENT_LIMITS.environmentMemoryMb.max),
    environmentPidsLimit: bounded(raw.environmentPidsLimit, 512, ENVIRONMENT_LIMITS.environmentPidsLimit.min, ENVIRONMENT_LIMITS.environmentPidsLimit.max),
    environmentDiskSoftMb: bounded(raw.environmentDiskSoftMb, 4096, ENVIRONMENT_LIMITS.environmentDiskSoftMb.min, ENVIRONMENT_LIMITS.environmentDiskSoftMb.max),
    maxEnvironmentsPerAccount: bounded(raw.maxEnvironmentsPerAccount, 3, 1, 20),
    runtimeNetwork: raw.runtimeNetwork === 'shared' ? 'shared' : 'isolated',
    allowLoopbackPorts: raw.allowLoopbackPorts === true,
    loopbackPortMin,
    loopbackPortMax,
    startTimeoutSeconds: bounded(raw.startTimeoutSeconds, 30, 5, 300),
    requestTimeoutSeconds: bounded(raw.requestTimeoutSeconds, 15, 1, 120),
    maxResponseBytes: bounded(raw.maxResponseMb, 8, 1, 64) * 1048576,
    siteHostBase,
    siteScheme: appScheme,
    appBaseUrl: appOrigin,
  };
}

/** Just the addressing part of the configuration, so the serving path can answer host questions
 *  without being handed every unrelated setting. */
export type SiteAddressing = Pick<SitesConfig, 'siteHostBase' | 'siteScheme' | 'appBaseUrl'>;

/** The hostname one site is served from, or null while the gateway is unprovisioned. */
const siteHost = (config: SiteAddressing, slug: string): string | null =>
  config.siteHostBase === null ? null : `${slug}.${config.siteHostBase}`;

/** Where a site lives, or null when this instance has no site hostname to put it on. Callers render the
 *  null as "not addressable yet" rather than inventing a URL on the app's own origin. */
export const siteUrl = (config: SiteAddressing, slug: string): string | null => {
  const host = siteHost(config, slug);
  return host === null ? null : `${config.siteScheme}//${host}/`;
};

/** Whether THIS request arrived on the site's own hostname.
 *
 *  Decided from the request, never from configuration alone. Configuring a site hostname does not stop
 *  the app's own hostname from reaching the same handler — `/hooks/` is proxied to the daemon there too
 *  — so a page served merely because a hostname exists in settings would still be same-origin with the
 *  app, which is the whole hazard the separate origin was for. */
export const requestOnSiteHost = (config: SiteAddressing, slug: string, hostHeader: string | undefined): boolean => {
  const expected = siteHost(config, slug);
  if (expected === null || !hostHeader) return false;
  // A Host is one hostname followed by at most one numeric port. Splitting on the first colon alone
  // would also accept `site.example.com:not-a-port` and `site.example.com:443:junk` as this site's own
  // address, which is a decision about identity made on a string nobody validated.
  const parsed = /^([^:]+)(?::(\d{1,5}))?$/.exec(hostHeader.trim());
  return parsed?.[1]?.toLowerCase() === expected;
};

/** The absolute prefix a build must be configured with. A site owns the root of its own hostname, so
 *  this is a constant — it is stated here because a publisher has to configure their bundler with it. */
export const SITE_BASE_PATH = '/';
