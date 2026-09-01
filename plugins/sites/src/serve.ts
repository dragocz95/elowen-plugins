import { timingSafeEqual } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { PluginHttpRequest } from 'elowen/plugin-api';
import type { SitesHttpResponse } from './coreSeams.js';
import type { Site, SitesStore } from './store.js';
import {
  RESERVED_PREFIX, cookieName, hashToken, mayOpen, normalizeReturnPath, readCookies, signSession, verifySession,
  type AccessDeps, type Viewer,
} from './access.js';
import { CONTENT_TYPES, HTML_TYPE, extensionOf, resolveWithin } from './publish.js';
import { requestOnSiteHost } from './config.js';
import { ProxyError, proxyToRuntime, type ProxyLimits } from './proxy.js';
import type { Endpoint } from './runtime.js';

interface ServeConfig {
  /** Base hostname each site gets a subdomain under, or null while the gateway is unprovisioned — in
   *  which case nothing is served at all. */
  siteHostBase: string | null;
  siteScheme: string;
  appBaseUrl: string;
  sessionTtlHours: number;
  /** Secret marker nginx overwrites on the wildcard path. A process that reaches the public hook on
   * loopback without passing through that vhost is not the gateway and gets nothing. */
  gatewayToken: string;
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
  executePhp(
    site: Site,
    releaseDir: string,
    req: PluginHttpRequest,
    rest: string,
    viewer: Viewer,
    siteRoot: string,
  ): Promise<SitesHttpResponse>;
}

/** Security headers applied to EVERY published response.
 *
 *  Every site is served from its own hostname, so a published page is a real origin: it may keep its own
 *  cookies and storage, and none of that is reachable from another site or from the app. The policy is
 *  therefore an ordinary same-origin one, with no sandbox and no cross-origin subresources. */
const securityHeaders = (isPublic: boolean): Record<string, string> => ({
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; font-src 'self' data:; media-src 'self'; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'",
  ...(isPublic ? {} : { 'x-robots-tag': 'noindex, nofollow' }),
});

/** One answer for "there is nothing here" and for "you may not see this".
 *
 *  A site nobody shared with you must be indistinguishable from a slug that was never taken, or the
 *  404 itself becomes a way to enumerate what other people have published. */
const notFound = (): SitesHttpResponse => ({
  status: 404,
  headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...securityHeaders(false) },
  body: '<!doctype html><meta charset="utf-8"><title>Not found</title><p>This address does not lead anywhere.</p>',
});

/** The answer for a request that reached this handler on anything other than the site's own hostname.
 *
 *  There is deliberately no same-origin serving mode to fall back to. `/hooks/` is proxied to the daemon
 *  on the app's hostname too, so answering here would put agent-authored pages same-origin with the app's
 *  session cookie — the exact hazard the separate origin exists to remove. */
const misdirected = (): SitesHttpResponse => ({
  status: 421,
  headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...securityHeaders(false) },
  body: '<!doctype html><meta charset="utf-8"><title>Wrong address</title><p>Published sites are served from their own addresses, not from this one.</p>',
});

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;

function gatewayMarkerMatches(expected: string, actual: string | undefined): boolean {
  if (!actual) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  return left.length === right.length && timingSafeEqual(left, right);
}

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
): SitesHttpResponse {
  const accepts = req.headers.accept ?? '';
  if (req.method !== 'GET' || !accepts.includes('text/html')) return notFound();
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
function serveFile(site: Site, releaseDir: string, rest: string): SitesHttpResponse {
  const isPublic = site.visibility === 'public';
  const headers = securityHeaders(isPublic);
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
        // `no-cache` still lets a cache STORE the bytes; it just has to revalidate before reusing them.
        // A plain max-age would keep serving a page after its visibility was narrowed back to private,
        // because nothing on that path consults the daemon again until the age expires.
        'cache-control': isPublic ? 'public, no-cache' : 'private, no-store',
      },
      body: new Uint8Array(readFileSync(resolved)),
    };
  }

  if (site.spa) {
    const fallback = resolveWithin(releaseDir, 'index.html');
    if (fallback) {
      return {
        status: 200,
        headers: { ...headers, 'content-type': HTML_TYPE, 'cache-control': isPublic ? 'public, no-cache' : 'private, no-store' },
        body: new Uint8Array(readFileSync(fallback)),
      };
    }
  }
  return notFound();
}

/** The public surface of a published site: `/hooks/sites/s/<slug>/<path>`.
 *
 *  Bearer authentication is skipped for `/hooks/*` by design, so this handler owns every check. It never
 *  trusts an inbound header for identity and never forwards one: the browser sends the app's own session
 *  cookie here too, because that cookie is scoped to the whole origin. */
