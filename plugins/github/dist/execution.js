import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { GitHubPluginError } from './errors.js';
import { canonicalHttpsRepository } from './remotes.js';
const MAX_OUTPUT = 1024 * 1024;
const HELPER_SOURCE = String.raw `const net=require('node:net');let a=process.argv.slice(1),o=a.pop(),n=a[a.indexOf('--nonce')+1],s=a[a.indexOf('--socket')+1],d='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{let q={nonce:n};for(let l of d.split(/\r?\n/)){let i=l.indexOf('=');if(i>0)q[l.slice(0,i)]=l.slice(i+1)}let c=net.createConnection(s);c.end(JSON.stringify(q));let r='';c.setEncoding('utf8');c.on('data',x=>r+=x);c.on('end',()=>{let v=JSON.parse(r);if(!v.ok)process.exit(1);process.stdout.write('username='+v.username+'\npassword='+v.password+'\n\n')});c.on('error',()=>process.exit(1))})`;
export const spawnPrepared = async (prepared, timeoutMs = 60_000) => new Promise((resolveResult, reject) => {
    const launch = prepared.launch;
    const child = launch.type === 'argv'
        ? spawn(launch.file, launch.args, { cwd: prepared.cwd, env: launch.env, stdio: ['ignore', 'pipe', 'pipe'] })
        : spawn('/bin/bash', ['-c', launch.command], { cwd: prepared.cwd, env: launch.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let overflow = false;
    const append = (target, chunk) => {
        const value = chunk.toString('utf8');
        if (stdout.length + stderr.length + value.length > MAX_OUTPUT) {
            overflow = true;
            child.kill('SIGKILL');
            return;
        }
        if (target === 'stdout')
            stdout += value;
        else
            stderr += value;
    };
    child.stdout.on('data', (chunk) => append('stdout', chunk));
    child.stderr.on('data', (chunk) => append('stderr', chunk));
    const heartbeat = setInterval(() => void prepared.lease.heartbeat(), 10_000);
    heartbeat.unref();
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    timer.unref();
    const finish = async () => { clearInterval(heartbeat); clearTimeout(timer); await prepared.lease.release(); };
    child.once('error', (error) => { void finish().finally(() => reject(error)); });
    child.once('close', (code, signal) => {
        void finish().then(() => {
            if (overflow)
                return reject(new GitHubPluginError('git_output_too_large', 502, 'Git produced too much output.'));
            if (code !== 0)
                return reject(new GitHubPluginError('git_command_failed', 409, 'Git rejected the operation.', { code, signal, stderr: redact(stderr) }));
            resolveResult({ stdout, stderr });
        }, reject);
    });
});
function shellQuote(value) { return `'${value.replaceAll("'", `'\\''`)}'`; }
function redact(value) { return value.replace(/(authorization|password|token)\s*[:=]\s*\S+/gi, '$1=[redacted]'); }
async function prepare(ctx, cwd, file, args) {
    const sandbox = ctx.control('sandbox');
    if (!sandbox)
        throw new GitHubPluginError('sandbox_unavailable', 503, 'Sandbox is required to publish a branch.');
    return sandbox.prepareExecution({ command: { type: 'argv', file, args }, cwd, leaseKind: 'github' });
}
async function git(ctx, cwd, args, runner) {
    const prepared = await prepare(ctx, cwd, 'git', ['-C', cwd, ...args]);
    return runner(prepared);
}
export async function assertSafeRepositoryConfig(ctx, cwd, runner = spawnPrepared) {
    const paths = await git(ctx, cwd, ['rev-parse', '--git-common-dir', '--git-dir'], runner);
    const [commonRaw, worktreeRaw] = paths.stdout.trim().split(/\r?\n/);
    if (!commonRaw || !worktreeRaw)
        throw new GitHubPluginError('workspace_not_repository', 409, 'The active workspace is not a Git repository.');
    const common = isAbsolute(commonRaw) ? commonRaw : resolve(cwd, commonRaw);
    const worktree = isAbsolute(worktreeRaw) ? worktreeRaw : resolve(cwd, worktreeRaw);
    for (const configPath of [join(common, 'config'), join(worktree, 'config.worktree')]) {
        let config = '';
        try {
            config = readFileSync(configPath, 'utf8');
        }
        catch {
            continue;
        }
        if (unsafeConfig(config)) {
            throw new GitHubPluginError('unsafe_git_config', 409, 'Repository-local Git transport, include, credential or proxy configuration must be removed before publishing.');
        }
    }
}
export function unsafeConfig(config) {
    let section = '';
    for (const raw of config.split(/\r?\n/)) {
        const line = raw.trim();
        const header = /^\[([^\]]+)]$/.exec(line);
        if (header) {
            section = header[1].toLowerCase();
            if (/^(include|includeif|credential)(\s|$)/.test(section) || /^url\s+/.test(section))
                return true;
            continue;
        }
        if (!line || line.startsWith('#') || line.startsWith(';'))
            continue;
        const key = line.split('=', 1)[0].trim().toLowerCase();
        if (section === 'http' && /^(proxy|proxysslcert|proxysslkey|extraheader|sslcert|sslkey)$/.test(key))
            return true;
        if (section.startsWith('http ') && /^(proxy|proxysslcert|proxysslkey|extraheader|sslcert|sslkey)$/.test(key))
            return true;
        if (key === 'credential.helper' || key === 'credential.usehttppath')
            return true;
    }
    return false;
}
async function homeFor(ctx, cwd) {
    const prepared = await prepare(ctx, cwd, 'git', ['--version']);
    const home = prepared.home;
    await prepared.lease.release();
    return home;
}
export async function publishBranch(input) {
    const runner = input.runner ?? spawnPrepared;
    if (!/^elowen\/u\d+\/[A-Za-z0-9._/-]+$/.test(input.branch) || input.branch.includes('..') || input.branch.endsWith('/')) {
        throw new GitHubPluginError('invalid_workspace_branch', 409, 'The active workspace branch is not a generated Elowen branch.');
    }
    await assertSafeRepositoryConfig(input.ctx, input.cwd, runner);
    const head = (await git(input.ctx, input.cwd, ['rev-parse', 'HEAD'], runner)).stdout.trim();
    if (!/^[a-f0-9]{40}$/i.test(head))
        throw new GitHubPluginError('publish_requires_commit', 409, 'Commit at least one change before publishing the branch.');
    const home = await homeFor(input.ctx, input.cwd);
    const nonce = randomBytes(24).toString('base64url');
    const brokerDir = join(home, '.elowen-github', 'brokers', randomBytes(12).toString('hex'));
    const socketPath = join(brokerDir, 'credential.sock');
    mkdirSync(brokerDir, { recursive: true, mode: 0o700 });
    chmodSync(brokerDir, 0o700);
    const remoteUrl = canonicalHttpsRepository(input.repository);
    let used = false;
    let resolveListening = null;
    let rejectListening = null;
    const listening = new Promise((resolvePromise, rejectPromise) => { resolveListening = resolvePromise; rejectListening = rejectPromise; });
    const server = createServer((socket) => {
        let body = '';
        socket.setEncoding('utf8');
        socket.on('data', (chunk) => { body += chunk; if (body.length > 8_192)
            socket.destroy(); });
        socket.on('end', () => {
            try {
                const request = JSON.parse(body);
                const valid = !used && request.nonce === nonce && request.protocol === 'https' && request.host === 'github.com'
                    && request.path === `${input.repository.owner}/${input.repository.name}.git`;
                if (!valid) {
                    socket.end(JSON.stringify({ ok: false }));
                    return;
                }
                used = true;
                socket.end(JSON.stringify({ ok: true, username: 'x-access-token', password: input.token }));
            }
            catch {
                socket.end(JSON.stringify({ ok: false }));
            }
        });
    });
    server.once('error', (error) => rejectListening?.(error));
    server.listen(socketPath, () => { chmodSync(socketPath, 0o600); resolveListening?.(); });
    try {
        await listening;
    }
    catch {
        rmSync(brokerDir, { recursive: true, force: true });
        throw new GitHubPluginError('credential_broker_failed', 502, 'The one-shot Git credential broker could not start.');
    }
    const expiry = setTimeout(() => server.close(), 15_000);
    expiry.unref();
    try {
        const helper = `!node -e ${shellQuote(HELPER_SOURCE)} -- --socket ${shellQuote(socketPath)} --nonce ${shellQuote(nonce)}`;
        const args = [
            '-c', `core.hooksPath=${join(brokerDir, 'empty-hooks')}`,
            '-c', 'credential.helper=', '-c', `credential.helper=${helper}`,
            '-c', 'credential.useHttpPath=true',
            'push', '--porcelain', remoteUrl, `refs/heads/${input.branch}:refs/heads/${input.branch}`,
        ];
        mkdirSync(join(brokerDir, 'empty-hooks'), { mode: 0o700 });
        const prepared = await prepare(input.ctx, input.cwd, 'git', ['-C', input.cwd, ...args]);
        for (const key of Object.keys(prepared.launch.env)) {
            if (/^(GIT_|GH_|SSH_|HTTP_PROXY$|HTTPS_PROXY$|ALL_PROXY$|NO_PROXY$)/i.test(key))
                delete prepared.launch.env[key];
        }
        prepared.launch.env.GIT_CONFIG_NOSYSTEM = '1';
        prepared.launch.env.GIT_CONFIG_GLOBAL = '/dev/null';
        prepared.launch.env.GIT_TERMINAL_PROMPT = '0';
        prepared.launch.env.GIT_ASKPASS = '/bin/false';
        prepared.launch.env.GCM_INTERACTIVE = 'never';
        await runner(prepared, 120_000);
        if (!used)
            throw new GitHubPluginError('credential_broker_unused', 502, 'Git did not request the one-shot credential.');
        return { head, remoteUrl };
    }
    finally {
        clearTimeout(expiry);
        if (server.listening)
            await new Promise((resolvePromise) => server.close(() => resolvePromise()));
        rmSync(brokerDir, { recursive: true, force: true });
    }
}
