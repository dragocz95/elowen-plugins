import { spawn, type ChildProcess } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';
import type { SitesContext } from './coreSeams.js';
import type { Site, SitesStore } from './store.js';

const LOG_CAP_BYTES = 256 * 1024;
const STOP_GRACE_MS = 5_000;
const HEARTBEAT_MS = 5_000;

/** A forked sub-agent runner loads plugin tools but starts no plugin services, so a process spawned
 *  there would be supervised by nobody, invisible to the daemon that answers requests, and unstoppable
 *  from the UI. Runtime lifecycle belongs to the daemon; a runner records the desired state and lets
 *  the daemon's own reconciliation act on it. */
export const isDaemonProcess = (): boolean => typeof process.send !== 'function';

interface RuntimeConfig {
  startTimeoutSeconds: number;
  portRangeStart: number;
  portRangeEnd: number;
}

export interface RuntimeDeps {
  ctx: SitesContext;
  store: SitesStore;
  config(): RuntimeConfig;
  siteDir(siteId: string): string;
  releaseDir(siteId: string, releaseId: string): string;
}

/** Where a running site listens, as the proxy needs to reach it. */
export type Endpoint = { kind: 'socket'; path: string } | { kind: 'port'; port: number };

interface Running {
  siteId: string;
  child: ChildProcess;
  endpoint: Endpoint;
  heartbeat: NodeJS.Timeout;
  release: () => Promise<void> | void;
  stopping: boolean;
}

export class SiteRuntimeSupervisor {
  private readonly running = new Map<string, Running>();
  /** One queue per site. Start, stop and reconcile all mutate the same process slot, so letting two of
   *  them interleave is how a site ends up with two processes racing for one socket, or with a lease
   *  released while its replacement is still starting. */
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(private readonly deps: RuntimeDeps) {}

  private serialize<T>(siteId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(siteId) ?? Promise.resolve();
    const next = previous.then(operation, operation);
    this.queues.set(siteId, next.then(() => undefined, () => undefined));
    return next;
  }

  endpointFor(siteId: string): Endpoint | null {
    return this.running.get(siteId)?.endpoint ?? null;
  }

  isRunning(siteId: string): boolean {
    const entry = this.running.get(siteId);
    return entry !== undefined && entry.child.exitCode === null && !entry.stopping;
  }

