import { spawn } from 'node:child_process';

/** Persist execution identity independently of the conversation used to file a job. */
export function executionRef(value) {
  if (value === undefined) return undefined; // legacy jobs retain their original execution policy
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => key !== 'kind' && key !== 'projectId')
    || !['host', 'managed'].includes(value.kind)
    || (value.projectId !== undefined && (!Number.isSafeInteger(value.projectId) || value.projectId <= 0))
    || (value.kind === 'managed' && value.projectId === undefined)) throw new Error('invalid project execution reference');
  return { kind: value.kind, ...(value.projectId === undefined ? {} : { projectId: value.projectId }) };
}

export async function projectCheck(ctx, job, timeoutMs, launch = spawn, signal) {
  signal?.throwIfAborted();
  const projectRef = executionRef(job.projectRef);
  if (!projectRef?.projectId) throw new Error('project execution reference required');
  let cwd = '/workspace';
  let roots = [];
  if (projectRef.kind === 'host') {
    const stores = ctx.host.stores();
    const project = stores.projects.get(projectRef.projectId);
    if (!project || (project.executionKind ?? 'host') !== 'host') throw new Error('host project execution target changed');
    const owner = job.ownerUserId ?? null;
    if (owner !== null && !stores.usersRead.isAdmin(owner) && !stores.userProjects.canAccess(owner, projectRef.projectId)) throw new Error('project access revoked');
    cwd = project.path;
    roots = [cwd];
  }
  const provider = ctx.control('sandbox');
  if (!provider) throw new Error('project environment unavailable');
  const prepared = await provider.prepareExecution({ command: { type: 'shell', command: job.check }, cwd, leaseKind: 'cron', projectRef }, { accountUserId: job.ownerUserId ?? null, roots });
  if (projectRef.kind === 'managed' && (prepared.mode !== 'managed' || prepared.projectRef?.kind !== 'managed' || prepared.projectRef.projectId !== projectRef.projectId)) {
    await prepared.lease.release();
    throw new Error('project environment returned a different execution target');
  }
  if (projectRef.kind === 'host' && prepared.mode !== 'confined') {
    await prepared.lease.release();
    throw new Error('host project check requires confined execution');
  }
  if (projectRef.kind === 'managed' && typeof prepared.cancel !== 'function') {
    await prepared.lease.release();
    throw new Error('managed execution cancellation unavailable');
  }
  if (prepared.mode === 'managed') {
    let timer;
    let heartbeat;
    let onAbort;
    let failure;
    try {
      let interrupt;
      const interrupted = new Promise((_resolve, reject) => { interrupt = reject; });
      interrupted.catch(() => {});
      timer = setTimeout(() => interrupt(new Error('project check timed out')), timeoutMs);
      heartbeat = setInterval(() => { Promise.resolve().then(() => prepared.lease.heartbeat()).catch(interrupt); }, 5000);
      onAbort = () => interrupt(new Error('project check cancelled'));
      signal?.addEventListener('abort', onAbort, { once: true });
      signal?.throwIfAborted();
      const session = await Promise.race([prepared.start(), interrupted]);
      const output = [];
      let bytes = 0;
      const collect = (chunk, stdout) => {
        bytes += chunk.length;
        if (bytes > 1024 * 1024) interrupt(new Error('project check output too large'));
        else if (stdout) output.push(chunk);
      };
      session.stdout.on('data', chunk => collect(chunk, true));
      session.stderr.on('data', chunk => collect(chunk, false));
      session.stdin.end();
      const exit = await Promise.race([session.closed, interrupted]);
      if (exit.code !== 0) throw new Error('project check failed');
      return { stdout: prepared.sanitizeOutput(Buffer.concat(output).toString('utf8')) };
    } catch (error) {
      failure = error;
      try { await prepared.cancel(); } catch (cleanup) { failure = new AggregateError([failure, cleanup], 'project check cancellation failed'); }
      throw failure;
    } finally {
      clearTimeout(timer); clearInterval(heartbeat);
      if (onAbort) signal?.removeEventListener('abort', onAbort);
      try { await prepared.lease.release(); } catch (cleanup) { throw new AggregateError([...(failure ? [failure] : []), cleanup], 'project check cleanup failed'); }
    }
  }
  let child;
  try {
    const target = prepared.launch;
    child = target.type === 'argv'
      ? launch(target.file, target.args, { cwd: prepared.cwd, env: target.env, stdio: ['pipe', 'pipe', 'pipe'] })
      : launch('/bin/sh', ['-c', target.command], { cwd: prepared.cwd, env: target.env, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (error) { await prepared.lease.release(); throw error; }
  let timer;
  let heartbeat;
  let onAbort;
  try {
    return await new Promise((resolve, reject) => {
      let output = '';
      let bytes = 0;
      let failure;
      let cancellation;
      const stop = error => {
        failure ??= error;
        cancellation ??= (prepared.cancel ? prepared.cancel() : Promise.resolve()).then(() => { child.kill('SIGKILL'); }, cancelError => {
          failure = new AggregateError([failure, cancelError], 'project check cancellation could not be verified');
          child.kill('SIGKILL');
        });
      };
      timer = setTimeout(() => stop(new Error('project check timed out')), timeoutMs);
      heartbeat = setInterval(() => { Promise.resolve().then(() => prepared.lease.heartbeat()).catch(error => stop(error)); }, 10000);
      heartbeat.unref();
      child.stdout.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 1024 * 1024) stop(new Error('project check output too large'));
        else output += chunk.toString('utf8');
      });
      child.stderr.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 1024 * 1024) stop(new Error('project check output too large'));
      });
      child.once('error', error => { stop(error); });
      child.once('close', code => {
        Promise.resolve(cancellation).then(() => failure ? reject(failure) : code === 0 ? resolve({ stdout: prepared.sanitizeOutput(output) }) : reject(new Error('project check failed')));
      });
      child.stdin.on('error', error => stop(error));
      child.stdin.end(prepared.stdin);
      onAbort = () => stop(new Error('project check cancelled'));
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
    });
  } finally {
    clearTimeout(timer);
    clearInterval(heartbeat);
    if (onAbort) signal?.removeEventListener('abort', onAbort);
    await prepared.lease.release();
  }
}
