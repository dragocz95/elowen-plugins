import { timingSafeEqual } from 'node:crypto';
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { RESERVED_PREFIX, cookieName, hashToken, mayOpen, normalizeReturnPath, readCookies, signSession, verifySession, } from './access.js';
import { CONTENT_TYPES, HTML_TYPE, extensionOf, resolveWithin } from './publish.js';
import { requestOnSiteHost } from './config.js';
import { ProxyError, proxyToEnvironment, proxyToRuntime } from './proxy.js';
/** Security headers applied to EVERY published response.
 *
 *  Every site is served from its own hostname, so a published page is a real origin: it may keep its own
 *  cookies and storage, and none of that is reachable from another site or from the app. The policy is
 *  therefore has no sandbox. Executable assets stay local, while HTTPS APIs and passive HTTPS assets are
 *  allowed because they cannot carry the Elowen app's host-only session cookie. */
const securityHeaders = (isPublic) => ({
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: blob: https:; font-src 'self' data: https:; media-src 'self' blob: https:; connect-src 'self' https: wss:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    ...(isPublic ? {} : { 'x-robots-tag': 'noindex, nofollow' }),
});
/** One answer for "there is nothing here" and for "you may not see this".
 *
 *  A site nobody shared with you must be indistinguishable from a slug that was never taken, or the
 *  404 itself becomes a way to enumerate what other people have published. */
const notFound = () => ({
    status: 404,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...securityHeaders(false) },
    body: '<!doctype html><meta charset="utf-8"><title>Not found</title><p>This address does not lead anywhere.</p>',
});
/** The answer for a request that reached this handler on anything other than the site's own hostname.
 *
 *  There is deliberately no same-origin serving mode to fall back to. `/hooks/` is proxied to the daemon
 *  on the app's hostname too, so answering here would put agent-authored pages same-origin with the app's
 *  session cookie — the exact hazard the separate origin exists to remove. */
const misdirected = () => ({
    status: 421,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...securityHeaders(false) },
    body: '<!doctype html><meta charset="utf-8"><title>Wrong address</title><p>Published sites are served from their own addresses, not from this one.</p>',
});
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;
/** The answer when the application behind a published address does not answer.
 *
 *  Header-for-header the same for both transports on purpose: which transport a site uses is this
 *  plugin's business, and a visitor who could tell them apart would learn something about the instance
 *  that is none of their business. There is no CSP here because there is no document of ours to
 *  constrain, and no shared caching of a failure. The status keeps the distinction the serving path has
 *  always made: 503 when there is no transport to send the request down at all, 502 when there is one and
 *  the application behind it failed. */
const ingressRefusal = (site, status, title, message) => ({
    status,
    headers: {
        'content-type': HTML_TYPE,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
        ...(site.visibility === 'public' ? {} : { 'x-robots-tag': 'noindex, nofollow' }),
    },
    body: `<!doctype html><meta charset="utf-8"><title>${title}</title><p>${message}</p>`,
});
/** A HEAD answer carries the GET's status and headers and no body.
 *
 *  A stream is never produced for HEAD in the first place — the file answers from its directory entry —
 *  so this only blanks the small documents (a 404 page, a refusal); dropping a stream here would leave
 *  its file descriptor open with nobody to close it. */
const withoutHeadBody = (response, method) => (method === 'HEAD' && !(response.body instanceof ReadableStream) ? { ...response, body: '' } : response);
function gatewayMarkerMatches(expected, actual) {
    if (!actual)
        return false;
    const left = Buffer.from(expected);
    const right = Buffer.from(actual);
    return left.length === right.length && timingSafeEqual(left, right);
}
/** The one answer for "you may not see this" AND for "this was never taken".
 *
 *  A browser asking for a page is sent to the app to sign in either way, so a stranger cannot tell an
 *  existing private site from a free slug. Anything that is not a page navigation gets a flat 404,
 *  because a fetch has no sign-in step to follow. */
function bounceOrNotFound(req, slug, rest, config) {
    const accepts = req.headers.accept ?? '';
    if (req.method !== 'GET' || !accepts.includes('text/html'))
        return notFound();
    const target = new URL(`${config.appBaseUrl}/p/sites/enter`);
    target.searchParams.set('site', slug);
    if (rest)
        target.searchParams.set('r', rest);
    return { status: 302, headers: { location: target.toString(), 'cache-control': 'no-store' }, body: '' };
}
const splitRemainder = (path) => {
    const clean = path.replace(/^\/+/, '');
    const slash = clean.indexOf('/');
    return slash < 0 ? { slug: clean, rest: '' } : { slug: clean.slice(0, slash), rest: clean.slice(slash + 1) };
};
const parseForm = (raw) => {
    const out = {};
    for (const pair of raw.toString('utf8').split('&')) {
        const eq = pair.indexOf('=');
        if (eq <= 0)
            continue;
        try {
            out[decodeURIComponent(pair.slice(0, eq))] = decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, ' '));
        }
        catch {
            // A malformed pair is simply not a field; the handler rejects on the missing value instead.
        }
    }
    return out;
};
/** What a daemon that cannot stream may still be handed in one piece.
 *
 *  This plugin ships separately from the daemon, so a build with streaming in it still runs on daemons
 *  released before the seam existed. There the body is a full copy in the daemon's heap per request, and
 *  64 MiB was the ceiling that made that survivable — it stays the ceiling on those daemons. */
