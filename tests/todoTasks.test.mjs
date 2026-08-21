import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openDb } from 'elowen/dist/store/db.js';
import { makePluginDb } from 'elowen/dist/store/pluginDb.js';
import { register } from '../plugins/todo/index.mjs';

const text = (result) => result.content[0].text;
const json = (result) => JSON.parse(text(result));

function harness(t, enabled = [], options = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'elowen-tasks-v2-'));
  const rawDb = openDb(':memory:');
  const pluginDb = makePluginDb(rawDb, 'todo', { canMigrate: true });
  const tools = [];
  const cards = [];
  const warnings = [];
  const prompts = [];
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
    isPluginEnabled: options.noAccessor ? undefined : (name) => enabled.includes(name),
    logger: { info() {}, warn: (message) => warnings.push(message) },
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
    turnContext: () => turnContext?.() ?? '',
    setSession: (value) => { sessionId = value; },
    tool: (name) => {
      const found = tools.find((tool) => tool.name === name);
      assert.ok(found, `${name} registered`);
      return found;
    },
  };
}

test('Task V2 exposes Claude-compatible incremental tools and keeps private data out of the Todo panel', async (t) => {
  const h = harness(t);
  assert.deepEqual(h.tools.map((tool) => tool.name).sort(), ['TaskCreate', 'TaskGet', 'TaskList', 'TaskUpdate', 'TodoRead']);
  assert.doesNotMatch(h.prompts.join('\n'), /TodoWrite/);

  const create = h.tool('TaskCreate');
  const update = h.tool('TaskUpdate');
  const get = h.tool('TaskGet');
  const list = h.tool('TaskList');
  const read = h.tool('TodoRead');

  assert.deepEqual(json(await create.execute('1', {
    subject: 'Inspect auth',
    description: 'Check <private-token> handling',
    activeForm: 'Inspecting auth',
    metadata: { secret: 'hidden-value' },
  })), { task: { id: '1', subject: 'Inspect auth' } });
  assert.deepEqual(json(await create.execute('2', {
    subject: 'Ship fix',
    description: 'Deploy only after verification',
  })), { task: { id: '2', subject: 'Ship fix' } });

  assert.equal(json(await update.execute('3', {
    taskId: '2', addBlockedBy: ['1'], owner: 'Luna',
  })).success, true);
  const listedBlocked = json(await list.execute('4', {})).tasks;
  assert.deepEqual(listedBlocked[1], {
    id: '2', subject: 'Ship fix', status: 'pending', owner: 'Luna', blockedBy: ['1'],
  });

  await update.execute('5', { taskId: '1', status: 'in_progress' });
  assert.equal(h.cards.at(-1).items[0].text, 'Inspecting auth');
  assert.match(h.cards.at(-1).items[1].text, /blocked by #1/);
  assert.match(h.cards.at(-1).items[1].text, /Luna/);
  assert.doesNotMatch(JSON.stringify(h.cards.at(-1)), /private-token|hidden-value|Deploy only/);

  assert.deepEqual(json(await get.execute('6', { taskId: '1' })), {
    task: {
      id: '1', subject: 'Inspect auth', description: 'Check <private-token> handling',
      status: 'in_progress', blocks: ['2'], blockedBy: [],
    },
  });
  assert.doesNotMatch(text(await read.execute('7', {})), /private-token|hidden-value|Deploy only/);
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
    subject: 'Verify fix', description: 'Run focused tests',
  })).task.id, '3');
  await update.execute('15', { taskId: '2', status: 'completed' });
  await update.execute('16', { taskId: '3', status: 'completed' });
  assert.deepEqual(json(await create.execute('17', {
    subject: 'Next batch', description: 'Fresh work',
  })), { task: { id: '4', subject: 'Next batch' } });
  assert.deepEqual(json(await list.execute('18', {})).tasks.map((task) => task.id), ['4']);
});

test('Task V2 task state is isolated per conversation', async (t) => {
  const h = harness(t);
  await h.tool('TaskCreate').execute('1', { subject: 'Session A', description: 'A' });
  h.setSession('brain-7-b');
  assert.deepEqual(json(await h.tool('TaskList').execute('2', {})), { tasks: [] });
  await h.tool('TaskCreate').execute('3', { subject: 'Session B', description: 'B' });
  h.setSession('brain-7-a');
  assert.deepEqual(json(await h.tool('TaskList').execute('4', {})).tasks.map((task) => task.subject), ['Session A']);
});

test('work, agents, older hosts and missing DB keep the legacy Todo tools', (t) => {
  for (const setup of [
    { enabled: ['work'] },
    { enabled: ['agents'] },
    { enabled: ['work', 'agents'] },
    { enabled: [], options: { noAccessor: true } },
    { enabled: [], options: { dbUnavailable: true } },
  ]) {
    const h = harness(t, setup.enabled, setup.options);
    assert.deepEqual(h.tools.map((tool) => tool.name).sort(), ['TodoRead', 'TodoWrite']);
    assert.doesNotMatch(h.prompts.join('\n'), /TaskCreate/);
  }
});
