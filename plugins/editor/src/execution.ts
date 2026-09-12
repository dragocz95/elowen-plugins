import { spawn } from 'node:child_process';
import type { PluginContext, SandboxExecutionCommand } from 'elowen/plugin-api';

/** Only the provider's launch reaches the host. Project commands, converters and Git stay in the guest.
 *
 * `cwd` is the guest directory the caller already resolved for the root it is serving: the project's
 * canonical slug-derived mount, or the guest's own `/`. It is never assumed here. A managed project is
 * not mounted at an anonymous `/workspace` — that directory belongs to the base image and is empty — so
 * a command prepared there would run beside the project instead of inside it. */
export async function editorExecute(ctx: PluginContext, projectId: number, accountUserId: number, command: SandboxExecutionCommand, cwd: string): Promise<string> {
  const provider = ctx.control('sandbox');
  if (!provider) throw new Error('project environment unavailable');
  const prepared = await provider.prepareExecution({ projectRef: { kind: 'managed', projectId }, cwd, command, leaseKind: 'editor' }, { accountUserId, roots: [] });
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
