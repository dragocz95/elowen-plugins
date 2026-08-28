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
  startTimeoutSeconds: number;
  requestTimeoutSeconds: number;
  maxResponseBytes: number;
  portRangeStart: number;
  portRangeEnd: number;
  /** Base hostname sites get their own subdomain under, or null when they share the app's origin.
   *  A site is addressed at `<slug>.<siteHostBase>`, so every site is its OWN origin: one published
   *  page cannot read another's, and none of them is same-origin with the app. */
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

/** The bare hostname sites get a subdomain under.
 *
 *  Plain HTTP is refused unless it is loopback: a site session cookie travelling in clear is a session
 *  anyone on the path can take, and an operator who typed `http://` almost certainly did not mean that. */
const asHostBase = (value: unknown, appScheme: string): string | null => {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const raw = value.trim();
  const withScheme = /^https?:\/\//.test(raw) ? raw : `${appScheme}//${raw}`;
  try {
    const url = new URL(withScheme);
    const host = url.hostname.toLowerCase();
    if (!/^[a-z0-9.-]+$/.test(host) || host.startsWith('.') || !host.includes('.')) return null;
    const loopback = host === 'localhost' || host === '127.0.0.1';
    if (url.protocol === 'http:' && !loopback) return null;
    return host;
  } catch {
    return null;
  }
};

/** Read the plugin's settings into the shape the rest of the plugin uses.
 *
 *  Every value is re-validated here because the daemon stores whatever the settings form sent: it
 *  enforces neither `required` nor the `min`/`max` the schema declares. */
export function resolveConfig(raw: Record<string, unknown>, publicWebUrl: string | null): SitesConfig {
  const appOrigin = asOrigin(publicWebUrl) ?? '';
  const appScheme = appOrigin.startsWith('http://') ? 'http:' : 'https:';
  const siteHostBase = asHostBase(raw.siteHostOverride, appScheme);
  const defaultVisibility = typeof raw.defaultVisibility === 'string' && VISIBILITY_DEFAULTS.has(raw.defaultVisibility)
    ? raw.defaultVisibility as Visibility
    : 'private';
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
    startTimeoutSeconds: bounded(raw.startTimeoutSeconds, 30, 5, 300),
    requestTimeoutSeconds: bounded(raw.requestTimeoutSeconds, 15, 1, 120),
    maxResponseBytes: bounded(raw.maxResponseMb, 8, 1, 64) * 1048576,
    portRangeStart: bounded(raw.portRangeStart, 43000, 1024, 65000),
    portRangeEnd: bounded(raw.portRangeEnd, 43099, 1024, 65535),
    siteHostBase,
    siteScheme: appScheme,
    appBaseUrl: appOrigin,
  };
}

/** Just the addressing part of the configuration, so the serving path can answer host questions
 *  without being handed every unrelated setting. */
export type SiteAddressing = Pick<SitesConfig, 'siteHostBase' | 'siteScheme' | 'appBaseUrl'>;

/** The hostname one site is served from, or null when sites share the app's origin. */
const siteHost = (config: SiteAddressing, slug: string): string | null =>
  config.siteHostBase === null ? null : `${slug}.${config.siteHostBase}`;

export const siteUrl = (config: SiteAddressing, slug: string): string => {
  const host = siteHost(config, slug);
  const origin = host === null ? config.appBaseUrl : `${config.siteScheme}//${host}`;
  return `${origin}/hooks/sites/s/${slug}/`;
};

/** Whether THIS request arrived on the site's own hostname.
 *
 *  Decided from the request, never from configuration alone. Configuring a site hostname does not stop
 *  the app's own hostname from reaching the same handler — `/hooks/` is proxied to the daemon there too
 *  — so a page served with script-enabled headers merely because an override exists would still be
 *  same-origin with the app, which is the whole hazard the separate origin was for. */
export const requestOnSiteHost = (config: SiteAddressing, slug: string, hostHeader: string | undefined): boolean => {
  const expected = siteHost(config, slug);
  if (expected === null || !hostHeader) return false;
  const host = hostHeader.split(':')[0]?.trim().toLowerCase() ?? '';
  return host === expected;
};

/** The absolute prefix a build must be configured with. Relative asset paths cannot work: the serving
 *  layer is not told whether the visitor's URL ended in a slash, so it cannot canonicalise one. */
export const siteBasePath = (slug: string): string => `/hooks/sites/s/${slug}/`;
