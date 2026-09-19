// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { childSession } from './helpers/managedSession.js';
import { encodeMessage, MessageDecoder, type JsonRpcMessage } from '../plugins/lsp/src/protocol.js';

vi.mock('node:child_process', async (original) => ({ ...await original<typeof import('node:child_process')>(), spawn: vi.fn() }));
afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });
import type { PluginContext, SandboxControl } from 'elowen/dist/plugins/api.js';
import { ManagedLspManager } from '../plugins/lsp/src/managed.js';
import { LspManager } from '../plugins/lsp/src/manager.js';
import type { LspTransport } from '../plugins/lsp/src/client.js';
import { register } from '../plugins/lsp/src/index.js';

function fixture() {
  const project = { kind: 'managed' as const, projectId: 7 };
  const sandbox = {
    environmentFor: vi.fn(async () => ({ projectId: 7, generation: 2, state: 'running' })),
    projectFiles: vi.fn(async () => ({ kind: 'read', base64: Buffer.from('const x = 1;').toString('base64') })),
    prepareExecution: vi.fn(),
  };
  const ctx = {
    currentAccess: () => ({ projectRef: project }),
    currentAccountUserId: () => 3,
    control: vi.fn(() => sandbox),
    logger: { warn: vi.fn() },
  } as unknown as PluginContext;
  return { ctx, sandbox, project };
}

/** The guest inventory the manager reads before it launches anything. Its own opaque launch and its own
 *  lease keep it out of the language server's teardown assertions. */
function inventoryOf(installed: string[]) {
  const probe = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
  });
  setTimeout(() => { probe.stdout.write(JSON.stringify(installed)); probe.emit('close', 0); }, 0);
  return probe;
}
const probeLease = { projectId: 7, accountUserId: 3, runtimeGeneration: 2, cancel: async () => {}, release: async () => {}, heartbeat: async () => {} };
const isProbe = (input: { command: { file: string } }): boolean => input.command.file === '/usr/bin/python3';

function runningFixture(installed: string[] = ['typescript-language-server']) {
  const fixtureValue = fixture();
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
  });
  const start = vi.fn(async () => childSession(child));
  const cancel = vi.fn(async () => { child.emit('close', 0); });
  const release = vi.fn(async () => {});
  const heartbeat = vi.fn(async () => {});
  fixtureValue.sandbox.prepareExecution.mockImplementation(async (input: { command: { file: string; args: string[] } }) => ({
    mode: 'managed', sanitizeOutput: (text: string) => text, projectRef: fixtureValue.project, cwd: '/isolated/launcher',
    ...(isProbe(input)
      ? { start: async () => childSession(inventoryOf(installed)), cancel: probeLease.cancel, lease: probeLease }
      : {
        start, cancel,
        lease: { projectId: 7, accountUserId: 3, runtimeGeneration: 2, cancel, release, heartbeat },
      }),
  }));
  const messages: JsonRpcMessage[] = [];
  const decoder = new MessageDecoder();
  child.stdin.on('data', (data: Buffer) => {
    for (const message of decoder.push(data)) {
      messages.push(message);
      if (message.id === undefined) continue;
      const result = message.method === 'initialize' ? { capabilities: {} } : { contents: 'Žluťoučký symbol' };
      const response = Buffer.from(encodeMessage({ jsonrpc: '2.0', id: message.id, result }));
      queueMicrotask(() => {
        for (let index = 0; index < response.length; index++) child.stdout.write(response.subarray(index, index + 1));
      });
    }
  });
  const manager = new ManagedLspManager(fixtureValue.ctx, fixtureValue.project, 3);
  return { ...fixtureValue, child, start, cancel, release, heartbeat, messages, manager };
}

