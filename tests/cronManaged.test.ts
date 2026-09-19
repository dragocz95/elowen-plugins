// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { childSession } from './helpers/managedSession.js';
import { runCheck } from '../plugins/cronjob/index.mjs';
import { executionRef, projectCheck } from '../plugins/cronjob/execution.mjs';

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
});
