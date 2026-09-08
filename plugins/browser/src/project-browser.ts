import { spawn } from 'node:child_process';
import type { PluginContext, SandboxPreparedExecution } from 'elowen/plugin-api';
import type { ConnectionTransport } from 'puppeteer-core';
import type { BrowserLike, BrowserLogger } from './types.js';
import { TabManager } from './tab-manager.js';
import { ProcessTraceLock } from './performance-probe.js';

export type BrowserProject = { kind: 'managed'; projectId: number };

/** Chromium's documented remote-debugging-pipe transport uses NUL-delimited UTF-8 messages. */
export class ProjectCdpTransport implements ConnectionTransport {
  onmessage?: (message: string) => void;
  onclose?: () => void;
  private pending = Buffer.alloc(0);
  private ended = false;
  constructor(private readonly write: (message: string) => void, private readonly stop: () => void) {}
  feed(chunk: Buffer): void {
    if (this.ended) return;
    this.pending = Buffer.concat([this.pending, chunk]);
    while (true) {
      const end = this.pending.indexOf(0);
      if (end < 0) break;
      if (end > 32 * 1024 * 1024) { this.close(); throw new Error('Project browser CDP frame exceeded its limit.'); }
      const message = this.pending.subarray(0, end).toString('utf8');
      this.pending = this.pending.subarray(end + 1);
      this.onmessage?.(message);
    }
    if (this.pending.length > 32 * 1024 * 1024) { this.close(); throw new Error('Project browser CDP frame exceeded its limit.'); }
  }
  send(message: string): void {
    if (this.ended) throw new Error('Project browser connection is closed.');
    this.write(`${message}\0`);
  }
  close(): void {
    if (this.ended) return;
    this.ended = true;
    this.pending = Buffer.alloc(0);
    this.stop();
    this.onclose?.();
  }
}

export interface ProjectBrowserAttachment {
  project: BrowserProject;
  actor: number;
  generation: number;
  browser: BrowserLike;
  tabs: TabManager;
  traceLock: ProcessTraceLock;
  authorize(): Promise<void>;
  onClosed(callback: () => void): void;
  close(): Promise<void>;
}

/** No account profile, host proxy, debugging port or container engine handle crosses this boundary. */
export async function openProjectBrowser(ctx: PluginContext, project: BrowserProject, actor: number, logger: BrowserLogger): Promise<ProjectBrowserAttachment> {
  const selected = ctx.currentAccess().projectRef;
  if (selected?.kind !== 'managed' || selected.projectId !== project.projectId || ctx.currentAccountUserId() !== actor) throw new Error('Project browser is outside the selected project or actor.');
  const sandbox = ctx.control('sandbox');
  if (!sandbox) throw new Error('Project browser environment provider is unavailable.');
  const state = await sandbox.environmentFor({ project, accountUserId: actor });
  if (state.projectId !== project.projectId) throw new Error('Project browser received another project.');
  const generation = state.generation;
  for (const path of ['/data/browser', '/data/browser/downloads']) {
    await sandbox.projectFiles({ project, accountUserId: actor, expectedGeneration: generation, operation: { kind: 'mkdir', path } });
  }
  // The shell only maps the two documented Chrome pipe descriptors. All arguments remain argv data.
  const prepared = await sandbox.prepareExecution({ projectRef: project, cwd: '/workspace', leaseKind: 'browser', command: {
    type: 'argv', file: '/bin/sh', args: ['-c', 'exec 3<&0 4>&1 1>&2; exec "$@"', 'project-browser', '/usr/bin/chromium',
      '--headless=new', '--no-sandbox', '--remote-debugging-pipe', '--user-data-dir=/data/browser/profile',
      '--no-first-run', '--no-default-browser-check', '--disable-dev-shm-usage', 'about:blank'],
  } });
  const valid = prepared.mode === 'managed' && prepared.projectRef?.kind === 'managed' && prepared.projectRef.projectId === project.projectId
    && prepared.lease.projectId === project.projectId && prepared.lease.accountUserId === actor && prepared.lease.runtimeGeneration === generation
    && typeof prepared.lease.cancel === 'function' && prepared.launch.type === 'argv' && prepared.stdin === undefined;
  if (!valid) {
    await prepared.lease.cancel?.();
    await prepared.lease.release();
    throw new Error('Invalid project browser launch identity or runtime generation.');
  }
  return connectProjectBrowser(ctx, prepared, project, actor, generation, logger);
}

