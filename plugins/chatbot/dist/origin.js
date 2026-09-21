/** Two different things are called "origin" on the public path, and conflating them is how a public
 *  endpoint ends up authorising the wrong caller:
 *
 *  - the browser's `Origin` header (here: the ALLOWLIST check below) says which WEBSITE asked. It is the
 *    customer's domain, it is chosen by the plugin's administrator, and a visitor token issued for one
 *    domain is worthless on another.
 *  - the host's canonical request origin (`ClientOrigin`, read by `readRequestOrigin`) says where the
 *    REQUEST came from on the network and whether the deployment's proxy trust makes that value
 *    canonical. It is the rate-limit and audit key, and it is never authentication.
 *
 *  Both must hold before a stateful request is admitted, and neither may be re-derived inside the plugin:
 *  the core resolves the network origin once, in its own clientIp module. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
export class OriginError extends Error {
}
/** Reduce a configured domain to `scheme://host[:port]`, the only form an allowlist entry may take.
 *  Credentials, a path, a query and a fragment are refused rather than stripped: a value that means
 *  something else than the administrator typed is a mistake they need to see, not a silent rewrite. */
export function normalizeOrigin(raw) {
    const value = raw.trim();
    if (value === '')
        throw new OriginError('empty');
    let url;
    try {
        url = new URL(value);
    }
    catch {
        throw new OriginError('unparsable');
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:')
        throw new OriginError('unsupported_scheme');
    if (url.username !== '' || url.password !== '')
        throw new OriginError('credentials_not_allowed');
    if (url.pathname !== '/' || url.search !== '' || url.hash !== '')
        throw new OriginError('path_not_allowed');
    if (url.host === '')
        throw new OriginError('host_required');
    return `${url.protocol}//${url.host}`;
}
/** A wildcard would let any website a token holder's browser reaches spend this chatbot's account, so a
 *  wildcard is not an accepted allowlist entry. */
export function isWildcardOrigin(origin) {
    return origin.includes('*');
}
function isLoopbackOrigin(origin) {
    try {
        return LOOPBACK_HOSTS.has(new URL(origin).hostname);
    }
    catch {
        return false;
    }
}
/** Whether an allowlist entry may be used by an ENABLED chatbot. Production traffic is https; plain
 *  http is accepted only for a loopback host, which is what a local test page needs and what no public
 *  site can be. */
export function isUsableOrigin(origin) {
    try {
        const url = new URL(origin);
        if (url.protocol === 'https:')
            return true;
        return url.protocol === 'http:' && isLoopbackOrigin(origin);
    }
    catch {
        return false;
    }
}
/** Match the request's `Origin` header against the chatbot's allowlist, exactly and case-sensitively as
 *  browsers send it. A missing header is a refusal: a request that cannot say which site it came from is
 *  not a browser request this endpoint serves. */
export function checkAllowedOrigin(headerOrigin, allowed) {
    if (typeof headerOrigin !== 'string')
        return { ok: false, reason: 'origin_not_allowed' };
    const requested = headerOrigin.trim();
    if (requested === '')
        return { ok: false, reason: 'origin_not_allowed' };
    return allowed.includes(requested) ? { ok: true, origin: requested } : { ok: false, reason: 'origin_not_allowed' };
}
/** The response headers an allowed cross-origin call needs. The daemon's global permissive CORS is NOT
 *  the authorization here: this endpoint decides by the `Origin` header and the visitor token, and a
 *  caller outside the allowlist is refused before any of these headers is produced.
 *
 *  Both methods the widget uses are granted. A preflight is a question about a method, and a grant that named
 *  only `POST` would have the browser refuse the widget's own conversation read and its event stream before
 *  this plugin ever saw them. */
export function corsHeaders(origin) {
    return {
        'access-control-allow-origin': origin,
        'access-control-allow-headers': 'authorization, content-type',
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-max-age': '600',
        vary: 'Origin',
    };
}
/** Read the host-resolved network origin off a hook request, validating its runtime shape. The field is
 *  absent on a daemon older than the seam, and a missing or malformed value must never be treated as
 *  "trusted": it is refused exactly like an untrusted one. */
export function readRequestOrigin(req) {
    const origin = req.origin;
    if (typeof origin !== 'object' || origin === null)
        return null;
    const candidate = origin;
    if (typeof candidate.value !== 'string' || candidate.value === '')
        return null;
    if (candidate.kind !== 'ip' && candidate.kind !== 'local' && candidate.kind !== 'internal' && candidate.kind !== 'platform')
        return null;
    if (typeof candidate.trusted !== 'boolean')
        return null;
    return { value: candidate.value, kind: candidate.kind, trusted: candidate.trusted };
}
/** The admission rule for every stateful endpoint: the host must have resolved a NETWORK origin it
 *  considers canonical. `local` is refused because a public hook reached from loopback is not what this
 *  endpoint serves, and an untrusted value means the deployment cannot vouch for the address at all —
 *  admitting it anyway would make every per-address limit a number the client chooses. */
export function isTrustedRequestOrigin(origin) {
    return origin !== null && origin.trusted && origin.kind === 'ip';
}
