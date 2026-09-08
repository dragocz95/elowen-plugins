import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PluginContext } from 'elowen/plugin-api';
import type { ProjectExecutionRef } from 'elowen/dist/shared/projectExecution.js';
import type { SpawnPrepared } from './execution.js';
import type { RemoteRepositoryRef } from './types.js';
import { canonicalHttpsRepository } from './remotes.js';
import { GitHubPluginError } from './errors.js';

const exec = promisify(execFile);
const BUNDLE_LIMIT = 64 * 1024 * 1024;
const CHUNK = 256 * 1024;
const validHead = (head: string) => /^[0-9a-f]{40}$/i.test(head);
export type TrustedGit = (args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; timeout: number; maxBuffer: number }) => Promise<{ stdout: string }>;
const trustedGit: TrustedGit = async (args, options) => new Promise((resolve, reject) => {
  const child = spawn('/usr/bin/prlimit', ['--as=1073741824', '--fsize=134217728', '--cpu=60', '--', '/usr/bin/git', ...args], { cwd: options.cwd, env: options.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let failed = false;
  let bytes = 0;
  const output: Buffer[] = [];
  const terminate = (): void => {
    if (!child.pid) return;
    try { process.kill(-child.pid, 'SIGKILL'); }
    catch (error) { if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ESRCH') failed = true; }
  };
  const timer = setTimeout(() => { failed = true; terminate(); }, options.timeout);
  const collect = (chunk: Buffer, stdout: boolean): void => {
    bytes += chunk.length;
    if (bytes > options.maxBuffer) { failed = true; terminate(); }
    else if (stdout) output.push(chunk);
  };
  child.stdout.on('data', (chunk: Buffer) => collect(chunk, true));
  child.stderr.on('data', (chunk: Buffer) => collect(chunk, false));
  child.once('error', () => { failed = true; });
  child.once('close', code => {
    clearTimeout(timer);
    terminate();
    if (failed || code !== 0) reject(new GitHubPluginError('git_command_failed', 409, 'Git rejected the staged operation.'));
    else resolve({ stdout: Buffer.concat(output).toString('utf8') });
  });
});

/** This environment contains no daemon credentials, inherited Git variables, proxy or executable paths. */
function cleanEnvironment(home: string): NodeJS.ProcessEnv {
  return { PATH: '/usr/bin:/bin', HOME: home, LANG: 'C.UTF-8', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '/bin/false', GCM_INTERACTIVE: 'never' };
}

/** Import only Git objects into a fresh bare repository; never clone a guest directory/config/hooks. */
export async function stageBundle(bundle: Buffer, expectedHead: string, branch: string): Promise<{ directory: string; dispose(): Promise<void> }> {
  if (!validHead(expectedHead) || !branch || bundle.length > BUNDLE_LIMIT) throw new GitHubPluginError('invalid_publish_bundle', 409, 'The proposed publish bundle is invalid.');
  const directory = await mkdtemp(join(tmpdir(), 'elowen-github-stage-'));
  const options = { cwd: directory, env: cleanEnvironment(directory), timeout: 60000, maxBuffer: 1024 * 1024 };
  const run = (args: string[]) => exec('/usr/bin/prlimit', [
    '--as=1073741824', '--fsize=134217728', '--cpu=60', '--', '/usr/bin/bwrap',
    '--unshare-all', '--die-with-parent', '--new-session', '--ro-bind', '/usr', '/usr',
    '--symlink', 'usr/bin', '/bin', '--symlink', 'usr/lib', '/lib', '--symlink', 'usr/lib64', '/lib64',
    '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--bind', directory, '/repo',
    '--chdir', '/repo', '--setenv', 'HOME', '/repo', '--', '/usr/bin/git',
    ...args.map(arg => arg === join(directory, 'incoming.bundle') ? '/repo/incoming.bundle' : arg),
  ], options);
  try {
    await run(['check-ref-format', `refs/heads/${branch}`]);
    await run(['init', '--bare', '--template=', '.']);
    const bundlePath = join(directory, 'incoming.bundle');
    await writeFile(bundlePath, bundle, { mode: 0o600, flag: 'wx' });
    const refs = (await run(['bundle', 'list-heads', bundlePath])).stdout.trim().split('\n');
    if (refs.length !== 1 || refs[0] !== `${expectedHead} refs/heads/${branch}`) throw new Error('Bundle does not contain the approved reference');
    await run(['bundle', 'verify', bundlePath]);
    await run(['-c', 'protocol.file.allow=always', '-c', 'fetch.fsckObjects=true', 'fetch', '--no-tags', '--no-write-fetch-head', bundlePath, `refs/heads/${branch}:refs/heads/approved`]);
    await run(['fsck', '--strict', '--full', '--no-reflogs']);
    const imported = (await run(['rev-parse', '--verify', 'refs/heads/approved^{commit}'])).stdout.trim();
    if (imported !== expectedHead) throw new Error('Imported commit differs from the approved commit');
    await rm(bundlePath);
    return { directory, dispose: () => rm(directory, { recursive: true, force: true }) };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

/** Personal credentials exist only during a fixed push from a previously validated private stage. */
export async function pushStaged(input: { directory: string; expectedHead: string; branch: string; token: string; repository: RemoteRepositoryRef }, run: TrustedGit = trustedGit): Promise<{ head: string; remoteUrl: string }> {
  const remoteUrl = canonicalHttpsRepository(input.repository);
  const env = cleanEnvironment(input.directory);
  const options = { cwd: input.directory, env, timeout: 120000, maxBuffer: 1024 * 1024 };
  const actual = (await trustedGit(['rev-parse', '--verify', 'refs/heads/approved^{commit}'], options)).stdout.trim();
  if (actual !== input.expectedHead || !validHead(actual)) throw new GitHubPluginError('publish_head_changed', 409, 'The approved staged commit changed.');
  await trustedGit(['check-ref-format', `refs/heads/${input.branch}`], options);
  env.GIT_CONFIG_COUNT = '4';
  env.GIT_CONFIG_KEY_0 = `http.${remoteUrl}.extraHeader`;
  env.GIT_CONFIG_VALUE_0 = `Authorization: Basic ${Buffer.from(`x-access-token:${input.token}`).toString('base64')}`;
  env.GIT_CONFIG_KEY_1 = 'core.hooksPath'; env.GIT_CONFIG_VALUE_1 = '/dev/null';
  env.GIT_CONFIG_KEY_2 = 'credential.helper'; env.GIT_CONFIG_VALUE_2 = '';
  env.GIT_CONFIG_KEY_3 = 'http.followRedirects'; env.GIT_CONFIG_VALUE_3 = 'false';
  try {
    await run(['-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', 'push', '--porcelain', remoteUrl, `${actual}:refs/heads/${input.branch}`], options);
    return { head: actual, remoteUrl };
  } catch {
    throw new GitHubPluginError('git_command_failed', 409, 'Git rejected the staged publish operation.');
  } finally {
    delete env.GIT_CONFIG_VALUE_0;
  }
}

export async function publishManaged(input: { ctx: PluginContext; cwd: string; branch: string; expectedHead: string; token: string; repository: RemoteRepositoryRef; runner: SpawnPrepared; projectRef?: ProjectExecutionRef }, publish = pushStaged): Promise<{ head: string; remoteUrl: string }> {
  const inherited = input.ctx.currentAccess().projectRef;
  const project = input.projectRef ?? inherited;
  if (inherited && project && (inherited.kind !== project.kind || inherited.projectId !== project.projectId)) throw new GitHubPluginError('project_forbidden', 403, 'The publish target differs from the selected project.');
  const accountUserId = input.ctx.currentAccountUserId();
  if (project?.kind !== 'managed' || !accountUserId || !validHead(input.expectedHead)) throw new GitHubPluginError('publish_scope_invalid', 403, 'An approved managed project commit is required.');
  const control = () => {
    const provider = input.ctx.control('sandbox');
    if (!provider) throw new GitHubPluginError('sandbox_unavailable', 503, 'Project environment unavailable.');
    return provider;
  };
  const bundlePath = `/tmp/elowen-publish-${randomUUID()}.bundle`;
  const run = async (file: string, args: string[]) => {
    const prepared = await control().prepareExecution({ command: { type: 'argv', file, args }, projectRef: project, cwd: input.cwd, leaseKind: 'github' }, { accountUserId, roots: [] });
    if (prepared.mode !== 'managed' || prepared.projectRef?.kind !== 'managed' || prepared.projectRef.projectId !== project.projectId) { await prepared.lease.release(); throw new Error('Invalid managed launch'); }
    return input.runner(prepared);
  };
  let stage: Awaited<ReturnType<typeof stageBundle>> | undefined;
  let guestCleaned = false;
  try {
    const head = (await run('git', ['-C', input.cwd, 'rev-parse', '--verify', `refs/heads/${input.branch}^{commit}`])).stdout.trim();
    if (head !== input.expectedHead) throw new GitHubPluginError('publish_head_changed', 409, 'The approved project commit changed.');
    await run('git', ['-C', input.cwd, 'bundle', 'create', bundlePath, `refs/heads/${input.branch}`]);
    const buffers: Buffer[] = [];
    let offset = 0;
    let version: string | undefined;
    while (true) {
      const result = await control().projectFiles({ project, accountUserId, operation: { kind: 'read', path: bundlePath, offset, length: CHUNK, maxBytes: CHUNK } });
      if (result.kind !== 'read' || result.totalBytes > BUNDLE_LIMIT || (version !== undefined && result.version !== version)) throw new Error('Invalid or changed publish bundle');
      version = result.version;
      const bytes = Buffer.from(result.base64, 'base64');
      if (bytes.length > CHUNK || (!bytes.length && offset < result.totalBytes)) throw new Error('Incomplete publish bundle');
      buffers.push(bytes); offset += bytes.length;
      if (offset >= result.totalBytes) break;
    }
    stage = await stageBundle(Buffer.concat(buffers), input.expectedHead, input.branch);
    await run('rm', ['-f', '--', bundlePath]);
    guestCleaned = true;
    await control().environmentFor({ project, accountUserId });
    return await publish({ ...input, directory: stage.directory });
  } catch (error) {
    if (error instanceof GitHubPluginError) throw error;
    throw new GitHubPluginError('invalid_publish_bundle', 409, 'The project bundle could not be validated.');
  } finally {
    try { await stage?.dispose(); }
    finally { if (!guestCleaned) await run('rm', ['-f', '--', bundlePath]); }
  }
}
