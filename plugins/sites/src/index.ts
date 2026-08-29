import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import type { PluginContext } from 'elowen/plugin-api';
import { asSitesContext, asUserViews } from './coreSeams.js';
import { SitesStore, type Site } from './store.js';
import { resolveConfig, type SitesConfig } from './config.js';
import { createSiteHandler } from './serve.js';
import { createApiHandlers, type Person } from './api.js';
import { registerTools } from './tools.js';
import { SiteGatewayManager } from './gateway.js';
import { executePhp } from './php.js';
import { SiteRuntimeSupervisor, isDaemonProcess } from './runtime.js';
import type { AccessDeps } from './access.js';

const SESSION_SECRET_KEY = 'sessionSigningKey';
const HIT_FLUSH_MS = 60_000;
const GATEWAY_RECONCILE_MS = 12 * 3600_000;

export function register(published: PluginContext): void {
  const ctx = asSitesContext(published);
  const store = new SitesStore(ctx.db());
  const dataDir = ctx.dataDir();

  const siteDir = (siteId: string): string => join(dataDir, 'sites', siteId);
  const releaseDir = (siteId: string, releaseId: string): string => join(siteDir(siteId), 'releases', releaseId);

  /** The key that signs site sessions. Kept in the encrypted bag rather than in settings: it is a
   *  credential, and rotating it simply invalidates every outstanding site session, which is a safe
   *  failure. Minted on first use and held for the life of this plugin generation — reading the vault
   *  during registration would stop the plugin loading anywhere the vault is absent. */
  let cachedSecret: string | null = null;
  const sessionSecret = (): string => {
    if (cachedSecret !== null) return cachedSecret;
    cachedSecret = mintSessionSecret();
    return cachedSecret;
  };

  const mintSessionSecret = (): string => {
    const existing = ctx.instanceSecrets().get(SESSION_SECRET_KEY);
    if (existing) return existing.value;
    const minted = randomBytes(32).toString('base64url');
    try {
      ctx.instanceSecrets().set(SESSION_SECRET_KEY, minted);
      return minted;
    } catch {
      // Another worker minted it first; theirs is the one that counts.
      return ctx.instanceSecrets().get(SESSION_SECRET_KEY)?.value ?? minted;
    }
  };

  const gateway = new SiteGatewayManager(ctx);
  const config = (): SitesConfig => resolveConfig(
    ctx.config as Record<string, unknown>,
    ctx.publicWebUrl(),
    gateway.hostnameBase(),
  );

  /** The live account and project facts every access decision reads. Resolved per call, never captured:
   *  a Project taken away or an account deleted has to change the answer immediately. */
  const access: AccessDeps = {
    accountExists: (userId) => ctx.host.stores().usersRead.list().some((user) => user.id === userId),
    isAdmin: (userId) => ctx.host.stores().usersRead.isAdmin(userId),
    canAccessProject: (userId, projectId) => ctx.host.stores().userProjects.canAccess(userId, projectId),
  };

  // Whole accounts, not just names: a plugin page draws people with the host Avatar, which needs the
  // display name and whether a photo was uploaded. `avatar` is a presence flag — the component mints its
  // own signed link from the id and never builds a URL from this string.
  const people = (): Map<number, Person> =>
    new Map(asUserViews(ctx.host.stores().usersRead.list()).map((user) => [user.id, {
      id: user.id, username: user.username, name: user.name || user.username, avatar: user.avatar,
    }]));

  const projectSlug = (projectId: number): string | null =>
    ctx.host.stores().projects.get(projectId)?.slug ?? null;

  // Visits are counted in memory and flushed on a timer: a published page must not pay for a database
  // write on every asset it serves.
  const pendingHits = new Map<string, number>();
  const deletingSiteIds = new Set<string>();
  const flushHits = (): void => {
    if (pendingHits.size === 0) return;
    const day = new Date().toISOString().slice(0, 10);
    const batch = [...pendingHits.entries()];
    pendingHits.clear();
    try {
      store.transaction(() => {
        for (const [siteId, count] of batch) store.recordHits(siteId, day, count);
      });
    } catch (error) {
      ctx.logger.warn(`could not record visits: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const supervisor = new SiteRuntimeSupervisor({
    ctx,
    store,
    config: () => ({ startTimeoutSeconds: config().startTimeoutSeconds }),
    siteDir,
    releaseDir,
  });

  /** Deletion is two-phase and crash-safe. The durable marker removes access immediately; only the
   * authoritative daemon touches processes and plugin-owned files. A forked tool runner stops after the
   * marker and the daemon's five-second reconcile finishes the same operation. */
  const deleteSite = async (siteId: string): Promise<void> => {
    const site = store.siteById(siteId);
    if (!site) return;
    if (site.status !== 'deleting') store.beginDelete(siteId);
    pendingHits.delete(siteId);
    deletingSiteIds.add(siteId);
    if (!isDaemonProcess()) return;
    try {
      await supervisor.stop(siteId);
      rmSync(siteDir(siteId), { recursive: true, force: true });
      store.deleteSite(siteId);
      deletingSiteIds.delete(siteId);
    } catch (error) {
      ctx.logger.warn(`site ${site.slug} deletion will be retried: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  };

  const cleanupDeletingSites = async (): Promise<void> => {
    if (!isDaemonProcess()) return;
    for (const site of store.deletingSites()) {
      try { await deleteSite(site.id); }
      catch { /* durable marker keeps it queued for the next sweep */ }
    }
  };

  /** A plugin disabled during an account/Project deletion receives no lifecycle callback. On its next
   * enable, reconcile against live core stores before serving anything again and funnel every orphan
   * through the same durable delete path. */
  const cleanupOrphans = async (): Promise<void> => {
    if (!isDaemonProcess()) return;
    const stores = ctx.host.stores();
    const users = new Set(stores.usersRead.list().map((user) => user.id));
    const projects = new Set(stores.projects.list().map((project) => project.id));
    for (const site of store.allSites()) {
      if (users.has(site.ownerUserId) && projects.has(site.projectId)) continue;
      try { await deleteSite(site.id); }
      catch { /* each orphan carries its own durable deleting marker; keep sweeping the rest */ }
    }
    for (const userId of store.memberUserIds()) {
      if (users.has(userId)) continue;
      for (const siteId of store.forgetMemberEverywhere(userId)) store.bumpAccessGeneration(siteId);
    }
  };

  const activateRelease = (site: Site, releaseId: string): void => {
    store.updateSite(site.id, { currentReleaseId: releaseId, status: 'live', lastError: null });
    if (site.runtime !== 'command' || !isDaemonProcess()) return;
    // A rollback changes what the process is running, so the process has to be replaced. Failing that,
    // the site says so rather than continuing to serve the release the person just rolled away from.
    void (async () => {
      try {
        await supervisor.stop(site.id);
        const next = store.siteById(site.id);
        if (next) await supervisor.start(next);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        store.updateSite(site.id, { status: 'failed', lastError: message });
        ctx.logger.warn(`site ${site.slug} did not restart: ${message}`);
      }
    })();
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
          siteHostBase: resolved.siteHostBase,
          siteScheme: resolved.siteScheme,
          appBaseUrl: resolved.appBaseUrl,
          sessionTtlHours: resolved.sessionTtlHours,
          gatewayToken: gateway.gatewayToken(),
        };
      },
      releaseDir,
      countHit: (siteId) => {
        if (!deletingSiteIds.has(siteId)) pendingHits.set(siteId, (pendingHits.get(siteId) ?? 0) + 1);
      },
      endpointFor: (siteId) => supervisor.endpointFor(siteId),
      proxyLimits: () => {
        const resolved = config();
        return {
          maxResponseBytes: resolved.maxResponseBytes,
          requestTimeoutSeconds: resolved.requestTimeoutSeconds,
        };
      },
      usernameOf: (userId) => people().get(userId)?.username ?? null,
      executePhp: (site, release, req, rest, viewer, siteRoot) => executePhp(
        { ctx, siteDir },
        site,
        release,
        req,
        rest,
        { userId: viewer.userId, name: viewer.userId === null ? null : people().get(viewer.userId)?.username ?? null },
        (() => {
          const resolved = config();
          return { maxResponseBytes: resolved.maxResponseBytes, requestTimeoutSeconds: resolved.requestTimeoutSeconds };
        })(),
        siteRoot,
      ),
    }),
  });

  const handlers = createApiHandlers({
    store,
    access,
    config,
    people,
    projectSlug,
    deleteSite,
    activateRelease,
    runtimeState: (siteId) => ({ running: supervisor.isRunning(siteId), logTail: supervisor.logTail(siteId) }),
    restartRuntime: async (site) => {
      await supervisor.stop(site.id);
      const next = store.siteById(site.id);
      if (!next) return;
      await supervisor.start(next);
      store.updateSite(site.id, { status: 'live', lastError: null });
    },
    gatewayView: () => gateway.payload(),
  });

  ctx.registerApiRoute({ path: 'sites', method: 'GET', access: 'user', handler: handlers.list });
  ctx.registerApiRoute({ path: 'site', access: 'user', handler: handlers.site });
  ctx.registerApiRoute({ path: 'ticket', method: 'POST', access: 'user', handler: handlers.ticket });
  ctx.registerApiRoute({ path: 'directory', method: 'GET', access: 'user', handler: handlers.directory });
  ctx.registerApiRoute({ path: 'gateway', method: 'GET', access: 'admin', handler: (req) => gateway.handle(req) });
  ctx.registerApiRoute({ path: 'gateway', method: 'PUT', access: 'admin', handler: (req) => gateway.handle(req) });
  ctx.registerApiRoute({ path: 'gateway', method: 'DELETE', access: 'admin', handler: (req) => gateway.handle(req) });

  registerTools({ ctx, store, access, config, siteDir, releaseDir, deleteSite, runtime: supervisor, people });

  ctx.registerReadinessCheck(() => gateway.readiness());

  // Nothing in the daemon keeps a process alive across a restart, and a confined child dies with its
  // parent by construction. Supervision of published runtimes is therefore this plugin's own job:
  // reconcile brings back everything that should be running, and the service stops them around a
  // reload so the next generation does not start a second copy onto the same socket.
  if (isDaemonProcess()) {
    ctx.registerService({
      name: 'site-gateway',
      start: async () => { await gateway.reconcile(); },
      // A normal plugin reload must not flap nginx. Core replaces it with the deny tombstone only when
      // this plugin is absent from the next registry generation.
      stop: () => {},
    });
    // Only the service starts runtimes. Boot reconciliation would otherwise race it onto the same
    // socket, and `reconcile` joins an in-flight sweep rather than starting a second one either way.
    ctx.registerService({
      name: 'site-runtimes',
      criticalStop: true,
      start: async () => { await supervisor.reconcile(); },
      stop: async () => { await supervisor.stopAll(); },
    });
  }

  ctx.registerUserRemoved(async (userId) => {
    // The account's own sites go with it; its guest rows elsewhere go too, so a deleted account cannot
    // keep opening somebody else's site and does not linger as a blank avatar in their access list.
    for (const siteId of store.siteIdsOwnedBy(userId)) await deleteSite(siteId);
    for (const siteId of store.forgetMemberEverywhere(userId)) store.bumpAccessGeneration(siteId);
  });

  ctx.registerProjectRemoved(async (projectId) => {
    // A site's Project is where its access rule points. Without it there is nothing left to decide
    // "the Project's people" against, so the site stops being served rather than falling open.
    for (const siteId of store.siteIdsInProject(projectId)) await deleteSite(siteId);
  });

  ctx.registerBootReconcile(async () => {
    store.pruneTickets(Date.now());
    await cleanupOrphans();
    await cleanupDeletingSites();
  });

  ctx.registerInterval('cleanup-deleting-sites', async () => {
    await cleanupDeletingSites();
  }, 5_000);

  // A publish or rollback may have been requested by an out-of-process agent runner. The daemon sees the
  // shared desired state here and starts or replaces the process whose release id no longer matches.
  ctx.registerInterval('reconcile-site-runtimes', async () => {
    await supervisor.reconcile();
  }, 2_000);

  ctx.registerInterval('renew-site-gateway', async () => {
    await gateway.reconcile();
  }, GATEWAY_RECONCILE_MS);

  ctx.registerInterval('flush-visits', () => {
    flushHits();
    store.pruneTickets(Date.now());
  }, HIT_FLUSH_MS);

  ctx.logger.info('sites plugin registered');
}
