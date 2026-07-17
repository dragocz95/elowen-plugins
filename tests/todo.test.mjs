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
      { title: 'Inspect <cache> & </todo_items>', status: 'in_progress' },
      { title: 'Ship fix', status: 'pending' },
    ],
  });

  assert.deepEqual(turnContextOptions, { placement: 'after-user' });
  const block = turnContext();
  assert.match(block, /^<todo_context>/);
  assert.match(block, /<todo_items>/);
  assert.match(block, /status="in_progress"/);
  assert.match(block, /Inspect &lt;cache&gt; &amp; &lt;\/todo_items&gt;/);
  assert.doesNotMatch(block, /Inspect <cache>/);
  assert.match(block, /Call `TodoWrite` with the FULL list/);
  assert.match(block, /when a step starts, completes, becomes blocked, or scope changes/);
  assert.match(block, /at most one item `in_progress`/);
  assert.match(block, /Before the final answer/);
  assert.match(block, /Do not repeat the checklist in the reply/);

  const stored = JSON.parse(readFileSync(join(dataDir, 'todos.json'), 'utf8'));
  assert.deepEqual(Object.keys(stored), ['u7@/srv/project']);
  assert.equal(cards.at(-1)?.id, 'todos');
  assert.match(systemPrompt, /multi-step task/i);
  assert.match(systemPrompt, /TodoWrite/);
  assert.doesNotMatch(systemPrompt, /Current todo list/i);
});

test('todo manifest and marketplace registry expose the same release version', () => {
  const manifest = JSON.parse(readFileSync(new URL('../plugins/todo/elowen-plugin.json', import.meta.url), 'utf8'));
  const registry = JSON.parse(readFileSync(new URL('../registry.json', import.meta.url), 'utf8'));
  const catalog = registry.plugins.find((plugin) => plugin.name === 'todo');
  assert.equal(manifest.version, '0.5.0');
  assert.equal(catalog?.version, manifest.version);
});
