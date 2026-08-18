// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { loadPlugins } from 'elowen/dist/plugins/loader.js';
import { runWithPolicy } from 'elowen/dist/plugins/policyContext.js';
import type { TurnIdentity } from 'elowen/dist/plugins/policyContext.js';
import type { Policy } from 'elowen/dist/plugins/policy.js';

const log = { info() {}, warn() {}, error() {} };
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pluginsDir = join(repoRoot, 'plugins');
const ADMIN: Policy = { allowedProjectIds: 'all', allowedPaths: () => [] };
const OWNER: TurnIdentity = { platform: 'elowen', userId: '1', elowenUserId: 1, admin: true, owner: true };
const asText = (r: { content: { text?: string }[] }) => (r.content[0] as { text: string }).text;

// The two conversations the production leak was reported between: an older CLI session and a brand-new
// web conversation the CLI then attached to with /resume. Same account, same checkout — the only thing
// that distinguishes them is the brain session id.
const OLD_SESSION = 'brain-1-old-cli';
const NEW_SESSION = 'brain-1-new-web';
const WORK_DIR = '/var/www/elowen';

let dirs: string[] = [];
function freshDataRoot(): string { const p = mkdtempSync(join(tmpdir(), 'elowen-todo-scope-')); dirs.push(p); return p; }
afterEach(() => { for (const p of dirs) rmSync(p, { recursive: true, force: true }); dirs = []; });

interface PluginTool { name: string; execute(id: string, params: unknown, a?: never, b?: never): Promise<{ content: { text?: string }[] }> }

async function loadTodo(dataRoot: string) {
  const reg = await loadPlugins({ dirs: [pluginsDir], enabled: ['todo'], dataRoot, logger: log });
  const tools = reg.tools as unknown as PluginTool[];
  return {
    write: tools.find((t) => t.name === 'TodoWrite')!,
    read: tools.find((t) => t.name === 'TodoRead')!,
    render: reg.turnContexts[0]!.render,
  };
}

/** Run `fn` exactly as the host runs a prompt turn for one conversation: the SAME account and working
 *  directory every time, only the brain session id differs. This is the real ownership seam — the plugin
 *  reads it back through `ctx.currentSessionId()`, not through anything the test hands it. */
function inSession<T>(sessionId: string, fn: () => T): T {
  return runWithPolicy(ADMIN, fn, { identity: OWNER, sessionId, workDir: WORK_DIR });
}

const todosFile = (dataRoot: string) => join(dataRoot, 'todo/todos.json');

describe('todo checklist scoping', () => {
  it('does not leak a checklist into another conversation of the same account and workdir', async () => {
    const dataRoot = freshDataRoot();
    const { write, read, render } = await loadTodo(dataRoot);

    await inSession(OLD_SESSION, () => write.execute('t', {
      todos: [
        { title: 'Upgrade pi', status: 'in_progress' },
        { title: 'Land hosted tool search', status: 'pending' },
      ],
    }));

    // The new web conversation must start empty — on every surface the checklist reaches the model.
    expect(inSession(NEW_SESSION, () => render())).toBe('');
    expect(asText(await inSession(NEW_SESSION, () => read.execute('t', {})))).toBe('_No todos yet._');
  });

  it('keeps the original conversation checklist intact on resume', async () => {
    const dataRoot = freshDataRoot();
    const { write, render } = await loadTodo(dataRoot);

    await inSession(OLD_SESSION, () => write.execute('t', { todos: [{ title: 'Upgrade pi', status: 'in_progress' }] }));
    // A second conversation writing its own list must not evict the first one's.
    await inSession(NEW_SESSION, () => write.execute('t', { todos: [{ title: 'Fix todo leak', status: 'pending' }] }));

    const resumed = inSession(OLD_SESSION, () => render());
    expect(resumed).toContain('Upgrade pi');
    expect(resumed).not.toContain('Fix todo leak');
    expect(inSession(NEW_SESSION, () => render())).toContain('Fix todo leak');
  });

  it('persists one bucket per brain session id, never per account+workdir', async () => {
    const dataRoot = freshDataRoot();
    const { write } = await loadTodo(dataRoot);

    await inSession(OLD_SESSION, () => write.execute('t', { todos: [{ title: 'A', status: 'pending' }] }));
    await inSession(NEW_SESSION, () => write.execute('t', { todos: [{ title: 'B', status: 'pending' }] }));

    const stored = JSON.parse(readFileSync(todosFile(dataRoot), 'utf8')) as Record<string, unknown>;
    expect(Object.keys(stored).sort()).toEqual([`u1#${NEW_SESSION}`, `u1#${OLD_SESSION}`].sort());
  });

  it('refuses to write, and reads empty, when the turn carries no conversation', async () => {
    const dataRoot = freshDataRoot();
    const { write, read, render } = await loadTodo(dataRoot);

    // No sessionId in scope: there is no conversation to own the list, so a shared bucket would be the
    // leak all over again. The write fails loudly instead of landing somewhere another turn can read.
    const refused = asText(await runWithPolicy(ADMIN, () => write.execute('t', { todos: [{ title: 'A', status: 'pending' }] }), { identity: OWNER, workDir: WORK_DIR }));
    expect(refused).toMatch(/^Error: /);
    expect(existsSync(todosFile(dataRoot))).toBe(false);
    expect(runWithPolicy(ADMIN, () => render(), { identity: OWNER, workDir: WORK_DIR })).toBe('');
    expect(asText(await runWithPolicy(ADMIN, () => read.execute('t', {}), { identity: OWNER, workDir: WORK_DIR }))).toBe('_No todos yet._');
  });
});
