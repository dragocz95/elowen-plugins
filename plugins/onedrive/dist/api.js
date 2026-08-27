import { Drive } from './drive.js';
import { buildIgnore, hashFile, normalizeSubpath, openMirrorFile } from './scan.js';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { readdir, rename, stat } from 'node:fs/promises';
import { remoteRootFor, trashFile } from './sync.js';
const json = (body, status = 200) => ({ status, body: body });
const bad = (error, status = 400) => ({ status, body: { error } });
/** `req.body` is a function returning the RAW bytes, and `req.json()` is the parser over it - a request
 *  object, not a parsed payload. Reading `req.body` as if it were the object silently yields nothing,
 *  which every route here then reports as a missing field. An empty or unparseable body is an empty
 *  object rather than a throw: the routes below already say which field they needed. */
async function bodyOf(req) {
    try {
        const parsed = await req.json();
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    }
    catch {
        return {};
    }
}
const projectIdOf = (value) => {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : 0;
};
export function registerApi(deps) {
    const { ctx, store } = deps;
    /** Every route re-checks BOTH halves of the question: the caller is who the session says, and that
     *  account may see this project. A hidden panel is presentation only — the routes are still reachable
     *  directly, so tenancy has to be decided here and not inferred from the UI having been rendered. */
    const guard = (req, projectId) => {
        const userId = req.auth.userId;
        if (!userId)
            return { ok: false, response: bad('sign-in required', 401) };
        if (!projectId)
            return { ok: false, response: bad('projectId is required') };
        const allowed = req.auth.accessibleProjects;
        const mayAccess = req.auth.admin || allowed === null || allowed === undefined || allowed.includes(projectId);
        // A project the caller cannot see reads as absent, not as forbidden: confirming that an id exists is
        // itself a disclosure when project ids are sequential.
        if (!mayAccess)
            return { ok: false, response: bad('not found', 404) };
        return { ok: true, value: userId };
    };
    const identityFor = (userId) => ctx.control('microsoftIdentity')?.identityFor(userId) ?? { linked: false };
    ctx.registerApiRoute({
        path: 'overview', method: 'GET', access: 'user',
        handler: async (req) => {
            const projectId = projectIdOf(req.query?.projectId);
            const gate = guard(req, projectId);
            if (!gate.ok)
                return gate.response;
            const links = store.linksForProject(gate.value, projectId);
            return json({
                identity: identityFor(gate.value),
                rootFolder: deps.settings().rootFolder,
                workspaces: deps.workspacesOf(gate.value, projectId).map((workspace) => ({
                    ...workspace,
                    connected: links.some((link) => link.workspaceId === workspace.workspaceId),
                })),
                links: links.map((link) => ({
                    id: link.id,
                    workspaceId: link.workspaceId,
                    workspaceLabel: link.workspaceLabel,
                    subpath: link.subpath,
                    remotePath: link.remotePath,
                    webUrl: link.webUrl,
                    enabled: link.enabled,
                    status: link.status,
                    error: link.error,
                    lastSyncAt: link.lastSyncAt,
                    fileCount: link.fileCount,
                    byteCount: link.byteCount,
                    conflictCount: link.conflictCount,
                    blockedDeletions: link.blockedDeletions,
                })),
            });
        },
    });
    ctx.registerApiRoute({
        path: 'folders', method: 'GET', access: 'user',
        handler: async (req) => {
            const projectId = projectIdOf(req.query?.projectId);
            const gate = guard(req, projectId);
            if (!gate.ok)
                return gate.response;
            const workspaceId = typeof req.query?.workspaceId === 'string' && req.query.workspaceId ? req.query.workspaceId : null;
            if (workspaceId && !deps.workspacesOf(gate.value, projectId).some((entry) => entry.workspaceId === workspaceId)) {
                return bad('that workspace is not yours or is no longer active', 404);
            }
            const rel = normalizeSubpath(req.query?.path);
            if (rel === null)
                return bad('that folder cannot be mirrored', 400);
            // Deliberately built from the SAME resolver the sync cycle uses. A browser that could reach a
            // directory the cycle would then refuse - or worse, one the cycle would accept and the browser
            // never showed - is how a picker starts lying about what it is offering.
            const probe = { userId: gate.value, projectId, workspaceId, subpath: '' };
            const base = deps.baseFor(probe);
            if (!base)
                return bad('not found', 404);
            const dir = deps.withinBase(base, rel);
            if (!dir)
                return bad('that folder cannot be mirrored', 400);
            const project = ctx.host.stores().projects.get(projectId);
            if (!project)
                return bad('not found', 404);
            const workspaceLabel = workspaceId
                ? deps.workspacesOf(gate.value, projectId).find((entry) => entry.workspaceId === workspaceId)?.label ?? null
                : null;
            // The UI must never do this arithmetic itself. A workspace mirror lands under
            // `workspaces/<slug>/<label> (<id>)`, which a browser-side template got wrong, and telling somebody
            // the wrong destination for their files is worse than telling them nothing.
            const remoteFor = (candidate) => remoteRootFor(deps.settings().rootFolder, project.slug, { workspaceId, workspaceLabel, subpath: candidate });
            const ignored = buildIgnore(deps.settings().extraIgnore);
            let entries;
            try {
                entries = await readdir(dir, { withFileTypes: true });
            }
            catch {
                return bad('that folder cannot be read', 404);
            }
            const folders = entries
                .filter((entry) => entry.isDirectory())
                .map((entry) => ({ name: entry.name, path: rel ? `${rel}/${entry.name}` : entry.name }))
                // The floor is not negotiable in the picker either: offering `.git` or `node_modules` as a
                // choice would let someone mirror by name exactly what the scan exists to keep out.
                .filter((entry) => normalizeSubpath(entry.path) !== null && !ignored(entry.path))
                .sort((left, right) => left.name.localeCompare(right.name))
                .slice(0, 500)
                .map((entry) => ({ ...entry, remotePath: remoteFor(entry.path) }));
            return json({ path: rel, remotePath: remoteFor(rel), folders });
        },
    });
    ctx.registerApiRoute({
        path: 'connect', method: 'POST', access: 'user',
        handler: async (req) => {
            const body = await bodyOf(req);
            const projectId = projectIdOf(body.projectId);
            const gate = guard(req, projectId);
            if (!gate.ok)
                return gate.response;
            const workspaceId = typeof body.workspaceId === 'string' && body.workspaceId ? body.workspaceId : null;
            const workspaces = deps.workspacesOf(gate.value, projectId);
            const workspace = workspaceId ? workspaces.find((entry) => entry.workspaceId === workspaceId) : null;
            if (workspaceId && !workspace)
                return bad('that workspace is not yours or is no longer active', 404);
            const subpath = normalizeSubpath(body.subpath);
            if (subpath === null)
                return bad('that folder cannot be mirrored', 400);
            const identity = ctx.control('microsoftIdentity');
            const graph = identity ? await identity.driveGraphFor(gate.value) : null;
            if (!graph)
                return bad('Your account is not connected to Microsoft.', 409);
            const project = ctx.host.stores().projects.get(projectId);
            if (!project)
                return bad('not found', 404);
            const draft = {
                userId: gate.value, projectId, workspaceId, subpath,
                workspaceLabel: workspace?.label ?? null,
                remoteDriveId: '', remoteItemId: '', remotePath: '', webUrl: null,
            };
            const remotePath = remoteRootFor(deps.settings().rootFolder, project.slug, draft);
            // Prove the chosen folder is really there and really inside the project before creating anything
            // in OneDrive; a mirror whose local side does not exist is a folder the person has to clean up.
            const base = deps.baseFor(draft);
            if (!base || !deps.withinBase(base, subpath))
                return bad('that folder cannot be mirrored', 400);
            const drive = await Drive.open(graph);
            const folder = await drive.ensureFolder(remotePath);
            const previous = store.linkFor(gate.value, projectId, workspaceId);
            const link = store.createLink({
                ...draft, remoteDriveId: drive.driveId, remoteItemId: folder.id, remotePath, webUrl: folder.webUrl,
            });
            // Reconnecting can land on a DIFFERENT folder - a renamed project, a drive that was rebound, a
            // folder the person deleted in OneDrive and we just recreated empty. The old baseline describes
            // files that folder never had, so comparing against it would read every local file as remotely
            // deleted and move the whole project into the trash. Start from no assumptions instead.
            // A changed SUBPATH is the same problem wearing different clothes: the baseline describes files of
            // a different local directory. Two distinct folders can even land on one remote item, because
            // `safeSegment` maps `a:b` and `a?b` to the same name - so the remote id matching proves nothing
            // about the local side.
            if (previous && (previous.remoteItemId !== folder.id
                || previous.remoteDriveId !== drive.driveId
                || previous.subpath !== subpath)) {
                store.clearItems(link.id);
            }
            // A fresh mirror should not wait for the next tick to show signs of life.
            void deps.engine.syncUser(gate.value).catch(() => undefined);
            return json({ id: link.id, remotePath: link.remotePath, webUrl: link.webUrl });
        },
    });
    const ownedLink = (req, body) => {
        const id = Number(body.id ?? req.query?.id);
        const link = Number.isSafeInteger(id) ? store.linkById(id) : null;
        if (!link)
            return { ok: false, response: bad('not found', 404) };
        const gate = guard(req, link.projectId);
        if (!gate.ok)
            return gate;
        // Ownership is a SEPARATE question from project access: two people can share a project, and neither
        // may touch the other's mirror, which points into their personal OneDrive.
        if (link.userId !== gate.value)
            return { ok: false, response: bad('not found', 404) };
        return { ok: true, value: link };
    };
    ctx.registerApiRoute({
        path: 'disconnect', method: 'POST', access: 'user',
        handler: async (req) => {
            const body = await bodyOf(req);
            const found = ownedLink(req, body);
            if (!found.ok)
                return found.response;
            store.removeLink(found.value.id);
            return json({ ok: true });
        },
    });
    ctx.registerApiRoute({
        path: 'pause', method: 'POST', access: 'user',
        handler: async (req) => {
            const body = await bodyOf(req);
            const found = ownedLink(req, body);
            if (!found.ok)
                return found.response;
            store.setEnabled(found.value.id, body.enabled === true);
            return json({ ok: true });
        },
    });
    ctx.registerApiRoute({
        path: 'sync-now', method: 'POST', access: 'user',
        handler: async (req) => {
            const body = await bodyOf(req);
            const found = ownedLink(req, body);
            if (!found.ok)
                return found.response;
            // The bulk-deletion refusal is a question put to the mirror's owner, and this is where they answer
            // it. Pressing Sync now after seeing that message is the confirmation - it is scoped to this one
            // mirror and this one run, so it cannot linger as a standing permission to delete.
            const confirm = body.confirmDeletions === true;
            // Scoped to the mirror whose button was pressed. Syncing every mirror the account owns would make a
            // per-row control quietly do something the row does not describe.
            await deps.engine.syncUser(found.value.userId, {
                only: new Set([found.value.id]),
                confirmDeletions: confirm ? new Set([found.value.id]) : undefined,
            });
            return json({ ok: true });
        },
    });
    ctx.registerApiRoute({
        path: 'conflicts', method: 'GET', access: 'user',
        handler: async (req) => {
            // A GET carries no body; the mirror id arrives in the query string.
            const found = ownedLink(req, {});
            if (!found.ok)
                return found.response;
            return json({
                conflicts: store.conflicts(found.value.id).map((item) => ({
                    rel: item.rel, conflictCopy: item.conflictCopy, updatedAt: item.updatedAt,
                })),
            });
        },
    });
    ctx.registerApiRoute({
        path: 'conflicts/resolve', method: 'POST', access: 'user',
        handler: async (req) => {
            const body = await bodyOf(req);
            const found = ownedLink(req, body);
            if (!found.ok)
                return found.response;
            const rel = typeof body.rel === 'string' ? body.rel : '';
            const keep = body.keep === 'remote' ? 'remote' : 'local';
            const item = store.conflicts(found.value.id).find((entry) => entry.rel === rel);
            if (!item)
                return bad('not found', 404);
            const root = deps.rootFor(found.value);
            if (!root)
                return bad('the mirrored folder is no longer available', 409);
            const identity = ctx.control('microsoftIdentity');
            const graph = identity ? await identity.driveGraphFor(found.value.userId) : null;
            if (!graph)
                return bad('Your account is not connected to Microsoft.', 409);
            const drive = await Drive.open(graph);
            // The same check the sync cycle makes. Without it, an account rebound to a different Microsoft
            // identity would have this route write straight into a stranger's drive at the same path.
            if (found.value.remoteDriveId && found.value.remoteDriveId !== drive.driveId) {
                return bad('This mirror belongs to a different Microsoft account. Connect it again.', 409);
            }
            // Has OneDrive moved on since the conflict was recorded? Resolving is a decision about two specific
            // versions, and if a third has appeared the person is answering a question that no longer exists.
            const currentTag = await drive.currentTag(item.remoteItemId);
            if (currentTag === null)
                return bad('The OneDrive copy no longer exists. Sync again and try once more.', 409);
            if (currentTag !== item.remoteEtag) {
                return bad('The OneDrive copy changed since this conflict was reported. Sync again and choose once more.', 409);
            }
            const absolute = join(root, rel);
            if (keep === 'remote') {
                // The copy kept beside the original IS the remote version, already downloaded and already
                // compared. Promoting it is a local move, not a second download that could differ again - and the
                // local version it supersedes goes to the trash rather than being overwritten out of existence.
                if (!item.conflictCopy || !existsSync(join(root, item.conflictCopy))) {
                    return bad('The kept OneDrive copy is missing from the project. Sync again and try once more.', 409);
                }
                if (existsSync(absolute))
                    await trashFile(root, rel);
                await rename(join(root, item.conflictCopy), absolute);
                const stats = await stat(absolute);
                store.putItem({
                    linkId: found.value.id, rel, localSize: stats.size, localMtimeMs: stats.mtimeMs,
                    localSha256: await hashFile(absolute), remoteItemId: item.remoteItemId,
                    remoteEtag: item.remoteEtag, state: 'synced', conflictCopy: null,
                });
                return json({ ok: true, kept: keep });
            }
            // Keeping the local version means overwriting OneDrive, so it is conditional on the exact version
            // this conflict was about; anything else and Graph refuses rather than destroying a third edit.
            if (!existsSync(absolute))
                return bad('The local file is gone. Sync again and try once more.', 409);
            let uploaded;
            try {
                const file = await openMirrorFile(absolute);
                try {
                    uploaded = await drive.upload(found.value.remoteItemId, rel, file, item.remoteEtag);
                }
                finally {
                    await file.handle.close();
                }
            }
            catch (error) {
                return bad(`The OneDrive copy could not be replaced: ${error instanceof Error ? error.message : String(error)}`, 409);
            }
            // The downloaded OneDrive version is no longer the answer, but it is still a version of somebody's
            // work, so it is filed away rather than deleted.
            if (item.conflictCopy && existsSync(join(root, item.conflictCopy)))
                await trashFile(root, item.conflictCopy);
            const stats = await stat(absolute);
            store.putItem({
                linkId: found.value.id, rel, localSize: stats.size, localMtimeMs: stats.mtimeMs,
                localSha256: await hashFile(absolute), remoteItemId: uploaded.id || item.remoteItemId,
                remoteEtag: uploaded.etag, state: 'synced', conflictCopy: null,
            });
            return json({ ok: true, kept: keep });
        },
    });
}
