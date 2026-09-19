import { posix } from 'node:path';
import type { PluginContext, SandboxControl, ManagedPreparedExecution } from 'elowen/dist/plugins/api.js';
import { GUEST_FILE_CHUNK_BYTES } from 'elowen/dist/plugins/environmentTypes.js';
import { LspManager, type LspStatus } from './manager.js';
import type { LspTransport } from './client.js';
import { MessageDecoder, type JsonRpcMessage } from './protocol.js';
import { listServers } from './servers.js';

type Project = { kind: 'managed'; projectId: number };

export function guestLspPath(path: string): string {
  if (!path.startsWith('/') || path.includes('\0') || path.length > 4096) throw new Error('An absolute guest path is required.');
  return posix.normalize(path);
}

/** The provider is resolved for every operation, including warm-client requests. */
export class ManagedLspManager extends LspManager {
  private generation: number | undefined;
  private readonly cleanups = new Set<Promise<void>>();
  private readonly installed = new Set<string>();

  /** Latched by shutdown(): a stopped manager mints NO new leases. A prepare that resolves after the
   *  owner's stop began would otherwise register a transport (and a live execution lease) in an
   *  instance that has already left the plugin's managed set — nobody would ever cancel it. */
  private stopped = false;

  constructor(private readonly ctx: PluginContext, readonly project: Project, readonly actor: number, generation?: number, idleTtlMs?: number) {
    super({
      root: '/workspace',
      idleTtlMs,
      projectRoot: async () => { await this.authority(); return '/workspace'; },
      readFile: async (path) => {
        const sandbox = await this.authority();
        const result = await sandbox.projectFiles({ project, accountUserId: actor, expectedGeneration: this.generation,
          // The guest refuses a read bound above its own chunk size, so asking for more than this failed
          // the whole operation and every managed diagnostic degraded to skipped:'unreadable'.
          operation: { kind: 'read', path: guestLspPath(path), maxBytes: GUEST_FILE_CHUNK_BYTES } });
        if (result.kind !== 'read') throw new Error('Invalid guest file response.');
        const bytes = Buffer.from(result.base64, 'base64');
        if (result.totalBytes > bytes.length) throw new Error('Guest source exceeds the language-server read limit.');
        return bytes.toString('utf8');
      },
      spawn: async (spec, cwd) => {
        // A guest without the server must read as "not installed", exactly as it does on the host.
        if (!await this.guestHas(spec.command)) return null;
        const prepared = await this.prepare(spec.command, spec.args, cwd);
        return this.transport(prepared);
      },
      exists: (command) => this.installed.has(command),
    });
    this.generation = generation;
  }

  get scopeKey(): string { return `:${this.project.projectId}:${this.actor}:${this.generation}`; }

  /** The daemon's pid means nothing in the guest's process namespace: the server looks for it, finds
   *  no such process, and exits(1) the moment the session starts — which surfaced as every managed
   *  check reporting a server error. The execution lease and its heartbeat already own this server's
   *  lifetime, so it needs no watchdog of its own. */
  protected override watchdogProcessId(): number | null {
    return null;
  }

  /** The guest root is `/workspace`, which exists in the container and not in the daemon, so the host
   *  probe would report every managed server as vanished and reclaim it on the next sweep. This manager
   *  cannot see the guest filesystem; the execution lease and the generation bookkeeping in the plugin's
   *  `managed` map already retire a server whose environment went away. */
  protected override rootStillPresent(): boolean {
    return true;
  }

  /** Whether the guest can actually run `command`. The host spawn answers this by resolving the binary
   *  before it launches anything, which is how a missing server becomes skipped:'no-server-installed'
   *  instead of a crash. The guest's PATH is not the daemon's, so the managed manager has to ask the
   *  container the same question — and nothing did. A project whose container has no language server
   *  launched `/usr/bin/env -- <server>` anyway, the guest exited 127 before the handshake, and the
   *  dead transport surfaced as skipped:'server-error'; three of those exhausted the restart budget and
   *  left the whole runtime generation on 'crash-looping' until an operator toggled /lsp.
   *
   *  The inventory is taken once and re-probed only on a miss, so a hit costs nothing and a server
   *  installed inside the guest after the first probe is picked up by the very next check. */
  private async guestHas(command: string): Promise<boolean> {
    if (this.installed.has(command)) return true;
    await this.statusAsync();
    return this.installed.has(command);
  }

