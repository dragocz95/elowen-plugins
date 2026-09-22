import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { asSitesContext, asUserViews } from './coreSeams.js';
import { SitesStore } from './store.js';
import { resolveConfig } from './config.js';
import { SiteCertificateService } from './certificate.js';
import { createSiteHandler } from './serve.js';
import { createApiHandlers } from './api.js';
import { registerTools } from './tools.js';
import { SiteGatewayManager } from './gateway.js';
import { deleteSiteResources } from './deletion.js';
import { ProjectPreviewService } from './preview.js';
import { SitePreviewImageService } from './previewImage.js';
import { ProjectPublicationService } from './publication.js';
import { SiteAddressService } from './address.js';
import { SiteHostnameCoordinator } from './hostnameCoordinator.js';
const SESSION_SECRET_KEY = 'sessionSigningKey';
const HIT_FLUSH_MS = 60_000;
const GATEWAY_RECONCILE_MS = 12 * 3600_000;
const GATEWAY_RECOVERY_MS = 60_000;
const ISSUE_SWEEP_MS = 30_000;
const isDaemonProcess = () => typeof process.send !== 'function';
export function register(published) {
    const ctx = asSitesContext(published);
    const gateway = new SiteGatewayManager(ctx);
    const store = new SitesStore(ctx.db(), { hostnameBase: gateway.hostnameBase() });
    store.migrateSourceReferences((projectId) => {
        const project = ctx.host.stores().projects.get(projectId);
        if (!project)
            return null;
        return project.path || project.adoptedPath || (project.executionKind === 'managed' ? `/${project.slug}` : null);
    });
    const dataDir = ctx.dataDir();
    const siteDir = (siteId) => join(dataDir, 'sites', siteId);
    const releaseDir = (siteId, releaseId) => join(siteDir(siteId), 'releases', releaseId);
    let cachedSecret = null;
    const mintSessionSecret = () => {
        const existing = ctx.instanceSecrets().get(SESSION_SECRET_KEY);
        if (existing)
            return existing.value;
        const minted = randomBytes(32).toString('base64url');
        try {
            ctx.instanceSecrets().set(SESSION_SECRET_KEY, minted);
            return minted;
        }
        catch {
            return ctx.instanceSecrets().get(SESSION_SECRET_KEY)?.value ?? minted;
        }
    };
    const sessionSecret = () => {
        if (cachedSecret === null)
            cachedSecret = mintSessionSecret();
        return cachedSecret;
    };
    const config = () => resolveConfig(ctx.config, ctx.publicWebUrl(), gateway.hostnameBase());
    const addresses = new SiteAddressService({
        store,
        scheme: () => config().siteScheme,
        hostnameBase: () => config().siteHostBase,
        previews: () => store.allPreviews(),
        previewActive: (projectId) => {
            const project = ctx.host.stores().projects.get(projectId);
            return project?.executionKind === 'managed' && project.lifecycle === 'active';
        },
    });
    const issueGeneratedBinding = async (slug) => {
        const site = store.siteBySlug(slug);
        if (!site)
            throw new Error(`Site ${slug} does not exist`);
        const binding = addresses.bindings().find((entry) => entry.siteId === site.id && entry.class === 'generated');
        if (!binding)
            throw new Error(`Site ${slug} has no generated binding`);
        const bindings = addresses.bindings();
        const synced = await gateway.reconcile(bindings);
        if (!synced.available || !synced.active)
            throw new Error(synced.detail ?? 'The Sites gateway is unavailable');
        await gateway.ensureBinding(binding, bindings);
    };
    const certificates = new SiteCertificateService({
        canIssue: () => gateway.hasBroker(),
        issue: issueGeneratedBinding,
        mayAttempt: (slug) => {
            const site = store.siteBySlug(slug);
            const retry = site ? store.generatedHostname(site.id)?.certificateRetryAt : null;
            return retry === null || retry === undefined || Date.parse(retry) <= Date.now();
        },
        issuedSlugs: () => gateway.hasBroker()
            ? store.allSites()
                .filter((site) => {
                const generated = store.generatedHostname(site.id);
                return generated !== null && gateway.hasCertificate(generated.hostname);
            })
                .map((site) => site.slug)
            : null,
        store,
    });
    const certificateHost = (site) => addresses.generatedHostname(site)?.hostname ?? null;
    const hostnameCoordinator = new SiteHostnameCoordinator({ store, gateway, addresses, logger: ctx.logger });
    const access = {
        accountExists: (userId) => ctx.host.stores().usersRead.list().some((user) => user.id === userId),
        isAdmin: (userId) => ctx.host.stores().usersRead.isAdmin(userId),
        canAccessProject: (userId, projectId) => ctx.host.stores().userProjects.canAccess(userId, projectId),
        allowPublicSites: () => config().allowPublicSites,
    };
    const people = () => new Map(asUserViews(ctx.host.stores().usersRead.list()).map((user) => [user.id, {
            id: user.id, username: user.username, name: user.name || user.username, avatar: user.avatar,
        }]));
    const projectSlug = (projectId) => ctx.host.stores().projects.get(projectId)?.slug ?? null;
    const sourceDisplayPath = (site) => {
        const project = ctx.host.stores().projects.get(site.projectId);
        if (!project)
            return site.sourceRel;
        return project.executionKind === 'managed'
            ? `/${project.slug}/${site.sourceRel}`
            : join(project.path, ...site.sourceRel.split('/'));
    };
    const proxyLimits = () => ({
        maxResponseBytes: config().maxProxyResponseBytes,
        requestTimeoutSeconds: config().proxyRequestTimeoutSeconds,
    });
    const pendingHits = new Map();
    const deletingSiteIds = new Set();
    const flushHits = () => {
        if (pendingHits.size === 0)
            return;
        const day = new Date().toISOString().slice(0, 10);
        const batch = [...pendingHits.entries()];
        pendingHits.clear();
        try {
            store.transaction(() => {
                for (const [siteId, count] of batch)
                    store.recordHits(siteId, day, count);
            });
        }
        catch (error) {
            ctx.logger.warn(`could not record visits: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    const previews = new ProjectPreviewService({
        store,
        access,
        project: id => ctx.host.stores().projects.get(id),
        control: () => ctx.control('sandbox'),
        config,
        addresses,
        gateway,
        proxyLimits,
        usernameOf: id => people().get(id)?.username ?? null,
    });
    const publications = new ProjectPublicationService({
        store,
        control: () => ctx.control('sandbox'),
        project: id => ctx.host.stores().projects.get(id),
        siteHost: (slug) => {
            const site = store.siteBySlug(slug);
            return site ? addresses.effectiveHostname(site) : null;
        },
        logger: ctx.logger,
    });
    /** The picture of each published page, for the register. It renders through the site's own published
     *  hostname, so it needs nothing from the Project transport itself: what the gateway serves through that
     *  transport is exactly what a visitor gets. */
    const previewImages = new SitePreviewImageService({
        store,
        siteDir,
        project: id => ctx.host.stores().projects.get(id),
        captureControl: () => ctx.control('browserCapture'),
        addresses,
        logger: ctx.logger,
    });
    const deleteSite = async (siteId) => {
        const site = store.siteForCleanup(siteId);
        if (!site)
            return;
        if (site.status !== 'deleting')
            store.beginDelete(siteId);
        pendingHits.delete(siteId);
        deletingSiteIds.add(siteId);
        try {
            await deleteSiteResources(siteId, {
                store,
                siteDir,
                hasGatewayBroker: () => gateway.hasBroker(),
                releasePublication: (target) => publications.release(target),
                removeHostnames: async () => { await hostnameCoordinator.cleanupRemoved(); },
            });
            deletingSiteIds.delete(siteId);
        }
        catch (error) {
            ctx.logger.warn(`site ${site.slug} deletion will be retried: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    };
    const cleanupDeletingSites = async () => {
        if (!isDaemonProcess())
            return;
        for (const site of store.deletingSites()) {
            try {
                await deleteSite(site.id);
            }
            catch { /* durable marker retains retry ownership */ }
        }
    };
    const cleanupOrphans = async () => {
        if (!isDaemonProcess())
            return;
        const stores = ctx.host.stores();
        const users = new Set(stores.usersRead.list().map((user) => user.id));
        const projects = new Set(stores.projects.list().map((project) => project.id));
        for (const preview of store.allPreviews())
            if (!projects.has(preview.projectId))
                await previews.removeProject(preview.projectId);
        for (const site of store.allSites()) {
            if (users.has(site.ownerUserId)) {
                if (!projects.has(site.projectId))
                    ctx.logger.warn(`site ${site.slug} references a removed Project; its published resources are preserved`);
                continue;
            }
            try {
                await deleteSite(site.id);
            }
            catch { /* keep sweeping independent sites */ }
        }
        for (const userId of store.memberUserIds()) {
            if (users.has(userId))
                continue;
            for (const siteId of store.forgetMemberEverywhere(userId))
                store.bumpAccessGeneration(siteId);
        }
    };
    const activateRelease = (site, releaseId) => {
        store.updateSite(site.id, { currentReleaseId: releaseId, status: 'live', lastError: null });
    };
    ctx.registerHttpRoute({
        path: 's',
        handler: createSiteHandler({
            store,
            access,
            secret: sessionSecret,
            config: () => ({
                appBaseUrl: config().appBaseUrl,
                sessionTtlHours: config().sessionTtlHours,
                gatewayToken: gateway.gatewayToken(),
            }),
            addresses,
            releaseDir,
            countHit: (siteId) => {
                if (!deletingSiteIds.has(siteId))
                    pendingHits.set(siteId, (pendingHits.get(siteId) ?? 0) + 1);
            },
            endpointFor: (siteId) => publications.endpointFor(siteId),
            previews,
            proxyLimits,
            usernameOf: (userId) => people().get(userId)?.username ?? null,
        }),
    });
    const handlers = createApiHandlers({
        previewSite: slug => previews.siteBySlug(slug),
        store,
        access,
        config,
        addresses,
        previewImages,
        people,
        projectSlug,
        sourceDisplayPath,
        deleteSite,
        activateRelease,
        gatewayReadiness: () => gateway.readiness(),
        gatewayRecord: () => gateway.requiredRecord(),
    });
    ctx.registerApiRoute({ path: 'preview', method: 'POST', access: 'user', handler: async (req) => {
            if (req.auth.userId === null)
                return { status: 403, body: { error: 'a linked account is required' } };
            const input = await req.json();
            try {
                return { status: 200, body: await previews.request(Number(input.projectId), Number(input.port), req.auth.userId) };
            }
            catch (error) {
                return { status: 409, body: { error: error instanceof Error ? error.message : 'preview unavailable' } };
            }
        } });
    ctx.registerApiRoute({ path: 'sites', method: 'GET', access: 'user', handler: handlers.list });
    ctx.registerApiRoute({ path: 'site', access: 'user', handler: handlers.site });
    ctx.registerApiRoute({ path: 'ticket', method: 'POST', access: 'user', handler: handlers.ticket });
    ctx.registerApiRoute({ path: 'directory', method: 'GET', access: 'user', handler: handlers.directory });
    ctx.registerApiRoute({ path: 'gateway/readiness', method: 'GET', access: 'user', handler: handlers.gatewayReadiness });
    registerTools({
        ctx, store, access, config, addresses, deleteSite, activateRelease,
        publications, people, previews, previewImages,
        certificates: {
            publish: (site) => certificates.publish(site, certificateHost(site)),
            readiness: (site) => certificates.readiness(site, certificateHost(site)),
        },
    });
    ctx.registerReadinessCheck(() => gateway.readiness());
    const syncGateway = async (renew = false) => {
        const status = await gateway.reconcile(addresses.bindings());
        if (!status.active)
            return;
        await hostnameCoordinator.sweep({ renew });
        await previews.syncGateway(renew);
        await hostnameCoordinator.cleanupRemoved();
    };
    if (isDaemonProcess()) {
        ctx.registerService({ name: 'site-gateway', start: async () => { await syncGateway(); }, stop: () => { } });
        ctx.registerService({
            name: 'site-publications',
            start: async () => { await publications.reconcile(); },
            stop: () => { },
        });
    }
    ctx.registerUserRemoved(async (userId) => {
        for (const siteId of store.siteIdsOwnedBy(userId))
            await deleteSite(siteId);
        for (const siteId of store.forgetMemberEverywhere(userId))
            store.bumpAccessGeneration(siteId);
    });
    ctx.registerProjectRemoved(async (projectId) => {
        await previews.removeProject(projectId);
        if (store.siteIdsInProject(projectId).length)
            throw new Error('published Sites must be explicitly transferred or deleted before removing their Project');
    });
    ctx.registerBootReconcile(async () => {
        store.pruneTickets(Date.now());
        store.pruneCaptureGrants(Date.now());
        await cleanupOrphans();
        await cleanupDeletingSites();
    });
    ctx.registerInterval('cleanup-deleting-sites', cleanupDeletingSites, 5_000);
    ctx.registerInterval('reconcile-site-publications', async () => {
        await publications.reconcile();
    }, 2_000);
    ctx.registerInterval('issue-site-certificates', async () => {
        if (!gateway.isActive())
            return;
        await hostnameCoordinator.sweep();
        await hostnameCoordinator.cleanupRemoved();
    }, ISSUE_SWEEP_MS);
    ctx.registerInterval('renew-site-gateway', async () => { await syncGateway(true); }, GATEWAY_RECONCILE_MS);
    ctx.registerInterval('recover-site-gateway', async () => {
        if (!gateway.isActive())
            await syncGateway();
    }, GATEWAY_RECOVERY_MS);
    ctx.registerInterval('flush-visits', () => {
        flushHits();
        store.pruneTickets(Date.now());
        // A grant that was never spent is dead within a minute anyway; sweeping it here keeps the table from
        // holding tokens for captures that never reached the site.
        store.pruneCaptureGrants(Date.now());
    }, HIT_FLUSH_MS);
    ctx.logger.info('sites plugin registered');
}
