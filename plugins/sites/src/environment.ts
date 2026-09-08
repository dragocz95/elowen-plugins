import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { dirname, join, resolve, sep } from 'node:path';
import type { SiteEnvironmentAction, SiteEnvironmentControl, SiteEnvironmentOperation, SiteEnvironmentRegistration, SiteRuntimeArtifact, SiteRuntimeAuthority, SiteImageKind, ManagedProjectRef } from 'elowen/plugin-api';
import type { SitesContext } from './coreSeams.js';
import type { AccessDeps } from './access.js';
import type { EnvironmentLimitOverrides } from './config.js';
import type { Endpoint } from './runtime.js';
import type { Release, Site, SitesStore } from './store.js';
import { createSiteRuntimeAuthority } from './siteRuntimeAuthority.js';
import { BASE_IMAGE_TAG, baseImageRecipe } from './baseImage.js';
import { conversionImageRecipe, conversionImageTag } from './conversionImage.js';
import { loadAppRecipe } from './recipe.js';

interface EnvironmentConfig {
  startTimeoutSeconds: number;
  environmentNetwork: 'isolated' | 'shared';
  environmentCpus: number;
  environmentMemoryMb: number;
  environmentPidsLimit: number;
  environmentDiskSoftMb: number;
  releasesKept: number;
}
export interface EnvironmentDeps {
  control(): SiteEnvironmentControl | undefined;
  store: SitesStore;
  access: AccessDeps;
  dataDir: string;
  gateway: {
    prepareRuntimeSocket(siteId: string): Promise<{ path: string }>;
    sealRuntimeSocket(siteId: string): Promise<void>;
    removeRuntimeSocket(siteId: string): Promise<void>;
  };
  config(): EnvironmentConfig;
  siteDir(siteId: string): string;
  siteUrl?(site: Site): string | null;
  accountUserId?(): number | null;
  brokerPath?(siteId: string): string;
  logger?: Pick<SitesContext['logger'], 'warn'>;
}
export interface EnvironmentEffectiveLimits { cpus: number; memoryMb: number; pidsLimit: number; diskSoftMb: number }
export interface EnvironmentState {
  state: string | null;
  desiredState: Site['environmentDesiredState'];
  limits: EnvironmentEffectiveLimits;
  lastError: string | null;
}
export interface EnvironmentSnapshotInput { snapshotId: string; includeData: boolean; note: string; model: string }

/** Application readiness and Sites records only. All container mutations belong to Sandbox. */
export class EnvironmentSupervisor {
  private readonly endpoints = new Map<string, Endpoint>();
  private readonly authority: SiteRuntimeAuthority;
  private connected: SiteEnvironmentControl | undefined;
  private readonly handovers = new Map<string, Promise<void>>();

  constructor(private readonly deps: EnvironmentDeps) {
    this.authority = createSiteRuntimeAuthority({
      store: deps.store, access: deps.access,
      registration: id => this.registration(id), gateway: () => deps.gateway,
      beforeCreate: async id => { this.writeEnvironmentFiles(this.site(id)); },
      imageRecipe: kind => kind === 'base' ? baseImageRecipe() : conversionImageRecipe(kind),
      projectDependents: async projectId => deps.store.allSites().filter(site => site.projectId === projectId).map(site => ({ siteId: site.id })),
      resolveArtifact: async ({ siteId, accountUserId, artifactId, action }) => {
        if (!await this.authority.resolve({ siteId, accountUserId, access: 'manage' })) return null;
        const raw = deps.store.runtimeRecord(siteId, `artifact:${artifactId}`);
        if (!raw) return null;
        const record: { action: string; artifact: SiteRuntimeArtifact } = JSON.parse(raw);
        if (record.action !== action) return null;
        return record.artifact;
      },
    });
  }

  connect(): void { if (this.deps.control()) this.control(); }

