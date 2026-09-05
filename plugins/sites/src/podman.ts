import { spawn } from 'node:child_process';
import { userInfo } from 'node:os';

const SYSTEM_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_OUTPUT_LIMIT = 256 * 1024;

interface PodmanProcessEnvInput {
  uid?: number;
  home?: string;
  user?: string;
}

export function cleanPodmanEnv(input: PodmanProcessEnvInput = {}): Record<string, string> {
  const service = userInfo();
  const uid = input.uid ?? process.getuid?.() ?? service.uid;
  const home = input.home ?? service.homedir;
  const user = input.user ?? service.username;
  return {
    HOME: home,
    USER: user,
    LOGNAME: user,
    PATH: SYSTEM_PATH,
    XDG_RUNTIME_DIR: `/run/user/${uid}`,
    DBUS_SESSION_BUS_ADDRESS: `unix:path=/run/user/${uid}/bus`,
  };
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  code: number;
}

interface CommandOptions {
  env: Record<string, string>;
  timeoutMs: number;
  outputLimitBytes: number;
  cwd?: string;
  input?: string | Buffer;
}

export interface CommandExecutor {
  run(file: string, args: readonly string[], options: CommandOptions): Promise<CommandResult>;
}

class SpawnExecutor implements CommandExecutor {
  async run(file: string, args: readonly string[], options: CommandOptions): Promise<CommandResult> {
    return await new Promise((resolve, reject) => {
      const grouped = process.platform !== 'win32';
      const child = spawn(file, [...args], {
        cwd: options.cwd,
        env: options.env,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: grouped,
      });
      let stdout: Buffer = Buffer.alloc(0);
      let stderr: Buffer = Buffer.alloc(0);
      let timedOut = false;
      let settled = false;
      const append = (current: Buffer, chunk: Buffer): Buffer => {
        const combined = Buffer.concat([current, chunk]);
        return combined.length <= options.outputLimitBytes
          ? combined
          : combined.subarray(combined.length - options.outputLimitBytes);
      };
      const signal = (name: NodeJS.Signals): void => {
        if (child.pid === undefined) return;
        try {
          if (grouped) process.kill(-child.pid, name);
          else child.kill(name);
        } catch {
          // The process group already exited.
        }
      };
      child.stdout.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk); });
      child.stderr.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk); });
      child.once('error', (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      });
      const timer = setTimeout(() => {
        timedOut = true;
        signal('SIGTERM');
        const killTimer = setTimeout(() => signal('SIGKILL'), 250);
        killTimer.unref?.();
      }, options.timeoutMs);
      timer.unref?.();
      child.once('close', (code) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        if (timedOut) {
          reject(new Error(`podman command timed out after ${options.timeoutMs}ms`));
          return;
        }
        resolve({
          stdout: stdout.toString('utf8'),
          stderr: stderr.toString('utf8'),
          code: code ?? 1,
        });
      });
      if (options.input !== undefined) child.stdin.end(options.input);
      else child.stdin.end();
    });
  }
}

const cap = (value: string, bytes: number): string => {
  const buffer = Buffer.from(value);
  return buffer.length <= bytes ? value : buffer.subarray(buffer.length - bytes).toString('utf8');
};

export interface PodmanClientOptions extends PodmanProcessEnvInput {
  executor?: CommandExecutor;
  binary?: string;
  timeoutMs?: number;
  outputLimitBytes?: number;
}

export interface PodmanRunOptions {
  timeoutMs?: number;
  cwd?: string;
  input?: string | Buffer;
  allowFailure?: boolean;
}

export interface CreateContainerSpec {
  name: string;
  siteId: string;
  memoryMb: number;
  cpus: number;
  pidsLimit: number;
  network: 'isolated' | 'shared';
  envFile: string;
  workspace: string;
  gitStub: string;
  brokerDir: string;
  volume: string;
  image: string;
}

export interface PodmanContainerSummary {
  id?: string;
  names?: string[] | string;
  state?: string;
  status?: string;
  labels?: Record<string, string>;
}

interface PodmanContainerSummaryJson extends PodmanContainerSummary {
  Id?: string;
  ID?: string;
  Names?: string[] | string;
  State?: string;
  Status?: string;
  Labels?: Record<string, string>;
}

