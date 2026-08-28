import { request as httpRequest } from 'node:http';
/** Request headers a published runtime may see.
 *
 *  An allow-list, not a deny-list, and that is the whole point. The browser sends the APP's session
 *  cookie to this path too, because that cookie is scoped to the whole origin and its value IS a daemon
 *  bearer token — forwarding it would hand an agent-authored server the visitor's account. `cookie`,
 *  `authorization` and every `x-elowen-*` header are therefore not merely stripped: they can never be
 *  named here in the first place. */
const FORWARDED_REQUEST_HEADERS = new Set([
    'accept', 'accept-language', 'content-type',
    'user-agent', 'referer', 'if-none-match', 'if-modified-since',
]);
/** Response headers the runtime is allowed to decide.
 *
 *  `set-cookie` is absent deliberately: hook responses pass headers through unchanged, so a runtime
 *  that answered with one could set a cookie at any path on this origin — including over the app's own
 *  session. CORS headers are absent for the same reason: what may read this site is decided by the
 *  access rules, not by the site. */
const FORWARDED_RESPONSE_HEADERS = new Set([
    'content-type', 'content-language', 'etag', 'last-modified', 'content-disposition',
]);
/** Keep a redirect inside the site.
 *
 *  A runtime naming any absolute URL would be able to bounce a visitor who trusted this address off to
 *  somewhere else entirely. A relative target is kept as-is; an absolute one is kept only when it
 *  points back at the same site root; anything else collapses to the site root. */
function safeLocation(value, siteRoot) {
    const trimmed = value.trim();
    if (trimmed === '')
        return siteRoot;
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) || trimmed.startsWith('//')) {
        return trimmed.startsWith(siteRoot) ? trimmed : siteRoot;
    }
    if (trimmed.startsWith('/')) {
        try {
            return new URL(trimmed, siteRoot).toString().startsWith(siteRoot)
                ? new URL(trimmed, siteRoot).toString()
                : siteRoot;
        }
        catch {
            return siteRoot;
        }
    }
    return trimmed;
}
export class ProxyError extends Error {
}
/** Forward one request to a site's runtime and buffer the answer.
 *
 *  Buffered because the hook transport is: it has no streaming and no SSE, so a runtime that wants to
 *  stream cannot, and saying that plainly is better than truncating something halfway. */
export async function proxyToRuntime(endpoint, req, path, viewer, limits, siteRoot) {
    const headers = {};
    for (const [name, value] of Object.entries(req.headers)) {
        if (FORWARDED_REQUEST_HEADERS.has(name))
            headers[name] = value;
    }
    headers.host = 'site.localhost';
    headers['x-forwarded-proto'] = 'https';
    // Identity encoding only: the answer is buffered and handed on verbatim, so a compressed body would
    // arrive at the browser without the `content-encoding` that explains it.
    headers['accept-encoding'] = 'identity';
    // The verified identity, so a dashboard can greet whoever is looking at it without implementing any
    // authentication of its own. It is trustworthy exactly because the inbound allow-list above cannot
    // carry an `x-elowen-*` header in.
    if (viewer.userId !== null) {
        headers['x-elowen-user-id'] = String(viewer.userId);
        if (viewer.name)
            headers['x-elowen-user-name'] = encodeURIComponent(viewer.name);
    }
    const query = new URLSearchParams(req.query).toString();
    const target = `/${path}${query ? `?${query}` : ''}`;
    const body = await req.body();
    // Recomputed, never forwarded: a client-supplied length that disagrees with the bytes actually sent
    // is how a request gets split into two on the far side.
    if (body.length > 0)
        headers['content-length'] = String(body.length);
    return new Promise((resolve, reject) => {
        // An idle timeout alone lets a runtime trickle bytes forever. This is the absolute deadline for the
        // whole exchange.
        const deadline = setTimeout(() => {
            outbound.destroy();
            reject(new ProxyError(`the runtime did not finish within ${limits.requestTimeoutSeconds}s`));
        }, limits.requestTimeoutSeconds * 1000);
        deadline.unref?.();
        const done = (fn) => (value) => { clearTimeout(deadline); fn(value); };
        const settle = done(resolve);
        const fail = done(reject);
        const outbound = httpRequest({
            ...(endpoint.kind === 'socket' ? { socketPath: endpoint.path } : { host: '127.0.0.1', port: endpoint.port }),
            method: req.method,
            path: target,
            headers,
            timeout: limits.requestTimeoutSeconds * 1000,
        }, (response) => {
            const chunks = [];
            let size = 0;
            let aborted = false;
            response.on('data', (chunk) => {
                size += chunk.length;
                if (size > limits.maxResponseBytes) {
                    aborted = true;
                    response.destroy();
                    fail(new ProxyError('the runtime answered with more data than the configured response limit'));
                    return;
                }
                chunks.push(chunk);
            });
            response.on('end', () => {
                if (aborted)
                    return;
                const out = {};
                for (const [name, value] of Object.entries(response.headers)) {
                    if (!FORWARDED_RESPONSE_HEADERS.has(name) || value === undefined)
                        continue;
                    out[name] = Array.isArray(value) ? value.join(', ') : String(value);
                }
                const location = response.headers.location;
                if (typeof location === 'string')
                    out.location = safeLocation(location, siteRoot);
                settle({ status: response.statusCode ?? 502, headers: out, body: new Uint8Array(Buffer.concat(chunks)) });
            });
            response.on('error', (error) => fail(new ProxyError(error.message)));
        });
        outbound.on('timeout', () => {
            outbound.destroy();
            fail(new ProxyError(`the runtime did not answer within ${limits.requestTimeoutSeconds}s`));
        });
        outbound.on('error', (error) => fail(new ProxyError(error.message)));
        if (body.length > 0)
            outbound.write(body);
        outbound.end();
    });
}
