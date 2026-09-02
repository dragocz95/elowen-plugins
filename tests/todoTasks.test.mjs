import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openDb } from 'elowen/dist/store/db.js';
import { makePluginDb } from 'elowen/dist/store/pluginDb.js';
import { register } from '../plugins/todo/index.mjs';
import { RENDERED_COMPLETED } from '../plugins/todo/lib/render.mjs';
import { COMPLETED_LIST_GRACE_TURNS } from '../plugins/todo/lib/tasks.mjs';

const text = (result) => result.content[0].text;
const json = (result) => JSON.parse(text(result));

function harness(t, options = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'elowen-tasks-v2-'));
  const rawDb = openDb(':memory:');
  options.beforeRegister?.(rawDb);
  const pluginDb = makePluginDb(rawDb, 'todo', { canMigrate: true });
  const tools = [];
  const cards = [];
  const warnings = [];
  const prompts = [];
  const routes = [];
  let sessionId = 'brain-7-a';
  let turnContext;
  let turnContextOptions;
  t.after(() => {
    rawDb.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
  const ctx = {
    currentIdentity: () => ({ elowenUserId: 7 }),
    currentSessionId: () => sessionId,
    dataDir: () => dataDir,
    db: () => {
      if (options.dbUnavailable) throw new Error('no database wired');
      return pluginDb;
    },
    emitCard: (card) => cards.push(card),
    logger: { info() {}, warn: (message) => warnings.push(message) },
    registerApiRoute: (route) => routes.push(route),
    registerSystemPromptFragment: (fragment) => prompts.push(fragment),
    registerTool: (tool) => tools.push(tool),
    registerTurnContext: (render, options) => { turnContext = render; turnContextOptions = options; },
  };
  register(ctx);
  return {
    tools,
    cards,
    warnings,
    prompts,
    routes,
    rawDb,
    turnContext: () => turnContext?.() ?? '',
    turnContextOptions: () => turnContextOptions,
    setSession: (value) => { sessionId = value; },
    tool: (name) => {
      const found = tools.find((tool) => tool.name === name);
      assert.ok(found, `${name} registered`);
      return found;
    },
  };
}

test('Task V2 exposes incremental tools and keeps private data out of the Todo panel', async (t) => {
  const h = harness(t);
  assert.deepEqual(h.tools.map((tool) => tool.name).sort(), ['TaskCreate', 'TaskDelete', 'TaskGet', 'TaskList', 'TaskUpdate']);
  assert.doesNotMatch(h.prompts.join('\n'), /TodoWrite|TodoRead/);
  assert.match(h.prompts.join('\n'), /Mark work in_progress when it starts and completed immediately/);

  const create = h.tool('TaskCreate');
  const update = h.tool('TaskUpdate');
  const get = h.tool('TaskGet');
  const list = h.tool('TaskList');

  assert.deepEqual(json(await create.execute('1', {
    tasks: [
      {
        subject: 'Inspect auth',
        description: 'Check <private-token> handling',
        activeForm: 'Inspecting auth',
        metadata: { secret: 'hidden-value' },
      },
      { subject: 'Ship fix', description: 'Deploy only after verification' },
    ],
  })), { tasks: [{ id: '1', subject: 'Inspect auth' }, { id: '2', subject: 'Ship fix' }] });

  assert.equal(json(await update.execute('3', {
    taskId: '2', addBlockedBy: ['1'], owner: 'Luna',
  })).success, true);
  const listedBlocked = json(await list.execute('4', {})).tasks;
  assert.deepEqual(listedBlocked[1], {
    id: '2', subject: 'Ship fix', status: 'pending', owner: 'Luna', blockedBy: ['1'],
  });

  await update.execute('5', { taskId: '1', status: 'in_progress' });
  assert.equal(h.cards.at(-1).items[0].text, '#1 Inspecting auth');
  assert.equal(typeof h.cards.at(-1).items[0].startedAt, 'number');
  assert.match(h.cards.at(-1).items[1].text, /blocked by #1/);
  assert.match(h.cards.at(-1).items[1].text, /Luna/);
  assert.doesNotMatch(JSON.stringify(h.cards.at(-1)), /private-token|hidden-value|Deploy only/);

  // The structured fields repeat what `text` glues together, so a renderer can lay the row out itself.
  // `label` is the activeForm while the task runs, and the plain subject otherwise.
  assert.deepEqual(h.cards.at(-1).items[0], {
    text: '#1 Inspecting auth',
    status: 'in_progress',
    startedAt: h.cards.at(-1).items[0].startedAt,
    id: '1',
    label: 'Inspecting auth',
  });
  assert.deepEqual(h.cards.at(-1).items[1], {
    text: '#2 Ship fix — Luna (blocked by #1)',
    status: 'pending',
    id: '2',
    label: 'Ship fix',
    owner: 'Luna',
    blockedBy: ['1'],
  });

  assert.deepEqual(json(await get.execute('6', { taskId: '1' })), {
    task: {
      id: '1', subject: 'Inspect auth', description: 'Check <private-token> handling',
      status: 'in_progress', blocks: ['2'], blockedBy: [],
    },
  });
  assert.doesNotMatch(JSON.stringify(json(await list.execute('7', {}))), /private-token|hidden-value|Deploy only/);
  const context = h.turnContext();
  assert.match(context, /^<task_context>/);
  assert.match(context, /Check &lt;private-token&gt; handling/);
  assert.match(context, /hidden-value/);
  assert.doesNotMatch(context, /Check <private-token>/);

  const cycle = json(await update.execute('8', { taskId: '1', addBlockedBy: ['2'] }));
  assert.deepEqual(cycle, {
    success: false, taskId: '1', updatedFields: [], error: 'dependency cycle detected',
  });
  assert.doesNotMatch(JSON.stringify(cycle), /private-token|hidden-value/);

  await update.execute('9', { taskId: '1', status: 'completed' });
  assert.deepEqual(json(await list.execute('10', {})).tasks[1].blockedBy, []);
  await update.execute('11', { taskId: '1', status: 'deleted' });
  assert.deepEqual(json(await get.execute('12', { taskId: '1' })), { task: null });
  assert.deepEqual(json(await list.execute('13', {})).tasks[0].blockedBy, []);

  assert.deepEqual(json(await create.execute('14', {
    tasks: [{ subject: 'Verify fix', description: 'Run focused tests' }],
  })).tasks[0].id, '3');
  await update.execute('15', { taskId: '2', status: 'completed' });
  await update.execute('16', { taskId: '3', status: 'completed' });
  assert.deepEqual(json(await create.execute('17', {
    tasks: [{ subject: 'More work', description: 'Added once everything else was finished' }],
  })), { tasks: [{ id: '4', subject: 'More work' }] });
  // Creating a task never clears finished ones, so the completed history survives and keeps its ids.
  assert.deepEqual(json(await list.execute('18', {})).tasks.map((task) => task.id), ['2', '3', '4']);
});

// TaskUpdate was the single most frequent schema-validation failure on record (10 of 38), even though its
// `taskId` parameter is already spelled the way the reference task tools spell it. The cause is not the
// name in isolation, it is that every surrounding text called it something else: the per-turn task context
// renders `<task id="3">` and `ids="1-5"`, and its instructions said "id" throughout, while the neighbouring
// TaskCreate takes a `tasks` ARRAY. The model was reading `id`, `ids` and `tasks` on every single turn and
// sending exactly those. So the prose has to name the parameter, and the batch asymmetry has to be stated.
test('the task context and tool descriptions name taskId and rule out a batch update', async (t) => {
  const h = harness(t);
  await h.tool('TaskCreate').execute('1', { tasks: [{ subject: 'Work', description: 'Do it' }] });
  const context = h.turnContext();

  // The context still renders the id as an `id` attribute — that is the data — so it must bridge the two
  // names itself rather than leave the model to guess the parameter from the attribute.
  assert.match(context, /<task id="1"/);
  assert.match(context, /parameter named taskId/);
  assert.match(context, /"taskId": "3"/, 'a worked example beats a description of one');
  assert.match(context, /never called id, ids, task or updates/);
  assert.match(context, /no batch form/);

  const updateDescription = h.tool('TaskUpdate').description;
  assert.match(updateDescription, /never `id`, `ids`, `task` or `updates`/);
  assert.match(updateDescription, /does not take a `tasks` array/);
  assert.match(updateDescription, /subject, description, activeForm, status, owner, metadata, addBlocks, addBlockedBy/);

  // TaskCreate's 6 recorded failures were items missing subject/description, so requiredness is stated
  // rather than left to the schema.
  assert.match(h.tool('TaskCreate').description, /REQUIRES both a non-empty subject and a non-empty description/);

  assert.match(h.prompts.join('\n'), /take its ID in a parameter named `taskId`/);
  assert.match(h.prompts.join('\n'), /only `TaskCreate` takes a batch/);
});

// The schemas are OPEN: an unrecognised key is ignored, not rejected. So a TaskUpdate that names a real
// task but misspells the field it wants to change reaches the store looking identical to one that asked
// for nothing, and the bare "nothing to update" reads as "fine but pointless" rather than "you used the
// wrong key". Reproduced live while writing this change: TaskUpdate({taskId, state: 'completed'}).
test('a TaskUpdate that changes nothing names the offending key and the fields that exist', async (t) => {
  const h = harness(t);
  await h.tool('TaskCreate').execute('1', { tasks: [{ subject: 'Work', description: 'Do it' }] });
  const update = h.tool('TaskUpdate');

  const wrongKey = json(await update.execute('2', { taskId: '1', state: 'completed' }));
  assert.equal(wrongKey.success, false);
  assert.equal(wrongKey.error, 'nothing to update');
  assert.match(wrongKey.hint, /"state" is not a field/);
  assert.match(wrongKey.hint, /subject, description, activeForm, status, owner, metadata, addBlocks, addBlockedBy/);

  const several = json(await update.execute('3', { taskId: '1', state: 'x', done: true }));
  assert.match(several.hint, /"state", "done" are not fields/);

  const noFields = json(await update.execute('4', { taskId: '1' }));
  assert.match(noFields.hint, /named a task but no field to change/);
  assert.match(noFields.hint, /subject, description, activeForm/);

  // The hint is for a call that named a REAL task; a missing id keeps its own recovery hint.
  const missing = json(await update.execute('5', { taskId: '999', status: 'completed' }));
  assert.equal(missing.error, 'task not found');
  assert.match(missing.hint, /Call TaskList for the current IDs/);

  // And a correctly spelled field still works — the hint must not have replaced the happy path.
  assert.equal(json(await update.execute('6', { taskId: '1', status: 'completed' })).success, true);
});

test('TaskCreate starts the first implicit runnable task without disturbing explicit or running state', async (t) => {
  const h = harness(t);
  const create = h.tool('TaskCreate');
  const update = h.tool('TaskUpdate');
  const list = h.tool('TaskList');
  const realNow = Date.now;
  let now = 100_000;
  Date.now = () => now;
  t.after(() => { Date.now = realNow; });

  await create.execute('1', {
    tasks: [{ subject: 'Current work', description: 'starts immediately', activeForm: 'Doing current work' }],
  });
  assert.deepEqual(json(await list.execute('2', {})).tasks.map((task) => task.status), ['in_progress']);
  assert.equal(h.rawDb.prepare('SELECT started_at FROM p_todo_tasks WHERE list_key = ? AND id = 1').get('u7#brain-7-a').started_at, 100_000);

  await create.execute('3', {
    tasks: [
      { subject: 'Explicitly pending', description: 'caller chose pending', status: 'pending' },
      { subject: 'Later work', description: 'must not start while another task runs' },
    ],
  });
  assert.deepEqual(json(await list.execute('4', {})).tasks.map((task) => task.status), [
    'in_progress', 'pending', 'pending',
  ]);

  await update.execute('5', { taskId: '1', status: 'completed' });
  now = 200_000;
  await create.execute('6', {
    tasks: [
      { subject: 'Keep pending', description: 'explicit state is authoritative', status: 'pending' },
      { subject: 'Blocked work', description: 'waits for explicit pending task', blockedByIndex: [1] },
      { subject: 'First runnable', description: 'starts because earlier candidates are unavailable' },
    ],
  });
  assert.deepEqual(json(await list.execute('7', {})).tasks.map((task) => task.status), [
    'completed', 'pending', 'pending', 'pending', 'pending', 'in_progress',
  ]);
  assert.equal(h.rawDb.prepare('SELECT started_at FROM p_todo_tasks WHERE list_key = ? AND id = 6').get('u7#brain-7-a').started_at, 200_000);
});

test('completing a task chains the model onto the next unblocked work in the result', async (t) => {
  const h = harness(t);
  const create = h.tool('TaskCreate');
  const update = h.tool('TaskUpdate');

  await create.execute('1', { tasks: [
    { subject: 'First', description: 'runs now' },
    { subject: 'Second', description: 'still blocked', blockedByIndex: [3] },
    { subject: 'Third', description: 'next up' },
  ] });

  // Auto-start put #1 in_progress. Completing it names #3: #2 still waits on #3, so it is not startable.
  assert.equal(
    json(await update.execute('2', { taskId: '1', status: 'completed' })).hint,
    'Next unblocked: #3 Third — mark it in_progress when you start.',
  );

  // #3 was marked in_progress first, so completing it chains onward to #2 instead of nagging mid-work.
  await update.execute('3', { taskId: '3', status: 'in_progress' });
  assert.equal(
    json(await update.execute('4', { taskId: '3', status: 'completed' })).hint,
    'Next unblocked: #2 Second — mark it in_progress when you start.',
  );

  // Finishing the last task leaves nothing to name, and repeating a completion stays quiet too.
  assert.equal(json(await update.execute('5', { taskId: '2', status: 'completed' })).hint, undefined);
  assert.equal(json(await update.execute('6', { taskId: '2', status: 'completed' })).hint, undefined);
});

test('in-progress tasks measure elapsed time from each status entry', async (t) => {
  const h = harness(t);
  const create = h.tool('TaskCreate');
  const update = h.tool('TaskUpdate');
  const list = h.tool('TaskList');
  const realNow = Date.now;
  let now = 100_000;
  Date.now = () => now;
  t.after(() => { Date.now = realNow; });

  await create.execute('1', { tasks: [{ subject: 'Timed work', description: 'measure it', activeForm: 'Timing work' }] });
  assert.equal(h.rawDb.prepare('SELECT started_at FROM p_todo_tasks WHERE list_key = ? AND id = 1').get('u7#brain-7-a').started_at, 100_000);
  assert.deepEqual(h.cards.at(-1).items[0], { text: '#1 Timing work', status: 'in_progress', startedAt: 100_000, id: '1', label: 'Timing work' });
  assert.match(h.turnContext(), /status="in_progress"[^>]*elapsed="under 1m"/);

  now += 169_000;
  await list.execute('3', {});
  assert.deepEqual(h.cards.at(-1).items[0], { text: '#1 Timing work', status: 'in_progress', startedAt: 100_000, id: '1', label: 'Timing work' });
  assert.match(h.turnContext(), /status="in_progress"[^>]*elapsed="2m"/);

  await update.execute('4', { taskId: '1', status: 'completed' });
  assert.equal(h.rawDb.prepare('SELECT started_at FROM p_todo_tasks WHERE list_key = ? AND id = 1').get('u7#brain-7-a').started_at, null);
  assert.deepEqual(h.cards.at(-1).items[0], { text: '#1 Timed work', status: 'completed', id: '1', label: 'Timed work' });

  now = 500_000;
  await update.execute('5', { taskId: '1', status: 'in_progress' });
  assert.equal(h.rawDb.prepare('SELECT started_at FROM p_todo_tasks WHERE list_key = ? AND id = 1').get('u7#brain-7-a').started_at, 500_000);
});

test('running-work reminders stay quiet until work looks stale, duplicated or stalled', async (t) => {
  const h = harness(t);
  assert.deepEqual(h.turnContextOptions(), { placement: 'after-user' });
  const create = h.tool('TaskCreate');
  const update = h.tool('TaskUpdate');
  const realNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  t.after(() => { Date.now = realNow; });

  await create.execute('1', { tasks: [
    { subject: 'Main work', description: 'keep focused' },
    { subject: 'Second work', description: 'detect drift' },
    { subject: 'Remaining work', description: 'detect a stalled list' },
  ] });
  now += 19 * 60_000;
  assert.doesNotMatch(h.turnContext(), /running_work_reminder/);
  now += 60_000;
  assert.match(h.turnContext(), /Task #1 has been in_progress for 20m/);
  assert.doesNotMatch(h.prompts.join('\n'), /running_work_reminder|has been in_progress|none is in_progress/);

  await update.execute('3', { taskId: '2', status: 'in_progress' });
  assert.match(h.turnContext(), /Multiple main tasks are marked in_progress \(#1, #2\)/);

  await update.execute('4', { taskId: '1', status: 'completed' });
  await update.execute('5', { taskId: '2', status: 'completed' });
  assert.match(h.turnContext(), /Unfinished tasks exist but none is in_progress/);

  await update.execute('6', { taskId: '3', status: 'completed' });
  assert.doesNotMatch(h.turnContext(), /running_work_reminder/);
});

test('TaskDelete and user API routes keep session tasks tenant-scoped and clear blocker edges', async (t) => {
  const h = harness(t);
  await h.tool('TaskCreate').execute('1', {
    tasks: [
      { subject: 'Inspect auth', description: 'Private API detail' },
      { subject: 'Ship fix', description: 'After auth', blockedByIndex: [1] },
    ],
  });

  const route = (method, path) => {
    const found = h.routes.find((item) => item.method === method && item.path === path);
    assert.ok(found, `${method} ${path} registered`);
    return found;
  };
  const request = ({ userId = 7, tokenScope = 'user', taskId, scope, body } = {}) => ({
    auth: { userId, admin: false, tokenScope },
    query: { session: 'brain-7-a', ...(taskId ? { taskId } : {}), ...(scope ? { scope } : {}) },
    params: {},
    json: async () => taskId && body ? { ...body, taskId } : body,
  });

  const own = await route('GET', 'tasks').handler(request());
  assert.equal(own.status, 200);
  assert.equal(own.body.tasks[0].description, 'Private API detail');

  const foreign = await route('GET', 'tasks').handler(request({ userId: 8 }));
  assert.deepEqual(foreign.body, { tasks: [] });
  assert.equal((await route('GET', 'tasks').handler(request({ userId: null, tokenScope: 'agent' }))).status, 403);

  const updated = await route('PATCH', 'task').handler(request({ taskId: '1', body: { status: 'completed' } }));
  assert.equal(updated.body.task.status, 'completed');
  assert.equal((await route('PATCH', 'task').handler(request({ taskId: '1', body: { status: 'deleted' } }))).status, 400);

  const removed = await route('DELETE', 'task').handler(request({ taskId: '1' }));
  assert.equal(removed.status, 200);
  assert.equal(removed.body.success, true);
  assert.equal(removed.body.taskId, '1');
  assert.deepEqual((await route('GET', 'tasks').handler(request())).body.tasks[0].blockedBy, []);

  const deleted = json(await h.tool('TaskDelete').execute('2', { taskId: '2' }));
  assert.deepEqual(deleted, { success: true, taskId: '2' });
  assert.deepEqual((await route('GET', 'tasks').handler(request())).body, { tasks: [] });
});

test('PATCH task renames and re-owns a task, and refuses a patch it cannot apply', async (t) => {
  const h = harness(t);
  await h.tool('TaskCreate').execute('1', {
    tasks: [{ subject: 'Inspect auth', description: 'Private API detail' }],
  });

  const patch = h.routes.find((item) => item.method === 'PATCH' && item.path === 'task');
  assert.ok(patch);
  const request = (body) => ({
    auth: { userId: 7, admin: false, tokenScope: 'user' },
    query: { session: 'brain-7-a' },
    params: {},
    json: async () => body,
  });
  const send = (body) => patch.handler(request({ taskId: '1', ...body }));

  const renamed = await send({ subject: '  Inspect the auth flow  ', owner: 'Luna' });
  assert.equal(renamed.status, 200);
  // Unchanged response shape: the patched task plus the whole list.
  assert.deepEqual(Object.keys(renamed.body).sort(), ['task', 'tasks']);
  assert.equal(renamed.body.task.subject, 'Inspect the auth flow');
  assert.equal(renamed.body.task.owner, 'Luna');
  assert.equal(renamed.body.tasks[0].subject, 'Inspect the auth flow');

  // Several fields land in one call, and the private description is untouched by any of them.
  const both = await send({ subject: 'Audit the auth flow', status: 'completed' });
  assert.equal(both.body.task.subject, 'Audit the auth flow');
  assert.equal(both.body.task.status, 'completed');
  assert.equal(both.body.task.description, 'Private API detail');

  // An owner is cleared by null or by an empty string, and the row goes back to NULL rather than ''.
  assert.equal((await send({ owner: null })).body.task.owner, undefined);
  assert.equal(h.rawDb.prepare('SELECT owner FROM p_todo_tasks WHERE list_key = ? AND id = 1').get('u7#brain-7-a').owner, null);
  await send({ owner: 'Luna' });
  assert.equal((await send({ owner: '' })).body.task.owner, undefined);

  // Unknown keys are ignored rather than rejected, so a newer UI cannot fail the whole call…
  const ignored = await send({ subject: 'Kept', priority: 'high' });
  assert.equal(ignored.status, 200);
  assert.equal(ignored.body.task.subject, 'Kept');

  // …but a patch that names nothing this route can apply is refused instead of silently succeeding.
  for (const [body, error] of [
    [{}, 'nothing to update'],
    [{ priority: 'high' }, 'nothing to update'],
    [{ status: 'deleted' }, 'invalid task status'],
    [{ subject: '   ' }, 'invalid task subject'],
    [{ subject: 42 }, 'invalid task subject'],
    [{ subject: 'x'.repeat(201) }, 'invalid task subject'],
    [{ owner: 7 }, 'invalid task owner'],
    [{ owner: 'o'.repeat(65) }, 'invalid task owner'],
    // A subject and an owner are single-line labels reproduced verbatim on every surface — a card row,
    // the CLI's fixed panel, the `<subject>` of the XML turn context, none of which escapeXml protects
    // from a raw control byte. Trimming handles the whitespace AROUND the label, so only what survives it
    // is refused: an inner tab or newline, an ESC opening a terminal sequence, a NUL, a DEL.
    [{ subject: 'Ship\nthe fix' }, 'task subject must not contain control characters (it is a single line)'],
    [{ subject: 'Ship\tthe fix' }, 'task subject must not contain control characters (it is a single line)'],
    [{ subject: 'Ship\x1b[2Jthe fix' }, 'task subject must not contain control characters (it is a single line)'],
    [{ subject: 'Ship\x00 it' }, 'task subject must not contain control characters (it is a single line)'],
    [{ subject: 'Ship\x7f it' }, 'task subject must not contain control characters (it is a single line)'],
    [{ owner: 'Lu\nna' }, 'task owner must not contain control characters'],
    [{ owner: 'Lu\x1b]52;c;x\x07na' }, 'task owner must not contain control characters'],
  ]) {
    const refused = await send(body);
    assert.equal(refused.status, 400, `${JSON.stringify(body)} rejected`);
    assert.equal(refused.body.error, error);
  }
  // Ordinary spaces are not control characters, and surrounding whitespace is trimmed rather than refused.
  const spaced = await send({ subject: ' \n Ship the fix now \t ', owner: '  Luna  ' });
  assert.equal(spaced.status, 200);
  assert.equal(spaced.body.task.subject, 'Ship the fix now');
  assert.equal(spaced.body.task.owner, 'Luna');

  // Nothing the route refused reached the store.
  await send({ subject: 'Kept' });
  assert.equal((await send({ owner: 'Luna' })).body.task.subject, 'Kept');

  assert.equal((await patch.handler(request({ taskId: '99', status: 'completed' }))).status, 404);
});

/** The tool path writes the same two labels the HTTP route does, into the same rows, and its values reach
 *  the same surfaces — so it carries the same rule rather than trusting the model to compose a clean
 *  subject. The refusal is a normal tool result naming the rule, which is what lets the model fix it. */
test('TaskCreate and TaskUpdate refuse a subject or owner carrying control characters', async (t) => {
  const h = harness(t);
  const create = h.tool('TaskCreate');
  const update = h.tool('TaskUpdate');
  const subjectError = 'task subject must not contain control characters (it is a single line)';

  const rejected = text(await create.execute('1', {
    tasks: [{ subject: 'Ship\nthe fix', description: 'Private detail' }],
  }));
  assert.equal(rejected, `Error: ${subjectError}`);
  // The refusal is not a swallowed storage failure, and it left no row and no card behind.
  assert.deepEqual(h.warnings, []);
  assert.deepEqual(json(await h.tool('TaskList').execute('2', {})).tasks, []);

  // A batch is refused whole: the clean sibling of a bad task is not written either.
  await create.execute('3', {
    tasks: [
      { subject: 'Clean one', description: 'd' },
      { subject: 'Bad\x1b[2Jone', description: 'd' },
    ],
  });
  assert.deepEqual(json(await h.tool('TaskList').execute('4', {})).tasks, []);

  const created = json(await create.execute('5', { tasks: [{ subject: 'Inspect auth', description: 'd' }] }));
  assert.equal(created.tasks[0].id, '1');

  const renamed = json(await update.execute('6', { taskId: '1', subject: 'Audit\tauth' }));
  assert.equal(renamed.success, false);
  assert.equal(renamed.error, subjectError);
  const owned = json(await update.execute('7', { taskId: '1', owner: 'Lu\x00na' }));
  assert.equal(owned.success, false);
  assert.equal(owned.error, 'task owner must not contain control characters');
  // Neither refusal reached the row.
  const list = json(await h.tool('TaskList').execute('8', {})).tasks;
  assert.equal(list[0].subject, 'Inspect auth');
  assert.equal(list[0].owner, undefined);

  // The turn context the model reads therefore cannot be forged with a smuggled newline.
  assert.ok(!/<subject>[^<]*\n/.test(h.turnContext()));

  // An ordinary multi-word label still goes through untouched.
  assert.equal(json(await update.execute('9', { taskId: '1', subject: 'Audit the auth flow', owner: 'Luna' })).success, true);
});

test('bulk clear removes the requested rows without resetting the conversation id counter', async (t) => {
  const h = harness(t);
  const create = h.tool('TaskCreate');
  const update = h.tool('TaskUpdate');
  await create.execute('1', {
    tasks: [
      { subject: 'Finished', description: 'done' },
      { subject: 'Still open', description: 'pending', blockedByIndex: [1] },
    ],
  });
  await update.execute('2', { taskId: '1', status: 'completed' });

  const clear = h.routes.find((route) => route.method === 'DELETE' && route.path === 'tasks');
  assert.ok(clear);
  const request = (scope) => ({
    auth: { userId: 7, admin: false, tokenScope: 'user' },
    query: { session: 'brain-7-a', scope }, params: {},
  });

  assert.equal((await clear.handler(request('unknown'))).status, 400);
  const completed = await clear.handler(request('completed'));
  assert.equal(completed.body.success, true);
  assert.equal(completed.body.removed, 1);
  assert.deepEqual(completed.body.tasks.map((task) => ({ id: task.id, subject: task.subject, blockedBy: task.blockedBy })), [
    { id: '2', subject: 'Still open', blockedBy: [] },
  ]);
  assert.equal(h.rawDb.prepare('SELECT next_id FROM p_todo_task_lists WHERE list_key = ?').get('u7#brain-7-a').next_id, 3);

  assert.deepEqual(json(await create.execute('3', {
    tasks: [{ subject: 'New work', description: 'after completed clear' }],
  })).tasks, [{ id: '3', subject: 'New work' }]);

  const all = await clear.handler(request('all'));
  assert.equal(all.body.removed, 2);
  assert.deepEqual(all.body.tasks, []);
  assert.equal(h.rawDb.prepare('SELECT next_id FROM p_todo_task_lists WHERE list_key = ?').get('u7#brain-7-a').next_id, 4);
  assert.deepEqual(json(await create.execute('4', {
    tasks: [{ subject: 'After clear all', description: 'counter survives' }],
  })).tasks, [{ id: '4', subject: 'After clear all' }]);
});

test('a completed task survives the next TaskCreate, on the card and as a usable id', async (t) => {
  // Regression: creating a task used to wipe an all-completed list, so the work the user had just watched
  // finish disappeared from the Todo panel and its id stopped resolving for the model.
  const h = harness(t);
  const create = h.tool('TaskCreate');
  const update = h.tool('TaskUpdate');

  const first = json(await create.execute('1', { tasks: [{ subject: 'Task A', description: 'first' }] })).tasks[0].id;
  await update.execute('2', { taskId: first, status: 'completed' });
  await create.execute('3', { tasks: [{ subject: 'Task B', description: 'second' }] });

  assert.deepEqual(h.cards.at(-1).items[0], { text: '#1 Task A', status: 'completed', id: '1', label: 'Task A' });
  assert.equal(h.cards.at(-1).items[1].text, '#2 Task B');
  assert.equal(h.cards.at(-1).items[1].status, 'in_progress');
  assert.equal(typeof h.cards.at(-1).items[1].startedAt, 'number');
  assert.deepEqual(json(await h.tool('TaskList').execute('4', {})).tasks.map((task) => task.id), ['1', '2']);
  assert.equal(json(await update.execute('5', { taskId: first, status: 'in_progress' })).success, true);
});

test('completion remains readable and a same-turn batch preserves every usable id', async (t) => {
  const h = harness(t);
  const create = h.tool('TaskCreate');
  const update = h.tool('TaskUpdate');
  const get = h.tool('TaskGet');

  await create.execute('1', { tasks: [{ subject: 'Task A', description: 'first' }] });
  await update.execute('2', { taskId: '1', status: 'completed' });

  assert.deepEqual(h.cards.at(-1).items, [{ text: '#1 Task A', status: 'completed', id: '1', label: 'Task A' }]);
  assert.equal(json(await get.execute('3', { taskId: '1' })).task.status, 'completed');

  // A steer enters the already-running model loop directly. It does not build a new turn context, so the
  // completed row and every id held by that turn must still be present afterwards.
  await Promise.resolve();
  assert.equal(json(await get.execute('4', { taskId: '1' })).task.status, 'completed');

  await create.execute('5', { tasks: [{ subject: 'Task B', description: 'same turn' }] });
  assert.deepEqual(json(await h.tool('TaskList').execute('6', {})).tasks.map((task) => task.id), ['1', '2']);
  assert.equal(json(await update.execute('7', { taskId: '1', status: 'in_progress' })).success, true);
});

test('a finished list survives its grace turns, then clears without reusing ids', async (t) => {
  const h = harness(t);
  const create = h.tool('TaskCreate');
  const update = h.tool('TaskUpdate');

  await create.execute('1', {
    tasks: [
      { subject: 'Task A', description: 'first' },
      { subject: 'Task B', description: 'second' },
    ],
  });
  await update.execute('2', { taskId: '1', status: 'completed' });
  await update.execute('3', { taskId: '2', status: 'completed' });

  for (let turn = 0; turn < COMPLETED_LIST_GRACE_TURNS; turn += 1) {
    assert.match(h.turnContext(), /<task_context>/);
  }
  assert.equal(h.turnContext(), '');
  assert.deepEqual(json(await h.tool('TaskList').execute('4', {})), { tasks: [] });
  const api = h.routes.find((route) => route.method === 'GET' && route.path === 'tasks');
  assert.ok(api);
  assert.deepEqual((await api.handler({
    auth: { userId: 7, admin: false, tokenScope: 'user' },
    query: { session: 'brain-7-a' }, params: {},
  })).body, { tasks: [] });
  assert.equal(h.rawDb.prepare('SELECT COUNT(*) AS n FROM p_todo_tasks').get().n, 0);
  assert.equal(h.rawDb.prepare('SELECT COUNT(*) AS n FROM p_todo_task_lists').get().n, 1);

  assert.deepEqual(json(await create.execute('5', {
    tasks: [{ subject: 'Task C', description: 'after cleanup' }],
  })).tasks, [{ id: '3', subject: 'Task C' }]);
});

test('new work after a later turn immediately replaces an aged finished list', async (t) => {
  const h = harness(t);
  const create = h.tool('TaskCreate');
  const update = h.tool('TaskUpdate');

  await create.execute('1', { tasks: [{ subject: 'Old work', description: 'finished topic' }] });
  await update.execute('2', { taskId: '1', status: 'completed' });
  assert.match(h.turnContext(), /Old work/);

  assert.deepEqual(json(await create.execute('3', {
    tasks: [{ subject: 'New work', description: 'unrelated topic' }],
  })).tasks, [{ id: '2', subject: 'New work' }]);
  assert.deepEqual(json(await h.tool('TaskList').execute('4', {})).tasks.map((task) => task.id), ['2']);
  assert.equal(h.cards.at(-1).items[0].text, '#2 New work');
  assert.equal(h.cards.at(-1).items[0].status, 'in_progress');
  assert.equal(typeof h.cards.at(-1).items[0].startedAt, 'number');
});

test('turn boundaries never clear a list that still has open work', async (t) => {
  const h = harness(t);
  const create = h.tool('TaskCreate');
  const update = h.tool('TaskUpdate');
  const list = h.tool('TaskList');

  await create.execute('1', {
    tasks: [
      { subject: 'Done', description: 'done' },
      { subject: 'Running', description: 'running' },
      { subject: 'Pending', description: 'pending' },
    ],
  });
  await update.execute('2', { taskId: '1', status: 'completed' });
  await update.execute('3', { taskId: '2', status: 'in_progress' });

  for (let turn = 0; turn < 3; turn += 1) assert.match(h.turnContext(), /<task_context>/);
  assert.deepEqual(json(await list.execute('4', {})).tasks.map((task) => task.status), [
    'completed', 'in_progress', 'pending',
  ]);
  assert.equal(h.rawDb.prepare('SELECT completed_turns FROM p_todo_task_lists WHERE list_key = ?').get('u7#brain-7-a').completed_turns, 0);
});

test('one TaskCreate call plans the whole batch, wires prerequisites and pushes the card once', async (t) => {
  const h = harness(t);
  const create = h.tool('TaskCreate');
  const list = h.tool('TaskList');

  const created = json(await create.execute('1', {
    tasks: [
      { subject: 'Read the code', description: 'Find the callers' },
      { subject: 'Fix it', description: 'Smallest coherent change', blockedByIndex: [1] },
      { subject: 'Ship it', description: 'Only after review', blockedByIndex: [2] },
    ],
  })).tasks;

  assert.deepEqual(created.map((task) => task.id), ['1', '2', '3']);
  // One call is one panel update, not one per task.
  assert.equal(h.cards.length, 1);
  assert.deepEqual(json(await list.execute('2', {})).tasks.map((task) => task.blockedBy), [[], ['1'], ['2']]);

  // A later batch reaches back to ids that already exist, so no follow-up TaskUpdate is needed either.
  assert.deepEqual(json(await create.execute('3', {
    tasks: [{ subject: 'Announce', description: 'Tell the team', blockedBy: ['3'] }],
  })).tasks, [{ id: '4', subject: 'Announce' }]);
  assert.deepEqual(json(await list.execute('4', {})).tasks[3].blockedBy, ['3']);
});

test('a batch is rejected whole, leaving the list exactly as it was', async (t) => {
  const h = harness(t);
  const create = h.tool('TaskCreate');
  const list = h.tool('TaskList');

  assert.match(text(await create.execute('1', {
    tasks: [
      { subject: 'A', description: 'a', blockedByIndex: [2] },
      { subject: 'B', description: 'b', blockedByIndex: [1] },
    ],
  })), /dependency cycle detected/);
  assert.match(text(await create.execute('2', {
    tasks: [{ subject: 'A', description: 'a', blockedBy: ['99'] }],
  })), /dependency task not found/);
  assert.match(text(await create.execute('3', {
    tasks: [{ subject: 'A', description: 'a', blockedByIndex: [7] }],
  })), /dependency task not found/);
  assert.match(text(await create.execute('4', { tasks: [] })), /non-empty array/);
  assert.match(text(await create.execute('5', {
    tasks: [{ subject: 'Fine', description: 'ok' }, { subject: '  ', description: 'blank subject' }],
  })), /subject and description/);

  assert.deepEqual(json(await list.execute('6', {})).tasks, []);
  // The rejected batches must not have burned ids either.
  assert.deepEqual(json(await create.execute('7', {
    tasks: [{ subject: 'First real task', description: 'after the failures' }],
  })).tasks, [{ id: '1', subject: 'First real task' }]);
});

test('an update against a deleted task refuses to create it and points at TaskList', async (t) => {
  const h = harness(t);
  const create = h.tool('TaskCreate');
  const update = h.tool('TaskUpdate');
  const list = h.tool('TaskList');

  await create.execute('1', { tasks: [{ subject: 'Inspect auth', description: 'Check handling' }] });
  await update.execute('2', { taskId: '1', status: 'deleted' });

  const missing = json(await update.execute('3', { taskId: '1', status: 'in_progress' }));
  assert.equal(missing.success, false);
  assert.equal(missing.error, 'task not found');
  assert.match(missing.hint, /TaskList/);
  assert.match(missing.hint, /TaskCreate/);
  // The refusal must not quietly resurrect the task: an update is never a create.
  assert.deepEqual(json(await list.execute('4', {})).tasks, []);
  // A guessed neighbouring ID fails exactly the same way rather than hitting some other task.
  assert.equal(json(await update.execute('5', { taskId: '2', status: 'completed' })).error, 'task not found');

  // With no tasks left the turn context is empty, so the recovery route has to live in the tool surface
  // itself — that is where a model looping on a stale ID actually reads it.
  assert.equal(h.turnContext(), '');
  const surface = Object.fromEntries(h.tools.map((tool) => [tool.name, tool.description]));
  assert.match(surface.TaskUpdate, /never creates/i);
  assert.match(surface.TaskUpdate, /TaskList/);
  assert.match(surface.TaskCreate, /TaskUpdate/);
  assert.match(h.prompts.join('\n'), /[Nn]ever guess a task ID/);
});

test('the task context names the ids that exist and forbids guessing others', async (t) => {
  const h = harness(t);
  await h.tool('TaskCreate').execute('1', { tasks: [{ subject: 'Inspect auth', description: 'Check handling' }] });
  const context = h.turnContext();
  assert.match(context, /Never guess an id/);
  // The context may fold older finished tasks away, so it must NOT claim the ids it shows are all there
  // are — it has to point at TaskList instead, or the model concludes the folded work never existed.
  assert.match(context, /TaskList reports the authoritative set of ids/);
  assert.match(context, /TaskUpdate only changes work that already exists and never creates it/);
  assert.match(context, /not found[\s\S]*call TaskList/);
});

test('finished work stops re-sending its planning detail, and the oldest of it collapses to a count', async (t) => {
  // The turn context is rebuilt every turn, so a finished task that keeps its description makes the
  // checklist the largest thing in the prompt. Folding must not delete rows while open work remains: ids
  // and the mixed-status panel stay intact until the whole list finishes and a later turn begins.
  const h = harness(t);
  const create = h.tool('TaskCreate');
  const update = h.tool('TaskUpdate');
  const total = RENDERED_COMPLETED + 2;

  const created = json(await create.execute('1', {
    tasks: Array.from({ length: total }, (_, index) => ({
      subject: `Task ${index + 1}`,
      description: `PLANNING-DETAIL-${index + 1}`,
      activeForm: `Doing ${index + 1}`,
      metadata: { note: `META-${index + 1}` },
    })),
  })).tasks;
  for (const task of created.slice(0, total - 1)) {
    await update.execute(`c${task.id}`, { taskId: task.id, status: 'completed' });
  }

  const context = h.turnContext();
  const lastDone = created[total - 2].id;
  const live = created[total - 1].id;

  // A finished task keeps its subject and drops what only mattered while it was open.
  assert.match(context, new RegExp(`<task id="${lastDone}" status="completed"><subject>Task ${total - 1}</subject></task>`));
  assert.doesNotMatch(context, new RegExp(`PLANNING-DETAIL-${total - 1}\\b`));
  assert.doesNotMatch(context, /META-1\b/);

  // Work still open is untouched.
  assert.match(context, new RegExp(`<task id="${live}" status="pending"`));
  assert.match(context, new RegExp(`PLANNING-DETAIL-${total}\\b`));

  // The surplus beyond the cap is counted rather than listed, so the cost stops growing with the session.
  assert.match(context, /<earlier_completed count="1" ids="1"\/>/);
  assert.doesNotMatch(context, /<task id="1" /);

  // Nothing was deleted: the panel still shows every task and the folded id still resolves in full.
  assert.equal(h.cards.at(-1).items.length, total);
  assert.equal(json(await h.tool('TaskGet').execute('g', { taskId: '1' })).task.description, 'PLANNING-DETAIL-1');
});

test('the grace-period migration preserves an existing task list and its next id', async (t) => {
  const h = harness(t, {
    beforeRegister(db) {
      db.exec(`
        CREATE TABLE p_todo_task_lists (
          list_key TEXT PRIMARY KEY,
          next_id INTEGER NOT NULL DEFAULT 1 CHECK (next_id >= 1)
        );
        CREATE TABLE p_todo_tasks (
          list_key TEXT NOT NULL,
          id INTEGER NOT NULL CHECK (id >= 1),
          subject TEXT NOT NULL,
          description TEXT NOT NULL,
          active_form TEXT,
          status TEXT NOT NULL CHECK (status IN ('pending','in_progress','completed')),
          owner TEXT,
          metadata_json TEXT,
          PRIMARY KEY (list_key, id)
        );
        CREATE TABLE p_todo_task_blockers (
          list_key TEXT NOT NULL,
          task_id INTEGER NOT NULL,
          blocker_id INTEGER NOT NULL,
          PRIMARY KEY (list_key, task_id, blocker_id)
        );
        INSERT INTO p_todo_task_lists(list_key,next_id) VALUES ('u7#brain-7-a',2);
        INSERT INTO p_todo_tasks(list_key,id,subject,description,status)
          VALUES ('u7#brain-7-a',1,'Existing task','survives upgrade','pending');
        INSERT INTO plugin_migrations(plugin,version,applied_at) VALUES ('todo',1,datetime('now'));
      `);
    },
  });

  assert.deepEqual(json(await h.tool('TaskList').execute('1', {})).tasks.map((task) => task.id), ['1']);
  assert.equal(h.rawDb.prepare('SELECT completed_turns FROM p_todo_task_lists WHERE list_key = ?').get('u7#brain-7-a').completed_turns, 0);
  assert.equal(h.rawDb.prepare('SELECT started_at FROM p_todo_tasks WHERE list_key = ? AND id = 1').get('u7#brain-7-a').started_at, null);
  assert.deepEqual(json(await h.tool('TaskCreate').execute('2', {
    tasks: [{ subject: 'After upgrade', description: 'keeps counter' }],
  })).tasks, [{ id: '2', subject: 'After upgrade' }]);
});

test('additive task migrations tolerate columns already present before bookkeeping', async (t) => {
  const h = harness(t, {
    beforeRegister(db) {
      db.exec(`
        CREATE TABLE p_todo_task_lists (
          list_key TEXT PRIMARY KEY,
          next_id INTEGER NOT NULL DEFAULT 1 CHECK (next_id >= 1),
          completed_turns INTEGER NOT NULL DEFAULT 0 CHECK (completed_turns >= 0)
        );
        CREATE TABLE p_todo_tasks (
          list_key TEXT NOT NULL,
          id INTEGER NOT NULL CHECK (id >= 1),
          subject TEXT NOT NULL,
          description TEXT NOT NULL,
          active_form TEXT,
          status TEXT NOT NULL CHECK (status IN ('pending','in_progress','completed')),
          owner TEXT,
          metadata_json TEXT,
          started_at INTEGER,
          PRIMARY KEY (list_key, id)
        );
        CREATE TABLE p_todo_task_blockers (
          list_key TEXT NOT NULL,
          task_id INTEGER NOT NULL,
          blocker_id INTEGER NOT NULL,
          PRIMARY KEY (list_key, task_id, blocker_id)
        );
        INSERT INTO plugin_migrations(plugin,version,applied_at) VALUES ('todo',1,datetime('now'));
      `);
    },
  });

  assert.deepEqual(json(await h.tool('TaskCreate').execute('1', {
    tasks: [{ subject: 'Works', description: 'migration stayed idempotent' }],
  })).tasks, [{ id: '1', subject: 'Works' }]);
});

test('Task V2 task state is isolated per conversation', async (t) => {
  const h = harness(t);
  await h.tool('TaskCreate').execute('1', { tasks: [{ subject: 'Session A', description: 'A' }] });
  h.setSession('brain-7-b');
  assert.deepEqual(json(await h.tool('TaskList').execute('2', {})), { tasks: [] });
  await h.tool('TaskCreate').execute('3', { tasks: [{ subject: 'Session B', description: 'B' }] });
  h.setSession('brain-7-a');
  assert.deepEqual(json(await h.tool('TaskList').execute('4', {})).tasks.map((task) => task.subject), ['Session A']);
});

test('session-task DB failures propagate without registering a partial tool surface', (t) => {
  assert.throws(() => harness(t, { dbUnavailable: true }), /no database wired/);
});
