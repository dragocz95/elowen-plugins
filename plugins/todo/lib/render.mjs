import { escapeXml } from './common.mjs';

function unresolvedBlockers(task, tasks) {
  const byId = new Map(tasks.map((item) => [item.id, item]));
  return task.blockedBy.filter((id) => byId.get(id)?.status !== 'completed');
}

export function pushLegacyCard(ctx, todos) {
  ctx.emitCard({
    id: 'todos',
    title: 'Todos',
    pinned: true,
    items: todos.map((todo) => ({
      text: todo.status === 'in_progress' ? todo.activeForm : todo.content,
      status: todo.status,
    })),
  });
}

export function pushTaskCard(ctx, tasks) {
  ctx.emitCard({
    id: 'todos',
    title: 'Todos',
    pinned: true,
    items: tasks.map((task) => {
      const blockers = unresolvedBlockers(task, tasks);
      const blocked = blockers.length ? ` (blocked by ${blockers.map((id) => `#${id}`).join(', ')})` : '';
      const owner = task.owner ? ` — ${task.owner}` : '';
      const text = task.status === 'in_progress' && task.activeForm ? task.activeForm : task.subject;
      return { text: `${text}${owner}${blocked}`, status: task.status };
    }),
  });
}

export function renderLegacyMarkdown(todos) {
  if (!todos.length) return '_No todos yet._';
  return todos.map((todo) => {
    if (todo.status === 'completed') return `- [x] ${todo.content}`;
    if (todo.status === 'in_progress') return `- [ ] ⏳ ${todo.content}`;
    return `- [ ] ${todo.content}`;
  }).join('\n');
}

export function renderTaskMarkdown(tasks) {
  if (!tasks.length) return '_No tasks yet._';
  return tasks.map((task) => {
    const blockers = unresolvedBlockers(task, tasks);
    const owner = task.owner ? ` (${task.owner})` : '';
    const blocked = blockers.length ? ` [blocked by ${blockers.map((id) => `#${id}`).join(', ')}]` : '';
    const check = task.status === 'completed' ? 'x' : ' ';
    const progress = task.status === 'in_progress' ? ' ⏳' : '';
    return `- [${check}]${progress} #${task.id} ${task.subject}${owner}${blocked}`;
  }).join('\n');
}

export function renderLegacyContext(todos) {
  const items = todos.map((todo) => {
    const note = todo.note ? `\n      <note>${escapeXml(todo.note)}</note>` : '';
    return `    <todo status="${todo.status}" activeForm="${escapeXml(todo.activeForm)}">\n      <content>${escapeXml(todo.content)}</content>${note}\n    </todo>`;
  }).join('\n');
  return [
    '<todo_context>',
    '  <todo_items>',
    items,
    '  </todo_items>',
    '  <todo_instructions>',
    '    Keep this checklist synchronized with the work.',
    '    Call `TodoWrite` with the FULL list immediately when a step starts, completes, becomes blocked, or scope changes.',
    '    Keep exactly one unfinished item `in_progress`; leave only genuinely unfinished work pending.',
    '    `note` is private working context for the agent; never expose it in the todo panel or repeat it to the user.',
    '    Before the final answer, reconcile every item and mark finished work `completed`.',
    '    Do not repeat the checklist in the reply; the todo panel renders it for the user.',
    '  </todo_instructions>',
    '</todo_context>',
  ].join('\n');
}

export function renderTaskContext(tasks) {
  const items = tasks.map((task) => {
    const activeForm = task.activeForm ? ` activeForm="${escapeXml(task.activeForm)}"` : '';
    const owner = task.owner ? ` owner="${escapeXml(task.owner)}"` : '';
    const metadata = task.metadata && Object.keys(task.metadata).length
      ? `\n      <metadata>${escapeXml(JSON.stringify(task.metadata))}</metadata>`
      : '';
    return [
      `    <task id="${task.id}" status="${task.status}"${activeForm}${owner}>`,
      `      <subject>${escapeXml(task.subject)}</subject>`,
      `      <description>${escapeXml(task.description)}</description>`,
      `      <blockedBy>${task.blockedBy.map((id) => escapeXml(id)).join(',')}</blockedBy>`,
      `      <blocks>${task.blocks.map((id) => escapeXml(id)).join(',')}</blocks>${metadata}`,
      '    </task>',
    ].join('\n');
  }).join('\n');
  return [
    '<task_context>',
    '  <tasks>',
    items,
    '  </tasks>',
    '  <task_instructions>',
    '    Use TaskCreate, TaskGet, TaskUpdate and TaskList to maintain this session task list incrementally.',
    '    Mark work in_progress when it starts and completed immediately when it is genuinely finished.',
    '    Respect blockedBy dependencies; a completed blocker no longer blocks its dependants.',
    '    Descriptions and metadata are private agent context. Never repeat them to the user unless independently required by the request.',
    '    The user sees the public task state in the Todo panel; do not duplicate the list in the reply.',
    '  </task_instructions>',
    '</task_context>',
  ].join('\n');
}
