import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export const DEVICE_LOGIN_ARGS = [
  'auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web', '--skip-ssh-key', '--insecure-storage',
] as const;
export const TOKEN_ARGS = ['auth', 'token', '--hostname', 'github.com'] as const;
export const VERSION_ARGS = ['--version'] as const;
export const DEVICE_URL = 'https://github.com/login/device';
export const DEVICE_FLOW_TTL = 10 * 60_000;
const MAX_OUTPUT = 64 * 1024;
const MAX_VERSION_OUTPUT = 8 * 1024;
const PROCESS_GRACE_MS = 2_000;
const READINESS_TTL = 60_000;
const OPAQUE_TOKEN = /^\S+$/;

interface SpawnOptions { cwd: string; env: NodeJS.ProcessEnv; stdio: ['ignore', 'pipe', 'pipe']; detached: boolean }
type Spawn = (file: string, args: readonly string[], options: SpawnOptions) => ChildProcess;
type RemoveDirectory = (directory: string) => void;

interface TrackedChild {
  child: ChildProcess;
  stopping: boolean;
  escalation?: NodeJS.Timeout;
}

export interface DevicePrompt { verificationUrl: string; userCode: string }
export interface GitHubAuthEnv { env: NodeJS.ProcessEnv; directory: string }
export interface GitHubAuthCallbacks {
  onDirectory(directory: string): void;
  onComplete(token: string): Promise<void>;
  onFailure(error: string): void;
  onCleanup(directory: string, cleaned: boolean): void;
}
export interface GitHubAuthDeps {
  now?: () => number;
  spawn?: Spawn;
  tempRoot?: string;
  ghBinary?: string;
  removeDirectory?: RemoveDirectory;
  platform?: NodeJS.Platform;
}

