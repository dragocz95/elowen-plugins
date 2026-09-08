import { posix } from 'node:path';
import { randomUUID } from 'node:crypto';
import { editorExecute } from './execution.js';
import { parseProjectCommitLog } from './files.js';
import type { PluginApiRequest, PluginContext, PluginHttpResponse } from 'elowen/dist/plugins/api.js';
import type { GuestFileOperation, GuestFileResult, GuestFileStat } from 'elowen/dist/plugins/environmentTypes.js';
import { MAX_BUFFERED_BYTES, MAX_OFFICE_BYTES, baseName, mimeTypeOf, fileKindOf } from './fileTypes.js';

const TEXT_LIMIT = 2 * 1024 * 1024;
const RANGE_LIMIT = 8 * 1024 * 1024;
const IGNORE = new Set(['.git', 'node_modules', '.next', 'dist', '.turbo', 'coverage', '.cache']);
class InputError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
let activeConversions = 0;

/** Editor paths remain workspace-relative. The provider resolves symlinks inside the guest. */
function guestPath(value: unknown): string {
  if (typeof value !== 'string' || !value || value.includes('\0') || value.includes('\\')) throw new InputError('path required');
  const path = posix.resolve('/workspace', value);
  if (path !== '/workspace' && !path.startsWith('/workspace/')) throw new InputError('invalid path');
  return path;
}

