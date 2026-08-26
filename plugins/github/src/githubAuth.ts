import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export const DEVICE_LOGIN_ARGS = [
  'auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web', '--skip-ssh-key', '--insecure-storage',
] as const;
export const TOKEN_ARGS = ['auth', 'token', '--hostname', 'github.com'] as const;
export const DEVICE_URL = 'https://github.com/login/device';
export const DEVICE_FLOW_TTL = 10 * 60_000;
const MAX_OUTPUT = 64 * 1024;
const OPAQUE_TOKEN = /^\S+$/;

type Spawn = (file: string, args: readonly string[], options: { cwd: string; env: NodeJS.ProcessEnv; stdio: ['ignore', 'pipe', 'pipe'] }) => ChildProcess;

export interface DevicePrompt { verificationUrl: string; userCode: string }
export interface GitHubAuthEnv { env: NodeJS.ProcessEnv; directory: string }
export interface GitHubAuthDeps { now?: () => number; spawn?: Spawn; tempRoot?: string; ghBinary?: string }

export function parseDevicePrompt(output: string): DevicePrompt | null {
  const normalized = output.replace(/\r\n?/g, '\n').replace(/\x1b\[[0-?]*[ -\/]*[@-~]/g, '');
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
  if (!token || !OPAQUE_TOKEN.test(token) || token.includes('\n') || token.includes('\r')) throw new Error('GitHub returned an invalid token.');
  return token;
}

export class GitHubAuthAdapter {
  private readonly now: () => number;
  private readonly spawn: Spawn;
  private readonly tempRoot: string;
  private readonly ghBinary: string;
  private readonly children = new Map<string, ChildProcess>();
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(deps: GitHubAuthDeps = {}) {
    this.now = deps.now ?? Date.now;
    this.spawn = deps.spawn ?? ((file, args, options) => nodeSpawn(file, [...args], options));
    this.tempRoot = deps.tempRoot ?? tmpdir();
    this.ghBinary = deps.ghBinary ?? 'gh';
  }

  async start(flowId: string, onComplete: (token: string) => Promise<void>, onFailure: (error: string) => void): Promise<{ prompt: DevicePrompt; expiresAt: number; directory: string }> {
    const directory = mkdtempSync(join(this.tempRoot, `elowen-github-${flowId}-`));
    chmodSync(directory, 0o700);
    const auth = createGitHubAuthEnv(directory);
    const child = this.spawn(this.ghBinary, DEVICE_LOGIN_ARGS, { cwd: directory, env: auth.env, stdio: ['ignore', 'pipe', 'pipe'] });
    this.children.set(flowId, child);
    const expiresAt = this.now() + DEVICE_FLOW_TTL;
    const timer = setTimeout(() => {
      this.stopFlowChildren(flowId);
      this.removeDirectory(directory);
      this.clearTimer(flowId);
      onFailure('GitHub device login expired.');
    }, Math.max(0, expiresAt - this.now()));
    timer.unref?.();
    this.timers.set(flowId, timer);
    try {
      const prompt = await this.capturePrompt(child);
      child.once('close', (code) => {
        void this.finish(flowId, child, auth, code, onComplete, onFailure);
      });
      return { prompt, expiresAt, directory };
    } catch (error) {
      this.children.delete(flowId);
      this.stopChild(child);
      this.removeDirectory(directory);
      onFailure('GitHub device login could not be started.');
      throw error;
    }
  }

  cancel(flowId: string, directory?: string): void {
    this.clearTimer(flowId);
    this.stopFlowChildren(flowId);
    if (directory) this.removeDirectory(directory);
  }

  stopAll(flows: readonly { flowId: string; directory?: string | null }[] = []): void {
    for (const flowId of this.timers.keys()) this.clearTimer(flowId);
    for (const child of this.children.values()) this.stopChild(child);
    this.children.clear();
    for (const flow of flows) if (flow.directory) this.removeDirectory(flow.directory);
  }

  cleanupDirectory(directory: string | null | undefined): void {
    if (directory) this.removeDirectory(directory);
  }

  private capturePrompt(child: ChildProcess): Promise<DevicePrompt> {
    return new Promise((resolve, reject) => {
      let output = '';
      let settled = false;
      const append = (chunk: Buffer | string): void => {
        if (settled) return;
        output += chunk.toString();
        if (Buffer.byteLength(output) > MAX_OUTPUT) {
          settled = true;
          this.stopChild(child);
          reject(new Error('GitHub device login output exceeded the limit.'));
          return;
        }
        const prompt = parseDevicePrompt(output);
        if (prompt) { settled = true; resolve(prompt); }
      };
      child.stdout?.on('data', append);
      child.stderr?.on('data', append);
      child.once('error', (error) => { if (!settled) { settled = true; reject(error); } });
      child.once('close', (code) => {
        if (settled) return;
        settled = true;
        reject(new Error(code === 0 ? 'GitHub device login did not return a verification prompt.' : 'GitHub device login failed.'));
      });
    });
  }

  private async finish(flowId: string, child: ChildProcess, auth: GitHubAuthEnv, code: number | null, onComplete: (token: string) => Promise<void>, onFailure: (error: string) => void): Promise<void> {
    if (this.children.get(flowId) !== child) return;
    this.children.delete(flowId);
    this.clearTimer(flowId);
    if (code !== 0) { this.removeDirectory(auth.directory); onFailure('GitHub device login failed.'); return; }
    try {
      const token = await this.readToken(flowId, auth);
      await onComplete(token);
    } catch {
      onFailure('GitHub device login could not be completed.');
    } finally {
      this.removeDirectory(auth.directory);
    }
  }

  private readToken(flowId: string, auth: GitHubAuthEnv): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = this.spawn(this.ghBinary, TOKEN_ARGS, { cwd: auth.directory, env: auth.env, stdio: ['ignore', 'pipe', 'pipe'] });
      const tokenChildId = `${flowId}:token`;
      this.children.set(tokenChildId, child);
      let stdout = '';
      let stderrBytes = 0;
      let settled = false;
      let timeout: NodeJS.Timeout | undefined;
      const fail = (): void => { this.children.delete(tokenChildId); if (timeout) clearTimeout(timeout); if (!settled) { settled = true; this.stopChild(child); reject(new Error('GitHub token command failed.')); } };
      timeout = setTimeout(fail, 30_000);
      timeout.unref?.();
      child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); if (Buffer.byteLength(stdout) > MAX_OUTPUT) fail(); });
      child.stderr?.on('data', (chunk) => { stderrBytes += Buffer.byteLength(chunk.toString()); if (stderrBytes > MAX_OUTPUT) fail(); });
      child.once('error', fail);
      child.once('close', (code) => {
        this.children.delete(tokenChildId);
        if (timeout) clearTimeout(timeout);
        if (settled) return;
        settled = true;
        if (code !== 0) { reject(new Error('GitHub token command failed.')); return; }
        try { resolve(validateDeviceToken(stdout)); } catch (error) { reject(error); }
      });
    });
  }

  private stopFlowChildren(flowId: string): void {
    for (const [id, child] of this.children) {
      if (id === flowId || id.startsWith(`${flowId}:`)) {
        this.stopChild(child);
        this.children.delete(id);
      }
    }
  }

  private clearTimer(flowId: string): void {
    const timer = this.timers.get(flowId);
    if (timer) clearTimeout(timer);
    this.timers.delete(flowId);
  }

  private stopChild(child: ChildProcess): void { if (!child.killed) child.kill('SIGTERM'); }
  private removeDirectory(directory: string): void { try { rmSync(directory, { recursive: true, force: true }); } catch { /* cleanup is best effort */ } }
}

export function newFlowId(): string { return `gh-${randomUUID()}`; }