// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';
import type { PluginContext, SandboxPreparedExecution } from 'elowen/plugin-api';
import { publishBranch, spawnPrepared } from '../plugins/github/src/execution.js';
import { errorBody } from '../plugins/github/src/errors.js';
import { testSession } from './helpers/managedSession.js';

// Reading a managed project's remotes runs in its environment, so an access decision made there reaches
// the panel as a foreign error. Answered as `github_unavailable` it accused GitHub of an outage for a
// project the account simply may not touch.
describe('managed environment refusals in the panel contract', () => {
  it.each(['project_forbidden', 'account_forbidden'])('reports a %s refusal as project_forbidden', code => {
    expect(errorBody(Object.assign(new Error('Project access is denied'), { code, status: 403 })))
      .toEqual({ status: 403, body: { error: 'project_forbidden', message: 'This project is not accessible.' } });
  });
  it('still reports an unrecognized failure as an upstream outage', () => {
    expect(errorBody(Object.assign(new Error('socket hang up'), { status: 403 })).status).toBe(502);
    expect(errorBody(new Error('socket hang up')).body).toMatchObject({ error: 'github_unavailable' });
  });
});

/** A managed preparation whose guest is a real child process, so the settlement this plugin performs is
 *  observed rather than described: `cancel` is the runtime's termination tombstone and `release` its
 *  ordinary retirement. */
function managedGuest(script: string) {
  const calls = { cancelled: 0, released: 0 };
  const prepared = {
    mode: 'managed', projectRef: { kind: 'managed', projectId: 7 },
    cwd: tmpdir(), displayCwd: '/project', home: '/root', roots: ['/'],
    ...testSession(process.execPath, ['-e', script], tmpdir(), undefined, async () => { calls.cancelled += 1; }),
    lease: { heartbeat() {}, release() { calls.released += 1; } },
    sanitizeOutput: (text: string) => text,
  } as unknown as SandboxPreparedExecution;
  return { prepared, calls };
}

describe('managed Git session settlement', () => {
  it('settles a Git refusal by releasing it, never by cancelling a guest that already exited', async () => {
    // Git refusing an operation is a verdict, not an interruption. Cancelling it ran the runtime's
    // mask/stop/mask termination proof against a process that had already gone, which leaves a persistent
    // tombstone behind for every routine refusal — and "this directory is not a repository" is how the
    // project drawer reads an unmapped managed project on every open.
    const guest = managedGuest("process.stdout.write('');process.stderr.write('fatal: not a git repository');process.exit(128)");
    await expect(spawnPrepared(guest.prepared)).rejects.toMatchObject({
      code: 'git_command_failed', status: 409, details: { code: 128, stderr: 'fatal: not a git repository' },
    });
    expect(guest.calls.cancelled, 'a settled Git verdict was cancelled as though the guest were still running').toBe(0);
    expect(guest.calls.released, 'the execution lease stayed held').toBe(1);
  });

  it('cancels the guest when the command is interrupted instead of reaching a verdict', async () => {
    const guest = managedGuest('setTimeout(() => {}, 30000)');
    await expect(spawnPrepared(guest.prepared, 50)).rejects.toMatchObject({ code: 'git_command_failed', status: 409 });
    expect(guest.calls.cancelled, 'an interrupted command left its guest running').toBe(1);
    expect(guest.calls.released).toBe(1);
  });

  it('decodes guest output at byte level, so a split multibyte branch name survives', async () => {
    // `git symbolic-ref` names the branch that publishing then bundles and pushes. Decoding each transport
    // chunk on its own replaced a character split across two chunks with U+FFFD and published the wrong ref.
    const branch = 'feature/účetnictví\n';
    const guest = managedGuest(`const b=Buffer.from(${JSON.stringify(branch)},'utf8');process.stdout.write(b.subarray(0,9));setTimeout(()=>process.stdout.write(b.subarray(9)),25)`);
    const result = await spawnPrepared(guest.prepared);
    expect(result.stdout).toBe(branch);
    expect(guest.calls.released).toBe(1);
  });
});

describe('managed personal publishing boundary', () => {
  it('refuses an explicit target that differs from the selected project, including for an admin', async () => {
    const control = vi.fn();
    const ctx = { currentAccess: () => ({ admin: true, projectRef: { kind: 'managed', projectId: 7 } }), control } as unknown as PluginContext;
    await expect(publishBranch({ ctx, projectRef: { kind: 'managed', projectId: 8 }, expectedHead: 'a'.repeat(40), cwd: '/workspace', branch: 'main', token: 'fake-token', repository: { owner: 'owner', name: 'repo' } })).rejects.toMatchObject({ code: 'project_forbidden' });
    expect(control).not.toHaveBeenCalled();
  });
  it.each([false, true])('requires an approved commit before any managed execution, admin=%s', async admin => {
    const control = vi.fn(() => { throw new Error('must refuse before a launch'); });
    const ctx = { currentAccess: () => ({ admin, projectRef: { kind: 'managed', projectId: 7 } }), control } as unknown as PluginContext;
    await expect(publishBranch({ ctx, cwd: '/workspace', branch: 'elowen/u1/topic', token: 'personal-secret', repository: { owner: 'owner', name: 'repo' } })).rejects.toMatchObject({ code: 'publish_scope_invalid' });
    expect(control).not.toHaveBeenCalled();
  });
});