export async function managedEditorRequest(ctx: PluginContext, req: PluginApiRequest, projectId: number, mount: string, method: string): Promise<PluginHttpResponse> {
  const accountUserId = req.auth.userId;
  if (!accountUserId) return { status: 403, body: { error: 'a linked account is required' } };
  const provider = ctx.control('sandbox');
  if (!provider) return { status: 503, body: { error: 'project environment unavailable' } };
  const project = { kind: 'managed' as const, projectId };
  const execute = (file: string, args: string[]) => editorExecute(ctx, projectId, accountUserId, { type: 'argv', file, args });
  // Resolve the live provider for every operation, including multi-request listings and mutations.
  const files = async (operation: GuestFileOperation): Promise<GuestFileResult> => {
    const live = ctx.control('sandbox');
    if (!live) throw new Error('project environment unavailable');
    return live.projectFiles({ project, accountUserId, operation });
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
  const followEntry = async (entry: GuestFileStat | null): Promise<GuestFileStat | null> => {
    if (entry?.kind !== 'symlink') return entry;
    const target: unknown = JSON.parse(await execute('python3', ['-c', 'import json,os,sys; print(json.dumps(os.path.realpath(sys.argv[1])))', entry.path]));
    if (typeof target !== 'string' || !target.startsWith('/') || target.includes('\0')) throw new Error('invalid guest symlink target');
    const result = await files({ kind: 'stat', path: target });
    if (result.kind !== 'stat') throw new Error('invalid guest result');
    return result.entry ? { ...result.entry, path: entry.path } : null;
  };
  const input = async (): Promise<Record<string, unknown>> => {
    const value = await req.json<unknown>();
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InputError('invalid request');
    return value as Record<string, unknown>;
  };
  try {
    if (mount === '/projects/:id/files') {
      const start = req.query.path ? guestPath(req.query.path) : '/workspace';
      const nodes: { path: string; type: 'file' | 'dir'; size?: number }[] = [];
      const visit = async (path: string, depth: number): Promise<void> => {
        const result = await files({ kind: 'list', path, limit: 1000 });
        if (result.kind !== 'list') throw new Error('invalid guest result');
        if (result.truncated || nodes.length + result.entries.length > 10000) throw new InputError('directory listing is too large; select a subdirectory');
        for (const original of result.entries) {
          const entry = await followEntry(original);
          if (!entry) continue;
          const clean = guestPath(entry.path);
          if (posix.dirname(clean) !== path) throw new Error('invalid guest entry');
          if (IGNORE.has(posix.basename(clean)) || clean.endsWith('.elowen-upload')) continue;
          if (entry.kind === 'directory') {
            nodes.push({ path: posix.relative('/workspace', clean), type: 'dir' });
            if (!req.query.path && depth < 8) await visit(clean, depth + 1);
          } else if (entry.kind === 'file') nodes.push({ path: posix.relative('/workspace', clean), type: 'file', size: entry.size });
        }
      };
      await visit(start, 0);
      return { body: nodes };
    }
    if (mount === '/projects/:id/file' && method === 'GET') {
      const result = await readBytes(guestPath(req.query.path), TEXT_LIMIT, 0, undefined, true);
      return { body: { content: result.bytes.toString('utf8'), truncated: result.truncated, version: result.version } };
    }
    if (mount === '/projects/:id/file' && method === 'PUT') {
      const value = await input();
      const path = guestPath(value.path);
      if (path === '/workspace') throw new InputError('unsupported file type');
      if (typeof value.content !== 'string') throw new InputError('content required');
      if (Buffer.byteLength(value.content) > TEXT_LIMIT) throw new InputError('file too large');
      // Managed writes never silently overwrite a version that another project member edited.
      if (typeof value.version !== 'string' && value.version !== null) return { status: 409, body: { error: 'read the file before saving; content version required' } };
      if (value.version === null) await execute('mkdir', ['-p', '--', posix.dirname(path)]);
      const result = await files({ kind: 'write', path, base64: Buffer.from(value.content).toString('base64'), expectedVersion: value.version });
      if (result.kind !== 'write') throw new Error('invalid guest result');
      return { body: { ok: true, version: result.entry.version } };
    }
    if (mount === '/projects/:id/new-file' || mount === '/projects/:id/dir') {
      const value = await input();
      const path = guestPath(value.path);
      if (path === '/workspace') throw new InputError('cannot replace project root');
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
      if (path === '/workspace') throw new InputError('cannot delete project root');
      const source = await files({ kind: 'stat', path });
      if (source.kind !== 'stat' || !source.entry) throw new InputError('source does not exist');
      if (source.entry.kind === 'other') throw new InputError('unsupported file type');
      if (source.entry.kind === 'directory') await execute('python3', ['-c', 'import shutil,sys; shutil.rmtree(sys.argv[1])', path]);
      else {
        const result = await files({ kind: 'remove', path, expectedVersion: source.entry.version });
        if (result.kind !== 'remove' || !result.removed) throw new Error('guest removal was not completed');
      }
      return { body: { ok: true } };
    }
    if (mount === '/projects/:id/rename' || mount === '/projects/:id/copy') {
      const value = await input();
      const from = guestPath(value.from);
      const to = guestPath(value.to);
      if (from === '/workspace' || to === '/workspace' || to.startsWith(from + '/')) throw new InputError('invalid destination');
      if (mount.endsWith('/rename')) {
        const source = await files({ kind: 'stat', path: from });
        if (source.kind !== 'stat' || !source.entry) throw new InputError('source does not exist');
        await execute('mkdir', ['-p', '--', posix.dirname(to)]);
        const result = await files({ kind: 'rename', path: from, destination: to, expectedVersion: source.entry.version });
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
        await execute('soffice', [`-env:UserInstallation=file://${work}/profile`, '--headless', '--convert-to', 'pdf', '--outdir', work, path]);
        const output = `${work}/${posix.parse(path).name}.pdf`;
        const { bytes } = await readBytes(output, MAX_BUFFERED_BYTES);
        return { body: new Uint8Array(bytes), headers: { 'content-type': 'application/pdf', 'content-length': String(bytes.length), 'cache-control': 'no-store' } };
      } finally { activeConversions--; if (created) await execute('rm', ['-rf', '--', work]); }
    }
    const git = (...args: string[]) => execute('git', ['-C', '/workspace', ...args]);
    const relative = () => posix.relative('/workspace', guestPath(req.query.path));
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
    return { status: error instanceof InputError ? error.status : 503, body: { error: error instanceof InputError ? error.message : 'project environment operation failed' } };
  }
}
