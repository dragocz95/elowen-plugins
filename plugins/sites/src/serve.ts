import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { PluginHttpRequest, PluginHttpResponse } from 'elowen/plugin-api';
import type { Site, SitesStore } from './store.js';
import {
  RESERVED_PREFIX, cookieName, hashToken, mayOpen, normalizeReturnPath, readCookies, signSession, verifySession,
  type AccessDeps, type Viewer,
} from './access.js';
import { CONTENT_TYPES, HTML_TYPE, extensionOf, resolveWithin } from './publish.js';
import { requestOnSiteHost } from './config.js';
import { ProxyError, proxyToRuntime, type ProxyLimits } from './proxy.js';
import type { Endpoint } from './runtime.js';

export interface ServeConfig {
  /** Base hostname each site gets a subdomain under, or null when sites share the app's origin. */
  siteHostBase: string | null;
  siteScheme: string;
  appBaseUrl: string;
  sessionTtlHours: number;
}

export interface ServeDeps {
  store: SitesStore;
  access: AccessDeps;
  /** Resolved on FIRST USE, not at registration. The secret vault is not wired in every process that
   *  loads plugins (a sub-agent runner has none), and a plugin that reads it while registering does not
   *  load there at all — taking its tools down with it for a key nothing in that process will use. */
  secret(): string;
  config(): ServeConfig;
  releaseDir(siteId: string, releaseId: string): string;
  countHit(siteId: string): void;
  /** Where a command site's process is listening, or null when it is not running. */
  endpointFor(siteId: string): Endpoint | null;
  proxyLimits(): ProxyLimits;
  usernameOf(userId: number): string | null;
}

/** Security headers applied to EVERY published response.
 *
 *  On the shared origin a published page is same-origin with the app, whose session cookie is a bearer
 *  token at `Path=/`. A page that could run script there could call the app's API as whoever is looking
 *  at it. `sandbox` without `allow-same-origin` puts the document in an opaque origin and no script runs
 *  at all, which is why the shared origin serves passive content only. A dedicated hostname is a
 *  different origin to begin with, so there the site is allowed to be a real application. */
const securityHeaders = (dedicated: boolean, isPublic: boolean): Record<string, string> => ({
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'content-security-policy': dedicated
    ? "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; font-src 'self' data:; media-src 'self'; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'"
    : "sandbox; default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; media-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  ...(isPublic ? {} : { 'x-robots-tag': 'noindex, nofollow' }),
});

/** One answer for "there is nothing here" and for "you may not see this".
 *
 *  A site nobody shared with you must be indistinguishable from a slug that was never taken, or the
 *  404 itself becomes a way to enumerate what other people have published. */
const notFound = (dedicated: boolean): PluginHttpResponse => ({
  status: 404,
  headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...securityHeaders(dedicated, false) },
  body: '<!doctype html><meta charset="utf-8"><title>Not found</title><p>This address does not lead anywhere.</p>',
});

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;

/** The one answer for "you may not see this" AND for "this was never taken".
 *
 *  A browser asking for a page is sent to the app to sign in either way, so a stranger cannot tell an
 *  existing private site from a free slug. Anything that is not a page navigation gets a flat 404,
 *  because a fetch has no sign-in step to follow. */
function bounceOrNotFound(
  req: PluginHttpRequest,
  slug: string,
  rest: string,
  config: ServeConfig,
  onSiteHost: boolean,
): PluginHttpResponse {
  const accepts = req.headers.accept ?? '';
  if (req.method !== 'GET' || !accepts.includes('text/html')) return notFound(onSiteHost);
  const target = new URL(`${config.appBaseUrl}/p/sites/enter`);
  target.searchParams.set('site', slug);
  if (rest) target.searchParams.set('r', rest);
  return { status: 302, headers: { location: target.toString(), 'cache-control': 'no-store' }, body: '' };
}

const splitRemainder = (path: string): { slug: string; rest: string } => {
  const clean = path.replace(/^\/+/, '');
  const slash = clean.indexOf('/');
  return slash < 0 ? { slug: clean, rest: '' } : { slug: clean.slice(0, slash), rest: clean.slice(slash + 1) };
};

const parseForm = (raw: Buffer): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const pair of raw.toString('utf8').split('&')) {
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    try {
      out[decodeURIComponent(pair.slice(0, eq))] = decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, ' '));
    } catch {
      // A malformed pair is simply not a field; the handler rejects on the missing value instead.
    }
  }
  return out;
};

