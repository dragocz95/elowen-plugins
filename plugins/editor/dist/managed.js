import { posix } from 'node:path';
import { MAX_BUFFERED_BYTES, baseName, mimeTypeOf } from './fileTypes.js';
const TEXT_LIMIT = 2 * 1024 * 1024;
const RANGE_LIMIT = 8 * 1024 * 1024;
const IGNORE = new Set(['.git', 'node_modules', '.next', 'dist', '.turbo', 'coverage', '.cache']);
class InputError extends Error {
}
/** Editor paths remain workspace-relative. The provider resolves symlinks inside the guest. */
function guestPath(value) {
    if (typeof value !== 'string' || !value || value.includes('\0') || value.includes('\\'))
        throw new InputError('path required');
    const path = posix.resolve('/workspace', value);
    if (path !== '/workspace' && !path.startsWith('/workspace/'))
        throw new InputError('invalid path');
    return path;
}
export async function managedEditorRequest(ctx, req, projectId, mount, method) {
    const accountUserId = req.auth.userId;
    if (!accountUserId)
        return { status: 403, body: { error: 'a linked account is required' } };
    const provider = ctx.control('sandbox');
    if (!provider)
        return { status: 503, body: { error: 'project environment unavailable' } };
    const project = { kind: 'managed', projectId };
    // Resolve the live provider for every operation, including multi-request listings and mutations.
    const files = async (operation) => {
        const live = ctx.control('sandbox');
        if (!live)
            throw new Error('project environment unavailable');
        return live.projectFiles({ project, accountUserId, operation });
    };
    const input = async () => {
        const value = await req.json();
        if (!value || typeof value !== 'object' || Array.isArray(value))
            throw new InputError('invalid request');
        return value;
    };
    try {
        if (mount === '/projects/:id/files') {
            const start = req.query.path ? guestPath(req.query.path) : '/workspace';
            const nodes = [];
            const visit = async (path, depth) => {
                const result = await files({ kind: 'list', path, limit: 1000 });
                if (result.kind !== 'list')
                    throw new Error('invalid guest result');
                if (result.truncated || nodes.length + result.entries.length > 10000)
                    throw new InputError('directory listing is too large; select a subdirectory');
                for (const entry of result.entries) {
                    const clean = guestPath(entry.path);
                    if (posix.dirname(clean) !== path)
                        throw new Error('invalid guest entry');
                    if (IGNORE.has(posix.basename(clean)) || clean.endsWith('.elowen-upload'))
                        continue;
                    if (entry.kind === 'directory') {
                        nodes.push({ path: posix.relative('/workspace', clean), type: 'dir' });
                        if (!req.query.path && depth < 8)
                            await visit(clean, depth + 1);
                    }
                    else if (entry.kind === 'file')
                        nodes.push({ path: posix.relative('/workspace', clean), type: 'file', size: entry.size });
                }
            };
            await visit(start, 0);
            return { body: nodes };
        }
        if (mount === '/projects/:id/file' && method === 'GET') {
            const result = await files({ kind: 'read', path: guestPath(req.query.path), maxBytes: TEXT_LIMIT });
            if (result.kind !== 'read')
                throw new Error('invalid guest result');
            return { body: { content: Buffer.from(result.base64, 'base64').toString('utf8'), truncated: result.totalBytes > TEXT_LIMIT, version: result.version } };
        }
        if (mount === '/projects/:id/file' && method === 'PUT') {
            const value = await input();
            const path = guestPath(value.path);
            if (typeof value.content !== 'string')
                throw new InputError('content required');
            if (Buffer.byteLength(value.content) > TEXT_LIMIT)
                throw new InputError('file too large');
            // Managed writes never silently overwrite a version that another project member edited.
            if (typeof value.version !== 'string' && value.version !== null)
                return { status: 409, body: { error: 'read the file before saving; content version required' } };
            const result = await files({ kind: 'write', path, base64: Buffer.from(value.content).toString('base64'), expectedVersion: value.version });
            if (result.kind !== 'write')
                throw new Error('invalid guest result');
            return { body: { ok: true, version: result.entry.version } };
        }
        if (mount === '/projects/:id/new-file' || mount === '/projects/:id/dir') {
            const value = await input();
            const path = guestPath(value.path);
            if (path === '/workspace')
                throw new InputError('cannot replace project root');
            const operation = mount.endsWith('/dir') ? { kind: 'mkdir', path } : { kind: 'write', path, base64: '', expectedVersion: null };
            const result = await files(operation);
            if (result.kind !== 'write' && result.kind !== 'mkdir')
                throw new Error('invalid guest result');
            return { body: { ok: true } };
        }
        if (mount === '/projects/:id/raw') {
            const path = guestPath(req.query.path);
            const stat = await files({ kind: 'stat', path });
            if (stat.kind !== 'stat')
                throw new Error('invalid guest result');
            if (stat.entry?.kind !== 'file')
                return { status: 415, body: { error: 'not previewable' } };
            const size = stat.entry.size;
            const headers = { 'accept-ranges': 'bytes', 'cache-control': 'no-store', 'content-type': mimeTypeOf(path), ...(req.query.download === '1' ? { 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(baseName(path))}` } : {}) };
            let offset = 0;
            let length = size;
            if (req.headers.range) {
                const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range.trim());
                if (!match || (!match[1] && !match[2]))
                    return { status: 416, body: { error: 'invalid range' } };
                offset = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
                const end = match[1] && match[2] ? Number(match[2]) : size - 1;
                if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset < 0 || offset >= size || end < offset || (!match[1] && Number(match[2]) <= 0))
                    return { status: 416, body: { error: 'invalid range' }, headers: { ...headers, 'content-range': `bytes */${size}` } };
                length = Math.min(end - offset + 1, size - offset, RANGE_LIMIT);
            }
            else if (size > MAX_BUFFERED_BYTES)
                return { status: 413, body: { error: 'file is too large to buffer' } };
            const result = await files({ kind: 'read', path, maxBytes: req.headers.range ? RANGE_LIMIT : MAX_BUFFERED_BYTES, offset, length });
            if (result.kind !== 'read')
                throw new Error('invalid guest result');
            if (result.version !== stat.entry.version)
                return { status: 409, body: { error: 'file changed during download' } };
            const bytes = Buffer.from(result.base64, 'base64');
            if (bytes.length !== length)
                throw new Error('incomplete guest read');
            return { status: req.headers.range ? 206 : 200, body: new Uint8Array(bytes), headers: { ...headers, 'content-length': String(bytes.length), ...(req.headers.range ? { 'content-range': `bytes ${offset}-${offset + bytes.length - 1}/${size}` } : {}) } };
        }
        return { status: 501, body: { error: 'this editor operation is not supported by the managed project transport' } };
    }
    catch (error) {
        // Do not return provider process diagnostics or internal storage paths to a browser client.
        return { status: error instanceof InputError ? 400 : 503, body: { error: error instanceof InputError ? error.message : 'project environment operation failed' } };
    }
}
