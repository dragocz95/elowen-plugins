// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { LspManager, formatCheckResult, formatLspFailure } from '../plugins/lsp/src/manager.js';
import type { LspTransport, JsonRpcMessage } from '../plugins/lsp/src/client.js';

/** A language server that dies the instant it is spawned — the "broken binary" case. It never answers
 *  `initialize`, so every operation against it fails and the manager retires the client. */
function deadOnArrival(): LspTransport {
  return {
    send: () => {},
    onMessage: () => {},
    // The client registers this in its constructor; firing it immediately is what a server crashing on
    // startup looks like from the transport's side.
    onExit: (cb) => { cb(); },
    dispose: () => {},
  };
}

/** A working server: answers `initialize`, publishes a clean verdict on didOpen/didChange, and can be
 *  killed later through `crash()` (the long-running server that dies mid-session). */
function healthyServer(): LspTransport & { crash: () => void } {
  let onMsg: (m: JsonRpcMessage) => void = () => {};
  let onExit: () => void = () => {};
  return {
    send: (framed) => {
      const msg = JSON.parse(framed.split('\r\n\r\n')[1]!) as JsonRpcMessage;
      if (msg.method === 'initialize' && typeof msg.id === 'number') {
        queueMicrotask(() => onMsg({ jsonrpc: '2.0', id: msg.id, result: { capabilities: {} } }));
      } else if (msg.method === 'textDocument/didOpen' || msg.method === 'textDocument/didChange') {
        const uri = (msg.params as { textDocument: { uri: string } }).textDocument.uri;
        queueMicrotask(() => onMsg({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri, diagnostics: [] } }));
      }
    },
    onMessage: (cb) => { onMsg = cb; },
    onExit: (cb) => { onExit = cb; },
    dispose: () => {},
    crash: () => onExit(),
  };
}

describe('LspManager crash-restart cap', () => {
  it('retires a server that exits immediately after three attempts instead of respawning on every call', async () => {
    let spawns = 0;
    const mgr = new LspManager({
      root: '/proj', readFile: () => 'x', settleMs: 10,
      spawn: () => { spawns++; return deadOnArrival(); },
    });

    const results = [];
    for (let i = 0; i < 6; i++) results.push(await mgr.checkFile('/proj/a.ts'));

    // Three spawns, then the manager stops burning a process per call.
    expect(spawns).toBe(3);
    expect(results.slice(0, 3).map((r) => r.skipped)).toEqual(['server-error', 'server-error', 'server-error']);
    expect(results.slice(3).map((r) => r.skipped)).toEqual(['crash-looping', 'crash-looping', 'crash-looping']);
    expect(formatCheckResult(results[5]!)).toContain('exceeded max crash recovery attempts (3)');
  });

  it('applies the same cap to a code-intelligence operation, with its own stable text', async () => {
    let spawns = 0;
    const mgr = new LspManager({
      root: '/proj', readFile: () => 'x', settleMs: 10,
      spawn: () => { spawns++; return deadOnArrival(); },
    });

    let out = await mgr.definition('/proj/a.ts', 1, 1);
    for (let i = 0; i < 4; i++) out = await mgr.definition('/proj/a.ts', 1, 1);

    expect(spawns).toBe(3);
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('expected a failure');
    expect(out.reason).toBe('crash-looping');
    expect(formatLspFailure(out)).toContain('exceeded max crash recovery attempts (3)');
  });

  it('a real verdict clears the budget, so unrelated crashes months apart never add up to the cap', async () => {
    let spawns = 0;
    let live: ReturnType<typeof healthyServer> | null = null;
    // Spawn #3 works; every other spawn is a corpse. Without the reset on success the two crashes before
    // it would still be on the counter, and the first crash after it would already trip the cap.
    const mgr = new LspManager({
      root: '/proj', readFile: () => 'x', settleMs: 10,
      spawn: () => {
        spawns++;
        if (spawns !== 3) return deadOnArrival();
        live = healthyServer();
        return live;
      },
    });

    expect((await mgr.checkFile('/proj/a.ts')).skipped).toBe('server-error');
    expect((await mgr.checkFile('/proj/a.ts')).skipped).toBe('server-error');
    expect((await mgr.checkFile('/proj/a.ts')).skipped).toBeUndefined(); // spawn #3 answers → budget cleared
    live!.crash();

    // A full fresh budget of three attempts is available again after the healthy run.
    expect((await mgr.checkFile('/proj/a.ts')).skipped).toBe('server-error'); // spawn #4
    expect((await mgr.checkFile('/proj/a.ts')).skipped).toBe('server-error'); // spawn #5
    expect((await mgr.checkFile('/proj/a.ts')).skipped).toBe('crash-looping');
    expect(spawns).toBe(5);
  });

  it('toggling LSP off and on clears the budget so a fixed server is tried again', async () => {
    let spawns = 0;
    let broken = true;
    const mgr = new LspManager({
      root: '/proj', readFile: () => 'x', settleMs: 10,
      spawn: () => { spawns++; return broken ? deadOnArrival() : healthyServer(); },
    });

    for (let i = 0; i < 5; i++) await mgr.checkFile('/proj/a.ts');
    expect(spawns).toBe(3);

    broken = false;
    mgr.setEnabled(false);
    mgr.setEnabled(true);
    expect((await mgr.checkFile('/proj/a.ts')).skipped).toBeUndefined();
    expect(spawns).toBe(4);
  });
});
