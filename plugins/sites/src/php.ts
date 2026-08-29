import { existsSync, mkdirSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import type { PluginHttpRequest } from 'elowen/plugin-api';
import type { SitesContext, SitesHttpResponse } from './coreSeams.js';
import { resolveWithin } from './publish.js';
import { runtimeResponseHeaders, type ProxyLimits, type ProxyViewer } from './proxy.js';

const HEARTBEAT_MS = 5_000;
const HEADER_CAP_BYTES = 64 * 1024;
const CGI_REQUEST_HEADERS = new Set([
  'accept', 'accept-language', 'authorization', 'content-type', 'cookie', 'origin', 'referer', 'user-agent',
  'access-control-request-method', 'access-control-request-headers',
]);

class PhpError extends Error {}

interface PhpDeps {
  ctx: SitesContext;
  siteDir(siteId: string): string;
}

function phpTarget(releaseDir: string, rest: string): { script: string; scriptName: string; pathInfo: string } | null {
  const clean = rest.replace(/^\/+/, '');
  const direct = clean === '' || clean.endsWith('/') ? `${clean}index.php` : clean;
  const directPath = resolveWithin(releaseDir, direct);
  if (directPath && direct.endsWith('.php') && existsSync(directPath) && statSync(directPath).isFile()) {
    return { script: directPath, scriptName: `/${direct}`, pathInfo: '' };
  }
  const front = resolveWithin(releaseDir, 'index.php');
  if (!front || !existsSync(front) || !statSync(front).isFile()) return null;
  return { script: front, scriptName: '/index.php', pathInfo: clean ? `/${clean}` : '' };
}

function parseCgi(stdout: Buffer, siteRoot: string): SitesHttpResponse {
  const crlf = stdout.indexOf('\r\n\r\n');
  const lf = stdout.indexOf('\n\n');
  const split = crlf >= 0 ? { at: crlf, width: 4 } : lf >= 0 ? { at: lf, width: 2 } : null;
  if (!split || split.at > HEADER_CAP_BYTES) throw new PhpError('PHP-CGI returned malformed headers');
  const rawHeaders: Record<string, string | string[]> = {};
  let status = 200;
  let explicitStatus = false;
  for (const line of stdout.subarray(0, split.at).toString('utf8').split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (name === 'status') {
      const parsed = Number.parseInt(value, 10);
      if (parsed >= 100 && parsed <= 599) { status = parsed; explicitStatus = true; }
      continue;
    }
    if (name === 'set-cookie') {
      const current = rawHeaders[name];
      rawHeaders[name] = current === undefined ? [value] : [...(Array.isArray(current) ? current : [current]), value];
      continue;
    }
    rawHeaders[name] = value;
  }
  if (!explicitStatus && typeof rawHeaders.location === 'string') status = 302;
  return {
    status,
    headers: runtimeResponseHeaders(rawHeaders, siteRoot),
    body: new Uint8Array(stdout.subarray(split.at + split.width)),
  };
}

const groupAlive = (pid: number): boolean => {
  try { process.kill(-pid, 0); return true; } catch { return false; }
};

async function stopProcessGroup(pid: number | undefined): Promise<void> {
  if (pid === undefined || !groupAlive(pid)) return;
  try { process.kill(-pid, 'SIGTERM'); } catch { return; }
  const deadline = Date.now() + 500;
  while (Date.now() < deadline && groupAlive(pid)) await new Promise((resolve) => setTimeout(resolve, 20));
  if (groupAlive(pid)) {
    try { process.kill(-pid, 'SIGKILL'); } catch { /* already gone */ }
  }
  const killed = Date.now() + 500;
  while (Date.now() < killed && groupAlive(pid)) await new Promise((resolve) => setTimeout(resolve, 20));
  if (groupAlive(pid)) throw new PhpError('the PHP process group did not stop');
}

/** Execute one PHP request as CGI inside a fresh network namespace. There is no loopback listener to
 * bypass and no long-running PHP process to orphan; the durable Sandbox lease is released only after the
 * whole detached process group exits or is killed. */
export async function executePhp(
  deps: PhpDeps,
  site: { id: string; ownerUserId: number },
  releaseDir: string,
  req: PluginHttpRequest,
  rest: string,
  viewer: ProxyViewer,
  limits: ProxyLimits,
  siteRoot: string,
): Promise<SitesHttpResponse> {
  const target = phpTarget(releaseDir, rest);
  if (!target) throw new PhpError('the PHP entry script does not exist');
  const sandbox = deps.ctx.control('sandbox');
  if (!sandbox) throw new PhpError('the Sandbox plugin is disabled');
  // Read the bounded hook body before acquiring a durable execution lease. If body decoding fails there
  // is then no lease to orphan and no child to clean up.
  const body = await req.body();
  const query = new URLSearchParams(req.query).toString();

  const runtimeDir = join(deps.siteDir(site.id), 'run');
  const sessions = join(runtimeDir, 'php-sessions');
  mkdirSync(sessions, { recursive: true });
  const prepared = await sandbox.prepareExecution(
    {
      command: {
        type: 'argv',
        file: '/usr/bin/php-cgi',
        args: ['-d', `session.save_path=${sessions}`, '-d', 'display_errors=0', target.script],
      },
      cwd: releaseDir,
      leaseKind: 'sites',
      network: 'isolated',
    },
    { accountUserId: site.ownerUserId, roots: [releaseDir, runtimeDir] },
  );

  const env: Record<string, string> = {
    ...prepared.launch.env,
    GATEWAY_INTERFACE: 'CGI/1.1',
    SERVER_PROTOCOL: 'HTTP/1.1',
    SERVER_SOFTWARE: 'Elowen-Sites',
    SERVER_NAME: new URL(siteRoot).hostname,
    SERVER_PORT: '443',
    HTTPS: 'on',
    REQUEST_METHOD: req.method,
    REQUEST_URI: `/${rest}${query ? `?${query}` : ''}`,
    QUERY_STRING: query,
    DOCUMENT_ROOT: releaseDir,
    SCRIPT_FILENAME: target.script,
    SCRIPT_NAME: target.scriptName,
    PATH_INFO: target.pathInfo,
    REDIRECT_STATUS: '200',
    CONTENT_LENGTH: String(body.length),
    ...(viewer.userId === null ? {} : {
      HTTP_X_ELOWEN_USER_ID: String(viewer.userId),
      ...(viewer.name ? { HTTP_X_ELOWEN_USER_NAME: encodeURIComponent(viewer.name) } : {}),
    }),
  };
  for (const [name, value] of Object.entries(req.headers)) {
    if (!CGI_REQUEST_HEADERS.has(name)) continue;
    const key = name === 'content-type' ? 'CONTENT_TYPE' : `HTTP_${name.toUpperCase().replaceAll('-', '_')}`;
    env[key] = value;
  }

  return new Promise<SitesHttpResponse>((resolve, reject) => {
    const child = prepared.launch.type === 'argv'
      ? spawn(prepared.launch.file, prepared.launch.args, { cwd: prepared.cwd, env, stdio: ['pipe', 'pipe', 'pipe'], detached: true })
      : spawn(prepared.launch.command, { cwd: prepared.cwd, env, shell: true, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    const stdout: Buffer[] = [];
    let stdoutBytes = 0;
    let settled = false;
    const heartbeat = setInterval(() => { void prepared.lease.heartbeat(); }, HEARTBEAT_MS);
    heartbeat.unref?.();

    const releaseWhenStopped = async (): Promise<void> => {
      try {
        await stopProcessGroup(child.pid);
        await prepared.lease.release();
        clearInterval(heartbeat);
      } catch {
        // A process that survived SIGKILL must keep its durable lease and heartbeat. Retry cleanup in the
        // background; releasing here would let HOME reset or deletion race a process that is still alive.
        const retry = setTimeout(() => { void releaseWhenStopped(); }, 1_000);
        retry.unref?.();
      }
    };

    const finish = async (error?: Error, response?: SitesHttpResponse): Promise<void> => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      let cleanupError: Error | undefined;
      try { await stopProcessGroup(child.pid); }
      catch (cause) { cleanupError = cause instanceof Error ? cause : new PhpError(String(cause)); }
      if (cleanupError) {
        void releaseWhenStopped();
        reject(error ?? cleanupError);
        return;
      }
      clearInterval(heartbeat);
      try { await prepared.lease.release(); }
      catch (cause) { cleanupError = cause instanceof Error ? cause : new PhpError(String(cause)); }
      if (error || cleanupError) reject(error ?? cleanupError);
      else resolve(response!);
    };

    const deadline = setTimeout(() => {
      void finish(new PhpError(`PHP did not finish within ${limits.requestTimeoutSeconds}s`));
    }, limits.requestTimeoutSeconds * 1000);
    deadline.unref?.();

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > limits.maxResponseBytes + HEADER_CAP_BYTES) {
        void finish(new PhpError('PHP answered with more data than the configured response limit'));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr?.resume();
    child.once('error', () => { void finish(new PhpError('PHP-CGI could not be started')); });
    child.once('close', (code) => {
      if (settled) return;
      if (code !== 0) {
        void finish(new PhpError(`PHP-CGI exited with status ${code ?? 'unknown'}`));
        return;
      }
      try {
        const response = parseCgi(Buffer.concat(stdout), siteRoot);
        if (req.method === 'HEAD') response.body = '';
        void finish(undefined, response);
      } catch (error) {
        void finish(error instanceof Error ? error : new PhpError(String(error)));
      }
    });
    child.stdin?.end(body);
  });
}
