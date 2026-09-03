import type { CDPSessionLike } from './types.js';

const MAX_FAVICON_BYTES = 24 * 1024;
const MAX_DATA_URL_CHARS = 40 * 1024;

/**
 * Read one small favicon through the managed page itself. The fetch therefore follows the browser's
 * enforcing proxy and account profile; the main Elowen page never contacts the visited site directly.
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
        const response = await fetch(url, { credentials: 'include', cache: 'force-cache', signal: controller.signal });
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

export async function readPageFavicon(cdp: CDPSessionLike): Promise<string | null> {
  const response = await cdp.send<{ result?: { type?: string; value?: unknown } }>('Runtime.evaluate', {
    expression: FAVICON_EXPRESSION,
    awaitPromise: true,
    returnByValue: true,
  });
  const value = response.result?.value;
  if (typeof value !== 'string' || value.length > MAX_DATA_URL_CHARS) return null;
  return /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+$/i.test(value) ? value : null;
}
