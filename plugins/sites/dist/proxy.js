import { request as httpRequest } from 'node:http';
const HOP_BY_HOP_HEADERS = new Set([
    'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer',
    'transfer-encoding', 'upgrade',
]);
const HOST_OWNED_RESPONSE_HEADERS = new Set([
    ...HOP_BY_HOP_HEADERS, 'cache-control', 'x-robots-tag',
]);
function hostOnlyCookie(value) {
    return value.split(';').filter((part) => !/^\s*domain\s*=/i.test(part)).join(';');
}
function withoutCookie(header, blockedName) {
    return header.split(';').filter((part) => {
        const separator = part.indexOf('=');
        return separator <= 0 || part.slice(0, separator).trim() !== blockedName;
    }).map((part) => part.trim()).filter(Boolean).join('; ');
}
function projectResponseHeaders(headers) {
    const out = {};
    for (const [name, value] of Object.entries(headers)) {
        const lower = name.toLowerCase();
        if (value === undefined || HOST_OWNED_RESPONSE_HEADERS.has(lower) || lower.startsWith('x-elowen-'))
            continue;
        if (lower === 'set-cookie') {
            out[lower] = (Array.isArray(value) ? value : [value]).map((cookie) => hostOnlyCookie(String(cookie)));
        }
        else {
            out[lower] = Array.isArray(value) ? value.join(', ') : String(value);
        }
    }
    return out;
}
export class ProxyError extends Error {
}
/** Forward a request to an application already running inside the managed Project environment. */
export async function proxyToProject(endpoint, req, path, viewer, limits, siteRoot, blockedCookieName) {
    const headers = {};
    for (const [name, value] of Object.entries(req.headers)) {
        const lower = name.toLowerCase();
        const hostOwned = lower === 'host' || lower === 'content-length' || lower === 'forwarded'
            || lower.startsWith('x-forwarded-') || lower.startsWith('x-elowen-');
        if (HOP_BY_HOP_HEADERS.has(lower) || hostOwned)
            continue;
        if (lower === 'cookie' && blockedCookieName) {
            const filtered = withoutCookie(value, blockedCookieName);
            if (filtered)
                headers[lower] = filtered;
        }
        else {
            headers[lower] = value;
        }
    }
    const host = req.headers.host ?? new URL(siteRoot).host;
    headers.host = host;
    headers['x-forwarded-host'] = host;
    headers['x-forwarded-proto'] = new URL(siteRoot).protocol.replace(':', '');
    const peer = req.remoteAddress
        ?? req.ip;
    if (peer)
        headers['x-forwarded-for'] = peer;
    headers['accept-encoding'] = 'identity';
    if (viewer.userId !== null) {
        headers['x-elowen-user-id'] = String(viewer.userId);
        if (viewer.name)
            headers['x-elowen-user-name'] = encodeURIComponent(viewer.name);
    }
    const query = new URLSearchParams(req.query).toString();
    const target = `/${path}${query ? `?${query}` : ''}`;
    const body = await req.body();
    if (body.length > 0)
        headers['content-length'] = String(body.length);
    return new Promise((resolve, reject) => {
        const deadline = setTimeout(() => {
            outbound.destroy();
            reject(new ProxyError(`the Project application did not finish within ${limits.requestTimeoutSeconds}s`));
        }, limits.requestTimeoutSeconds * 1000);
        deadline.unref?.();
        const done = (fn) => (value) => { clearTimeout(deadline); fn(value); };
        const settle = done(resolve);
        const fail = done(reject);
        const outbound = httpRequest({
            socketPath: endpoint.path,
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
                    fail(new ProxyError('the Project application answered with more data than the response limit'));
                    return;
                }
                chunks.push(chunk);
            });
            response.on('end', () => {
                if (aborted)
                    return;
                settle({
                    status: response.statusCode ?? 502,
                    headers: projectResponseHeaders(response.headers),
                    body: new Uint8Array(Buffer.concat(chunks)),
                });
            });
            response.on('error', (error) => fail(new ProxyError(error.message)));
        });
        outbound.on('timeout', () => {
            outbound.destroy();
            fail(new ProxyError(`the Project application did not answer within ${limits.requestTimeoutSeconds}s`));
        });
        outbound.on('error', (error) => fail(new ProxyError(error.message)));
        if (body.length > 0)
            outbound.write(body);
        outbound.end();
    });
}