describe('managed LSP routing', () => {
  it('does not respawn when disposal overtakes an asynchronous guest read', async () => {
    let resolveRead!: (text: string) => void;
    const readStarted = vi.fn();
    const spawnServer = vi.fn(() => null);
    const manager = new LspManager({
      projectRoot: () => '/workspace', spawn: spawnServer,
      readFile: () => { readStarted(); return new Promise<string>((resolve) => { resolveRead = resolve; }); },
    });
    const checking = manager.checkFile('/workspace/a.ts');
    await vi.waitFor(() => expect(readStarted).toHaveBeenCalledOnce());
    manager.disposeAll();
    resolveRead('const value = 1;');
    await checking;
    expect(spawnServer).not.toHaveBeenCalled();
  });

  it('uses guest file URIs, fragmented UTF-8 frames and only the prepared launch', async () => {
    const h = runningFixture();
    try {
      const result = await h.manager.hover('/workspace/a b.ts', 1, 1);
      expect(result).toEqual({ ok: true, result: { contents: 'Žluťoučký symbol' } });
      expect(h.start).toHaveBeenCalledOnce();
      expect(spawn).not.toHaveBeenCalled();
      expect(h.messages.find((message) => message.method === 'initialize')?.params).toMatchObject({ rootUri: 'file:///workspace' });
      expect(h.messages.find((message) => message.method === 'textDocument/didOpen')?.params).toMatchObject({
        textDocument: { uri: 'file:///workspace/a%20b.ts', text: 'const x = 1;' },
      });
      expect(h.sandbox.projectFiles).toHaveBeenCalledWith(expect.objectContaining({ project: h.project, accountUserId: 3, expectedGeneration: 2 }));
      expect(h.child.stdin.writableEnded).toBe(false);
    } finally { await h.manager.shutdown(); }
    expect(h.cancel).toHaveBeenCalledOnce();
    expect(h.release).toHaveBeenCalledOnce();
  });

  it('retires warm clients before a changed generation can return symbols', async () => {
    const h = runningFixture();
    await h.manager.hover('/workspace/a.ts', 1, 1);
    h.sandbox.environmentFor.mockResolvedValue({ projectId: 7, generation: 3, state: 'running' });
    await expect(h.manager.workspaceSymbol('secret')).rejects.toThrow(/generation/);
    await h.manager.shutdown();
    expect(h.messages.some((message) => message.method === 'workspace/symbol')).toBe(false);
    expect(h.cancel).toHaveBeenCalledOnce();
  });

  it('cancels a warm client when provider access is revoked', async () => {
    const h = runningFixture();
    await h.manager.hover('/workspace/a.ts', 1, 1);
    h.sandbox.environmentFor.mockRejectedValue(new Error('Membership revoked'));
    await expect(h.manager.workspaceSymbol('secret')).rejects.toThrow(/revoked/);
    await Promise.resolve();
    expect(h.cancel).toHaveBeenCalledOnce();
    await h.manager.shutdown();
  });

  it('refuses a missing provider without touching host files or spawning', async () => {
    const { ctx, project } = fixture();
    vi.mocked(ctx.control).mockReturnValue(undefined);
    const manager = new ManagedLspManager(ctx, project, 3);
    await expect(manager.checkFile('/workspace/a.ts')).rejects.toThrow(/unavailable/);
  });

  it('rejects a provider returning another project', async () => {
    const { ctx, sandbox, project } = fixture();
    sandbox.environmentFor.mockResolvedValue({ projectId: 8, generation: 2, state: 'running' });
    const manager = new ManagedLspManager(ctx, project, 3);
    await expect(manager.checkFile('/workspace/a.ts')).rejects.toThrow(/project/);
    expect(sandbox.projectFiles).not.toHaveBeenCalled();
    expect(sandbox.prepareExecution).not.toHaveBeenCalled();
  });

  it('rejects a stale prepared runtime and releases its lease', async () => {
    const { ctx, sandbox, project } = fixture();
    const cancel = vi.fn(async () => {});
    const release = vi.fn(async () => {});
    sandbox.prepareExecution.mockResolvedValue({ mode: 'managed', sanitizeOutput: (text: string) => text, projectRef: project, lease: {
      projectId: 7, accountUserId: 3, runtimeGeneration: 1, cancel, release,
    } } as unknown as Awaited<ReturnType<SandboxControl['prepareExecution']>>);
    const manager = new ManagedLspManager(ctx, project, 3);
    await expect(manager.checkFile('/workspace/a.ts')).rejects.toThrow(/generation/);
    expect(cancel).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });

  // `run` hands guest output to the provider's sanitizer before the model ever sees it, so a preparation
  // without one is an incomplete contract — and must be refused BEFORE a guest command runs, not after
  // its output already exists with nothing to strip host prefixes from it.
  it('refuses a preparation with no output sanitizer before it launches anything', async () => {
    const { ctx, sandbox, project } = fixture();
    const cancel = vi.fn(async () => {});
    const release = vi.fn(async () => {});
    const start = vi.fn();
    sandbox.prepareExecution.mockResolvedValue({
      mode: 'managed', projectRef: project, cwd: '/isolated/launcher', start, cancel,
      lease: { projectId: 7, accountUserId: 3, runtimeGeneration: 2, cancel, release, heartbeat: async () => {} },
    } as unknown as Awaited<ReturnType<SandboxControl['prepareExecution']>>);
    const manager = new ManagedLspManager(ctx, project, 3);
    await expect(manager.statusAsync()).rejects.toThrow(/Invalid managed LSP/);
    expect(start).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });
});

