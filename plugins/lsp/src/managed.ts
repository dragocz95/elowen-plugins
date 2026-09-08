import { spawn } from 'node:child_process';
import { posix } from 'node:path';
import type { PluginContext, SandboxControl, SandboxPreparedExecution } from 'elowen/dist/plugins/api.js';
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

  constructor(private readonly ctx: PluginContext, readonly project: Project, readonly actor: number, generation?: number) {
    super({
      root: '/workspace',
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

  private async prepare(file: string, args: string[], cwd = '/workspace'): Promise<SandboxPreparedExecution> {
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
      || prepared.launch?.type !== 'argv' || prepared.stdin !== undefined) {
      await prepared.lease.cancel?.();
      await prepared.lease.release();
      throw new Error('Invalid managed LSP project, generation or stream launch.');
    }
    return prepared;
  }

  private cleanup(prepared: SandboxPreparedExecution): void {
    const cleanup = (async () => { await prepared.lease.cancel?.(); await prepared.lease.release(); })();
    this.cleanups.add(cleanup);
    void cleanup.then(() => this.cleanups.delete(cleanup), (error: unknown) => {
      this.ctx.logger.warn(`Managed LSP cleanup failed: ${String(error)}`);
    });
  }

  private transport(prepared: SandboxPreparedExecution): LspTransport {
    if (prepared.launch.type !== 'argv') throw new Error('Managed LSP requires an argv launch.');
    let child;
    try { child = spawn(prepared.launch.file, prepared.launch.args, { cwd: prepared.cwd, env: prepared.launch.env, stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch (error) { this.cleanup(prepared); throw error; }
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
    child.on('error', finish);
    child.on('close', finish);
    child.stdin.on('error', finish);
    child.stderr.resume();
    child.stdout.on('data', (data: Buffer) => {
      try { for (const message of decoder.push(data)) for (const callback of messages) callback(message); }
      catch { finish(); }
    });
    return {
      send: (frame) => { if (ended) throw new Error('Managed language server closed.'); child.stdin.write(frame); },
      onMessage: (callback) => { messages.push(callback); },
      onExit: (callback) => { if (ended) callback(); else exits.push(callback); },
      dispose: finish,
    };
  }

  /** Status and package changes execute in the same guest and retain the same lease authority. */
  private async run(file: string, args: string[]): Promise<string> {
    const prepared = await this.prepare(file, args);
    if (prepared.launch.type !== 'argv') throw new Error('Managed LSP requires an argv launch.');
    const launch = prepared.launch;
    try {
      return await new Promise<string>((resolve, reject) => {
        const child = spawn(launch.file, launch.args, { cwd: prepared.cwd, env: launch.env, stdio: ['pipe', 'pipe', 'pipe'] });
        const chunks: Buffer[] = [];
        let size = 0;
        const timeout = setTimeout(() => { finish(); reject(new Error('Guest LSP command timed out.')); }, 120000);
        const heartbeat = setInterval(() => {
          void Promise.resolve().then(() => prepared.lease.heartbeat()).catch((error: unknown) => { finish(); reject(error); });
        }, 5000);
        const finish = (): void => { clearTimeout(timeout); clearInterval(heartbeat); };
        child.on('error', (error) => { finish(); reject(error); });
        child.on('close', (code) => { finish(); code === 0 ? resolve(Buffer.concat(chunks).toString('utf8')) : reject(new Error(`Guest LSP command exited with ${code}.`)); });
        child.stdout.on('data', (data: Buffer) => { size += data.length; if (size > 1024 * 1024) { finish(); reject(new Error('Guest LSP output exceeded its limit.')); } else chunks.push(data); });
        child.stderr.resume();
        child.stdin.on('error', (error) => { finish(); reject(error); });
        child.stdin.end();
      });
    } finally { await prepared.lease.cancel?.(); await prepared.lease.release(); }
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
