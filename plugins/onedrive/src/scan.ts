import { execFile, spawn } from 'node:child_process';
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
export const IGNORE_FLOOR: readonly string[] = [
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

/** A stored subpath turned into something safe to join onto a root, or `null` when it is not.
 *
 *  This is the ONLY place a subpath is accepted. It is user input that arrived over HTTP and then sat in
 *  a database row, so it is re-checked on every read rather than trusted because it was checked once: a
 *  `..` segment would walk the mirror out of the project and start syncing whatever it landed on, and a
 *  segment the ignore floor covers would mirror `.git` or `node_modules` wholesale by naming it directly
 *  instead of being reached through a scan the floor filters.
 *
 *  Rejecting is deliberately the answer for anything unclear. The caller stops the mirror; it never falls
 *  back to the whole project, because quietly widening what someone chose to share is the one outcome
 *  this feature exists to prevent. */
export function normalizeSubpath(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') return null;
  if (value.length > 400) return null;
  const segments = value.split(/[/\\]+/).filter((segment) => segment !== '' && segment !== '.');
  if (segments.length === 0) return '';
  if (segments.length > 32) return null;
  for (const segment of segments) {
    if (segment === '..') return null;
    // A drive letter or a leading colon would make this absolute on some platforms; NUL ends a path in
    // every syscall that takes one.
    if (segment.includes('\0') || segment.includes(':')) return null;
  }
  // The floor covers a path AND its ancestors, and it is written for FILES: most entries look like
  // `node_modules/**` or `.ssh/**`, which the bare directory name does not match. Asking whether a probe
  // child would be ignored is what actually answers "may this directory be the mirror root" - checking
  // the name alone would happily accept `node_modules` and mirror the whole of it.
  for (let depth = 1; depth <= segments.length; depth += 1) {
    const prefix = segments.slice(0, depth).join('/');
    if (isFloorIgnored(prefix) || isFloorIgnored(`${prefix}/probe`)) return null;
  }
  return segments.join('/');
}

export function isFloorIgnored(rel: string): boolean {
  return IGNORE_FLOOR.some((pattern) => matchesGlob(rel, pattern));
}

/** Floor plus the instance's own extra patterns. The floor is checked first and separately so a malformed
 *  operator pattern can never widen what is allowed, only narrow it further. */
export function buildIgnore(extra: string): (rel: string) => boolean {
  const patterns = String(extra ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return (rel: string) => isFloorIgnored(rel) || patterns.some((pattern) => matchesGlob(rel, pattern));
}

export interface ScannedFile {
  rel: string;
  size: number;
  mtimeMs: number;
}

export interface ScanResult {
  files: Map<string, ScannedFile>;
  /** Paths deliberately left out, with the reason, so the UI can say so instead of the file just missing. */
  skipped: { rel: string; reason: 'too-large' | 'symlink' | 'unreadable' | 'settling' | 'collision' }[];
  /** The same paths as a set. The mirror MUST consult this before concluding that a file was deleted:
   *  a skipped file is one this scan chose not to look at, which is not the same as one that is gone, and
   *  treating the two alike deletes the copy in OneDrive of a file that is sitting right there. */
  skippedPaths: Set<string>;
  /** True when git decided the file set, false when the fallback walk did. */
  fromGit: boolean;
  /** False when this scan KNOWS it did not see everything - a directory it could not read, or a fallback
   *  walk that hit its cap. An incomplete scan may not be used to decide that anything was deleted, so the
   *  caller must abort rather than treat the paths it never reached as gone. */
  complete: boolean;
  /** The ignore predicate this scan ran with, so the caller can ask about a path the scan never emitted.
   *  A file that became ignored since it was mirrored is not a deleted file. */
  isIgnored: (rel: string) => boolean;
}

/** OneDrive matches names case-insensitively and normalises Unicode; Linux does neither. Two local paths
 *  that differ only in case or in NFC/NFD spelling therefore address ONE remote item, and mirroring both
 *  makes them overwrite each other and then delete each other. This is the key those collisions share. */
export function remoteKey(rel: string): string {
  return rel.normalize('NFC').toLowerCase();
}

/** The project's own view of which files matter: tracked files plus untracked ones its .gitignore keeps.
 *  This is exactly the definition of "the project without the ignored parts", it costs one process, and it
 *  needs no .gitignore parser of our own — which would be a second, subtly different answer to a question
 *  git already answers authoritatively. */
async function gitFiles(root: string): Promise<string[] | null> {
  try {
    const { stdout } = await run(
      'git',
      ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      { maxBuffer: 64 * 1024 * 1024, timeout: 30_000, encoding: 'utf8' },
    );
    return stdout.split('\0').filter(Boolean);
  } catch {
    return null;
  }
}

/** Which of these paths does GIT consider ignored?
 *
 *  `scanLocal`'s own predicate knows the hard floor and the user's extra patterns - it does NOT know what
 *  the project's .gitignore says, because git answers that by omitting the file from `ls-files` entirely.
 *  So a mirrored untracked file that somebody later adds to .gitignore simply disappears from the scan,
 *  and "disappeared" is what this mirror deletes. Asking git directly is the only way to tell that apart
 *  from a real deletion. One process for the whole batch, and only for paths that already went missing. */
export async function gitIgnoredAmong(
  root: string, paths: readonly string[],
): Promise<{ ignored: Set<string>; ok: boolean }> {
  const out = new Set<string>();
  if (paths.length === 0) return { ignored: out, ok: true };
  // `promisify(execFile)` cannot write to stdin, and the path list is unbounded, so this one spawns.
  const child = spawn('git', ['-C', root, 'check-ignore', '--stdin', '-z', '--no-index'], {
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  const chunks: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
  child.stdin.on('error', () => undefined); // git may close stdin early; that is not our failure
  child.stdin.end(`${paths.join('\0')}\0`);
  const code = await new Promise<number | null>((resolve) => {
    child.on('close', (status) => resolve(status));
    child.on('error', () => resolve(null));
  });
  for (const rel of Buffer.concat(chunks).toString('utf8').split('\0').filter(Boolean)) out.add(rel);
  // 0 means some matched, 1 means none did - both are ANSWERS. Anything else (no repository any more, an
  // inaccessible worktree, git missing) is not, and an empty set is NOT a safe default here: every path
  // that went missing would then be read as deleted and removed from OneDrive. The caller must stop.
  return { ignored: out, ok: code === 0 || code === 1 };
}

/** Fallback for a root that is not a repository: a bounded walk that never follows a directory symlink. */
async function walk(root: string, limit: number): Promise<{ files: string[]; complete: boolean }> {
  const out: string[] = [];
  const queue: string[] = [''];
  let complete = true;
  while (queue.length > 0) {
    if (out.length >= limit) { complete = false; break; }
    const dir = queue.shift()!;
    let entries;
    try {
      entries = await readdir(join(root, dir), { withFileTypes: true });
    } catch {
      // A directory we could not read is a directory whose contents are UNKNOWN. Carrying on quietly
      // would present its files as absent, and absent is what this mirror deletes.
      complete = false;
      continue;
    }
    for (const entry of entries) {
      const rel = dir ? `${dir}/${entry.name}` : entry.name;
      if (isFloorIgnored(rel)) continue;
      if (entry.isDirectory()) queue.push(rel);
      else if (entry.isFile() || entry.isSymbolicLink()) out.push(rel);
      if (out.length >= limit) { complete = false; break; }
    }
  }
  return { files: out, complete };
}

/** Is `candidate` really inside `root` once every symlink has been resolved? A mirror walks paths supplied
 *  by whatever is on disk, so a symlink pointing out of the project is a way to make the daemon upload a
 *  file the project never contained. Containment is checked on the RESOLVED path, by path component, not by
 *  string prefix — `/srv/project-secrets` starts with `/srv/project` as a string. */
export async function containedIn(root: string, candidate: string): Promise<boolean> {
  try {
    const realRoot = await realpath(root);
    const real = await realpath(candidate);
    if (real === realRoot) return true;
    const rel = relative(realRoot, real);
    return rel !== '' && !rel.startsWith('..') && !rel.startsWith(`..${sep}`) && !resolve(realRoot, rel).startsWith('..');
  } catch {
    return false;
  }
}

/** Containment for a path that does not exist yet - a file about to be downloaded into a directory the
 *  project has not created. `realpath` fails on a missing path, so the check climbs to the nearest
 *  ancestor that DOES exist and resolves that. A symlinked ancestor is therefore still caught, while a
 *  genuinely new nested directory is allowed instead of being silently skipped forever. */
export async function containedInEventually(root: string, absolute: string): Promise<boolean> {
  let current = dirname(absolute);
  const stop = resolve(root);
  for (;;) {
    try {
      await realpath(current);
      return containedIn(root, current);
    } catch {
      const parent = dirname(current);
      // Ran out of ancestors without meeting anything real: the root itself is gone.
      if (parent === current || current.length < stop.length) return false;
      current = parent;
    }
  }
}

export interface ScanOptions {
  ignored: (rel: string) => boolean;
  maxBytes: number;
  /** Files touched more recently than this are skipped for now: a half-written file must not be uploaded
   *  as if it were finished, and the next cycle is only seconds away. */
  settleMs: number;
  now: number;
  maxFiles: number;
}

export async function scanLocal(root: string, options: ScanOptions): Promise<ScanResult> {
  const listed = await gitFiles(root);
  const fromGit = listed !== null;
  const fallback = listed === null ? await walk(root, options.maxFiles) : null;
  const candidates = listed ?? fallback!.files;
  const files = new Map<string, ScannedFile>();
  const skipped: ScanResult['skipped'] = [];
  let complete = fallback ? fallback.complete : true;
  if (fromGit && candidates.length >= options.maxFiles) complete = false;

  // Names that collide once OneDrive's case-insensitive, Unicode-normalising rules are applied cannot
  // both be mirrored: they are one item over there. Skipping the whole group leaves every local copy
  // intact, where mirroring them would let the last writer win and the others be trashed.
  const byRemoteKey = new Map<string, string[]>();
  for (const rel of candidates) {
    const key = remoteKey(rel);
    const bucket = byRemoteKey.get(key);
    if (bucket) bucket.push(rel); else byRemoteKey.set(key, [rel]);
  }
  const colliding = new Set<string>();
  for (const bucket of byRemoteKey.values()) {
    if (bucket.length > 1) for (const rel of bucket) colliding.add(rel);
  }

  for (const rel of candidates) {
    if (options.ignored(rel)) continue;
    if (colliding.has(rel)) { skipped.push({ rel, reason: 'collision' }); continue; }
    const absolute = join(root, rel);
    let stats;
    try {
      stats = await lstat(absolute);
    } catch (error) {
      // ENOENT is a real deletion - git listed it, it is gone, the baseline should follow. Anything else
      // (a permission error, an I/O error, a stalled mount) means we could not LOOK, which is not the
      // same answer at all and must not become a deletion.
      if ((error as { code?: string })?.code === 'ENOENT') continue;
      skipped.push({ rel, reason: 'unreadable' });
      continue;
    }
    // A symlink is skipped rather than followed. Mirroring its target would copy a file from outside the
    // project, and mirroring the link itself would be meaningless on the other side.
    if (stats.isSymbolicLink()) { skipped.push({ rel, reason: 'symlink' }); continue; }
    if (!stats.isFile()) continue;
    if (stats.size > options.maxBytes) { skipped.push({ rel, reason: 'too-large' }); continue; }
    if (options.now - stats.mtimeMs < options.settleMs) { skipped.push({ rel, reason: 'settling' }); continue; }
    if (!await containedIn(root, absolute)) { skipped.push({ rel, reason: 'symlink' }); continue; }
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
export async function hashFile(absolute: string): Promise<string> {
  const hash = createHash('sha256');
  const stream = createReadStream(absolute);
  for await (const chunk of stream) hash.update(chunk as Buffer);
  return hash.digest('hex');
}
