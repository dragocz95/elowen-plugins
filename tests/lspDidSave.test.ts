// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { LspClient, type LspTransport, type JsonRpcMessage } from '../plugins/lsp/src/client.js';

/** A tsserver-shaped language server: it publishes a clean pass when a document is opened, and runs its
 *  real check only on SAVE. A didChange alone publishes nothing — which is exactly why an edit that is
 *  never announced as saved keeps reading as "no problems". */
function saveDrivenServer(afterSave: unknown[]) {
  const methods: string[] = [];
  let initializeParams: unknown = null;
  let onMsg: (m: JsonRpcMessage) => void = () => {};
  const transport: LspTransport = {
    send: (framed) => {
      const msg = JSON.parse(framed.split('\r\n\r\n')[1]!) as JsonRpcMessage;
      if (typeof msg.method === 'string') methods.push(msg.method);
      const publish = (uri: string, diagnostics: unknown[]): void => {
        queueMicrotask(() => onMsg({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri, diagnostics } }));
      };
      if (msg.method === 'initialize' && typeof msg.id === 'number') {
        initializeParams = msg.params;
        queueMicrotask(() => onMsg({ jsonrpc: '2.0', id: msg.id, result: { capabilities: {} } }));
      } else if (msg.method === 'textDocument/didOpen') {
        publish((msg.params as { textDocument: { uri: string } }).textDocument.uri, []);
      } else if (msg.method === 'textDocument/didSave') {
        publish((msg.params as { textDocument: { uri: string } }).textDocument.uri, afterSave);
      }
    },
    onMessage: (cb) => { onMsg = cb; },
    onExit: () => {},
    dispose: () => {},
  };
  return { transport, methods, params: () => initializeParams };
}

const TYPE_ERROR = [{ severity: 1, message: 'Type string is not assignable to number', range: { start: { line: 0, character: 6 } } }];

describe('LSP didSave after an edit', () => {
  it('an edited TypeScript file gets a verdict from one didChange plus the save that follows it', async () => {
    const srv = saveDrivenServer(TYPE_ERROR);
    const client = new LspClient(srv.transport, '/proj');

    const opened = await client.diagnose('/proj/a.ts', 'const a = 1;\n', 'typescript', 500, 20);
    expect(opened.published).toBe(true);
    expect(opened.diagnostics).toEqual([]);

    // The edit. Only the save makes this server publish, so without didSave the check times out with no
    // verdict — the worst answer for an edit-loop probe.
    const edited = await client.diagnose('/proj/a.ts', 'const a: number = "x";\n', 'typescript', 500, 20);
    expect(edited.published).toBe(true);
    expect(edited.diagnostics).toHaveLength(1);
    expect(edited.diagnostics[0]!.message).toContain('not assignable');

    // Exactly one change notification — the publish comes from the save, not from a second didChange.
    expect(srv.methods.filter((m) => m === 'textDocument/didChange')).toHaveLength(1);
    expect(srv.methods.filter((m) => m === 'textDocument/didSave')).toHaveLength(1);
    expect(srv.methods.indexOf('textDocument/didSave')).toBe(srv.methods.indexOf('textDocument/didChange') + 1);
  });

  it('advertises didSave in the initialize handshake, so a server may register for it', async () => {
    const srv = saveDrivenServer([]);
    const client = new LspClient(srv.transport, '/proj');
    await client.diagnose('/proj/a.ts', 'const a = 1;\n', 'typescript', 500, 20);

    const caps = (srv.params() as { capabilities: { textDocument: { synchronization: { didSave: boolean } } } }).capabilities;
    expect(caps.textDocument.synchronization.didSave).toBe(true);
  });

  it('opening a document is not an edit, so didOpen alone sends no save', async () => {
    const srv = saveDrivenServer(TYPE_ERROR);
    const client = new LspClient(srv.transport, '/proj');
    await client.diagnose('/proj/a.ts', 'const a = 1;\n', 'typescript', 500, 20);
    expect(srv.methods).not.toContain('textDocument/didSave');
  });

  it('a code-intelligence request on edited text saves too, so it is answered against the new text', async () => {
    const srv = saveDrivenServer([]);
    const client = new LspClient(srv.transport, '/proj');
    await client.diagnose('/proj/a.ts', 'const a = 1;\n', 'typescript', 500, 20);

    await client.ensureOpen('/proj/a.ts', 'const a = 2;\n', 'typescript');
    expect(srv.methods.filter((m) => m === 'textDocument/didChange')).toHaveLength(1);
    expect(srv.methods.filter((m) => m === 'textDocument/didSave')).toHaveLength(1);
  });
});
