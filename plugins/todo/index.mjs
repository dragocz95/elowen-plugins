// Todo plugin: a live checklist the agent maintains for multi-step work and shows to the user.
// The checklist is scoped per Elowen identity and working directory, persisted by the plugin, and
// surfaced through the host's generic card panel. Dynamic state stays out of the system-prompt prefix.
import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ok = (text) => ({ content: [{ type: 'text', text }], details: {} });
const fail = (error) => ok(`Error: ${error instanceof Error ? error.message : String(error)}`);

// Models trained on other todo tools often send compatible near-miss field names/status spellings.
// Normalize those at the boundary instead of wasting a tool round-trip on a schema rejection.
const STATUS_ALIASES = {
  pending: 'pending', todo: 'pending', open: 'pending', not_started: 'pending',
  in_progress: 'in_progress', 'in-progress': 'in_progress', active: 'in_progress', doing: 'in_progress', wip: 'in_progress',
  completed: 'completed', complete: 'completed', done: 'completed', finished: 'completed',
};

function normalizeTodo(value) {
  if (!value || typeof value !== 'object') return null;
  const title = String(value.title ?? value.text ?? value.content ?? value.task ?? '').trim();
  if (!title) return null;
  const status = STATUS_ALIASES[String(value.status ?? '').toLowerCase().trim()] ?? 'pending';
  return { title, status };
}

function renderMarkdown(todos) {
  if (!todos.length) return '_No todos yet._';
  return todos.map((todo) => {
    if (todo.status === 'completed') return `- [x] ${todo.title}`;
    if (todo.status === 'in_progress') return `- [ ] ⏳ ${todo.title}`;
    return `- [ ] ${todo.title}`;
  }).join('\n');
}

function escapeXml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/** Keep the changing list and the instructions that govern it adjacent, after the user's request. */
function renderTurnContext(todos) {
  const items = todos
    .map((todo) => `    <todo status="${todo.status}">${escapeXml(todo.title)}</todo>`)
    .join('\n');
  return [
    '<todo_context>',
    '  <todo_items>',
    items,
    '  </todo_items>',
    '  <todo_instructions>',
    '    Keep this checklist synchronized with the work.',
    '    Call `TodoWrite` with the FULL list immediately when a step starts, completes, becomes blocked, or scope changes.',
    '    Keep at most one item `in_progress`; leave only genuinely unfinished work pending.',
    '    Before the final answer, reconcile every item and mark finished work `completed`.',
    '    Do not repeat the checklist in the reply; the todo panel renders it for the user.',
    '  </todo_instructions>',
    '</todo_context>',
  ].join('\n');
}

function pushCard(ctx, todos) {
  ctx.emitCard({
    id: 'todos',
    title: 'Todos',
    pinned: true,
    items: todos.map((todo) => ({ text: todo.title, status: todo.status })),
  });
}

/** Per-identity/per-workdir lists in one JSON map. Legacy flat-array data is intentionally not exposed:
 *  its owner is unknowable, so surfacing it after an upgrade could leak one user's task text to another. */
class TodoStore {
  constructor(file) { this.file = file; }

  #all() {
    try {
      if (!existsSync(this.file)) return {};
      const value = JSON.parse(readFileSync(this.file, 'utf8'));
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch {
      return {};
    }
  }

  read(key) {
    const value = this.#all()[key];
    return Array.isArray(value) ? value.map(normalizeTodo).filter(Boolean) : [];
  }

  write(key, todos) {
    const all = this.#all();
    all[key] = todos;
    writeFileSync(this.file, JSON.stringify(all, null, 2));
  }
}

/** The authenticated Elowen account when available, otherwise the raw platform sender. Appending the
 *  live workdir keeps independent git projects from sharing a checklist in the same user session. */
function keyFor(ctx) {
  const identity = ctx.currentIdentity?.();
  const owner = !identity
    ? 'shared'
    : identity.elowenUserId != null
      ? `u${identity.elowenUserId}`
      : identity.platform && identity.userId
        ? `${identity.platform}:${identity.userId}`
        : 'shared';
  const workDir = ctx.currentWorkDir?.();
  return workDir ? `${owner}@${workDir}` : owner;
}

export function register(ctx) {
  const store = new TodoStore(join(ctx.dataDir(), 'todos.json'));

  ctx.registerTool(defineTool({
    name: 'TodoWrite',
    label: 'Write todos',
    description: 'Create or replace the current todo checklist. Pass the FULL ordered list every time. '
      + 'Use it for genuinely multi-step work, keep at most one item in_progress, and update it at each status transition.',
    parameters: Type.Object({
      todos: Type.Array(Type.Object({
        title: Type.Optional(Type.String({ description: 'Short imperative task title' })),
        text: Type.Optional(Type.String({ description: 'Alias for title' })),
        status: Type.Optional(Type.String({ description: 'pending | in_progress | completed' })),
      }), { description: 'The full ordered todo list' }),
    }),
    execute: async (_id, params) => {
      try {
        const todos = (params.todos ?? []).map(normalizeTodo).filter(Boolean);
        store.write(keyFor(ctx), todos);
        pushCard(ctx, todos);
        const completed = todos.filter((todo) => todo.status === 'completed').length;
        return ok(`Todo list updated (${completed}/${todos.length} done). It is visible in the todo panel; do not repeat it in the reply.`);
      } catch (error) {
        return fail(error);
      }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'TodoRead',
    label: 'Read todos',
    description: 'Return the current todo checklist as a markdown checklist.',
    parameters: Type.Object({}),
    execute: async () => {
      try {
        const todos = store.read(keyFor(ctx));
        pushCard(ctx, todos);
        return ok(renderMarkdown(todos));
      } catch (error) {
        return fail(error);
      }
    },
  }));

  // State changes every turn, so keep it cache-safe in the ephemeral user message. With the host's
  // placement-aware API it follows the user's actual request; an empty list adds no dynamic tokens.
  ctx.registerTurnContext(() => {
    const todos = store.read(keyFor(ctx));
    return todos.length ? renderTurnContext(todos) : '';
  }, { placement: 'after-user' });

  // Only the stable bootstrap rule belongs in the system prompt. Once a list exists, the precise update
  // protocol travels beside that live list in the after-user block above.
  ctx.registerSystemPromptFragment(
    'You have a todo checklist (tools `TodoWrite`, `TodoRead`). For a genuinely multi-step task, create '
    + 'a short list with `TodoWrite` and keep it synchronized while you work. The checklist is displayed '
    + 'automatically in the todo panel; do not repeat it as reply text.',
  );

  ctx.logger.info('todo tools registered (TodoWrite + TodoRead)');
}
