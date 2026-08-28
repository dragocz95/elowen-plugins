import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { SitesStore } from './store.js';
import { resolveConfig } from './config.js';
import { createSiteHandler } from './serve.js';
import { createApiHandlers } from './api.js';
import { registerTools } from './tools.js';
const SECRET_KEY = 'sessionSigningKey';
const HIT_FLUSH_MS = 60_000;
export function register(ctx) {
    const store = new SitesStore(ctx.db());
    const dataDir = ctx.dataDir();
    const siteDir = (siteId) => join(dataDir, 'sites', siteId);
    const releaseDir = (siteId, releaseId) => join(siteDir(siteId), 'releases', releaseId);
    /** The key that signs site sessions. Kept in the encrypted bag rather than in settings: it is a
     *  credential, and rotating it simply invalidates every outstanding site session, which is a safe
     *  failure. Minted on first use and held for the life of this plugin generation — reading the vault
     *  during registration would stop the plugin loading anywhere the vault is absent. */
    let cachedSecret = null;
    const sessionSecret = () => {
        if (cachedSecret !== null)
            return cachedSecret;
        cachedSecret = mintSessionSecret();
        return cachedSecret;
    };
    const mintSessionSecret = () => {
        const existing = ctx.instanceSecrets().get(SECRET_KEY);
        if (existing)
            return existing.value;
        const minted = randomBytes(32).toString('base64url');
        try {
            ctx.instanceSecrets().set(SECRET_KEY, minted);
            return minted;
        }
        catch {
            // Another worker minted it first; theirs is the one that counts.
            return ctx.instanceSecrets().get(SECRET_KEY)?.value ?? minted;
        }
    };
    const config = () => resolveConfig(ctx.config, ctx.publicWebUrl());
    /** The live account and project facts every access decision reads. Resolved per call, never captured:
     *  a Project taken away or an account deleted has to change the answer immediately. */
    const access = {
        accountExists: (userId) => ctx.host.stores().usersRead.list().some((user) => user.id === userId),
        isAdmin: (userId) => ctx.host.stores().usersRead.isAdmin(userId),
        canAccessProject: (userId, projectId) => ctx.host.stores().userProjects.canAccess(userId, projectId),
    };
    const usernames = () => new Map(ctx.host.stores().usersRead.list().map((user) => [user.id, user.username]));
    const projectSlug = (projectId) => ctx.host.stores().projects.get(projectId)?.slug ?? null;
    // Visits are counted in memory and flushed on a timer: a published page must not pay for a database
    // write on every asset it serves.
    const pendingHits = new Map();
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
    const activateRelease = (site, releaseId) => {
        store.updateSite(site.id, { currentReleaseId: releaseId, status: 'live', lastError: null });
    };
    ctx.registerHttpRoute({
        path: 's',
        handler: createSiteHandler({
            store,
            access,
            secret: sessionSecret,
            config: () => {
                const resolved = config();
                return {
                    siteBaseUrl: resolved.siteBaseUrl,
                    appBaseUrl: resolved.appBaseUrl,
                    dedicatedHost: resolved.dedicatedHost,
                    sessionTtlHours: resolved.sessionTtlHours,
                };
            },
            releaseDir,
            countHit: (siteId) => pendingHits.set(siteId, (pendingHits.get(siteId) ?? 0) + 1),
        }),
    });
    const handlers = createApiHandlers({
        store,
        access,
        config,
        usernames,
        projectSlug,
        deleteSiteFiles: (siteId) => rmSync(siteDir(siteId), { recursive: true, force: true }),
        activateRelease,
    });
    ctx.registerApiRoute({ path: 'sites', method: 'GET', access: 'user', handler: handlers.list });
    ctx.registerApiRoute({ path: 'site', access: 'user', handler: handlers.site });
    ctx.registerApiRoute({ path: 'ticket', method: 'POST', access: 'user', handler: handlers.ticket });
    ctx.registerApiRoute({ path: 'directory', method: 'GET', access: 'user', handler: handlers.directory });
    registerTools({ ctx, store, access, config, siteDir, releaseDir });
    ctx.registerUserRemoved((userId) => {
        // The account's own sites go with it; its guest rows elsewhere go too, so a deleted account cannot
        // keep opening somebody else's site and does not linger as a blank avatar in their access list.
        for (const siteId of store.siteIdsOwnedBy(userId)) {
            rmSync(siteDir(siteId), { recursive: true, force: true });
            store.deleteSite(siteId);
        }
        for (const siteId of store.forgetMemberEverywhere(userId))
            store.bumpAccessGeneration(siteId);
    });
    ctx.registerProjectRemoved((projectId) => {
        // A site's Project is where its access rule points. Without it there is nothing left to decide
        // "the Project's people" against, so the site stops being served rather than falling open.
        for (const siteId of store.siteIdsInProject(projectId)) {
            rmSync(siteDir(siteId), { recursive: true, force: true });
            store.deleteSite(siteId);
        }
    });
    ctx.registerBootReconcile(() => {
        store.pruneTickets(Date.now());
    });
    ctx.registerInterval('flush-visits', () => {
        flushHits();
        store.pruneTickets(Date.now());
    }, HIT_FLUSH_MS);
    ctx.logger.info('sites plugin registered');
}