  private control(): SiteEnvironmentControl {
    const control = this.deps.control();
    if (!control) throw new Error('the Sandbox environment runtime is unavailable');
    if (this.connected !== control) {
      control.connectSitesRuntime(this.authority);
      this.connected = control;
    }
    return control;
  }
  private site(id: string): Site {
    const site = this.deps.store.siteById(id);
    if (!site) throw new Error('the site no longer exists');
    return site;
  }
  private actor(site: Site, supplied?: number): number {
    return supplied ?? this.deps.accountUserId?.() ?? site.ownerUserId;
  }
  private registration(id: string): SiteEnvironmentRegistration | null {
    const raw = this.deps.store.runtimeRecord(id, 'binding');
    if (!raw) return null;
    const binding: SiteEnvironmentRegistration = JSON.parse(raw);
    const site = this.deps.store.siteById(id);
    if (!site) return null;
    return { ...binding, limits: this.effectiveLimits(site), snapshotRetention: this.deps.config().releasesKept };
  }
  private saveBinding(binding: SiteEnvironmentRegistration): void {
    this.deps.store.putRuntimeRecord(binding.siteId, 'binding', JSON.stringify(binding));
  }
  private defaultBinding(site: Site): SiteEnvironmentRegistration {
    const migration = this.deps.store.runtimeMigration(site.id);
    const converted = migration !== null;
    const recipe = converted ? loadAppRecipe(join(this.deps.siteDir(site.id), 'migration', 'artifacts')) : null;
    return {
      siteId: site.id, projectId: site.projectId, sourcePath: converted ? join(this.deps.siteDir(site.id), 'migration', 'workspace') : site.runtime === 'environment' ? site.sourceDir : this.deps.siteDir(site.id),
      sitesDataDir: this.deps.dataDir, brokerDir: this.brokerDirectory(site.id),
      image: recipe ? conversionImageTag(recipe.image) : BASE_IMAGE_TAG,
      workspaceReadOnly: recipe?.image === 'static', network: this.deps.config().environmentNetwork,
      limits: this.effectiveLimits(site), snapshotRetention: this.deps.config().releasesKept,
      staging: converted || site.runtime !== 'environment',
      initialIntent: { desiredState: site.runtime !== 'environment' || site.environmentDesiredState === 'stopped' ? 'stopped' : 'running',
        pendingAction: site.environmentDesiredState === 'restarting' ? 'restart' : null },
    };
  }

