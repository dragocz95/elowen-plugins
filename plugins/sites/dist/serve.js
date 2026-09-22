import { timingSafeEqual } from 'node:crypto';
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { CAPTURE_HEADER, RESERVED_PREFIX, captureCookieName, cookieName, hashToken, mayOpen, normalizeReturnPath, publiclyReadable, readCookies, signCaptureSession, signSession, verifyCaptureSession, verifySession, } from './access.js';
import { CONTENT_TYPES, HTML_TYPE, extensionOf, resolveWithin } from './releaseFiles.js';
import { ProxyError, proxyToProject } from './proxy.js';
/** How long the session a capture grant is exchanged for may render for. Minutes, not hours: it exists to
 *  carry the document and the assets that document asks for, in a browser profile that is deleted as soon
 *  as the picture is taken. */
const CAPTURE_SESSION_MS = 5 * 60_000;
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
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;
/** The answer when the application behind a published address does not answer.
 *
 *  Header-for-header the same for both transports on purpose: which transport a site uses is this
 *  plugin's business, and a visitor who could tell them apart would learn something about the instance
 *  that is none of their business. There is no CSP here because there is no document of ours to
 *  constrain, and no shared caching of a failure. The status keeps the distinction the serving path has
 *  always made: 503 when there is no transport to send the request down at all, 502 when there is one and
 *  the application behind it failed. */