export class PodmanClient {
  private readonly executor: CommandExecutor;
  private readonly binary: string;
  private readonly env: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly outputLimitBytes: number;

  constructor(options: PodmanClientOptions = {}) {
    this.executor = options.executor ?? new SpawnExecutor();
    this.binary = options.binary ?? 'podman';
    this.env = cleanPodmanEnv(options);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.outputLimitBytes = options.outputLimitBytes ?? DEFAULT_OUTPUT_LIMIT;
  }

  async run(args: readonly string[], options: PodmanRunOptions = {}): Promise<CommandResult> {
    if (args.some((arg) => arg.includes('\0'))) throw new Error('Podman argv contains a NUL byte');
    const result = await this.executor.run(this.binary, args, {
      env: { ...this.env },
      timeoutMs: options.timeoutMs ?? this.timeoutMs,
      outputLimitBytes: this.outputLimitBytes,
      cwd: options.cwd,
      input: options.input,
    });
    const bounded = {
      stdout: cap(result.stdout, this.outputLimitBytes),
      stderr: cap(result.stderr, this.outputLimitBytes),
      code: result.code,
    };
    if (bounded.code !== 0 && !options.allowFailure) {
      throw new Error(`podman ${args[0] ?? ''} failed (${bounded.code}): ${bounded.stderr.trim() || bounded.stdout.trim()}`);
    }
    return bounded;
  }

  async create(spec: CreateContainerSpec): Promise<string> {
    const network = spec.network === 'isolated' ? 'none' : 'slirp4netns:allow_host_loopback=false';
    const result = await this.run([
      'create', '--name', spec.name,
      '--label', `io.elowen.site=${spec.siteId}`,
      '--cgroups=split', '--systemd=always',
      `--memory=${spec.memoryMb}m`, `--memory-swap=${spec.memoryMb}m`, `--cpus=${spec.cpus}`, `--pids-limit=${spec.pidsLimit}`,
      `--network=${network}`,
      '--env-file', spec.envFile,
      '--mount', `type=bind,src=${spec.workspace},dst=/workspace`,
      '--mount', `type=bind,src=${spec.gitStub},dst=/workspace/.git,ro`,
      '--mount', `type=bind,src=${spec.brokerDir},dst=/run/elowen`,
      '--mount', `type=volume,src=${spec.volume},dst=/data`,
      spec.image,
    ]);
    return result.stdout.trim();
  }

  async update(name: string, limits: Pick<CreateContainerSpec, 'memoryMb' | 'cpus' | 'pidsLimit'>): Promise<void> {
    await this.run([
      'update', `--memory=${limits.memoryMb}m`, `--memory-swap=${limits.memoryMb}m`,
      `--cpus=${limits.cpus}`, `--pids-limit=${limits.pidsLimit}`, name,
    ]);
  }

  async start(name: string): Promise<void> { await this.run(['start', name]); }
  async stop(name: string, timeoutSeconds: number): Promise<void> { await this.run(['stop', '-t', String(timeoutSeconds), name]); }
  async kill(name: string): Promise<void> { await this.run(['kill', name]); }
  async remove(name: string, options: { force?: boolean; timeoutSeconds?: number } = {}): Promise<void> {
    const args = ['rm'];
    if (options.force) args.push('-f');
    if (options.timeoutSeconds !== undefined) args.push('-t', String(options.timeoutSeconds));
    args.push(name);
    await this.run(args);
  }

  private missingObject(result: CommandResult): boolean {
    return /no such (?:container|object|volume|image)|does not exist|not found/i.test(`${result.stderr}\n${result.stdout}`);
  }

  /** `--type container` is what makes "no container" answerable.
   *
   *  Bare `podman inspect NAME` searches containers, images, volumes, networks and pods together. Once a
   *  site has a snapshot image, the moment its container is gone the same name resolves to that image
   *  instead, and `{{.State.Status}}` dies with a template error rather than a missing-object message:
   *  exit 125, unrecognized, thrown. Rollback removes the container before recreating it, so this landed
   *  precisely in the window where the environment had none, and it left the site with no container at
   *  all. Scoped to containers, the same call answers "no such container", which reads as null. */
  async inspectStatus(name: string): Promise<string | null> {
    const result = await this.run(['inspect', '--type', 'container', '--format', '{{.State.Status}}', name], { allowFailure: true });
    if (result.code === 0) return result.stdout.trim() || null;
    if (this.missingObject(result)) return null;
    throw new Error(`podman inspect failed (${result.code}): ${result.stderr.trim() || result.stdout.trim()}`);
  }

