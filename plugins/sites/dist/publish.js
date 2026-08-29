import { closeSync, constants, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readdirSync, readSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
/** Everything a published release may contain. An extension outside this list is refused at publish
 *  rather than served with a guessed type: the serving path must never have to decide what an unknown
 *  file is while a browser is waiting for the answer. */
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
/** Directories never worth publishing, skipped silently so an agent pointing at a project folder does
 *  not accidentally publish its dependencies or its git history. */
const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules', '.next', '.cache', '.DS_Store']);
const MAX_FILES = 5000;
/** An application tree carries its dependencies, and a modest one runs to tens of thousands of files. */
const MAX_FILES_COMMAND = 60_000;
export class PublishError extends Error {
}
/** Size of a directory entry without following it, or null when it vanished mid-walk. */
function statOf(path) {
    try {
        const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
            return { size: fstatSync(fd).size };
        }
        finally {
            closeSync(fd);
        }
    }
    catch {
        return null;
    }
}
/** Copy a built output directory into an immutable release.
 *
 *  The copier runs with the daemon's own filesystem reach, which is wider than the account's, so
 *  containment is proved on RESOLVED paths and anything that is not a plain file or directory is
 *  refused. A symlink inside the source is exactly how a publish would otherwise be talked into copying
 *  a file the publisher was never allowed to read. */
export function snapshotRelease(sourceRoot, releaseDir, limits) {
    const realSource = realpathSync(sourceRoot);
    const command = limits.mode === 'command' || limits.mode === 'php';
    const warnings = [];
    let fileCount = 0;
    let sizeBytes = 0;
    mkdirSync(releaseDir, { recursive: true });
    const walk = (dir, target) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const from = join(dir, entry.name);
            const to = join(target, entry.name);
            if (entry.isSymbolicLink()) {
                warnings.push(`skipped symlink ${relative(realSource, from) || entry.name}`);
                continue;
            }
            if (entry.isDirectory()) {
                // A command release keeps its dependencies: without node_modules the server it publishes
                // cannot start, and the release exists precisely so the site survives losing its workspace.
                if (command ? entry.name === '.git' : SKIPPED_DIRECTORIES.has(entry.name))
                    continue;
                mkdirSync(to, { recursive: true });
                walk(from, to);
                continue;
            }
            if (!entry.isFile()) {
                warnings.push(`skipped ${relative(realSource, from) || entry.name} (not a regular file)`);
                continue;
            }
            const rel = relative(realSource, from);
            const ext = extensionOf(entry.name);
            if (!command && !(ext in CONTENT_TYPES)) {
                warnings.push(`skipped ${rel} (.${ext || 'no extension'} is not a publishable file type)`);
                continue;
            }
            const stat = statOf(from);
            if (!stat) {
                warnings.push(`skipped ${rel} (it disappeared while publishing)`);
                continue;
            }
            if (stat.size > limits.maxAssetBytes) {
                throw new PublishError(`${rel} is ${Math.ceil(stat.size / 1048576)} MB, above the per-file limit. Reduce it or raise "Largest file" in the plugin settings.`);
            }
            if (sizeBytes + stat.size > limits.maxTotalBytes) {
                throw new PublishError(`the build output is larger than the per-site limit. Reduce it or raise "Largest site" in the plugin settings.`);
            }
            const fileCeiling = command ? MAX_FILES_COMMAND : MAX_FILES;
            if (fileCount >= fileCeiling) {
                throw new PublishError(`the output has more than ${fileCeiling} files.`);
            }
            // Opened with O_NOFOLLOW and copied from the descriptor: checking the directory entry and then
            // copying by path leaves a window in which the entry can be swapped for a symlink, and this
            // copier runs with the daemon's reach rather than the account's.
            let fd;
            try {
                fd = openSync(from, constants.O_RDONLY | constants.O_NOFOLLOW);
            }
            catch {
                warnings.push(`skipped ${rel} (it changed while publishing)`);
                continue;
            }
            try {
                const opened = fstatSync(fd);
                if (!opened.isFile()) {
                    warnings.push(`skipped ${rel} (it changed while publishing)`);
                    continue;
                }
                const buffer = Buffer.allocUnsafe(opened.size);
                let read = 0;
                while (read < opened.size) {
                    const chunk = readSync(fd, buffer, read, opened.size - read, read);
                    if (chunk === 0)
                        break;
                    read += chunk;
                }
                writeFileSync(to, buffer.subarray(0, read));
                fileCount += 1;
                sizeBytes += read;
            }
            finally {
                closeSync(fd);
            }
        }
    };
    walk(realSource, releaseDir);
    if (fileCount === 0)
        throw new PublishError('the build output contains no publishable files.');
    if (!command && !existsSync(join(releaseDir, 'index.html'))) {
        warnings.push('there is no index.html at the top of the output, so the site root will not render.');
    }
    return { fileCount, sizeBytes, warnings };
}
/** Warn when the built HTML asks for its assets relatively.
 *
 *  A relative reference resolves against the address the visitor actually opened, not against the page
 *  that served them. At the root that happens to work; on any deeper address — a nested page, or an SPA
 *  route answered by the same index.html — `./assets/app.js` becomes `/deep/assets/app.js` and 404s.
 *  This warns; it never edits the agent's output, because a publisher that silently rewrites what it
 *  was given cannot be trusted with the rest. */
export function relativeAssetWarning(releaseDir, basePath) {
    const indexFile = join(releaseDir, 'index.html');
    if (!existsSync(indexFile))
        return null;
    const html = readFileSync(indexFile, 'utf8');
    if (!/(?:src|href)\s*=\s*["']\.{1,2}\//.test(html))
        return null;
    return `index.html references assets relatively (./…). Build with the absolute base path ${basePath} so they resolve from every route, not only the root.`;
}
/** Remove releases beyond the retention count. The release the site currently serves is never a
 *  candidate, whatever the retention is set to. */
export function pruneReleases(store, siteId, siteDir, keep, currentReleaseId) {
    const releases = store.releases(siteId);
    const removable = releases.filter((release) => release.id !== currentReleaseId);
    const excess = removable.slice(Math.max(0, keep - (currentReleaseId ? 1 : 0)));
    for (const release of excess) {
        rmSync(join(siteDir, 'releases', release.id), { recursive: true, force: true });
        store.deleteRelease(siteId, release.id);
    }
}
/** Resolve a request path inside a release directory, or null when it escapes.
 *
 *  Containment is decided on the resolved path so neither a traversal segment nor a symlink that arrived
 *  after the snapshot can widen the answer. */
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
