import { posix } from 'node:path';
import { randomUUID } from 'node:crypto';
import { editorExecute } from './execution.js';
import { parseProjectCommitLog } from './files.js';
import type { PluginApiRequest, PluginContext, PluginHttpResponse } from 'elowen/dist/plugins/api.js';
import type { GuestFileOperation, GuestFileResult, GuestFileStat } from 'elowen/dist/plugins/environmentTypes.js';
import { managedGuestRoot } from 'elowen/dist/shared/projectExecution.js';
import { MAX_BUFFERED_BYTES, MAX_OFFICE_BYTES, MAX_UPLOAD_CHUNK_BYTES, baseName, mimeTypeOf, fileKindOf } from './fileTypes.js';
import { GUEST_SYSTEM_ROOT, isVirtualGuestPath, type EditorRoot } from './editorRoots.js';

const TEXT_LIMIT = 2 * 1024 * 1024;
const RANGE_LIMIT = 8 * 1024 * 1024;
/** Decoded bytes per guest chunk; every chunk except the last carries exactly this size. Mirrors the
 *  canonical `GUEST_FILE_CHUNK_BYTES` until the parent refreshes the linked `elowen` package, which
 *  does not export it yet. */
const GUEST_CHUNK_BYTES = 512 * 1024;
/** Build output and dependency trees a PROJECT tree does not show. They are a statement about what a
 *  repository looks like, so the system root does not apply them: `/` is not a checkout, and hiding a
 *  directory of the base image because a repository would have ignored one by that name would be a lie
 *  about the filesystem the root exists to show. */
const IGNORE = new Set(['.git', 'node_modules', '.next', 'dist', '.turbo', 'coverage', '.cache']);
/** How deep each root is walked in one crossing.
 *
 *  A project arrives whole, because eight levels of a project is a few thousand entries. A guest root
 *  filesystem is not that — two levels below `/` already hold tens of thousands of entries — so the
 *  system root is served one directory at a time and the browser asks for the next level as a folder is
 *  opened, exactly as the host system root is served. */
const ROOT_WALK_DEPTH: Record<EditorRoot, number> = { project: 8, system: 0 };
/** The mounts that read the project's Git history, and therefore exist only under the project root. */
const GIT_MOUNTS = new Set([
  '/projects/:id/diff', '/projects/:id/head', '/projects/:id/changes', '/projects/:id/changed',
  '/projects/:id/commit/:hash', '/projects/:id/commit/:hash/diff', '/projects/:id/commits',
]);
/** The tree view's own node bound. The guest ceiling is one higher, so a tree of exactly this many nodes
 *  answers complete while one node more comes back `truncated` — the view can tell the two apart without
 *  counting. */
const LIST_NODE_CAP = 10000;
class InputError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
/** Environment-provider refusals that are a decision about the CALLER rather than a runtime diagnostic:
 *  the project is not (or no longer) theirs, or their account may not use the environment at all. Both are
 *  reachable from a browser and both are actionable, so they keep their meaning instead of arriving as the
 *  generic 503 the rest of this transport answers. Matched on the provider's own stable CODE, never on an
 *  arbitrary `status` an unknown error happens to carry, and the message is the provider's static one,
 *  which names no path and no process. */
const ACCESS_REFUSALS = new Set(['project_forbidden', 'account_forbidden']);
/** Every chunked-upload refusal this transport will repeat to a browser, keyed on the guest's stable
 *  CODE and answered with the wording and status written HERE.
 *
 *  The provider's own message is never forwarded. Its text is assembled where the failure happened and
 *  has carried an errno, the staging directory and the candidate filename — none of it the caller's, none
 *  of it actionable, and none of it a contract anything can be written against. A code that is not in
 *  this table is not a refusal the editor knows how to describe, so it falls through to the generic
 *  answer rather than being repeated on trust. `version_conflict` is handled before this table because it
 *  reaches far more than uploads and the UI's conflict flow is written against its own wording.
 *
 *  `guest_protocol` and `guest_upload_error` are deliberately absent: the first is the transport telling
 *  itself the guest broke the protocol and the second is a code nobody has agreed on, and neither is
 *  something a person at a browser can act on. Both fall through to the generic answer.
 *
 *  A Map, not an object, because the lookup key is a string the PROVIDER chose. Indexing a plain object
 *  with `constructor`, `toString` or `__proto__` answers from the prototype chain, and any of those would
 *  have passed the "is this code known" test with a value carrying no status and no message — turning the
 *  one path that is supposed to end in the generic answer into a malformed 4xx. A Map has no inherited
 *  keys, so an unknown code is unknown whatever it is called. */
