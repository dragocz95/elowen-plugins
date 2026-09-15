// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LspManager } from '../plugins/lsp/src/manager.js';
import { lspPluginConfig } from '../plugins/lsp/src/config.js';
import type { LspTransport, JsonRpcMessage } from '../plugins/lsp/src/client.js';

/** A language server that answers didOpen with a clean verdict and records being disposed. `publish:
 *  false` models a server that is busy with its first semantic pass: it stays alive, answers nothing. */
function fakeServer(publish = true): LspTransport & { disposed: () => boolean } {
  let onMsg: (m: JsonRpcMessage) => void = () => {};
  let disposed = false;
  return {
    send: (framed) => {
      const msg = JSON.parse(framed.split('\r\n\r\n')[1]!) as JsonRpcMessage;
      if (msg.method === 'initialize' && typeof msg.id === 'number') {
        queueMicrotask(() => onMsg({ jsonrpc: '2.0', id: msg.id, result: { capabilities: {} } }));
      } else if (msg.method === 'textDocument/didOpen' && publish) {
        const uri = (msg.params as { textDocument: { uri: string } }).textDocument.uri;
        queueMicrotask(() => onMsg({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri, diagnostics: [] } }));
      }
    },
    onMessage: (cb) => { onMsg = cb; },
    onExit: () => {},
    dispose: () => { disposed = true; },
    disposed: () => disposed,
  };
}

/** A manager whose servers are fakes, sweeping on a test-scale clock. `root` is pinned so the pool key
 *  is a real directory the test can delete out from under the server. */
function harness(root: string, opts: { idleTtlMs: number; publish?: boolean }) {
  const spawned: Array<LspTransport & { disposed: () => boolean }> = [];
  const manager = new LspManager({
    spawn: () => { const t = fakeServer(opts.publish); spawned.push(t); return t; },
    readFile: () => 'const a = 1;\n',
    projectRoot: async () => root,
    exists: () => true,
    firstCheckTimeoutMs: 250,
    recheckTimeoutMs: 250,
    settleMs: 5,
    idleTtlMs: opts.idleTtlMs,
    idleSweepIntervalMs: 20,
  });
  return { manager, spawned };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntil(predicate: () => boolean, ms = 2000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(10);
  }
  return predicate();
}

function tempRoot(): string { return mkdtempSync(join(tmpdir(), 'elowen-lsp-idle-')); }

describe('lsp idle server eviction', () => {
  // THE regression: the pool keyed by (server, project root) only ever shrank when a NEW key overflowed
  // the size cap, so an agent that touched several worktrees parked one language server per root — on a
  // 31 GB host, up to eight tsservers and most of the machine's anonymous memory, permanently.
  it('disposes a warm server once it has been idle past the TTL, and serves the next check from a fresh one', async () => {
    const root = tempRoot();
    try {
      const { manager, spawned } = harness(root, { idleTtlMs: 120 });
      const first = await manager.checkFile(join(root, 'a.ts'));
      expect(first.skipped).toBeUndefined();
      expect(spawned).toHaveLength(1);
      expect(spawned[0]!.disposed()).toBe(false);

      expect(await waitUntil(() => spawned[0]!.disposed())).toBe(true);
      expect(manager.isRunning()).toBe(false);

      const second = await manager.checkFile(join(root, 'a.ts'));
      expect(second.skipped).toBeUndefined();
      expect(spawned).toHaveLength(2);
      expect(spawned[1]!.disposed()).toBe(false);
      manager.disposeAll();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('leaves a server alone while it is still inside the TTL', async () => {
    const root = tempRoot();
    try {
      const { manager, spawned } = harness(root, { idleTtlMs: 10_000 });
      await manager.checkFile(join(root, 'a.ts'));
      await sleep(150); // many sweep ticks, none of them due
      expect(spawned[0]!.disposed()).toBe(false);
      expect(manager.isRunning()).toBe(true);
      manager.disposeAll();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  // The case that ran the host out of memory: a worktree deleted while its server was warm left a client
  // that no LRU hit could ever reach again, because its key was never requested.
  it('releases a server whose project root is gone even with age-based eviction off', async () => {
    const root = tempRoot();
    const { manager, spawned } = harness(root, { idleTtlMs: 0 });
    await manager.checkFile(join(root, 'a.ts'));
    expect(spawned[0]!.disposed()).toBe(false);

    rmSync(root, { recursive: true, force: true });
    expect(await waitUntil(() => spawned[0]!.disposed())).toBe(true);
    expect(manager.isRunning()).toBe(false);
    manager.disposeAll();
  });

  it('never disposes a server with a check in flight', async () => {
    const root = tempRoot();
    try {
      const { manager, spawned } = harness(root, { idleTtlMs: 50, publish: false });
      const pending = manager.checkFile(join(root, 'a.ts'));
      await sleep(60); // past the TTL, while the check is still waiting for a verdict
      expect(manager.sweepIdleClients(Date.now() + 60_000)).toBe(0);
      expect(spawned[0]!.disposed()).toBe(false);
      expect((await pending).skipped).toBe('no-response');
      manager.disposeAll();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('defaults the lifetime to the manager default and honours the configured minutes', () => {
    expect(lspPluginConfig({}).idleTtlMinutes).toBe(10);
    expect(lspPluginConfig({ idleTtlMinutes: 0 }).idleTtlMinutes).toBe(0);
    expect(lspPluginConfig({ idleTtlMinutes: 45 }).idleTtlMinutes).toBe(45);
    // Out of range degrades the whole slice to the defaults, exactly as a malformed toggle does.
    expect(lspPluginConfig({ idleTtlMinutes: -1, diagnosticsEnabled: false }).idleTtlMinutes).toBe(10);
  });
});
