import { VISIBILITIES } from './store.js';
import { canManage, mayOpen, mintTicket, normalizeReturnPath } from './access.js';
import { SITE_BASE_PATH } from './config.js';
import { SiteDomainError } from './domains.js';
const json = (status, body) => ({
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    body: body,
});
const TICKET_TTL_MS = 60_000;
const toView = (site, deps, auth) => {
    return {
        id: site.id,
        slug: site.slug,
        title: site.title,
        summary: site.summary,
        visibility: site.visibility,
        status: site.status,
        degraded: site.status === 'live' && site.lastError !== null,
        url: deps.addresses.urlForSite(site),
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
        kind: site.kind,
        target: site.target,
        preview: deps.previewImages?.view(site.id) ?? { state: 'none', version: 0, capturedAt: null, width: null, height: null },
        canManage: canManage(site, auth.userId, deps.access),
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
        // The register is what asks for pictures: a Site nobody has looked at in a TTL window is pictured when
        // somebody looks again, and one an account only has shared with it is pictured by its own manager.
        // Nobody is told about it here, because opening a register is not the place for a refusal.
        deps.previewImages?.ensureFresh(req.auth.admin ? [...mine, ...shared] : mine);
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
        const manages = canManage(target, req.auth.userId, deps.access);
        if (!manages && !mayOpen(target, viewer, deps.store, deps.access)) {
            return json(404, { error: 'not found' });
        }
        if (req.method === 'GET' && action === '') {
            const people = deps.people();
            const since = new Date(Date.now() - 29 * 86400_000).toISOString().slice(0, 10);
            if (manages)
                deps.previewImages?.ensureFresh([target]);
            return json(200, {
                site: toView(target, deps, req.auth),
                // Only somebody who can EDIT the guest list may read it. A guest seeing the whole list learns
                // who else the owner shared with, which is the owner's business and not part of opening a page.
                members: !manages ? [] : deps.store.memberIds(target.id).map((id) => people.get(id)
                    ?? { id, username: `#${id}`, name: `#${id}`, avatar: '' }),
                releases: target.kind === 'static'
                    ? deps.store.releases(target.id).filter((release) => release.kind !== 'environment-snapshot').map((release) => ({
                        id: release.id, siteId: release.siteId, createdAt: release.createdAt, model: release.model,
                        fileCount: release.fileCount, sizeBytes: release.sizeBytes, note: release.note, kind: 'files',
                    }))
                    : [],
                hits: deps.store.hits(target.id, since),
                sourceDir: manages && target.kind === 'static'
                    ? deps.sourceDisplayPath?.(target) ?? target.sourceRel
                    : null,
                // The stored publication failure is detail for somebody who may repair it. It stays out of the
                // list response and away from guests, while the derived degraded flag remains safe to list.
                lastError: manages ? target.lastError : null,
                // Why there is no picture, or why the last one could not be taken. Manager-only for the same
                // reason: it names what this instance did on the owner's Project.
                previewNotice: manages ? deps.previewImages?.notice(target) ?? null : null,
            });
        }
        // The picture of the published page. Whoever may OPEN the page may see this, and nobody else: it is
        // the page itself, rendered, so it carries exactly the access rule the page already has.
        if (req.method === 'GET' && action === 'preview')
            return previewImage(target);
        if (!manages)
            return json(403, { error: 'forbidden' });
        if (req.method === 'POST' && action === 'preview' && segments[2] === 'refresh')
            return refreshPreview(target);
        if (action === 'domains') {
            const domainId = segments[2] ?? '';
            const domainAction = segments[3] ?? '';
            try {
                if (req.method === 'GET' && domainId === '')
                    return json(200, await deps.domains.list(target));
                if (req.method === 'POST' && domainId === '') {
                    const body = await req.json().catch(() => ({}));
                    return json(201, { domain: await deps.domains.add(target, body.hostname) });
                }
                if (req.method === 'POST' && domainId && domainAction === 'check') {
                    return json(200, { domain: await deps.domains.check(target, domainId) });
                }
                if (req.method === 'POST' && domainId && domainAction === 'primary') {
                    return json(200, { domain: await deps.domains.makePrimary(target, domainId) });
                }
                if (req.method === 'DELETE' && domainId && domainAction === '') {
                    const removed = await deps.domains.remove(target, domainId);
                    return json(removed.removed ? 200 : 202, removed);
                }
                return json(405, { error: 'method not allowed' });
            }
            catch (error) {
                if (error instanceof SiteDomainError) {
                    return json(error.status, { error: { code: error.code, params: error.params } });
                }
                throw error;
            }
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
        if (req.method === 'POST' && action === 'rollback') {
            if (target.kind === 'proxy')
                return json(409, { error: 'a proxy publication has no file releases' });
            const body = await req.json().catch(() => ({}));
            const releaseId = typeof body.releaseId === 'string' ? body.releaseId : '';
            const release = deps.store.release(target.id, releaseId);
            if (!release || release.kind === 'environment-snapshot')
                return json(404, { error: 'unknown release' });
            deps.activateRelease(target, release.id);
            return json(200, { ok: true });
        }
        return json(405, { error: 'method not allowed' });
    };
    /** GET /plugins/sites/api/site/<id>/preview — the one stored picture of this Site's page.
     *
     *  Immutable and long-lived on purpose: the query carries the version the metadata row is at, so a new
     *  picture arrives under a new address and the browser never has to revalidate a card it already holds.
     *  A client that asks without a version still gets the current picture. */
    const previewImage = (target) => {
        const image = deps.previewImages?.read(target.id);
        if (!image)
            return json(404, { error: 'there is no picture of this page' });
        return {
            status: 200,
            headers: {
                'content-type': image.mime,
                'content-length': String(image.bytes.byteLength),
                'cache-control': 'private, max-age=31536000, immutable',
                'x-content-type-options': 'nosniff',
                'x-robots-tag': 'noindex',
                etag: `"preview-${image.version}"`,
            },
            body: image.bytes,
        };
    };
    /** POST /plugins/sites/api/site/<id>/preview/refresh — take a new picture now.
     *
     *  Accepted rather than completed: a capture is a browser, and the answer says the request is queued.
     *  The rate limit is the service's, so a person pressing the button twice is answered with the first
     *  request instead of starting a second browser. */
    const refreshPreview = (target) => {
        const images = deps.previewImages;
        if (!images)
            return json(503, { error: 'this instance cannot take a picture of a page' });
        const outcome = images.request(target.id, 'manual');
        if (outcome.ok)
            return json(202, { queued: true });
        if (outcome.retryAfterMs !== undefined) {
            return {
                status: 429,
                headers: {
                    'content-type': 'application/json; charset=utf-8',
                    'cache-control': 'no-store',
                    'retry-after': String(Math.ceil(outcome.retryAfterMs / 1000)),
                },
                body: { error: outcome.reason },
            };
        }
        return json(409, { error: outcome.reason });
    };
    const patchSite = async (req, target) => {
        const body = await req.json().catch(() => ({}));
        const patch = {};
        let accessChanged = false;
        if (typeof body.title === 'string' && body.title.trim() !== '')
            patch.title = body.title.trim().slice(0, 120);
        if (typeof body.summary === 'string')
            patch.summary = body.summary.trim().slice(0, 400);
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
        const body = await req.json()
            .catch(() => ({}));
        const bindingId = typeof body.binding === 'string' ? body.binding : '';
        const binding = deps.addresses.bindingById(deps.store.hostnameById(bindingId)?.siteId
            ?? (bindingId.startsWith('preview:') ? bindingId.slice('preview:'.length) : ''), bindingId);
        const target = binding
            ? deps.store.siteById(binding.siteId) ?? deps.previewSite?.(binding.slug)
            : null;
        const viewer = { userId: req.auth.userId };
        if (!binding || !target || target.status !== 'live' || !mayOpen(target, viewer, deps.store, deps.access)) {
            // Deliberately the same answer for an unknown site and one this account may not open.
            return json(403, { error: 'no access' });
        }
        if (req.auth.userId === null)
            return json(403, { error: 'no access' });
        const address = deps.addresses.urlForHostname(binding.hostname);
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
    return { list, site, ticket, directory, gatewayReadiness };
}
