import { request as httpRequest, type IncomingMessage } from 'node:http';
import type { PluginHttpRequest } from 'elowen/plugin-api';
import type { SitesHttpResponse } from './coreSeams.js';
import type { Endpoint } from './runtime.js';

/** Request headers a dedicated-origin runtime may see.
 *
 *  The app's authority is a `__Host-` cookie on the exact app hostname, so it never reaches a site
 *  subdomain. Site-local cookies and Authorization are legitimate application inputs and may pass. Host
 *  and every `x-elowen-*` header still come only from this gateway: the runtime cannot forge the verified
 *  viewer identity or convince itself it was reached through another address. */
const FORWARDED_REQUEST_HEADERS = new Set([
  'accept', 'accept-language', 'content-type', 'authorization', 'cookie', 'origin',
  'access-control-request-method', 'access-control-request-headers',
  'user-agent', 'referer', 'if-none-match', 'if-modified-since',
]);

/** Response headers the runtime is allowed to decide. A site owns its dedicated origin, so its own
 * session cookies and CORS policy are application behavior rather than authority over Elowen. The app's
 * `__Host-` cookies cannot be set from here, even with a parent Domain attribute. Hop-by-hop and proxy
 * security headers remain host-owned and never enter this allow-list. */
const FORWARDED_RESPONSE_HEADERS = new Set([
  'content-type', 'content-language', 'etag', 'last-modified', 'content-disposition', 'set-cookie',
  'access-control-allow-origin', 'access-control-allow-credentials',
  'access-control-allow-methods', 'access-control-allow-headers', 'access-control-expose-headers',
]);

export interface ProxyLimits {
  maxResponseBytes: number;
  requestTimeoutSeconds: number;
}

export interface ProxyViewer {
  userId: number | null;
  name: string | null;
}

/** Keep a redirect inside the site.
 *
 *  A runtime naming any absolute URL would be able to bounce a visitor who trusted this address off to
 *  somewhere else entirely. A relative target is kept as-is; an absolute one is kept only when it
 *  points back at the same site root; anything else collapses to the site root. */
function safeLocation(value: string, siteRoot: string): string {
  const trimmed = value.trim();
  if (trimmed === '') return siteRoot;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) || trimmed.startsWith('//')) {
    return trimmed.startsWith(siteRoot) ? trimmed : siteRoot;
  }
  if (trimmed.startsWith('/')) {
    try {
      return new URL(trimmed, siteRoot).toString().startsWith(siteRoot)
        ? new URL(trimmed, siteRoot).toString()
        : siteRoot;
    } catch {
      return siteRoot;
    }
  }
  return trimmed;
}

function hostOnlyCookie(value: string): string {
  return value.split(';').filter((part) => !/^\s*domain\s*=/i.test(part)).join(';');
}

export function runtimeResponseHeaders(
  headers: Record<string, string | string[] | undefined>,
  siteRoot: string,
): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!FORWARDED_RESPONSE_HEADERS.has(name.toLowerCase()) || value === undefined) continue;
    const lower = name.toLowerCase();
    if (lower === 'set-cookie') {
      const cookies = (Array.isArray(value) ? value : [value]).map((cookie) => hostOnlyCookie(String(cookie)));
      if (cookies.length > 0) out[lower] = cookies;
      continue;
    }
    out[lower] = Array.isArray(value) ? value.join(', ') : String(value);
  }
  const location = headers.location;
  if (typeof location === 'string') out.location = safeLocation(location, siteRoot);
  return out;
}

export class ProxyError extends Error {}

/** Forward one request to a site's runtime and buffer the answer.
 *
 *  Buffered because the hook transport is: it has no streaming and no SSE, so a runtime that wants to
 *  stream cannot, and saying that plainly is better than truncating something halfway. */
export async function proxyToRuntime(
  endpoint: Endpoint,
  req: PluginHttpRequest,
  path: string,
  viewer: ProxyViewer,
  limits: ProxyLimits,
  siteRoot: string,
): Promise<SitesHttpResponse> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (FORWARDED_REQUEST_HEADERS.has(name)) headers[name] = value;
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
    if (viewer.name) headers['x-elowen-user-name'] = encodeURIComponent(viewer.name);
  }

  const query = new URLSearchParams(req.query).toString();
  const target = `/${path}${query ? `?${query}` : ''}`;
  const body = await req.body();
  // Recomputed, never forwarded: a client-supplied length that disagrees with the bytes actually sent
  // is how a request gets split into two on the far side.
  if (body.length > 0) headers['content-length'] = String(body.length);

  return new Promise<SitesHttpResponse>((resolve, reject) => {
    // An idle timeout alone lets a runtime trickle bytes forever. This is the absolute deadline for the
    // whole exchange.
    const deadline = setTimeout(() => {
      outbound.destroy();
      reject(new ProxyError(`the runtime did not finish within ${limits.requestTimeoutSeconds}s`));
    }, limits.requestTimeoutSeconds * 1000);
    deadline.unref?.();
    const done = <T>(fn: (value: T) => void) => (value: T): void => { clearTimeout(deadline); fn(value); };
    const settle = done(resolve);
    const fail = done(reject);

    const outbound = httpRequest(
      {
        ...(endpoint.kind === 'socket'
          ? { socketPath: endpoint.path }
          : { host: '127.0.0.1', port: endpoint.port }),
        method: req.method,
        path: target,
        headers,
        timeout: limits.requestTimeoutSeconds * 1000,
      },
      (response: IncomingMessage) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let aborted = false;
        response.on('data', (chunk: Buffer) => {
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
          if (aborted) return;
          const out = runtimeResponseHeaders(response.headers as Record<string, string | string[] | undefined>, siteRoot);
          settle({ status: response.statusCode ?? 502, headers: out, body: new Uint8Array(Buffer.concat(chunks)) });
        });
        response.on('error', (error) => fail(new ProxyError(error.message)));
      },
    );

    outbound.on('timeout', () => {
      outbound.destroy();
      fail(new ProxyError(`the runtime did not answer within ${limits.requestTimeoutSeconds}s`));
    });
    outbound.on('error', (error) => fail(new ProxyError(error.message)));
    if (body.length > 0) outbound.write(body);
    outbound.end();
  });
}