describe('managed guest language-server inventory', () => {
  /** A guest whose PATH holds exactly `installed`. A launch of a server the guest does not have closes
   *  immediately — what `/usr/bin/env -- <server>` really does when the binary is absent. */
  function guest(installed: string[]) {
    const f = fixture();
    const launched: string[] = [];
    f.sandbox.prepareExecution.mockImplementation(async (input: { command: { file: string; args: string[] } }) => ({
      mode: 'managed', sanitizeOutput: (text: string) => text, projectRef: f.project, cwd: '/isolated/launcher',
      start: async () => {
        if (isProbe(input)) return childSession(inventoryOf(installed));
        launched.push('/provider/launcher');
        const child = Object.assign(new EventEmitter(), {
          stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
        });
        setTimeout(() => child.emit('close', 127), 0);
        return childSession(child);
      },
      cancel: probeLease.cancel, lease: probeLease,
    }));
    const servers = (): string[] => launched.filter((file) => file === '/provider/launcher');
    return { ...f, servers, manager: new ManagedLspManager(f.ctx, f.project, 3) };
  }

  it('reports a server the guest does not have as not installed, and never launches it', async () => {
    const h = guest([]);
    try {
      const result = await h.manager.checkFile('/workspace/a.ts');
      expect(result.skipped).toBe('no-server-installed');
      expect(result.server).toBe('TypeScript');
      expect(h.servers()).toEqual([]);
    } finally { await h.manager.shutdown(); }
  });

  // The restart cap exists for a server that really is broken. Answering "not installed" with a doomed
  // launch spent that budget instead, and the fourth check reported 'crash-looping' — which withdraws
  // diagnostics for the whole runtime generation until an operator toggles /lsp.
  it('does not spend the crash budget on a server that is merely absent', async () => {
    const h = guest([]);
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        expect((await h.manager.checkFile('/workspace/a.ts')).skipped).toBe('no-server-installed');
      }
      expect(h.servers()).toEqual([]);
    } finally { await h.manager.shutdown(); }
  });

  it('launches the server once the guest reports it installed', async () => {
    const h = guest(['typescript-language-server']);
    try {
      // The verdict needs a live server; this asserts the launch, which the missing-server path skips.
      void h.manager.checkFile('/workspace/a.ts');
      await vi.waitFor(() => expect(h.servers()).toEqual(['/provider/launcher']));
    } finally { await h.manager.shutdown(); }
  });
});

