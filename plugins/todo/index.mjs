// Todo plugin: a live checklist the agent maintains for multi-step work and shows to the user.
// Dependency-free (defineTool + typebox + node builtins). Orca renders neither tool output nor pi's
// renderResult, so the list surfaces through the AGENT'S REPLY as a markdown checklist — Orca renders
// assistant markdown in both the CLI (`orca chat`) and the web chat, so `- [ ]` shows as checkboxes.
import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ok = (text) => ({ content: [{ type: 'text', text }], details: {} });
const fail = (e) => ok(`Error: ${e instanceof Error ? e.message : String(e)}`);

const STATUSES = ['pending', 'in_progress', 'completed'];

/** Render a todo array as a markdown checklist — `- [x]` done, `- [ ] ⏳` in-progress, `- [ ]` pending. */
function render(todos) {
  if (!todos || todos.length === 0) return '_No todos yet._';
  return todos.map((t) => {
    if (t.status === 'completed') return `- [x] ${t.title}`;
    if (t.status === 'in_progress') return `- [ ] ⏳ ${t.title}`;
    return `- [ ] ${t.title}`;
  }).join('\n');
}

/** A JSON-file store of the todo list (a flat array), tolerant of a corrupt/missing file. A single
 *  global list — a stable per-conversation key isn't available to plugin tools, and the turn-context
 *  provider runs outside the identity scope, so one list keeps the tools and the injection in agreement. */
class TodoStore {
  constructor(file) { this.file = file; }
  read() {
    try { return existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf-8')) : []; }
    catch { return []; } // corrupted file → treat as empty; the next write repairs it
  }
  write(todos) { writeFileSync(this.file, JSON.stringify(todos, null, 2)); }
}

export function register(ctx) {
  const store = new TodoStore(join(ctx.dataDir(), 'todos.json'));

  ctx.registerTool(defineTool({
    name: 'todo_write',
    label: 'Write todos',
    description: 'Create or replace the current todo checklist. Pass the FULL ordered list every time — it '
      + 'replaces the previous one. Use it for any multi-step task and keep each item\'s status current as you work.',
    parameters: Type.Object({
      todos: Type.Array(Type.Object({
        title: Type.String({ description: 'Short imperative task title' }),
        status: Type.Union(
          [Type.Literal('pending'), Type.Literal('in_progress'), Type.Literal('completed')],
          { description: 'pending | in_progress | completed' },
        ),
      }), { description: 'The full ordered todo list' }),
    }),
    execute: async (_id, p) => {
      try {
        const todos = (p.todos ?? []).map((t) => ({
          title: String(t.title ?? '').trim(),
          status: STATUSES.includes(t.status) ? t.status : 'pending',
        })).filter((t) => t.title);
        store.write(todos);
        return ok(`Updated todo list:\n\n${render(todos)}\n\n(Show this checklist to the user in your reply.)`);
      } catch (e) { return fail(e); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'todo_read',
    label: 'Read todos',
    description: 'Return the current todo checklist as a markdown checklist.',
    parameters: Type.Object({}),
    execute: async () => {
      try { return ok(render(store.read())); }
      catch (e) { return fail(e); }
    },
  }));

  // Keep the agent aware of the live list on every turn (like pi-tasks' reminder injection) without a
  // todo_read round-trip. Ephemeral per-turn context — injected into the user message, never the system
  // prompt, never persisted. Empty list → inject nothing so idle turns stay clean.
  ctx.registerTurnContext(() => {
    const todos = store.read();
    return todos.length ? `Current todo list:\n${render(todos)}` : '';
  });

  ctx.registerSystemPromptFragment(
    'You have a todo checklist (tools `todo_write`, `todo_read`). For any multi-step task, maintain a short '
    + 'todo list and keep it current: call `todo_write` with the FULL list whenever a step starts or finishes. '
    + 'After writing, ALWAYS present the updated checklist to the user in your reply as a markdown checklist so '
    + 'they can follow along.',
  );

  ctx.logger.info('todo tools registered (todo_write + todo_read)');
}
