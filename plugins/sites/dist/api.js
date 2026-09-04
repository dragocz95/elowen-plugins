import { VISIBILITIES } from './store.js';
import { mayOpen, mintTicket, normalizeReturnPath } from './access.js';
import { environmentLimitOverrides, SITE_BASE_PATH, siteUrl } from './config.js';
import { ProvisionInProgressError } from './provisioning.js';
const json = (status, body) => ({
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    body: body,
});
const TICKET_TTL_MS = 60_000;
/** Whether the caller may change this site. Viewing is a different question, answered by `mayOpen`. */
const canManage = (site, auth) => auth.admin || (auth.userId !== null && auth.userId === site.ownerUserId);
const canAccessProject = (projectId, auth) => auth.admin || (auth.accessibleProjects !== null && auth.accessibleProjects.includes(projectId));
const toView = (site, deps, auth) => {
    const config = deps.config();
    return {
        id: site.id,
        slug: site.slug,
        title: site.title,
        summary: site.summary,
        visibility: site.visibility,
        status: site.status,
        url: siteUrl(config, site.slug),
        basePath: SITE_BASE_PATH,
        projectId: site.projectId,
        projectSlug: deps.projectSlug(site.projectId),
        ownerUserId: site.ownerUserId,
        currentReleaseId: site.currentReleaseId,
        owner: deps.people().get(site.ownerUserId)
            ?? { id: site.ownerUserId, username: `#${site.ownerUserId}`, name: `#${site.ownerUserId}`, avatar: '' },
        createdAt: site.createdAt,
        createdModel: site.createdModel,
        lastPublishAt: site.lastPublishAt,
        lastPublishModel: site.lastPublishModel,
        spa: site.spa,
        runtime: site.runtime,
        canManage: canManage(site, auth),
    };
};
/** Sites the caller may see listed.
 *
 *  Membership and Project visibility are listed; a site that is merely visible to every signed-in account
 *  is not, because listing those would turn one person's dashboard into everybody's menu. It stays
 *  reachable by its address, which is what that setting means. */
