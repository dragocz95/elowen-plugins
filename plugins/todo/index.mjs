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

/** Per-conversation lists in one JSON map. Data written under an older, coarser key is intentionally not
 *  exposed: the conversation that owns it is unknowable, so surfacing it after an upgrade would replay the
 *  very leak this keying prevents — and legacy flat-array data has no knowable owner at all. */
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

/** A checklist belongs to ONE conversation, so the brain session id is the key. Anything coarser is a
 *  leak: keyed by account and working directory, a brand-new web conversation — or a CLI `/resume` onto
 *  it — inherited whatever checklist another conversation of the same user happened to leave in the same
 *  checkout, two `in_progress` items and all. The session id is read from the host's own turn scope, so
 *  the plugin cannot widen it. The owner prefix stays for defence in depth; it never widens the key.
 *
 *  Null when the turn carries no conversation. There is nothing to own the list then, and a shared
 *  fallback bucket is exactly the leak, so callers refuse rather than guess. */
function keyFor(ctx) {
  const sessionId = ctx.currentSessionId?.();
  if (!sessionId) return null;
  const identity = ctx.currentIdentity?.();
  const owner = !identity
    ? 'shared'
    : identity.elowenUserId != null
      ? `u${identity.elowenUserId}`
      : identity.platform && identity.userId
        ? `${identity.platform}:${identity.userId}`
        : 'shared';
  return `${owner}#${sessionId}`;
}

export function register(ctx) {
  const store = new TodoStore(join(ctx.dataDir(), 'todos.json'));

  ctx.registerTool(defineTool({
    name: 'TodoWrite',
    label: 'Write todos',
    description: [
      'Create or replace the todo checklist — the shared task list, plan and progress tracker for THIS conversation, which the user watches live in the todo panel while you work.',
      'Use it for genuinely multi-step work: three or more distinct steps, several sub-tasks, a plan you want visible, or a user request that lists multiple things to do. Skip it for a single trivial action — just do the work instead of tracking it. To read back the list you already wrote without changing it, use TodoRead.',
      'This is a full replace, not an append: pass the FULL ordered list of todos every time, including the items that are already done, because anything you leave out is deleted. Each item takes a `title` (a short imperative task, `text` is an accepted alias) and a `status` of pending, in_progress or completed; common spellings such as "todo", "doing" or "done" are normalized, and an unknown status falls back to pending.',
      'Update the checklist immediately at every transition — when a step starts, finishes, becomes blocked, or when the scope of the work changes — rather than batching updates at the end. Keep at most one item in_progress and mark work completed the moment it is actually finished, not when you plan to finish it.',
      'The checklist belongs to one conversation and is not shared with other conversations or accounts; a turn with no conversation behind it (for example a scheduled cron run) is refused with an error. The panel renders the list for the user, so do not repeat the checklist as text in your reply.',
    ].join(' '),
    parameters: Type.Object({
      todos: Type.Array(Type.Object({
        title: Type.Optional(Type.String({ description: 'Short imperative task title, e.g. "Add regression test for the auth guard". The alias fields text, content and task are also accepted.' })),
        text: Type.Optional(Type.String({ description: 'Alias for title — use title unless you are porting an existing list' })),
        status: Type.Optional(Type.String({ description: 'Task state: "pending", "in_progress" or "completed". Aliases such as todo/open, doing/active/wip and done/finished are normalized; anything unknown becomes pending.' })),
      }), { description: 'The FULL ordered todo list, replacing the previous checklist entirely — include already completed items or they are lost' }),
    }),
    execute: async (_id, params) => {
      try {
        const key = keyFor(ctx);
        if (!key) throw new Error('a todo checklist belongs to a conversation, and this turn has none');
        const todos = (params.todos ?? []).map(normalizeTodo).filter(Boolean);
        store.write(key, todos);
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
    description: [
      'Return the todo checklist of the current conversation — the shared task list and progress state — rendered as a markdown checklist, with completed items as "[x]" and the item currently in progress marked with an hourglass.',
      'Use it to re-orient yourself on what is still open and what is already done: after a long or compacted conversation, when resuming interrupted multi-step work, or when the user asks what remains to be done. It takes no parameters and only reads the list for the conversation you are in; to add, reorder or change the status of any item, call TodoWrite with the full list.',
      'Reading also refreshes the todo panel the user sees, so the displayed plan matches the stored one. When no checklist has been created yet, or the turn has no conversation behind it, the result is simply an empty list rather than an error.',
    ].join(' '),
    parameters: Type.Object({}),
    execute: async () => {
      try {
        const key = keyFor(ctx);
        const todos = key ? store.read(key) : [];
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
    const key = keyFor(ctx);
    const todos = key ? store.read(key) : [];
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
