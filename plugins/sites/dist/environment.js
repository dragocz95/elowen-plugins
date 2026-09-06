import { randomUUID } from 'node:crypto';
import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { request as httpRequest } from 'node:http';
import { dirname, join, resolve, sep } from 'node:path';
const STOP_TIMEOUT_SECONDS = 8;
const LIMIT_UPDATE_ATTEMPTS = 3;
const EXIT_WAIT_MS = 30_000;
const KILL_WAIT_MS = 5_000;
const LOG_CAP_BYTES = 256 * 1024;
const containerName = (siteId) => `elowen-site-${siteId}`;
/** The site row limits are derived from. Read fresh, because an administrator may have changed them. */
const site0 = (siteId, deps) => deps.store.siteById(siteId) ?? { id: siteId };
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
    /** Sites whose durable action this process is executing right now. See `reconcileSites`. */
    actionsInFlight = new Set();
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
    /** Build a site's container and leave it in `created`, for a runtime conversion that has to stage the
     *  container while the LEGACY runtime is still serving.
     *
     *  Deliberately create-only, and the reason is the one property the whole conversion rests on:
     *  `startNow` treats an existing container as something to START rather than rebuild (`creating =
     *  status === null`), so the layer built here is exactly the one that goes live, and the flip costs a
     *  start instead of a rebuild. Starting here instead would be wrong for a command site, whose broker
     *  directory belongs to the live process that the start sequence would remove and recreate.
     *
     *  The broker directory is MOUNTED but never prepared here, for the same reason.
     *
     *  `workspace` is passed in because a conversion mounts its own staged copy of the published release
     *  rather than `site.sourceDir`. Every other flag comes from the same limit and network derivation a
     *  normal start uses, so a converted site is sized exactly like one created as an environment.
     *
     *  `image` is the conversion's derivative when there is one. Omitted, the shared base image is used, so
     *  this method stays usable for anything that is not a conversion.
     *
     *  Idempotent: an existing container is left untouched, which is what a resumed or retried preparation
     *  needs. Runs on the site's own queue so it cannot interleave with a start or a stop. */
    prepareContainer(site, workspace, image, workspaceReadOnly = false) {
        return this.serialize(site.id, async () => {
            const name = containerName(site.id);
            if (await this.deps.podman.inspectStatus(name) !== null)
                return { created: false };
            const files = this.writeEnvironmentFiles(site);
            const volume = volumeName(site.id);
            await this.deps.podman.ensureVolume(volume, site.id);
            const brokerDir = this.deps.brokerPath
                ? dirname(this.deps.brokerPath(site.id))
                : join('/var/lib/elowen/site-runtime-sockets', site.id);
            await this.deps.podman.create({
                name,
                siteId: site.id,
                ...this.containerLimits(site),
                network: this.deps.config().environmentNetwork,
                envFile: files.envFile,
                workspace,
                gitStub: files.gitStub,
                brokerDir,
                volume,
                // A conversion supplies its own derivative; a plain environment gets the shared base.
                image: image ?? await this.deps.ensureBaseImage(),
                workspaceReadOnly,
            });
            this.appendLog(site.id, `prepared container for runtime conversion on ${image ?? 'the base image'}`);
            return { created: true };
        });
    }
    /** Prove a container and volume carrying this site's name were created by THIS plugin for THIS site.
     *
     *  A NAME IS NOT OWNERSHIP. Every object this plugin creates carries `io.elowen.site=<id>`, and nothing
     *  else does. Without checking it, a conversion would happily adopt — or delete — a container somebody
     *  else created that happens to share the name, and the deletion is unrecoverable.
     *
     *  Also reports the workspace the container actually bind-mounts, so a caller can tell a container that
     *  is ours and current from one that is ours and pointing at a directory that has since been replaced.
     *  Null when nothing with that name exists, which is the ordinary first-preparation case. */
    async inspectOwnership(siteId, expect) {
        const name = containerName(siteId);
        const status = await this.deps.podman.inspectStatus(name);
        const volume = volumeName(siteId);
        const volumeLabel = await this.deps.podman.inspectVolumeLabel(volume, 'io.elowen.site');
        const volumePresent = volumeLabel !== undefined;
        // A VOLUME carrying this site's name is as dangerous as a container: it is imported into and deleted
        // by name, so one belonging to somebody else would be overwritten and then destroyed.
        if (volumePresent && volumeLabel !== siteId) {
            return {
                owned: false,
                workspace: null,
                detail: volumeLabel === null
                    ? `volume ${volume} carries no io.elowen.site label`
                    : `volume ${volume} is labelled for site ${volumeLabel}`,
            };
        }
        if (status === null)
            return volumePresent ? { owned: true, workspace: null, detail: `only volume ${volume} exists` } : null;
        const label = await this.deps.podman.inspectLabel(name, 'io.elowen.site');
        if (label !== siteId) {
            return {
                owned: false,
                workspace: null,
                detail: label === null
                    ? `container ${name} carries no io.elowen.site label`
                    : `container ${name} is labelled for site ${label}`,
            };
        }
        const workspace = await this.deps.podman.inspectMountSource(name, '/workspace');
        if (!expect)
            return { owned: true, workspace, detail: `container ${name} is owned by this site` };
        // FULL SPEC, not just the label. A container that is ours by label can still be the wrong one: built
        // on a superseded image, mounting a replaced workspace, pointing at another site's broker directory,
        // or created with limits and a network the current settings no longer describe. Reusing any of those
        // serves something nobody approved.
        const mismatches = [];
        const image = await this.deps.podman.inspectImage(name);
        if (image !== null && image !== expect.image)
            mismatches.push(`image ${image} is not ${expect.image}`);
        if (workspace !== null && resolve(workspace) !== resolve(expect.workspace)) {
            mismatches.push(`workspace ${workspace} is not ${expect.workspace}`);
        }
        const broker = await this.deps.podman.inspectMountSource(name, '/run/elowen');
        const expectedBroker = this.deps.brokerPath
            ? dirname(this.deps.brokerPath(siteId))
            : join('/var/lib/elowen/site-runtime-sockets', siteId);
        if (broker !== null && resolve(broker) !== resolve(expectedBroker)) {
            mismatches.push(`broker ${broker} is not ${expectedBroker}`);
        }
        const dataMount = await this.deps.podman.inspectMountSource(name, '/data');
        if (dataMount !== null && dataMount !== volume)
            mismatches.push(`data volume ${dataMount} is not ${volume}`);
        const limits = this.containerLimits(site0(siteId, this.deps));
        const observed = await this.deps.podman.inspectResources(name);
        if (observed) {
            if (observed.memoryMb !== null && observed.memoryMb !== limits.memoryMb) {
                mismatches.push(`memory ${observed.memoryMb}MB is not ${limits.memoryMb}MB`);
            }
            if (observed.pidsLimit !== null && observed.pidsLimit !== limits.pidsLimit) {
                mismatches.push(`pids ${observed.pidsLimit} is not ${limits.pidsLimit}`);
            }
        }
        const network = await this.deps.podman.inspectNetworkMode(name);
        const expectedNetwork = this.deps.config().environmentNetwork === 'isolated' ? 'none' : 'slirp4netns';
        if (network !== null && !network.startsWith(expectedNetwork)) {
            mismatches.push(`network ${network} is not ${expectedNetwork}`);
        }
        return mismatches.length === 0
            ? { owned: true, workspace, detail: `container ${name} matches the expected specification` }
            : { owned: true, workspace, detail: `container ${name} differs: ${mismatches.join('; ')}` };
    }
    /** Ask the site's own ingress the invariant its recipe declared, over real HTTP.
     *
     *  A connectable socket is not readiness: `systemd-socket-proxyd` accepts whether or not anything is
     *  listening behind it, so a container whose application never started still looks alive. Only a
     *  response with the expected status proves the application is serving.
     *
     *  Deliberately a bare request rather than the serving proxy: this is a health probe, not a visitor,
     *  and it must not carry identity headers, count a hit or take the access path. */
    async probeReadiness(siteId, expect, options = {}) {
        const endpoint = this.endpoints.get(siteId);
        if (!endpoint)
            return { ready: false, detail: 'the ingress socket has not been adopted', attempts: 0 };
        const perAttemptMs = options.timeoutMs ?? 5_000;
        // BOUNDED WAIT, and it lives here rather than in the caller.
        //
        // The ingress socket exists before the application behind it does: `elowen-ingress.socket` is
        // listening from boot, so the first requests through it are refused or reset while systemd is still
        // starting the app. A single probe therefore reports ECONNRESET for a site that is merely still
        // coming up. A fixed sleep would be the wrong fix, because it is simultaneously too long for a fast
        // start and too short for a slow one; the honest answer is to retry until a deadline and then give
        // up with the LAST real failure, which is what the caller needs to act on.
        const deadline = this.now() + (options.deadlineMs ?? this.deps.config().startTimeoutSeconds * 1_000);
        let attempts = 0;
        let last = 'no attempt completed';
        while (this.now() <= deadline) {
            attempts += 1;
            const outcome = await this.readinessAttempt(endpoint, expect, perAttemptMs);
            if (outcome.ready)
                return { ...outcome, attempts };
            last = outcome.detail;
            // A wrong STATUS is the application answering, so it is settled and retrying will not change it.
            // Only a transport failure is worth waiting through.
            if (outcome.answered)
                return { ready: false, detail: outcome.detail, attempts };
            if (this.now() > deadline)
                break;
            // A bounded wait that MUST complete, so it does not use the shared unref'd sleep: an unreferenced
            // timer lets an otherwise idle process exit with this promise still pending.
            await new Promise((wake) => { setTimeout(wake, 250); });
        }
        return { ready: false, detail: `${last} (gave up after ${attempts} attempt(s))`, attempts };
    }
    async readinessAttempt(endpoint, expect, timeoutMs) {
        const result = await new Promise((resolveStatus) => {
            const request = httpRequest({
                ...(endpoint.kind === 'socket' ? { socketPath: endpoint.path } : { host: '127.0.0.1', port: endpoint.port }),
                method: 'GET',
                path: expect.path,
                headers: { host: 'localhost', 'user-agent': 'elowen-conversion-readiness' },
                timeout: timeoutMs,
            }, (response) => {
                response.resume();
                resolveStatus(response.statusCode ?? 0);
            });
            request.once('error', (error) => resolveStatus(error.message));
            request.once('timeout', () => { request.destroy(); resolveStatus('timed out'); });
            request.end();
        });
        if (typeof result === 'string') {
            return { ready: false, answered: false, detail: `GET ${expect.path} failed: ${result}` };
        }
        return result === expect.expectStatus
            ? { ready: true, answered: true, detail: `GET ${expect.path} answered ${result}` }
            : { ready: false, answered: true, detail: `GET ${expect.path} answered ${result}, expected ${expect.expectStatus}` };
    }
    /** The host directory Podman bind-mounts at `/run/elowen`. Derived, never taken from a caller. */
    brokerDirectory(siteId) {
        return this.deps.brokerPath
            ? dirname(this.deps.brokerPath(siteId))
            : join('/var/lib/elowen/site-runtime-sockets', siteId);
    }
    /** Whether the broker directory is already on disk.
     *
     *  `podman create` STATFS-es every bind source, so a missing one fails the create with 125 before the
     *  container exists at all. A command site hides that: its live process already had the gateway create
     *  the directory, so the conversion inherited one. A static or PHP site has none, and its create fails.
     *
     *  A plain stat is enough and is all the plugin may do: the directory is root-owned 0730 and only the
     *  privileged gateway helper may create or remove it. */
    brokerDirectoryExists(siteId) {
        try {
            return statSync(this.brokerDirectory(siteId)).isDirectory();
        }
        catch {
            return false;
        }
    }
    /** Have the GATEWAY create the broker directory, so a container can be created against it.
     *
     *  Routed through the privileged helper on purpose. The directory is root-owned with a mode the service
     *  account cannot produce, and a plugin-made one would either fail the seal later or hand the container
     *  a directory it could rewrite. This plugin never calls mkdir for it. */
    async prepareBrokerDirectory(siteId) {
        const prepared = await this.deps.gateway.prepareRuntimeSocket(siteId);
        this.appendLog(siteId, 'prepared broker directory for container creation');
        return dirname(prepared.path);
    }
    /** Stop the container and resolve only once it has actually left the running state. */
    async quiesce(siteId) {
        await this.serialize(siteId, () => this.stopNow(siteId, false));
    }
    /** Whether the container has reached a stopped state, observed rather than inferred. */
    async isStopped(siteId) {
        const status = await this.deps.podman.inspectStatus(containerName(siteId));
        return status === null || status === 'exited' || status === 'created';
    }
    /** Seed a site's data volume from a tar before its container has ever run, so a converted site starts
     *  against the data its legacy runtime had rather than an empty volume. */
    importDataVolume(siteId, archive) {
        return this.serialize(siteId, async () => {
            const volume = volumeName(siteId);
            await this.deps.podman.ensureVolume(volume, siteId);
            await this.deps.podman.importVolume(volume, archive);
            this.appendLog(siteId, 'seeded data volume from the legacy runtime');
        });
    }
    /** Export a site's data volume so writes made while converted can travel back on a rollback. Reports
     *  false when the volume does not exist, which is the honest answer for a container that never ran. */
    exportDataVolume(siteId, output) {
        return this.serialize(siteId, async () => {
            const volume = volumeName(siteId);
            if (!await this.deps.podman.volumeExists(volume))
                return false;
            await this.deps.podman.exportVolume(volume, output);
            return true;
        });
    }
    writeEnvironmentFiles(site) {
        const dir = this.environmentDir(site.id);
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        const envFile = join(dir, 'container.env');
        const url = this.deps.siteUrl?.(site);
        const lines = [`ELOWEN_SITE_SLUG=${site.slug}`, ...(url ? [`ELOWEN_SITE_URL=${url}`] : [])];
        writeFileSync(envFile, `${lines.join('\n')}\n`, { mode: 0o600 });
        chmodSync(envFile, 0o600);
        // `mode` applies only when a file is CREATED, and a 0400 stub cannot be reopened for writing. Every
        // RECREATE therefore died here with EACCES before the container existed, which is exactly what a
        // rollback does after removing the old one: an environment could never be restored at all. Reopen it
        // deliberately, then put the read-only bit back.
        const gitStub = join(dir, 'git-stub');
        if (existsSync(gitStub))
            chmodSync(gitStub, 0o600);
        writeFileSync(gitStub, '', { mode: 0o400 });
        chmodSync(gitStub, 0o400);
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
            try {
                await this.deps.podman.unpause(name);
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                this.endpoints.delete(site.id);
                this.deps.store.updateSite(site.id, { status: 'failed', lastError: `snapshot resume failed: ${message}` });
                throw error;
            }
            status = await this.deps.podman.inspectStatus(name);
        }
        if (status !== 'running') {
            this.endpoints.delete(site.id);
            this.deps.store.updateSite(site.id, { status: 'failed', lastError: 'the environment is not running' });
            throw new Error('the environment is not running');
        }
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
            if (resumeFailed) {
                this.endpoints.delete(site.id);
                this.deps.store.updateSite(site.id, { status: 'failed', lastError: `snapshot resume failed: ${message}` });
            }
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
    /** `authorized` marks the runtime conversion's own start. The conversion owns this site's runtime at
     *  the moment it runs, so it passes through the suspension guard rather than being stopped by it. */
    start(site, options = {}) {
        const authorized = options.authorized === true;
        // Asked BEFORE the desired-state write, not only inside the queue: that write is itself a side
        // effect, and a rollback that quiesced the container has already recorded that it must stay down.
        if (!authorized && this.deps.store.conversionSuspends(site.id) === 'environment')
            return Promise.resolve();
        this.deps.store.updateSite(site.id, { environmentDesiredState: 'running' });
        return this.serialize(site.id, () => this.startNow(site, undefined, false, authorized));
    }
    async startNow(site, createImage, volumePrepared = false, authorized = false) {
        if (site.runtime !== 'environment')
            return;
        // THE SECOND ASK, inside the per-site queue and immediately before the container is touched.
        //
        // A reconcile sweep reads its site list once and then awaits each site in turn, so a start queued
        // from that stale list can arrive here after a rollback claimed the site and stopped its container.
        // Restarting it mid-export is how a volume gets exported while it is being written.
        if (!authorized && this.deps.store.conversionSuspends(site.id) === 'environment')
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
            const creating = status === null;
            if (creating) {
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
            await this.deps.podman.start(name);
            const ready = await this.waitForReady(endpoint, this.deps.config().startTimeoutSeconds * 1_000);
            if (!ready)
                throw new Error(`the environment did not expose ${prepared.path} in time`);
            // Create already persisted these limits. Podman delegates `update` to crun, whose status file can
            // briefly lag behind the systemd ingress, so retry only that known startup race before exposure.
            if (!creating)
                await this.updateStartedContainer(name, limits);
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
    async updateStartedContainer(name, limits) {
        for (let attempt = 1; attempt <= LIMIT_UPDATE_ATTEMPTS; attempt += 1) {
            try {
                await this.deps.podman.update(name, limits);
                return;
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                const transient = message.includes('/crun/')
                    && message.includes('/status')
                    && message.includes('No such file or directory');
                if (!transient || attempt === LIMIT_UPDATE_ATTEMPTS)
                    throw error;
                const status = await this.deps.podman.inspectStatus(name);
                if (status !== 'running' && status !== 'created')
                    throw error;
                await this.sleep(attempt * 1_000);
            }
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
            const status = await this.deps.podman.inspectStatus(containerName(site.id));
            // crun can update only a running container. For a stopped/created container persist the override;
            // startNow applies it immediately after the next start and before ingress is accepted.
            if (status === 'running') {
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
    /** Remove a site's container, snapshots and volume.
     *
     *  `removeBroker` is false when the broker directory belongs to somebody else. A conversion rolled back
     *  BEFORE its flip leaves the legacy command process still serving on that exact socket, and removing
     *  the directory would take the live site down and leave a process writing to an unlinked path. */
    delete(siteId, options = {}) {
        const removeBroker = options.removeBroker !== false;
        return this.serialize(siteId, async () => {
            await this.stopNow(siteId, removeBroker);
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
        // FIRST ASK: a rollback that quiesced this container recorded that it must stay down, but the row
        // still says `environment` and `live`, so without this the sweep below reads a stopped container it
        // believes should be up and starts it in the middle of the export. The authoritative check is in
        // `startNow`; this one keeps the work from being queued at all.
        const suspended = this.deps.store.conversionSuspensions();
        for (const site of sites) {
            if (suspended.get(site.id) === 'environment')
                continue;
            const action = this.deps.store.environmentAction(site.id);
            // A durable action row is deleted only once its run COMPLETES, so a tick that arrives mid-restore
            // reads the same row and queues the identical rollback behind the one still working. The queue
            // defers a duplicate rather than dropping it, so the replay rebuilt an already restored environment
            // and then reported `completeEnvironmentAction` returning false as a failure over a healthy site.
            // The row still drives recovery after a daemon restart: nothing is in flight there.
            const dispatchable = action !== null && action.lastError === null;
            if (dispatchable) {
                if (this.actionsInFlight.has(site.id))
                    continue;
                this.actionsInFlight.add(site.id);
            }
            try {
                if (action && action.lastError === null) {
                    if (action.kind === 'snapshot') {
                        await this.serialize(site.id, async () => {
                            if (!this.endpoints.has(site.id))
                                await this.startNow(site);
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
                    if (site.lastError === null)
                        await this.restart(site);
                }
                else if (site.environmentDesiredState === 'stopped') {
                    if (!this.settledStopped.has(site.id))
                        await this.serialize(site.id, () => this.stopNow(site.id, true));
                }
                else if (site.lastError === null && (!this.endpoints.has(site.id) || site.status === 'failed')) {
                    await this.start(site);
                }
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                if (action) {
                    this.deps.store.updateEnvironmentActionError(site.id, message);
                    if (action.kind === 'rollback')
                        this.deps.store.updateSite(site.id, { status: 'failed', lastError: message });
                }
                else {
                    this.deps.store.updateSite(site.id, { status: 'failed', lastError: message });
                }
                this.deps.logger?.warn(`site ${site.slug} environment reconciliation failed: ${message}`);
            }
            finally {
                if (dispatchable)
                    this.actionsInFlight.delete(site.id);
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
        const suspended = this.deps.store.conversionSuspensions();
        for (const site of this.deps.store.environmentSitesForReconcile()) {
            const observed = states.get(containerName(site.id)) ?? 'missing';
            // The fleet sweep restarts anything not running, which is exactly what a quiesced container looks
            // like. Its endpoint is dropped so nothing keeps routing to it, but it is not started again.
            if (suspended.get(site.id) === 'environment') {
                this.endpoints.delete(site.id);
                continue;
            }
            if (this.deps.store.environmentAction(site.id)) {
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
            if (site.lastError !== null || site.environmentDesiredState === 'restarting') {
                if (observed !== 'running')
                    this.endpoints.delete(site.id);
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
