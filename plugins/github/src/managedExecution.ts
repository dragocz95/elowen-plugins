import type { PluginContext, SandboxControl, SandboxPreparedExecution } from 'elowen/plugin-api';
import { GitHubPluginError } from './errors.js';

/** The live Sandbox control, resolved per call. Retaining one across a plugin reload is invalid, and a
 *  missing provider is a refusal rather than a host fallback: managed project work has no host form. */
export function managedSandbox(ctx: PluginContext): SandboxControl {
  const provider = ctx.control('sandbox');
  if (!provider) throw new GitHubPluginError('sandbox_unavailable', 503, 'Project environment unavailable.');
  return provider;
}

/** Prepare one command inside an explicitly named managed project, and verify that the runtime prepared
 *  the project that was asked for.
 *
 *  The check stays per call. It is not a cached earlier answer: `prepareExecution` mints a lease, and the
 *  only moment the returned target can be trusted is the moment it comes back. A mismatch releases the
 *  lease it just took before refusing, so a wrong answer cannot leave an execution slot held open. */
export async function prepareManagedExecution(input: {
  ctx: PluginContext;
  project: { kind: 'managed'; projectId: number };
  accountUserId: number;
  cwd: string;
  command: { type: 'argv'; file: string; args: string[] };
}): Promise<SandboxPreparedExecution> {
  const prepared = await managedSandbox(input.ctx).prepareExecution(
    { projectRef: input.project, cwd: input.cwd, command: input.command, leaseKind: 'github' },
    { accountUserId: input.accountUserId, roots: [] },
  );
  if (prepared.mode !== 'managed' || prepared.projectRef?.kind !== 'managed'
    || prepared.projectRef.projectId !== input.project.projectId) {
    await prepared.lease.release();
    throw new GitHubPluginError('project_forbidden', 403, 'The runtime returned a different project.');
  }
  return prepared;
}
