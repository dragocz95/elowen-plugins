import { randomUUID } from 'node:crypto';
import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { dirname, join, resolve, sep } from 'node:path';
const STOP_TIMEOUT_SECONDS = 8;
const EXIT_WAIT_MS = 30_000;
const KILL_WAIT_MS = 5_000;
const LOG_CAP_BYTES = 256 * 1024;
const containerName = (siteId) => `elowen-site-${siteId}`;
const volumeName = (siteId) => `elowen-site-${siteId}-data`;
const defaultSleep = async (milliseconds) => {
    await new Promise((resolve) => {
        const timer = setTimeout(resolve, milliseconds);
        timer.unref?.();
    });
};
const defaultSocketReady = async (path) => {
    try {
        return lstatSync(path).isSocket();
    }
    catch {
        return false;
    }
};
const defaultConnectReady = async (endpoint) => await new Promise((resolve) => {
    const socket = connect(endpoint.kind === 'socket' ? { path: endpoint.path } : { host: '127.0.0.1', port: endpoint.port });
    socket.setTimeout(1_000);
    const finish = (ready) => { socket.destroy(); resolve(ready); };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
});
export class EnvironmentSupervisor {
    deps;
    endpoints = new Map();
    settledStopped = new Set();
    queues = new Map();
    sleep;
    now;
    socketReady;
    connectReady;
    detached = false;
    constructor(deps) {
        this.deps = deps;
        this.sleep = deps.sleep ?? defaultSleep;
        this.now = deps.now ?? Date.now;
        this.socketReady = deps.socketReady ?? defaultSocketReady;
        this.connectReady = deps.connectReady ?? defaultConnectReady;
    }
    serialize(siteId, operation) {
        const previous = this.queues.get(siteId) ?? Promise.resolve();
        const next = previous.then(operation, operation);
        this.queues.set(siteId, next.then(() => undefined, () => undefined));
        return next;
    }
    endpointFor(siteId) {
        return this.endpoints.get(siteId) ?? null;
    }
    isRunning(siteId) {
        return this.endpoints.has(siteId);
    }
    environmentDir(siteId) {
        return join(this.deps.siteDir(siteId), 'environment');
    }
    logFile(siteId) {
        const dir = this.environmentDir(siteId);
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        return join(dir, 'lifecycle.log');
    }
    appendLog(siteId, message) {
        try {
            const file = this.logFile(siteId);
            appendFileSync(file, `${new Date(this.now()).toISOString()} ${message}\n`, { mode: 0o600 });
            const content = readFileSync(file);
            if (content.length > LOG_CAP_BYTES * 2)
                writeFileSync(file, content.subarray(content.length - LOG_CAP_BYTES), { mode: 0o600 });
        }
        catch {
            // Lifecycle must not fail because its diagnostic tail could not be written.
        }
    }
    logTail(siteId, bytes = 8192) {
        try {
            return readFileSync(this.logFile(siteId), 'utf8').slice(-bytes);
        }
        catch {
            return '';
        }
    }
    async state(site) {
        const state = site.runtime === 'environment'
            ? await this.deps.podman.inspectStatus(containerName(site.id))
            : null;
        return {
            state,
            desiredState: site.environmentDesiredState ?? 'running',
            limits: this.effectiveLimits(site),
            usage: null,
            lastError: site.lastError,
        };
    }
    async exec(site, command, options) {
        return await this.serialize(site.id, async () => {
            if (site.runtime !== 'environment')
                throw new Error('this site is not a persistent environment');
            const token = randomUUID();
            const expiresAt = Date.now() + (options.timeoutSeconds + 60) * 1000;
            if (!this.deps.store.tryBeginEnvironmentExec(site.id, token, expiresAt)) {
                throw new Error('the environment has a pending lifecycle action or command');
            }
            try {
                if (await this.deps.podman.inspectStatus(containerName(site.id)) !== 'running') {
                    throw new Error('the environment is not running');
                }
                this.appendLog(site.id, `exec requested (${command.length} bytes)`);
                return await this.deps.podman.execInteractive(containerName(site.id), ['/bin/bash', '-s'], command, { timeoutMs: options.timeoutSeconds * 1000, workdir: options.workdir });
            }
            finally {
                this.deps.store.endEnvironmentExec(site.id, token);
            }
        });
    }
    async logs(site, lines = 200) {
        const lifecycle = this.logTail(site.id);
        if (site.runtime !== 'environment' || await this.deps.podman.inspectStatus(containerName(site.id)) !== 'running') {
            return { lifecycle, journal: '' };
        }
        const bounded = Math.min(1000, Math.max(1, Math.round(lines)));
        const result = await this.deps.podman.exec(containerName(site.id), ['journalctl', '--no-pager', '-n', String(bounded)], { timeoutMs: 30_000 });
        return { lifecycle, journal: result.stdout || result.stderr };
    }
    brokerSealed(socketPath) {
        try {
            return (statSync(dirname(socketPath)).mode & 0o777) === 0o510;
        }
        catch {
            return false;
        }
    }
    effectiveLimits(site) {
        const config = this.deps.config();
        return {
            cpus: site.environmentCpus ?? config.environmentCpus,
            memoryMb: site.environmentMemoryMb ?? config.environmentMemoryMb,
            pidsLimit: site.environmentPidsLimit ?? config.environmentPidsLimit,
            diskSoftMb: site.environmentDiskSoftMb ?? config.environmentDiskSoftMb,
        };
    }
    containerLimits(site) {
        const { cpus, memoryMb, pidsLimit } = this.effectiveLimits(site);
        return { cpus, memoryMb, pidsLimit };
    }
    writeEnvironmentFiles(site) {
        const dir = this.environmentDir(site.id);
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        const envFile = join(dir, 'container.env');
        const url = this.deps.siteUrl?.(site);
        const lines = [`ELOWEN_SITE_SLUG=${site.slug}`, ...(url ? [`ELOWEN_SITE_URL=${url}`] : [])];
        writeFileSync(envFile, `${lines.join('\n')}\n`, { mode: 0o600 });
        chmodSync(envFile, 0o600);
        const gitStub = join(dir, 'git-stub');
        writeFileSync(gitStub, '', { mode: 0o400 });
        return { envFile, gitStub };
    }
    async snapshotNow(site, input) {
        if (site.runtime !== 'environment')
            throw new Error('this site is not a persistent environment');
        const snapshotDir = join(this.environmentDir(site.id), 'snapshots', input.snapshotId);
        const imageRef = `localhost/elowen-site/${site.id}:${input.snapshotId}`;
        const dataArchive = input.includeData ? join(snapshotDir, 'data.tar') : null;
        const existing = this.deps.store.release(site.id, input.snapshotId);
        if (existing) {
            if (existing.kind !== 'environment-snapshot' || existing.imageRef !== imageRef || existing.dataArchive !== dataArchive) {
                throw new Error('the durable snapshot action conflicts with an existing release');
            }
            if (!await this.deps.podman.imageExists(imageRef) || (dataArchive !== null && !existsSync(dataArchive))) {
                throw new Error('the recorded environment snapshot is incomplete');
            }
            await this.pruneEnvironmentSnapshots(site.id, input.snapshotId);
            return existing;
        }
        const name = containerName(site.id);
        let status = await this.deps.podman.inspectStatus(name);
        if (status === 'paused') {
            await this.deps.podman.unpause(name);
            status = await this.deps.podman.inspectStatus(name);
        }
        if (status !== 'running')
            throw new Error('the environment is not running');
        if (existsSync(snapshotDir)) {
            if (await this.deps.podman.imageExists(imageRef))
                await this.deps.podman.removeImage(imageRef);
            rmSync(snapshotDir, { recursive: true, force: true });
        }
        mkdirSync(snapshotDir, { recursive: true, mode: 0o700 });
        let paused = false;
        let resumeFailed = false;
        let failure = null;
        try {
            await this.deps.podman.pause(name);
            paused = true;
            await this.deps.podman.commit(name, imageRef, { pause: false });
            if (dataArchive)
                await this.deps.podman.exportVolume(volumeName(site.id), dataArchive);
        }
        catch (error) {
            failure = error;
        }
        finally {
            if (paused) {
                try {
                    await this.deps.podman.unpause(name);
                }
                catch (error) {
                    resumeFailed = true;
                    failure ??= error;
                }
            }
        }
        if (failure) {
            await this.deps.podman.removeImage(imageRef).catch(() => { });
            rmSync(snapshotDir, { recursive: true, force: true });
            const message = failure instanceof Error ? failure.message : String(failure);
            if (resumeFailed)
                this.deps.store.updateSite(site.id, { status: 'failed', lastError: `snapshot resume failed: ${message}` });
            this.appendLog(site.id, `snapshot ${input.snapshotId} failed: ${message}`);
            throw failure;
        }
        const release = {
            id: input.snapshotId,
            siteId: site.id,
            createdAt: new Date(this.now()).toISOString(),
            model: input.model,
            fileCount: 0,
            sizeBytes: 0,
            note: input.note,
            kind: 'environment-snapshot',
            imageRef,
            dataArchive,
        };
        try {
            this.deps.store.insertRelease(release);
        }
        catch (error) {
            await this.deps.podman.removeImage(imageRef).catch(() => { });
            rmSync(snapshotDir, { recursive: true, force: true });
            throw error;
        }
        this.appendLog(site.id, `created crash-consistent snapshot ${input.snapshotId}`);
        await this.pruneEnvironmentSnapshots(site.id, input.snapshotId);
        return release;
    }
    async pruneEnvironmentSnapshots(siteId, createdSnapshotId) {
        const snapshots = this.deps.store.releases(siteId).filter((release) => release.kind === 'environment-snapshot');
        const limit = Math.max(1, this.deps.config().releasesKept);
        if (snapshots.length <= limit)
            return;
        const currentReleaseId = this.deps.store.siteById(siteId)?.currentReleaseId ?? null;
        const keep = new Set(snapshots.slice(0, limit).map((snapshot) => snapshot.id));
        keep.add(createdSnapshotId);
        if (currentReleaseId && snapshots.some((release) => release.id === currentReleaseId))
            keep.add(currentReleaseId);
        for (const snapshot of snapshots) {
            if (keep.has(snapshot.id))
                continue;
            const expectedImage = `localhost/elowen-site/${siteId}:${snapshot.id}`;
            if (snapshot.imageRef !== expectedImage)
                throw new Error(`snapshot ${snapshot.id} has an invalid image reference`);
            const snapshotDir = join(this.environmentDir(siteId), 'snapshots', snapshot.id);
            const expectedArchive = join(snapshotDir, 'data.tar');
            if (snapshot.dataArchive !== null && snapshot.dataArchive !== expectedArchive) {
                throw new Error(`snapshot ${snapshot.id} has an invalid data archive`);
            }
            await this.deps.podman.removeImage(expectedImage);
            await this.deps.podman.unshareRemove([snapshotDir]);
            this.deps.store.deleteRelease(siteId, snapshot.id);
        }
    }
    start(site) {
        this.deps.store.updateSite(site.id, { environmentDesiredState: 'running' });
        return this.serialize(site.id, () => this.startNow(site));
    }
    async startNow(site, createImage, volumePrepared = false) {
        if (site.runtime !== 'environment')
            return;
        this.detached = false;
        const name = containerName(site.id);
        let status = await this.deps.podman.inspectStatus(name);
        const knownSocket = this.deps.brokerPath?.(site.id)
            ?? join('/var/lib/elowen/site-runtime-sockets', site.id, 'app.sock');
        if (status === 'running'
            && this.brokerSealed(knownSocket)
            && await this.socketReady(knownSocket)
            && await this.connectReady({ kind: 'socket', path: knownSocket })) {
            this.endpoints.set(site.id, { kind: 'socket', path: knownSocket });
            this.settledStopped.delete(site.id);
            this.deps.store.updateSite(site.id, { status: 'live', lastError: null });
            this.appendLog(site.id, 'adopted running container');
            return;
        }
        if (status !== null && status !== 'exited' && status !== 'created') {
            await this.stopNow(site.id, true);
            status = await this.deps.podman.inspectStatus(name);
        }
        await this.deps.gateway.removeRuntimeSocket(site.id);
        const prepared = await this.deps.gateway.prepareRuntimeSocket(site.id);
        const endpoint = { kind: 'socket', path: prepared.path };
        try {
            const limits = this.containerLimits(site);
            if (status === null) {
                const image = createImage ?? await this.deps.ensureBaseImage();
                const files = this.writeEnvironmentFiles(site);
                const volume = volumeName(site.id);
                if (!volumePrepared)
                    await this.deps.podman.ensureVolume(volume, site.id);
                await this.deps.podman.create({
                    name,
                    siteId: site.id,
                    ...limits,
                    network: this.deps.config().environmentNetwork,
                    envFile: files.envFile,
                    workspace: site.sourceDir,
                    gitStub: files.gitStub,
                    brokerDir: dirname(prepared.path),
                    volume,
                    image,
                });
            }
            await this.deps.podman.update(name, limits);
            await this.deps.podman.start(name);
            const ready = await this.waitForReady(endpoint, this.deps.config().startTimeoutSeconds * 1_000);
            if (!ready)
                throw new Error(`the environment did not expose ${prepared.path} in time`);
            await this.deps.gateway.sealRuntimeSocket(site.id);
            if (!await this.connectReady(endpoint))
                throw new Error('the environment ingress socket did not answer after sealing');
            this.endpoints.set(site.id, endpoint);
            this.settledStopped.delete(site.id);
            this.deps.store.updateSite(site.id, { status: 'live', lastError: null });
            this.appendLog(site.id, 'started container');
        }
        catch (error) {
            try {
                await this.stopContainerAndWait(name);
            }
            catch { /* keep the original start failure */ }
            await this.deps.gateway.removeRuntimeSocket(site.id).catch(() => { });
            const message = error instanceof Error ? error.message : String(error);
            this.deps.store.updateSite(site.id, { status: 'failed', lastError: message });
            this.appendLog(site.id, `start failed: ${message}`);
            throw error;
        }
    }
    async waitForReady(endpoint, timeoutMs) {
        const deadline = this.now() + timeoutMs;
        while (this.now() <= deadline) {
            if (endpoint.kind === 'socket' && await this.socketReady(endpoint.path))
                return true;
            await this.sleep(200);
        }
        return false;
    }
    stop(siteId) {
        return this.serialize(siteId, async () => {
            const site = this.deps.store.siteById(siteId);
            if (site?.runtime === 'environment')
                this.deps.store.updateSite(siteId, { environmentDesiredState: 'stopped' });
            await this.stopNow(siteId, true);
        });
    }
    async stopNow(siteId, removeBroker) {
        const name = containerName(siteId);
        await this.stopContainerAndWait(name);
        this.endpoints.delete(siteId);
        this.settledStopped.add(siteId);
        if (removeBroker)
            await this.deps.gateway.removeRuntimeSocket(siteId);
        this.appendLog(siteId, 'stopped container');
    }
    async stopContainerAndWait(name) {
        const initial = await this.deps.podman.inspectStatus(name);
        if (initial === null || initial === 'exited' || initial === 'created')
            return;
        await this.deps.podman.stop(name, STOP_TIMEOUT_SECONDS);
        if (await this.waitForExited(name, EXIT_WAIT_MS))
            return;
        await this.deps.podman.kill(name);
        if (!await this.waitForExited(name, KILL_WAIT_MS)) {
            throw new Error(`${name} did not reach exited after stop and kill`);
        }
    }
    async waitForExited(name, timeoutMs) {
        const deadline = this.now() + timeoutMs;
        while (this.now() <= deadline) {
            if (await this.deps.podman.inspectStatus(name) === 'exited')
                return true;
            await this.sleep(200);
        }
        return false;
    }
    restart(site) {
        return this.serialize(site.id, async () => {
            await this.stopNow(site.id, true);
            const current = this.deps.store.siteById(site.id) ?? site;
            await this.startNow(current);
            this.deps.store.completeEnvironmentRestart(site.id);
        });
    }
    applyLimits(site, patch) {
        return this.serialize(site.id, async () => {
            const next = { ...site, ...patch };
            if (await this.deps.podman.inspectStatus(containerName(site.id)) !== null) {
                await this.deps.podman.update(containerName(site.id), this.containerLimits(next));
            }
            this.deps.store.updateSite(site.id, patch);
        });
    }
    async rollbackNow(site, action) {
        const snapshot = this.deps.store.release(site.id, action.snapshotId);
        const expectedImage = `localhost/elowen-site/${site.id}:${action.snapshotId}`;
        if (!snapshot || snapshot.kind !== 'environment-snapshot' || snapshot.imageRef !== expectedImage) {
            throw new Error('the requested environment snapshot is not retained for this site');
        }
        const expectedArchive = join(this.environmentDir(site.id), 'snapshots', action.snapshotId, 'data.tar');
        if (snapshot.dataArchive !== null && snapshot.dataArchive !== expectedArchive) {
            throw new Error('the requested environment snapshot has an invalid data archive');
        }
        if (!await this.deps.podman.imageExists(expectedImage)) {
            throw new Error('the requested environment snapshot image is missing');
        }
        if (action.restoreData) {
            if (snapshot.dataArchive !== expectedArchive || !this.safeSnapshotPath(site.id, snapshot.dataArchive)) {
                throw new Error('the requested snapshot has no valid data archive');
            }
            await this.validateDataArchive(site.id, action.snapshotId, snapshot.dataArchive);
        }
        await this.stopNow(site.id, true);
        const name = containerName(site.id);
        if (await this.deps.podman.inspectStatus(name) !== null)
            await this.deps.podman.remove(name);
        const backupDir = action.restoreData && snapshot.dataArchive
            ? await this.replaceDataVolume(site.id, action.snapshotId, snapshot.dataArchive)
            : null;
        try {
            await this.startNow(site, expectedImage, action.restoreData);
        }
        catch (error) {
            if (backupDir) {
                try {
                    if (await this.deps.podman.inspectStatus(name) !== null)
                        await this.deps.podman.remove(name);
                    await this.restorePreviousData(site.id, backupDir);
                }
                catch (restoreError) {
                    const message = restoreError instanceof Error ? restoreError.message : String(restoreError);
                    throw new Error(`rollback failed and the previous data volume could not be restored: ${message}`, { cause: error });
                }
            }
            throw error;
        }
        if (backupDir)
            rmSync(backupDir, { recursive: true, force: true });
        if (!this.deps.store.completeEnvironmentAction(site.id, snapshot.id)) {
            throw new Error('the rollback completed but its durable action state changed unexpectedly');
        }
        this.appendLog(site.id, `restored snapshot ${snapshot.id}${action.restoreData ? ' with data' : ''}`);
    }
    async validateDataArchive(siteId, snapshotId, archive) {
        const temporaryVolume = `${volumeName(siteId)}-validate-${snapshotId}`;
        await this.deps.podman.removeVolume(temporaryVolume);
        try {
            await this.deps.podman.ensureVolume(temporaryVolume, siteId);
            await this.deps.podman.importVolume(temporaryVolume, archive);
        }
        finally {
            await this.deps.podman.removeVolume(temporaryVolume);
        }
    }
    async replaceDataVolume(siteId, snapshotId, archive) {
        const volume = volumeName(siteId);
        const backupDir = join(this.environmentDir(siteId), 'restore', snapshotId);
        const backup = join(backupDir, 'previous-data.tar');
        const backupTemp = join(backupDir, 'previous-data.tar.partial');
        mkdirSync(backupDir, { recursive: true, mode: 0o700 });
        if (!existsSync(backup)) {
            rmSync(backupTemp, { force: true });
            await this.deps.podman.exportVolume(volume, backupTemp);
            renameSync(backupTemp, backup);
        }
        await this.deps.podman.removeVolume(volume);
        try {
            await this.deps.podman.ensureVolume(volume, siteId);
            await this.deps.podman.importVolume(volume, archive);
        }
        catch (error) {
            try {
                await this.deps.podman.removeVolume(volume);
                await this.deps.podman.ensureVolume(volume, siteId);
                await this.deps.podman.importVolume(volume, backup);
            }
            catch (restoreError) {
                const message = restoreError instanceof Error ? restoreError.message : String(restoreError);
                throw new Error(`snapshot import failed and the previous data backup could not be restored: ${message}`, { cause: error });
            }
            rmSync(backupDir, { recursive: true, force: true });
            throw error;
        }
        return backupDir;
    }
    async restorePreviousData(siteId, backupDir) {
        const backup = join(backupDir, 'previous-data.tar');
        const volume = volumeName(siteId);
        await this.deps.podman.removeVolume(volume);
        await this.deps.podman.ensureVolume(volume, siteId);
        await this.deps.podman.importVolume(volume, backup);
        rmSync(backupDir, { recursive: true, force: true });
    }
    safeSnapshotPath(siteId, path) {
        const root = resolve(this.environmentDir(siteId), 'snapshots');
        const candidate = resolve(path);
        return candidate.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
    }
    delete(siteId) {
        return this.serialize(siteId, async () => {
            await this.stopNow(siteId, true);
            const name = containerName(siteId);
            if (await this.deps.podman.inspectStatus(name) !== null)
                await this.deps.podman.remove(name);
            for (const snapshot of this.deps.store.releases(siteId).filter((release) => release.kind === 'environment-snapshot')) {
                const expectedPrefix = `localhost/elowen-site/${siteId}:`;
                if (snapshot.imageRef?.startsWith(expectedPrefix))
                    await this.deps.podman.removeImage(snapshot.imageRef);
            }
            this.deps.store.deleteEnvironmentAction(siteId);
            await this.deps.podman.removeVolume(volumeName(siteId));
            this.appendLog(siteId, 'deleting container, snapshots and data volume');
            await this.deps.podman.unshareRemove([this.environmentDir(siteId)]);
        });
    }
    reconcile() {
        return this.reconcileSites(this.deps.store.environmentSitesForReconcile());
    }
    async reconcileSites(sites) {
        for (const site of sites) {
            const action = this.deps.store.environmentAction(site.id);
            try {
                if (action && action.lastError === null) {
                    if (action.kind === 'snapshot') {
                        await this.serialize(site.id, async () => {
                            await this.snapshotNow(site, {
                                snapshotId: action.snapshotId,
                                includeData: action.includeData,
                                note: action.note,
                                model: action.model,
                            });
                            if (!this.deps.store.completeEnvironmentAction(site.id)) {
                                throw new Error('the snapshot completed but its durable action state changed unexpectedly');
                            }
                        });
                    }
                    else {
                        await this.serialize(site.id, () => this.rollbackNow(site, action));
                    }
                }
                else if (action) {
                    continue;
                }
                else if (site.environmentDesiredState === 'restarting') {
                    await this.restart(site);
                }
                else if (site.environmentDesiredState === 'stopped') {
                    if (!this.settledStopped.has(site.id))
                        await this.serialize(site.id, () => this.stopNow(site.id, true));
                }
                else if (!this.endpoints.has(site.id) || site.status === 'failed') {
                    await this.start(site);
                }
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                if (action)
                    this.deps.store.updateEnvironmentActionError(site.id, message);
                this.deps.store.updateSite(site.id, { status: 'failed', lastError: message });
                this.deps.logger?.warn(`site ${site.slug} environment reconciliation failed: ${message}`);
            }
        }
    }
    /** One fleet-wide Podman call. Inspect remains reserved for the sites whose observed state differs from
     * the database or whose endpoint has to be adopted again. */
    async backstop() {
        if (this.detached)
            return [];
        const summaries = await this.deps.podman.ps();
        const states = new Map();
        for (const summary of summaries) {
            const names = Array.isArray(summary.names) ? summary.names : summary.names ? [summary.names] : [];
            const state = summary.state ?? summary.status ?? '';
            for (const name of names)
                states.set(name, state.toLowerCase());
        }
        for (const site of this.deps.store.environmentSitesForReconcile()) {
            const observed = states.get(containerName(site.id)) ?? 'missing';
            if (this.deps.store.environmentAction(site.id) || site.environmentDesiredState === 'restarting') {
                if (observed !== 'running')
                    this.endpoints.delete(site.id);
                continue;
            }
            if (site.environmentDesiredState === 'stopped') {
                if (observed !== 'exited' && observed !== 'missing') {
                    this.settledStopped.delete(site.id);
                    await this.serialize(site.id, () => this.stopNow(site.id, true));
                }
                else {
                    this.settledStopped.add(site.id);
                }
                continue;
            }
            if (observed !== 'running')
                this.endpoints.delete(site.id);
            if (!this.endpoints.has(site.id))
                await this.start(site);
        }
        return summaries;
    }
    /** Plugin reload detaches supervision only. Rootless containers intentionally outlive the daemon. */
    async detach() {
        this.detached = true;
        this.endpoints.clear();
        this.settledStopped.clear();
        this.queues.clear();
    }
}
