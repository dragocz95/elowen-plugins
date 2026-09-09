import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { dirname, join, resolve, sep } from 'node:path';
import { createSiteRuntimeAuthority } from './siteRuntimeAuthority.js';
import { BASE_IMAGE_TAG, baseImageRecipe } from './baseImage.js';
import { conversionImageRecipe, conversionImageTag } from './conversionImage.js';
import { loadAppRecipe } from './recipe.js';
/** Application readiness and Sites records only. All container mutations belong to Sandbox. */
export class EnvironmentSupervisor {
    deps;
    endpoints = new Map();
    authority;
    connected;
    handovers = new Map();
    constructor(deps) {
        this.deps = deps;
        this.authority = createSiteRuntimeAuthority({
            store: deps.store, access: deps.access,
            registration: id => this.registration(id), gateway: () => deps.gateway,
            beforeCreate: async (id) => {
                this.writeEnvironmentFiles(this.site(id));
                if (!this.brokerDirectoryExists(id))
                    await this.prepareBrokerDirectory(id);
            },
            imageRecipe: kind => kind === 'base' ? baseImageRecipe() : conversionImageRecipe(kind),
            projectDependents: async (projectId) => deps.store.allSites().filter(site => site.projectId === projectId).map(site => ({ siteId: site.id })),
            resolveArtifact: async ({ siteId, accountUserId, artifactId, action }) => {
                if (!await this.authority.resolve({ siteId, accountUserId, access: 'manage' }))
                    return null;
                const raw = deps.store.runtimeRecord(siteId, `artifact:${artifactId}`);
                if (!raw)
                    return null;
                const record = JSON.parse(raw);
                if (record.action !== action) {
                    // Runtime retention prunes a retained snapshot through the SAME trusted record that imported
                    // it: the record is the artifact's identity, and removal is a later operation on it. Nothing
                    // else crosses, and no image id is invented here.
                    if (!(action === 'remove-artifact' && record.action === 'import-snapshot' && record.artifact.kind === 'snapshot'))
                        return null;
                }
                return record.artifact;
            },
        });
    }
    connect() { if (this.deps.control())
        this.control(); }
    control() {
        const control = this.deps.control();
        if (!control)
            throw new Error('the Sandbox environment runtime is unavailable');
        if (this.connected !== control) {
            control.connectSitesRuntime(this.authority);
            this.connected = control;
        }
        return control;
    }
    site(id) {
        const site = this.deps.store.siteById(id);
        if (!site)
            throw new Error('the site no longer exists');
        return site;
    }
    actor(site, supplied) {
        return supplied ?? this.deps.accountUserId?.() ?? site.ownerUserId;
    }
    registration(id) {
        const raw = this.deps.store.runtimeRecord(id, 'binding');
        if (!raw)
            return null;
        const binding = JSON.parse(raw);
        const site = this.deps.store.siteById(id);
        if (!site)
            return null;
        return { ...binding, limits: this.effectiveLimits(site), snapshotRetention: this.deps.config().releasesKept };
    }
    saveBinding(binding) {
        this.deps.store.putRuntimeRecord(binding.siteId, 'binding', JSON.stringify(binding));
    }
    defaultBinding(site) {
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
    async handover(site, accountUserId) {
        const inFlight = this.handovers.get(site.id);
        if (inFlight)
            return inFlight;
        const task = this.handoverNow(site, accountUserId);
        this.handovers.set(site.id, task);
        try {
            await task;
        }
        finally {
            this.handovers.delete(site.id);
        }
    }
    async handoverNow(site, accountUserId) {
        const control = this.control();
        if (this.deps.store.runtimeRecord(site.id, 'handover') === 'complete')
            return;
        let binding = this.registration(site.id);
        if (!binding) {
            this.deps.store.claimRuntimeRecord(site.id, 'binding', JSON.stringify(this.defaultBinding(site)));
            binding = this.registration(site.id);
        }
        if (this.deps.store.runtimeRecord(site.id, 'handover') !== 'discovered') {
            const expected = this.deps.store.runtimeRecord(site.id, 'binding');
            const discovered = await control.discoverSiteEnvironment({ siteId: site.id, accountUserId });
            if (discovered)
                binding.legacy = { containerId: discovered.containerId, imageId: discovered.imageId, volumeMountpoint: discovered.volumeMountpoint };
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
            if (release.kind !== 'environment-snapshot' || !release.imageRef)
                continue;
            const key = `imported:${release.id}`;
            if (this.deps.store.runtimeRecord(site.id, key))
                continue;
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
                if (!operation.snapshotId)
                    throw new Error('the migrated snapshot operation completed without its snapshot ID');
                this.deps.store.putRuntimeRecord(site.id, `snapshot-display:${operation.snapshotId}`, pending.snapshotId);
                this.deps.store.putRuntimeRecord(site.id, `snapshot-runtime:${pending.snapshotId}`, operation.snapshotId);
                this.deps.store.putRuntimeRecord(site.id, `snapshot-model:${pending.snapshotId}`, pending.model);
                this.deps.store.putRuntimeRecord(site.id, `snapshot-data:${pending.snapshotId}`, String(pending.includeData));
                await this.syncSnapshots(site, accountUserId);
            }
            else if (this.deps.store.release(site.id, pending.snapshotId)) {
                // A completed restore moves the public snapshot pointer; a completed snapshot never does.
                this.deps.store.updateSite(site.id, { currentReleaseId: pending.snapshotId });
            }
            this.deps.store.deleteEnvironmentAction(site.id);
        }
        this.deps.store.putRuntimeRecord(site.id, 'handover', 'complete');
    }
    async request(site, action, actor, requestId = randomUUID(), authorizedConversion = false) {
        if (!authorizedConversion && this.deps.store.conversionSuspends(site.id) === 'environment')
            throw new Error('the environment is held by a runtime conversion');
        const accountUserId = this.actor(site, actor);
        await this.handover(site, accountUserId);
        const control = this.control();
        const state = await control.siteEnvironmentFor({ siteId: site.id, accountUserId });
        const binding = this.registration(site.id);
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
    async wait(operation, accountUserId) {
        const deadline = Date.now() + Math.max(120_000, this.deps.config().startTimeoutSeconds * 1000);
        while (operation.status === 'pending' || operation.status === 'running') {
            if (Date.now() >= deadline)
                throw new Error(`environment operation ${operation.id} remains ${operation.status}; it was not cancelled`);
            await new Promise(wake => setTimeout(wake, 100));
            const next = await this.control().siteEnvironmentOperation({ operationId: operation.id, accountUserId });
            if (!next)
                throw new Error(`environment operation ${operation.id} is unavailable`);
            operation = next;
        }
        if (operation.status !== 'succeeded')
            throw new Error(operation.error ?? `environment operation ${operation.status}`);
        return operation;
    }
    async perform(site, action, actor, authorizedConversion = false) {
        const accountUserId = this.actor(site, actor);
        return this.wait(await this.request(site, action, accountUserId, randomUUID(), authorizedConversion), accountUserId);
    }
    ownedPath(siteId, path) {
        const root = resolve(this.deps.siteDir(siteId));
        const absolute = resolve(path);
        if (!absolute.startsWith(root + sep))
            throw new Error('runtime artifact is outside the owning Site');
        const existing = existsSync(absolute) ? absolute : dirname(absolute);
        if (existsSync(existing)) {
            const realRoot = realpathSync(root);
            const real = realpathSync(existing);
            if (real !== realRoot && !real.startsWith(realRoot + sep))
                throw new Error('runtime artifact escapes the owning Site');
        }
        return absolute;
    }
    async artifactOperation(site, action, artifact, actor, artifactId = randomUUID(), register = true) {
        this.deps.store.putRuntimeRecord(site.id, `artifact:${artifactId}`, JSON.stringify({ action, artifact }));
        return register ? this.request(site, { kind: action, artifactId }, actor, artifactId, true)
            : this.control().requestSiteEnvironment({ siteId: site.id, accountUserId: actor, action: { kind: action, artifactId }, requestId: artifactId });
    }
    async exportProject(site, project, guestPath, destinationPath, actor) {
        if (site.runtime === 'environment' || this.deps.store.runtimeMigration(site.id))
            throw new Error('a persistent environment or runtime conversion cannot be used as publication staging');
        const destination = this.ownedPath(site.id, destinationPath);
        this.control();
        const previous = this.registration(site.id);
        if (previous && previous.sourcePath !== destination) {
            if (!previous.staging)
                throw new Error('publication cannot replace a live Site binding');
            await this.perform(site, { kind: 'cleanup-stage' }, actor);
            this.deps.store.deleteRuntimeRecord(site.id, 'handover');
            this.deps.store.deleteRuntimeRecord(site.id, 'binding');
        }
        if (!this.registration(site.id))
            this.saveBinding({ ...this.defaultBinding(site), sourcePath: destination,
                staging: true, initialIntent: { desiredState: 'stopped', pendingAction: null } });
        const artifact = { kind: 'project-source', project, guestPath, destinationPath: destination };
        await this.wait(await this.artifactOperation(site, 'export-project', artifact, actor), actor);
    }
    endpointFor(id) { return this.endpoints.get(id) ?? null; }
    isRunning(id) { return this.endpoints.has(id); }
    effectiveLimits(site) {
        const config = this.deps.config();
        return { cpus: site.environmentCpus ?? config.environmentCpus, memoryMb: site.environmentMemoryMb ?? config.environmentMemoryMb,
            pidsLimit: site.environmentPidsLimit ?? config.environmentPidsLimit, diskSoftMb: site.environmentDiskSoftMb ?? config.environmentDiskSoftMb };
    }
    async state(site, actor) {
        const accountUserId = this.actor(site, actor);
        await this.handover(site, accountUserId);
        const state = await this.control().siteEnvironmentFor({ siteId: site.id, accountUserId });
        return { state: state.state, desiredState: state.desiredState === 'running' ? 'running' : 'stopped', limits: state.limits, lastError: state.lastError };
    }
    async exec(site, command, options) {
        const accountUserId = this.actor(site, options.accountUserId);
        await this.handover(site, accountUserId);
        return this.control().siteEnvironmentExec({ siteId: site.id, accountUserId, command, timeoutMs: options.timeoutSeconds * 1000, workdir: options.workdir });
    }
    async logs(site, lines = 200, actor) {
        const accountUserId = this.actor(site, actor);
        await this.handover(site, accountUserId);
        return this.control().siteEnvironmentLogs({ siteId: site.id, accountUserId, lines: Math.min(1000, Math.max(1, Math.round(lines))) });
    }
    async provision(site, imageKind) { await this.perform(site, { kind: 'provision-image', imageKind }); }
    async prepareContainer(site, workspace, image = BASE_IMAGE_TAG, workspaceReadOnly = false) {
        this.control();
        const binding = this.defaultBinding(site);
        binding.sourcePath = this.ownedPath(site.id, workspace);
        binding.image = image;
        binding.workspaceReadOnly = workspaceReadOnly;
        binding.staging = true;
        binding.initialIntent = { desiredState: 'stopped', pendingAction: null };
        const previous = this.registration(site.id);
        if (previous && (previous.sourcePath !== binding.sourcePath || previous.image !== binding.image)) {
            if (site.runtime === 'environment' || !previous.staging)
                throw new Error('a live Site binding cannot be replaced by conversion preparation');
            await this.perform(site, { kind: 'cleanup-stage' });
            this.deps.store.deleteRuntimeRecord(site.id, 'handover');
            this.deps.store.deleteRuntimeRecord(site.id, 'binding');
        }
        this.saveBinding(binding);
        const existing = await this.control().discoverSiteEnvironment({ siteId: site.id, accountUserId: this.actor(site) });
        if (existing)
            return { created: false };
        await this.provision(site, image === BASE_IMAGE_TAG ? 'base' : workspaceReadOnly ? 'static' : 'node');
        await this.perform(site, { kind: 'prepare' });
        return { created: true };
    }
    async inspectOwnership(id, expect) {
        const site = this.site(id);
        if (!this.registration(id))
            this.saveBinding(this.defaultBinding(site));
        const discovered = await this.control().discoverSiteEnvironment({ siteId: id, accountUserId: this.actor(site) });
        if (!discovered)
            return null;
        const binding = this.registration(id);
        if (expect && (expect.workspace !== binding.sourcePath || expect.image !== binding.image))
            return { owned: false, workspace: binding.sourcePath, detail: 'container binding differs from the expected conversion' };
        return { owned: true, workspace: binding.sourcePath, detail: `container ${discovered.containerId} matches the expected specification` };
    }
    brokerDirectory(id) { return this.deps.brokerPath ? dirname(this.deps.brokerPath(id)) : join('/var/lib/elowen/site-runtime-sockets', id); }
    brokerDirectoryExists(id) { try {
        return statSync(this.brokerDirectory(id)).isDirectory();
    }
    catch {
        return false;
    } }
    async prepareBrokerDirectory(id) { return dirname((await this.deps.gateway.prepareRuntimeSocket(id)).path); }
    /** WHERE THE SANDBOX RUNTIME CONTRACT LIVES, which is not where the site's sources and releases live.
     *  `siteDir` is `<dataDir>/sites/<id>` — the plugin's own source layout — while Sandbox is handed
     *  `sitesDataDir: deps.dataDir` and builds the bind sources as `<sitesDataDir>/<id>/environment`
     *  (containerSpec `storageRoot`). Rooting these files at `siteDir` therefore wrote them one level too
     *  deep, under `<dataDir>/sites/<id>/environment`, and every container create failed lstat-ing the
     *  `git-stub` bind source that Sandbox looked for at `<dataDir>/<id>/environment`. The two roots must be
     *  derived from the same value Sandbox receives. */
    environmentStorageDir(siteId) { return join(this.deps.dataDir, siteId, 'environment'); }
    writeEnvironmentFiles(site) {
        const dir = this.environmentStorageDir(site.id);
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        const url = this.deps.siteUrl?.(site);
        writeFileSync(join(dir, 'container.env'), `ELOWEN_SITE_SLUG=${site.slug}\n${url ? `ELOWEN_SITE_URL=${url}\n` : ''}`, { mode: 0o600 });
        const stub = join(dir, 'git-stub');
        if (existsSync(stub))
            chmodSync(stub, 0o600);
        writeFileSync(stub, '', { mode: 0o400 });
        chmodSync(stub, 0o400);
    }
    async start(site, options = {}) {
        if (!options.authorized && this.deps.store.conversionSuspends(site.id) === 'environment')
            throw new Error('the environment is held by a runtime conversion');
        if ((await this.state(site)).state !== 'running')
            await this.perform(site, { kind: 'start' }, undefined, options.authorized);
        await this.refreshReadiness(site);
    }
    async stop(id) { await this.perform(this.site(id), { kind: 'stop' }); this.endpoints.delete(id); }
    async quiesce(id) { await this.perform(this.site(id), { kind: 'stop' }, undefined, true); this.endpoints.delete(id); }
    async isStopped(id) { const state = await this.state(this.site(id)); return state.state === 'stopped' || state.state === 'unprovisioned' || state.state === 'deleted'; }
    async restart(site) { await this.perform(site, { kind: 'restart' }); await this.refreshReadiness(site); }
    async applyLimits(site, overrides, actor) {
        await this.perform(site, { kind: 'limits', limits: this.effectiveLimits({ ...site, ...overrides }) }, actor);
        this.deps.store.updateSite(site.id, overrides);
    }
    async importDataVolume(id, archive) {
        const site = this.site(id), actor = this.actor(site);
        await this.wait(await this.artifactOperation(site, 'import-data', { kind: 'data', archivePath: this.ownedPath(id, archive) }, actor), actor);
    }
    async exportDataVolume(id, output) {
        const site = this.site(id), actor = this.actor(site);
        await this.wait(await this.artifactOperation(site, 'export-data', { kind: 'data', archivePath: this.ownedPath(id, output) }, actor), actor);
        return existsSync(output);
    }
    async removeStaged(paths) {
        for (const path of paths) {
            const site = this.deps.store.allSites().find(entry => resolve(path).startsWith(resolve(this.deps.siteDir(entry.id)) + sep));
            if (!site)
                throw new Error('staging artifact has no owning Site');
            const actor = this.actor(site);
            await this.wait(await this.artifactOperation(site, 'remove-artifact', { kind: 'data', archivePath: this.ownedPath(site.id, path) }, actor), actor);
        }
    }
    async delete(id, options = {}) {
        const site = this.site(id);
        await this.perform(site, { kind: site.runtime === 'environment' ? 'delete' : 'cleanup-stage' }, undefined, true);
        this.endpoints.delete(id);
        if (this.registration(id)?.staging && options.removeBroker !== false)
            await this.deps.gateway.removeRuntimeSocket(id);
    }
    /** Schedule a snapshot and return its stable public id immediately, after the receipt is durable and
     *  the runtime has accepted the request under that request id. Completion is observed by the
     *  reconcile recovery, never by blocking the caller. */
    async scheduleSnapshot(site, input, actor) {
        const { key, receipt } = await this.openSnapshotReceipt(site, input, actor);
        try {
            const operation = await this.request(site, { kind: 'snapshot', includeData: input.includeData, note: input.note }, receipt.accountUserId, receipt.requestId);
            receipt.operationId = operation.id;
            this.deps.store.putRuntimeRecord(site.id, key, JSON.stringify(receipt));
        }
        catch (error) {
            this.abandonReceipt(site, key, receipt);
            throw error;
        }
        return { id: receipt.publicId };
    }
    /** The receipt and the visible action row precede dispatch. A lost response replays the same runtime
     *  request key; a structural rejection leaves nothing behind for recovery to re-dispatch. */
    async openSnapshotReceipt(site, input, actor) {
        const accountUserId = this.actor(site, actor);
        await this.handover(site, accountUserId);
        const receipt = {
            requestId: randomUUID(), accountUserId, kind: 'snapshot', publicId: randomUUID(),
            requestedAt: new Date().toISOString(),
            input: { includeData: input.includeData, note: input.note, model: input.model },
        };
        const key = `snapshot-request:${receipt.requestId}`;
        this.deps.store.putRuntimeRecord(site.id, key, JSON.stringify(receipt));
        if (!this.deps.store.beginEnvironmentAction({ siteId: site.id, kind: 'snapshot', snapshotId: receipt.publicId,
            includeData: input.includeData, note: input.note, model: input.model, requestedAt: receipt.requestedAt, lastError: null })) {
            this.deps.store.deleteRuntimeRecord(site.id, key);
            throw new Error('another environment action or execution is in progress');
        }
        return { key, receipt };
    }
    /** Schedule a restore through the provider without touching the second desired-state authority, and
     *  remember the receipt so a completed restore moves the public snapshot pointer exactly once. */
    async scheduleRestore(site, snapshotId, restoreData, actor) {
        const accountUserId = this.actor(site, actor);
        await this.handover(site, accountUserId);
        const receipt = {
            requestId: randomUUID(), accountUserId, kind: 'restore', publicId: snapshotId,
            requestedAt: new Date().toISOString(),
            input: { includeData: true, note: '', model: '', restoreData },
        };
        const key = `restore-request:${receipt.requestId}`;
        this.deps.store.putRuntimeRecord(site.id, key, JSON.stringify(receipt));
        if (!this.deps.store.beginEnvironmentAction({ siteId: site.id, kind: 'rollback', snapshotId, restoreData,
            requestedAt: receipt.requestedAt, lastError: null })) {
            this.deps.store.deleteRuntimeRecord(site.id, key);
            throw new Error('another environment action or execution is in progress');
        }
        try {
            const operation = await this.request(site, { kind: 'restore', snapshotId: this.runtimeSnapshotId(site, snapshotId), restoreData }, accountUserId, receipt.requestId);
            receipt.operationId = operation.id;
            this.deps.store.putRuntimeRecord(site.id, key, JSON.stringify(receipt));
        }
        catch (error) {
            this.abandonReceipt(site, key, receipt);
            throw error;
        }
    }
    /** Read-only projection of the visible action row against the runtime operation its receipt stands
     *  for. It never dispatches, claims or writes anything: durable answers belong to recovery. */
    async pendingAction(site, actor) {
        const action = this.deps.store.environmentAction(site.id);
        if (!action || action.lastError !== null)
            return action;
        const prefix = action.kind === 'snapshot' ? 'snapshot-request:' : 'restore-request:';
        const entry = this.deps.store.runtimeRecords(site.id, prefix).find((candidate) => {
            const receipt = JSON.parse(candidate.value);
            return receipt.publicId === action.snapshotId && typeof receipt.operationId === 'string';
        });
        if (!entry)
            return action;
        try {
            const receipt = JSON.parse(entry.value);
            const operation = await this.control().siteEnvironmentOperation({ operationId: receipt.operationId, accountUserId: this.actor(site, actor) });
            if (!operation || operation.status === 'pending' || operation.status === 'running' || operation.status === 'succeeded') {
                return { ...action, lastError: null };
            }
            return { ...action, lastError: operation.error ?? `environment operation ${operation.status}` };
        }
        catch {
            return action;
        }
    }
    /** Resolve one receipt against the runtime. Pending leaves everything for the next recovery sweep. A
     *  terminal result maps the runtime snapshot id to the promised public id, makes the view metadata
     *  durable, and only then finalizes the receipt and the visible action row. */
    async settleReceipt(site, key, receipt) {
        const operation = receipt.operationId
            ? await this.control().siteEnvironmentOperation({ operationId: receipt.operationId, accountUserId: receipt.accountUserId })
            : await this.request(site, receipt.kind === 'restore'
                ? { kind: 'restore', snapshotId: this.runtimeSnapshotId(site, receipt.publicId ?? ''), restoreData: receipt.input.restoreData === true }
                : { kind: 'snapshot', includeData: receipt.input.includeData, note: receipt.input.note }, receipt.accountUserId, receipt.requestId);
        if (!operation)
            throw new Error(`environment operation ${receipt.operationId} is unavailable`);
        if (!receipt.operationId) {
            receipt.operationId = operation.id;
            this.deps.store.putRuntimeRecord(site.id, key, JSON.stringify(receipt));
        }
        if (operation.status === 'pending' || operation.status === 'running')
            return null;
        if (operation.status !== 'succeeded') {
            const error = operation.error ?? `environment operation ${operation.status}`;
            this.failEnvironmentAction(site, receipt, error);
            this.deps.store.deleteRuntimeRecord(site.id, key);
            throw new Error(error);
        }
        if (receipt.kind === 'restore') {
            this.completeRestoreReceipt(site, key, receipt);
            return null;
        }
        return this.completeSnapshotReceipt(site, key, receipt, operation);
    }
    async completeSnapshotReceipt(site, key, receipt, operation) {
        const runtimeId = operation.snapshotId;
        if (!runtimeId)
            throw new Error(`environment operation ${operation.id} completed without a snapshot ID`);
        const publicId = receipt.publicId ?? runtimeId;
        if (publicId !== runtimeId) {
            this.deps.store.putRuntimeRecord(site.id, `snapshot-display:${runtimeId}`, publicId);
            this.deps.store.putRuntimeRecord(site.id, `snapshot-runtime:${publicId}`, runtimeId);
        }
        this.deps.store.putRuntimeRecord(site.id, `snapshot-model:${publicId}`, receipt.input.model);
        this.deps.store.putRuntimeRecord(site.id, `snapshot-data:${publicId}`, String(receipt.input.includeData));
        await this.syncSnapshots(site, receipt.accountUserId);
        const release = this.deps.store.release(site.id, publicId);
        if (!release) {
            this.deps.store.deleteRuntimeRecord(site.id, key);
            this.deps.store.deleteRuntimeRecord(site.id, `snapshot-model:${publicId}`);
            this.deps.store.deleteRuntimeRecord(site.id, `snapshot-data:${publicId}`);
            throw new Error(`completed snapshot ${publicId} is no longer retained`);
        }
        // Merely taking a snapshot preserves the current pointer; only a completed restore moves it.
        this.deps.store.deleteRuntimeRecord(site.id, key);
        const action = this.deps.store.environmentAction(site.id);
        if (action?.kind === 'snapshot' && action.snapshotId === publicId)
            this.deps.store.deleteEnvironmentAction(site.id);
        return release;
    }
    completeRestoreReceipt(site, key, receipt) {
        if (receipt.publicId && this.deps.store.release(site.id, receipt.publicId)) {
            this.deps.store.updateSite(site.id, { currentReleaseId: receipt.publicId });
        }
        this.deps.store.deleteRuntimeRecord(site.id, key);
        const action = this.deps.store.environmentAction(site.id);
        if (action?.kind === 'rollback' && action.snapshotId === receipt.publicId)
            this.deps.store.deleteEnvironmentAction(site.id);
        return null;
    }
    /** The failed operation may only mark its OWN visible row: a newer accepted request owns the slot by
     *  then, and an active operation is never wiped by an older one. */
    failEnvironmentAction(site, receipt, error) {
        const action = this.deps.store.environmentAction(site.id);
        if (!action || action.lastError !== null || action.snapshotId !== receipt.publicId)
            return;
        this.deps.store.updateEnvironmentActionError(site.id, error);
    }
    /** A structural rejection happened before the runtime recorded an operation. The request must not be
     *  re-dispatched later, so the receipt and the just-claimed visible row are dropped. */
    abandonReceipt(site, key, receipt) {
        if (receipt.operationId)
            return;
        this.deps.store.deleteRuntimeRecord(site.id, key);
        const action = this.deps.store.environmentAction(site.id);
        if (action && action.lastError === null && action.snapshotId === receipt.publicId) {
            this.deps.store.deleteEnvironmentAction(site.id);
        }
    }
    async recoverSnapshots(site) {
        for (const prefix of ['snapshot-request:', 'restore-request:']) {
            for (const entry of this.deps.store.runtimeRecords(site.id, prefix)) {
                const receipt = JSON.parse(entry.value);
                try {
                    await this.settleReceipt(site, entry.key, receipt);
                }
                catch (error) {
                    this.deps.logger?.warn(`site ${site.slug} environment action recovery failed: ${String(error)}`);
                }
            }
        }
    }
    /** The runtime id a public release stands for. They differ only where a promised public id was linked
     *  to the id the runtime minted; an unlinked release is its own runtime id. */
    runtimeSnapshotId(site, publicId) {
        return this.deps.store.runtimeRecord(site.id, `snapshot-runtime:${publicId}`) ?? publicId;
    }
    /** The public id a retained runtime snapshot is shown as. The forward and reverse records are written
     *  as two rows, so a crash between them can leave only the reverse one; reading both directions keeps
     *  retention from mistaking a still-retained release for a pruned one and deleting it. */
    displaySnapshotId(site, runtimeId) {
        const forward = this.deps.store.runtimeRecord(site.id, `snapshot-display:${runtimeId}`);
        if (forward)
            return forward;
        const reverse = this.deps.store.runtimeRecords(site.id, 'snapshot-runtime:').find((record) => record.value === runtimeId);
        return reverse ? reverse.key.slice('snapshot-runtime:'.length) : runtimeId;
    }
    async syncSnapshots(site, actor) {
        const snapshots = await this.control().siteEnvironmentSnapshots({ siteId: site.id, accountUserId: actor });
        this.deps.store.transaction(() => {
            const retained = new Set();
            for (const snapshot of snapshots) {
                const publicId = this.displaySnapshotId(site, snapshot.id);
                retained.add(publicId);
                if (this.deps.store.release(site.id, publicId))
                    continue;
                this.deps.store.insertRelease({ id: publicId, siteId: site.id, createdAt: snapshot.createdAt, model: this.deps.store.runtimeRecord(site.id, `snapshot-model:${publicId}`) ?? '', fileCount: 0, sizeBytes: 0, note: snapshot.note, kind: 'environment-snapshot' });
            }
            for (const release of this.deps.store.releases(site.id)) {
                if (release.kind !== 'environment-snapshot' || retained.has(release.id))
                    continue;
                this.deps.store.deleteRelease(site.id, release.id);
                const runtimeId = this.deps.store.runtimeRecord(site.id, `snapshot-runtime:${release.id}`) ?? release.id;
                this.deps.store.deleteRuntimeRecord(site.id, `snapshot-display:${runtimeId}`);
                for (const prefix of ['snapshot-model:', 'snapshot-data:', 'snapshot-runtime:'])
                    this.deps.store.deleteRuntimeRecord(site.id, prefix + release.id);
                if (this.site(site.id).currentReleaseId === release.id)
                    this.deps.store.updateSite(site.id, { currentReleaseId: [...retained][0] ?? null });
            }
        });
    }
    async refreshReadiness(site) {
        const state = await this.state(site);
        const path = join(this.brokerDirectory(site.id), 'app.sock');
        if (state.state !== 'running') {
            this.endpoints.delete(site.id);
            // Returning here for EVERY non-running state left a Site whose container never came up reading
            // `status: live, lastError: null`, so SiteList and SiteGet advertised an environment that had failed
            // four lifecycle attempts. Only `failed` is projected: `stopped` is an explicit intent and the rest
            // are transient lifecycle steps, neither of which should overwrite the row. Recovery to `live` stays
            // where it belongs, below, after healthy ingress.
            if (state.state === 'failed') {
                const lastError = state.lastError ?? 'the environment failed to start';
                const current = this.site(site.id);
                if (current.status !== 'failed' || current.lastError !== lastError) {
                    this.deps.store.updateSite(site.id, { status: 'failed', lastError });
                }
            }
            return;
        }
        if (!lstatSync(path).isSocket())
            throw new Error('the environment ingress is not a socket');
        if ((statSync(this.brokerDirectory(site.id)).mode & 0o777) !== 0o510)
            await this.deps.gateway.sealRuntimeSocket(site.id);
        const ready = await new Promise(done => {
            const socket = connect({ path });
            const finish = (value) => { socket.destroy(); done(value); };
            socket.setTimeout(1000);
            socket.once('connect', () => finish(true));
            socket.once('error', () => finish(false));
            socket.once('timeout', () => finish(false));
        });
        if (!ready)
            throw new Error('the sealed environment ingress did not answer');
        this.endpoints.set(site.id, { kind: 'socket', path });
        this.deps.store.updateSite(site.id, { status: 'live', lastError: null });
    }
    async probeReadiness(id, expect, options = {}) {
        const endpoint = this.endpoints.get(id);
        if (!endpoint)
            return { ready: false, detail: 'the ingress socket has not been adopted', attempts: 0 };
        const deadline = Date.now() + (options.deadlineMs ?? this.deps.config().startTimeoutSeconds * 1000);
        let attempts = 0, detail = 'no response';
        do {
            attempts++;
            const result = await new Promise(done => {
                const req = httpRequest({ ...(endpoint.kind === 'socket' ? { socketPath: endpoint.path } : { host: '127.0.0.1', port: endpoint.port }), path: expect.path,
                    headers: { host: 'localhost', 'user-agent': 'elowen-conversion-readiness' }, timeout: options.timeoutMs ?? 5000 }, response => { response.resume(); done(response.statusCode ?? 0); });
                req.once('error', error => done(error.message));
                req.once('timeout', () => { req.destroy(); done('timed out'); });
                req.end();
            });
            if (typeof result === 'number')
                return { ready: result === expect.expectStatus, detail: `GET ${expect.path} answered ${result}, expected ${expect.expectStatus}`, attempts };
            detail = result;
            if (Date.now() >= deadline)
                break;
            await new Promise(wake => setTimeout(wake, 250));
        } while (Date.now() <= deadline);
        return { ready: false, detail: `${detail} (gave up after ${attempts} attempt(s))`, attempts };
    }
    /** Observe application readiness only. Sandbox independently reconciles durable container intent. */
    async reconcile() {
        for (const site of this.deps.store.environmentSitesForReconcile()) {
            if (this.deps.store.conversionSuspends(site.id) === 'environment') {
                this.endpoints.delete(site.id);
                continue;
            }
            try {
                await this.handover(site, this.actor(site));
                await this.recoverSnapshots(site);
                await this.syncSnapshots(site, this.actor(site));
                await this.refreshReadiness(site);
            }
            catch (error) {
                this.endpoints.delete(site.id);
                const message = error instanceof Error ? error.message : String(error);
                this.deps.store.updateSite(site.id, { status: 'failed', lastError: message });
                this.deps.logger?.warn(`site ${site.slug} readiness failed: ${message}`);
            }
        }
    }
    async detach() { this.endpoints.clear(); this.connected = undefined; }
}
