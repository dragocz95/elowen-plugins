// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { childSession } from './helpers/managedSession.js';
import { runCheck } from '../plugins/cronjob/index.mjs';
import { executionRef, projectCheck } from '../plugins/cronjob/execution.mjs';

/** A guest session that settles exactly as the privileged worker does: `closed` resolves only once both
 *  output channels have reached EOF, so nothing observed here depends on stream/promise tick ordering. */
function streamSession(chunks: Buffer[], exit: { code: number; signal: null } | { code: null; signal: NodeJS.Signals }) {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let ended = 0;
  const closed = new Promise<typeof exit>(resolve => {
    const done = () => { if (++ended === 2) resolve(exit); };
    stdout.on('end', done);
    stderr.on('end', done);
  });
  for (const chunk of chunks) stdout.write(chunk);
  stdout.end();
  stderr.end();
  return { stdin: new PassThrough(), stdout, stderr, closed };
}

const managedPrepared = (
  start: () => Promise<{ stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; closed: Promise<unknown> }>,
  events: string[],
) => ({
  mode: 'managed', projectRef: { kind: 'managed', projectId: 7 }, cwd: '/trusted',
  start, cancel: async () => { events.push('guest-cancel'); },
  lease: { heartbeat: vi.fn(), release: async () => { events.push('release'); } },
  sanitizeOutput: (text: string) => text,
});

/** A guard's output cut INSIDE a two-byte character: 'nová' is `n o v` then `0xc3 0xa1`, so byte 4 lands
 *  between the halves of 'á'. Decoding each frame on its own turns it into two replacement characters. */
const SPLIT = (() => {
  const text = 'nová událost: Patricie 14:00';
  const bytes = Buffer.from(text, 'utf8');
  return { text, head: bytes.subarray(0, 4), tail: bytes.subarray(4) };
})();

const managedCheck = (prepared: unknown) => projectCheck(
  { control: () => ({ prepareExecution: async () => prepared }) },
  { projectRef: { kind: 'managed', projectId: 7 }, ownerUserId: 11, check: 'collect' },
  1000,
);

