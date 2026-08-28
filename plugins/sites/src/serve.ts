import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { PluginHttpRequest, PluginHttpResponse } from 'elowen/plugin-api';
import type { Site, SitesStore } from './store.js';
import {
  RESERVED_PREFIX, cookieName, hashToken, mayOpen, normalizeReturnPath, readCookies, signSession, verifySession,
  type AccessDeps, type Viewer,
} from './access.js';
import { CONTENT_TYPES, HTML_TYPE, extensionOf, resolveWithin } from './publish.js';

export interface ServeConfig {
  /** Where published sites are addressed from. Equal to the app's own URL unless a dedicated hostname
   *  is configured, in which case a site is on its own origin and may run its own scripts. */
  siteBaseUrl: string;
  appBaseUrl: string;
  dedicatedHost: boolean;
  sessionTtlHours: number;
}

export interface ServeDeps {
  store: SitesStore;
  access: AccessDeps;
  secret: string;
  config(): ServeConfig;
  releaseDir(siteId: string, releaseId: string): string;
  countHit(siteId: string): void;
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
    if (!SLUG_PATTERN.test(slug)) return notFound(config.dedicatedHost);

    const site = deps.store.siteBySlug(slug);
    if (!site || site.status !== 'live' || !site.currentReleaseId) return notFound(config.dedicatedHost);

    const siteRoot = `${config.siteBaseUrl}/hooks/sites/s/${site.slug}/`;

    if (rest === `${RESERVED_PREFIX}/session`) {
      return redeemTicket(req, site, siteRoot, deps, config);
    }
    if (rest.split('/')[0] === RESERVED_PREFIX) return notFound(config.dedicatedHost);

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return { status: 405, headers: { allow: 'GET, HEAD', 'cache-control': 'no-store' }, body: '' };
    }

    const viewer = viewerFor(req, site, deps);
    if (!mayOpen(site, viewer, deps.store, deps.access)) {
      if (site.visibility === 'public') return notFound(config.dedicatedHost);
      const accepts = req.headers.accept ?? '';
      if (!accepts.includes('text/html')) return notFound(config.dedicatedHost);
      const target = new URL(`${config.appBaseUrl}/p/sites/enter`);
      target.searchParams.set('site', site.slug);
      if (rest) target.searchParams.set('r', rest);
      return { status: 302, headers: { location: target.toString(), 'cache-control': 'no-store' }, body: '' };
    }

    deps.countHit(site.id);
    const response = serveFile(site, deps.releaseDir(site.id, site.currentReleaseId), rest, config.dedicatedHost);
    // A HEAD answer must carry the same headers and status as the GET, and no body.
    return req.method === 'HEAD' ? { ...response, body: '' } : response;
  };
}

function viewerFor(req: PluginHttpRequest, site: Site, deps: ServeDeps): Viewer {
  const cookies = readCookies(req.headers.cookie);
  const session = verifySession(deps.secret, cookies[cookieName(site.id)], Date.now());
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
): Promise<PluginHttpResponse> {
  if (req.method !== 'POST') {
    return { status: 405, headers: { allow: 'POST', 'cache-control': 'no-store' }, body: '' };
  }
  const form = parseForm(await req.body());
  const token = form.t;
  if (!token) return notFound(config.dedicatedHost);

  const ticket = deps.store.takeTicket(hashToken(token), Date.now());
  if (!ticket || ticket.siteId !== site.id) return notFound(config.dedicatedHost);

  // The ticket proves who asked, not that they still may: the answer is re-derived here so a permission
  // withdrawn between minting and redemption is honoured.
  if (!mayOpen(site, { userId: ticket.userId, admin: false }, deps.store, deps.access)) {
    return notFound(config.dedicatedHost);
  }

  const expires = Date.now() + config.sessionTtlHours * 3600_000;
  const value = signSession(deps.secret, { u: ticket.userId, g: site.accessGeneration, e: expires });
  const secure = siteRoot.startsWith('https://');
  // SameSite: on a dedicated hostname the site is its own origin and Lax is both correct and stricter.
  // On the shared origin the document is sandboxed into an opaque origin, whose subresource requests
  // count as cross-site, so Lax would withhold the cookie from the page's own stylesheets and images.
  const sameSite = config.dedicatedHost ? 'Lax' : 'None';
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
