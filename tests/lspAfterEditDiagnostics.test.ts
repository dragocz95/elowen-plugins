// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { PluginContext, PluginHook, PluginService } from 'elowen/dist/plugins/api.js';
import { runWithPolicy, currentWorkDir } from 'elowen/dist/plugins/policyContext.js';
import { allowedRoots, assertPathAllowed, defaultCwd, isAllAccess } from 'elowen/dist/plugins/pathGuard.js';
import { register } from '../plugins/lsp/src/index.js';
import { LspManager } from '../plugins/lsp/src/manager.js';
import type { LspTransport, JsonRpcMessage } from '../plugins/lsp/src/client.js';

const ROOT = '/tmp';
const TYPE_ERROR = [{ severity: 1, message: 'Type string is not assignable to number', range: { start: { line: 0, character: 6 } } }];

/** A language server that publishes whatever the test currently seeds for a path, on didOpen and on every
 *  later didChange. `settled` resolves once it has answered, so a test can wait for the background check
 *  instead of sleeping. */
function seededServer(seed: () => Record<string, unknown[]>): LspTransport {
  let onMsg: (m: JsonRpcMessage) => void = () => {};
  return {
    send: (framed) => {
      const msg = JSON.parse(framed.split('\r\n\r\n')[1]!) as JsonRpcMessage;
      if (msg.method === 'initialize' && typeof msg.id === 'number') {
        queueMicrotask(() => onMsg({ jsonrpc: '2.0', id: msg.id, result: { capabilities: {} } }));
        return;
      }
      if (msg.method !== 'textDocument/didOpen' && msg.method !== 'textDocument/didChange') return;
      const uri = (msg.params as { textDocument: { uri: string } }).textDocument.uri;
      const diagnostics = seed()[decodeURIComponent(uri.replace('file://', ''))] ?? [];
      queueMicrotask(() => onMsg({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri, diagnostics } }));
    },
    onMessage: (cb) => { onMsg = cb; },
    onExit: () => {},
    dispose: () => {},
  };
}

/** Register the plugin the way the host does, capturing the hook and the turn-context provider, with a
 *  manager whose servers are fakes. `sessionId` is what `ctx.currentSessionId()` answers — the host wires
 *  it from the live turn scope, and both halves of this feature are keyed on it. */
function harness() {
  let sessionId: string | undefined = 'brain-1';
  let seed: Record<string, unknown[]> = {};
  let spawns = 0;
  const hooks: PluginHook[] = [];
  const turnContexts: { render: () => string; placement?: string }[] = [];
  const services: PluginService[] = [];

  const ctx = {
    config: {},
    logger: { info() {}, warn() {}, error() {} },
    assertPathAllowed, allowedRoots, defaultCwd, workDir: currentWorkDir, isAdminSession: isAllAccess,
    currentSessionId: () => sessionId,
    registerTool: (_t: ToolDefinition) => {},
    registerService: (s: PluginService) => { services.push(s); },
    registerControl: () => {},
    registerApiRoute: () => {},
    registerHook: (h: PluginHook) => { hooks.push(h); },
    registerTurnContext: (render: () => string, options?: { placement?: string }) => {
      turnContexts.push({ render, ...(options?.placement ? { placement: options.placement } : {}) });
    },
  } as unknown as PluginContext;

  // Every edit changes the bytes, or the client would answer the second check from its cached verdict
  // for identical text and the collector would never see the new one.
  let revision = 0;

  // register() installs a process 'exit' fallback that only the service's stop() removes. This suite
  // builds a dozen harnesses and never exercises that path, so drop it rather than pile up listeners.
  const exitListenersBefore = process.listeners('exit').length;

  register(ctx, {
    createManager: () => new LspManager({
      spawn: () => { spawns += 1; return seededServer(() => seed); },
      readFile: () => `const a: number = "x"; // ${++revision}\n`,
      exists: () => true,
      settleMs: 10,
    }),
  });

  for (const listener of process.listeners('exit').slice(exitListenersBefore)) process.off('exit', listener);

  const afterCall = hooks.find((h) => h.name === 'tools.call.after');
  const provider = turnContexts[0];

  /** Fire the hook exactly as the host does: inside the mutating turn's policy scope. */
  const edit = async (path: string, ok = true, tool = 'Edit'): Promise<unknown> => {
    const outcome = await runWithPolicy(
      { allowedProjectIds: new Set([1]), allowedPaths: () => [ROOT] },
      () => afterCall!.run({ tool, params: { file_path: path }, result: { content: [], details: { ok } } }),
      { sessionId },
    );
    return outcome;
  };

  /** Let the fire-and-forget check settle: the fake server answers on the microtask queue and the
   *  diagnose wait resolves after its 10ms quiescence window. */
  const settle = () => new Promise((resolve) => { setTimeout(resolve, 60); });

  return {
    hooks, turnContexts, provider, edit, settle,
    render: () => provider!.render(),
    setSeed: (next: Record<string, unknown[]>) => { seed = next; },
    setSession: (next: string | undefined) => { sessionId = next; },
    spawns: () => spawns,
  };
}

