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
  /** Origin published sites are addressed from, without a trailing slash. */
  siteBaseUrl: string;
  /** Origin the Elowen app itself is on, without a trailing slash. */
  appBaseUrl: string;
  /** Whether sites live on their own hostname. Decides whether a published page may run scripts. */
  dedicatedHost: boolean;
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

/** Read the plugin's settings into the shape the rest of the plugin uses.
 *
 *  Every value is re-validated here because the daemon stores whatever the settings form sent: it
 *  enforces neither `required` nor the `min`/`max` the schema declares. */
export function resolveConfig(raw: Record<string, unknown>, publicWebUrl: string | null): SitesConfig {
  const appOrigin = asOrigin(publicWebUrl) ?? '';
  const siteOrigin = asOrigin(raw.siteHostOverride);
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
    siteBaseUrl: siteOrigin ?? appOrigin,
    appBaseUrl: appOrigin,
    dedicatedHost: siteOrigin !== null && siteOrigin !== appOrigin,
  };
}

export const siteUrl = (config: SitesConfig, slug: string): string =>
  `${config.siteBaseUrl}/hooks/sites/s/${slug}/`;

/** The absolute prefix a build must be configured with. Relative asset paths cannot work: the serving
 *  layer is not told whether the visitor's URL ended in a slash, so it cannot canonicalise one. */
export const siteBasePath = (slug: string): string => `/hooks/sites/s/${slug}/`;
