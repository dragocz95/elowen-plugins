import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, realpath } from 'node:fs/promises';
import { dirname, join, matchesGlob, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
const run = promisify(execFile);
/** The trash a mirror moves remotely-deleted files into. Always ignored, or the next scan would upload the
 *  very file the person just deleted straight back into OneDrive under a new name. */
export const TRASH_DIR = '.elowen-trash';
/** Prefix of a half-written download. Ignored so that a crash between write and rename cannot leave a
 *  fragment the next scan uploads into OneDrive as if it were project content. */
export const PART_PREFIX = '.onedrive-part-';
/** Paths that are NEVER mirrored, whatever the settings say.
 *
 *  Mirroring a whole project is a deliberate choice, and this is the floor under it. Version-control
 *  internals and dependency trees are noise that would dominate every sync; the rest is the category whose
 *  accidental export cannot be undone once it has left the machine. It is not configurable on purpose —
 *  a setting that can turn off a credentials filter is a credentials leak with an extra step. */
export const IGNORE_FLOOR = [
    '.git', '.git/**', '**/.git', '**/.git/**',
    'node_modules/**', '**/node_modules/**',
    `${TRASH_DIR}/**`, `**/${TRASH_DIR}/**`,
    '.env', '.env.*', '**/.env', '**/.env.*',
    '**/*.pem', '**/*.key', '**/*.p12', '**/*.pfx', '**/*.keystore',
    '**/id_rsa', '**/id_rsa.*', '**/id_ed25519', '**/id_ed25519.*',
    '.ssh/**', '**/.ssh/**',
    '**/.npmrc', '**/.netrc', '**/.pgpass',
    // Credential stores that a project .gitignore very often does NOT cover, because they normally live in a
    // home directory - and a mirrored project root can be one.
    '.aws/**', '**/.aws/**', '.docker/config.json', '**/.docker/config.json',
    '.config/gcloud/**', '**/.config/gcloud/**', '**/.kube/config',
    '**/credentials.json', '**/service-account*.json', '**/*.jks',
    `${PART_PREFIX}*`, `**/${PART_PREFIX}*`,
];
export function isFloorIgnored(rel) {
    return IGNORE_FLOOR.some((pattern) => matchesGlob(rel, pattern));
}
/** Floor plus the instance's own extra patterns. The floor is checked first and separately so a malformed
 *  operator pattern can never widen what is allowed, only narrow it further. */
export function buildIgnore(extra) {
    const patterns = String(extra ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
    return (rel) => isFloorIgnored(rel) || patterns.some((pattern) => matchesGlob(rel, pattern));
}
/** OneDrive matches names case-insensitively and normalises Unicode; Linux does neither. Two local paths
 *  that differ only in case or in NFC/NFD spelling therefore address ONE remote item, and mirroring both
 *  makes them overwrite each other and then delete each other. This is the key those collisions share. */
export function remoteKey(rel) {
    return rel.normalize('NFC').toLowerCase();
}
/** The project's own view of which files matter: tracked files plus untracked ones its .gitignore keeps.
 *  This is exactly the definition of "the project without the ignored parts", it costs one process, and it
 *  needs no .gitignore parser of our own — which would be a second, subtly different answer to a question
 *  git already answers authoritatively. */
async function gitFiles(root) {
    try {
        const { stdout } = await run('git', ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], { maxBuffer: 64 * 1024 * 1024, timeout: 30_000, encoding: 'utf8' });
        return stdout.split('\0').filter(Boolean);
    }
    catch {
        return null;
    }
}
/** Fallback for a root that is not a repository: a bounded walk that never follows a directory symlink. */
async function walk(root, limit) {
    const out = [];
    const queue = [''];
    let complete = true;
    while (queue.length > 0) {
        if (out.length >= limit) {
            complete = false;
            break;
        }
        const dir = queue.shift();
        let entries;
        try {
            entries = await readdir(join(root, dir), { withFileTypes: true });
        }
        catch {
            // A directory we could not read is a directory whose contents are UNKNOWN. Carrying on quietly
            // would present its files as absent, and absent is what this mirror deletes.
            complete = false;
            continue;
        }
        for (const entry of entries) {
            const rel = dir ? `${dir}/${entry.name}` : entry.name;
            if (isFloorIgnored(rel))
                continue;
            if (entry.isDirectory())
                queue.push(rel);
            else if (entry.isFile() || entry.isSymbolicLink())
                out.push(rel);
            if (out.length >= limit) {
                complete = false;
                break;
            }
        }
    }
    return { files: out, complete };
}
/** Is `candidate` really inside `root` once every symlink has been resolved? A mirror walks paths supplied
 *  by whatever is on disk, so a symlink pointing out of the project is a way to make the daemon upload a
 *  file the project never contained. Containment is checked on the RESOLVED path, by path component, not by
 *  string prefix — `/srv/project-secrets` starts with `/srv/project` as a string. */
export async function containedIn(root, candidate) {
    try {
        const realRoot = await realpath(root);
        const real = await realpath(candidate);
        if (real === realRoot)
            return true;
        const rel = relative(realRoot, real);
        return rel !== '' && !rel.startsWith('..') && !rel.startsWith(`..${sep}`) && !resolve(realRoot, rel).startsWith('..');
    }
    catch {
        return false;
    }
}
/** Containment for a path that does not exist yet - a file about to be downloaded into a directory the
 *  project has not created. `realpath` fails on a missing path, so the check climbs to the nearest
 *  ancestor that DOES exist and resolves that. A symlinked ancestor is therefore still caught, while a
 *  genuinely new nested directory is allowed instead of being silently skipped forever. */
export async function containedInEventually(root, absolute) {
    let current = dirname(absolute);
    const stop = resolve(root);
    for (;;) {
        try {
            await realpath(current);
            return containedIn(root, current);
        }
        catch {
            const parent = dirname(current);
            // Ran out of ancestors without meeting anything real: the root itself is gone.
            if (parent === current || current.length < stop.length)
                return false;
            current = parent;
        }
    }
}
export async function scanLocal(root, options) {
    const listed = await gitFiles(root);
    const fromGit = listed !== null;
    const fallback = listed === null ? await walk(root, options.maxFiles) : null;
    const candidates = listed ?? fallback.files;
    const files = new Map();
    const skipped = [];
    let complete = fallback ? fallback.complete : true;
    if (fromGit && candidates.length >= options.maxFiles)
        complete = false;
    // Names that collide once OneDrive's case-insensitive, Unicode-normalising rules are applied cannot
    // both be mirrored: they are one item over there. Skipping the whole group leaves every local copy
    // intact, where mirroring them would let the last writer win and the others be trashed.
    const byRemoteKey = new Map();
    for (const rel of candidates) {
        const key = remoteKey(rel);
        const bucket = byRemoteKey.get(key);
        if (bucket)
            bucket.push(rel);
        else
            byRemoteKey.set(key, [rel]);
    }
    const colliding = new Set();
    for (const bucket of byRemoteKey.values()) {
        if (bucket.length > 1)
            for (const rel of bucket)
                colliding.add(rel);
    }
    for (const rel of candidates) {
        if (options.ignored(rel))
            continue;
        if (colliding.has(rel)) {
            skipped.push({ rel, reason: 'collision' });
            continue;
        }
        const absolute = join(root, rel);
        let stats;
        try {
            stats = await lstat(absolute);
        }
        catch (error) {
            // ENOENT is a real deletion - git listed it, it is gone, the baseline should follow. Anything else
            // (a permission error, an I/O error, a stalled mount) means we could not LOOK, which is not the
            // same answer at all and must not become a deletion.
            if (error?.code === 'ENOENT')
                continue;
            skipped.push({ rel, reason: 'unreadable' });
            continue;
        }
        // A symlink is skipped rather than followed. Mirroring its target would copy a file from outside the
        // project, and mirroring the link itself would be meaningless on the other side.
        if (stats.isSymbolicLink()) {
            skipped.push({ rel, reason: 'symlink' });
            continue;
        }
        if (!stats.isFile())
            continue;
        if (stats.size > options.maxBytes) {
            skipped.push({ rel, reason: 'too-large' });
            continue;
        }
        if (options.now - stats.mtimeMs < options.settleMs) {
            skipped.push({ rel, reason: 'settling' });
            continue;
        }
        if (!await containedIn(root, absolute)) {
            skipped.push({ rel, reason: 'symlink' });
            continue;
        }
        files.set(rel, { rel, size: stats.size, mtimeMs: stats.mtimeMs });
    }
    return {
        files,
        skipped,
        skippedPaths: new Set(skipped.map((entry) => entry.rel)),
        fromGit,
        complete,
        isIgnored: options.ignored,
    };
}
/** Content hash of one file. Streamed, because a mirror is expected to meet files far larger than the
 *  daemon should hold in memory. */
export async function hashFile(absolute) {
    const hash = createHash('sha256');
    const stream = createReadStream(absolute);
    for await (const chunk of stream)
        hash.update(chunk);
    return hash.digest('hex');
}
