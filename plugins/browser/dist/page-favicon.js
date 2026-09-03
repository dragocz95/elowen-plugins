const MAX_FAVICON_BYTES = 24 * 1024;
const MAX_DATA_URL_CHARS = 40 * 1024;
const HOST_TIMEOUT_MS = 3_000;
/**
 * Read one small favicon through the managed page itself. The fetch therefore follows the browser's
 * enforcing proxy and account profile; the main Elowen page never contacts the visited site directly.
 * An isolated world keeps page code from replacing fetch/timers, while the host timeout keeps a broken
 * renderer or CDP transport from holding the session queue.
 */
const FAVICON_EXPRESSION = `
(async () => {
  const links = Array.from(document.querySelectorAll('link[rel]'))
    .filter((link) => String(link.rel || '').toLowerCase().split(/\\s+/).includes('icon'))
    .map((link) => link.href)
    .filter(Boolean)
    .slice(0, 3);
  let fallback = '';
  try { fallback = new URL('/favicon.ico', location.href).href; } catch {}
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    for (const url of Array.from(new Set([...links, fallback])).filter(Boolean)) {
      try {
        const response = await fetch(url, { credentials: 'omit', cache: 'no-store', signal: controller.signal });
        if (!response.ok) continue;
        const blob = await response.blob();
        if (!blob.type.toLowerCase().startsWith('image/') || blob.size < 1 || blob.size > ${MAX_FAVICON_BYTES}) continue;
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = '';
        for (let offset = 0; offset < bytes.length; offset += 8192) {
          binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
        }
        return 'data:' + blob.type + ';base64,' + btoa(binary);
      } catch {}
    }
    return null;
  } finally { clearTimeout(timer); }
})()`;
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
        expression: FAVICON_EXPRESSION,
        contextId: world.executionContextId,
        awaitPromise: true,
        returnByValue: true,
    });
    const value = response.result?.value;
    if (typeof value !== 'string' || value.length > MAX_DATA_URL_CHARS)
        return null;
    return /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+$/i.test(value) ? value : null;
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