function visibleSites(deps, auth) {
    const userId = auth.userId;
    if (userId === null)
        return { mine: [], shared: [] };
    const mine = deps.store.sitesOwnedBy(userId);
    const mineIds = new Set(mine.map((site) => site.id));
    const shared = new Map();
    for (const site of deps.store.sitesSharedWith(userId)) {
        if (!mineIds.has(site.id))
            shared.set(site.id, site);
    }
    const projectIds = auth.accessibleProjects;
    const projectScoped = projectIds === null
        ? (auth.admin ? deps.store.allSites() : [])
        : deps.store.sitesInProjects(projectIds);
    for (const site of projectScoped) {
        if (mineIds.has(site.id) || shared.has(site.id))
            continue;
        if (site.visibility === 'project' || auth.admin)
            shared.set(site.id, site);
    }
    return { mine, shared: [...shared.values()] };
}
export function createApiHandlers(deps) {
    /** GET /plugins/sites/api/sites */
    const list = async (req) => {
        const config = deps.config();
        const { mine, shared } = visibleSites(deps, req.auth);
        return json(200, {
            mine: mine.map((site) => toView(site, deps, req.auth)),
            shared: shared.map((site) => toView(site, deps, req.auth)),
            allowPublicSites: config.allowPublicSites,
        });
    };
    /** GET|PATCH|DELETE /plugins/sites/api/site/<id>[/…] */
    const site = async (req) => {
        const segments = req.path.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
        const siteId = segments[0] ?? '';
        const action = segments[1] ?? '';
        const target = deps.store.siteById(siteId);
        if (!target)
            return json(404, { error: 'not found' });
        const viewer = { userId: req.auth.userId };
        if (!canManage(target, req.auth) && !mayOpen(target, viewer, deps.store, deps.access)) {
            return json(404, { error: 'not found' });
        }
        if (req.method === 'GET' && action === '') {
            const people = deps.people();
            const since = new Date(Date.now() - 29 * 86400_000).toISOString().slice(0, 10);
            const environment = target.runtime === 'environment' ? await deps.environmentState(target) : null;
            return json(200, {
                site: toView(target, deps, req.auth),
                // Only somebody who can EDIT the guest list may read it. A guest seeing the whole list learns
                // who else the owner shared with, which is the owner's business and not part of opening a page.
                members: !canManage(target, req.auth) ? [] : deps.store.memberIds(target.id).map((id) => people.get(id)
                    ?? { id, username: `#${id}`, name: `#${id}`, avatar: '' }),
                releases: deps.store.releases(target.id).map((release) => ({
                    id: release.id,
                    siteId: release.siteId,
                    createdAt: release.createdAt,
                    model: release.model,
                    fileCount: release.fileCount,
                    sizeBytes: release.sizeBytes,
                    note: release.note,
                    kind: release.kind,
                    ...(release.kind === 'environment-snapshot' ? { includesData: Boolean(release.dataArchive) } : {}),
                })),
                hits: deps.store.hits(target.id, since),
                sourceDir: canManage(target, req.auth) ? target.sourceDir : null,
                // The command and the log are operational detail about a process, so they go only to somebody
                // who can act on them; a guest sees whether the site is up and nothing else.
                runtime: target.runtime !== 'command' ? null : {
                    running: deps.runtimeState(target.id).running,
                    startCommand: canManage(target, req.auth) ? target.startCommand : null,
                    bind: canManage(target, req.auth) ? target.bind : null,
                    port: canManage(target, req.auth) ? target.port : null,
                    network: canManage(target, req.auth) ? deps.config().runtimeNetwork : null,
                    allowLoopbackPorts: canManage(target, req.auth) ? deps.config().allowLoopbackPorts : false,
                    logTail: canManage(target, req.auth) ? deps.runtimeState(target.id).logTail : null,
                    lastError: canManage(target, req.auth) ? target.lastError : null,
                },
                environment: environment === null ? null : canManage(target, req.auth)
                    ? {
                        ...environment,
                        action: deps.store.environmentAction(target.id),
                        limitOverrides: {
                            cpus: target.environmentCpus ?? null,
                            memoryMb: target.environmentMemoryMb ?? null,
                            pidsLimit: target.environmentPidsLimit ?? null,
                            diskSoftMb: target.environmentDiskSoftMb ?? null,
                        },
                        canControl: canAccessProject(target.projectId, req.auth),
                        canReadLogs: canAccessProject(target.projectId, req.auth),
                        canSetLimits: req.auth.admin && canAccessProject(target.projectId, req.auth),
                        transport: { buffered: true, requestBodyLimitBytes: 1024 * 1024 },
                    }
                    : { state: environment.state, desiredState: environment.desiredState },
            });
        }
        if (!canManage(target, req.auth))
            return json(403, { error: 'forbidden' });
        if (req.method === 'GET' && action === 'logs') {
            if (target.runtime !== 'environment')
                return json(400, { error: 'this site is not an environment' });
            if (!canAccessProject(target.projectId, req.auth))
                return json(403, { error: 'project access is required' });
            const requested = Number(req.query.lines ?? 200);
            const lines = Number.isFinite(requested) ? Math.min(1000, Math.max(1, Math.round(requested))) : 200;
            const logs = await deps.environmentLogs(target, lines);
            return json(200, { ...logs, lines });
        }
        if (req.method === 'PATCH' && action === '')
            return patchSite(req, target);
        if (req.method === 'DELETE' && action === '') {
            await deps.deleteSite(target.id);
            return json(200, { ok: true });
        }
        if (req.method === 'POST' && action === 'members') {
            if (segments[2] === 'replace')
                return replaceMembers(req, target);
            return addMember(req, target);
        }
        if (req.method === 'DELETE' && action === 'members') {
            const userId = Number(segments[2]);
            if (!Number.isSafeInteger(userId))
                return json(400, { error: 'invalid account' });
            deps.store.removeMember(target.id, userId);
            deps.store.bumpAccessGeneration(target.id);
            return json(200, { ok: true });
        }
        if (req.method === 'POST' && action === 'control') {
            if (target.runtime !== 'environment')
                return json(400, { error: 'this site is not an environment' });
            if (!canAccessProject(target.projectId, req.auth))
                return json(403, { error: 'project access is required' });
            const body = await req.json().catch(() => ({}));
            if (body.action !== 'start' && body.action !== 'stop' && body.action !== 'restart') {
                return json(400, { error: 'unknown environment action' });
            }
            try {
                await deps.requestEnvironmentControl(target, body.action);
            }
            catch (error) {
                return json(409, { error: error instanceof Error ? error.message : 'action could not be scheduled' });
            }
            return json(200, { ok: true, scheduled: true, action: body.action });
        }
        if (req.method === 'POST' && action === 'snapshot') {
            if (target.runtime !== 'environment')
                return json(400, { error: 'this site is not an environment' });
            if (!canAccessProject(target.projectId, req.auth))
                return json(403, { error: 'project access is required' });
            const body = await req.json()
                .catch(() => ({}));
            try {
                const snapshot = await deps.snapshotEnvironment(target, {
                    includeData: body.includeData !== false,
                    note: typeof body.note === 'string' ? body.note.trim().slice(0, 200) : '',
                });
                return json(200, { ok: true, snapshotId: snapshot.id, crashConsistent: true, scheduled: true });
            }
            catch (error) {
                return json(409, { error: error instanceof Error ? error.message : 'snapshot could not be scheduled' });
            }
        }
        if (req.method === 'POST' && action === 'restart') {
            if (target.runtime !== 'command')
                return json(400, { error: 'this site has no command runtime' });
            try {
                await deps.restartRuntime(target);
            }
            catch (error) {
                return json(502, { error: error instanceof Error ? error.message : 'the runtime did not start' });
            }
            return json(200, { ok: true });
        }
        if (req.method === 'POST' && action === 'rollback') {
            const body = await req.json()
                .catch(() => ({}));
            const releaseId = typeof body.releaseId === 'string' ? body.releaseId : '';
            const release = deps.store.release(target.id, releaseId);
            if (target.runtime === 'environment') {
                if (!canAccessProject(target.projectId, req.auth))
                    return json(403, { error: 'project access is required' });
                if (!release || release.kind !== 'environment-snapshot' || !release.imageRef) {
                    return json(404, { error: 'unknown environment snapshot' });
                }
                if (body.restoreData === true && !release.dataArchive)
                    return json(400, { error: 'snapshot has no data archive' });
                try {
                    await deps.rollbackEnvironment(target, { releaseId, restoreData: body.restoreData === true });
                }
                catch (error) {
                    return json(409, { error: error instanceof Error ? error.message : 'rollback could not be scheduled' });
                }
                return json(200, { ok: true, scheduled: true, snapshotId: releaseId });
            }
            if (!release)
                return json(404, { error: 'unknown release' });
            deps.activateRelease(target, release.id);
            return json(200, { ok: true });
        }
        return json(405, { error: 'method not allowed' });
    };
    const patchSite = async (req, target) => {
        const body = await req.json().catch(() => ({}));
        const patch = {};
        let accessChanged = false;
        let runtimeChanged = false;
        const limitKeys = ['environmentCpus', 'environmentMemoryMb', 'environmentPidsLimit', 'environmentDiskSoftMb'];
        const hasLimitOverrides = limitKeys.some((key) => key in body);
        let limits = null;
        if (hasLimitOverrides) {
            if (!req.auth.admin)
                return json(403, { error: 'environment limit overrides require an administrator' });
            if (target.runtime !== 'environment')
                return json(400, { error: 'only an environment has resource limits' });
            if (!canAccessProject(target.projectId, req.auth))
                return json(403, { error: 'project access is required' });
            try {
                limits = environmentLimitOverrides(body);
            }
            catch (error) {
                return json(400, { error: error instanceof Error ? error.message : 'invalid environment limits' });
            }
        }
        if (typeof body.title === 'string' && body.title.trim() !== '')
            patch.title = body.title.trim().slice(0, 120);
        if (typeof body.summary === 'string')
            patch.summary = body.summary.trim().slice(0, 400);
        if (typeof body.spa === 'boolean')
            patch.spa = body.spa;
        if (body.startCommand !== undefined || body.bind !== undefined) {
            if (target.runtime !== 'command')
                return json(400, { error: 'only a command site has runtime settings' });
            if (body.startCommand !== undefined) {
                if (typeof body.startCommand !== 'string' || body.startCommand.trim() === '') {
                    return json(400, { error: 'a command site needs a non-empty startCommand' });
                }
                patch.startCommand = body.startCommand.trim().slice(0, 500);
                runtimeChanged = patch.startCommand !== target.startCommand;
            }
            if (body.bind !== undefined) {
                if (body.bind !== 'socket' && body.bind !== 'port')
                    return json(400, { error: 'unknown runtime bind mode' });
                const runtimeConfig = deps.config();
                if (body.bind === 'port' && !runtimeConfig.allowLoopbackPorts) {
                    return json(403, { error: 'loopback ports are turned off for this instance' });
                }
                const currentPortValid = target.port !== null
                    && target.port >= runtimeConfig.loopbackPortMin
                    && target.port <= runtimeConfig.loopbackPortMax;
                patch.bind = body.bind;
                patch.port = body.bind === 'port' ? (currentPortValid ? target.port : await deps.allocatePort()) : null;
                runtimeChanged = runtimeChanged || body.bind !== target.bind || patch.port !== target.port;
            }
        }
        if (typeof body.visibility === 'string') {
            if (!VISIBILITIES.includes(body.visibility)) {
                return json(400, { error: 'unknown visibility' });
            }
            const next = body.visibility;
            if (next === 'public' && !deps.config().allowPublicSites) {
                return json(403, { error: 'public sites are turned off for this instance' });
            }
            if (next !== target.visibility) {
                patch.visibility = next;
                accessChanged = true;
            }
        }
        if (limits) {
            try {
                await deps.applyEnvironmentLimits(target, limits);
            }
            catch (error) {
                return json(502, { error: error instanceof Error ? error.message : 'Podman could not apply the limits' });
            }
        }
        deps.store.updateSite(target.id, patch);
        if (accessChanged)
            deps.store.bumpAccessGeneration(target.id);
        const updated = deps.store.siteById(target.id);
        if (runtimeChanged && updated?.currentReleaseId) {
            try {
                await deps.restartRuntime(updated);
            }
            catch (error) {
                deps.store.updateSite(target.id, { status: 'failed', lastError: error instanceof Error ? error.message : String(error) });
                return json(502, { error: error instanceof Error ? error.message : 'the runtime did not start' });
            }
        }
        const current = deps.store.siteById(target.id);
        return json(200, { site: current ? toView(current, deps, req.auth) : null });
    };
    const addMember = async (req, target) => {
        const body = await req.json().catch(() => ({}));
        const userId = Number(body.userId);
        if (!Number.isSafeInteger(userId) || !deps.access.accountExists(userId)) {
            return json(400, { error: 'unknown account' });
        }
        deps.store.addMember(target.id, userId);
        deps.store.bumpAccessGeneration(target.id);
        return json(200, { ok: true });
    };
    const replaceMembers = async (req, target) => {
        const body = await req.json().catch(() => ({}));
        if (!Array.isArray(body.userIds))
            return json(400, { error: 'userIds must be an array' });
        const userIds = [...new Set(body.userIds.map(Number))];
        if (userIds.some((userId) => !Number.isSafeInteger(userId) || !deps.access.accountExists(userId))) {
            return json(400, { error: 'unknown account' });
        }
        deps.store.replaceMembers(target.id, userIds);
        return json(200, { ok: true, members: deps.store.memberIds(target.id) });
    };
    /** POST /plugins/sites/api/ticket — the app half of the sign-in handshake.
     *
     *  This is the ONE place a visitor's right to open a site is established, because it is the only place
     *  the daemon has already authenticated them. The ticket that comes back proves nothing beyond "this
     *  account asked"; the public side re-checks the decision before it admits anyone. */
    const ticket = async (req) => {
        if (req.method !== 'POST')
            return json(405, { error: 'method not allowed' });
        const body = await req.json().catch(() => ({}));
        const slug = typeof body.slug === 'string' ? body.slug : '';
        const target = deps.store.siteBySlug(slug);
        const viewer = { userId: req.auth.userId };
        if (!target || target.status !== 'live' || !mayOpen(target, viewer, deps.store, deps.access)) {
            // Deliberately the same answer for an unknown site and one this account may not open.
            return json(403, { error: 'no access' });
        }
        if (req.auth.userId === null)
            return json(403, { error: 'no access' });
        const address = siteUrl(deps.config(), target.slug);
        // No address means no gateway, and a ticket is only useful as a form post TO that address. Minting
        // one anyway would burn a single-use token against a form the page could not submit.
        if (address === null)
            return json(503, { error: 'published sites are not available on this instance' });
        const minted = mintTicket();
        deps.store.putTicket(minted.tokenHash, {
            siteId: target.id,
            userId: req.auth.userId,
            returnPath: normalizeReturnPath(body.r),
            expiresAt: Date.now() + TICKET_TTL_MS,
        });
        return json(200, {
            token: minted.token,
            action: `${address}__elowen/session`,
            title: target.title,
        });
    };
    /** GET /plugins/sites/api/directory — accounts that can be added as guests.
     *
     *  Core keeps its own account directory admin-only, so this returns the narrowest thing that makes the
     *  guest picker work — who someone is and what they look like, nothing else — and only to someone who
     *  actually owns a site to share. It is not a general account listing for every signed-in user. */
    const directory = async (req) => {
        const userId = req.auth.userId;
        if (userId === null)
            return json(403, { error: 'forbidden' });
        if (!req.auth.admin && deps.store.countOwnedBy(userId) === 0)
            return json(403, { error: 'forbidden' });
        const accounts = [...deps.people().values()].sort((a, b) => a.name.localeCompare(b.name));
        return json(200, { accounts });
    };
    const gatewayReadiness = async (req) => {
        if (req.auth.userId === null)
            return json(403, { error: 'forbidden' });
        const readiness = await deps.gatewayReadiness();
        return json(200, {
            ready: readiness.ok,
            status: readiness.status,
            detail: readiness.detail,
            expectedRecord: deps.gatewayRecord(),
            observedTargets: readiness.observedTargets ?? [],
        });
    };
    const environmentsReadiness = async (req) => {
        if (req.auth.userId === null)
            return json(403, { error: 'forbidden' });
        const status = await deps.provisioning.status();
        if (req.auth.admin)
            return json(200, { ...status, canProvision: true });
        return json(200, {
            ready: status.ready,
            canProvision: false,
            items: status.items.map((item) => ({
                id: item.id,
                label: item.label,
                ok: item.ok,
                ...(item.ok ? {} : { detail: 'An administrator must complete this dependency.' }),
            })),
        });
    };
    const environmentsProvision = async (req) => {
        if (!req.auth.admin)
            return json(403, { error: 'forbidden' });
        if (req.method !== 'POST')
            return json(405, { error: 'method not allowed' });
        try {
            const status = await deps.provisioning.provision(req.auth.userId);
            return json(status.ready ? 200 : 503, { ...status, canProvision: true });
        }
        catch (error) {
            if (error instanceof ProvisionInProgressError)
                return json(409, { error: error.message });
            return json(502, { error: error instanceof Error ? error.message : 'environment provisioning failed' });
        }
    };
    return { list, site, ticket, directory, gatewayReadiness, environmentsReadiness, environmentsProvision };
}
