import type { Visibility } from './store.js';

export interface SitesConfig {
  defaultVisibility: Visibility;
  allowPublicSites: boolean;
  publishers: 'everyone' | 'admins';
  maxSitesPerAccount: number;
  sessionTtlHours: number;
  /** Fixed bounds for proxying to an application already running inside a managed Project. */
  proxyRequestTimeoutSeconds: number;
  maxProxyResponseBytes: number;
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

/** The hostname base this instance serves sites under, derived from the app's own public URL.
 *
 *  It repeats, exactly, the rule core applies in `createPublishedSitesGatewayControl` — same input, same
 *  parse, same rejections — because the privileged control that normally answers this question is withheld
 *  from a forked tool runner, while `publicWebUrl` is not. Without this a runner could not name the address
 *  of a site the daemon addresses perfectly well, and `SiteCreate` refused as though the instance had no
 *  HTTPS domain at all.
 *
 *  Nothing here is privileged: the hostname is public by construction and deterministic from a URL every
 *  plugin already holds. `tests/sites-hostname-parity.test.mjs` pins this function against core's own, so
 *  the two derivations cannot drift into naming different hostnames for the same instance. */
export function derivedHostnameBase(publicWebUrl: string | null): string | null {
  if (!publicWebUrl) return null;
  try {
    const url = new URL(publicWebUrl);
    if (url.protocol !== 'https:' || !url.hostname.includes('.') || url.hostname === 'localhost') return null;
    return `sites.${url.hostname.toLowerCase()}`;
  } catch {
    return null;
  }
}

/** The broker derives this from trusted install metadata. The plugin accepts only that already-bare
 *  hostname and only beside an HTTPS app: a config form or request header never gets to choose where
 *  another person's site links point. */
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
  return {
    defaultVisibility,
    allowPublicSites: raw.allowPublicSites !== false,
    publishers: raw.publishers === 'admins' ? 'admins' : 'everyone',
    maxSitesPerAccount: bounded(raw.maxSitesPerAccount, 20, 1, 500),
    sessionTtlHours: bounded(raw.sessionTtlHours, 12, 1, 720),
    proxyRequestTimeoutSeconds: 15,
    maxProxyResponseBytes: 8 * 1048576,
    siteHostBase,
    siteScheme: appScheme,
    appBaseUrl: appOrigin,
  };
}

/** Just the addressing part of the configuration, so the serving path can answer host questions
 *  without being handed every unrelated setting. */
export type SiteAddressing = Pick<SitesConfig, 'siteHostBase' | 'siteScheme' | 'appBaseUrl'>;

/** The hostname one site is served from, or null while the gateway is unprovisioned. Exported because the
 *  certificate probe asks the gateway for exactly this name by SNI, and a second derivation of it could
 *  report a certificate as ready for a hostname the serving path never uses. */
export const siteHost = (config: SiteAddressing, slug: string): string | null =>
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
 *  the app's own hostname from reaching the same handler — `/hooks/` is proxied to the daemon there
 *  too — so a page served merely because a hostname exists in settings would still be same-origin with
 *  the app, which is the whole hazard the separate origin was for. */
export const requestOnSiteHost = (config: SiteAddressing, slug: string, hostHeader: string | undefined): boolean => {
  const expected = siteHost(config, slug);
  if (expected === null || !hostHeader) return false;
  // A Host is one hostname followed by at most one numeric port. Splitting on the first colon alone
  // would also accept `site.example.com:not-a-port` and `site.example.com:443:junk` as this site's own
  // address, which is a decision about identity made on a string nobody validated.
  const parsed = /^([^:]+)(?::(\d{1,5}))?$/.exec(hostHeader.trim());
  return parsed?.[1]?.toLowerCase() === expected;
};

/** Every publication owns the root of its own hostname. Kept in the API for legacy file rows and for
 *  callers that build links without knowing whether the row is file-backed or proxied. */
export const SITE_BASE_PATH = '/';