/** A transport that accepts the handshake but never answers — the shape of a hung language server. */
function silentServer(): LspTransport {
  return { send: () => {}, onMessage: () => {}, onExit: () => {}, dispose: () => {} };
}

describe('lsp cancellation', () => {
  it('returns a cancelled check promptly and quarantines the abandoned diagnostics', async () => {
    const spawnServer = vi.fn(() => silentServer());
    const manager = new LspManager({
      projectRoot: () => '/workspace', spawn: spawnServer, readFile: () => 'const a = 1;',
      firstCheckTimeoutMs: 150, settleMs: 10,
    });
    const controller = new AbortController();
    const checking = manager.checkFile('/workspace/a.ts', undefined, controller.signal);
    await vi.waitFor(() => expect(spawnServer).toHaveBeenCalledOnce());
    controller.abort();
    const result = await checking;
    expect(result.skipped).toBe('cancelled');
    // Abandoned unversioned diagnostics cannot remain eligible to satisfy the next probe.
    expect(manager.isRunning()).toBe(false);
  });

  it('reports a cancelled code-intelligence request instead of a server error', async () => {
    const spawnServer = vi.fn(() => silentServer());
    const manager = new LspManager({
      projectRoot: () => '/workspace', spawn: spawnServer, readFile: () => 'const a = 1;',
    });
    const controller = new AbortController();
    const hovering = manager.hover('/workspace/a.ts', 1, 1, undefined, controller.signal);
    await vi.waitFor(() => expect(spawnServer).toHaveBeenCalledOnce());
    controller.abort();
    expect(await hovering).toMatchObject({ ok: false, reason: 'cancelled' });
    manager.disposeAll();
  });
});

describe('managed lsp shutdown races', () => {
  it('releases a lease whose prepare resolves after shutdown began', async () => {
    const f = fixture();
    const cancel = vi.fn(async () => {});
    const release = vi.fn(async () => {});
    let resolvePrepare!: (value: unknown) => void;
    f.sandbox.prepareExecution.mockImplementation(() => new Promise((resolve) => { resolvePrepare = resolve; }));
    const manager = new ManagedLspManager(f.ctx, f.project, 3);
    const checking = manager.checkFile('/workspace/a.ts');
    await vi.waitFor(() => expect(f.sandbox.prepareExecution).toHaveBeenCalledOnce());
    void manager.shutdown();
    resolvePrepare({
      mode: 'managed', sanitizeOutput: (text: string) => text, projectRef: f.project, cwd: '/isolated/launcher',
      start: vi.fn(() => { throw new Error('must not start after shutdown'); }),
      lease: { projectId: 7, accountUserId: 3, runtimeGeneration: 2, cancel, release, heartbeat: async () => {} },
    });
    await expect(checking).rejects.toThrow(/stopped/);
    expect(cancel).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });

  it('a manager stopped by its owner refuses to mint new guest work', async () => {
    const h = runningFixture();
    await h.manager.hover('/workspace/a.ts', 1, 1);
    await h.manager.shutdown();
    const prepared = h.sandbox.prepareExecution.mock.calls.length;
    await expect(h.manager.workspaceSymbol('secret')).rejects.toThrow(/stopped/);
    expect(h.sandbox.prepareExecution).toHaveBeenCalledTimes(prepared);
  });

  // The migration put an `await` between the stopped latch (checked when the lease is prepared) and the
  // live transport: opening the guest session is now its own round trip. A stop that resolved inside that
  // window reported every language server settled while one was still being launched, and its execution
  // lease was left to whoever touched the transport next.
  it('does not resolve a shutdown while a guest session is still being started', async () => {
    const f = fixture();
    const cancel = vi.fn(async () => {});
    const release = vi.fn(async () => {});
    let startServer!: () => void;
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
    });
    f.sandbox.prepareExecution.mockImplementation(async (input: { command: { file: string } }) => (isProbe(input) ? {
      mode: 'managed', sanitizeOutput: (text: string) => text, projectRef: f.project, cwd: '/isolated/launcher',
      start: async () => childSession(inventoryOf(['typescript-language-server'])), cancel: probeLease.cancel, lease: probeLease,
    } : {
      mode: 'managed', sanitizeOutput: (text: string) => text, projectRef: f.project, cwd: '/isolated/launcher',
      start: () => new Promise((resolve) => { startServer = () => resolve(childSession(child)); }),
      cancel, lease: { projectId: 7, accountUserId: 3, runtimeGeneration: 2, cancel, release, heartbeat: async () => {} },
    }));
    const manager = new ManagedLspManager(f.ctx, f.project, 3);
    const checking = manager.checkFile('/workspace/a.ts');
    await vi.waitFor(() => expect(startServer).toBeDefined());
    const stopping = manager.shutdown();
    startServer();
    await stopping;
    // Asserted on the RESOLUTION of shutdown, not eventually: the owner's stop is what the host awaits
    // around a plugin reload, so a lease still open here is an orphan across the swap.
    expect(cancel).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
    await expect(checking).rejects.toThrow(/stopped/);
  });

  it('cancels a warm client when the environment provider disappears', async () => {
    const h = runningFixture();
    await h.manager.hover('/workspace/a.ts', 1, 1);
    vi.mocked(h.ctx.control).mockReturnValue(undefined);
    await expect(h.manager.workspaceSymbol('secret')).rejects.toThrow(/unavailable/);
    await Promise.resolve();
    expect(h.cancel).toHaveBeenCalledOnce();
    await h.manager.shutdown();
  });
});