export function parseDevicePrompt(output: string): DevicePrompt | null {
  const normalized = output
    .replace(/\r\n?/g, '\n')
    .replace(/\x1b\[[0-?]*[ -\/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '');
  const url = normalized.match(/https:\/\/github\.com\/login\/device(?:\?[^\s'"<>]*)?/u)?.[0];
  const userCode = normalized.match(/\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/u)?.[1];
  return url && userCode ? { verificationUrl: url, userCode } : null;
}

export function createGitHubAuthEnv(directory: string, inherited: NodeJS.ProcessEnv = process.env): GitHubAuthEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'LANG', 'LC_ALL', 'LC_CTYPE', 'SystemRoot', 'ComSpec', 'PATHEXT']) {
    if (inherited[key]) env[key] = inherited[key];
  }
  env.HOME = directory;
  env.GH_CONFIG_DIR = directory;
  env.GH_BROWSER = 'echo';
  env.NO_COLOR = '1';
  return { env, directory };
}

export function validateDeviceToken(value: string): string {
  const token = value.trim();
  if (!token || Buffer.byteLength(token) > MAX_OUTPUT || !OPAQUE_TOKEN.test(token) || token.includes('\n') || token.includes('\r')) {
    throw new Error('GitHub returned an invalid token.');
  }
  return token;
}

export class GitHubAuthAdapter {
  private readonly now: () => number;
  private readonly spawn: Spawn;
  private readonly configuredTempRoot: string;
  private readonly ghBinary: string;
  private readonly remove: RemoveDirectory;
  private readonly platform: NodeJS.Platform;
  private readonly children = new Map<string, TrackedChild>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private tempRoot: string | null = null;
  private readinessCache: { checkedAt: number; result: { ok: boolean; detail: string } } | null = null;

  constructor(deps: GitHubAuthDeps = {}) {
    this.now = deps.now ?? Date.now;
    this.spawn = deps.spawn ?? ((file, args, options) => nodeSpawn(file, [...args], options));
    this.configuredTempRoot = resolve(deps.tempRoot ?? join(tmpdir(), 'elowen-github-auth'));
    this.ghBinary = deps.ghBinary ?? 'gh';
    this.remove = deps.removeDirectory ?? ((directory) => rmSync(directory, { recursive: true, force: true }));
    this.platform = deps.platform ?? process.platform;
  }

  async readiness(): Promise<{ ok: boolean; detail: string }> {
    const cached = this.readinessCache;
    if (cached && this.now() - cached.checkedAt < READINESS_TTL) return cached.result;
    let result: { ok: boolean; detail: string };
    try {
      const root = this.ensureTempRoot();
      const auth = createGitHubAuthEnv(root);
      const output = await this.captureCommand(`readiness:${randomUUID()}`, VERSION_ARGS, auth, MAX_VERSION_OUTPUT, 5_000);
      const version = /\bgh version ([0-9]+(?:\.[0-9]+){1,3})\b/i.exec(output)?.[1];
      result = version
        ? { ok: true, detail: `GitHub CLI ${version} is available.` }
        : { ok: false, detail: 'GitHub CLI returned an unrecognized version response.' };
    } catch {
      result = { ok: false, detail: 'GitHub CLI is unavailable or could not be executed.' };
    }
    this.readinessCache = { checkedAt: this.now(), result };
    return result;
  }

  async start(flowId: string, callbacks: GitHubAuthCallbacks): Promise<{ prompt: DevicePrompt; expiresAt: number; directory: string }> {
    const root = this.ensureTempRoot();
    const directory = mkdtempSync(join(root, `elowen-github-${flowId}-`));
    chmodSync(directory, 0o700);
    const auth = createGitHubAuthEnv(directory);
    let child: ChildProcess | null = null;
    try {
      callbacks.onDirectory(directory);
      child = this.spawnTracked(flowId, DEVICE_LOGIN_ARGS, auth);
      const closed = this.childClose(child);
      const expiresAt = this.now() + DEVICE_FLOW_TTL;
      const timer = setTimeout(() => {
        this.stopFlowChildren(flowId);
        this.clearTimer(flowId);
        callbacks.onFailure('GitHub device login expired.');
        this.cleanup(flowId, directory, callbacks);
      }, Math.max(0, expiresAt - this.now()));
      timer.unref?.();
      this.timers.set(flowId, timer);
      const prompt = await this.capturePrompt(child);
      void closed.then((code) => this.finish(flowId, child!, auth, code, callbacks));
      return { prompt, expiresAt, directory };
    } catch (error) {
      this.clearTimer(flowId);
      if (child) this.stopTracked(flowId);
      callbacks.onFailure('GitHub device login could not be started.');
      this.cleanup(flowId, directory, callbacks);
      throw error;
    }
  }

  cancel(flowId: string, directory?: string): boolean {
    this.clearTimer(flowId);
    this.stopFlowChildren(flowId);
    return directory ? this.cleanupDirectory(flowId, directory) : true;
  }

  stopAll(): void {
    for (const flowId of this.timers.keys()) this.clearTimer(flowId);
    for (const id of this.children.keys()) this.stopTracked(id);
  }

  cleanupDirectory(flowId: string, directory: string | null | undefined): boolean {
    if (!directory) return true;
    let root: string;
    try { root = this.ensureTempRoot(); } catch { return false; }
    const candidate = resolve(directory);
    if (dirname(candidate) !== root || !basename(candidate).startsWith(`elowen-github-${flowId}-`)) return false;
    if (!existsSync(candidate)) return true;
    try {
      const info = lstatSync(candidate);
      if (!info.isDirectory() || info.isSymbolicLink()) return false;
      if (realpathSync(dirname(candidate)) !== root) return false;
      this.remove(candidate);
      return !existsSync(candidate);
    } catch {
      return false;
    }
  }

  private ensureTempRoot(): string {
    if (this.tempRoot) return this.tempRoot;
    mkdirSync(this.configuredTempRoot, { recursive: true, mode: 0o700 });
    const info = lstatSync(this.configuredTempRoot);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('GitHub auth temp root is unsafe.');
    if (typeof process.getuid === 'function' && statSync(this.configuredTempRoot).uid !== process.getuid()) {
      throw new Error('GitHub auth temp root has an unexpected owner.');
    }
    chmodSync(this.configuredTempRoot, 0o700);
    const root = realpathSync(this.configuredTempRoot);
    this.tempRoot = root;
    return root;
  }

  private spawnTracked(id: string, args: readonly string[], auth: GitHubAuthEnv): ChildProcess {
    const child = this.spawn(this.ghBinary, args, {
      cwd: auth.directory,
      env: auth.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: this.platform !== 'win32',
    });
    const tracked: TrackedChild = { child, stopping: false };
    this.children.set(id, tracked);
    child.once('close', () => {
      if (tracked.escalation) clearTimeout(tracked.escalation);
      setImmediate(() => { if (this.children.get(id)?.child === child) this.children.delete(id); });
    });
    return child;
  }

  private childClose(child: ChildProcess): Promise<number | null> {
    return new Promise((resolvePromise) => child.once('close', (code) => resolvePromise(code)));
  }

  private capturePrompt(child: ChildProcess): Promise<DevicePrompt> {
    return new Promise((resolvePrompt, reject) => {
      let output = '';
      let outputBytes = 0;
      let settled = false;
      const append = (chunk: Buffer | string): void => {
        if (settled) return;
        const value = chunk.toString();
        outputBytes += Buffer.byteLength(value);
        if (outputBytes > MAX_OUTPUT) {
          settled = true;
          output = '';
          reject(new Error('GitHub device login output exceeded the limit.'));
          return;
        }
        output += value;
        const prompt = parseDevicePrompt(output);
        if (prompt) { settled = true; output = ''; resolvePrompt(prompt); }
      };
      child.stdout?.on('data', append);
      child.stderr?.on('data', append);
      child.once('error', (error) => { if (!settled) { settled = true; output = ''; reject(error); } });
      child.once('close', (code) => {
        if (settled) return;
        settled = true;
        output = '';
        reject(new Error(code === 0 ? 'GitHub device login did not return a verification prompt.' : 'GitHub device login failed.'));
      });
    });
  }

  private async finish(flowId: string, child: ChildProcess, auth: GitHubAuthEnv, code: number | null, callbacks: GitHubAuthCallbacks): Promise<void> {
    const tracked = this.children.get(flowId);
    if (!tracked || tracked.child !== child || tracked.stopping) return;
    this.clearTimer(flowId);
    if (code !== 0) {
      callbacks.onFailure('GitHub device login failed.');
      this.cleanup(flowId, auth.directory, callbacks);
      return;
    }
    try {
      const token = await this.readToken(flowId, auth);
      await callbacks.onComplete(token);
    } catch {
      callbacks.onFailure('GitHub device login could not be completed.');
    } finally {
      this.cleanup(flowId, auth.directory, callbacks);
    }
  }

  private readToken(flowId: string, auth: GitHubAuthEnv): Promise<string> {
    return this.captureCommand(`${flowId}:token`, TOKEN_ARGS, auth, MAX_OUTPUT, 30_000).then(validateDeviceToken);
  }

  private captureCommand(id: string, args: readonly string[], auth: GitHubAuthEnv, maxOutput: number, timeoutMs: number): Promise<string> {
    return new Promise((resolveOutput, reject) => {
      let child: ChildProcess;
      try { child = this.spawnTracked(id, args, auth); }
      catch { reject(new Error('GitHub command failed.')); return; }
      let stdout = '';
      let outputBytes = 0;
      let settled = false;
      const fail = (): void => {
        if (settled) return;
        settled = true;
        stdout = '';
        this.stopTracked(id);
        reject(new Error('GitHub command failed.'));
      };
      const timeout = setTimeout(fail, timeoutMs);
      timeout.unref?.();
      child.stdout?.on('data', (chunk) => {
        if (settled) return;
        const value = chunk.toString();
        outputBytes += Buffer.byteLength(value);
        if (outputBytes > maxOutput) { fail(); return; }
        stdout += value;
      });
      child.stderr?.on('data', (chunk) => {
        if (settled) return;
        outputBytes += Buffer.byteLength(chunk.toString());
        if (outputBytes > maxOutput) fail();
      });
      child.once('error', fail);
      child.once('close', (code) => {
        clearTimeout(timeout);
        if (settled) return;
        settled = true;
        if (code !== 0) { stdout = ''; reject(new Error('GitHub command failed.')); return; }
        const result = stdout;
        stdout = '';
        resolveOutput(result);
      });
    });
  }

  private stopFlowChildren(flowId: string): void {
    for (const id of this.children.keys()) if (id === flowId || id.startsWith(`${flowId}:`)) this.stopTracked(id);
  }

  private stopTracked(id: string): void {
    const tracked = this.children.get(id);
    if (!tracked || tracked.stopping) return;
    if (tracked.child.exitCode !== null || tracked.child.signalCode !== null) {
      this.children.delete(id);
      return;
    }
    tracked.stopping = true;
    this.signal(tracked.child, 'SIGTERM');
    tracked.escalation = setTimeout(() => this.signal(tracked.child, 'SIGKILL'), PROCESS_GRACE_MS);
    tracked.escalation.unref?.();
  }

  private signal(child: ChildProcess, signal: NodeJS.Signals): void {
    if (child.exitCode !== null || child.signalCode !== null) return;
    try {
      if (this.platform !== 'win32' && child.pid) process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch {
      try { child.kill(signal); } catch { /* process already exited */ }
    }
  }

  private clearTimer(flowId: string): void {
    const timer = this.timers.get(flowId);
    if (timer) clearTimeout(timer);
    this.timers.delete(flowId);
  }

  private cleanup(flowId: string, directory: string, callbacks: GitHubAuthCallbacks): void {
    callbacks.onCleanup(directory, this.cleanupDirectory(flowId, directory));
  }
}

export function newFlowId(): string { return `gh-${randomUUID()}`; }
