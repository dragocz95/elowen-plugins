import { escapeXml } from './common.mjs';

/** How many finished tasks the model still sees one by one.
 *
 *  The turn context is rebuilt and re-sent on EVERY turn, so a checklist that only ever grows quietly
 *  becomes the largest thing in it. Measured on a real 37-task conversation: 17.6 kB per turn, of which
 *  15.6 kB were the `description` fields of work that was already finished. Beyond this many, older
 *  finished tasks collapse into a single counted line, which is what keeps the cost flat rather than
 *  linear in the length of the session.
 *
 *  Nothing is deleted by this folding. The rows and ids stay intact for the rest of the active turn; the
 *  Todo panel separately disappears once every item is complete, and storage cleanup waits for the next
 *  real turn boundary. TaskGet can still recover folded detail while those rows exist. */
export const RENDERED_COMPLETED = 10;

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
      return { text: `#${task.id} ${text}${owner}${blocked}`, status: task.status };
    }),
  });
}

/** Work still to do: everything the model needs in order to carry it out. */
function renderLiveTask(task) {
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
}

/** Finished work: public identity only.
 *
 *  The description, activeForm and metadata described how to DO a job that is over, and the dependency
 *  edges are moot too — a completed blocker no longer blocks anyone, and a dependant that is still open
 *  names it from its own `blockedBy` anyway. What the model still needs is that the task exists, what it
 *  was, and that it is done, so it neither redoes the work nor loses the id. */
function renderCompletedTask(task) {
  const owner = task.owner ? ` owner="${escapeXml(task.owner)}"` : '';
  return `    <task id="${task.id}" status="completed"${owner}><subject>${escapeXml(task.subject)}</subject></task>`;
}

/** The ids are a locator, not an exhaustive claim: the range brackets what was folded away, and the
 *  instructions send the model to TaskList for the authoritative set. */
function summariseOmitted(omitted) {
  const ids = omitted.map((task) => task.id);
  const range = ids.length === 1 ? ids[0] : `${ids[0]}-${ids[ids.length - 1]}`;
  return `    <earlier_completed count="${ids.length}" ids="${escapeXml(range)}"/>`;
}

export function renderTaskContext(tasks) {
  // `tasks` arrives in id order, so the completed ones are already oldest-first and the surplus to fold
  // away is the front of that list.
  const completed = tasks.filter((task) => task.status === 'completed');
  const omitted = completed.slice(0, Math.max(0, completed.length - RENDERED_COMPLETED));
  const folded = new Set(omitted.map((task) => task.id));
  const items = [
    ...(omitted.length ? [summariseOmitted(omitted)] : []),
    ...tasks
      .filter((task) => !folded.has(task.id))
      .map((task) => (task.status === 'completed' ? renderCompletedTask(task) : renderLiveTask(task))),
  ].join('\n');
  return [
    '<task_context>',
    '  <tasks>',
    items,
    '  </tasks>',
    '  <task_instructions>',
    '    Use TaskCreate, TaskGet, TaskUpdate and TaskList to maintain this session task list incrementally.',
    '    Never guess an id: use one listed above, or the id TaskCreate just returned. Everything listed here exists, and so does every task counted in earlier_completed — TaskList reports the authoritative set of ids.',
    '    A finished task is listed by subject alone; TaskGet still returns its full description and metadata on the rare occasion you need to look back at one.',
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
