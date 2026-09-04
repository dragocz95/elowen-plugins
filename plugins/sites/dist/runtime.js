import { spawn } from 'node:child_process';
import { appendFileSync, closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, rmSync, statSync } from 'node:fs';
import { connect, createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { parseEnv } from 'node:util';
const LOG_CAP_BYTES = 256 * 1024;
const STOP_GRACE_MS = 5_000;
const HEARTBEAT_MS = 5_000;
/** A forked sub-agent runner loads plugin tools but starts no plugin services, so a process spawned
 *  there would be supervised by nobody, invisible to the daemon that answers requests, and unstoppable
 *  from the UI. Runtime lifecycle belongs to the daemon; a runner records the desired state and lets
 *  the daemon's own reconciliation act on it. */
export const isDaemonProcess = () => typeof process.send !== 'function';
const RESERVED_ENV = new Set(['HOME', 'PATH', 'NODE_ENV', 'HOST', 'PORT', 'SOCKET_PATH', 'SOCKET_ABSTRACT']);
function readReleaseEnv(releaseDir) {
    const file = join(releaseDir, '.env');
    let fd = null;
    try {
        fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
        if (!fstatSync(fd).isFile())
            throw new Error('.env is not a regular file');
        return Object.fromEntries(Object.entries(parseEnv(readFileSync(fd, 'utf8')))
            .filter((entry) => typeof entry[1] === 'string')
            .filter(([key]) => !RESERVED_ENV.has(key) && !key.startsWith('ELOWEN_')));
    }
    catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
            return {};
        throw new Error(`the runtime .env could not be loaded: ${error instanceof Error ? error.message : String(error)}`);
    }
    finally {
        if (fd !== null)
            closeSync(fd);
    }
}
const endpointConnection = (endpoint) => endpoint.kind === 'socket' ? { path: endpoint.path } : { host: '127.0.0.1', port: endpoint.port };
function portAvailable(port) {
    return new Promise((resolve) => {
        const probe = createServer();
        probe.unref();
        probe.once('error', () => resolve(false));
        probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
    });
}
export class SiteRuntimeSupervisor {
    deps;
    running = new Map();
    /** One queue per site. Start, stop and reconcile all mutate the same process slot, so letting two of
     *  them interleave is how a site ends up with two processes racing for one socket, or with a lease
     *  released while its replacement is still starting. */
    queues = new Map();
    constructor(deps) {
        this.deps = deps;
    }
    serialize(siteId, operation) {
        const previous = this.queues.get(siteId) ?? Promise.resolve();
        const next = previous.then(operation, operation);
        this.queues.set(siteId, next.then(() => undefined, () => undefined));
        return next;
    }
    endpointFor(siteId) {
        return this.running.get(siteId)?.endpoint ?? null;
    }
    isRunning(siteId) {
        const entry = this.running.get(siteId);
        return entry !== undefined && entry.child.exitCode === null && !entry.stopping;
    }
    async allocatePort() {
        const config = this.deps.config();
        if (!config.allowLoopbackPorts)
            throw new Error('Loopback ports are turned off for this instance.');
        const claimed = new Set(this.deps.store.portsInUse());
        for (let port = config.loopbackPortMin; port <= config.loopbackPortMax; port += 1) {
            if (!claimed.has(port) && await portAvailable(port))
                return port;
        }
        throw new Error(`No free loopback port is available in ${config.loopbackPortMin}-${config.loopbackPortMax}.`);
    }
    /** Logs live OUTSIDE every directory bound into the process's namespace. A log file the runtime can
     *  reach is a log file it can replace with a symlink, and the daemon appending to it would then write
     *  wherever that link points. */
    logFile(siteId) {
        const dir = join(this.deps.siteDir(siteId), 'logs');
        mkdirSync(dir, { recursive: true });
        return join(dir, 'run.log');
    }
    /** Append to the site's log, keeping it bounded. Runtime output is attacker-influenced text — it is
     *  written verbatim to a file the UI renders as plain text and is never interpolated anywhere else. */
    appendLog(siteId, chunk) {
        const file = this.logFile(siteId);
        try {
            appendFileSync(file, chunk);
            if (statSync(file).size > LOG_CAP_BYTES * 2) {
                const kept = readFileSync(file, 'utf8').slice(-LOG_CAP_BYTES);
                rmSync(file, { force: true });
                appendFileSync(file, kept);
            }
        }
        catch {
            // A site that cannot write its log still serves; losing the tail is not worth failing a request.
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
    /** Start a site's process and wait until it actually answers.
     *
     *  Returns only once the endpoint accepts a connection, so "live" in the UI means the server is up
     *  rather than that a process was spawned. A start that never answers is stopped again and reported
     *  with its own log tail, because a half-started runtime holding a port is worse than none. */
    start(site) {
        return this.serialize(site.id, () => this.startNow(site));
    }
    async startNow(site) {
        if (site.runtime !== 'command')
            return;
        if (!site.currentReleaseId)
            throw new Error('the site has no published release to run');
        if (this.isRunning(site.id))
            return;
        await this.stopNow(site.id);
        const cwd = this.deps.releaseDir(site.id, site.currentReleaseId);
        if (!existsSync(cwd))
            throw new Error('the published release is missing from disk');
        const releaseEnv = readReleaseEnv(cwd);
        const sandbox = this.deps.ctx.control('sandbox');
        if (!sandbox)
            throw new Error('the Sandbox plugin is disabled, so a site runtime cannot be confined');
        const gateway = this.deps.ctx.control('publishedSitesGateway');
        const config = this.deps.config();
        if (site.bind === 'port' && !config.allowLoopbackPorts) {
            throw new Error('Loopback ports are turned off for this instance.');
        }
        let endpoint;
        if (site.bind === 'port') {
            if (!Number.isSafeInteger(site.port) || site.port === null || site.port < config.loopbackPortMin || site.port > config.loopbackPortMax) {
                throw new Error('the site has no valid allocated loopback port');
            }
            endpoint = { kind: 'port', port: site.port };
        }
        else {
            if (!gateway)
                throw new Error('the published-sites socket broker is unavailable');
            endpoint = { kind: 'socket', path: (await gateway.prepareRuntimeSocket(site.id)).path };
        }
        let prepared;
        try {
            prepared = await sandbox.prepareExecution({ command: { type: 'shell', command: site.startCommand }, cwd, leaseKind: 'sites', network: config.runtimeNetwork }, { accountUserId: site.ownerUserId, roots: endpoint.kind === 'socket' ? [cwd, dirname(endpoint.path)] : [cwd] });
        }
        catch (error) {
            if (endpoint.kind === 'socket')
                await gateway?.removeRuntimeSocket(site.id).catch(() => { });
            throw error;
        }
        // The environment is built here rather than taken from the preparation: it is the contract the
        // published app reads, and nothing of the daemon's own environment belongs in a process that
        // answers requests from the internet.
        const env = {
            ...releaseEnv,
            ...prepared.launch.env,
            NODE_ENV: 'production',
            ELOWEN_SITE_SLUG: site.slug,
            ELOWEN_SITE_BASE_PATH: '/',
            ...(endpoint.kind === 'socket'
                ? { SOCKET_PATH: endpoint.path, SOCKET_ABSTRACT: '0' }
                : { HOST: '127.0.0.1', PORT: String(endpoint.port) }),
        };
        const child = prepared.launch.type === 'argv'
            ? spawn(prepared.launch.file, prepared.launch.args, { cwd: prepared.cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
            : spawn(prepared.launch.command, { cwd: prepared.cwd, env, shell: true, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
        child.stdout?.on('data', (chunk) => this.appendLog(site.id, chunk.toString()));
        child.stderr?.on('data', (chunk) => this.appendLog(site.id, chunk.toString()));
        const heartbeat = setInterval(() => { void prepared.lease.heartbeat(); }, HEARTBEAT_MS);
        heartbeat.unref?.();
        let released = false;
        const release = async () => {
            if (released)
                return;
            released = true;
            await prepared.lease.release();
        };
        const entry = {
            siteId: site.id,
            releaseId: site.currentReleaseId,
            child,
            endpoint,
            startCommand: site.startCommand,
            bind: site.bind,
            port: site.port,
            heartbeat,
            release,
            stopping: false,
        };
        this.running.set(site.id, entry);
        child.once('exit', (code, signal) => {
            this.appendLog(site.id, `\n[elowen] process exited (code ${code ?? '-'}, signal ${signal ?? '-'})\n`);
            clearInterval(heartbeat);
            // Unexpected exit cleanup takes the SAME per-site queue as stop/start/reconcile. A detached removal
            // could otherwise delete the directory a replacement process had just prepared and sealed.
            void this.serialize(site.id, async () => {
                if (this.running.get(site.id) !== entry)
                    return;
                try {
                    await entry.release();
                }
                finally {
                    if (entry.endpoint.kind === 'socket') {
                        try {
                            await gateway?.removeRuntimeSocket(site.id);
                        }
                        catch (error) {
                            this.deps.ctx.logger.warn(`site ${site.slug} socket cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
                        }
                    }
                    if (this.running.get(site.id) === entry)
                        this.running.delete(site.id);
                }
            });
        });
        try {
            const ready = await this.waitForEndpoint(endpoint, this.deps.config().startTimeoutSeconds * 1000, child, () => endpoint.kind === 'socket' ? gateway.sealRuntimeSocket(site.id) : Promise.resolve());
            if (!ready) {
                throw new Error(`the runtime did not answer within ${this.deps.config().startTimeoutSeconds}s. Last output:\n${this.logTail(site.id, 2000)}`);
            }
        }
        catch (error) {
            await this.stopNow(site.id);
            throw error;
        }
    }
    async waitForEndpoint(endpoint, timeoutMs, child, seal) {
        const deadline = Date.now() + timeoutMs;
        if (endpoint.kind === 'socket') {
            while (child.exitCode === null && Date.now() <= deadline) {
                try {
                    if (lstatSync(endpoint.path).isSocket()) {
                        await seal();
                        break;
                    }
                }
                catch (error) {
                    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
                        await new Promise((resolve) => setTimeout(resolve, 200));
                        continue;
                    }
                    throw error;
                }
                await new Promise((resolve) => setTimeout(resolve, 200));
            }
        }
        if (child.exitCode !== null || Date.now() > deadline)
            return false;
        return await new Promise((resolve) => {
            const attempt = () => {
                if (child.exitCode !== null) {
                    resolve(false);
                    return;
                }
                if (Date.now() > deadline) {
                    resolve(false);
                    return;
                }
                const socket = connect(endpointConnection(endpoint));
                socket.setTimeout(1000);
                const retry = () => { socket.destroy(); setTimeout(attempt, 200); };
                socket.once('connect', () => { socket.destroy(); resolve(true); });
                socket.once('error', retry);
                socket.once('timeout', retry);
            };
            attempt();
        });
    }
    /** Stop a site's process and prove it is gone.
     *
     *  The child is a detached process group, so the signal goes to the group: a shell that spawned the
     *  real server would otherwise die alone and leave the server holding the endpoint. SIGKILL follows
     *  when the group does not go quietly, and the lease is released only after the process is confirmed
     *  gone, so a stale lease can never look like a live one. */
    stop(siteId) {
        return this.serialize(siteId, () => this.stopNow(siteId));
    }
    async stopNow(siteId) {
        const gateway = this.deps.ctx.control('publishedSitesGateway');
        const entry = this.running.get(siteId);
        if (!entry) {
            const site = this.deps.store.siteById(siteId);
            if (gateway && site?.runtime === 'command' && site.bind === 'socket') {
                await gateway.removeRuntimeSocket(siteId);
            }
            return;
        }
        entry.stopping = true;
        const { child } = entry;
        if (child.exitCode === null && child.pid !== undefined) {
            const exited = new Promise((resolve) => {
                if (child.exitCode !== null) {
                    resolve();
                    return;
                }
                child.once('exit', () => resolve());
            });
            this.signalGroup(child.pid, 'SIGTERM');
            const killed = await Promise.race([
                exited.then(() => true),
                new Promise((resolve) => { const timer = setTimeout(() => resolve(false), STOP_GRACE_MS); timer.unref?.(); }),
            ]);
            if (!killed) {
                this.signalGroup(child.pid, 'SIGKILL');
                await exited;
            }
        }
        clearInterval(entry.heartbeat);
        await entry.release();
        if (entry.endpoint.kind === 'socket') {
            if (!gateway)
                throw new Error('the published-sites socket broker is unavailable during cleanup');
            await gateway.removeRuntimeSocket(siteId);
        }
        this.running.delete(siteId);
    }
    signalGroup(pid, signal) {
        try {
            process.kill(-pid, signal);
        }
        catch {
            try {
                process.kill(pid, signal);
            }
            catch { /* already gone */ }
        }
    }
    async stopAll() {
        await Promise.all([...this.running.keys()].map((siteId) => this.stop(siteId)));
    }
    /** True while a reconcile is in flight, so a second caller joins it rather than starting a parallel
     *  sweep over the same sites. */
    reconciling = null;
    /** Bring every site that should be running back up. Runs on boot and after a plugin reload, and is
     *  idempotent: a site already running is left alone rather than started twice onto the same endpoint. */
    reconcile() {
        if (this.reconciling)
            return this.reconciling;
        const run = this.reconcileNow().finally(() => { this.reconciling = null; });
        this.reconciling = run;
        return run;
    }
    async reconcileNow() {
        for (const site of this.deps.store.liveCommandSites()) {
            const running = this.running.get(site.id);
            if (running
                && running.releaseId === site.currentReleaseId
                && running.startCommand === site.startCommand
                && running.bind === site.bind
                && running.port === site.port
                && this.isRunning(site.id))
                continue;
            try {
                if (running)
                    await this.stop(site.id);
                await this.start(site);
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                this.deps.store.updateSite(site.id, { status: 'failed', lastError: message });
                this.deps.ctx.logger.warn(`site ${site.slug} did not start: ${message}`);
            }
        }
    }
}