const UPLOAD_REFUSALS = new Map<string, { status: number; message: string }>(Object.entries({
  upload_forbidden: { status: 403, message: 'this upload does not belong to this destination' },
  upload_conflict: { status: 409, message: 'another upload already owns this destination' },
  upload_unknown: { status: 409, message: 'upload handle is unavailable' },
  upload_expired: { status: 409, message: 'upload expired and must be started again' },
  upload_pending: { status: 409, message: 'upload is not ready for chunks' },
  environment_busy: { status: 409, message: 'the project environment changed while this upload was starting' },
  upload_invalid: { status: 409, message: 'upload state is not valid for this step' },
  upload_completed: { status: 409, message: 'upload is already committed' },
  upload_incomplete: { status: 409, message: 'upload is missing chunks and cannot be committed' },
  upload_cleanup_unverified: { status: 409, message: 'upload staging could not be verified' },
  chunk_conflict: { status: 409, message: 'a different chunk already occupies this offset' },
  resolution_drift: { status: 409, message: 'upload destination changed while the upload was open' },
  not_directory: { status: 409, message: 'upload destination is inside something that is not a directory' },
  invalid_path: { status: 400, message: 'invalid upload destination' },
  invalid_operation: { status: 400, message: 'invalid upload operation' },
  invalid_upload: { status: 400, message: 'invalid upload handle' },
  invalid_chunk: { status: 400, message: 'invalid upload chunk' },
  invalid_size: { status: 400, message: 'invalid upload size' },
  version_required: { status: 400, message: 'a content version is required' },
  file_too_large: { status: 413, message: 'file is too large to upload' },
}));
const accessRefusal = (error: unknown): InputError | undefined => {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code !== 'string' || !ACCESS_REFUSALS.has(code)) return undefined;
  return new InputError(error instanceof Error ? error.message : 'project access is denied', 403);
};
let activeConversions = 0;
/** One in-flight managed upload per acting account, Project and destination. The browser sends 2 MiB
 *  HTTP chunks while the guest accepts exactly `chunkSize` bytes at each aligned offset (the file's
 *  final chunk excepted), so the tail of a chunk that ends inside a guest chunk must be held until the
 *  next request. A buffer is always below one guest chunk, the map is bounded, and eviction drops the
 *  oldest idle session with a best-effort abort: its handle can no longer be advanced and the
 *  runtime's own TTL reclaims any staging it leaves behind. */
interface ManagedUploadSession { path: string; uploadId: string; chunkSize: number; size: number; received: number; buffered: Buffer; busy: boolean }
/** Sessions live with the provider instance that granted the handles: when the runtime is rewired or
 *  the daemon restarts, its handles are gone with it, so holding them in a module map would serve
 *  bookkeeping for a provider that no longer exists. */
const managedUploadSessions = new WeakMap<object, Map<string, ManagedUploadSession>>();
const MAX_MANAGED_UPLOADS = 64;

/** The conflict token a version-checked mutation must carry. `stat` and `read` always compute one; the
 *  field is optional on the guest type because a metadata-only LISTING does not hash contents. Treating an
 *  absent version as `null` here would read as "fresh destination" and turn a compare-and-swap into a
 *  blind overwrite, so it fails loudly instead. */
function requireVersion(entry: GuestFileStat): string {
  if (typeof entry.version !== 'string') throw new Error('guest stat returned no content version');
  return entry.version;
}

/** The guest directory one root resolves to.
 *
 *  The project root is the canonical slug-derived mount from core's `managedGuestRoot` — the single rule
 *  the agent, the tool rows and the container's own mount target already share, so the editor names the
 *  same directory they do instead of re-deriving one. The system root is the guest's own `/`.
 *
 *  Neither is ever taken from the request: the caller supplies a root NAME and the identity of a project
 *  it is authorized for, and the directory follows from those two. */
function rootPath(root: EditorRoot, slug: string, projectId: number): string {
  return root === 'system' ? GUEST_SYSTEM_ROOT : managedGuestRoot(slug, projectId);
}

/** One path, resolved against the root it is confined to and returned absolute.
 *
 *  Paths are relative to the selected root and stay that way in both directions. Resolution normalises
 *  `..` away before the confinement test, so traversal cannot leave the root — and under the system root,
 *  where `/` IS the root, the guest filesystem is the boundary the container already enforces. A
 *  backslash is refused rather than normalised: it is not a separator here, and accepting it would let
 *  one name mean two different files depending on who reads it. The guest resolves symlinks and refuses
 *  the ones that leave the environment.
 *
 *  This is the shared rule for BOTH the path a caller asks for and the absolute paths the guest reports
 *  back in a listing. The extra refusal a caller's path carries is applied by `requestPath` below, not
 *  here: a listing of `/` legitimately reports `/proc` as one of its entries, and refusing the entry
 *  would turn "this directory is not browsable" into "the whole filesystem is unreadable". */
function guestPathIn(base: string, value: unknown): string {
  if (typeof value !== 'string' || !value || value.includes('\0') || value.includes('\\')) throw new InputError('path required');
  const path = posix.resolve(base, value);
  const prefix = base === GUEST_SYSTEM_ROOT ? GUEST_SYSTEM_ROOT : `${base}/`;
  if (path !== base && !path.startsWith(prefix)) throw new InputError('invalid path');
  return path;
}

/** One authorized managed target: the project the caller may reach, and the root within it this request
 *  operates on. The slug is read from the project row, never from the request. */
export interface ManagedEditorTarget { projectId: number; slug: string; root: EditorRoot }

