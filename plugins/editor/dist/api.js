import { EditorFileError, copyProjectEntry, createProjectDir, createProjectFile, deleteProjectEntry, listProjectFiles, projectChangedFiles, projectCommitDiff, projectCommitFileDiff, projectCommitFiles, projectCommitLog, convertOfficeToPdf, OfficePreviewError, projectFileAtHead, projectFileDiff, projectFileSize, projectWorkingDiff, readProjectByteRange, readProjectBytes, readProjectFile, renameProjectEntry, safeSystemPath, uploadProjectChunk, writeProjectFile, } from './files.js';
import { baseName, mimeTypeOf, MAX_UPLOAD_CHUNK_BYTES } from './fileTypes.js';
import { SYSTEM_LIST_DEPTH, SYSTEM_PROJECT_ID, SYSTEM_ROOT } from './systemRoot.js';
function projectFor(ctx, req) {
    const id = Number(req.params.id);
    // The system root is an administrator capability and nothing else. Guessing the reserved id buys a
    // caller the same refusal as guessing a project they were never assigned — and it is checked BEFORE
    // the store lookup, because no project row backs it.
    if (id === SYSTEM_PROJECT_ID) {
        return req.auth.admin ? { path: SYSTEM_ROOT, system: true } : { status: 403, body: { error: 'forbidden' } };
    }
    if (!Number.isSafeInteger(id) || id <= 0)
        return { status: 404, body: { error: 'project not found' } };
    if (req.auth.accessibleProjects === null ? !req.auth.admin : !req.auth.accessibleProjects.includes(id))
        return { status: 403, body: { error: 'forbidden' } };
    const project = ctx.host.stores().projects.get(id);
    return project ? { path: project.path, system: false } : { status: 404, body: { error: 'project not found' } };
}
function isResponse(value) { return !('path' in value); }
async function body(req) {
    const value = await req.json().catch(() => null);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}
function requiredString(value) { return typeof value === 'string' && value.length > 0 ? value : null; }
/** Only the editor's own refusals reach the client. Anything else — an fs error above all — is flattened:
 *  its message carries the project's absolute path on the server, and it answers "does this path exist?"
 *  for a caller probing outside the tree. */
