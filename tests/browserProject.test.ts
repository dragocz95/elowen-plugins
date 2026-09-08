// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { connect } from 'puppeteer-core';
import type { PluginContext } from 'elowen/plugin-api';
import { openProjectBrowser, ProjectCdpTransport } from '../plugins/browser/src/project-browser.js';

vi.mock('node:child_process', async (original) => ({ ...await original<typeof import('node:child_process')>(), spawn: vi.fn() }));
vi.mock('puppeteer-core', () => ({ connect: vi.fn() }));
afterEach(() => { vi.clearAllMocks(); });

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
function fixture() {
  const project = { kind: 'managed' as const, projectId: 8 };
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() });
  vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
  const cancel = vi.fn(async () => { child.emit('close', 0); });
  const release = vi.fn(async () => {});
  const sandbox = {
    environmentFor: vi.fn(async () => ({ projectId: 8, generation: 4, state: 'running' })),
    projectFiles: vi.fn(async () => ({ kind: 'mkdir' })),
    prepareExecution: vi.fn(async (_input: unknown) => ({ mode: 'managed', projectRef: project, cwd: '/trusted/launcher',
      launch: { type: 'argv', file: '/trusted/provider', args: ['opaque'], env: { PROVIDER_ONLY: 'yes' } },
      lease: { projectId: 8, accountUserId: 2, runtimeGeneration: 4, cancel, release, heartbeat: vi.fn() },
    })),
  };
  const ctx = { currentAccess: () => ({ projectRef: project }), currentAccountUserId: () => 2, control: vi.fn(() => sandbox) } as unknown as PluginContext;
  const setDownloadBehavior = vi.fn(async () => {});
  const browser = Object.assign(new EventEmitter(), { connected: true, targets: () => [], close: vi.fn(async () => {}),
    defaultBrowserContext: () => ({ setDownloadBehavior }),
  });
  vi.mocked(connect).mockResolvedValue(browser as unknown as Awaited<ReturnType<typeof connect>>);
  return { ctx, project, sandbox, child, cancel, release, browser, setDownloadBehavior };
}

