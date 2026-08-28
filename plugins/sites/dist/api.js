import { VISIBILITIES } from './store.js';
import { mayOpen, mintTicket, normalizeReturnPath } from './access.js';
import { siteBasePath, siteUrl } from './config.js';
const json = (status, body) => ({
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    body: body,
});
const TICKET_TTL_MS = 60_000;
/** Whether the caller may change this site. Viewing is a different question, answered by `mayOpen`. */
const canManage = (site, auth) => auth.admin || (auth.userId !== null && auth.userId === site.ownerUserId);
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
        basePath: siteBasePath(site.slug),
        projectId: site.projectId,
        projectSlug: deps.projectSlug(site.projectId),
        ownerUserId: site.ownerUserId,
        owner: deps.people().get(site.ownerUserId)
            ?? { id: site.ownerUserId, username: `#${site.ownerUserId}`, name: `#${site.ownerUserId}`, avatar: '' },
        createdAt: site.createdAt,
        createdModel: site.createdModel,
        lastPublishAt: site.lastPublishAt,
        lastPublishModel: site.lastPublishModel,
        spa: site.spa,
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
            dedicatedHost: config.siteHostBase !== null,
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
        const viewer = { userId: req.auth.userId, admin: req.auth.admin };
        if (!canManage(target, req.auth) && !mayOpen(target, viewer, deps.store, deps.access)) {
            return json(404, { error: 'not found' });
        }
        if (req.method === 'GET' && action === '') {
            const people = deps.people();
            const since = new Date(Date.now() - 29 * 86400_000).toISOString().slice(0, 10);
            return json(200, {
                site: toView(target, deps, req.auth),
                members: deps.store.memberIds(target.id).map((id) => people.get(id)
                    ?? { id, username: `#${id}`, name: `#${id}`, avatar: '' }),
                releases: deps.store.releases(target.id),
                hits: deps.store.hits(target.id, since),
                sourceDir: canManage(target, req.auth) ? target.sourceDir : null,
                // The command and the log are operational detail about a process, so they go only to somebody
                // who can act on them; a guest sees whether the site is up and nothing else.
                runtime: target.runtime !== 'command' ? null : {
                    running: deps.runtimeState(target.id).running,
                    startCommand: canManage(target, req.auth) ? target.startCommand : null,
                    logTail: canManage(target, req.auth) ? deps.runtimeState(target.id).logTail : null,
                    lastError: canManage(target, req.auth) ? target.lastError : null,
                },
            });
        }
        if (!canManage(target, req.auth))
            return json(403, { error: 'forbidden' });
        if (req.method === 'PATCH' && action === '')
            return patchSite(req, target);
        if (req.method === 'DELETE' && action === '') {
            await deps.deleteSiteFiles(target.id);
            deps.store.deleteSite(target.id);
            return json(200, { ok: true });
        }
        if (req.method === 'POST' && action === 'members')
            return addMember(req, target);
        if (req.method === 'DELETE' && action === 'members') {
            const userId = Number(segments[2]);
            if (!Number.isSafeInteger(userId))
                return json(400, { error: 'invalid account' });
            deps.store.removeMember(target.id, userId);
            deps.store.bumpAccessGeneration(target.id);
            return json(200, { ok: true });
        }
        if (req.method === 'POST' && action === 'restart') {
            if (target.runtime !== 'command')
                return json(400, { error: 'this site has no runtime' });
            try {
                await deps.restartRuntime(target);
            }
            catch (error) {
                return json(502, { error: error instanceof Error ? error.message : 'the runtime did not start' });
            }
            return json(200, { ok: true });
        }
        if (req.method === 'POST' && action === 'rollback') {
            const body = await req.json().catch(() => ({}));
            const releaseId = typeof body.releaseId === 'string' ? body.releaseId : '';
            const release = deps.store.release(target.id, releaseId);
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
        if (typeof body.title === 'string' && body.title.trim() !== '')
            patch.title = body.title.trim().slice(0, 120);
        if (typeof body.summary === 'string')
            patch.summary = body.summary.trim().slice(0, 400);
        if (typeof body.spa === 'boolean')
            patch.spa = body.spa;
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
        deps.store.updateSite(target.id, patch);
        if (accessChanged)
            deps.store.bumpAccessGeneration(target.id);
        const updated = deps.store.siteById(target.id);
        return json(200, { site: updated ? toView(updated, deps, req.auth) : null });
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
        const viewer = { userId: req.auth.userId, admin: req.auth.admin };
        if (!target || target.status !== 'live' || !mayOpen(target, viewer, deps.store, deps.access)) {
            // Deliberately the same answer for an unknown site and one this account may not open.
            return json(403, { error: 'no access' });
        }
        if (req.auth.userId === null)
            return json(403, { error: 'no access' });
        const config = deps.config();
        const minted = mintTicket();
        deps.store.putTicket(minted.tokenHash, {
            siteId: target.id,
            userId: req.auth.userId,
            returnPath: normalizeReturnPath(body.r),
            expiresAt: Date.now() + TICKET_TTL_MS,
        });
        return json(200, {
            token: minted.token,
            action: `${siteUrl(config, target.slug)}__elowen/session`,
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
    return { list, site, ticket, directory };
}