function fileError(error) {
    return { status: 400, body: { error: error instanceof EditorFileError ? error.message : 'invalid path' } };
}
function byteRange(value, size) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
    if (!match || (!match[1] && !match[2]) || size <= 0)
        return null;
    if (!match[1]) {
        const suffix = Number(match[2]);
        if (!Number.isSafeInteger(suffix) || suffix <= 0)
            return null;
        return { start: Math.max(0, size - suffix), end: size - 1 };
    }
    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start)
        return null;
    return { start, end: Math.min(end, size - 1) };
}
export function registerEditorApi(ctx) {
    const hostSafe = ctx.host.projectFiles().safe;
    /** Which path guard confines this request. The host's own cannot serve `/` — see `safeSystemPath` —
     *  and every route is handed the guard for the root it actually resolved, rather than one captured for
     *  the whole registration, so a system request and a project request are each confined by the rule
     *  that is correct for it. */
    const guardFor = (root) => (root.system ? safeSystemPath : hostSafe);
    const route = (rootMount, method, handler) => {
        ctx.registerApiRoute({ rootMount, path: '', method, access: 'user', handler: async (req) => {
                if (req.path !== '')
                    return { status: 404, body: { error: 'not found' } };
                const project = projectFor(ctx, req);
                return isResponse(project) ? project : handler(req, project, guardFor(project));
            } });
    };
    // `?path` lists ONE directory instead of the whole tree, confined by the same guard as every other
    // file operation. The system root is served that way and only that way: walking the server filesystem
    // eagerly is not a slow listing, it is an impossible one.
    route('/projects/:id/files', 'GET', (req, project, safe) => {
        const from = requiredString(req.query.path);
        try {
            return { body: listProjectFiles(project.path, project.system ? SYSTEM_LIST_DEPTH : undefined, from ? safe(project.path, from) : undefined) };
        }
        catch (error) {
            return fileError(error);
        }
    });
    route('/projects/:id/file', 'GET', (req, project, safe) => {
        const path = requiredString(req.query.path);
        if (!path)
            return { status: 400, body: { error: 'path required' } };
        try {
            return { body: readProjectFile(safe, project.path, path) };
        }
        catch (error) {
            return fileError(error);
        }
    });
    route('/projects/:id/file', 'PUT', async (req, project, safe) => {
        const input = await body(req);
        const path = requiredString(input?.path);
        const content = typeof input?.content === 'string' ? input.content : null;
        if (!path || content === null)
            return { status: 400, body: { error: 'path and content required' } };
        try {
            writeProjectFile(safe, project.path, path, content);
            return { body: { ok: true } };
        }
        catch (error) {
            return fileError(error);
        }
    });
    route('/projects/:id/upload', 'PUT', async (req, project, safe) => {
        const path = requiredString(req.query.path);
        if (!path)
            return { status: 400, body: { error: 'path required' } };
        const offset = Number(req.query.offset ?? '0');
        if (!Number.isSafeInteger(offset) || offset < 0)
            return { status: 400, body: { error: 'invalid offset' } };
        const bytes = await req.body();
        // A chunk larger than the split the browser agreed to means the two sides disagree about the
        // contract, not that this one file is big — answering 413 would send the client into a retry loop
        // at a size it will keep choosing.
        if (bytes.length > MAX_UPLOAD_CHUNK_BYTES)
            return { status: 400, body: { error: 'chunk too large' } };
        try {
            const result = uploadProjectChunk(safe, project.path, path, bytes, offset, req.query.final === '1', req.query.overwrite === '1');
            return { body: { ok: true, ...result } };
        }
        catch (error) {
            return fileError(error);
        }
    });
    route('/projects/:id/raw', 'GET', (req, project, safe) => {
        const path = requiredString(req.query.path);
        if (!path)
            return { status: 400, body: { error: 'path required' } };
        try {
            const size = projectFileSize(safe, project.path, path);
            if (size === null)
                return { status: 415, body: { error: 'not previewable' } };
            const commonHeaders = {
                'accept-ranges': 'bytes',
                'cache-control': 'no-store',
                'content-type': mimeTypeOf(path),
                ...(req.query.download === '1' ? { 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(baseName(path))}` } : {}),
            };
            const rangeHeader = req.headers.range;
            if (rangeHeader) {
                const range = byteRange(rangeHeader, size);
                if (!range)
                    return { status: 416, body: { error: 'invalid range' }, headers: { ...commonHeaders, 'content-range': `bytes */${size}` } };
                const chunk = readProjectByteRange(safe, project.path, path, range.start, range.end);
                if (!chunk)
                    return { status: 416, body: { error: 'invalid range' }, headers: { ...commonHeaders, 'content-range': `bytes */${size}` } };
                return {
                    status: 206,
                    body: new Uint8Array(chunk.bytes),
                    headers: {
                        ...commonHeaders,
                        'content-length': String(chunk.bytes.length),
                        'content-range': `bytes ${chunk.start}-${chunk.end}/${chunk.size}`,
                    },
                };
            }
            const bytes = readProjectBytes(safe, project.path, path);
            if (!bytes)
                return { status: 413, body: { error: 'file is too large to buffer' }, headers: commonHeaders };
            return { body: new Uint8Array(bytes), headers: { ...commonHeaders, 'content-length': String(bytes.length) } };
        }
        catch (error) {
            return fileError(error);
        }
    });
    route('/projects/:id/office-preview', 'GET', async (req, project, safe) => {
        const path = requiredString(req.query.path);
        if (!path)
            return { status: 400, body: { error: 'path required' } };
        try {
            const bytes = await convertOfficeToPdf(safe, project.path, path);
            return { body: new Uint8Array(bytes), headers: { 'content-type': 'application/pdf', 'content-length': String(bytes.length), 'cache-control': 'no-store' } };
        }
        catch (error) {
            if (error instanceof OfficePreviewError)
                return { status: error.status, body: { error: error.message } };
            return fileError(error);
        }
    });
    const onePath = (rootMount, operation, field) => route(rootMount, 'GET', async (req, project, safe) => {
        const path = requiredString(req.query.path);
        if (!path)
            return { status: 400, body: { error: 'path required' } };
        try {
            return { body: { [field]: await operation(safe, project.path, path) } };
        }
        catch (error) {
            return fileError(error);
        }
    });
    route('/projects/:id/new-file', 'POST', async (req, project, safe) => { const input = await body(req); const path = requiredString(input?.path); if (!path)
        return { status: 400, body: { error: 'path required' } }; try {
        createProjectFile(safe, project.path, path);
        return { body: { ok: true } };
    }
    catch (error) {
        return fileError(error);
    } });
    route('/projects/:id/dir', 'POST', async (req, project, safe) => { const input = await body(req); const path = requiredString(input?.path); if (!path)
        return { status: 400, body: { error: 'path required' } }; try {
        createProjectDir(safe, project.path, path);
        return { body: { ok: true } };
    }
    catch (error) {
        return fileError(error);
    } });
    for (const [mount, operation] of [['/projects/:id/rename', renameProjectEntry], ['/projects/:id/copy', copyProjectEntry]])
        route(mount, 'POST', async (req, project, safe) => { const input = await body(req); const from = requiredString(input?.from); const to = requiredString(input?.to); if (!from || !to)
            return { status: 400, body: { error: 'from and to required' } }; try {
            operation(safe, project.path, from, to);
            return { body: { ok: true } };
        }
        catch (error) {
            return fileError(error);
        } });
    route('/projects/:id/entry', 'DELETE', (req, project, safe) => { const path = requiredString(req.query.path); if (!path)
        return { status: 400, body: { error: 'path required' } }; try {
        deleteProjectEntry(safe, project.path, path);
        return { body: { ok: true } };
    }
    catch (error) {
        return fileError(error);
    } });
    onePath('/projects/:id/diff', projectFileDiff, 'diff');
    onePath('/projects/:id/head', projectFileAtHead, 'content');
    route('/projects/:id/commit/:hash', 'GET', async (req, project) => ({ body: { diff: await projectCommitDiff(project.path, req.params.hash ?? ''), files: await projectCommitFiles(project.path, req.params.hash ?? '') } }));
    route('/projects/:id/commit/:hash/diff', 'GET', async (req, project, safe) => { const path = requiredString(req.query.path); if (!path)
        return { status: 400, body: { error: 'path required' } }; try {
        return { body: { diff: await projectCommitFileDiff(safe, project.path, req.params.hash ?? '', path) } };
    }
    catch (error) {
        return fileError(error);
    } });
    // `?limit` is clamped to [1,500] with a fallback of 30 — the contract the core route had. Clamping
    // rather than rejecting keeps a nonsense value (0, -5, 0.5) returning the newest commit instead of
    // silently falling back to a full page of them.
    route('/projects/:id/commits', 'GET', async (req, project) => { const parsed = Number(req.query.limit); const limit = Number.isFinite(parsed) ? Math.min(500, Math.max(1, Math.floor(parsed))) : 30; return { body: { commits: await projectCommitLog(project.path, limit) } }; });
    route('/projects/:id/changed', 'GET', async (_req, project) => ({ body: { changed: await projectChangedFiles(project.path) } }));
    route('/projects/:id/changes', 'GET', async (_req, project) => ({ body: { diff: await projectWorkingDiff(project.path) } }));
}
