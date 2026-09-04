import { appendFileSync, chmodSync, lstatSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { dirname, join } from 'node:path';
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
    brokerSealed(socketPath) {
        try {
            return (statSync(dirname(socketPath)).mode & 0o777) === 0o510;
        }
        catch {
            return false;
        }
    }
    limits(site) {
        const config = this.deps.config();
        return {
            cpus: site.environmentCpus ?? config.environmentCpus,
            memoryMb: site.environmentMemoryMb ?? config.environmentMemoryMb,
            pidsLimit: site.environmentPidsLimit ?? config.environmentPidsLimit,
        };
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
    start(site) {
        this.deps.store.updateSite(site.id, { environmentDesiredState: 'running' });
        return this.serialize(site.id, () => this.startNow(site));
    }
    async startNow(site) {
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
            if (status === null) {
                const image = await this.deps.ensureBaseImage();
                const files = this.writeEnvironmentFiles(site);
                const limits = this.limits(site);
                await this.deps.podman.create({
                    name,
                    siteId: site.id,
                    ...limits,
                    network: this.deps.config().runtimeNetwork,
                    envFile: files.envFile,
                    workspace: site.sourceDir,
                    gitStub: files.gitStub,
                    brokerDir: dirname(prepared.path),
                    volume: volumeName(site.id),
                    image,
                });
            }
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
            this.deps.store.updateSite(site.id, { environmentDesiredState: 'running' });
            await this.stopNow(site.id, true);
            const current = this.deps.store.siteById(site.id) ?? site;
            await this.startNow(current);
        });
    }
    delete(siteId) {
        return this.serialize(siteId, async () => {
            await this.stopNow(siteId, true);
            const name = containerName(siteId);
            if (await this.deps.podman.inspectStatus(name) !== null)
                await this.deps.podman.remove(name);
            await this.deps.podman.removeVolume(volumeName(siteId));
            this.appendLog(siteId, 'deleting container and data volume');
            await this.deps.podman.unshareRemove([this.environmentDir(siteId)]);
        });
    }
    reconcile() {
        return this.reconcileSites(this.deps.store.liveEnvironmentSites());
    }
    async reconcileSites(sites) {
        for (const site of sites) {
            try {
                if (site.environmentDesiredState === 'stopped') {
                    if (!this.settledStopped.has(site.id))
                        await this.serialize(site.id, () => this.stopNow(site.id, true));
                }
                else if (!this.endpoints.has(site.id)) {
                    await this.start(site);
                }
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
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
        for (const site of this.deps.store.liveEnvironmentSites()) {
            const observed = states.get(containerName(site.id)) ?? 'missing';
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
