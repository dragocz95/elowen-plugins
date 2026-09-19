import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { Readable, Writable } from 'node:stream';

export function childSession(child: EventEmitter & { stdin: Writable; stdout: Readable; stderr: Readable }) {
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code: number | null, signal: NodeJS.Signals | null = null) => resolve({ code, signal }));
  });
  void closed.catch(() => {});
  return { stdin: child.stdin, stdout: child.stdout, stderr: child.stderr, closed };
}

/** An owned local fixture implements the provider, never a consumer-side managed spawn. */
export function testSession(file: string, args: string[], cwd = '/tmp', prefix?: string, onCancel?: () => Promise<void>) {
  let child: ReturnType<typeof spawn> | undefined;
  return {
    async start() {
      const owned = spawn(file, args, { cwd, env: process.env, stdio: 'pipe' });
      child = owned;
      const session = childSession(owned);
      owned.stdin.on('error', (error: NodeJS.ErrnoException) => { if (error.code !== 'EPIPE') owned.emit('error', error); });
      if (prefix !== undefined) owned.stdin.write(prefix);
      return session;
    },
    async cancel() {
      child?.kill('SIGKILL');
      await onCancel?.();
    },
  };
}
