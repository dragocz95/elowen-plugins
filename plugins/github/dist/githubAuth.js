import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn as nodeSpawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
export const DEVICE_LOGIN_ARGS = [
    'auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web', '--skip-ssh-key', '--insecure-storage',
];
export const TOKEN_ARGS = ['auth', 'token', '--hostname', 'github.com'];
export const DEVICE_URL = 'https://github.com/login/device';
export const DEVICE_FLOW_TTL = 10 * 60_000;
const MAX_OUTPUT = 64 * 1024;
const OPAQUE_TOKEN = /^\S+$/;
export function parseDevicePrompt(output) {
    const normalized = output.replace(/\r\n?/g, '\n').replace(/\x1b\[[0-?]*[ -\/]*[@-~]/g, '');
    const url = normalized.match(/https:\/\/github\.com\/login\/device(?:\?[^\s'"<>]*)?/u)?.[0];
    const userCode = normalized.match(/\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/u)?.[1];
    return url && userCode ? { verificationUrl: url, userCode } : null;
}
export function createGitHubAuthEnv(directory, inherited = process.env) {
    const env = {};
    for (const key of ['PATH', 'LANG', 'LC_ALL', 'LC_CTYPE', 'SystemRoot', 'ComSpec', 'PATHEXT']) {
        if (inherited[key])
            env[key] = inherited[key];
    }
    env.HOME = directory;
    env.GH_CONFIG_DIR = directory;
    env.GH_BROWSER = 'echo';
    env.NO_COLOR = '1';
    return { env, directory };
}
export function validateDeviceToken(value) {
    const token = value.trim();
    if (!token || !OPAQUE_TOKEN.test(token) || token.includes('\n') || token.includes('\r'))
        throw new Error('GitHub returned an invalid token.');
    return token;
}
export class GitHubAuthAdapter {
    now;
    spawn;
    tempRoot;
    ghBinary;
    children = new Map();
    timers = new Map();
    constructor(deps = {}) {
        this.now = deps.now ?? Date.now;
        this.spawn = deps.spawn ?? ((file, args, options) => nodeSpawn(file, [...args], options));
        this.tempRoot = deps.tempRoot ?? tmpdir();
        this.ghBinary = deps.ghBinary ?? 'gh';
    }
    async start(flowId, onComplete, onFailure) {
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
        }
        catch (error) {
            this.children.delete(flowId);
            this.stopChild(child);
            this.removeDirectory(directory);
            onFailure('GitHub device login could not be started.');
            throw error;
        }
    }
    cancel(flowId, directory) {
        this.clearTimer(flowId);
        this.stopFlowChildren(flowId);
        if (directory)
            this.removeDirectory(directory);
    }
    stopAll(flows = []) {
        for (const flowId of this.timers.keys())
            this.clearTimer(flowId);
        for (const child of this.children.values())
            this.stopChild(child);
        this.children.clear();
        for (const flow of flows)
            if (flow.directory)
                this.removeDirectory(flow.directory);
    }
    cleanupDirectory(directory) {
        if (directory)
            this.removeDirectory(directory);
    }
    capturePrompt(child) {
        return new Promise((resolve, reject) => {
            let output = '';
            let settled = false;
            const append = (chunk) => {
                if (settled)
                    return;
                output += chunk.toString();
                if (Buffer.byteLength(output) > MAX_OUTPUT) {
                    settled = true;
                    this.stopChild(child);
                    reject(new Error('GitHub device login output exceeded the limit.'));
                    return;
                }
                const prompt = parseDevicePrompt(output);
                if (prompt) {
                    settled = true;
                    resolve(prompt);
                }
            };
            child.stdout?.on('data', append);
            child.stderr?.on('data', append);
            child.once('error', (error) => { if (!settled) {
                settled = true;
                reject(error);
            } });
            child.once('close', (code) => {
                if (settled)
                    return;
                settled = true;
                reject(new Error(code === 0 ? 'GitHub device login did not return a verification prompt.' : 'GitHub device login failed.'));
            });
        });
    }
    async finish(flowId, child, auth, code, onComplete, onFailure) {
        if (this.children.get(flowId) !== child)
            return;
        this.children.delete(flowId);
        this.clearTimer(flowId);
        if (code !== 0) {
            this.removeDirectory(auth.directory);
            onFailure('GitHub device login failed.');
            return;
        }
        try {
            const token = await this.readToken(flowId, auth);
            await onComplete(token);
        }
        catch {
            onFailure('GitHub device login could not be completed.');
        }
        finally {
            this.removeDirectory(auth.directory);
        }
    }
    readToken(flowId, auth) {
        return new Promise((resolve, reject) => {
            const child = this.spawn(this.ghBinary, TOKEN_ARGS, { cwd: auth.directory, env: auth.env, stdio: ['ignore', 'pipe', 'pipe'] });
            const tokenChildId = `${flowId}:token`;
            this.children.set(tokenChildId, child);
            let stdout = '';
            let stderrBytes = 0;
            let settled = false;
            let timeout;
            const fail = () => { this.children.delete(tokenChildId); if (timeout)
                clearTimeout(timeout); if (!settled) {
                settled = true;
                this.stopChild(child);
                reject(new Error('GitHub token command failed.'));
            } };
            timeout = setTimeout(fail, 30_000);
            timeout.unref?.();
            child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); if (Buffer.byteLength(stdout) > MAX_OUTPUT)
                fail(); });
            child.stderr?.on('data', (chunk) => { stderrBytes += Buffer.byteLength(chunk.toString()); if (stderrBytes > MAX_OUTPUT)
                fail(); });
            child.once('error', fail);
            child.once('close', (code) => {
                this.children.delete(tokenChildId);
                if (timeout)
                    clearTimeout(timeout);
                if (settled)
                    return;
                settled = true;
                if (code !== 0) {
                    reject(new Error('GitHub token command failed.'));
                    return;
                }
                try {
                    resolve(validateDeviceToken(stdout));
                }
                catch (error) {
                    reject(error);
                }
            });
        });
    }
    stopFlowChildren(flowId) {
        for (const [id, child] of this.children) {
            if (id === flowId || id.startsWith(`${flowId}:`)) {
                this.stopChild(child);
                this.children.delete(id);
            }
        }
    }
    clearTimer(flowId) {
        const timer = this.timers.get(flowId);
        if (timer)
            clearTimeout(timer);
        this.timers.delete(flowId);
    }
    stopChild(child) { if (!child.killed)
        child.kill('SIGTERM'); }
    removeDirectory(directory) { try {
        rmSync(directory, { recursive: true, force: true });
    }
    catch { /* cleanup is best effort */ } }
}
export function newFlowId() { return `gh-${randomUUID()}`; }
