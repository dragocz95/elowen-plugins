import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openDb } from 'elowen/dist/store/db.js';
import { makePluginDb } from 'elowen/dist/store/pluginDb.js';
import { register } from '../plugins/todo/index.mjs';
import { RENDERED_COMPLETED } from '../plugins/todo/lib/render.mjs';

const text = (result) => result.content[0].text;
const json = (result) => JSON.parse(text(result));

function harness(t, options = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'elowen-tasks-v2-'));
  const rawDb = openDb(':memory:');
  const pluginDb = makePluginDb(rawDb, 'todo', { canMigrate: true });
  const tools = [];
  const cards = [];
  const warnings = [];
  const prompts = [];
  const routes = [];
  let sessionId = 'brain-7-a';
  let turnContext;
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
    registerTurnContext: (render) => { turnContext = render; },
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
  assert.match(h.cards.at(-1).items[1].text, /blocked by #1/);
  assert.match(h.cards.at(-1).items[1].text, /Luna/);
  assert.doesNotMatch(JSON.stringify(h.cards.at(-1)), /private-token|hidden-value|Deploy only/);

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

  assert.deepEqual(h.cards.at(-1).items, [
    { text: '#1 Task A', status: 'completed' },
    { text: '#2 Task B', status: 'pending' },
  ]);
  assert.deepEqual(json(await h.tool('TaskList').execute('4', {})).tasks.map((task) => task.id), ['1', '2']);
  assert.equal(json(await update.execute('5', { taskId: first, status: 'in_progress' })).success, true);
});

test('completion hides the panel immediately but preserves ids throughout the finishing turn', async (t) => {
  const h = harness(t);
  const create = h.tool('TaskCreate');
  const update = h.tool('TaskUpdate');
  const get = h.tool('TaskGet');

  await create.execute('1', { tasks: [{ subject: 'Task A', description: 'first' }] });
  await update.execute('2', { taskId: '1', status: 'completed' });

  assert.deepEqual(h.cards.at(-1).items, []);
  assert.equal(json(await get.execute('3', { taskId: '1' })).task.status, 'completed');

  // A steer enters the already-running model loop directly. It does not build a new turn context, so the
  // completed row and every id held by that turn must still be present afterwards.
  await Promise.resolve();
  assert.equal(json(await get.execute('4', { taskId: '1' })).task.status, 'completed');

  await create.execute('5', { tasks: [{ subject: 'Task B', description: 'same turn' }] });
  assert.deepEqual(json(await h.tool('TaskList').execute('6', {})).tasks.map((task) => task.id), ['1', '2']);
  assert.equal(json(await update.execute('7', { taskId: '1', status: 'in_progress' })).success, true);
});

test('a later turn clears an all-completed list without reusing its ids', async (t) => {
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

  // Building context is the next-turn boundary. The list is removed before that new prompt reaches the
  // model, while the list row stays behind to preserve the monotonically increasing id counter.
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