describe('LSP diagnostics pushed after Elowen\'s own edits', () => {
  it('registers the collector hook and an after-user turn-context provider', () => {
    const h = harness();
    expect(h.hooks.map((hook) => hook.name)).toEqual(['tools.call.after']);
    expect(h.turnContexts).toHaveLength(1);
    expect(h.turnContexts[0]!.placement).toBe('after-user');
  });

  it('reports an edit that broke the file on the next turn, without the model calling LspDiagnostics', async () => {
    const h = harness();
    h.setSeed({ [`${ROOT}/a.ts`]: TYPE_ERROR });

    await h.edit(`${ROOT}/a.ts`);
    await h.settle();

    const context = h.render();
    expect(context).toContain('<new-diagnostics>');
    expect(context).toContain(`${ROOT}/a.ts`);
    expect(context).toContain('not assignable');
    expect(context).toContain('1 error(s)');
  });

  it('delivers once per turn: a second render in the same turn adds nothing', async () => {
    const h = harness();
    h.setSeed({ [`${ROOT}/a.ts`]: TYPE_ERROR });

    await h.edit(`${ROOT}/a.ts`);
    await h.settle();

    expect(h.render()).toContain('<new-diagnostics>');
    expect(h.render()).toBe('');
  });

  it('reports one block per file however many times that file was edited in the turn', async () => {
    const h = harness();
    h.setSeed({ [`${ROOT}/a.ts`]: TYPE_ERROR });

    await h.edit(`${ROOT}/a.ts`);
    await h.settle();
    await h.edit(`${ROOT}/a.ts`);
    await h.settle();

    const blocks = h.render().split(`${ROOT}/a.ts: `).length - 1;
    expect(blocks).toBe(1);
  });

  it('does not repeat an unchanged verdict on a later turn', async () => {
    const h = harness();
    h.setSeed({ [`${ROOT}/a.ts`]: TYPE_ERROR });

    await h.edit(`${ROOT}/a.ts`);
    await h.settle();
    expect(h.render()).toContain('<new-diagnostics>'); // turn 1 delivers it

    await h.edit(`${ROOT}/a.ts`); // same file, same errors, next turn
    await h.settle();
    expect(h.render()).toBe('');
  });

  it('withdraws a queued report when a later edit in the same turn fixes the file', async () => {
    const h = harness();
    h.setSeed({ [`${ROOT}/a.ts`]: TYPE_ERROR });
    await h.edit(`${ROOT}/a.ts`);
    await h.settle();

    h.setSeed({ [`${ROOT}/a.ts`]: [] }); // the model fixed it before ending the turn
    await h.edit(`${ROOT}/a.ts`);
    await h.settle();

    expect(h.render()).toBe('');
  });

  it('reports an error again once it has been fixed and reintroduced', async () => {
    const h = harness();
    h.setSeed({ [`${ROOT}/a.ts`]: TYPE_ERROR });
    await h.edit(`${ROOT}/a.ts`);
    await h.settle();
    h.render();

    h.setSeed({ [`${ROOT}/a.ts`]: [] });
    await h.edit(`${ROOT}/a.ts`);
    await h.settle();

    h.setSeed({ [`${ROOT}/a.ts`]: TYPE_ERROR });
    await h.edit(`${ROOT}/a.ts`);
    await h.settle();

    expect(h.render()).toContain('not assignable');
  });

  // The collector is shared by every conversation on the daemon, and the diagnostics text carries both a
  // file path and a quoted compiler message about somebody's source. Delivering it to the wrong session
  // would be a cross-tenant read, so the session id gates both halves.
  it('never shows one session\'s diagnostics to another', async () => {
    const h = harness();
    h.setSeed({ [`${ROOT}/a.ts`]: TYPE_ERROR });
    await h.edit(`${ROOT}/a.ts`);
    await h.settle();

    h.setSession('brain-2');
    expect(h.render()).toBe('');

    h.setSession('brain-1');
    expect(h.render()).toContain('<new-diagnostics>');
  });

  it('collects nothing without a session, so no server is spawned for a verdict nobody reads', async () => {
    const h = harness();
    h.setSeed({ [`${ROOT}/a.ts`]: TYPE_ERROR });
    h.setSession(undefined);

    await h.edit(`${ROOT}/a.ts`);
    await h.settle();
    expect(h.spawns()).toBe(0);
  });

  it('ignores a refused or failed mutation and a file no language server covers', async () => {
    const h = harness();
    h.setSeed({ [`${ROOT}/a.ts`]: TYPE_ERROR, [`${ROOT}/notes.md`]: TYPE_ERROR });

    await h.edit(`${ROOT}/a.ts`, false);       // details.ok === false — nothing was written
    await h.edit(`${ROOT}/notes.md`, true);    // markdown: not a language Elowen type-checks
    await h.settle();

    expect(h.spawns()).toBe(0);
    expect(h.render()).toBe('');
  });

  it('returns before the check resolves, so it never sits in front of the edit\'s own result', async () => {
    const h = harness();
    h.setSeed({ [`${ROOT}/a.ts`]: TYPE_ERROR });

    // The host AWAITS this hook. A synchronous return is the whole guarantee that a cold first check —
    // which budgets 15s for project indexing — cannot stall the Write or Edit that triggered it.
    expect(await h.edit(`${ROOT}/a.ts`)).toBeUndefined();
    expect(h.render()).toBe(''); // the verdict has not landed yet, and nothing waited for it

    await h.settle();
    expect(h.render()).toContain('<new-diagnostics>');
  });

  it('survives a garbage payload without throwing', async () => {
    const h = harness();
    const hook = h.hooks[0]!;
    expect(() => hook.run(undefined)).not.toThrow();
    expect(() => hook.run({ tool: 'Edit' })).not.toThrow();
    expect(() => hook.run({ tool: 'Edit', params: { file_path: 42 }, result: { details: { ok: true } } })).not.toThrow();
    expect(h.render()).toBe('');
  });
});