/** Serve one file out of a release. */
function serveFile(site: Site, releaseDir: string, rest: string, dedicated: boolean): PluginHttpResponse {
  const isPublic = site.visibility === 'public';
  const headers = securityHeaders(dedicated, isPublic);
  const candidates = rest === '' || rest.endsWith('/')
    ? [join(rest, 'index.html')]
    : [rest, join(rest, 'index.html')];

  for (const candidate of candidates) {
    const resolved = resolveWithin(releaseDir, candidate);
    if (!resolved) continue;
    let stat;
    try {
      stat = statSync(resolved);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    const ext = extensionOf(resolved);
    const type = CONTENT_TYPES[ext];
    if (!type) continue;
    return {
      status: 200,
      headers: {
        ...headers,
        'content-type': type,
        'cache-control': isPublic
          ? (ext === 'html' || ext === 'htm' ? 'public, max-age=300' : 'public, max-age=86400')
          : 'private, no-store',
      },
      body: new Uint8Array(readFileSync(resolved)),
    };
  }

  if (site.spa) {
    const fallback = resolveWithin(releaseDir, 'index.html');
    if (fallback) {
      return {
        status: 200,
        headers: { ...headers, 'content-type': HTML_TYPE, 'cache-control': isPublic ? 'public, max-age=300' : 'private, no-store' },
        body: new Uint8Array(readFileSync(fallback)),
      };
    }
  }
  return notFound(dedicated);
}

/** The public surface of a published site: `/hooks/sites/s/<slug>/<path>`.
 *
 *  Bearer authentication is skipped for `/hooks/*` by design, so this handler owns every check. It never
 *  trusts an inbound header for identity and never forwards one: the browser sends the app's own session
 *  cookie here too, because that cookie is scoped to the whole origin. */
export function createSiteHandler(deps: ServeDeps) {
  return async (req: PluginHttpRequest): Promise<PluginHttpResponse> => {
    const config = deps.config();
    const { slug, rest } = splitRemainder(req.path);
    if (!SLUG_PATTERN.test(slug)) return notFound(false);

    // Whether this REQUEST arrived on the site's own hostname, not whether one is configured. On the
    // app's hostname a published page is same-origin with the app, so it is served passive whatever the
    // settings say.
    const onSiteHost = requestOnSiteHost(config, slug, req.headers.host);
    const siteRoot = onSiteHost
      ? `${config.siteScheme}//${slug}.${config.siteHostBase}/hooks/sites/s/${slug}/`
      : `${config.appBaseUrl}/hooks/sites/s/${slug}/`;

    const site = deps.store.siteBySlug(slug);
    // A site nobody shared with this visitor must be indistinguishable from a slug that was never
    // taken, so an unknown slug takes the SAME sign-in path a forbidden one takes. Answering 404 here
    // and 302 there is a working directory of everything published on the instance.
    if (!site || site.status !== 'live' || !site.currentReleaseId) {
      return bounceOrNotFound(req, slug, rest, config, onSiteHost);
    }

    if (rest === `${RESERVED_PREFIX}/session`) {
      return redeemTicket(req, site, siteRoot, deps, config, onSiteHost);
    }
    if (rest.split('/')[0] === RESERVED_PREFIX) return notFound(onSiteHost);

    // A static site answers reads only. A command site is an application, so it takes the verbs an
    // application takes — its own request body is still capped at 1 MiB by the hook transport.
    if (site.runtime === 'static' && req.method !== 'GET' && req.method !== 'HEAD') {
      return { status: 405, headers: { allow: 'GET, HEAD', 'cache-control': 'no-store' }, body: '' };
    }

    const viewer = viewerFor(req, site, deps);
    if (!mayOpen(site, viewer, deps.store, deps.access)) {
      return bounceOrNotFound(req, site.slug, rest, config, onSiteHost);
    }

    deps.countHit(site.id);

    if (site.runtime === 'command') {
      // An application reached on the app's own hostname would be served with scripts disabled, which
      // is not a degraded experience but a broken one. It answers only on its own origin.
      if (!onSiteHost) {
        return {
          status: 421,
          headers: { 'content-type': HTML_TYPE, 'cache-control': 'no-store', ...securityHeaders(false, false) },
          body: '<!doctype html><meta charset="utf-8"><title>Wrong address</title><p>This site is served from its own address.</p>',
        };
      }
      const endpoint = deps.endpointFor(site.id);
      if (!endpoint) {
        return {
          status: 503,
          headers: { 'content-type': HTML_TYPE, 'cache-control': 'no-store', ...securityHeaders(onSiteHost, false) },
          body: '<!doctype html><meta charset="utf-8"><title>Not running</title><p>This site is not running right now.</p>',
        };
      }
      try {
        const proxied = await proxyToRuntime(
          endpoint,
          req,
          rest,
          { userId: viewer.userId, name: viewer.userId === null ? null : deps.usernameOf(viewer.userId) },
          deps.proxyLimits(),
          siteRoot,
        );
        return {
          ...proxied,
          headers: {
            ...proxied.headers,
            ...securityHeaders(onSiteHost, site.visibility === 'public'),
            'cache-control': site.visibility === 'public' ? 'public, max-age=0' : 'private, no-store',
          },
        };
      } catch (error) {
        if (!(error instanceof ProxyError)) throw error;
        return {
          status: 502,
          headers: { 'content-type': HTML_TYPE, 'cache-control': 'no-store', ...securityHeaders(onSiteHost, false) },
          body: '<!doctype html><meta charset="utf-8"><title>Unavailable</title><p>This site did not answer.</p>',
        };
      }
    }

    const response = serveFile(site, deps.releaseDir(site.id, site.currentReleaseId), rest, onSiteHost);
    // A HEAD answer must carry the same headers and status as the GET, and no body.
    return req.method === 'HEAD' ? { ...response, body: '' } : response;
  };
}

function viewerFor(req: PluginHttpRequest, site: Site, deps: ServeDeps): Viewer {
  const cookies = readCookies(req.headers.cookie);
  const session = verifySession(deps.secret(), cookies[cookieName(site.id)], Date.now());
  if (!session || session.g !== site.accessGeneration) return { userId: null, admin: false };
  return { userId: session.u, admin: false };
}

/** Exchange a one-time ticket for a site session.
 *
 *  The ticket arrives as a form POST from the app's sign-in page rather than in a query string: a token
 *  in a URL survives in history, logs and the Referer header. Consumption is atomic in the store, so two
 *  browsers racing the same ticket cannot both be admitted. */
async function redeemTicket(
  req: PluginHttpRequest,
  site: Site,
  siteRoot: string,
  deps: ServeDeps,
  config: ServeConfig,
  onSiteHost: boolean,
): Promise<PluginHttpResponse> {
  if (req.method !== 'POST') {
    return { status: 405, headers: { allow: 'POST', 'cache-control': 'no-store' }, body: '' };
  }
  const form = parseForm(await req.body());
  const token = form.t;
  if (!token) return notFound(onSiteHost);

  const ticket = deps.store.takeTicket(hashToken(token), Date.now());
  if (!ticket || ticket.siteId !== site.id) return notFound(onSiteHost);

  // The ticket proves who asked, not that they still may: the answer is re-derived here so a permission
  // withdrawn between minting and redemption is honoured.
  if (!mayOpen(site, { userId: ticket.userId, admin: false }, deps.store, deps.access)) {
    return notFound(onSiteHost);
  }

  const expires = Date.now() + config.sessionTtlHours * 3600_000;
  const value = signSession(deps.secret(), { u: ticket.userId, g: site.accessGeneration, e: expires });
  const secure = siteRoot.startsWith('https://');
  // SameSite: on a dedicated hostname the site is its own origin and Lax is both correct and stricter.
  // On the shared origin the document is sandboxed into an opaque origin, whose subresource requests
  // count as cross-site, so Lax would withhold the cookie from the page's own stylesheets and images.
  const sameSite = onSiteHost ? 'Lax' : 'None';
  const cookie = [
    `${cookieName(site.id)}=${value}`,
    `Path=/hooks/sites/s/${site.slug}/`,
    'HttpOnly',
    `SameSite=${sameSite}`,
    `Max-Age=${Math.floor(config.sessionTtlHours * 3600)}`,
    ...(secure || sameSite === 'None' ? ['Secure'] : []),
  ].join('; ');

  return {
    status: 302,
    headers: {
      location: `${siteRoot}${normalizeReturnPath(ticket.returnPath)}`,
      'set-cookie': cookie,
      'cache-control': 'no-store',
    },
    body: '',
  };
}
