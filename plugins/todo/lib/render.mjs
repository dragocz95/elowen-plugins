import { escapeXml } from './common.mjs';

function unresolvedBlockers(task, tasks) {
  const byId = new Map(tasks.map((item) => [item.id, item]));
  return task.blockedBy.filter((id) => byId.get(id)?.status !== 'completed');
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
    '    The ids above are the only ids that exist right now. Never guess an id: update by an id listed here, or by the id TaskCreate just returned.',
    '    TaskCreate adds new work — send the whole plan as one call with every task in its tasks array — and returns the new ids; TaskUpdate only changes work that already exists and never creates it.',
    '    If TaskUpdate or TaskGet reports that an id was not found, the list has changed: call TaskList and act on the current ids instead of retrying that id or trying nearby ones.',
    '    Mark work in_progress when it starts and completed immediately when it is genuinely finished.',
    '    Respect blockedBy dependencies; a completed blocker no longer blocks its dependants.',
    '    Descriptions and metadata are private agent context. Never repeat them to the user unless independently required by the request.',
    '    The user sees the public task state in the Todo panel; do not duplicate the list in the reply.',
    '  </task_instructions>',
    '</task_context>',
  ].join('\n');
}
