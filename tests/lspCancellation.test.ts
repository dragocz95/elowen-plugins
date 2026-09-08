// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { LspManager } from '../plugins/lsp/src/manager.js';
import type { LspTransport } from '../plugins/lsp/src/client.js';
import { MessageDecoder, type JsonRpcMessage } from '../plugins/lsp/src/protocol.js';

function transport(reply: (message: JsonRpcMessage, publish: (message: JsonRpcMessage) => void) => void) {
  let publish: (message: JsonRpcMessage) => void = () => {};
  const decoder = new MessageDecoder();
  const dispose = vi.fn();
  const channel: LspTransport = {
    send: (frame) => {
      for (const message of decoder.push(frame)) {
        if (message.method === 'initialize') queueMicrotask(() => publish({ jsonrpc: '2.0', id: message.id, result: { capabilities: {} } }));
        else reply(message, publish);
      }
    },
    onMessage: (callback) => { publish = callback; }, onExit: () => {}, dispose,
  };
  return { channel, dispose };
}

describe('LSP cancellation review regressions', () => {
  it('refuses oversized and unterminated guest protocol frames', () => {
    expect(() => new MessageDecoder().push('Content-Length: 33554433\r\n\r\n')).toThrow(/size limit/);
    expect(() => new MessageDecoder().push('Content-Length: 999999999999999999999999\r\n\r\n')).toThrow(/size limit/);
    expect(() => new MessageDecoder().push('x'.repeat(8193))).toThrow(/header/);
  });

  it('settles a failed signaled operation instead of hanging', async () => {
    const manager = new LspManager({ projectRoot: () => '/workspace', readFile: () => 'let x = 1;', spawn: async () => { throw new Error('Spawn failed'); } });
    let timer: NodeJS.Timeout | undefined;
    try {
      const result = await Promise.race([
        manager.hover('/workspace/a.ts', 1, 1, undefined, new AbortController().signal).catch((error: Error) => error.message),
        new Promise<string>((resolve) => { timer = setTimeout(() => resolve('hung'), 100); }),
      ]);
      expect(result).toBe('Spawn failed');
    } finally { if (timer) clearTimeout(timer); manager.disposeAll(); }
  });

  it('disposes a cold transport that arrives after its caller aborted', async () => {
    const fake = transport(() => {});
    let finishSpawn!: (channel: LspTransport) => void;
    const spawn = vi.fn(() => new Promise<LspTransport>((resolve) => { finishSpawn = resolve; }));
    const manager = new LspManager({ projectRoot: () => '/workspace', readFile: () => '', spawn });
    const abort = new AbortController();
    try {
      const pending = manager.hover('/workspace/a.ts', 1, 1, undefined, abort.signal);
      await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
      abort.abort();
      expect(await pending).toMatchObject({ reason: 'cancelled' });
      finishSpawn(fake.channel);
      await vi.waitFor(() => expect(fake.dispose).toHaveBeenCalledOnce());
      expect(manager.isRunning()).toBe(false);
    } finally { manager.disposeAll(); }
  });

  it('quarantines cancelled diagnostics before the next document check', async () => {
    let late: (() => void) | undefined;
    const old = transport((message, publish) => {
      if (message.method === 'textDocument/didOpen') {
        const { textDocument } = message.params as { textDocument: { uri: string } };
        late = () => publish({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri: textDocument.uri, diagnostics: [{ message: 'stale A', severity: 1, range: { start: { line: 0, character: 0 } } }] } });
      }
    });
    const fresh = transport((message, publish) => {
      if (message.method === 'textDocument/didOpen') {
        const { textDocument } = message.params as { textDocument: { uri: string } };
        late?.();
        queueMicrotask(() => publish({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri: textDocument.uri, diagnostics: [] } }));
      }
    });
    const spawn = vi.fn().mockReturnValueOnce(old.channel).mockReturnValue(fresh.channel);
    const manager = new LspManager({ projectRoot: () => '/workspace', readFile: () => 'let x = 1;', spawn, settleMs: 1, firstCheckTimeoutMs: 200 });
    try {
      const abort = new AbortController();
      const first = manager.checkFile('/workspace/a.ts', undefined, abort.signal);
      await vi.waitFor(() => expect(late).toBeDefined());
      abort.abort();
      expect(await first).toMatchObject({ skipped: 'cancelled' });
      expect(old.dispose).toHaveBeenCalledOnce();
      const second = await manager.checkFile('/workspace/a.ts');
      expect(second.skipped).toBeUndefined();
      expect(second.diagnostics).toEqual([]);
      expect(spawn).toHaveBeenCalledTimes(2);
    } finally { manager.disposeAll(); }
  });
});