  private async authority(): Promise<SandboxControl> {
    if (this.stopped) throw new Error('Managed LSP manager is stopped.');
    const selected = this.ctx.currentAccess().projectRef;
    if (selected?.kind !== 'managed' || selected.projectId !== this.project.projectId || this.ctx.currentAccountUserId() !== this.actor) {
      this.disposeAll();
      throw new Error('LSP project or acting account changed.');
    }
    const sandbox = this.ctx.control('sandbox');
    if (!sandbox) { this.disposeAll(); throw new Error('Managed LSP environment provider is unavailable.'); }
    let state;
    try { state = await sandbox.environmentFor({ project: this.project, accountUserId: this.actor }); }
    catch (error) { this.disposeAll(); throw error; }
    if (this.stopped) throw new Error('Managed LSP manager is stopped.');
    if (state.projectId !== this.project.projectId) {
      this.disposeAll();
      throw new Error('Environment provider returned another project.');
    }
    if (this.generation !== undefined && state.generation !== this.generation) {
      this.disposeAll();
      throw new Error('LSP runtime generation changed.');
    }
    this.generation = state.generation;
    return sandbox;
  }

  private async prepare(file: string, args: string[], cwd = '/workspace'): Promise<ManagedPreparedExecution> {
    const sandbox = await this.authority();
    const prepared = await sandbox.prepareExecution({ projectRef: this.project, command: { type: 'argv', file, args }, cwd, leaseKind: 'lsp' });
    if (this.stopped) {
      await prepared.lease.cancel?.();
      await prepared.lease.release();
      throw new Error('Managed LSP manager is stopped.');
    }
    if (prepared.mode !== 'managed' || prepared.projectRef?.kind !== 'managed' || prepared.projectRef.projectId !== this.project.projectId
      || prepared.lease.projectId !== this.project.projectId || prepared.lease.accountUserId !== this.actor
      || prepared.lease.runtimeGeneration !== this.generation || typeof prepared.lease.cancel !== 'function'
      || typeof prepared.start !== 'function' || typeof prepared.cancel !== 'function'
      || typeof prepared.sanitizeOutput !== 'function') {
      await prepared.lease.cancel?.();
      await prepared.lease.release();
      throw new Error('Invalid managed LSP project, generation or stream launch.');
    }
    return prepared;
  }

  private cleanup(prepared: ManagedPreparedExecution): void {
    const cleanup = (async () => { try { await prepared.cancel(); } finally { await prepared.lease.release(); } })();
    this.cleanups.add(cleanup);
    void cleanup.then(() => this.cleanups.delete(cleanup), (error: unknown) => {
      this.ctx.logger.warn(`Managed LSP cleanup failed: ${String(error)}`);
    });
  }

  private async transport(prepared: ManagedPreparedExecution): Promise<LspTransport> {
    // Opening the guest session is itself awaited work, so shutdown() has to be able to wait for it: a
    // start that lands after the drain would hand a live language server (and its execution lease) to an
    // instance the owner has already stopped, and only whoever happened to touch the transport next
    // would ever settle it. Joining `cleanups` puts the in-flight start under the same drain, and the
    // stopped re-check below turns a start that won the race into an immediate teardown.
    const starting = prepared.start();
    const pending = starting.then(() => {}, () => {});
    this.cleanups.add(pending);
    let child;
    try { child = await starting; }
    catch (error) { this.cleanup(prepared); this.cleanups.delete(pending); throw error; }
    if (this.stopped) {
      this.cleanup(prepared);
      this.cleanups.delete(pending);
      throw new Error('Managed LSP manager is stopped.');
    }
    // Deleted only after any follow-up cleanup is already registered, so the drain never observes an
    // empty set between the two.
    this.cleanups.delete(pending);
    const decoder = new MessageDecoder();
    const messages: ((message: JsonRpcMessage) => void)[] = [];
    const exits: (() => void)[] = [];
    let ended = false;
    const finish = (): void => {
      if (ended) return;
      ended = true;
      clearInterval(heartbeat);
      child.stdin.destroy();
      for (const callback of exits) callback();
      this.cleanup(prepared);
    };
    const heartbeat = setInterval(() => {
      void Promise.resolve().then(() => prepared.lease.heartbeat()).catch(finish);
    }, 5000);
    heartbeat.unref();
    void child.closed.then(finish, finish);
    child.stdin.on('error', finish);
    child.stderr.resume();
    child.stdout.on('data', (data: Buffer) => {
      try { for (const message of decoder.push(data)) for (const callback of messages) callback(message); }
      catch { finish(); }
    });
    return {
      send: (frame) => {
        if (ended) throw new Error('Managed language server closed.');
        if (child.stdin.writableLength + Buffer.byteLength(frame) > 1024 * 1024) { finish(); throw new Error('Managed LSP input exceeds its bound.'); }
        child.stdin.write(frame);
      },
      onMessage: (callback) => { messages.push(callback); },
      onExit: (callback) => { if (ended) callback(); else exits.push(callback); },
      dispose: finish,
    };
  }

