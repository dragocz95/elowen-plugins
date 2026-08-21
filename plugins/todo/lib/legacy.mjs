import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fail, keyFor, ok } from './common.mjs';
import { pushLegacyCard, renderLegacyContext, renderLegacyMarkdown } from './render.mjs';

const STATUS_ALIASES = {
  pending: 'pending', todo: 'pending', open: 'pending', not_started: 'pending',
  in_progress: 'in_progress', 'in-progress': 'in_progress', active: 'in_progress', doing: 'in_progress', wip: 'in_progress',
  completed: 'completed', complete: 'completed', done: 'completed', finished: 'completed',
};

function normalizeTodo(value) {
  if (!value || typeof value !== 'object') return null;
  const content = String(value.content ?? value.title ?? value.text ?? value.task ?? '').trim();
  if (!content) return null;
  const activeForm = String(value.activeForm ?? value.active_form ?? content).trim() || content;
  const note = String(value.note ?? '').trim();
  const status = STATUS_ALIASES[String(value.status ?? '').toLowerCase().trim()] ?? 'pending';
  return note ? { content, status, activeForm, note } : { content, status, activeForm };
}

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

export function registerLegacyMode(ctx) {
  const store = new TodoStore(join(ctx.dataDir(), 'todos.json'));

  ctx.registerTool(defineTool({
    name: 'TodoWrite',
    label: 'Write todos',
    description: [
      'Create or replace the todo checklist — the shared task list, plan and progress tracker for THIS conversation, which the user watches live in the todo panel while you work.',
      'Use it for genuinely multi-step work: three or more distinct steps, several sub-tasks, a plan you want visible, or a user request that lists multiple things to do. Skip it for a single trivial action. To read back the list without changing it, use TodoRead.',
      'This is a full replace, not an append: pass the FULL ordered list every time. Each item uses `content`, `activeForm` and `status`; legacy `title` and `text` aliases remain accepted.',
      'An optional `note` carries private working context for the agent. It is persisted and returned in turn context, but never shown in the Todo panel or TodoRead output.',
      'Update immediately when a step starts, finishes, becomes blocked, or scope changes. Keep exactly one unfinished item in_progress. When every item is completed the stored list and panel clear automatically.',
      'The checklist belongs to one conversation. A turn with no conversation is refused. The panel renders the list, so do not repeat it in the reply.',
    ].join(' '),
    parameters: Type.Object({
      todos: Type.Array(Type.Object({
        content: Type.Optional(Type.String({ description: 'Short imperative task shown in the checklist' })),
        activeForm: Type.Optional(Type.String({ description: 'Present-continuous wording shown while in progress' })),
        note: Type.Optional(Type.String({ description: 'Private agent-only working context hidden from the user' })),
        title: Type.Optional(Type.String({ description: 'Legacy alias for content' })),
        text: Type.Optional(Type.String({ description: 'Legacy alias for content' })),
        status: Type.Optional(Type.String({ description: 'pending | in_progress | completed' })),
      }), { description: 'The FULL ordered todo list, replacing the previous checklist entirely' }),
    }),
    execute: async (_id, params) => {
      try {
        const key = keyFor(ctx);
        if (!key) throw new Error('a todo checklist belongs to a conversation, and this turn has none');
        const todos = (params.todos ?? []).map(normalizeTodo).filter(Boolean);
        const completed = todos.filter((todo) => todo.status === 'completed').length;
        const storedTodos = todos.length > 0 && completed === todos.length ? [] : todos;
        store.write(key, storedTodos);
        pushLegacyCard(ctx, storedTodos);
        return ok(`Todo list updated (${completed}/${todos.length} done). It is visible in the todo panel; do not repeat it in the reply.`);
      } catch (error) {
        return fail(error);
      }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'TodoRead',
    label: 'Read todos',
    description: 'Return the current conversation todo checklist and refresh the user-visible Todo panel.',
    parameters: Type.Object({}),
    execute: async () => {
      try {
        const key = keyFor(ctx);
        const todos = key ? store.read(key) : [];
        pushLegacyCard(ctx, todos);
        return ok(renderLegacyMarkdown(todos));
      } catch (error) {
        return fail(error);
      }
    },
  }));

  ctx.registerTurnContext(() => {
    const key = keyFor(ctx);
    const todos = key ? store.read(key) : [];
    pushLegacyCard(ctx, todos);
    return todos.length ? renderLegacyContext(todos) : '';
  }, { placement: 'after-user' });

  ctx.registerSystemPromptFragment(
    'You have a todo checklist (tools `TodoWrite`, `TodoRead`). For a genuinely multi-step task, create a short list with TodoWrite and keep it synchronized. The user sees it automatically in the Todo panel; do not repeat it in the reply.',
  );

  ctx.logger.info('legacy todo tools registered (TodoWrite + TodoRead)');
}