export function createSiteHandler(deps: ServeDeps) {
  return async (req: PluginHttpRequest): Promise<SitesHttpResponse> => {
    const config = deps.config();
    const { slug, rest } = splitRemainder(req.path);
    if (!SLUG_PATTERN.test(slug)) return notFound();

    // Two independent proofs that this request came through the site gateway, both required: the Host
    // header names the site's own hostname, and nginx overwrote the marker header on the way in. The
    // marker is what stops a loopback caller from simply claiming the Host.
    if (!requestOnSiteHost(config, slug, req.headers.host)) return misdirected();
    if (!gatewayMarkerMatches(config.gatewayToken, req.headers['x-elowen-site-gateway'])) return notFound();
    const siteRoot = `${config.siteScheme}//${slug}.${config.siteHostBase}/`;

    const site = deps.store.siteBySlug(slug);
    // A durable delete marker must disappear immediately and stay a flat tombstone while cleanup retries.
    if (site?.status === 'deleting') return notFound();
    // A site nobody shared with this visitor must be indistinguishable from a slug that was never
    // taken, so an unknown slug takes the SAME sign-in path a forbidden one takes. Answering 404 here
    // and 302 there is a working directory of everything published on the instance.
    if (!site || site.status !== 'live' || !site.currentReleaseId) {
      return bounceOrNotFound(req, slug, rest, config);
    }

    if (rest === `${RESERVED_PREFIX}/session`) {
      return redeemTicket(req, site, siteRoot, deps, config);
    }
    if (rest.split('/')[0] === RESERVED_PREFIX) return notFound();

    // A static site answers reads only. A command site is an application, so it takes the verbs an
    // application takes — its own request body is still capped at 1 MiB by the hook transport.
    if (site.runtime === 'static' && req.method !== 'GET' && req.method !== 'HEAD') {
      return { status: 405, headers: { allow: 'GET, HEAD', 'cache-control': 'no-store' }, body: '' };
    }

    const viewer = viewerFor(req, site, deps);
    if (!mayOpen(site, viewer, deps.store, deps.access)) {
      return bounceOrNotFound(req, site.slug, rest, config);
    }

    deps.countHit(site.id);

    if (site.runtime === 'php') {
      const release = deps.releaseDir(site.id, site.currentReleaseId);
      const staticResponse = serveFile(site, release, rest);
      if (staticResponse.status === 200) return req.method === 'HEAD' ? { ...staticResponse, body: '' } : staticResponse;
      try {
        const response = await deps.executePhp(site, release, req, rest, viewer, siteRoot);
        return {
          ...response,
          headers: {
            ...response.headers,
            ...securityHeaders(site.visibility === 'public'),
            'cache-control': site.visibility === 'public' ? 'public, max-age=0' : 'private, no-store',
          },
        };
      } catch {
        return {
          status: 502,
          headers: { 'content-type': HTML_TYPE, 'cache-control': 'no-store', ...securityHeaders(false) },
          body: '<!doctype html><meta charset="utf-8"><title>Unavailable</title><p>This PHP site did not answer.</p>',
        };
      }
    }

    if (site.runtime === 'command') {
      const endpoint = deps.endpointFor(site.id);
      if (!endpoint) {
        return {
          status: 503,
          headers: { 'content-type': HTML_TYPE, 'cache-control': 'no-store', ...securityHeaders(false) },
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
            ...securityHeaders(site.visibility === 'public'),
            'cache-control': site.visibility === 'public' ? 'public, max-age=0' : 'private, no-store',
          },
        };
      } catch (error) {
        if (!(error instanceof ProxyError)) throw error;
        return {
          status: 502,
          headers: { 'content-type': HTML_TYPE, 'cache-control': 'no-store', ...securityHeaders(false) },
          body: '<!doctype html><meta charset="utf-8"><title>Unavailable</title><p>This site did not answer.</p>',
        };
      }
    }

    const response = serveFile(site, deps.releaseDir(site.id, site.currentReleaseId), rest);
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
): Promise<SitesHttpResponse> {
  if (req.method !== 'POST') {
    return { status: 405, headers: { allow: 'POST', 'cache-control': 'no-store' }, body: '' };
  }
  const form = parseForm(await req.body());
  const token = form.t;
  if (!token) return notFound();

  const ticket = deps.store.takeTicket(hashToken(token), Date.now());
  if (!ticket || ticket.siteId !== site.id) return notFound();

  // The ticket proves who asked, not that they still may: the answer is re-derived here so a permission
  // withdrawn between minting and redemption is honoured.
  if (!mayOpen(site, { userId: ticket.userId, admin: false }, deps.store, deps.access)) {
    return notFound();
  }

  const expires = Date.now() + config.sessionTtlHours * 3600_000;
  const value = signSession(deps.secret(), { u: ticket.userId, g: site.accessGeneration, e: expires });
  // The site owns its own hostname, so the cookie is scoped to that origin's root. `Lax` restricts when
  // a cookie is SENT, not when it may be set, and the redirect this response issues is a same-site
  // top-level GET — so the session is already carried on the very next request.
  const cookie = [
    `${cookieName(site.id)}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(config.sessionTtlHours * 3600)}`,
    ...(siteRoot.startsWith('https://') ? ['Secure'] : []),
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
