import { randomBytes } from 'node:crypto';
import { existsSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { PluginContext } from 'elowen/plugin-api';
import { asSitesContext, asUserViews } from './coreSeams.js';
import { SitesStore, type Site } from './store.js';
import { resolveConfig, siteUrl, type SitesConfig } from './config.js';
import { createSiteHandler } from './serve.js';
import { createApiHandlers, type Person } from './api.js';
import { registerTools } from './tools.js';
import { SiteGatewayManager } from './gateway.js';
import { executePhp } from './php.js';
import { SiteRuntimeSupervisor, isDaemonProcess } from './runtime.js';
import { SpawnExecutor } from './podman.js';
import { EnvironmentSupervisor } from './environment.js';
import { EnvironmentProvisioningService } from './provisioning.js';
import { SITES_TOOLCHAIN, environmentReadinessChecks, toolchainRow } from './readiness.js';
import { DataSyncService, migrationArtifactDir, validateLegacyHome } from './dataSync.js';
import { installAppRecipe, loadAppRecipe, recipeBinding, relaxStaticServingPermissions } from './recipe.js';
import { conversionImageTag } from './conversionImage.js';
import { RuntimeMigrationService } from './migration.js';
import type { AccessDeps } from './access.js';
import { ProjectPreviewService } from './preview.js';
import { ProjectPublicationService, type ProjectEnvironmentView, type PublicationControl } from './publication.js';

const SESSION_SECRET_KEY = 'sessionSigningKey';
const HIT_FLUSH_MS = 60_000;
const GATEWAY_RECONCILE_MS = 12 * 3600_000;
/** How often to retry a gateway that is DOWN. Deliberately far shorter than the renewal sweep: see the
 *  `recover-site-gateway` interval for why an inactive gateway is the one state worth polling. */
const GATEWAY_RECOVERY_MS = 60_000;
const ISSUE_SWEEP_MS = 30_000;

const sandboxVisible = (path: string): boolean => {
  try {
    const real = realpathSync(path);
    return real === '/usr' || real.startsWith('/usr/');
  } catch {
    return false;
  }
};

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

  /** The one bounded-proxy fact for every runtime an HTTP page is proxied from. */
  const proxyLimits = () => {
    const resolved = config();
    return {
      maxResponseBytes: resolved.maxResponseBytes,
      requestTimeoutSeconds: resolved.requestTimeoutSeconds,
    };
  };

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
    config: () => {
      const resolved = config();
      return {
        startTimeoutSeconds: resolved.startTimeoutSeconds,
        runtimeNetwork: resolved.runtimeNetwork,
        allowLoopbackPorts: resolved.allowLoopbackPorts,
        loopbackPortMin: resolved.loopbackPortMin,
        loopbackPortMax: resolved.loopbackPortMax,
      };
    },
    siteDir,
    releaseDir,
  });

  const environment = new EnvironmentSupervisor({
    control: () => ctx.control('sandbox'),
    dataDir,
    access,
    store,
    gateway: {
      prepareRuntimeSocket: async (siteId) => {
        const control = ctx.control('publishedSitesGateway');
        if (!control) throw new Error('the published-sites socket broker is unavailable');
        return await control.prepareRuntimeSocket(siteId);
      },
      sealRuntimeSocket: async (siteId) => {
        const control = ctx.control('publishedSitesGateway');
        if (!control) throw new Error('the published-sites socket broker is unavailable');
        await control.sealRuntimeSocket(siteId);
      },
      removeRuntimeSocket: async (siteId) => {
        const control = ctx.control('publishedSitesGateway');
        if (!control) throw new Error('the published-sites socket broker is unavailable');
        await control.removeRuntimeSocket(siteId);
      },
    },
    config: () => {
      const resolved = config();
      return {
        startTimeoutSeconds: resolved.startTimeoutSeconds,
        environmentNetwork: resolved.environmentNetwork,
        environmentCpus: resolved.environmentCpus,
        environmentMemoryMb: resolved.environmentMemoryMb,
        environmentPidsLimit: resolved.environmentPidsLimit,
        releasesKept: resolved.releasesKept,
      };
    },
    siteDir,
    siteUrl: (site) => siteUrl(config(), site.slug),
    logger: ctx.logger,
  });

  environment.connect();
  const previews = new ProjectPreviewService({
    store, access, project: id => ctx.host.stores().projects.get(id),
    control: () => ctx.control('sandbox'), config, gateway, proxyLimits,
    usernameOf: id => people().get(id)?.username ?? null,
  });

  /** The transport half of every proxy publication. Its state is derived from the Project's environment
   *  on demand, so nothing here has to be recovered after a restart: an endpoint is adopted again by the
   *  next sweep. */
  const publications = new ProjectPublicationService({
    store,
    control: () => ctx.control('sandbox') as unknown as PublicationControl | undefined,
    project: id => ctx.host.stores().projects.get(id),
    logger: ctx.logger,
  });

  /** The state of the environment a proxy publication is served by. Read through the current manager,
   *  because the environment state seam is account-scoped even though the publication transport is not. */
  const projectEnvironment = async (projectId: number, actor: number): Promise<ProjectEnvironmentView | null> => {
    const control = ctx.control('sandbox');
    if (!control?.environmentFor) return null;
    try {
      const state = await control.environmentFor({ project: { kind: 'managed', projectId }, accountUserId: actor });
      return { state: state.state, lastError: state.lastError };
    } catch {
      return null;
    }
  };

  const provisioning = new EnvironmentProvisioningService({
    control: () => ctx.control('publishedSitesGateway'),
    imageExists: async () => {
      const sandbox = ctx.control('sandbox');
      if (!sandbox?.siteImageStatus) return null;
      return (await sandbox.siteImageStatus({ imageKind: 'base' })).present;
    },
    buildImage: async () => {
      const site = store.allSites().find(entry => entry.runtime === 'environment');
      if (!site) throw new Error('image provisioning requires a registered Site environment');
      await environment.provision(site, 'base');
    },
    audit: (status, actorUserId) => ctx.publishEvent({
      type: 'plugin',
      plugin: 'sites',
      kind: 'environments.provisioned',
      projectId: null,
      data: { at: new Date().toISOString(), actorUserId, ready: status.ready, items: status.items },
    }),
  });
  ctx.registerEventRowResolver((event) => event.type === 'plugin' && event.kind === 'environments.provisioned'
    ? {
      type: 'sites.environments.provisioned',
      target: 'sites-environments',
      label: 'Sites environments',
      detail: 'An administrator ran environment dependency provisioning.',
    }
    : null);

  const dataSync = new DataSyncService({
    executor: new SpawnExecutor(),
    artifactDir: (siteId) => migrationArtifactDir(siteDir(siteId)),
  });

  /** Runtime conversion, wired to the SAME supervisors that serve production.
   *
   *  The legacy stop and the running check are the real `SiteRuntimeSupervisor`, because nothing else in
   *  the plugin will ever stop a converted site's process. The container side is the real
   *  `EnvironmentSupervisor`, so a converted site is created, sized and started by exactly the code path
   *  a native environment uses.
   *
   *  Both starts below are AUTHORIZED. A conversion holds a site's runtime down through a durable marker
   *  that both supervisors consult before they start anything, and this operation is the one that owns
   *  that marker: it must pass through its own guard rather than be refused by it. Every other caller,
   *  including the periodic reconcile of either runtime, goes through unauthorized and is held off. */
  const migration = new RuntimeMigrationService({
    store,
    projectExecutionKind: (projectId) => ctx.host.stores().projects.get(projectId)?.executionKind ?? null,
    siteDir,
    releaseDir,
    stopLegacyRuntime: (siteId) => supervisor.stop(siteId),
    legacyRunning: (siteId) => supervisor.isRunning(siteId),
    startLegacyRuntime: async (site) => { await supervisor.start(site, { authorized: true }); },
    restoreLegacyPublication: async (site) => {
      if (site.kind !== 'proxy') return;
      const endpoint = supervisor.endpointFor(site.id);
      if (endpoint?.kind !== 'socket') {
        throw new Error('the restored legacy publication has no socket transport');
      }
      await publications.release(site);
      publications.adopt(site.id, endpoint.path);
    },
    loadRecipe: (siteId) => loadAppRecipe(migrationArtifactDir(siteDir(siteId))),
    recipeBinding: (siteId) => recipeBinding(migrationArtifactDir(siteDir(siteId))),
    installRecipe: (siteId, input) => installAppRecipe(migrationArtifactDir(siteDir(siteId)), input),
    prepareContainer: async ({ site, workspace, recipe }) => {
      // The derivative carries what the app needs to answer: nginx for files, a pinned Node runtime for a
      // command app. The shared base image is left exactly as every other environment sees it.
      await environment.prepareContainer(site, workspace, conversionImageTag(recipe.image), recipe.image === 'static');
    },
    startEnvironment: (site) => environment.start(site, { authorized: true }),
    stopContainer: (siteId) => environment.quiesce(siteId),
    containerStopped: (siteId) => environment.isStopped(siteId),
    inspectOwnership: (siteId, expect) => environment.inspectOwnership(siteId, expect),
    conversionImageTag: (recipe) => conversionImageTag(recipe.image),
    // Readiness is the site answering through its own sealed ingress socket, which is the same path a
    // visitor's request takes. A running container is not evidence of that.
    // REAL HTTP through the site's own ingress, asking the invariant the recipe declared.
    verifyReadiness: async (site, expect) => {
      const state = await environment.state(site);
      if (state.state !== 'running') return { ready: false, detail: `the container is ${state.state ?? 'absent'}` };
      // The WAIT belongs to the probe, not to the caller: only it knows the difference between a
      // transport failure worth retrying and an answer worth reporting. The failure propagates verbatim.
      const outcome = await environment.probeReadiness(site.id, expect);
      return { ready: outcome.ready, detail: outcome.detail };
    },
    discardContainer: (siteId, options) => environment.delete(siteId, options),
    brokerDirectoryExists: (siteId) => environment.brokerDirectoryExists(siteId),
    prepareBrokerDirectory: async (siteId) => { await environment.prepareBrokerDirectory(siteId); },
    removeStaged: (paths, operationId) => environment.removeStaged(paths, operationId),
    // The completion moves the container onto the site's own source folder through the SAME supervisor
    // that created it, so the rebuilt container is created, sized and started exactly like any other.
    rebindToSource: (site, operationId) => environment.rebindToSource(site, operationId),
    publishBinding: (site) => environment.publishBinding(site),
    clearConversionStage: (site, stageDir) => environment.clearConversionStage(site, stageDir),

    // The sandbox is the only authority on where a confined site keeps its data: `runtime.ts` blocks HOME
    // from `.env`, so the value can come from nowhere else. Asking for the same preparation the legacy
    // runtime gets, then releasing the lease straight away, reads that fact without running anything.
    resolveLegacyData: async (site) => {
      if (site.runtime !== 'command' || !site.currentReleaseId) return null;
      // WHICH subtrees belong to this app comes from its own recipe, not from the home. Two sites can be
      // confined to the SAME sandbox home, so a home-wide capture would carry the neighbour's database
      // and credentials into this site's archive, volume and rollback.
      const recipe = loadAppRecipe(migrationArtifactDir(siteDir(site.id)));
      if (recipe.dataIncludes.length === 0) return null;
      const sandbox = ctx.control('sandbox');
      if (!sandbox) throw new Error('the Sandbox plugin is disabled, so this site\'s data directory cannot be resolved');
      const cwd = releaseDir(site.id, site.currentReleaseId);
      const prepared = await sandbox.prepareExecution(
        { command: { type: 'shell', command: site.startCommand }, cwd, leaseKind: 'sites', network: config().runtimeNetwork },
        { accountUserId: site.ownerUserId, roots: [cwd] },
      );
      try {
        return {
          // The OWNER is what makes this home trustworthy, not where it sits. We named the account above,
          // and the lease states which account Sandbox actually prepared for; `roots` is a different
          // question entirely and a home outside them is the normal result of asking for one.
          home: validateLegacyHome({
            home: prepared.home,
            expectedOwnerUserId: site.ownerUserId,
            leaseAccountUserId: prepared.lease.accountUserId,
            expectedHome: supervisor.runningHome(site.id) ?? store.runtimeMigration(site.id)?.legacyHome ?? null,
          }),
          includes: recipe.dataIncludes,
        };
      } finally {
        // Released immediately: this preparation exists to ANSWER a question, not to run a process, and a
        // retained lease would block the very stop the conversion is about to perform.
        try { await prepared.lease.release(); }
        catch (error) {
          ctx.logger.warn(`site ${site.slug} data-location lease release failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    },
    // The home of the process actually running, taken from the live supervisor rather than from a fresh
    // sandbox preparation that may be handed a different one.
    runningLegacyHome: (siteId) => supervisor.runningHome(siteId),
    captureLegacyData: (siteId, selection) => dataSync.captureLegacyData(siteId, selection),
    buildSeedArchive: (siteId, input) => dataSync.buildSeedArchive(siteId, input),
    loadDataVolume: async (site, seedArchive, operationId) => {
      await environment.importDataVolume(site.id, seedArchive, operationId);
    },
    exportDataVolume: (site, output, operationId) => environment.exportDataVolume(site.id, output, operationId),
    restoreLegacyData: (selection, archive, siteId) => dataSync.restoreLegacyData(selection, archive, siteId),
    recoverInterruptedRestore: (siteId) => dataSync.recoverInterruptedRestore(siteId),
    extractSecretArtifacts: (siteId, workspace, files) => dataSync.extractSecretArtifacts(siteId, workspace, files),
    stagedSecretDigest: (siteId) => dataSync.stagedSecretDigest(siteId),
    // The ancestors are this site's own plugin directory and the migration directory inside it. They get
    // traversal only; the artefact directory beside the workspace keeps the secrets and stays 0700.
    relaxStaticServing: (siteId, workspace) =>
      relaxStaticServingPermissions(workspace, [siteDir(siteId), join(siteDir(siteId), 'migration')]),
    artifactPath: (siteId, name) => dataSync.archivePath(siteId, name),
    discardArtifacts: (siteId) => dataSync.discardArtifacts(siteId),
  });

  /** Finish the conversions a restart cut short after their flip.
   *
   *  Such a site is up and serving, but out of a staged copy nobody edits: agents write to the Project
   *  folder and see nothing change. An operator has no way to notice that from the outside, so the sweep
   *  that already watches every environment finishes the last step itself. It runs AFTER the environment
   *  reconcile in the same tick, because completing demands the site answers and the endpoint the probe
   *  uses is adopted by that reconcile. */
  const settleConversions = async (): Promise<void> => {
    if (!isDaemonProcess()) return;
    for (const settled of await migration.reconcileCompletions()) {
      if (settled.lastError === null) {
        ctx.logger.info(`site conversion ${settled.siteId} completed; its Project folder is now the served workspace`);
        continue;
      }
      ctx.logger.warn(`site conversion ${settled.siteId} could not be completed: ${settled.lastError}`);
    }
  };

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
      if (site.runtime !== 'environment') await supervisor.stop(siteId);
      // A proxy publication's forwarder lives in the Project's environment and belongs to this plugin
      // until it is ended; the row is what names it, so it goes before anything the row was holding.
      if (site.kind === 'proxy') await publications.release(site);
      if (site.runtime === 'environment' || store.runtimeRecord(siteId, 'binding')) await environment.delete(siteId);
      rmSync(siteDir(siteId), { recursive: true, force: true });
      store.deleteSite(siteId);
      // Last, and never fatal: the hostname and its certificate are the gateway's copy of a site that no
      // longer exists here. A certbot that will not let go must not resurrect the deletion.
      await gateway.removeSite(site.slug);
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
    for (const preview of store.allPreviews()) if (!projects.has(preview.projectId)) await previews.removeProject(preview.projectId);
    for (const site of store.allSites()) {
      if (users.has(site.ownerUserId)) {
        if (!projects.has(site.projectId)) ctx.logger.warn(`site ${site.slug} references a removed Project; its published resources are preserved`);
        continue;
      }
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
      endpointFor: (siteId) => publications.endpointFor(siteId) ?? environment.endpointFor(siteId) ?? supervisor.endpointFor(siteId),
      previews,
      proxyLimits,
      usernameOf: (userId) => people().get(userId)?.username ?? null,
      executePhp: (site, release, req, rest, viewer, siteRoot) => executePhp(
        { ctx, siteDir, network: () => config().runtimeNetwork },
        site,
        release,
        req,
        rest,
        { userId: viewer.userId, name: viewer.userId === null ? null : people().get(viewer.userId)?.username ?? null },
        proxyLimits(),
        siteRoot,
      ),
    }),
  });

  const handlers = createApiHandlers({
    previewSite: slug => previews.siteBySlug(slug),
    store,
    access,
    config,
    people,
    projectSlug,
    deleteSite,
    activateRelease,
    runtimeState: (siteId) => ({ running: supervisor.isRunning(siteId), logTail: supervisor.logTail(siteId) }),
    allocatePort: () => supervisor.allocatePort(),
    restartRuntime: async (site) => {
      await supervisor.stop(site.id);
      const next = store.siteById(site.id);
      if (!next) return;
      await supervisor.start(next);
      store.updateSite(site.id, { status: 'live', lastError: null });
    },
    environmentState: (site, actor) => environment.state(site, actor),
    environmentLogs: (site, lines, actor) => environment.logs(site, lines, actor),
    environmentAction: (site, actor) => environment.pendingAction(site, actor),
    gatewayReadiness: () => gateway.readiness(),
    gatewayRecord: () => gateway.requiredRecord(),
    requestEnvironmentControl: async (site, action, actor) => {
      await environment.request(site, { kind: action }, actor);
    },
    snapshotEnvironment: async (site, input, actor) => {
      const model = ctx.currentModel();
      return await environment.scheduleSnapshot(site, { ...input, model: model ? `${model.provider}/${model.model}` : '' }, actor);
    },
    rollbackEnvironment: async (site, input, actor) => {
      await environment.scheduleRestore(site, input.releaseId, input.restoreData, actor);
    },
    applyEnvironmentLimits: (site, limits, actor) => environment.applyLimits(site, limits, actor),
    projectEnvironment,
    provisioning,
    migration,
  });

  ctx.registerApiRoute({ path: 'preview', method: 'POST', access: 'user', handler: async req => {
    if (req.auth.userId === null) return { status: 403, body: { error: 'a linked account is required' } };
    const input = await req.json<{ projectId?: unknown; port?: unknown }>();
    try { return { status: 200, body: await previews.request(Number(input.projectId), Number(input.port), req.auth.userId) }; }
    catch (error) { return { status: 409, body: { error: error instanceof Error ? error.message : 'preview unavailable' } }; }
  } });
  ctx.registerApiRoute({ path: 'sites', method: 'GET', access: 'user', handler: handlers.list });
  ctx.registerApiRoute({ path: 'site', access: 'user', handler: handlers.site });
  ctx.registerApiRoute({ path: 'ticket', method: 'POST', access: 'user', handler: handlers.ticket });
  ctx.registerApiRoute({ path: 'directory', method: 'GET', access: 'user', handler: handlers.directory });
  ctx.registerApiRoute({ path: 'gateway/readiness', method: 'GET', access: 'user', handler: handlers.gatewayReadiness });
  ctx.registerApiRoute({ path: 'environments/readiness', method: 'GET', access: 'user', handler: handlers.environmentsReadiness });
  ctx.registerApiRoute({ path: 'environments/provision', method: 'POST', access: 'user', handler: handlers.environmentsProvision });
  // Admin-gated inside the handler, like the provisioning routes: core's `access` levels have no
  // admin tier, so the check has to live where the auth is actually read.
  ctx.registerApiRoute({ path: 'conversion', access: 'user', handler: handlers.conversion });

  registerTools({ ctx, store, access, config, siteDir, releaseDir, deleteSite, runtime: supervisor, environment, publications, projectEnvironment, people, previews });

  ctx.registerReadinessCheck(() => gateway.readiness());
  // One row per dependency and per interpreter, rather than one row carrying a paragraph: the status
  // card lists what is checked, and a failing item shows its own cause where a reader is looking.
  for (const check of environmentReadinessChecks({
    enabled: () => config().allowEnvironments,
    status: () => provisioning.status(),
  })) ctx.registerReadinessCheck(check);
  for (const probe of SITES_TOOLCHAIN) {
    ctx.registerReadinessCheck(() => toolchainRow(probe, (path) => existsSync(path) && sandboxVisible(path)));
  }

  // Nothing in the daemon keeps a process alive across a restart, and a confined child dies with its
  // parent by construction. Supervision of published runtimes is therefore this plugin's own job:
  // reconcile brings back everything that should be running, and the service stops them around a
  // reload so the next generation does not start a second copy onto the same socket.
  /** Converge the gateway on the sites that exist. `reconcile` publishes the vhost and reports which
   *  sites already hold a certificate; only the ones missing from that list pay for a certbot run.
   *  Passing `all` asks for every live site instead, which is how renewal happens — certbot decides for
   *  itself whether a certificate is actually due. */
  const syncGateway = async (all = false): Promise<void> => {
    const status = await gateway.reconcile();
    if (!status.active) return;
    const issued = new Set(gateway.issuedSlugs());
    for (const site of store.allSites()) {
      // Only a site that is actually being served earns a certificate. A draft has no release behind it,
      // and issuing for one would publish its slug in a public Certificate Transparency log before
      // anybody decided to publish the page at all.
      if (site.status !== 'live') continue;
      if (!all && issued.has(site.slug)) continue;
      // A plugin reload runs this again from the top, and a certificate authority counts FAILED
      // validations per hostname per hour. Without this the third reload in a row spends the budget the
      // working sites need on the one site whose DNS is simply wrong.
      if (!gateway.mayAttempt(site.slug)) continue;
      try { await gateway.ensureSite(site.slug); }
      catch (error) {
        ctx.logger.warn(`site ${site.slug} has no certificate yet: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    await previews.syncGateway(issued, all);
  };

  if (isDaemonProcess()) {
    ctx.registerService({
      name: 'site-gateway',
      start: async () => { await syncGateway(); },
      // A normal plugin reload must not flap nginx. Core replaces it with the deny tombstone only when
      // this plugin is absent from the next registry generation.
      stop: () => {},
    });
    // Only the service starts runtimes. Boot reconciliation would otherwise race it onto the same
    // socket, and `reconcile` joins an in-flight sweep rather than starting a second one either way.
    ctx.registerService({
      name: 'site-runtimes',
      criticalStop: true,
      start: async () => {
        await supervisor.reconcile();
        await environment.reconcile();
        await publications.reconcile();
        await settleConversions();
      },
      // Command runtimes retain their existing reload behavior. Persistent environments detach only and
      // remain in Podman's user scope across plugin reloads and daemon restarts.
      stop: async () => {
        await supervisor.stopAll();
        await environment.detach();
      },
    });
  }

  ctx.registerUserRemoved(async (userId) => {
    // The account's own sites go with it; its guest rows elsewhere go too, so a deleted account cannot
    // keep opening somebody else's site and does not linger as a blank avatar in their access list.
    for (const siteId of store.siteIdsOwnedBy(userId)) await deleteSite(siteId);
    for (const siteId of store.forgetMemberEverywhere(userId)) store.bumpAccessGeneration(siteId);
  });

  ctx.registerProjectRemoved(async (projectId) => {
    await previews.removeProject(projectId);
    // The runtime's projectDependents preflight blocks normal deletion. Never turn an unexpected
    // post-removal callback into destruction of independently published resources.
    if (store.siteIdsInProject(projectId).length) throw new Error('published Sites must be explicitly transferred or deleted before removing their Project');
  });

  ctx.registerBootReconcile(async () => {
    store.pruneTickets(Date.now());
    await cleanupOrphans();
    await cleanupDeletingSites();
    // A conversion is driven by an administrator across several calls, so a restart can land between any
    // two of them. Settling the interrupted slots here releases ownership and clears the orphan container
    // a never-verified preparation may have left; it deliberately does not resume forward, because moving
    // a live hostname between runtimes is a decision, not a restart side effect.
    if (isDaemonProcess()) {
      for (const settled of await migration.recoverInterrupted()) {
        ctx.logger.warn(`site conversion ${settled.siteId} was interrupted at ${settled.stage}: ${settled.lastError ?? 'settled'}`);
      }
    }
  });

  ctx.registerInterval('cleanup-deleting-sites', async () => {
    await cleanupDeletingSites();
  }, 5_000);

  // A publish or rollback may have been requested by an out-of-process agent runner. The daemon sees the
  // shared desired state here and starts or replaces the process whose release id no longer matches. The
  // same tick keeps every proxy publication's transport alive, because nothing else in the daemon holds
  // one across a restart.
  ctx.registerInterval('reconcile-site-runtimes', async () => {
    await supervisor.reconcile();
    await environment.reconcile();
    await publications.reconcile();
    await settleConversions();
  }, 2_000);

  // A publish almost always arrives from a forked tool runner, which has no gateway of its own and never
  // reconciles, so the daemon has to notice the new site itself. Without this the page is `live` in the
  // store while nginx has no server block for it, and stays unreachable until the 12-hour renewal sweep.
  // The guard is what keeps it cheap: a settled instance finds nothing pending and never probes DNS.
  ctx.registerInterval('issue-site-certificates', async () => {
    if (!gateway.isActive()) return;
    const issued = new Set(gateway.issuedSlugs());
    const pending = store.allSites().some((site) =>
      site.status === 'live' && !issued.has(site.slug) && gateway.mayAttempt(site.slug));
    if (pending) await syncGateway();
  }, ISSUE_SWEEP_MS);

  ctx.registerInterval('renew-site-gateway', async () => {
    await syncGateway(true);
  }, GATEWAY_RECONCILE_MS);

  // An inactive gateway is almost always one whose DNS record the operator is creating RIGHT NOW: the
  // readiness check hands them the exact record to add, and the wildcard then starts resolving at a
  // moment nothing in here is watching for. Recovering only on the twelve-hour renewal sweep means the
  // record lands and the sites stay dark for up to half a day, with no signal that it was accepted —
  // which reads as "the record did not work" and invites a second, wrong change at the registrar.
  // A live gateway returns on the first line, so this costs one DNS query a minute only while broken.
  ctx.registerInterval('recover-site-gateway', async () => {
    if (gateway.isActive()) return;
    await syncGateway();
  }, GATEWAY_RECOVERY_MS);

  ctx.registerInterval('flush-visits', () => {
    flushHits();
    store.pruneTickets(Date.now());
  }, HIT_FLUSH_MS);

  ctx.logger.info('sites plugin registered');
}
