// @vitest-environment node
/** The model-facing half of the task tools: the parameter schemas, checked with a real typebox.
 *
 *  Everything else that covers these tools calls `execute` directly — the path AFTER validation — and
 *  `tests/todoTasks.test.mjs` runs under a loader that replaces `typebox` with a plain-object stub
 *  (tests/stubs/typebox.mjs), where `Optional` is identity and no `required` list is ever produced. So the
 *  schemas the model is actually held to were exercised nowhere: a required field quietly made optional, a
 *  closed status union widened, an atomic batch allowed to be empty, all stay green there.
 *
 *  That matters because a schema refusal is the one failure NOBODY sees. It never reaches `execute`, so it
 *  writes no task, emits no card and leaves no tool result in the transcript — and these tools are driven
 *  by other agents, not by a person who would notice the Todo panel failing to move.
 *
 *  Loaded through the daemon's own `loadPlugins`, so this also pins that the registration seam hands the
 *  model what the plugin wrote: the schema and the description arrive on the registered tool unchanged. */
import { describe, it, expect, afterEach } from 'vitest';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Value } from 'typebox/value';
import { loadPlugins } from 'elowen/dist/plugins/loader.js';
import { openDb } from 'elowen/dist/store/db.js';
import { makePluginDb } from 'elowen/dist/store/pluginDb.js';

const log = { info() {}, warn() {}, error() {} };
const pluginsDir = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'plugins');

const dirs: string[] = [];
const databases: ReturnType<typeof openDb>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const path of dirs.splice(0)) rmSync(path, { recursive: true, force: true });
});

async function schemas() {
  const dataRoot = mkdtempSync(join(tmpdir(), 'elowen-task-schema-'));
  dirs.push(dataRoot);
  const db = openDb(':memory:');
  databases.push(db);
  const reg = await loadPlugins({
    dirs: [pluginsDir],
    enabled: ['todo'],
    dataRoot,
    logger: log,
    pluginDb: (plugin) => makePluginDb(db, plugin, { canMigrate: true }),
  });
  const tools = reg.tools as unknown as { name: string; description: string; parameters: unknown }[];
  const of = (name: string) => {
    const tool = tools.find((candidate) => candidate.name === name);
    // A plugin that throws in register() contributes nothing and every expectation below would pass
    // vacuously against `undefined`.
    expect(tool, `${name} was not registered`).toBeTruthy();
    return tool!;
  };
  return { create: of('TaskCreate'), update: of('TaskUpdate'), remove: of('TaskDelete'), get: of('TaskGet') };
}

describe('task tool parameter schemas', () => {
  it('requires both halves of every created task and a status it knows', async () => {
    const { create } = await schemas();
    expect(Value.Check(create.parameters, { tasks: [{ subject: 'Work', description: 'Do it' }] })).toBe(true);
    // The recorded TaskCreate failures were items missing one of these two, which is why the description
    // states the requirement as well; the schema is what enforces it.
    expect(Value.Check(create.parameters, { tasks: [{ subject: 'Work' }] })).toBe(false);
    expect(Value.Check(create.parameters, { tasks: [{ description: 'Do it' }] })).toBe(false);
    expect(Value.Check(create.parameters, { tasks: [{ subject: 'W', description: 'D', status: 'done' }] })).toBe(false);
    expect(Value.Check(create.parameters, { tasks: [] })).toBe(false);
    // The seam hands the model the plugin's own words, uncapped: only `mcp__*` tools are clamped.
    expect(create.description).toMatch(/REQUIRES both a non-empty subject and a non-empty description/);
  });

  it('takes an id as the string it issued, and stays open to keys it does not know', async () => {
    const { update, get } = await schemas();
    expect(Value.Check(update.parameters, { taskId: '3', status: 'completed' })).toBe(true);
    // `deleted` retires a task and belongs to TaskUpdate alone; TaskCreate rejects it above.
    expect(Value.Check(update.parameters, { taskId: '3', status: 'deleted' })).toBe(true);
    expect(Value.Check(update.parameters, { taskId: 3 })).toBe(false);
    expect(Value.Check(get.parameters, { taskId: 3 })).toBe(false);
    // Deliberately OPEN. An unknown key is ignored rather than rejected, which is what lets the tool
    // answer a misspelled field with a hint naming the fields it does have, instead of a schema error
    // the model cannot act on.
    expect(Value.Check(update.parameters, { taskId: '3', priority: 'high' })).toBe(true);
  });

  it('keeps an explicit delete batch non-empty', async () => {
    const { remove } = await schemas();
    expect(Value.Check(remove.parameters, { taskId: '1' })).toBe(true);
    expect(Value.Check(remove.parameters, { taskIds: ['1', '2'] })).toBe(true);
    expect(Value.Check(remove.parameters, { taskIds: [] })).toBe(false);
  });
});