describe('managed lsp session loss', () => {
  /** A guest language server whose managed session ends by REJECTING `closed`. That is what the new
   *  worker seam reports for a lost broker connection, a paused client and the session's own deadline —
   *  never an exit code and never a byte on stdout. Each start gets its own child, as a real relaunch
   *  would. */
  function lostSessionFixture() {
    const f = fixture();
    const servers: (EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough })[] = [];
    const cancel = vi.fn(async () => {});
    const release = vi.fn(async () => {});
    const makeChild = (): EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough } => {
      const child = Object.assign(new EventEmitter(), {
        stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
      });
      const decoder = new MessageDecoder();
      child.stdin.on('data', (data: Buffer) => {
        for (const message of decoder.push(data)) {
          if (message.id === undefined) continue;
          const result = message.method === 'initialize' ? { capabilities: {} } : { contents: 'symbol' };
          const response = Buffer.from(encodeMessage({ jsonrpc: '2.0', id: message.id, result }));
          queueMicrotask(() => child.stdout.write(response));
        }
      });
      return child;
    };
    f.sandbox.prepareExecution.mockImplementation(async (input: { command: { file: string } }) => (isProbe(input) ? {
      mode: 'managed', sanitizeOutput: (text: string) => text, projectRef: f.project, cwd: '/isolated/launcher',
      start: async () => childSession(inventoryOf(['typescript-language-server'])), cancel: probeLease.cancel, lease: probeLease,
    } : {
      mode: 'managed', sanitizeOutput: (text: string) => text, projectRef: f.project, cwd: '/isolated/launcher',
      start: async () => { const child = makeChild(); servers.push(child); return childSession(child); },
      cancel, lease: { projectId: 7, accountUserId: 3, runtimeGeneration: 2, cancel, release, heartbeat: async () => {} },
    }));
    return { ...f, servers, cancel, release, manager: new ManagedLspManager(f.ctx, f.project, 3) };
  }

  it('settles the lost session and answers the next request from a new server', async () => {
    const h = lostSessionFixture();
    try {
      expect(await h.manager.hover('/workspace/a.ts', 1, 1)).toMatchObject({ ok: true, result: { contents: 'symbol' } });
      expect(h.servers).toHaveLength(1);
      const lost = h.servers[0]!;
      lost.emit('error', new Error('Privileged worker connection closed'));
      // The lease is cancelled and released without an exit code to observe, and the plugin stops being
      // able to write to the dead session at all.
      await vi.waitFor(() => { expect(h.cancel).toHaveBeenCalledOnce(); expect(h.release).toHaveBeenCalledOnce(); });
      expect(lost.stdin.destroyed).toBe(true);
      // A fresh session, not a second conversation with the server that went away.
      expect(await h.manager.hover('/workspace/a.ts', 1, 1)).toMatchObject({ ok: true, result: { contents: 'symbol' } });
      expect(h.servers).toHaveLength(2);
    } finally { await h.manager.shutdown(); }
  });
});