describe('managed cron execution', () => {
  it('uses the prepared runner rather than executing the check on the host', async () => {
    const runner = vi.fn(async () => ({ stdout: 'guest-result' }));
    expect(await runCheck('printf host-result', undefined, 1000, runner)).toEqual({ skip: false, output: 'guest-result' });
    expect(runner).toHaveBeenCalledOnce();
  });
  it('persists only the executable identity, never a filing conversation or cwd', () => {
    expect(executionRef({ kind: 'managed', projectId: 7 })).toEqual({ kind: 'managed', projectId: 7 });
    expect(() => executionRef({ kind: 'managed', projectId: 7, cwd: '/host' })).toThrow();
    expect(() => executionRef({ kind: 'managed' })).toThrow();
  });
  it('fails closed without a provider', async () => {
    const spawn = vi.fn();
    await expect(projectCheck({ control: () => null }, { projectRef: { kind: 'managed', projectId: 7 }, ownerUserId: 11, check: 'true' }, 1000, spawn)).rejects.toThrow('unavailable');
    expect(spawn).not.toHaveBeenCalled();
  });
  it('routes an explicit legacy project through prepared confinement at that project cwd', async () => {
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
    const prepareExecution = vi.fn(async () => ({ mode: 'confined', cwd: '/legacy/project', launch: { type: 'argv', file: '/usr/bin/bwrap', args: ['fixture'], env: {} }, lease: { heartbeat: vi.fn(), release: vi.fn() }, sanitizeOutput: (text: string) => text }));
    const ctx = { control: () => ({ prepareExecution }), host: { stores: () => ({ projects: { get: () => ({ path: '/legacy/project', executionKind: 'host' }) }, usersRead: { isAdmin: () => true } }) } };
    await projectCheck(ctx, { projectRef: { kind: 'host', projectId: 7 }, ownerUserId: 11, check: 'pwd' }, 1000, () => { setTimeout(() => child.emit('close', 0), 0); return child; });
    expect(prepareExecution).toHaveBeenCalledWith({ command: { type: 'shell', command: 'pwd' }, cwd: '/legacy/project', leaseKind: 'cron', projectRef: { kind: 'host', projectId: 7 } }, { accountUserId: 11, roots: ['/legacy/project'] });
  });
  it('verifies guest cancellation before releasing its lease without a host spawn', async () => {
    const events: string[] = [];
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: () => { events.push('host-kill'); child.emit('close', null); } });
    const prepared = { mode: 'managed', projectRef: { kind: 'managed', projectId: 7 }, cwd: '/trusted', start: async () => childSession(child), cancel: async () => { events.push('guest-cancel'); child.emit('close', null); }, lease: { heartbeat: vi.fn(), release: async () => { events.push('release'); } }, sanitizeOutput: (text: string) => text };
    await expect(projectCheck({ control: () => ({ prepareExecution: async () => prepared }) }, { projectRef: { kind: 'managed', projectId: 7 }, ownerUserId: 11, check: 'sleep 60' }, 5, () => child)).rejects.toThrow('timed out');
    expect(events).toEqual(['guest-cancel', 'release']);
  });
  it('starts the managed session and releases its actor-scoped lease on terminal exit', async () => {
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
    const release = vi.fn();
    const prepareExecution = vi.fn(async () => ({ mode: 'managed', projectRef: { kind: 'managed', projectId: 7 }, cwd: '/trusted-launch', start: async () => { setTimeout(() => { child.stdout.write('guest'); child.emit('close', 0); }, 0); return childSession(child); }, cancel: vi.fn(async () => {}), lease: { heartbeat: vi.fn(), release }, sanitizeOutput: (text: string) => text }));
    const launch = vi.fn(() => { throw new Error('must not spawn on host'); });
    expect(await projectCheck({ control: () => ({ prepareExecution }) }, { projectRef: { kind: 'managed', projectId: 7 }, ownerUserId: 11, check: 'echo guest' }, 1000, launch)).toEqual({ stdout: 'guest' });
    expect(prepareExecution).toHaveBeenCalledWith({ command: { type: 'shell', command: 'echo guest' }, cwd: '/workspace', leaseKind: 'cron', projectRef: { kind: 'managed', projectId: 7 } }, { accountUserId: 11, roots: [] });
    expect(launch).not.toHaveBeenCalled();
    expect(child.stdin.writableEnded).toBe(true);
    expect(release).toHaveBeenCalledOnce();
  });
  it('reports a lost worker connection as a failure instead of the output collected before it died', async () => {
    const events: string[] = [];
    const stdout = new PassThrough();
    let lose!: (error: Error) => void;
    const closed = new Promise<never>((_resolve, reject) => { lose = reject; });
    void closed.catch(() => {});
    const prepared = managedPrepared(async () => {
      setTimeout(() => { stdout.write('partial'); lose(new Error('Privileged worker execution was cancelled')); }, 0);
      return { stdin: new PassThrough(), stdout, stderr: new PassThrough(), closed };
    }, events);
    await expect(managedCheck(prepared)).rejects.toThrow('Privileged worker execution was cancelled');
    expect(events).toEqual(['guest-cancel', 'release']);
  });
  it('fails a guest execution terminated by a signal rather than reporting its partial output', async () => {
    const events: string[] = [];
    const prepared = managedPrepared(async () => streamSession([Buffer.from('partial')], { code: null, signal: 'SIGKILL' }), events);
    await expect(managedCheck(prepared)).rejects.toThrow('project check failed');
    expect(events).toEqual(['guest-cancel', 'release']);
  });
  it('decodes guest output byte-wise, so a character split across two frames survives', async () => {
    const prepared = managedPrepared(async () => streamSession([SPLIT.head, SPLIT.tail], { code: 0, signal: null }), []);
    expect(await managedCheck(prepared)).toEqual({ stdout: SPLIT.text });
  });
  it('decodes confined host output byte-wise too, so its guard reports the same characters the check printed', async () => {
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
    child.stdout.on('end', () => child.emit('close', 0));
    const prepareExecution = vi.fn(async () => ({ mode: 'confined', cwd: '/legacy/project', launch: { type: 'argv', file: '/usr/bin/bwrap', args: ['fixture'], env: {} }, lease: { heartbeat: vi.fn(), release: vi.fn() }, sanitizeOutput: (value: string) => value }));
    const ctx = { control: () => ({ prepareExecution }), host: { stores: () => ({ projects: { get: () => ({ path: '/legacy/project', executionKind: 'host' }) }, usersRead: { isAdmin: () => true } }) } };
    const result = projectCheck(ctx, { projectRef: { kind: 'host', projectId: 7 }, ownerUserId: 11, check: 'collect' }, 1000, () => {
      child.stdout.write(SPLIT.head);
      child.stdout.end(SPLIT.tail);
      return child;
    });
    expect(await result).toEqual({ stdout: SPLIT.text });
  });
  it('never reports a cancelled managed guard as "nothing new" — the journal must see a failed check', async () => {
    const runner = vi.fn(async () => { throw new Error('project check cancelled'); });
    expect(await runCheck('collect', undefined, 1000, runner)).toEqual({ skip: true, reason: 'check failed: project check cancelled' });
  });
});
