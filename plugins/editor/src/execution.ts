import { spawn } from 'node:child_process';
import type { PluginContext, SandboxExecutionCommand } from 'elowen/plugin-api';

/** Only the provider's launch reaches the host. Project commands, converters and Git stay in the guest. */
export async function editorExecute(ctx: PluginContext, projectId: number, accountUserId: number, command: SandboxExecutionCommand): Promise<string> {
  const provider = ctx.control('sandbox');
  if (!provider) throw new Error('project environment unavailable');
  const prepared = await provider.prepareExecution({ projectRef: { kind: 'managed', projectId }, cwd: '/workspace', command, leaseKind: 'editor' }, { accountUserId, roots: [] });
  if (prepared.mode !== 'managed' || prepared.projectRef?.kind !== 'managed' || prepared.projectRef.projectId !== projectId || !prepared.cancel) {
    await prepared.lease.release();
    throw new Error('managed execution unavailable');
  }
  const cancel = prepared.cancel;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<string>((resolve, reject) => {
      const launch = prepared.launch;
      const child = launch.type === 'argv'
        ? spawn(launch.file, launch.args, { cwd: prepared.cwd, env: launch.env, stdio: ['pipe', 'pipe', 'pipe'] })
        : spawn('/bin/sh', ['-c', launch.command], { cwd: prepared.cwd, env: launch.env, stdio: ['pipe', 'pipe', 'pipe'] });
      let failure: unknown;
      let cancelling: Promise<void> | undefined;
      let bytes = 0;
      const output: Buffer[] = [];
      const stop = (error: unknown): void => {
        failure ??= error;
        cancelling ??= cancel().catch(error => { failure = error; }).then(() => { child.kill('SIGKILL'); });
      };
      timer = setTimeout(() => stop(new Error('project command timed out')), 30000);
      heartbeat = setInterval(() => { Promise.resolve().then(() => prepared.lease.heartbeat()).catch(stop); }, 10000);
      heartbeat.unref();
      const collect = (chunk: Buffer, stdout: boolean): void => {
        bytes += chunk.length;
        if (bytes > 8 * 1024 * 1024) stop(new Error('project command output too large'));
        else if (stdout) output.push(chunk);
      };
      child.stdout.on('data', (chunk: Buffer) => collect(chunk, true));
      child.stderr.on('data', (chunk: Buffer) => collect(chunk, false));
      child.on('error', stop);
      child.stdin.on('error', stop);
      child.on('close', code => {
        void Promise.resolve(cancelling).then(() => {
          if (failure || code !== 0) reject(failure ?? new Error('project command failed'));
          else resolve(prepared.sanitizeOutput(Buffer.concat(output).toString('utf8')));
        });
      });
      child.stdin.end(prepared.stdin);
    });
  } finally {
    clearTimeout(timer);
    clearInterval(heartbeat);
    await prepared.lease.release();
  }
}