  /** Persist pins before registration. Retrying after a lost response adopts the same resource. */
  private async handover(site: Site, accountUserId: number): Promise<void> {
    const inFlight = this.handovers.get(site.id);
    if (inFlight) return inFlight;
    const task = this.handoverNow(site, accountUserId);
    this.handovers.set(site.id, task);
    try { await task; } finally { this.handovers.delete(site.id); }
  }
  private async handoverNow(site: Site, accountUserId: number): Promise<void> {
    const control = this.control();
    if (this.deps.store.runtimeRecord(site.id, 'handover') === 'complete') return;
    let binding = this.registration(site.id);
    if (!binding) {
      this.deps.store.claimRuntimeRecord(site.id, 'binding', JSON.stringify(this.defaultBinding(site)));
      binding = this.registration(site.id)!;
    }
    if (this.deps.store.runtimeRecord(site.id, 'handover') !== 'discovered') {
      const expected = this.deps.store.runtimeRecord(site.id, 'binding')!;
      const discovered = await control.discoverSiteEnvironment({ siteId: site.id, accountUserId });
      if (discovered) binding.legacy = { containerId: discovered.containerId, imageId: discovered.imageId, volumeMountpoint: discovered.volumeMountpoint };
      const next = JSON.stringify(binding);
      if (!this.deps.store.compareRuntimeRecord(site.id, 'binding', expected, next)
        && this.deps.store.runtimeRecord(site.id, 'binding') !== next) {
        throw new Error('the Site handover binding changed during ownership discovery');
      }
      this.deps.store.putRuntimeRecord(site.id, 'handover', 'discovered');
    }
    if (!binding.legacy && site.runtime === 'environment' && binding.initialIntent?.desiredState === 'running') {
      this.deps.store.claimRuntimeRecord(site.id, 'bootstrap-intent', 'running');
      binding.initialIntent = { desiredState: 'stopped', pendingAction: null };
      this.saveBinding(binding);
    }
    const registered = await control.registerSiteEnvironment({ siteId: site.id, accountUserId });
    if (this.deps.store.runtimeRecord(site.id, 'bootstrap-intent') === 'running') {
      const imageKind = binding.image === BASE_IMAGE_TAG ? 'base' : binding.workspaceReadOnly ? 'static' : 'node';
      await this.wait(await control.requestSiteEnvironment({ siteId: site.id, accountUserId,
        action: { kind: 'provision-image', imageKind }, expectedGeneration: registered.generation,
        requestId: `sites-bootstrap-image:${site.id}:${registered.generation}` }), accountUserId);
      await control.requestSiteEnvironment({ siteId: site.id, accountUserId, action: { kind: 'start' },
        expectedGeneration: registered.generation, requestId: `sites-bootstrap-start:${site.id}:${registered.generation}` });
      this.deps.store.putRuntimeRecord(site.id, 'bootstrap-intent', 'complete');
    }
    // Legacy release metadata is retained. The runtime validates the referenced image/archive itself.
    for (const release of this.deps.store.releases(site.id)) {
      if (release.kind !== 'environment-snapshot' || !release.imageRef) continue;
      const key = `imported:${release.id}`;
      if (this.deps.store.runtimeRecord(site.id, key)) continue;
      if (!/^(sha256:)?[a-f0-9]{64}$/.test(release.imageRef)) {
        throw new Error(`legacy snapshot ${release.id} needs a verified image ID; the SDK exposes container discovery but not retained-image discovery`);
      }
      const operation = await this.artifactOperation(site, 'import-snapshot', {
        kind: 'snapshot', snapshotId: release.id, imageReference: release.imageRef,
        imageId: release.imageRef, ...(release.dataArchive ? { archivePath: this.ownedPath(site.id, release.dataArchive) } : {}),
        note: release.note, createdAt: release.createdAt,
      }, accountUserId, `legacy-snapshot:${release.id}`, false);
      await this.wait(operation, accountUserId);
      this.deps.store.putRuntimeRecord(site.id, key, 'complete');
    }
    const pending = this.deps.store.environmentAction(site.id);
    if (pending && !pending.lastError) {
      const operation = await this.wait(await control.requestSiteEnvironment({ siteId: site.id, accountUserId,
        requestId: `sites-handover:${site.id}:${pending.kind}:${pending.snapshotId}`,
        action: pending.kind === 'snapshot' ? { kind: 'snapshot', includeData: pending.includeData, note: pending.note }
          : { kind: 'restore', snapshotId: this.deps.store.runtimeRecord(site.id, `snapshot-runtime:${pending.snapshotId}`) ?? pending.snapshotId, restoreData: pending.restoreData },
      }), accountUserId);
      if (pending.kind === 'snapshot') {
        if (!operation.snapshotId) throw new Error('the migrated snapshot operation completed without its snapshot ID');
        this.deps.store.putRuntimeRecord(site.id, `snapshot-display:${operation.snapshotId}`, pending.snapshotId);
        this.deps.store.putRuntimeRecord(site.id, `snapshot-runtime:${pending.snapshotId}`, operation.snapshotId);
        this.deps.store.putRuntimeRecord(site.id, `snapshot-model:${pending.snapshotId}`, pending.model);
        this.deps.store.putRuntimeRecord(site.id, `snapshot-data:${pending.snapshotId}`, String(pending.includeData));
        await this.syncSnapshots(site, accountUserId);
      }
      this.deps.store.deleteEnvironmentAction(site.id);
    }
    this.deps.store.putRuntimeRecord(site.id, 'handover', 'complete');
  }
  async request(site: Site, action: SiteEnvironmentAction, actor?: number, requestId: string = randomUUID()): Promise<SiteEnvironmentOperation> {
    const accountUserId = this.actor(site, actor);
    await this.handover(site, accountUserId);
    const control = this.control();
    const state = await control.siteEnvironmentFor({ siteId: site.id, accountUserId });
    const binding = this.registration(site.id)!;
    if ((action.kind === 'start' || action.kind === 'restart') && !binding.legacy
      && this.deps.store.runtimeRecord(site.id, 'bootstrap-intent') !== 'complete') {
      await this.wait(await control.requestSiteEnvironment({ siteId: site.id, accountUserId,
        action: { kind: 'provision-image', imageKind: binding.image === BASE_IMAGE_TAG ? 'base' : binding.workspaceReadOnly ? 'static' : 'node' },
        expectedGeneration: state.generation, requestId: `${requestId}:image` }), accountUserId);
    }
    const resolvedAction = action.kind === 'restore' ? { ...action,
      snapshotId: this.deps.store.runtimeRecord(site.id, `snapshot-runtime:${action.snapshotId}`) ?? action.snapshotId } : action;
    return control.requestSiteEnvironment({ siteId: site.id, accountUserId, action: resolvedAction, expectedGeneration: state.generation, requestId });
  }
  private async wait(operation: SiteEnvironmentOperation, accountUserId: number): Promise<SiteEnvironmentOperation> {
    const deadline = Date.now() + Math.max(120_000, this.deps.config().startTimeoutSeconds * 1000);
    while (operation.status === 'pending' || operation.status === 'running') {
      if (Date.now() >= deadline) throw new Error(`environment operation ${operation.id} remains ${operation.status}; it was not cancelled`);
      await new Promise<void>(wake => setTimeout(wake, 100));
      const next = await this.control().siteEnvironmentOperation({ operationId: operation.id, accountUserId });
      if (!next) throw new Error(`environment operation ${operation.id} is unavailable`);
      operation = next;
    }
    if (operation.status !== 'succeeded') throw new Error(operation.error ?? `environment operation ${operation.status}`);
    return operation;
  }
  private async perform(site: Site, action: SiteEnvironmentAction, actor?: number): Promise<SiteEnvironmentOperation> {
    const accountUserId = this.actor(site, actor);
    return this.wait(await this.request(site, action, accountUserId), accountUserId);
  }
  private ownedPath(siteId: string, path: string): string {
    const root = resolve(this.deps.siteDir(siteId));
    const absolute = resolve(path);
    if (!absolute.startsWith(root + sep)) throw new Error('runtime artifact is outside the owning Site');
    const existing = existsSync(absolute) ? absolute : dirname(absolute);
    if (existsSync(existing)) {
      const realRoot = realpathSync(root);
      const real = realpathSync(existing);
      if (real !== realRoot && !real.startsWith(realRoot + sep)) throw new Error('runtime artifact escapes the owning Site');
    }
    return absolute;
  }
  private async artifactOperation(site: Site, action: 'import-data' | 'export-data' | 'import-snapshot' | 'remove-artifact' | 'export-project', artifact: SiteRuntimeArtifact, actor: number, artifactId: string = randomUUID(), register = true): Promise<SiteEnvironmentOperation> {
    this.deps.store.putRuntimeRecord(site.id, `artifact:${artifactId}`, JSON.stringify({ action, artifact }));
    return register ? this.request(site, { kind: action, artifactId }, actor, artifactId)
      : this.control().requestSiteEnvironment({ siteId: site.id, accountUserId: actor, action: { kind: action, artifactId }, requestId: artifactId });
  }
  async exportProject(site: Site, project: ManagedProjectRef, guestPath: string, destinationPath: string, actor: number): Promise<void> {
    if (site.runtime === 'environment' || this.deps.store.runtimeMigration(site.id)) throw new Error('a persistent environment or runtime conversion cannot be used as publication staging');
    const destination = this.ownedPath(site.id, destinationPath);
    this.control();
    const previous = this.registration(site.id);
    if (previous && previous.sourcePath !== destination) {
      if (!previous.staging) throw new Error('publication cannot replace a live Site binding');
      await this.perform(site, { kind: 'cleanup-stage' }, actor);
      this.deps.store.deleteRuntimeRecord(site.id, 'handover');
      this.deps.store.deleteRuntimeRecord(site.id, 'binding');
    }
    if (!this.registration(site.id)) this.saveBinding({ ...this.defaultBinding(site), sourcePath: destination,
      staging: true, initialIntent: { desiredState: 'stopped', pendingAction: null } });
    const artifact: SiteRuntimeArtifact = { kind: 'project-source', project, guestPath, destinationPath: destination };
    await this.wait(await this.artifactOperation(site, 'export-project', artifact, actor), actor);
  }
  endpointFor(id: string): Endpoint | null { return this.endpoints.get(id) ?? null; }
  isRunning(id: string): boolean { return this.endpoints.has(id); }
  effectiveLimits(site: Site): EnvironmentEffectiveLimits {
    const config = this.deps.config();
    return { cpus: site.environmentCpus ?? config.environmentCpus, memoryMb: site.environmentMemoryMb ?? config.environmentMemoryMb,
      pidsLimit: site.environmentPidsLimit ?? config.environmentPidsLimit, diskSoftMb: site.environmentDiskSoftMb ?? config.environmentDiskSoftMb };
  }
  async state(site: Site, actor?: number): Promise<EnvironmentState> {
    const accountUserId = this.actor(site, actor);
    await this.handover(site, accountUserId);
    const state = await this.control().siteEnvironmentFor({ siteId: site.id, accountUserId });
    return { state: state.state, desiredState: state.desiredState === 'running' ? 'running' : 'stopped', limits: state.limits, lastError: state.lastError };
  }
  async exec(site: Site, command: string, options: { timeoutSeconds: number; workdir?: string; accountUserId?: number }): Promise<{ stdout: string; stderr: string; code: number }> {
    const accountUserId = this.actor(site, options.accountUserId);
    await this.handover(site, accountUserId);
    return this.control().siteEnvironmentExec({ siteId: site.id, accountUserId, command, timeoutMs: options.timeoutSeconds * 1000, workdir: options.workdir });
  }
  async logs(site: Site, lines = 200, actor?: number): Promise<{ lifecycle: string; journal: string }> {
    const accountUserId = this.actor(site, actor);
    await this.handover(site, accountUserId);
    return this.control().siteEnvironmentLogs({ siteId: site.id, accountUserId, lines });
  }
  async provision(site: Site, imageKind: SiteImageKind): Promise<void> { await this.perform(site, { kind: 'provision-image', imageKind }); }
  async prepareContainer(site: Site, workspace: string, image = BASE_IMAGE_TAG, workspaceReadOnly = false): Promise<{ created: boolean }> {
    this.control();
    const binding = this.defaultBinding(site);
    binding.sourcePath = this.ownedPath(site.id, workspace);
    binding.image = image; binding.workspaceReadOnly = workspaceReadOnly; binding.staging = true;
    binding.initialIntent = { desiredState: 'stopped', pendingAction: null };
    const previous = this.registration(site.id);
    if (previous && (previous.sourcePath !== binding.sourcePath || previous.image !== binding.image)) {
      if (site.runtime === 'environment' || !previous.staging) throw new Error('a live Site binding cannot be replaced by conversion preparation');
      await this.perform(site, { kind: 'cleanup-stage' });
      this.deps.store.deleteRuntimeRecord(site.id, 'handover');
      this.deps.store.deleteRuntimeRecord(site.id, 'binding');
    }
    this.saveBinding(binding);
    const existing = await this.control().discoverSiteEnvironment({ siteId: site.id, accountUserId: this.actor(site) });
    if (existing) return { created: false };
    await this.provision(site, image === BASE_IMAGE_TAG ? 'base' : workspaceReadOnly ? 'static' : 'node');
    await this.perform(site, { kind: 'prepare' });
    return { created: true };
  }
  async inspectOwnership(id: string, expect?: { workspace: string; image: string }): Promise<{ owned: boolean; workspace: string | null; detail: string } | null> {
    const site = this.site(id);
    if (!this.registration(id)) this.saveBinding(this.defaultBinding(site));
    const discovered = await this.control().discoverSiteEnvironment({ siteId: id, accountUserId: this.actor(site) });
    if (!discovered) return null;
    const binding = this.registration(id)!;
    if (expect && (expect.workspace !== binding.sourcePath || expect.image !== binding.image)) return { owned: false, workspace: binding.sourcePath, detail: 'container binding differs from the expected conversion' };
    return { owned: true, workspace: binding.sourcePath, detail: `container ${discovered.containerId} matches the expected specification` };
  }
  brokerDirectory(id: string): string { return this.deps.brokerPath ? dirname(this.deps.brokerPath(id)) : join('/var/lib/elowen/site-runtime-sockets', id); }
  brokerDirectoryExists(id: string): boolean { try { return statSync(this.brokerDirectory(id)).isDirectory(); } catch { return false; } }
  async prepareBrokerDirectory(id: string): Promise<string> { return dirname((await this.deps.gateway.prepareRuntimeSocket(id)).path); }
  private writeEnvironmentFiles(site: Site): void {
    const dir = join(this.deps.siteDir(site.id), 'environment');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const url = this.deps.siteUrl?.(site);
    writeFileSync(join(dir, 'container.env'), `ELOWEN_SITE_SLUG=${site.slug}\n${url ? `ELOWEN_SITE_URL=${url}\n` : ''}`, { mode: 0o600 });
    const stub = join(dir, 'git-stub');
    if (existsSync(stub)) chmodSync(stub, 0o600);
    writeFileSync(stub, '', { mode: 0o400 }); chmodSync(stub, 0o400);
  }
  async start(site: Site, _options: { authorized?: boolean } = {}): Promise<void> { await this.perform(site, { kind: 'start' }); await this.refreshReadiness(site); }
  async stop(id: string): Promise<void> { await this.perform(this.site(id), { kind: 'stop' }); this.endpoints.delete(id); }
  async quiesce(id: string): Promise<void> { await this.stop(id); }
  async isStopped(id: string): Promise<boolean> { const state = await this.state(this.site(id)); return state.state === 'stopped' || state.state === 'unprovisioned' || state.state === 'deleted'; }
  async restart(site: Site): Promise<void> { await this.perform(site, { kind: 'restart' }); await this.refreshReadiness(site); }
  async applyLimits(site: Site, overrides: EnvironmentLimitOverrides, actor?: number): Promise<void> { await this.perform(site, { kind: 'limits', limits: this.effectiveLimits({ ...site, ...overrides }) }, actor); }
  async importDataVolume(id: string, archive: string): Promise<void> {
    const site = this.site(id), actor = this.actor(site);
    await this.wait(await this.artifactOperation(site, 'import-data', { kind: 'data', archivePath: this.ownedPath(id, archive) }, actor), actor);
  }
  async exportDataVolume(id: string, output: string): Promise<boolean> {
    const site = this.site(id), actor = this.actor(site);
    await this.wait(await this.artifactOperation(site, 'export-data', { kind: 'data', archivePath: this.ownedPath(id, output) }, actor), actor);
    return existsSync(output);
  }
  async removeStaged(paths: readonly string[]): Promise<void> {
    for (const path of paths) {
      const site = this.deps.store.allSites().find(entry => resolve(path).startsWith(resolve(this.deps.siteDir(entry.id)) + sep));
      if (!site) throw new Error('staging artifact has no owning Site');
      const actor = this.actor(site);
      await this.wait(await this.artifactOperation(site, 'remove-artifact', { kind: 'data', archivePath: this.ownedPath(site.id, path) }, actor), actor);
    }
  }
  async delete(id: string, options: { removeBroker?: boolean } = {}): Promise<void> {
    const site = this.site(id);
    await this.perform(site, { kind: site.runtime === 'environment' ? 'delete' : 'cleanup-stage' });
    this.endpoints.delete(id);
    if (this.registration(id)?.staging && options.removeBroker !== false) await this.deps.gateway.removeRuntimeSocket(id);
  }
  async snapshot(site: Site, input: { includeData: boolean; note: string; model: string }, actor?: number): Promise<Release> {
    const result = await this.perform(site, { kind: 'snapshot', includeData: input.includeData, note: input.note }, actor);
    if (!result.snapshotId) throw new Error(`snapshot operation ${result.id} completed without a snapshot ID`);
    this.deps.store.putRuntimeRecord(site.id, `snapshot-model:${result.snapshotId}`, input.model);
    this.deps.store.putRuntimeRecord(site.id, `snapshot-data:${result.snapshotId}`, String(input.includeData));
    await this.syncSnapshots(site, this.actor(site, actor));
    this.deps.store.updateSite(site.id, { currentReleaseId: result.snapshotId });
    const release = this.deps.store.release(site.id, result.snapshotId);
    if (!release) throw new Error('the completed snapshot is not present in the runtime snapshot inventory');
    return release;
  }
  async rollback(site: Site, snapshotId: string, restoreData: boolean, actor?: number): Promise<void> { await this.perform(site, { kind: 'restore', snapshotId, restoreData }, actor); }
  private async syncSnapshots(site: Site, actor: number): Promise<void> {
    const snapshots = await this.control().siteEnvironmentSnapshots({ siteId: site.id, accountUserId: actor });
    for (const snapshot of snapshots) {
      const publicId = this.deps.store.runtimeRecord(site.id, `snapshot-display:${snapshot.id}`) ?? snapshot.id;
      if (this.deps.store.release(site.id, publicId)) continue;
      this.deps.store.insertRelease({ id: publicId, siteId: site.id, createdAt: snapshot.createdAt, model: this.deps.store.runtimeRecord(site.id, `snapshot-model:${publicId}`) ?? '', fileCount: 0, sizeBytes: 0, note: snapshot.note, kind: 'environment-snapshot' });
    }
  }
  private async refreshReadiness(site: Site): Promise<void> {
    const state = await this.state(site);
    const path = join(this.brokerDirectory(site.id), 'app.sock');
    if (state.state !== 'running') { this.endpoints.delete(site.id); return; }
    if (!lstatSync(path).isSocket()) throw new Error('the environment ingress is not a socket');
    await this.deps.gateway.sealRuntimeSocket(site.id);
    const ready = await new Promise<boolean>(done => {
      const socket = connect({ path });
      const finish = (value: boolean): void => { socket.destroy(); done(value); };
      socket.setTimeout(1000); socket.once('connect', () => finish(true)); socket.once('error', () => finish(false)); socket.once('timeout', () => finish(false));
    });
    if (!ready) throw new Error('the sealed environment ingress did not answer');
    this.endpoints.set(site.id, { kind: 'socket', path });
    this.deps.store.updateSite(site.id, { status: 'live', lastError: null });
  }
  async probeReadiness(id: string, expect: { path: string; expectStatus: number }, options: { timeoutMs?: number; deadlineMs?: number } = {}): Promise<{ ready: boolean; detail: string; attempts: number }> {
    const endpoint = this.endpoints.get(id);
    if (!endpoint) return { ready: false, detail: 'the ingress socket has not been adopted', attempts: 0 };
    const deadline = Date.now() + (options.deadlineMs ?? this.deps.config().startTimeoutSeconds * 1000);
    let attempts = 0, detail = 'no response';
    do {
      attempts++;
      const result = await new Promise<number | string>(done => {
        const req = httpRequest({ ...(endpoint.kind === 'socket' ? { socketPath: endpoint.path } : { host: '127.0.0.1', port: endpoint.port }), path: expect.path,
          headers: { host: 'localhost', 'user-agent': 'elowen-conversion-readiness' }, timeout: options.timeoutMs ?? 5000 }, response => { response.resume(); done(response.statusCode ?? 0); });
        req.once('error', error => done(error.message)); req.once('timeout', () => { req.destroy(); done('timed out'); }); req.end();
      });
      if (typeof result === 'number') return { ready: result === expect.expectStatus, detail: `GET ${expect.path} answered ${result}, expected ${expect.expectStatus}`, attempts };
      detail = result;
      if (Date.now() >= deadline) break;
      await new Promise<void>(wake => setTimeout(wake, 250));
    } while (Date.now() <= deadline);
    return { ready: false, detail: `${detail} (gave up after ${attempts} attempt(s))`, attempts };
  }
  /** Observe application readiness only. Sandbox independently reconciles durable container intent. */
  async reconcile(): Promise<void> {
    for (const site of this.deps.store.environmentSitesForReconcile()) {
      try {
        await this.handover(site, this.actor(site));
        await this.syncSnapshots(site, this.actor(site));
        await this.refreshReadiness(site);
      } catch (error) {
        this.endpoints.delete(site.id);
        const message = error instanceof Error ? error.message : String(error);
        this.deps.store.updateSite(site.id, { status: 'failed', lastError: message });
        this.deps.logger?.warn(`site ${site.slug} readiness failed: ${message}`);
      }
    }
  }
  async detach(): Promise<void> { this.endpoints.clear(); this.connected = undefined; }
}