  async exec(name: string, argv: readonly string[], options: { timeoutMs?: number; workdir?: string } = {}): Promise<CommandResult> {
    const args = ['exec'];
    if (options.workdir) args.push('--workdir', options.workdir);
    args.push(name, ...argv);
    return await this.run(args, { timeoutMs: options.timeoutMs });
  }

  async execInteractive(
    name: string,
    argv: readonly string[],
    input: string | Buffer,
    options: { timeoutMs?: number; workdir?: string } = {},
  ): Promise<CommandResult> {
    const args = ['exec', '--interactive'];
    if (options.workdir) args.push('--workdir', options.workdir);
    args.push(name, ...argv);
    return await this.run(args, { timeoutMs: options.timeoutMs, input });
  }

  async pause(name: string): Promise<void> { await this.run(['pause', name]); }
  async unpause(name: string): Promise<void> { await this.run(['unpause', name]); }

  async ps(): Promise<PodmanContainerSummary[]> {
    const result = await this.run(['ps', '-a', '--format', 'json', '--filter', 'label=io.elowen.site']);
    const parsed = JSON.parse(result.stdout || '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return (parsed as PodmanContainerSummaryJson[]).map((row) => ({
      id: row.id ?? row.Id ?? row.ID,
      names: row.names ?? row.Names,
      state: row.state ?? row.State,
      status: row.status ?? row.Status,
      labels: row.labels ?? row.Labels,
    }));
  }

  async build(tag: string, contextDir: string): Promise<void> {
    await this.run(['build', '--tag', tag, contextDir], { timeoutMs: 15 * 60_000 });
  }

  async imageExists(reference: string): Promise<boolean> {
    const result = await this.run(['image', 'exists', reference], { allowFailure: true });
    if (result.code === 0) return true;
    if (result.code === 1 || this.missingObject(result)) return false;
    throw new Error(`podman image exists failed (${result.code}): ${result.stderr.trim() || result.stdout.trim()}`);
  }

  async removeImage(reference: string): Promise<void> {
    const result = await this.run(['image', 'rm', reference], { allowFailure: true });
    if (result.code !== 0 && !this.missingObject(result)) {
      throw new Error(`podman image rm failed (${result.code}): ${result.stderr.trim() || result.stdout.trim()}`);
    }
  }
  async volumeExists(name: string): Promise<boolean> {
    const result = await this.run(['volume', 'exists', name], { allowFailure: true });
    if (result.code === 0) return true;
    if (result.code === 1 || this.missingObject(result)) return false;
    throw new Error(`podman volume exists failed (${result.code}): ${result.stderr.trim() || result.stdout.trim()}`);
  }
  async createVolume(name: string, siteId: string): Promise<void> {
    await this.run(['volume', 'create', '--label', `io.elowen.site=${siteId}`, name]);
  }
  async ensureVolume(name: string, siteId: string): Promise<void> {
    if (!await this.volumeExists(name)) await this.createVolume(name, siteId);
  }
  async removeVolume(name: string): Promise<void> {
    const result = await this.run(['volume', 'rm', name], { allowFailure: true });
    if (result.code !== 0 && !this.missingObject(result)) {
      throw new Error(`podman volume rm failed (${result.code}): ${result.stderr.trim() || result.stdout.trim()}`);
    }
  }
  async exportVolume(name: string, output: string): Promise<void> { await this.run(['volume', 'export', '--output', output, name]); }
  async importVolume(name: string, input: string): Promise<void> { await this.run(['volume', 'import', name, input]); }
  async commit(name: string, image: string, options: { pause?: boolean } = {}): Promise<void> {
    await this.run(['commit', `--pause=${options.pause === false ? 'false' : 'true'}`, name, image]);
  }

  async unshareRemove(paths: readonly string[]): Promise<void> {
    if (paths.length === 0) return;
    if (paths.some((path) => !path.startsWith('/'))) throw new Error('Podman cleanup paths must be absolute');
    await this.run(['unshare', 'rm', '-rf', '--', ...paths]);
  }
}