describe('managed lsp selection', () => {
  it('builds one instance for concurrent selections and cleans up the losing spawn', async () => {
    const f = fixture();
    // Each spawn gets its own process-shaped child and its own lease, as a real guest would: a
    // shared mock child would let the losing transport's teardown kill the winner's pipe.
    const makeChild = (): EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough } => {
      const child = Object.assign(new EventEmitter(), {
        stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
      });
      child.stdin.on('data', (data: Buffer) => {
        for (const message of new MessageDecoder().push(data)) {
          if (message.id === undefined) continue;
          const result = message.method === 'initialize' ? { capabilities: {} } : { contents: 'symbol' };
          const response = Buffer.from(encodeMessage({ jsonrpc: '2.0', id: message.id, result }));
          queueMicrotask(() => child.stdout.write(response));
        }
      });
      return child;
    };
    const cancelled: (() => void)[] = [];
    const released: (() => void)[] = [];
    f.sandbox.prepareExecution.mockImplementation(async (input: { command: { file: string } }) => (isProbe(input) ? {
      mode: 'managed', sanitizeOutput: (text: string) => text, projectRef: f.project, cwd: '/isolated/launcher', start: async () => childSession(inventoryOf(['typescript-language-server'])), cancel: probeLease.cancel, lease: probeLease,
    } : {
      mode: 'managed', sanitizeOutput: (text: string) => text, projectRef: f.project, cwd: '/isolated/launcher',
      start: async () => childSession(makeChild()),
      cancel: async () => { cancelled.push(() => {}); },
      lease: {
        projectId: 7, accountUserId: 3, runtimeGeneration: 2, heartbeat: async () => {},
        cancel: async () => { cancelled.push(() => {}); },
        release: async () => { released.push(() => {}); },
      },
    }));
    const tools: unknown[] = [];
    const ctx = {
      config: {},
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      currentAccess: () => ({ projectRef: f.project }),
      currentAccountUserId: () => 3,
      control: () => f.sandbox,
      registerTool: (tool: unknown) => { tools.push(tool); },
      registerApiRoute: vi.fn(),
      registerHook: vi.fn(),
      registerTurnContext: vi.fn(),
      registerService: vi.fn(),
      registerControl: vi.fn(),
    } as unknown as PluginContext;
    register(ctx);
    const hover = (tools as { name: string; execute: (id: string, params: unknown) => Promise<{ content: { text: string }[] }> }[])
      .find((tool) => tool.name === 'LspHover')!;
    const [first, second] = await Promise.all([
      hover.execute('c1', { path: '/workspace/a.ts', line: 1, character: 1 }),
      hover.execute('c2', { path: '/workspace/a.ts', line: 1, character: 1 }),
    ]);
    expect(first.content[0]!.text).toContain('symbol');
    expect(second.content[0]!.text).toContain('symbol');
    // One selection → one manager → the two cold spawns race for the same key; the loser's transport
    // (and its execution lease) is cancelled and released instead of leaking. Without the single-flight
    // selection, TWO live instances each keep a lease and client — nothing would ever release either.
    expect(cancelled).toHaveLength(1);
    expect(released).toHaveLength(1);
  });
});
