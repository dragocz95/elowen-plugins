const MAX_FAVICON_BYTES = 24 * 1024;
const HOST_TIMEOUT_MS = 5_000;
const MAX_CANDIDATES = 4;
const READ_CHUNK = 8 * 1024;
/** Enough reads to cover the byte budget, and no more. A stream that keeps answering without ever
 *  setting `eof` would otherwise spin forever: the host timeout below abandons the WAIT, not the loop. */
const MAX_READS = Math.ceil(MAX_FAVICON_BYTES / READ_CHUNK) + 2;
/**
 * Collect candidate icon URLs from the managed page.
 *
 * The page world is used for reading hrefs and nothing else. Fetching the bytes here — which is what
 * this did originally — fails on every site that serves its icons from another origin without CORS:
 * seznam.cz points at `d32-a.sdn.cz`, so `fetch` in the page correctly rejected with `TypeError: Failed
 * to fetch` and the session simply never had a favicon. The bytes are therefore fetched over CDP below,
 * which is not subject to the page's CORS policy but still travels the account's own Chrome and its
 * enforcing proxy.
 */
const CANDIDATES_EXPRESSION = `
(() => {
  const links = Array.from(document.querySelectorAll('link[rel]'))
    .filter((link) => String(link.rel || '').toLowerCase().split(/\\s+/).includes('icon'))
    .map((link) => link.href)
    .filter(Boolean)
    .slice(0, 3);
  let fallback = '';
  try { fallback = new URL('/favicon.ico', location.href).href; } catch {}
  return Array.from(new Set([...links, fallback])).filter(Boolean).slice(0, ${MAX_CANDIDATES});
})()`;
/** Only http(s) candidates are followed. A page can put anything in `link[rel=icon]`, and neither a
 *  `file:` nor a `data:` URL should be handed to the loader as if the page had earned it. */
function usableCandidate(value) {
    if (typeof value !== 'string' || !value)
        return null;
    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
    }
    catch {
        return null;
    }
}
function imageMime(headers) {
    for (const [name, value] of Object.entries(headers ?? {})) {
        if (name.toLowerCase() !== 'content-type')
            continue;
        const mime = String(value).split(';')[0]?.trim().toLowerCase() ?? '';
        return mime.startsWith('image/') ? mime : null;
    }
    return null;
}
/** Drain one CDP IO stream into base64, refusing anything over the byte budget rather than truncating
 *  it: half an icon is not a smaller icon, it is a corrupt one. The handle is always closed. */
async function readStream(cdp, handle) {
    const chunks = [];
    let total = 0;
    try {
        let complete = false;
        for (let read = 0; read < MAX_READS && !complete; read += 1) {
            const chunk = await cdp.send('IO.read', {
                handle, size: READ_CHUNK,
            });
            if (typeof chunk.data === 'string' && chunk.data) {
                const buffer = Buffer.from(chunk.data, chunk.base64Encoded ? 'base64' : 'utf8');
                total += buffer.byteLength;
                if (total > MAX_FAVICON_BYTES)
                    return null;
                chunks.push(buffer);
            }
            complete = chunk.eof === true;
        }
        if (!complete)
            return null;
    }
    finally {
        await cdp.send('IO.close', { handle }).catch(() => { });
    }
    return total > 0 ? Buffer.concat(chunks).toString('base64') : null;
}
async function loadIcon(cdp, frameId, url) {
    const response = await cdp.send('Network.loadNetworkResource', {
        frameId,
        url,
        options: { disableCache: true, includeCredentials: false },
    });
    const resource = response.resource;
    if (!resource?.success || !resource.stream)
        return null;
    if (resource.httpStatusCode !== undefined && (resource.httpStatusCode < 200 || resource.httpStatusCode > 299)) {
        await cdp.send('IO.close', { handle: resource.stream }).catch(() => { });
        return null;
    }
    const mime = imageMime(resource.headers);
    if (!mime) {
        await cdp.send('IO.close', { handle: resource.stream }).catch(() => { });
        return null;
    }
    const base64 = await readStream(cdp, resource.stream);
    return base64 ? `data:${mime};base64,${base64}` : null;
}
async function readInIsolatedWorld(cdp) {
    const tree = await cdp.send('Page.getFrameTree');
    const frameId = tree.frameTree?.frame?.id;
    if (!frameId)
        return null;
    const world = await cdp.send('Page.createIsolatedWorld', {
        frameId,
        worldName: 'elowen-browser-favicon',
        grantUniveralAccess: false,
    });
    if (!Number.isSafeInteger(world.executionContextId))
        return null;
    const response = await cdp.send('Runtime.evaluate', {
        expression: CANDIDATES_EXPRESSION,
        contextId: world.executionContextId,
        returnByValue: true,
    });
    const raw = response.result?.value;
    const candidates = (Array.isArray(raw) ? raw : []).map(usableCandidate).filter((url) => !!url);
    for (const url of candidates.slice(0, MAX_CANDIDATES)) {
        const icon = await loadIcon(cdp, frameId, url).catch(() => null);
        if (icon)
            return icon;
    }
    return null;
}
export async function readPageFavicon(cdp) {
    let timer = null;
    try {
        return await Promise.race([
            readInIsolatedWorld(cdp).catch(() => null),
            new Promise((resolve) => {
                timer = setTimeout(() => resolve(null), HOST_TIMEOUT_MS);
                timer.unref?.();
            }),
        ]);
    }
    finally {
        if (timer)
            clearTimeout(timer);
    }
}