const ingressRefusal = (isPublic, status, title, message) => ({
    status,
    headers: {
        'content-type': HTML_TYPE,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
        ...(isPublic ? {} : { 'x-robots-tag': 'noindex, nofollow' }),
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
function bounceOrNotFound(req, bindingId, rest, config) {
    const accepts = req.headers.accept ?? '';
    if (req.method !== 'GET' || !accepts.includes('text/html'))
        return notFound();
    const target = new URL(`${config.appBaseUrl}/p/sites/enter`);
    target.searchParams.set('binding', bindingId);
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
function serveFile(site, isPublic, releaseDir, rest, req) {
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
    const proxyThroughIngress = async (site, req, rest, viewer, 
    // One request, one answer to "may anybody at all read this": the handler decides it once and passes it
    // down, rather than every refusal and every header asking the same question again.
    publiclyServed, siteRoot, refusal) => {
        const endpoint = deps.endpointFor(site.id);
        if (!endpoint || endpoint.kind !== 'socket') {
            return ingressRefusal(publiclyServed, 503, 'Not running', refusal.notRunning);
        }
        try {
            const proxied = await (deps.proxyProject ?? proxyToProject)(endpoint, req, rest, 
            // A capture renders what an anonymous visitor gets. The grant proves the right to be SERVED here;
            // it is not an account, and forwarding one to the application would put a person's identity into a
            // picture taken for a register.
            viewer.capability === 'capture'
                ? { userId: null, name: null }
                : { userId: viewer.userId, name: viewer.userId === null ? null : deps.usernameOf(viewer.userId) }, deps.proxyLimits(), siteRoot, [cookieName(site.id), captureCookieName(site.id)]);
            return {
                ...proxied,
                headers: {
                    ...proxied.headers,
                    'cache-control': publiclyServed ? 'public, max-age=0' : 'private, no-store',
                    ...(publiclyServed ? {} : { 'x-robots-tag': 'noindex, nofollow' }),
                },
            };
        }
        catch (error) {
            if (!(error instanceof ProxyError))
                throw error;
            return ingressRefusal(publiclyServed, 502, 'Unavailable', refusal.noAnswer);
        }
    };
    return async (req) => {
        const config = deps.config();
        const { slug, rest } = splitRemainder(req.path);
        if (!SLUG_PATTERN.test(slug))
            return notFound();
        // Three proofs are required together: nginx's secret marker, an active Host binding, and the Site
        // identity baked into the internal route. A valid hostname for one Site can never authorize another
        // Site merely because a loopback caller changed the slug in the path.
        if (!gatewayMarkerMatches(config.gatewayToken, req.headers['x-elowen-site-gateway']))
            return notFound();
        const acceptedBinding = deps.addresses.bindingForRequest(slug, req.headers.host);
        if (!acceptedBinding)
            return notFound();
        const siteRoot = deps.addresses.urlForHostname(acceptedBinding.hostname);
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
            || (site.kind !== 'proxy' && !site.currentReleaseId)) {
            return bounceOrNotFound(req, acceptedBinding.id, rest, config);
        }
        if (rest === `${RESERVED_PREFIX}/session`) {
            return redeemTicket(req, site, siteRoot, deps, config);
        }
        if (rest.split('/')[0] === RESERVED_PREFIX)
            return notFound();
        const granted = claimCapture(req, site, deps);
        const viewer = granted ? { userId: null, capability: 'capture' } : viewerFor(req, site, deps);
        // Decided here, once, and used for the rest of the request: the instance switch behind it is read live,
        // so asking twice could answer differently mid-request and hand one visitor a public cache header on a
        // page the same visitor was just refused.
        const publiclyServed = publiclyReadable(site, deps.access);
        if (!mayOpen(site, viewer, deps.store, deps.access)) {
            return bounceOrNotFound(req, acceptedBinding.id, rest, config);
        }
        // Static releases answer reads only. Proxy publications forward the application's OWN methods, so a
        // refusal here would be this plugin inventing a contract for somebody else's application.
        //
        // Decided AFTER access, deliberately: answering 405 to a stranger who guessed the slug would tell them
        // the address is published and which kind it is, which is exactly what the sign-in bounce above exists
        // to hide. A visitor who may open the page is the only reader this answer is for.
        if (site.kind !== 'proxy' && req.method !== 'GET' && req.method !== 'HEAD') {
            return { status: 405, headers: { allow: 'GET, HEAD', 'cache-control': 'no-store' }, body: '' };
        }
        const answer = await (async () => {
            if (deps.previews?.isPreview(site.id))
                return deps.previews.serve(site, req, rest, viewer, siteRoot);
            // A picture of the page is not a visit. Counting the capture itself would also count every asset it
            // loads, so one screenshot would arrive in the register's own numbers as a small crowd.
            if (viewer.capability !== 'capture')
                deps.countHit(site.id);
            // A proxy publication is an application inside the managed Project, reached through the durable
            // transport Sandbox keeps alive for it. Access, sessions and the preview origin are decided exactly
            // as for every other publication: this branch changes the TRANSPORT, never who may open the page.
            if (site.kind === 'proxy') {
                return await proxyThroughIngress(site, req, rest, viewer, publiclyServed, siteRoot, {
                    notRunning: 'The managed Project transport that serves this page is not available right now.',
                    noAnswer: 'The managed Project application did not answer.',
                });
            }
            if (!site.currentReleaseId)
                return notFound();
            // A served file answers HEAD from its directory entry, so no stream is opened for one; the wrapper
            // covers the small documents serveFile returns when there is no file to serve.
            return withoutHeadBody(serveFile(site, publiclyServed, deps.releaseDir(site.id, site.currentReleaseId), rest, req), req.method);
        })();
        return granted ? withCaptureSession(answer, site, deps) : answer;
    };
}
/** Spend a capture grant, if this request presents one.
 *
 *  Decided before access is, because for this one render the grant IS the access decision. A request that
 *  presents nothing — or something this site never minted, or a token already spent, or one minted before
 *  the site's access last changed — is left exactly as it was, so it takes the ordinary sign-in path. */
function claimCapture(req, site, deps) {
    const token = req.headers[CAPTURE_HEADER];
    if (!token)
        return false;
    return deps.store.takeCaptureGrant(hashToken(token), site.id, site.accessGeneration, Date.now());
}
/** Hand the browser the session a spent grant bought, so the page's own assets are served too.
 *
 *  Appended to whatever the answer already carries rather than replacing it: a proxied page sets its own
 *  cookies, and dropping them would break the page this picture is of. */
function withCaptureSession(response, site, deps) {
    const value = signCaptureSession(deps.secret(), { g: site.accessGeneration, e: Date.now() + CAPTURE_SESSION_MS });
    const cookie = [
        `${captureCookieName(site.id)}=${value}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        `Max-Age=${Math.floor(CAPTURE_SESSION_MS / 1000)}`,
        'Secure',
    ].join('; ');
    const existing = response.headers?.['set-cookie'];
    const setCookie = existing === undefined ? [cookie] : [...(Array.isArray(existing) ? existing : [existing]), cookie];
    return { ...response, headers: { ...response.headers, 'set-cookie': setCookie } };
}
function viewerFor(req, site, deps) {
    const cookies = readCookies(req.headers.cookie);
    // The capture session first: it names no account, so nothing below it could stand in for one.
    const capture = verifyCaptureSession(deps.secret(), cookies[captureCookieName(site.id)], Date.now());
    if (capture && capture.g === site.accessGeneration)
        return { userId: null, capability: 'capture' };
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