  /** The only directory a site's process may write outside its release: it holds the socket. */
  private runDir(siteId: string): string {
    const dir = join(this.deps.siteDir(siteId), 'run');
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  /** Logs live OUTSIDE every directory bound into the process's namespace. A log file the runtime can
   *  reach is a log file it can replace with a symlink, and the daemon appending to it would then write
   *  wherever that link points. */
  private logFile(siteId: string): string {
    const dir = join(this.deps.siteDir(siteId), 'logs');
    mkdirSync(dir, { recursive: true });
    return join(dir, 'run.log');
  }

  /** Append to the site's log, keeping it bounded. Runtime output is attacker-influenced text — it is
   *  written verbatim to a file the UI renders as plain text and is never interpolated anywhere else. */
  private appendLog(siteId: string, chunk: string): void {
    const file = this.logFile(siteId);
    try {
      appendFileSync(file, chunk);
      if (statSync(file).size > LOG_CAP_BYTES * 2) {
        const kept = readFileSync(file, 'utf8').slice(-LOG_CAP_BYTES);
        rmSync(file, { force: true });
        appendFileSync(file, kept);
      }
    } catch {
      // A site that cannot write its log still serves; losing the tail is not worth failing a request.
    }
  }

  logTail(siteId: string, bytes = 8192): string {
    try {
      return readFileSync(this.logFile(siteId), 'utf8').slice(-bytes);
    } catch {
      return '';
    }
  }

  /** Pick a free loopback port inside the configured range. Only for a runtime that cannot take a
   *  socket; the caller is expected to have said so deliberately. */
  allocatePort(): number {
    const { portRangeStart, portRangeEnd } = this.deps.config();
    const taken = new Set(this.deps.store.portsInUse());
    for (let port = portRangeStart; port <= portRangeEnd; port += 1) {
      if (!taken.has(port)) return port;
    }
    throw new Error('no free port is left in the configured range');
  }

  private endpointOf(site: Site): Endpoint {
    if (site.bind === 'port') {
      if (site.port === null) throw new Error('the site has no port assigned');
      return { kind: 'port', port: site.port };
    }
    return { kind: 'socket', path: join(this.runDir(site.id), 'app.sock') };
  }

  /** Start a site's process and wait until it actually answers.
   *
   *  Returns only once the endpoint accepts a connection, so "live" in the UI means the server is up
   *  rather than that a process was spawned. A start that never answers is stopped again and reported
   *  with its own log tail, because a half-started runtime holding a port is worse than none. */
  start(site: Site): Promise<void> {
    return this.serialize(site.id, () => this.startNow(site));
  }

  private async startNow(site: Site): Promise<void> {
    if (site.runtime !== 'command') return;
    if (!site.currentReleaseId) throw new Error('the site has no published release to run');
    if (this.isRunning(site.id)) return;
    await this.stopNow(site.id);

    const cwd = this.deps.releaseDir(site.id, site.currentReleaseId);
    if (!existsSync(cwd)) throw new Error('the published release is missing from disk');

    const endpoint = this.endpointOf(site);
    if (endpoint.kind === 'socket') rmSync(endpoint.path, { force: true });

    const sandbox = this.deps.ctx.control('sandbox');
    if (!sandbox) throw new Error('the Sandbox plugin is disabled, so a site runtime cannot be confined');

    const prepared = await sandbox.prepareExecution(
      { command: { type: 'shell', command: site.startCommand }, cwd, leaseKind: 'sites' },
      { accountUserId: site.ownerUserId, roots: [cwd, this.runDir(site.id)] },
    );

    // The environment is built here rather than taken from the preparation: it is the contract the
    // published app reads, and nothing of the daemon's own environment belongs in a process that
    // answers requests from the internet.
    const env: Record<string, string> = {
      ...prepared.launch.env,
      NODE_ENV: 'production',
      ELOWEN_SITE_SLUG: site.slug,
      ELOWEN_SITE_BASE_PATH: `/hooks/sites/s/${site.slug}/`,
      ...(endpoint.kind === 'socket'
        ? { SOCKET_PATH: endpoint.path, PORT: endpoint.path }
        : { PORT: String(endpoint.port), HOST: '127.0.0.1' }),
    };

    const child = prepared.launch.type === 'argv'
      ? spawn(prepared.launch.file, prepared.launch.args, { cwd: prepared.cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
      : spawn(prepared.launch.command, { cwd: prepared.cwd, env, shell: true, stdio: ['ignore', 'pipe', 'pipe'], detached: true });

    child.stdout?.on('data', (chunk: Buffer) => this.appendLog(site.id, chunk.toString()));
    child.stderr?.on('data', (chunk: Buffer) => this.appendLog(site.id, chunk.toString()));

    const heartbeat = setInterval(() => { void prepared.lease.heartbeat(); }, HEARTBEAT_MS);
    heartbeat.unref?.();

    const entry: Running = {
      siteId: site.id,
      child,
      endpoint,
      heartbeat,
      release: () => prepared.lease.release(),
      stopping: false,
    };
    this.running.set(site.id, entry);

    child.once('exit', (code, signal) => {
      this.appendLog(site.id, `\n[elowen] process exited (code ${code ?? '-'}, signal ${signal ?? '-'})\n`);
      clearInterval(heartbeat);
      void entry.release();
      if (this.running.get(site.id) === entry) this.running.delete(site.id);
    });

    const ready = await this.waitForEndpoint(endpoint, this.deps.config().startTimeoutSeconds * 1000, child);
    if (!ready) {
      await this.stopNow(site.id);
      throw new Error(`the runtime did not answer within ${this.deps.config().startTimeoutSeconds}s. Last output:\n${this.logTail(site.id, 2000)}`);
    }
  }

  private waitForEndpoint(endpoint: Endpoint, timeoutMs: number, child: ChildProcess): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve) => {
      const attempt = (): void => {
        if (child.exitCode !== null) { resolve(false); return; }
        if (Date.now() > deadline) { resolve(false); return; }
        const socket = endpoint.kind === 'socket'
          ? connect({ path: endpoint.path })
          : connect({ host: '127.0.0.1', port: endpoint.port });
        socket.setTimeout(1000);
        const retry = (): void => { socket.destroy(); setTimeout(attempt, 200); };
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
  stop(siteId: string): Promise<void> {
    return this.serialize(siteId, () => this.stopNow(siteId));
  }

  private async stopNow(siteId: string): Promise<void> {
    const entry = this.running.get(siteId);
    if (!entry) return;
    entry.stopping = true;
    const { child } = entry;

    if (child.exitCode === null && child.pid !== undefined) {
      const exited = new Promise<void>((resolve) => {
        if (child.exitCode !== null) { resolve(); return; }
        child.once('exit', () => resolve());
      });
      this.signalGroup(child.pid, 'SIGTERM');
      const killed = await Promise.race([
        exited.then(() => true),
        new Promise<boolean>((resolve) => { const timer = setTimeout(() => resolve(false), STOP_GRACE_MS); timer.unref?.(); }),
      ]);
      if (!killed) {
        this.signalGroup(child.pid, 'SIGKILL');
        await exited;
      }
    }

    clearInterval(entry.heartbeat);
    await entry.release();
    this.running.delete(siteId);
    if (entry.endpoint.kind === 'socket') rmSync(entry.endpoint.path, { force: true });
  }

  private signalGroup(pid: number, signal: NodeJS.Signals): void {
    try {
      process.kill(-pid, signal);
    } catch {
      try { process.kill(pid, signal); } catch { /* already gone */ }
    }
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.running.keys()].map((siteId) => this.stop(siteId)));
  }

  /** True while a reconcile is in flight, so a second caller joins it rather than starting a parallel
   *  sweep over the same sites. */
  private reconciling: Promise<void> | null = null;

  /** Bring every site that should be running back up. Runs on boot and after a plugin reload, and is
   *  idempotent: a site already running is left alone rather than started twice onto the same endpoint. */
  reconcile(): Promise<void> {
    if (this.reconciling) return this.reconciling;
    const run = this.reconcileNow().finally(() => { this.reconciling = null; });
    this.reconciling = run;
    return run;
  }

  private async reconcileNow(): Promise<void> {
    for (const site of this.deps.store.liveCommandSites()) {
      if (this.isRunning(site.id)) continue;
      try {
        await this.start(site);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.deps.store.updateSite(site.id, { status: 'failed', lastError: message });
        this.deps.ctx.logger.warn(`site ${site.slug} did not start: ${message}`);
      }
    }
  }
}
