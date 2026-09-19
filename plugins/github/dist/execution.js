import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { GitHubPluginError } from './errors.js';
import { canonicalHttpsRepository } from './remotes.js';
import { publishManaged } from './staging.js';
const MAX_OUTPUT = 1024 * 1024;
const HELPER_SOURCE = String.raw `const net=require('node:net');let a=process.argv.slice(1),o=a.pop(),n=a[a.indexOf('--nonce')+1],s=a[a.indexOf('--socket')+1],d='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{let q={nonce:n};for(let l of d.split(/\r?\n/)){let i=l.indexOf('=');if(i>0)q[l.slice(0,i)]=l.slice(i+1)}let c=net.createConnection(s);c.end(JSON.stringify(q));let r='';c.setEncoding('utf8');c.on('data',x=>r+=x);c.on('end',()=>{let v=JSON.parse(r);if(!v.ok)process.exit(1);process.stdout.write('username='+v.username+'\npassword='+v.password+'\n\n')});c.on('error',()=>process.exit(1))})`;
export const spawnPrepared = async (prepared, timeoutMs = 60_000, secrets = []) => {
    if (prepared.mode === 'managed')
        return await captureManaged(prepared, timeoutMs, secrets);
    return await new Promise((resolveResult, reject) => {
        const launch = prepared.launch;
        let child;
        try {
            child = launch.type === 'argv'
                ? spawn(launch.file, launch.args, { cwd: prepared.cwd, env: launch.env, stdio: ['pipe', 'pipe', 'pipe'] })
                : spawn('/bin/bash', ['-c', launch.command], { cwd: prepared.cwd, env: launch.env, stdio: ['pipe', 'pipe', 'pipe'] });
        }
        catch (error) {
            void Promise.resolve(prepared.lease.release()).then(() => reject(error), reject);
            return;
        }
        let stdout = '';
        let stderr = '';
        let overflow = false;
        let failure;
        let cancellation;
        const stop = (error) => {
            failure ??= error;
            cancellation ??= (prepared.cancel ? prepared.cancel() : Promise.resolve()).catch(error => { failure = error; }).then(() => { child.kill('SIGKILL'); });
        };
        const append = (target, chunk) => {
            const value = chunk.toString('utf8');
            if (stdout.length + stderr.length + value.length > MAX_OUTPUT) {
                overflow = true;
                stop(new Error('Git output too large'));
                return;
            }
            if (target === 'stdout')
                stdout += value;
            else
                stderr += value;
        };
        child.stdout.on('data', (chunk) => append('stdout', chunk));
        child.stderr.on('data', (chunk) => append('stderr', chunk));
        const heartbeat = setInterval(() => { Promise.resolve().then(() => prepared.lease.heartbeat()).catch(stop); }, 10_000);
        heartbeat.unref();
        const timer = setTimeout(() => stop(new Error('Git command timed out')), timeoutMs);
        timer.unref();
        const finish = async () => { clearInterval(heartbeat); clearTimeout(timer); await cancellation; await prepared.lease.release(); };
        child.once('error', stop);
        child.stdin.on('error', stop);
        child.stdin.end(prepared.stdin);
        child.once('close', (code, signal) => {
            void finish().then(() => {
                if (overflow)
                    return reject(new GitHubPluginError('git_output_too_large', 502, 'Git produced too much output.'));
                if (failure)
                    return reject(sanitizedExecutionError(failure, secrets));
                if (code !== 0)
                    return reject(new GitHubPluginError('git_command_failed', 409, 'Git rejected the operation.', { code, signal, stderr: redact(stderr, secrets) }));
                resolveResult({ stdout, stderr });
            }, reject);
        });
    });
};
async function captureManaged(prepared, timeoutMs, secrets) {
    let heartbeat;
    let timer;
    let failure;
    /** Set once the guest has reported its own verdict. A nonzero exit is a SETTLED execution, not an
     *  interrupted one: Git refusing a push or reporting that a directory is not a repository is the answer
     *  this plugin asked for. Cancelling it anyway would run the runtime's termination tombstone against a
     *  process that is already gone, which leaves a persistent mask behind for every routine Git refusal and
     *  turns the release that follows into a second termination proof. Only an interruption — a timeout, a
     *  revoked lease, output past the cap, a transport loss — leaves a guest that still has to be stopped. */
    let settled = false;
    try {
        let interrupt;
        const interrupted = new Promise((_resolve, reject) => { interrupt = reject; });
        void interrupted.catch(() => { });
        timer = setTimeout(() => interrupt(new Error('Git command timed out')), timeoutMs);
        heartbeat = setInterval(() => { void Promise.resolve().then(() => prepared.lease.heartbeat()).catch(interrupt); }, 5000);
        const session = await Promise.race([prepared.start(), interrupted]);
        const stdout = [];
        const stderr = [];
        let bytes = 0;
        const append = (chunks, chunk) => {
            bytes += chunk.length;
            if (bytes > MAX_OUTPUT)
                interrupt(new GitHubPluginError('git_output_too_large', 502, 'Git produced too much output.'));
            else
                chunks.push(chunk);
        };
        session.stdout.on('data', (chunk) => append(stdout, chunk));
        session.stderr.on('data', (chunk) => append(stderr, chunk));
        session.stdin.end();
        const result = await Promise.race([session.closed, interrupted]);
        settled = true;
        const output = { stdout: redact(prepared.sanitizeOutput(Buffer.concat(stdout).toString('utf8')), secrets),
            stderr: redact(prepared.sanitizeOutput(Buffer.concat(stderr).toString('utf8')), secrets) };
        if (result.code !== 0)
            throw new GitHubPluginError('git_command_failed', 409, 'Git rejected the operation.', { ...result, stderr: output.stderr });
        return output;
    }
    catch (error) {
        failure = error;
        if (!settled) {
            try {
                await prepared.cancel();
            }
            catch (cleanup) {
                failure = new AggregateError([failure, cleanup], 'Managed Git cancellation failed');
            }
        }
        throw sanitizedExecutionError(failure, secrets);
    }
    finally {
        clearTimeout(timer);
        clearInterval(heartbeat);
        try {
            await prepared.lease.release();
        }
        catch (cleanup) {
            throw new AggregateError([...(failure ? [failure] : []), cleanup], 'Managed Git cleanup failed');
        }
    }
}
function shellQuote(value) { return `'${value.replaceAll("'", `'\\''`)}'`; }
function redact(value, secrets = []) {
    let redacted = value;
    for (const secret of secrets)
        if (secret)
            redacted = redacted.split(secret).join('[redacted]');
    return redacted.replace(/(authorization|password|token)\s*[:=]\s*\S+/gi, '$1=[redacted]');
}
function sanitizedExecutionError(error, secrets) {
    if (error instanceof GitHubPluginError) {
        const details = error.details ? JSON.parse(redact(JSON.stringify(error.details), secrets)) : undefined;
        return new GitHubPluginError(error.code, error.status, redact(error.message, secrets), details);
    }
    return new GitHubPluginError('git_command_failed', 409, 'Git rejected the operation.', {
        stderr: redact(error instanceof Error ? error.message : String(error), secrets),
    });
}
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
async function assertSafeRepositoryConfig(ctx, cwd, runner = spawnPrepared) {
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
    const inherited = input.ctx.currentAccess().projectRef;
    if (input.projectRef && inherited && (input.projectRef.kind !== inherited.kind || input.projectRef.projectId !== inherited.projectId))
        throw new GitHubPluginError('project_forbidden', 403, 'The publish target differs from the selected project.');
    const projectRef = input.projectRef ?? inherited;
    const managed = projectRef?.kind === 'managed';
    const validBranch = managed ? input.branch.length > 0 : /^elowen\/u\d+\/[A-Za-z0-9._/-]+$/.test(input.branch);
    if (!validBranch || input.branch.includes('..') || input.branch.endsWith('/')) {
        throw new GitHubPluginError('invalid_workspace_branch', 409, 'The active workspace branch is not a generated Elowen branch.');
    }
    if (managed) {
        if (!input.expectedHead)
            throw new GitHubPluginError('publish_scope_invalid', 403, 'An approved managed project commit is required.');
        return publishManaged({ ...input, projectRef, expectedHead: input.expectedHead, runner });
    }
    await assertSafeRepositoryConfig(input.ctx, input.cwd, runner);
    const head = (await git(input.ctx, input.cwd, ['rev-parse', 'HEAD'], runner)).stdout.trim();
    if (!/^[a-f0-9]{40}$/i.test(head))
        throw new GitHubPluginError('publish_requires_commit', 409, 'Commit at least one change before publishing the branch.');
    if (input.expectedHead && head !== input.expectedHead)
        throw new GitHubPluginError('publish_head_changed', 409, 'The approved commit changed.');
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
            'push', '--porcelain', remoteUrl, `${head}:refs/heads/${input.branch}`,
        ];
        mkdirSync(join(brokerDir, 'empty-hooks'), { mode: 0o700 });
        const prepared = await prepare(input.ctx, input.cwd, 'git', ['-C', input.cwd, ...args]);
        if (prepared.mode === 'managed') {
            await prepared.lease.release();
            throw new Error('Host Git publication received a managed session');
        }
        for (const key of Object.keys(prepared.launch.env)) {
            if (/^(GIT_|GH_|SSH_|HTTP_PROXY$|HTTPS_PROXY$|ALL_PROXY$|NO_PROXY$)/i.test(key))
                delete prepared.launch.env[key];
        }
        prepared.launch.env.GIT_CONFIG_NOSYSTEM = '1';
        prepared.launch.env.GIT_CONFIG_GLOBAL = '/dev/null';
        prepared.launch.env.GIT_TERMINAL_PROMPT = '0';
        prepared.launch.env.GIT_ASKPASS = '/bin/false';
        prepared.launch.env.GCM_INTERACTIVE = 'never';
        try {
            await runner(prepared, 120_000, [input.token]);
        }
        catch (error) {
            throw sanitizedExecutionError(error, [input.token]);
        }
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
