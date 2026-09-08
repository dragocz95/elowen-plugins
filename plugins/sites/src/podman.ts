import { spawn } from 'node:child_process';

export interface CommandResult { stdout: string; stderr: string; code: number }
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

/** Host-side archive operations for legacy release conversion. Container execution belongs to Sandbox. */
export class SpawnExecutor implements CommandExecutor {
  async run(file: string, args: readonly string[], options: CommandOptions): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      const grouped = process.platform !== 'win32';
      const child = spawn(file, [...args], { cwd: options.cwd, env: options.env, shell: false, stdio: ['pipe', 'pipe', 'pipe'], detached: grouped });
      let stdout: Buffer = Buffer.alloc(0), stderr: Buffer = Buffer.alloc(0);
      let timedOut = false;
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const append = (current: Buffer, chunk: Buffer): Buffer => Buffer.concat([current, chunk]).subarray(-options.outputLimitBytes);
      const signal = (name: NodeJS.Signals): void => {
        if (child.pid === undefined) return;
        try { if (grouped) process.kill(-child.pid, name); else child.kill(name); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') reject(error); }
      };
      const timer = setTimeout(() => {
        timedOut = true; signal('SIGTERM');
        killTimer = setTimeout(() => signal('SIGKILL'), 250);
      }, options.timeoutMs);
      child.stdout.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk); });
      child.stderr.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk); });
      child.once('error', reject);
      child.stdin.on('error', error => { if ((error as NodeJS.ErrnoException).code !== 'EPIPE') reject(error); });
      child.once('close', code => {
        clearTimeout(timer); if (killTimer) clearTimeout(killTimer);
        if (timedOut) reject(new Error(`archive command timed out after ${options.timeoutMs}ms`));
        else resolve({ stdout: stdout.toString('utf8'), stderr: stderr.toString('utf8'), code: code ?? 1 });
      });
      child.stdin.end(options.input);
    });
  }
}