async function connectProjectBrowser(ctx: PluginContext, prepared: SandboxPreparedExecution, project: BrowserProject, actor: number,
  generation: number, logger: BrowserLogger): Promise<ProjectBrowserAttachment> {
  if (prepared.launch.type !== 'argv') throw new Error('Project browser requires an argv launch.');
  let cleanup: Promise<void> | undefined;
  let browser: BrowserLike | undefined;
  let tabs: TabManager | undefined;
  let heartbeat: NodeJS.Timeout | undefined;
  let transport: ProjectCdpTransport | undefined;
  const closeListeners = new Set<() => void>();
  const close = (): Promise<void> => {
    if (cleanup) return cleanup;
    cleanup = Promise.resolve().then(async () => {
      if (heartbeat) clearInterval(heartbeat);
      for (const listener of closeListeners) listener();
      closeListeners.clear();
      tabs?.dispose();
      transport?.close();
      await prepared.lease.cancel?.();
      await prepared.lease.release();
    });
    return cleanup;
  };
  const stopped = (): void => { void close().catch((error: unknown) => logger.warn(`Project browser cleanup failed: ${String(error)}`)); };
  try {
    const child = spawn(prepared.launch.file, prepared.launch.args, { cwd: prepared.cwd, env: prepared.launch.env, stdio: ['pipe', 'pipe', 'pipe'] });
    transport = new ProjectCdpTransport((message) => { child.stdin.write(message); }, stopped);
    child.stdout.on('data', (chunk: Buffer) => { try { transport!.feed(chunk); } catch { stopped(); } });
    child.stderr.resume();
    child.stdin.on('error', stopped);
    child.on('error', stopped);
    child.on('close', stopped);
    heartbeat = setInterval(() => { void Promise.resolve().then(() => prepared.lease.heartbeat()).catch(stopped); }, 5000);
    heartbeat.unref();
    const moduleName = 'puppeteer-core';
    const puppeteer = await import(moduleName) as { connect(options: { transport: ConnectionTransport; defaultViewport: { width: number; height: number }; protocolTimeout: number }): Promise<BrowserLike & {
      defaultBrowserContext(): { setDownloadBehavior(options: { policy: 'allow'; downloadPath: string }): Promise<void> };
    }> };
    const connected = await puppeteer.connect({ transport, defaultViewport: { width: 1280, height: 800 }, protocolTimeout: 30000 });
    browser = connected;
    await connected.defaultBrowserContext().setDownloadBehavior({ policy: 'allow', downloadPath: '/data/browser/downloads' });
    if (cleanup) throw new Error('Project browser closed during connection.');
    const authorize = async (): Promise<void> => {
      try {
        const selected = ctx.currentAccess().projectRef;
        if (selected?.kind !== 'managed' || selected.projectId !== project.projectId || ctx.currentAccountUserId() !== actor) throw new Error('Project browser is outside the selected project or actor.');
        const live = ctx.control('sandbox');
        if (!live) throw new Error('Project browser environment provider is unavailable.');
        const current = await live.environmentFor({ project, accountUserId: actor });
        if (current.projectId !== project.projectId || current.generation !== generation || current.state !== 'running') throw new Error('Project browser runtime generation is no longer current.');
        if (cleanup || browser?.connected === false) throw new Error('Project browser connection is closed.');
      } catch (error) { await close(); throw error; }
    };
    await authorize();
    tabs = new TabManager(browser, () => 24, logger, async () => {}, close);
    return { project, actor, generation, browser, tabs, traceLock: new ProcessTraceLock(), authorize, close,
      onClosed: (callback) => { if (cleanup) callback(); else closeListeners.add(callback); },
    };
  } catch (error) { await close(); throw error; }
}