export async function managedEditorRequest(ctx: PluginContext, req: PluginApiRequest, target: ManagedEditorTarget, mount: string, method: string): Promise<PluginHttpResponse> {
  const accountUserId = req.auth.userId;
  if (!accountUserId) return { status: 403, body: { error: 'a linked account is required' } };
  const provider = ctx.control('sandbox');
  if (!provider) return { status: 503, body: { error: 'project environment unavailable' } };
  const { projectId, root } = target;
  const project = { kind: 'managed' as const, projectId };
  const base = rootPath(root, target.slug, projectId);
  /** An absolute path the guest reported, confined to the selected root. */
  const entryPath = (value: unknown): string => guestPathIn(base, value);
  /** A path the CALLER asked for. Kernel interfaces are refused here and nowhere else: they are not
   *  files — walking `/proc` walks the process table, and a device or FIFO node is a driver rather than
   *  content — and none of them survive a restart, so none is part of the persistent root filesystem
   *  this root exists to show.
   *
   *  The test is on the path as written, before any guest crossing, and it is deliberately not a
   *  privilege boundary. A member who plants a symlink to `/proc` inside their own environment and then
   *  asks for it through the link reaches it, because resolving every request against the guest would
   *  cost a container execution per read to enforce a rule that grants nobody anything: the whole guest
   *  already belongs to this project, and the same member can read the same file from a shell in it.
   *  What this keeps out is the filesystem offering kernel interfaces as editable files. */
  const guestPath = (value: unknown): string => {
    const path = entryPath(value);
    if (base === GUEST_SYSTEM_ROOT && isVirtualGuestPath(path)) throw new InputError('virtual filesystem paths are unavailable');
    return path;
  };
  // Guest commands run AT the root they serve. A converter or a directory removal prepared at some other
  // directory would be operating outside the root the caller selected.
  const execute = (file: string, args: string[]) => editorExecute(ctx, projectId, accountUserId, { type: 'argv', file, args }, base);
  // Resolve the live provider for every operation, including multi-request listings and mutations.
  const files = async (operation: GuestFileOperation): Promise<GuestFileResult> => {
    const live = ctx.control('sandbox');
    if (!live) throw new Error('project environment unavailable');
    try {
      return await live.projectFiles({ project, accountUserId, operation });
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      // The provider tags every refusal with the guest's own code. A lost CAS race is the one the
      // editor can name precisely: the UI's conflict flow is written against the app-path shape,
      // 409 + 'content version conflict', so a stale expectedVersion must not fall through as 503.
      if (code === 'version_conflict') throw new InputError('content version conflict', 409);
      // A chunked-upload refusal is client-facing by design, so it keeps its own status instead of the
      // generic 503 — but only the codes listed here, and only with the wording written here. What the
      // provider put in the message is not the editor's to forward: it has carried a guest errno, a
      // staging directory and a candidate filename, none of which belong in a browser response.
      if (typeof code === 'string' && typeof operation.kind === 'string' && operation.kind.startsWith('write-')) {
        const known = UPLOAD_REFUSALS.get(code);
        if (known) throw new InputError(known.message, known.status);
      }
      throw error;
    }
  };
  const readBytes = async (path: string, maxBytes: number, offset = 0, length?: number, truncate = false) => {
    const chunks: Buffer[] = [];
    let version: string | undefined;
    let remaining = length;
    let cursor = offset;
    do {
      const result = await files({ kind: 'read', path, offset: cursor, length: Math.min(remaining ?? maxBytes, 256 * 1024), maxBytes: 256 * 1024 });
      if (result.kind !== 'read' || (version !== undefined && version !== result.version)) throw new InputError('file changed during download', 409);
      remaining ??= result.totalBytes - offset;
      if (remaining > maxBytes && truncate) return { bytes: Buffer.alloc(0), version: result.version, truncated: true };
      if (remaining > maxBytes || remaining < 0) throw new InputError('file is too large to buffer', 413);
      version = result.version;
      const bytes = Buffer.from(result.base64, 'base64');
      if (bytes.length !== Math.min(remaining, 256 * 1024)) throw new Error('incomplete guest read');
      chunks.push(bytes); cursor += bytes.length; remaining -= bytes.length;
    } while (remaining > 0);
    return { bytes: Buffer.concat(chunks), version, truncated: false };
  };
  /** Canonical follow-stat: the guest resolves a symlink to its target and reports that entry, and
   *  answers `entry: null` for a dangling one. Nothing is swallowed — a failed stat propagates, so an
   *  access revocation or runtime outage can never masquerade as a missing link; only the explicit
   *  `entry: null` is interpreted. This replaces the temporary realpath exec bridge that stood in
   *  until the runtime added `followSymlinks`. */
  const followEntry = async (entry: GuestFileStat | null): Promise<GuestFileStat | null> => {
    if (entry?.kind !== 'symlink') return entry;
    const result = await files({ kind: 'stat', path: entry.path, followSymlinks: true });
    if (result.kind !== 'stat') throw new Error('invalid guest result');
    return result.entry ? { ...result.entry, path: entry.path } : null;
  };
  const input = async (): Promise<Record<string, unknown>> => {
    const value = await req.json<unknown>();
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InputError('invalid request');
    return value as Record<string, unknown>;
  };
  /** The version an OVERWRITE opens its compare-and-swap against, or null when there is nothing at the
   *  destination yet.
   *
   *  The follow-stat asks the precise question, because an overwrite through a symlink must be versioned
   *  against the target. Resolving the path can also establish that an ANCESTOR is not a directory, which
   *  the guest names with the same code it uses everywhere else for that fact. It is the one failure this
   *  preflight translates, and it translates it into the wording the refusal table already owns, so an
   *  overwrite and a fresh upload answer the same request the same way.
   *
   *  Nothing else is interpreted. A permission refusal, a lifecycle change, a transport fault or a code
   *  nobody has agreed on rethrows untouched and reaches the caller as what it is.
   */
  const uploadBaseVersion = async (path: string): Promise<string | null> => {
    let stat;
    try {
      stat = await files({ kind: 'stat', path, followSymlinks: true });
    } catch (error) {
      if ((error as { code?: unknown } | null)?.code !== 'not_directory') throw error;
      const refusal = UPLOAD_REFUSALS.get('not_directory');
      if (!refusal) throw error;
      throw new InputError(refusal.message, refusal.status);
    }
    if (stat.kind !== 'stat') throw new Error('invalid guest result');
    return stat.entry ? requireVersion(stat.entry) : null;
  };

  /** Carries one browser chunk into the canonical upload protocol: begins the guest handle on the
   *  first chunk (CAS against a fresh destination, or against the version seen here for an overwrite),
   *  streams every full guest chunk at its aligned offset, and — on the final browser chunk — sends
   *  the trailing partial piece as the file's last guest chunk and commits. Returns the confirmed
   *  byte count, or the committed size. The commit is the single atomic version-checked replacement;
   *  an interrupted upload is released by the caller's abort. */
  const streamUploadChunk = async (session: ManagedUploadSession, bytes: Buffer, final: boolean, overwrite: boolean): Promise<number> => {
    if (!session.uploadId) {
      const begin = await files({ kind: 'write-begin', path: session.path, expectedVersion: overwrite ? await uploadBaseVersion(session.path) : null, size: session.size });
      if (begin.kind !== 'write-begin') throw new Error('invalid guest result');
      session.uploadId = begin.uploadId;
      session.chunkSize = begin.chunkSize;
    }
    let pending = session.buffered.length ? Buffer.concat([session.buffered, bytes]) : bytes;
    while (session.received + session.chunkSize <= session.size && pending.length >= session.chunkSize) {
      const chunk = await files({ kind: 'write-chunk', path: session.path, uploadId: session.uploadId, offset: session.received, base64: pending.subarray(0, session.chunkSize).toString('base64') });
      if (chunk.kind !== 'write-chunk') throw new Error('invalid guest result');
      session.received = chunk.received;
      pending = pending.subarray(session.chunkSize);
    }
    if (session.received + pending.length > session.size) throw new InputError('file too large');
    if (final) {
      if (pending.length !== session.size - session.received) throw new InputError('file too large');
      if (pending.length > 0) {
        const chunk = await files({ kind: 'write-chunk', path: session.path, uploadId: session.uploadId, offset: session.received, base64: pending.toString('base64') });
        if (chunk.kind !== 'write-chunk') throw new Error('invalid guest result');
        session.received = chunk.received;
      }
      const committed = await files({ kind: 'write-commit', path: session.path, uploadId: session.uploadId });
      if (committed.kind !== 'write-commit') throw new Error('invalid guest result');
      return committed.entry.size;
    }
    session.buffered = pending;
    return session.received + session.buffered.length;
  };
  try {
    if (mount === '/projects/:id/files') {
      // ONE guest traversal answers the whole view. Driving it from here cost a `list` per directory and
      // each of those is a container execution, so a project root of four directories paid five crossings
      // — three to ten seconds against roughly 750 ms for a single directory. The guest walks the tree
      // itself and returns the same shape in one crossing.
      const explicit = typeof req.query.path === 'string' && req.query.path !== '';
      const start = explicit ? guestPath(req.query.path) : base;
      // Expanding ONE directory asks for its children and nothing below them, which is `maxDepth: 0`; the
      // project root keeps the eight levels this view has always shown, while the system root is served
      // one level at a time whatever is asked for. `skip` omits an ignored directory entirely rather than
      // descending into it, which is what the client-side filter did before — and it applies to CHILDREN
      // only, so asking for an ignored directory by name still expands it.
      const depthLimit = explicit ? 0 : ROOT_WALK_DEPTH[root];
      const result = await files({
        kind: 'walk', path: start, limit: LIST_NODE_CAP, maxDepth: depthLimit, skip: root === 'system' ? [] : [...IGNORE],
      });
      if (result.kind !== 'walk') throw new Error('invalid guest result');
      // `rootKind` answers the existence question the old separate stat used to, and the two failures it
      // names are different: a path that is gone is not an empty folder, and a file is not a directory —
      // the walk would otherwise answer from the file's PARENT, which must never be rendered as the
      // requested folder.
      if (result.rootKind === null) throw new InputError('path does not exist', 404);
      const nodes: { path: string; type: 'file' | 'dir'; size?: number }[] = [];
      const prefix = start === '/' ? '/' : `${start}/`;
      // The upload suffix is a staging filename the guest has no notion of, so it is dropped under both
      // roots. The repository ignores apply to the project tree alone.
      const hidden = (path: string): boolean => (root === 'project' && IGNORE.has(posix.basename(path))) || path.endsWith('.elowen-upload') || (root === 'system' && isVirtualGuestPath(path));
      /** Levels below the directory that was asked for, counted the way the recursive listing counted
       *  them: a direct child is 0, so `< depthLimit` is the same bound the walk itself applied. */
      const depthOf = (path: string): number => path.slice(prefix.length).split('/').length - 1;
      /** One link the walk reported, resolved to the entry it points at, or null when it points nowhere.
       *  The walk gives the link's own facts and never its target's, so this stat is the only way to know
       *  what to show — which is what the per-directory listing did per link too. */
      const resolveLink = (path: string, size: number, mtime: number): Promise<GuestFileStat | null> =>
        followEntry({ path, kind: 'symlink', size, modifiedAt: new Date(mtime).toISOString() });
      /** The per-directory listing, kept for what lies BEHIND a symlink and nothing else. The walk
       *  reports a link but never follows it, so a linked directory's contents have to be listed through
       *  the link path itself, which `list` resolves. A tree without links never reaches this; one with
       *  links pays the old cost for the linked subtrees alone. */
      const expandLink = async (path: string, depth: number): Promise<void> => {
        let cursor: string | undefined;
        do {
          const page = await files({ kind: 'list', path, limit: 1000, cursor });
          if (page.kind !== 'list') throw new Error('invalid guest result');
          if (nodes.length + page.entries.length > LIST_NODE_CAP) throw new InputError('directory listing is too large; select a subdirectory');
          for (const original of page.entries) {
            const clean = entryPath(original.path);
            if (posix.dirname(clean) !== path) throw new Error('invalid guest entry');
            // Filter before following: a guest probe per symlink is wasted on entries that are dropped anyway.
            if (hidden(clean)) continue;
            const entry = await followEntry(original);
            if (!entry) continue;
            const child = posix.relative(base, clean);
            if (entry.kind === 'directory') {
              nodes.push({ path: child, type: 'dir' });
              // The depth bound is also what terminates a link that points back at its own ancestor.
              // Expanding ONE directory never descends, whatever it is reached through — and neither does
              // the system root, whose bound is zero.
              if (depth < depthLimit) await expandLink(clean, depth + 1);
            } else if (entry.kind === 'file') nodes.push({ path: child, type: 'file', size: entry.size });
          }
          cursor = page.nextCursor ?? undefined;
        } while (cursor);
      };
      // The root ITSELF can be a link: the tree view expands a linked folder by name, and always could.
      // The walk answers a symlink root from its PARENT, so its entries describe a different directory
      // and are discarded here — the link is resolved and read through the link path instead, exactly as
      // the per-directory listing read it.
      if (result.rootKind === 'symlink') {
        const target = await resolveLink(start, 0, 0);
        if (!target) throw new InputError('path does not exist', 404);
        if (target.kind !== 'directory') throw new InputError('not a directory');
        await expandLink(start, 0);
        return { body: nodes };
      }
      // A file is not a directory, and the walk would otherwise answer for its PARENT, which must never
      // be rendered as the requested folder.
      if (result.rootKind !== 'directory') throw new InputError('not a directory');
      // The cap is this view's own bound and it stays an error rather than a silent partial tree: a
      // truncated answer rendered as a complete one is the one outcome the caller cannot detect.
      if (result.truncated) throw new InputError('directory listing is too large; select a subdirectory');
      for (const entry of result.entries) {
        const clean = entryPath(entry.path);
        // Entries are absolute and must lie under the directory that was asked for. `guestPath` already
        // confines them to the selected root; this keeps a walk from contributing anything outside it.
        if (!clean.startsWith(prefix)) throw new Error('invalid guest entry');
        // `skip` covers the ignored directories; the upload suffix is a filename rule the guest has no
        // notion of, and the basename check stays as the net for both.
        if (hidden(clean)) continue;
        const path = posix.relative(base, clean);
        if (entry.kind !== 'symlink') {
          nodes.push(entry.kind === 'directory' ? { path, type: 'dir' } : { path, type: 'file', size: entry.size });
          continue;
        }
        // A link is shown as what it points AT, which is what this view has always shown: its target's
        // kind and its target's size, a dangling one dropped entirely. The walk gives the link's own
        // facts, so resolving it stays one stat per link, exactly as before.
        const target = await resolveLink(clean, entry.size, entry.mtime);
        if (!target) continue;
        if (target.kind === 'directory') {
          nodes.push({ path, type: 'dir' });
          // Discovered at `depthOf`, expanded one level deeper — the same two counts the recursive
          // listing kept, so a linked subtree bottoms out at the level a real one does.
          if (depthOf(clean) < depthLimit) await expandLink(clean, depthOf(clean) + 1);
        } else if (target.kind === 'file') nodes.push({ path, type: 'file', size: target.size });
      }
      if (nodes.length > LIST_NODE_CAP) throw new InputError('directory listing is too large; select a subdirectory');
      return { body: nodes };
    }
    if (mount === '/projects/:id/file' && method === 'GET') {
      const result = await readBytes(guestPath(req.query.path), TEXT_LIMIT, 0, undefined, true);
      return { body: { content: result.bytes.toString('utf8'), truncated: result.truncated, version: result.version } };
    }
    if (mount === '/projects/:id/file' && method === 'PUT') {
      const value = await input();
      const path = guestPath(value.path);
      if (path === base) throw new InputError('unsupported file type');
      if (typeof value.content !== 'string') throw new InputError('content required');
      if (Buffer.byteLength(value.content) > TEXT_LIMIT) throw new InputError('file too large');
      // Managed writes never silently overwrite a version that another project member edited.
      if (typeof value.version !== 'string' && value.version !== null) return { status: 409, body: { error: 'read the file before saving; content version required' } };
      if (value.version === null) await execute('mkdir', ['-p', '--', posix.dirname(path)]);
      const size = Buffer.byteLength(value.content);
      if (size <= GUEST_CHUNK_BYTES) {
        const result = await files({ kind: 'write', path, base64: Buffer.from(value.content).toString('base64'), expectedVersion: value.version });
        if (result.kind !== 'write') throw new Error('invalid guest result');
        return { status: 200, body: { ok: true, version: result.entry.version } };
      }
      // Above one guest chunk the save crosses as the canonical chunked sequence: begin binds the
      // handle to this account, Project, generation, target and base version; every chunk but the last
      // is exactly chunkSize at an aligned offset; the commit is the single atomic CAS replacement.
      const content = Buffer.from(value.content);
      const begin = await files({ kind: 'write-begin', path, expectedVersion: value.version, size });
      if (begin.kind !== 'write-begin') throw new Error('invalid guest result');
      try {
        for (let offset = 0; offset < size; offset += begin.chunkSize) {
          const take = Math.min(begin.chunkSize, size - offset);
          const chunk = await files({ kind: 'write-chunk', path, uploadId: begin.uploadId, offset, base64: content.subarray(offset, offset + take).toString('base64') });
          if (chunk.kind !== 'write-chunk') throw new Error('invalid guest result');
        }
        const committed = await files({ kind: 'write-commit', path, uploadId: begin.uploadId });
        if (committed.kind !== 'write-commit') throw new Error('invalid guest result');
        return { status: 200, body: { ok: true, version: committed.entry.version } };
      } catch (error) {
        // The primary failure is what propagates; the abort only releases the guest staging and the
        // handle so a failed save can never own the destination or leave half-written state.
        await files({ kind: 'write-abort', path, uploadId: begin.uploadId }).catch(() => undefined);
        throw error;
      }
    }
    if (mount === '/projects/:id/new-file' || mount === '/projects/:id/dir') {
      const value = await input();
      const path = guestPath(value.path);
      if (path === base) throw new InputError('cannot replace the root directory');
      await execute('mkdir', ['-p', '--', posix.dirname(path)]);
      const operation: GuestFileOperation = mount.endsWith('/dir') ? { kind: 'mkdir', path } : { kind: 'write', path, base64: '', expectedVersion: null };
      const result = await files(operation);
      if (result.kind !== 'write' && result.kind !== 'mkdir') throw new Error('invalid guest result');
      return { body: { ok: true } };
    }
    if (mount === '/projects/:id/raw') {
      const path = guestPath(req.query.path);
      const stat = await files({ kind: 'stat', path });
      if (stat.kind !== 'stat') throw new Error('invalid guest result');
      stat.entry = await followEntry(stat.entry);
      if (stat.entry?.kind !== 'file') return { status: 415, body: { error: 'not previewable' } };
      const size = stat.entry.size;
      const headers: Record<string, string> = { 'accept-ranges': 'bytes', 'cache-control': 'no-store', 'content-type': mimeTypeOf(path), ...(req.query.download === '1' ? { 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(baseName(path))}` } : {}) };
      let offset = 0;
      let length = size;
      if (req.headers.range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range.trim());
        if (!match || (!match[1] && !match[2])) return { status: 416, body: { error: 'invalid range' } };
        offset = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
        const end = match[1] && match[2] ? Number(match[2]) : size - 1;
        if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset < 0 || offset >= size || end < offset || (!match[1] && Number(match[2]) <= 0)) return { status: 416, body: { error: 'invalid range' }, headers: { ...headers, 'content-range': `bytes */${size}` } };
        length = Math.min(end - offset + 1, size - offset, RANGE_LIMIT);
      } else if (size > MAX_BUFFERED_BYTES) return { status: 413, body: { error: 'file is too large to buffer' } };
      const result = await readBytes(path, req.headers.range ? RANGE_LIMIT : MAX_BUFFERED_BYTES, offset, length);
      if (result.version !== stat.entry.version) return { status: 409, body: { error: 'file changed during download' } };
      const bytes = result.bytes;
      if (bytes.length !== length) throw new Error('incomplete guest read');
      return { status: req.headers.range ? 206 : 200, body: new Uint8Array(bytes), headers: { ...headers, 'content-length': String(bytes.length), ...(req.headers.range ? { 'content-range': `bytes ${offset}-${offset + bytes.length - 1}/${size}` } : {}) } };
    }
    if (mount === '/projects/:id/entry') {
      const path = guestPath(req.query.path);
      if (path === base) throw new InputError('cannot delete the root directory');
      const source = await files({ kind: 'stat', path });
      if (source.kind !== 'stat' || !source.entry) throw new InputError('source does not exist');
      if (source.entry.kind === 'other') throw new InputError('unsupported file type');
      if (source.entry.kind === 'directory') await execute('python3', ['-c', 'import shutil,sys; shutil.rmtree(sys.argv[1])', path]);
      else {
        const result = await files({ kind: 'remove', path, expectedVersion: requireVersion(source.entry) });
        if (result.kind !== 'remove' || !result.removed) throw new Error('guest removal was not completed');
      }
      return { body: { ok: true } };
    }
    if (mount === '/projects/:id/rename' || mount === '/projects/:id/copy') {
      const value = await input();
      const from = guestPath(value.from);
      const to = guestPath(value.to);
      // Both ends are resolved against the SAME root, so a move can never cross from one root into the
      // other: one request selects one root and every path in it is confined to that root's directory.
      // The root itself is neither a source nor a destination — renaming or copying over it would replace
      // the directory the whole view is anchored to.
      if (from === base || to === base || to.startsWith(from + '/')) throw new InputError('invalid destination');
      if (mount.endsWith('/rename')) {
        const source = await files({ kind: 'stat', path: from });
        if (source.kind !== 'stat' || !source.entry) throw new InputError('source does not exist');
        await execute('mkdir', ['-p', '--', posix.dirname(to)]);
        const result = await files({ kind: 'rename', path: from, destination: to, expectedVersion: requireVersion(source.entry) });
        if (result.kind !== 'rename') throw new Error('invalid guest result');
        return { body: { ok: true } };
      }
      const script = 'import os,shutil,sys; s,d=sys.argv[1:]; os.makedirs(os.path.dirname(d),exist_ok=True)\nif os.path.islink(s): os.symlink(os.readlink(s),d)\nelif os.path.isdir(s): shutil.copytree(s,d,symlinks=True)\nelif os.path.isfile(s):\n with open(s,"rb") as src, open(d,"xb") as dst: shutil.copyfileobj(src,dst)\nelse: sys.exit("unsupported file type")';
      await execute('python3', ['-c', script, from, to]);
      return { body: { ok: true } };
    }
    if (mount === '/projects/:id/office-preview') {
      const path = guestPath(req.query.path);
      const stat = await files({ kind: 'stat', path });
      if (stat.kind !== 'stat') throw new Error('invalid guest result');
      stat.entry = await followEntry(stat.entry);
      if (stat.entry?.kind !== 'file' || fileKindOf(path) !== 'office') return { status: 415, body: { error: 'unsupported office file' } };
      if (stat.entry.size > MAX_OFFICE_BYTES) return { status: 413, body: { error: 'office file is too large to preview' } };
      if (activeConversions >= 2) return { status: 429, body: { error: 'office preview is busy' } };
      activeConversions++;
      const work = `/tmp/elowen-office-${randomUUID()}`;
      let created = false;
      try {
        await execute('mkdir', ['-m', '700', '--', work]);
        created = true;
        try {
          await execute('soffice', [`-env:UserInstallation=file://${work}/profile`, '--headless', '--convert-to', 'pdf', '--outdir', work, path]);
        } catch (error) {
          // The executor reports every non-zero exit as one generic failure, so a missing converter and
          // a genuine conversion error arrive identically. The current project image ships LibreOffice,
          // but an environment created from an earlier image keeps its root filesystem until it is
          // rebuilt, so the missing converter is still a real case and deserves a comprehensible answer
          // rather than "project command failed"; probe only now, so the working path never pays for it.
          const present = await execute('sh', ['-c', 'command -v soffice']).then(() => true, () => false);
          if (present) throw error;
          return { status: 501, body: { error: 'office preview is not available in this project environment: it has no office converter (soffice). Rebuild the environment from the current project image, or download the file to preview it locally.' } };
        }
        const output = `${work}/${posix.parse(path).name}.pdf`;
        const { bytes } = await readBytes(output, MAX_BUFFERED_BYTES);
        return { body: new Uint8Array(bytes), headers: { 'content-type': 'application/pdf', 'content-length': String(bytes.length), 'cache-control': 'no-store' } };
      } finally { activeConversions--; if (created) await execute('rm', ['-rf', '--', work]); }
    }
    if (mount === '/projects/:id/upload' && method === 'PUT') {
      const path = guestPath(req.query.path);
      // The same refusal every other mutating route carries. The guest would reject it too — a directory
      // has no content version to compare against — but it would arrive as a conflict or a generic
      // transport failure, which describes neither what was asked for nor why it is not allowed.
      if (path === base) throw new InputError('cannot replace the root directory');
      const offset = Number(req.query.offset ?? '0');
      if (!Number.isSafeInteger(offset) || offset < 0) throw new InputError('invalid offset');
      // The browser declares the file's total size on every chunk: the canonical `write-begin` needs
      // it up front, before the last chunk arrives.
      const size = Number(req.query.size);
      if (!Number.isSafeInteger(size) || size < 0) throw new InputError('upload size required');
      // What the editor hands back on download it will also accept, so the ceiling is the same one.
      if (size > MAX_BUFFERED_BYTES) throw new InputError('file too large');
      const bytes = await req.body();
      // A chunk larger than the split the browser agreed to means the two sides disagree about the
      // contract, not that this one file is big — answering 413 would send the client into a retry
      // loop at a size it will keep choosing.
      if (bytes.length > MAX_UPLOAD_CHUNK_BYTES) return { status: 400, body: { error: 'chunk too large' } };
      const final = req.query.final === '1';
      const overwrite = req.query.overwrite === '1';
      let sessions = managedUploadSessions.get(provider);
      if (!sessions) { sessions = new Map(); managedUploadSessions.set(provider, sessions); }
      const key = `${accountUserId}:${projectId}:${path}`;
      let session = sessions.get(key);
      if (session) {
        // One stream per session: the browser is strictly sequential, so parallel arrival on the same
        // destination is a broken client racing the offset accounting.
        if (session.busy) throw new InputError('upload already in progress', 409);
        if (size !== session.size || offset !== session.received + session.buffered.length) throw new InputError('upload out of order');
      } else {
        if (offset !== 0) throw new InputError('upload out of order');
        if (sessions.size >= MAX_MANAGED_UPLOADS) {
          const oldest = sessions.keys().next().value;
          if (oldest !== undefined) {
            const stale = sessions.get(oldest)!;
            sessions.delete(oldest);
            // Best-effort: an evicted handle can no longer be advanced by anyone, and the runtime's
            // own TTL reclaims any staging it leaves; failing this request for an unrelated cleanup
            // would be worse.
            void files({ kind: 'write-abort', path: stale.path, uploadId: stale.uploadId }).catch(() => undefined);
          }
        }
        session = { path, uploadId: '', chunkSize: GUEST_CHUNK_BYTES, size, received: 0, buffered: Buffer.alloc(0), busy: true };
        sessions.set(key, session);
      }
      session.busy = true;
      try {
        const written = await streamUploadChunk(session, bytes, final, overwrite);
        if (final) {
          sessions.delete(key);
          return { body: { ok: true, written } };
        }
        // Keep an active upload ahead of eviction instead of letting a concurrent burst push it out.
        sessions.delete(key);
        sessions.set(key, session);
        session.busy = false;
        return { body: { ok: true, written } };
      } catch (error) {
        sessions.delete(key);
        // The primary failure is what propagates; the abort only releases the guest staging and the
        // handle so a failed upload can never own the destination.
        const granted = session.uploadId;
        const aborted = await files({ kind: 'write-abort', path, uploadId: granted }).then(() => true, () => false);
        // A handle that was granted and could not be released still owns the destination and blocks
        // every later upload to it, so the request stopped being a clean client refusal. The provider
        // transport discards a failed `write-begin` itself, so an abort carrying the empty handle id of
        // an upload that was never granted leaks nothing and keeps the primary status.
        if (!aborted && granted) throw new Error(`upload failed and its guest staging could not be released: ${error instanceof Error ? error.message : String(error)}`);
        // A version conflict on an upload that was NOT an overwrite can only mean the destination is
        // already there: this request opened it against a fresh destination, so there was no version to
        // be stale. Derived from what this request asked for rather than from the provider's wording,
        // which is one fixed string for both halves of the conflict and is not the editor's to read.
        if (error instanceof InputError && error.status === 409 && !overwrite
          && error.message === 'content version conflict') throw new InputError('already exists');
        throw error;
      }
    }
    // Git belongs to the project checkout, and only to it. Under the system root the answer is that this
    // root has no repository, said once and plainly — running Git at `/` would either find nothing or,
    // worse, discover some unrelated `.git` above the file being asked about and report a history that
    // has nothing to do with it. Answering an empty diff would be indistinguishable from a clean file.
    //
    // Scoped to the Git mounts rather than placed above them, so a mount this transport simply does not
    // implement still answers "not supported" instead of an explanation about version history.
    if (GIT_MOUNTS.has(mount) && root !== 'project') throw new InputError('version history is available only in the project root', 409);
    const git = (...args: string[]) => execute('git', ['-C', base, ...args]);
    const relative = () => posix.relative(base, guestPath(req.query.path));
    if (mount === '/projects/:id/diff') return { body: { diff: await git('diff', '--no-ext-diff', '--no-textconv', '--', relative()) } };
    if (mount === '/projects/:id/head') return { body: { content: await git('show', `HEAD:${relative()}`) } };
    if (mount === '/projects/:id/changes') return { body: { diff: await git('diff', '--no-ext-diff', '--no-textconv', 'HEAD') } };
    if (mount === '/projects/:id/changed') {
      const status = await git('status', '--porcelain');
      return { body: { changed: status.split('\n').filter(Boolean).map(line => line.slice(3).trim()).map(path => path.includes(' -> ') ? path.slice(path.indexOf(' -> ') + 4) : path) } };
    }
    if (mount === '/projects/:id/commit/:hash' || mount === '/projects/:id/commit/:hash/diff') {
      const hash = req.params.hash ?? '';
      if (!/^[0-9a-f]{4,40}$/i.test(hash)) throw new InputError('invalid commit');
      if (mount.endsWith('/diff')) return { body: { diff: await git('show', '--no-ext-diff', '--no-textconv', '--pretty=format:', hash, '--', relative()) } };
      return { body: { diff: await git('show', '--no-ext-diff', '--no-textconv', '--stat', '--patch', hash), files: (await git('show', '--name-only', '--pretty=format:', hash)).split('\n').filter(Boolean) } };
    }
    if (mount === '/projects/:id/commits') {
      const parsed = Number(req.query.limit);
      const limit = Number.isFinite(parsed) ? Math.min(500, Math.max(1, Math.floor(parsed))) : 30;
      const output = await git('log', '-n', String(limit), '--numstat', '--pretty=format:\x01%h\x09%ct\x09%an\x09%s');
      return { body: { commits: parseProjectCommitLog(output) } };
    }
    return { status: 501, body: { error: 'this editor operation is not supported by the managed project transport' } };
  } catch (error) {
    // Do not return provider process diagnostics or internal storage paths to a browser client.
    const known = error instanceof InputError ? error : accessRefusal(error);
    return { status: known?.status ?? 503, body: { error: known?.message ?? 'project environment operation failed' } };
  }
}
