// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { loadPlugins } from 'elowen/dist/plugins/loader.js';
import { runWithPolicy } from 'elowen/dist/plugins/policyContext.js';
import type { TurnIdentity } from 'elowen/dist/plugins/policyContext.js';
import type { Policy } from 'elowen/dist/plugins/policy.js';
import { openDb } from 'elowen/dist/store/db.js';
import { makePluginDb } from 'elowen/dist/store/pluginDb.js';

const log = { info() {}, warn() {}, error() {} };
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pluginsDir = join(repoRoot, 'plugins');
const ADMIN: Policy = { allowedProjectIds: 'all', allowedPaths: () => [] };
const OWNER: TurnIdentity = { platform: 'elowen', userId: '1', elowenUserId: 1, admin: true, owner: true };
const OLD_SESSION = 'brain-1-old-cli';
const NEW_SESSION = 'brain-1-new-web';
const WORK_DIR = '/var/www/elowen';

interface PluginTool { name: string; execute(id: string, params: unknown, a?: never, b?: never): Promise<{ content: { text?: string }[] }> }

const dirs: string[] = [];
const databases: ReturnType<typeof openDb>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const path of dirs.splice(0)) rmSync(path, { recursive: true, force: true });
});

async function loadTodo() {
  const dataRoot = mkdtempSync(join(tmpdir(), 'elowen-task-scope-'));
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
  const tools = reg.tools as unknown as PluginTool[];
  return {
    db,
    create: tools.find((tool) => tool.name === 'TaskCreate')!,
    list: tools.find((tool) => tool.name === 'TaskList')!,
    render: reg.turnContexts[0]!.render,
  };
}

function inSession<T>(sessionId: string, fn: () => T): T {
  return runWithPolicy(ADMIN, fn, { identity: OWNER, sessionId, workDir: WORK_DIR });
}

const resultText = async (result: Promise<{ content: { text?: string }[] }>) =>
  (await result).content[0]!.text ?? '';
const resultJson = async (result: Promise<{ content: { text?: string }[] }>) =>
  JSON.parse(await resultText(result));

describe('session task scoping', () => {
  it('keeps each conversation independent for tools and injected context', async () => {
    const { create, list, render } = await loadTodo();

    await inSession(OLD_SESSION, () => create.execute('1', { subject: 'Old session', description: 'Old' }));
    expect(await resultJson(inSession(NEW_SESSION, () => list.execute('2', {})))).toEqual({ tasks: [] });
    expect(inSession(NEW_SESSION, () => render())).toBe('');

    await inSession(NEW_SESSION, () => create.execute('3', { subject: 'New session', description: 'New' }));
    expect(inSession(OLD_SESSION, () => render())).toContain('Old session');
    expect(inSession(OLD_SESSION, () => render())).not.toContain('New session');
    expect(inSession(NEW_SESSION, () => render())).toContain('New session');
  });

  it('stores one task list per brain session id', async () => {
    const { db, create } = await loadTodo();
    await inSession(OLD_SESSION, () => create.execute('1', { subject: 'A', description: 'A' }));
    await inSession(NEW_SESSION, () => create.execute('2', { subject: 'B', description: 'B' }));

    const rows = db.prepare('SELECT list_key FROM p_todo_task_lists ORDER BY list_key').all() as { list_key: string }[];
    expect(rows.map((row) => row.list_key)).toEqual([`u1#${NEW_SESSION}`, `u1#${OLD_SESSION}`].sort());
  });

  it('refuses writes and reads empty without a conversation', async () => {
    const { create, list, render } = await loadTodo();
    const refused = await resultText(runWithPolicy(
      ADMIN,
      () => create.execute('1', { subject: 'A', description: 'A' }),
      { identity: OWNER, workDir: WORK_DIR },
    ));
    expect(refused).toEqual('Error: a task list belongs to a conversation, and this turn has none');
    expect(await resultJson(runWithPolicy(ADMIN, () => list.execute('2', {}), { identity: OWNER, workDir: WORK_DIR }))).toEqual({ tasks: [] });
    expect(runWithPolicy(ADMIN, () => render(), { identity: OWNER, workDir: WORK_DIR })).toBe('');
  });
});