const BUFFERED_CEILING_BYTES = 64 * 1048576;
/** The answer when the file is fine but this daemon cannot send it without holding it in memory. */
const tooLargeToBuffer = (isPublic) => ({
    status: 503,
    headers: { 'content-type': HTML_TYPE, 'cache-control': 'no-store', ...securityHeaders(isPublic) },
    body: '<!doctype html><meta charset="utf-8"><title>Unavailable</title><p>This file is too large for this version of the server to send. Update Elowen to serve it.</p>',
});
/** One `bytes=` range, or `null` when the request asks for the whole file.
 *
 *  Only a SINGLE range is honoured. A multipart answer needs its own boundary framing for a case no
 *  browser produces for a media element, and ignoring the header is a legal answer to any range request:
 *  the client gets the whole file and is no worse off than before ranges were supported at all. */
function parseRange(raw, size) {
    if (!raw)
        return null;
    const match = /^bytes=(\d*)-(\d*)$/.exec(raw.trim());
    if (!match)
        return null;
    const [, from, to] = match;
    if (from === '' && to === '')
        return null;
    // An empty file has no byte to hand out, so every range over it is unsatisfiable. Deciding that here
    // is also what keeps a suffix range from asking for the bytes before the start of the file.
    if (size === 0)
        return 'unsatisfiable';
    if (from === '') {
        // A suffix range: the LAST n bytes. Asking for zero of them cannot be satisfied.
        const length = Number(to);
        if (length === 0)
            return 'unsatisfiable';
        return { start: Math.max(0, size - length), end: size - 1 };
    }
    const start = Number(from);
    if (start >= size)
        return 'unsatisfiable';
    const end = to === '' ? size - 1 : Math.min(Number(to), size - 1);
    return end < start ? 'unsatisfiable' : { start, end };
}
/** Serve one file out of a release.
 *
 *  The bytes are streamed off the disk rather than read into the daemon: nothing here scales with the
 *  size of the file, which is what lets a site publish something far larger than the daemon's heap.
 *  HEAD is answered from the stat alone, so it never opens the file at all. */
function serveFile(site, releaseDir, rest, req) {
    const isPublic = site.visibility === 'public';
    const headers = securityHeaders(isPublic);
    // `no-cache` still lets a cache STORE the bytes; it just has to revalidate before reusing them.
    // A plain max-age would keep serving a page after its visibility was narrowed back to private,
    // because nothing on that path consults the daemon again until the age expires.
    const cacheControl = isPublic ? 'public, no-cache' : 'private, no-store';
    const answer = (resolved, type, size) => {
        const common = { ...headers, 'content-type': type, 'cache-control': cacheControl };
        if (!req.acceptsStreamBody) {
            // An older daemon buffers whatever it is given, so the old ceiling is the honest answer: refuse,
            // rather than hand it a file that would take the whole instance down with it.
            if (size > BUFFERED_CEILING_BYTES)
                return tooLargeToBuffer(isPublic);
            if (req.method === 'HEAD')
                return { status: 200, headers: { ...common, 'content-length': String(size) }, body: '' };
            return { status: 200, headers: common, body: new Uint8Array(readFileSync(resolved)) };
        }
        const streaming = { ...common, 'accept-ranges': 'bytes' };
        // HEAD is answered from the directory entry: the same status and headers as the GET, no open file.
        if (req.method === 'HEAD')
            return { status: 200, headers: { ...streaming, 'content-length': String(size) }, body: '' };
        const range = parseRange(req.headers.range, size);
        if (range === 'unsatisfiable') {
            return { status: 416, headers: { ...streaming, 'content-range': `bytes */${size}` }, body: '' };
        }
        if (range) {
            return {
                status: 206,
                headers: {
                    ...streaming,
                    'content-range': `bytes ${range.start}-${range.end}/${size}`,
                    'content-length': String(range.end - range.start + 1),
                },
                body: Readable.toWeb(createReadStream(resolved, { start: range.start, end: range.end })),
            };
        }
        return {
            status: 200,
            headers: { ...streaming, 'content-length': String(size) },
            body: Readable.toWeb(createReadStream(resolved)),
        };
    };
    const candidates = rest === '' || rest.endsWith('/')
        ? [join(rest, 'index.html')]
        : [rest, join(rest, 'index.html')];
    for (const candidate of candidates) {
        const resolved = resolveWithin(releaseDir, candidate);
        if (!resolved)
            continue;
        let stat;
        try {
            stat = statSync(resolved);
        }
        catch {
            continue;
        }
        if (!stat.isFile())
            continue;
        const ext = extensionOf(resolved);
        const type = CONTENT_TYPES[ext];
        if (!type)
            continue;
        return answer(resolved, type, stat.size);
    }
    if (site.spa) {
        const fallback = resolveWithin(releaseDir, 'index.html');
        if (fallback) {
            try {
                const stat = statSync(fallback);
                if (stat.isFile())
                    return answer(fallback, HTML_TYPE, stat.size);
            }
            catch {
                // The release lost its index.html between the walk above and here; there is nothing to fall back to.
            }
        }
    }
    return notFound();
}
/** The public surface of a published site: `/hooks/sites/s/<slug>/<path>`.
 *
 *  Bearer authentication is skipped for `/hooks/*` by design, so this handler owns every check. It never
 *  trusts an inbound header for identity and never forwards one: the browser sends the app's own session
 *  cookie here too, because that cookie is scoped to the whole origin. */
