import { spawn } from 'node:child_process';
import { homedir, userInfo } from 'node:os';

const SYSTEM_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_OUTPUT_LIMIT = 256 * 1024;

export interface PodmanProcessEnvInput {
  uid?: number;
  home?: string;
  user?: string;
}

export function cleanPodmanEnv(input: PodmanProcessEnvInput = {}): Record<string, string> {
  const uid = input.uid ?? process.getuid?.() ?? userInfo().uid;
  const home = input.home ?? process.env.HOME ?? homedir();
  const user = input.user ?? process.env.USER ?? process.env.LOGNAME ?? userInfo().username;
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

export interface CommandOptions {
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
      const child = spawn(file, [...args], {
        cwd: options.cwd,
        env: options.env,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout: Buffer = Buffer.alloc(0);
      let stderr: Buffer = Buffer.alloc(0);
      const append = (current: Buffer, chunk: Buffer): Buffer => {
        const combined = Buffer.concat([current, chunk]);
        return combined.length <= options.outputLimitBytes
          ? combined
          : combined.subarray(combined.length - options.outputLimitBytes);
      };
      child.stdout.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk); });
      child.stderr.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk); });
      child.once('error', reject);
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`podman command timed out after ${options.timeoutMs}ms`));
      }, options.timeoutMs);
      timer.unref?.();
      child.once('close', (code) => {
        clearTimeout(timer);
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
    return /no such (?:container|object)|does not exist|not found/i.test(`${result.stderr}\n${result.stdout}`);
  }

  async inspect(name: string): Promise<Record<string, unknown> | null> {
    const result = await this.run(['inspect', name], { allowFailure: true });
    if (result.code !== 0) {
      if (this.missingObject(result)) return null;
      throw new Error(`podman inspect failed (${result.code}): ${result.stderr.trim() || result.stdout.trim()}`);
    }
    const parsed = JSON.parse(result.stdout) as unknown;
    const first = Array.isArray(parsed) ? parsed[0] : parsed;
    return first && typeof first === 'object' ? first as Record<string, unknown> : null;
  }

  async inspectStatus(name: string): Promise<string | null> {
    const result = await this.run(['inspect', '--format', '{{.State.Status}}', name], { allowFailure: true });
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

  async ps(): Promise<PodmanContainerSummary[]> {
    const result = await this.run(['ps', '-a', '--format', 'json', '--filter', 'label=io.elowen.site']);
    const parsed = JSON.parse(result.stdout || '[]') as unknown;
    return Array.isArray(parsed) ? parsed as PodmanContainerSummary[] : [];
  }

  async events(since = '0s'): Promise<Record<string, unknown>[]> {
    const result = await this.run(['events', '--since', since, '--stream=false', '--format', 'json', '--filter', 'label=io.elowen.site']);
    return result.stdout.split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  async stats(name: string): Promise<Record<string, unknown> | null> {
    const result = await this.run(['stats', '--no-stream', '--format', 'json', name], { allowFailure: true });
    if (result.code !== 0) return null;
    const parsed = JSON.parse(result.stdout || '[]') as unknown;
    return Array.isArray(parsed) ? parsed[0] as Record<string, unknown> | undefined ?? null : null;
  }

  async build(tag: string, contextDir: string): Promise<void> {
    await this.run(['build', '--tag', tag, contextDir], { timeoutMs: 15 * 60_000 });
  }

  async imageExists(reference: string): Promise<boolean> {
    return (await this.run(['image', 'exists', reference], { allowFailure: true })).code === 0;
  }

  async removeImage(reference: string): Promise<void> { await this.run(['image', 'rm', reference]); }
  async volumeExists(name: string): Promise<boolean> {
    return (await this.run(['volume', 'exists', name], { allowFailure: true })).code === 0;
  }
  async removeVolume(name: string): Promise<void> { await this.run(['volume', 'rm', name], { allowFailure: true }); }
  async exportVolume(name: string, output: string): Promise<void> { await this.run(['volume', 'export', '--output', output, name]); }
  async importVolume(name: string, input: string): Promise<void> { await this.run(['volume', 'import', name, input]); }
  async commit(name: string, image: string): Promise<void> { await this.run(['commit', '--pause', name, image]); }

  async unshareRemove(paths: readonly string[]): Promise<void> {
    if (paths.length === 0) return;
    if (paths.some((path) => !path.startsWith('/'))) throw new Error('Podman cleanup paths must be absolute');
    await this.run(['unshare', 'rm', '-rf', '--', ...paths]);
  }
}
