import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { register } from '../plugins/todo/index.mjs';

test('todo keeps its live state and update protocol together after the user message', async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'elowen-todo-'));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const tools = [];
  let turnContext;
  let turnContextOptions;
  let systemPrompt = '';
  const cards = [];
  const ctx = {
    currentIdentity: () => ({ elowenUserId: 7 }),
    currentSessionId: () => 'brain-7-abc',
    currentWorkDir: () => '/srv/project',
    dataDir: () => dataDir,
    emitCard: (card) => cards.push(card),
    logger: { info() {} },
    registerSystemPromptFragment: (fragment) => { systemPrompt = fragment; },
    registerTool: (tool) => tools.push(tool),
    registerTurnContext: (render, options) => {
      turnContext = render;
      turnContextOptions = options;
    },
  };

  register(ctx);
  assert.equal(typeof turnContext, 'function');
  assert.equal(turnContext(), '');
  const write = tools.find((tool) => tool.name === 'TodoWrite');
  assert.ok(write);
  await write.execute('call-1', {
    todos: [
      {
        content: 'Inspect <cache> & </todo_items>',
        activeForm: 'Inspecting <cache> & </todo_items>',
        note: 'Check <private> state before editing',
        status: 'in_progress',
      },
      { title: 'Ship fix', status: 'pending' },
    ],
  });

  assert.deepEqual(turnContextOptions, { placement: 'after-user' });
  const block = turnContext();
  assert.match(block, /^<todo_context>/);
  assert.match(block, /<todo_items>/);
  assert.match(block, /status="in_progress"/);
  assert.match(block, /activeForm="Inspecting &lt;cache&gt; &amp; &lt;\/todo_items&gt;"/);
  assert.match(block, /Inspect &lt;cache&gt; &amp; &lt;\/todo_items&gt;/);
  assert.match(block, /Check &lt;private&gt; state before editing/);
  assert.doesNotMatch(block, /Inspect <cache>/);
  assert.match(block, /Call `TodoWrite` with the FULL list/);
  assert.match(block, /when a step starts, completes, becomes blocked, or scope changes/);
  assert.match(block, /exactly one unfinished item `in_progress`/);
  assert.match(block, /`note` is private working context/);
  assert.match(block, /Before the final answer/);
  assert.match(block, /Do not repeat the checklist in the reply/);

  const stored = JSON.parse(readFileSync(join(dataDir, 'todos.json'), 'utf8'));
  assert.deepEqual(Object.keys(stored), ['u7#brain-7-abc']);
  assert.deepEqual(stored['u7#brain-7-abc'], [
    {
      content: 'Inspect <cache> & </todo_items>',
      status: 'in_progress',
      activeForm: 'Inspecting <cache> & </todo_items>',
      note: 'Check <private> state before editing',
    },
    { content: 'Ship fix', status: 'pending', activeForm: 'Ship fix' },
  ]);
  assert.equal(cards.at(-1)?.id, 'todos');
  assert.equal(cards.at(-1)?.items[0].text, 'Inspecting <cache> & </todo_items>');
  assert.doesNotMatch(JSON.stringify(cards.at(-1)), /private/);
  const read = tools.find((tool) => tool.name === 'TodoRead');
  const readResult = await read.execute('call-2', {});
  assert.doesNotMatch(readResult.content[0].text, /private/);
  assert.match(systemPrompt, /multi-step task/i);
  assert.match(systemPrompt, /TodoWrite/);
  assert.doesNotMatch(systemPrompt, /Current todo list/i);

  await write.execute('call-3', {
    todos: [
      { content: 'Inspect cache', activeForm: 'Inspecting cache', status: 'completed', note: 'done' },
      { content: 'Ship fix', activeForm: 'Shipping fix', status: 'completed' },
    ],
  });
  assert.equal(turnContext(), '');
  assert.deepEqual(cards.at(-1)?.items, []);
  const cleared = JSON.parse(readFileSync(join(dataDir, 'todos.json'), 'utf8'));
  assert.deepEqual(cleared['u7#brain-7-abc'], []);
});

test('todo manifest and marketplace registry expose the same release version', () => {
  const manifest = JSON.parse(readFileSync(new URL('../plugins/todo/elowen-plugin.json', import.meta.url), 'utf8'));
  const registry = JSON.parse(readFileSync(new URL('../registry.json', import.meta.url), 'utf8'));
  const catalog = registry.plugins.find((plugin) => plugin.name === 'todo');
  assert.equal(manifest.version, '0.8.1');
  assert.equal(catalog?.version, manifest.version);
  assert.deepEqual(manifest.provides.tools, ['TodoWrite', 'TodoRead', 'TaskCreate', 'TaskGet', 'TaskUpdate', 'TaskList']);
  assert.deepEqual(manifest.planSafe, ['TodoWrite', 'TodoRead', 'TaskGet', 'TaskList']);
});