describe('project browser canonical transport', () => {
  it('decodes fragmented Unicode and multiple CDP frames without a regex protocol', () => {
    const write = vi.fn();
    const stop = vi.fn();
    const transport = new ProjectCdpTransport(write, stop);
    const messages = vi.fn();
    transport.onmessage = messages;
    const bytes = Buffer.from('{"text":"Žluťoučký"}\0{"id":2}\0');
    for (const byte of bytes) transport.feed(Buffer.from([byte]));
    expect(messages.mock.calls.flat()).toEqual(['{"text":"Žluťoučký"}', '{"id":2}']);
    transport.send('{"id":3}');
    expect(write).toHaveBeenCalledWith('{"id":3}\0');
    transport.close(); transport.close();
    expect(stop).toHaveBeenCalledOnce();
    expect(() => transport.send('{}')).toThrow(/closed/);
  });

  it('closes the transport when a single CDP frame exceeds its limit', () => {
    const write = vi.fn();
    const stop = vi.fn();
    const transport = new ProjectCdpTransport(write, stop);
    const closed = vi.fn();
    transport.onclose = closed;
    const frame = Buffer.alloc(33 * 1024 * 1024 + 1, 0x41);
    frame[frame.length - 1] = 0;
    expect(() => transport.feed(frame)).toThrow(/limit/);
    expect(stop).toHaveBeenCalledOnce();
    expect(closed).toHaveBeenCalledOnce();
    expect(() => transport.send('{}')).toThrow(/closed/);
    expect(() => transport.feed(Buffer.from('still\0'))).not.toThrow();
    expect(write).not.toHaveBeenCalled();
  });

  it('closes the transport when buffered bytes grow past the limit with no frame boundary', () => {
    const write = vi.fn();
    const stop = vi.fn();
    const transport = new ProjectCdpTransport(write, stop);
    // No NUL anywhere: the frame boundary never arrives, so the buffer itself must hit the ceiling.
    expect(() => transport.feed(Buffer.alloc(33 * 1024 * 1024, 0x41))).toThrow(/limit/);
    expect(stop).toHaveBeenCalledOnce();
  });

  it('launches through the provider, keeps profiles in guest data and closes its lease', async () => {
    const h = fixture();
    const browser = await openProjectBrowser(h.ctx, h.project, 2, logger);
    try {
      expect(h.sandbox.prepareExecution).toHaveBeenCalledWith(expect.objectContaining({ projectRef: h.project, leaseKind: 'browser', cwd: '/workspace' }));
      const command = h.sandbox.prepareExecution.mock.calls[0]![0] as unknown as { command: { args: string[] } };
      expect(command.command.args).toContain('--user-data-dir=/data/browser/profile');
      expect(command.command.args).toContain('--remote-debugging-pipe');
      expect(command.command.args.some((arg) => arg.includes('remote-debugging-port'))).toBe(false);
      expect(spawn).toHaveBeenCalledWith('/trusted/provider', ['opaque'], { cwd: '/trusted/launcher', env: { PROVIDER_ONLY: 'yes' }, stdio: ['pipe', 'pipe', 'pipe'] });
      expect(h.setDownloadBehavior).toHaveBeenCalledWith({ policy: 'allow', downloadPath: '/data/browser/downloads' });
      await browser.authorize();
    } finally { await browser.close(); }
    expect(h.cancel).toHaveBeenCalledOnce();
    expect(h.release).toHaveBeenCalledOnce();
  });

  it('refuses missing providers, including managed administrators', async () => {
    const h = fixture();
    vi.mocked(h.ctx.control).mockReturnValue(undefined);
    await expect(openProjectBrowser(h.ctx, h.project, 2, logger)).rejects.toThrow(/unavailable/);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('rejects the wrong selected project before preparing any process', async () => {
    const h = fixture();
    await expect(openProjectBrowser(h.ctx, { kind: 'managed', projectId: 9 }, 2, logger)).rejects.toThrow(/selected project/);
    expect(h.sandbox.prepareExecution).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('rejects a stale prepared launch and cancels its lease without spawning', async () => {
    const h = fixture();
    const prepared = await h.sandbox.prepareExecution(undefined);
    prepared.lease.runtimeGeneration = 5;
    h.sandbox.prepareExecution.mockResolvedValue(prepared);
    await expect(openProjectBrowser(h.ctx, h.project, 2, logger)).rejects.toThrow(/generation/);
    expect(spawn).not.toHaveBeenCalled();
    expect(h.cancel).toHaveBeenCalledOnce();
    expect(h.release).toHaveBeenCalledOnce();
  });

  it('cleans up a failed CDP connection and does not release an unverified guest process', async () => {
    const h = fixture();
    vi.mocked(connect).mockRejectedValue(new Error('CDP failed'));
    h.cancel.mockRejectedValue(new Error('Guest termination could not be verified'));
    await expect(openProjectBrowser(h.ctx, h.project, 2, logger)).rejects.toThrow(/termination/);
    expect(h.cancel).toHaveBeenCalledOnce();
    expect(h.release).not.toHaveBeenCalled();
  });

  it('notifies session attachments exactly once when the guest process exits', async () => {
    const h = fixture();
    const browser = await openProjectBrowser(h.ctx, h.project, 2, logger);
    const closed = vi.fn();
    browser.onClosed(closed);
    h.child.emit('close', 0);
    await browser.close();
    expect(closed).toHaveBeenCalledOnce();
    expect(h.cancel).toHaveBeenCalledOnce();
  });

  it('closes the attachment when its runtime generation changes', async () => {
    const h = fixture();
    const browser = await openProjectBrowser(h.ctx, h.project, 2, logger);
    h.sandbox.environmentFor.mockResolvedValue({ projectId: 8, generation: 5, state: 'running' });
    await expect(browser.authorize()).rejects.toThrow(/generation/);
    expect(h.cancel).toHaveBeenCalledOnce();
    expect(h.release).toHaveBeenCalledOnce();
  });

  it('closes the attachment on membership revocation', async () => {
    const h = fixture();
    const browser = await openProjectBrowser(h.ctx, h.project, 2, logger);
    h.sandbox.environmentFor.mockRejectedValue(new Error('Membership revoked'));
    await expect(browser.authorize()).rejects.toThrow(/revoked/);
    expect(h.cancel).toHaveBeenCalledOnce();
  });

  it('pipes a provider stdin prefix verbatim before the first CDP message and keeps stdin open', async () => {
    const h = fixture();
    // Bytes that would change under any UTF-8 decode/re-encode round trip.
    const prefix = Buffer.from([0xc3, 0x28, 0xe2, 0x82, 0xff, 0x41]);
    const prepared = await h.sandbox.prepareExecution(undefined);
    (prepared as { stdin?: string | Buffer }).stdin = prefix;
    h.sandbox.prepareExecution.mockResolvedValue(prepared);
    const chunks: Buffer[] = [];
    h.child.stdin.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    const messages = vi.fn();
    let transport: ProjectCdpTransport | undefined;
    vi.mocked(connect).mockImplementation(async (options) => {
      transport = options.transport as ProjectCdpTransport;
      transport.onmessage = messages;
      transport.send('{"id":1}');
      return h.browser as unknown as Awaited<ReturnType<typeof connect>>;
    });
    const browser = await openProjectBrowser(h.ctx, h.project, 2, logger);
    try {
      // Raw stdin byte order: the opaque prefix first, then the NUL-framed CDP message. Exact equality
      // proves no duplication, no lost bytes and no decode/re-encode of the prefix.
      expect(Buffer.concat(chunks).equals(Buffer.concat([prefix, Buffer.from('{"id":1}\0', 'utf8')]))).toBe(true);
      expect(h.child.stdin.writableEnded).toBe(false);
      // Fragmented UTF-8 and multiple frames still decode on the response side after the prefix.
      const bytes = Buffer.from('{"text":"Žluťoučký"}\0{"id":2}\0', 'utf8');
      h.child.stdout.write(bytes.subarray(0, 10)); // splits inside the two-byte Ž
      h.child.stdout.write(bytes.subarray(10));
      expect(messages.mock.calls.flat()).toEqual(['{"text":"Žluťoučký"}', '{"id":2}']);
    } finally { await browser.close(); }
    expect(h.cancel).toHaveBeenCalledOnce();
    expect(h.release).toHaveBeenCalledOnce();
  });

  it('keeps the absent-prefix launch byte-identical with CDP-only stdin', async () => {
    const h = fixture();
    const chunks: Buffer[] = [];
    h.child.stdin.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    vi.mocked(connect).mockImplementation(async (options) => {
      (options.transport as ProjectCdpTransport).send('{"id":1}');
      return h.browser as unknown as Awaited<ReturnType<typeof connect>>;
    });
    const browser = await openProjectBrowser(h.ctx, h.project, 2, logger);
    try {
      expect(Buffer.concat(chunks).equals(Buffer.from('{"id":1}\0', 'utf8'))).toBe(true);
      expect(h.child.stdin.writableEnded).toBe(false);
    } finally { await browser.close(); }
    expect(h.cancel).toHaveBeenCalledOnce();
    expect(h.release).toHaveBeenCalledOnce();
  });

  it('treats an empty provider prefix like an absent one', async () => {
    const h = fixture();
    const prepared = await h.sandbox.prepareExecution(undefined);
    (prepared as { stdin?: string | Buffer }).stdin = '';
    h.sandbox.prepareExecution.mockResolvedValue(prepared);
    const chunks: Buffer[] = [];
    h.child.stdin.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    vi.mocked(connect).mockImplementation(async (options) => {
      (options.transport as ProjectCdpTransport).send('{"id":1}');
      return h.browser as unknown as Awaited<ReturnType<typeof connect>>;
    });
    const browser = await openProjectBrowser(h.ctx, h.project, 2, logger);
    try {
      expect(Buffer.concat(chunks).equals(Buffer.from('{"id":1}\0', 'utf8'))).toBe(true);
      expect(h.child.stdin.writableEnded).toBe(false);
    } finally { await browser.close(); }
    expect(h.cancel).toHaveBeenCalledOnce();
    expect(h.release).toHaveBeenCalledOnce();
  });
});
