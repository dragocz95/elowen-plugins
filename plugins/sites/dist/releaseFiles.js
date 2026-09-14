import { realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';
/** What a stored file release is served from.
 *
 *  A release is no longer a thing this plugin can create: a Site is an address for an application inside a
 *  managed Project, published through that Project's own transport. What remains here is the SERVING half
 *  of the retired file model, because rows published under it are still addressed and still have files on
 *  disk. Until an operator inventories and migrates those rows, this is what answers a visitor of one —
 *  and it is deliberately the whole of what is left: no copier, no retention, no advice about how to build
 *  output that nothing produces any more.
 *
 *  Nothing here decides access, and nothing here can widen what a release may contain: the extension table
 *  is a closed list, and an unknown type is never served with a guessed content type while a browser waits
 *  for the answer. */
/** The one type a missing or unknown extension must never be guessed as. */
export const HTML_TYPE = 'text/html; charset=utf-8';
export const CONTENT_TYPES = {
    html: HTML_TYPE,
    htm: 'text/html; charset=utf-8',
    css: 'text/css; charset=utf-8',
    js: 'text/javascript; charset=utf-8',
    mjs: 'text/javascript; charset=utf-8',
    json: 'application/json; charset=utf-8',
    map: 'application/json; charset=utf-8',
    txt: 'text/plain; charset=utf-8',
    md: 'text/plain; charset=utf-8',
    csv: 'text/csv; charset=utf-8',
    xml: 'application/xml; charset=utf-8',
    svg: 'image/svg+xml',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    avif: 'image/avif',
    ico: 'image/x-icon',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    otf: 'font/otf',
    eot: 'application/vnd.ms-fontobject',
    pdf: 'application/pdf',
    webmanifest: 'application/manifest+json',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mp3: 'audio/mpeg',
    ogg: 'audio/ogg',
    wav: 'audio/wav',
};
export const extensionOf = (name) => {
    const dot = name.lastIndexOf('.');
    return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
};
/** Resolve a request path inside a release directory, or null when it escapes.
 *
 *  Containment is decided on the resolved path, so neither a traversal segment nor a symlink that arrived
 *  after the release was written can widen the answer. */
export function resolveWithin(releaseDir, relPath) {
    if (relPath.includes('\0'))
        return null;
    const target = resolve(releaseDir, relPath);
    const root = resolve(releaseDir);
    if (target !== root && !target.startsWith(root + sep))
        return null;
    try {
        const realRoot = realpathSync(root);
        const realTarget = realpathSync(target);
        return realTarget === realRoot || realTarget.startsWith(realRoot + sep) ? realTarget : null;
    }
    catch {
        return null;
    }
}