  /** Status and package changes execute in the same guest and retain the same lease authority. */
  private async run(file: string, args: string[]): Promise<string> {
    const prepared = await this.prepare(file, args);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let failure: unknown;
    try {
      let interrupt!: (error: unknown) => void;
      const interrupted = new Promise<never>((_resolve, reject) => { interrupt = reject; });
      void interrupted.catch(() => {});
      timeout = setTimeout(() => interrupt(new Error('Guest LSP command timed out.')), 120000);
      heartbeat = setInterval(() => { void Promise.resolve().then(() => prepared.lease.heartbeat()).catch(interrupt); }, 5000);
      const session = await Promise.race([prepared.start(), interrupted]);
      const chunks: Buffer[] = [];
      let size = 0;
      session.stdout.on('data', (data: Buffer) => {
        size += data.length;
        if (size > 1024 * 1024) interrupt(new Error('Guest LSP output exceeded its limit.'));
        else chunks.push(data);
      });
      session.stderr.resume();
      session.stdin.end();
      const result = await Promise.race([session.closed, interrupted]);
      if (result.code !== 0) throw new Error(`Guest LSP command exited with ${result.code}.`);
      return prepared.sanitizeOutput(Buffer.concat(chunks).toString('utf8'));
    } catch (error) {
      failure = error;
      try { await prepared.cancel(); } catch (cleanup) { failure = new AggregateError([failure, cleanup], 'Managed LSP cancellation failed'); }
      throw failure;
    } finally {
      clearTimeout(timeout); clearInterval(heartbeat);
      try { await prepared.lease.release(); } catch (cleanup) { throw new AggregateError([...(failure ? [failure] : []), cleanup], 'Managed LSP cleanup failed'); }
    }
  }

  override async workspaceSymbol(query: string, boundary?: string, signal?: AbortSignal) {
    await this.authority();
    return super.workspaceSymbol(query, boundary, signal);
  }

  override async statusAsync(): Promise<LspStatus> {
    const commands = listServers().map((server) => server.command);
    const result: unknown = JSON.parse(await this.run('/usr/bin/python3', ['-c', 'import json,shutil,sys; print(json.dumps([c for c in sys.argv[1:] if shutil.which(c)]))', ...commands]));
    if (!Array.isArray(result) || result.some((command) => typeof command !== 'string' || !commands.includes(command))) throw new Error('Invalid guest language-server status.');
    this.installed.clear();
    for (const command of result) this.installed.add(command as string);
    return this.status();
  }

  async changePackages(command: string, uninstall: boolean): Promise<void> {
    const spec = listServers().find((server) => server.command === command);
    if (!spec?.npmPackages?.length) throw new Error('This language server is not npm-managed.');
    this.disposeAll();
    const packages = uninstall ? spec.npmPackages : (spec.npmInstallSpecs ?? spec.npmPackages);
    await this.run('npm', [uninstall ? 'uninstall' : 'install', '--global', '--ignore-scripts', '--', ...packages]);
    const status = await this.statusAsync();
    if (!uninstall && !status.servers.find((server) => server.command === command)?.installed) throw new Error('Installed language server is not on the guest PATH.');
  }

  async shutdown(): Promise<void> {
    this.stopped = true;
    this.disposeAll();
    // A dispose that raced this stop (a client torn down between the snapshot above and the first await)
    // joins the same cleanup set — drain until it is empty instead of awaiting one stale snapshot.
    while (this.cleanups.size > 0) await Promise.all([...this.cleanups]);
  }
}
