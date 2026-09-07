/** Diagnostics the agent did not have to ask for.
 *
 *  `LspDiagnostics` is a PULL: its description tells the model to call it right after editing a code
 *  file, and a model that forgets simply never learns it broke the build. This module adds the PUSH half
 *  — after Elowen's own Write or Edit lands, the file is type-checked in the background and whatever the
 *  server says is handed to the model with its NEXT turn, without a tool call.
 *
 *  Two host seams carry it, and only these two:
 *
 *  - `tools.call.after` is where a file mutation becomes observable to another plugin (the files plugin
 *    is core and exposes nothing else). It runs inside the mutating turn's ALS scope, so the session id,
 *    the path guard and the allowed roots are all the ones that turn was composed with.
 *  - `registerTurnContext` is the delivery. It is evaluated per turn INSIDE that turn's scope, so the
 *    provider can ask which conversation it is rendering for — which is what makes per-session delivery
 *    possible at all. The `appendContext` hook patch cannot: see the note in index.ts.
 *
 *  Everything here is best effort by construction. A file with no language server, a turn with no
 *  session, a check that never resolves — each one silently contributes nothing, because a background
 *  convenience must never be able to slow down or break the edit that triggered it. */
import type { PluginContext } from 'elowen/dist/plugins/api.js';
import { formatCheckResult, type CheckResult, type LspManager } from './manager.js';
import { detectLanguage } from './servers.js';
import { lspBoundary } from './tools.js';

/** The tools whose successful result means the bytes on disk changed. */
const MUTATING_TOOLS = new Set(['Write', 'Edit']);

/** Per-session bound on tracked files, and on tracked sessions. Both are LRU-trimmed: this is a cache of
 *  something the language server can always be asked for again, never a record anything depends on. */
const MAX_FILES_PER_SESSION = 20;
const MAX_SESSIONS = 50;

interface SessionDiagnostics {
  /** path → rendered check text the model has NOT seen yet. Drained by the turn-context provider. */
  pending: Map<string, string>;
  /** path → the text last handed to the model, so an unchanged verdict is not repeated every turn. */
  delivered: Map<string, string>;
}

/** Wrap the reported files the way the reference does, and say where they came from: without that line a
 *  model reading a bare diagnostics block has no way to tell it apart from a tool result it requested. */
function renderReminder(blocks: readonly string[]): string {
  return '<new-diagnostics>The following new diagnostic issues were detected after your own edits'
    + ' (pushed automatically — no LspDiagnostics call was needed):\n\n'
    + `${blocks.join('\n\n')}</new-diagnostics>`;
}

/** Register the collect → deliver pair. `lsp` is the same per-call manager accessor the tools use, so a
 *  reload's stop window answers null here exactly as it does there. */
export function registerAfterEditDiagnostics(ctx: PluginContext, lsp: () => LspManager | null): void {
  const sessions = new Map<string, SessionDiagnostics>();

  /** This session's slot, created on demand; touching it makes it newest in the LRU order. */
  const slot = (sessionId: string): SessionDiagnostics => {
    const existing = sessions.get(sessionId);
    if (existing) {
      sessions.delete(sessionId);
      sessions.set(sessionId, existing);
      return existing;
    }
    const created: SessionDiagnostics = { pending: new Map(), delivered: new Map() };
    sessions.set(sessionId, created);
    while (sessions.size > MAX_SESSIONS) {
      const oldest = sessions.keys().next().value;
      if (oldest === undefined) break;
      sessions.delete(oldest);
    }
    return created;
  };

  const record = (sessionId: string, path: string, result: CheckResult): void => {
    const entry = slot(sessionId);
    // Nothing to report: the file is clean, or the check never happened (LSP off, no server, a crash).
    // Both must also WITHDRAW anything already queued for this file — a second edit in the same turn that
    // fixes the error would otherwise still deliver the stale complaint, and a `delivered` entry left
    // behind would suppress the same error if it were reintroduced later.
    if (result.skipped !== undefined || result.diagnostics.length === 0) {
      entry.pending.delete(path);
      entry.delivered.delete(path);
      return;
    }
    const text = formatCheckResult(result);
    // The same verdict the model was already given is not news. Re-reporting it every turn is how a
    // passive reminder turns into noise the model learns to skip.
    if (!text || entry.delivered.get(path) === text) return;
    entry.pending.delete(path); // re-insert so the newest check is also the newest LRU entry
    entry.pending.set(path, text);
    while (entry.pending.size > MAX_FILES_PER_SESSION) {
      const oldest = entry.pending.keys().next().value;
      if (oldest === undefined) break;
      entry.pending.delete(oldest);
    }
  };

  /** One block per file, at most once per turn, then cleared. Called by the host while composing a
   *  prompt turn, inside that turn's scope. */
  const render = (): string => {
    try {
      const sessionId = ctx.currentSessionId?.();
      if (!sessionId) return '';
      const entry = sessions.get(sessionId);
      if (!entry || entry.pending.size === 0) return '';
      const blocks = [...entry.pending];
      entry.pending.clear();
      for (const [path, text] of blocks) entry.delivered.set(path, text);
      return renderReminder(blocks.map(([, text]) => text));
    } catch {
      return ''; // a broken provider must not cost the turn its context
    }
  };

  ctx.registerHook({
    name: 'tools.call.after',
    run: (payload) => {
      try {
        const event = payload as { tool?: unknown; params?: unknown; result?: unknown };
        if (typeof event.tool !== 'string' || !MUTATING_TOOLS.has(event.tool)) return;
        // A refused or failed Edit RESOLVES like a successful one, so `details.ok` is the only thing
        // separating "the bytes on disk changed" from "nothing happened".
        if ((event.result as { details?: { ok?: unknown } } | undefined)?.details?.ok !== true) return;
        const requested = (event.params as { file_path?: unknown } | undefined)?.file_path;
        if (typeof requested !== 'string' || !requested) return;
        // No session means nobody will ever read the verdict — do not spawn a language server for it.
        const sessionId = ctx.currentSessionId?.();
        if (!sessionId) return;
        if (!detectLanguage(requested)) return; // a pure extension lookup: markdown costs nothing here
        const manager = lsp();
        if (!manager?.isEnabled()) return;
        // The same guard every LSP tool applies. The files plugin already allowed this path in this turn,
        // so this can only ever agree — but a check that feeds a file to a language server states its own
        // boundary rather than inheriting one it did not verify.
        let path: string;
        try { path = ctx.assertPathAllowed(requested); } catch { return; }
        const boundary = lspBoundary(ctx, path);
        // Deliberately NOT awaited. This hook is awaited by the tool-result path, and a cold first check
        // budgets fifteen seconds for project indexing — in front of the edit's own result that would be
        // a visible stall on every single write. The verdict is read by the NEXT turn, a model round trip
        // away, so it has time to land on its own; a check still running by then simply reports one turn
        // later instead of holding this one up.
        void manager.checkFile(path, boundary).then(
          (result) => { record(sessionId, path, result); },
          () => { /* checkFile is documented never to throw; if it ever does, the turn must not care */ },
        );
      } catch {
        // An observer that throws would be caught by the host bus anyway. Swallowing it here keeps the
        // audit clean and states the intent: this is a convenience, never a reason for a turn to fail.
      }
    },
  });

  // after-user: it qualifies the request the model is answering, so it belongs next to it rather than in
  // front of it, the same placement the session task list uses.
  ctx.registerTurnContext(render, { placement: 'after-user' });
}