export function createSiteHandler(deps) {
    /** Send one request down a transport this plugin proxies to, and keep the answer a visitor may see.
     *
     *  Both transports end in the same transformation, and that is the point of keeping them here: a
     *  proxied answer arrives without the security headers and with the application's own caching, so the
     *  one place that adds them back has to be the one place BOTH paths go through. Only the wording of a
     *  refusal differs, because the reader's next step differs. */
    const proxyThroughIngress = async (site, req, rest, viewer, siteRoot, refusal) => {
        const endpoint = deps.endpointFor(site.id);
        if (!endpoint || endpoint.kind !== 'socket') {
            return ingressRefusal(site, 503, 'Not running', refusal.notRunning);
        }
        try {
            const proxied = await (deps.proxyEnvironment ?? proxyToEnvironment)(endpoint, req, rest, { userId: viewer.userId, name: viewer.userId === null ? null : deps.usernameOf(viewer.userId) }, deps.proxyLimits(), siteRoot, cookieName(site.id));
            return {
                ...proxied,
                headers: {
                    ...proxied.headers,
                    'cache-control': site.visibility === 'public' ? 'public, max-age=0' : 'private, no-store',
                    ...(site.visibility === 'public' ? {} : { 'x-robots-tag': 'noindex, nofollow' }),
                },
            };
        }
        catch (error) {
            if (!(error instanceof ProxyError))
                throw error;
            return ingressRefusal(site, 502, 'Unavailable', refusal.noAnswer);
        }
    };
    return async (req) => {
        const config = deps.config();
        const { slug, rest } = splitRemainder(req.path);
        if (!SLUG_PATTERN.test(slug))
            return notFound();
        // Two independent proofs that this request came through the site gateway, both required: the Host
        // header names the site's own hostname, and nginx overwrote the marker header on the way in. The
        // marker is what stops a loopback caller from simply claiming the Host.
        if (!requestOnSiteHost(config, slug, req.headers.host))
            return misdirected();
        if (!gatewayMarkerMatches(config.gatewayToken, req.headers['x-elowen-site-gateway']))
            return notFound();
        const siteRoot = `${config.siteScheme}//${slug}.${config.siteHostBase}/`;
        const site = deps.store.siteBySlug(slug) ?? deps.previews?.siteBySlug(slug);
        // A durable delete marker must disappear immediately and stay a flat tombstone while cleanup retries.
        if (site?.status === 'deleting')
            return notFound();
        // A site nobody shared with this visitor must be indistinguishable from a slug that was never
        // taken, so an unknown slug takes the SAME sign-in path a forbidden one takes. Answering 404 here
        // and 302 there is a working directory of everything published on the instance.
        // What counts as servable differs by publication: a file publication needs a release behind it, while
        // a proxy publication IS its application and has no release at all.
        if (!site
            || site.status !== 'live'
            || (site.kind !== 'proxy' && site.runtime !== 'environment' && !site.currentReleaseId)) {
            return bounceOrNotFound(req, slug, rest, config);
        }
        if (rest === `${RESERVED_PREFIX}/session`) {
            return redeemTicket(req, site, siteRoot, deps, config);
        }
        if (rest.split('/')[0] === RESERVED_PREFIX)
            return notFound();
        // A static site answers reads only. A command site is an application, so it takes the verbs an
        // application takes — its own request body is still capped at 1 MiB by the hook transport. A proxy
        // publication is an application too, whatever the legacy runtime column on its row happens to say.
        if (site.kind !== 'proxy' && site.runtime === 'static' && req.method !== 'GET' && req.method !== 'HEAD') {
            return { status: 405, headers: { allow: 'GET, HEAD', 'cache-control': 'no-store' }, body: '' };
        }
        const viewer = viewerFor(req, site, deps);
        if (!mayOpen(site, viewer, deps.store, deps.access)) {
            return bounceOrNotFound(req, site.slug, rest, config);
        }
        if (deps.previews?.isPreview(site.id))
            return deps.previews.serve(site, req, rest, viewer, siteRoot);
        deps.countHit(site.id);
        // A proxy publication is an application inside the Project's own environment, reached through the
        // transport Sandbox keeps alive for it. Access, sessions and the preview origin are decided exactly
        // as for every other publication: this branch changes the TRANSPORT, never who may open the page.
        if (site.kind === 'proxy') {
            return await proxyThroughIngress(site, req, rest, viewer, siteRoot, {
                notRunning: 'The project environment that serves this page is not available right now.',
                noAnswer: 'The project environment did not answer.',
            });
        }
        if (site.runtime === 'php') {
            const release = deps.releaseDir(site.id, site.currentReleaseId);
            const staticResponse = serveFile(site, release, rest, req);
            // Anything but "no such file" is the file's own answer — 200, a range answer, or a refusal — and
            // handing it to PHP instead would run a script for a request the release already answered.
            if (staticResponse.status !== 404)
                return withoutHeadBody(staticResponse, req.method);
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
            }
            catch {
                return {
                    status: 502,
                    headers: { 'content-type': HTML_TYPE, 'cache-control': 'no-store', ...securityHeaders(false) },
                    body: '<!doctype html><meta charset="utf-8"><title>Unavailable</title><p>This PHP site did not answer.</p>',
                };
            }
        }
        if (site.runtime === 'environment') {
            return await proxyThroughIngress(site, req, rest, viewer, siteRoot, {
                notRunning: 'This environment is not running right now.',
                noAnswer: 'This environment did not answer.',
            });
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
                const proxied = await proxyToRuntime(endpoint, req, rest, { userId: viewer.userId, name: viewer.userId === null ? null : deps.usernameOf(viewer.userId) }, deps.proxyLimits(), siteRoot);
                return {
                    ...proxied,
                    headers: {
                        ...proxied.headers,
                        ...securityHeaders(site.visibility === 'public'),
                        'cache-control': site.visibility === 'public' ? 'public, max-age=0' : 'private, no-store',
                    },
                };
            }
            catch (error) {
                if (!(error instanceof ProxyError))
                    throw error;
                return {
                    status: 502,
                    headers: { 'content-type': HTML_TYPE, 'cache-control': 'no-store', ...securityHeaders(false) },
                    body: '<!doctype html><meta charset="utf-8"><title>Unavailable</title><p>This site did not answer.</p>',
                };
            }
        }
        if (site.runtime !== 'static' || !site.currentReleaseId)
            return notFound();
        // A served file answers HEAD from its directory entry, so no stream is opened for one; the wrapper
        // covers the small documents serveFile returns when there is no file to serve.
        return withoutHeadBody(serveFile(site, deps.releaseDir(site.id, site.currentReleaseId), rest, req), req.method);
    };
}
function viewerFor(req, site, deps) {
    const cookies = readCookies(req.headers.cookie);
    const session = verifySession(deps.secret(), cookies[cookieName(site.id)], Date.now());
    if (!session || session.g !== site.accessGeneration)
        return { userId: null };
    return { userId: session.u };
}
/** Exchange a one-time ticket for a site session.
 *
 *  The ticket arrives as a form POST from the app's sign-in page rather than in a query string: a token
 *  in a URL survives in history, logs and the Referer header. Consumption is atomic in the store, so two
 *  browsers racing the same ticket cannot both be admitted. */
async function redeemTicket(req, site, siteRoot, deps, config) {
    if (req.method !== 'POST') {
        return { status: 405, headers: { allow: 'POST', 'cache-control': 'no-store' }, body: '' };
    }
    const form = parseForm(await req.body());
    const token = form.t;
    if (!token)
        return notFound();
    const ticket = deps.store.takeTicket(hashToken(token), Date.now());
    if (!ticket || ticket.siteId !== site.id)
        return notFound();
    // The ticket proves who asked, not that they still may: the answer is re-derived here so a permission
    // withdrawn between minting and redemption is honoured.
    if (!mayOpen(site, { userId: ticket.userId }, deps.store, deps.access)) {
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
