/** The chatbot's own avatar, fetched for a visitor's widget.
 *
 *  Why this exists at all: the panel's avatar is an address the OWNER typed into a settings field, and a
 *  customer's Content-Security-Policy has no reason to allow that host. `img-src` is the customer's decision
 *  and asking them to widen it for an arbitrary image address is not something a widget may do. What their
 *  page already allows is the widget's own origin on `connect-src`, so the image travels over the connection
 *  the widget already owns and the panel renders it from memory.
 *
 *  That makes this route fetch a URL an ACCOUNT chose, which is a server-side request forgery surface, and
 *  the two halves of the defence are deliberately in different places:
 *
 *  - the ADDRESS is the host's. `ctx.host.publicHttp()` resolves the name, refuses an answer that is not a
 *    public unicast address, and pins the address it validated into the socket while keeping the URL host
 *    for TLS — so a name pointing at something internal is refused, and a name that answers differently
 *    between the check and the connection never gets connected to. That is a property of the process, not of
 *    this plugin, and it is not restated here.
 *  - the REQUEST is this plugin's, below: `https:` only, no redirect followed, no header or credential of any
 *    kind sent, a bounded wait, and a body whose size and media type are READ rather than believed. */

/** The one method this module needs of the host's transport (`PluginPublicHttp` in the published plugin
 *  API). Narrowed to what is called, the way every other host seam this plugin consumes is narrowed, so the
 *  fetch can be driven by a fixture without standing up a socket. */
export interface AvatarUpstream {
  request(url: string, options?: { signal?: AbortSignal }): Promise<AvatarUpstreamResponse>;
}

export interface AvatarUpstreamResponse {
  status: number;
  headers: Record<string, string>;
  body: AsyncIterable<Uint8Array>;
  /** Release the socket. Called on every path, including one where the body was cut short. */
  cancel(reason?: Error): void;
}

/** How long the deployment may spend on the owner's image host. An avatar is chrome: a panel that is
 *  waiting for one is a panel a visitor cannot use, and the answer after this is "no avatar". */
const AVATAR_FETCH_TIMEOUT_MS = 4_000;

/** The most an avatar may weigh. The measured live case was a 32 kB icon; this is sixteen times that, and
 *  the visitor's phone pays for every byte of it. */
export const AVATAR_MAX_BYTES = 512 * 1024;

/** How long a browser may keep the bytes. Short, because the owner can change the image at any time and the
 *  widget asks once per page load; `private`, because the answer is gated by a visitor's own token and an
 *  intermediary has no business holding it for another visitor of another chatbot. */
export const AVATAR_CACHE_CONTROL = 'private, max-age=300';

/** One media type and nothing else. The upstream's `content-type` is echoed into our own answer, so it is
 *  read as a value rather than forwarded: parameters are dropped the way every other reader of a
 *  `content-type` in this plugin drops them, and a value that is not a plain media type is refused. */
const IMAGE_MEDIA_TYPE = /^image\/[a-z0-9][a-z0-9.+-]{0,63}$/;

/** Why this route has no avatar to serve. Each one is a stable fact for the operator's log; the visitor is
 *  told none of it, because a panel with no avatar is the same panel however it got there. */
type AvatarRefusal =
  /** The deployment exposes no outbound transport for plugins. */
  | 'no_transport'
  /** Not `https:`, or not a URL at all. */
  | 'insecure_source'
  /** The transport threw: a refused connection, a name that did not resolve, or the wait ran out. */
  | 'unreachable'
  /** A non-2xx answer, a redirect included — a redirect is never followed. */
  | 'upstream_refused'
  /** No usable image media type, or an empty body. */
  | 'not_an_image'
  /** More bytes than a panel avatar may cost. */
  | 'too_large';

export type AvatarFetch =
  | { ok: true; contentType: string; bytes: Uint8Array }
  | { ok: false; reason: AvatarRefusal };

export interface AvatarLimits {
  timeoutMs: number;
  maxBytes: number;
}

const AVATAR_LIMITS: AvatarLimits = { timeoutMs: AVATAR_FETCH_TIMEOUT_MS, maxBytes: AVATAR_MAX_BYTES };

/** Fetch one avatar through the host's validated transport. */
export async function fetchAvatarBytes(
  source: string,
  upstream: AvatarUpstream,
  limits: AvatarLimits = AVATAR_LIMITS,
): Promise<AvatarFetch> {
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    return { ok: false, reason: 'insecure_source' };
  }
  // Refused BEFORE anything connects. The appearance contract accepts plain http so a local test page can
  // name one, and the owner's own browser may well be able to load it; a public visitor's widget is not
  // helped by it, and an avatar is not worth an answer nobody can vouch for.
  if (url.protocol !== 'https:') return { ok: false, reason: 'insecure_source' };

  let response: AvatarUpstreamResponse;
  try {
    // No headers of any kind. Nothing here sends a cookie, an authorization, a referer or a user agent, and
    // the transport drops a `host` a caller could have supplied, so the request carries nothing about this
    // deployment, this chatbot or this visitor.
    response = await upstream.request(url.toString(), { signal: AbortSignal.timeout(limits.timeoutMs) });
  } catch {
    return { ok: false, reason: 'unreachable' };
  }

  try {
    // A redirect is never followed. The address that was validated is the only one this route may reach, so
    // an answer that points somewhere else is a refusal rather than a second connection to a name nobody
    // checked.
    if (response.status < 200 || response.status >= 300) return { ok: false, reason: 'upstream_refused' };
    const contentType = imageMediaType(response.headers['content-type']);
    if (contentType === null) return { ok: false, reason: 'not_an_image' };
    const bytes = await readBounded(response.body, limits.maxBytes);
    if (bytes === null) return { ok: false, reason: 'too_large' };
    if (bytes.byteLength === 0) return { ok: false, reason: 'not_an_image' };
    return { ok: true, contentType, bytes };
  } catch {
    // A body that fails mid-read is an answer this route does not have: the panel keeps its own look.
    return { ok: false, reason: 'unreachable' };
  } finally {
    // Whatever happened above, the socket is released here — a body that was refused, cut short or read to
    // its end has no reader left.
    response.cancel();
  }
}

/** The route's whole dependency on the host: the transport, resolved per call. A deployment that exposes
 *  none is a refusal rather than a crash, because an avatar is chrome and a visitor's panel must not depend
 *  on it. */
export function createAvatarFetcher(
  transport: () => AvatarUpstream,
  limits: AvatarLimits = AVATAR_LIMITS,
): (source: string) => Promise<AvatarFetch> {
  return async (source) => {
    let upstream: AvatarUpstream;
    try {
      upstream = transport();
    } catch {
      return { ok: false, reason: 'no_transport' };
    }
    return fetchAvatarBytes(source, upstream, limits);
  };
}

/** The media type of an answer, or null when it is not one an `<img>` may be given. */
function imageMediaType(header: string | undefined): string | null {
  const declared = (header ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  return IMAGE_MEDIA_TYPE.test(declared) ? declared : null;
}

/** Read the body while counting it, and stop the moment it passes the ceiling.
 *
 *  Deliberately not a `content-length` check: that header is a claim by the host being fetched, and this
 *  route exists precisely because that host is whatever an account typed into a settings field. What
 *  arrives is what is measured. */
async function readBounded(body: AsyncIterable<Uint8Array>, maxBytes: number): Promise<Uint8Array | null> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of body) {
    total += chunk.byteLength;
    if (total > maxBytes) return null;
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
