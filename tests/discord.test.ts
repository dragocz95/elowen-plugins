// @vitest-environment node
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlugins } from 'elowen/dist/plugins/loader.js';

const log = { info() {}, warn() {}, error() {} };
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

afterEach(() => vi.unstubAllGlobals());

describe('discord plugin', () => {
  it('registers no platform without a botToken (warns instead of crashing)', async () => {
    const reg = await loadPlugins({ dirs: [join(repoRoot, 'plugins')], enabled: ['discord'], logger: log });
    expect(reg.platforms).toHaveLength(0);
    expect(reg.notificationDestinationProviders.has('discord')).toBe(true);
  });

  it('registers the platform adapter when a botToken is configured', async () => {
    const reg = await loadPlugins({
      dirs: [join(repoRoot, 'plugins')], enabled: ['discord'], logger: log,
      config: { discord: { botToken: 'tok', rolePolicies: [] } },
    });
    expect(reg.platforms.map((p) => p.name)).toEqual(['discord']);
  });
});

describe('DiscordReadChannel message ids', () => {
  type Tool = { name: string; execute: (id: string, p: unknown) => Promise<{ content: { text: string }[] }> };
  const loadTools = async (messages: unknown[], admin = true): Promise<Tool[]> => {
    const { registerTools } = await import(join(repoRoot, 'plugins/discord/lib/tools.mjs')) as {
      registerTools: (ctx: unknown, adapter: unknown) => void;
    };
    const tools: Tool[] = [];
    registerTools(
      {
        registerTool: (t: never) => tools.push(t),
        isAdminSession: () => admin,
        currentIdentity: () => ({ owner: false }),
        config: { guildId: '7' },
      },
      { rest: async () => messages },
    );
    return tools;
  };
  const loadTool = async (messages: unknown[]) => (await loadTools(messages)).find((t) => t.name === 'DiscordReadChannel')!;

  it('prefixes every line with the message id so pin/delete have something to act on', async () => {
    const tool = await loadTool([
      { id: '222', author: { username: 'bob' }, content: 'second' },
      { id: '111', author: { username: 'alice' }, content: 'first' },
    ]);
    const text = (await tool.execute('t', { channelId: '9' })).content[0].text;
    // Discord returns newest first; the tool reverses to chronological order.
    expect(text.split('\n')).toEqual(['111  alice: first', '222  bob: second']);
  });

  it('drops whole lines when trimming, so a truncated snowflake can never be used as an id', async () => {
    // Enough messages to blow past the 6000-character budget.
    const many = Array.from({ length: 200 }, (_, i) => ({
      id: String(100000000000000000 + i),
      author: { username: 'u' },
      content: 'x'.repeat(60),
    }));
    const text = (await loadTool(many)).execute('t', { channelId: '9' });
    const lines = (await text).content[0].text.split('\n');
    expect(lines.join('\n').length).toBeLessThanOrEqual(6000);
    // Every surviving line still carries a complete 18-digit snowflake.
    for (const line of lines) expect(line).toMatch(/^\d{18} {2}u: x+$/);
  });

  it('lets a project-scoped non-owner session reach curated and raw tools', async () => {
    const tools = await loadTools([], false);
    const run = async (name: string, params: unknown) => {
      const out = await tools.find((t) => t.name === name)!.execute('t', params);
      return out.content[0].text;
    };

    expect(await run('DiscordListChannels', {})).toBe('(no channels)');
    expect(await run('DiscordApi', { method: 'GET', path: '/users/@me' })).toBe('[]');
  });
});

describe('discord splitContent (code-block-aware chunking)', () => {
  it('never breaks a fenced code block across a chunk boundary', async () => {
    const { splitContent } = await import(join(repoRoot, 'plugins/discord/index.mjs')) as { splitContent: (t: string) => string[] };
    const big = '```js\n' + 'const x = 1;\n'.repeat(400) + '```'; // > 2000 chars, one fence
    const pieces = splitContent(big);
    expect(pieces.length).toBeGreaterThan(1);
    for (const p of pieces) {
      expect(p.length).toBeLessThanOrEqual(2100);
      expect((p.match(/```/g)?.length ?? 0) % 2).toBe(0); // every piece has balanced fences
    }
    // reassembled (stripping the injected reopen/close fences) preserves the code lines
    expect(pieces.join('')).toContain('const x = 1;');
  });

  it('leaves short text untouched', async () => {
    const { splitContent } = await import(join(repoRoot, 'plugins/discord/index.mjs')) as { splitContent: (t: string) => string[] };
    expect(splitContent('ahoj')).toEqual(['ahoj']);
  });
});

describe('discord LiveMessage (tool progress)', () => {
  const load = async () => (await import(join(repoRoot, 'plugins/discord/index.mjs'))) as {
    LiveMessage: new (adapter: { rest: (m: string, p: string, b: { content: string }) => Promise<{ id: string }> }, channelId: string) => {
      onEvent: (e: { type: string; name?: string; detail?: string; delta?: string }) => void;
      finalize: (reply?: string) => Promise<void>;
    };
  };

  it('tools stack tightly in the progress bubble; a narration-first answer is re-anchored BELOW the trace', async () => {
    const { LiveMessage } = await load();
    const posts: string[] = []; // message ids in creation order
    const edits = new Map<string, string>();
    const deleted: string[] = [];
    let nextId = 0;
    const adapter = {
      cfg: { answerMode: 'live' },
      rest: async (method: string, path: string, body: { content: string }) => {
        if (method === 'POST') { const id = `m${++nextId}`; posts.push(id); edits.set(id, body.content); return { id }; }
        const id = path.split('/').pop()!;
        if (method === 'DELETE') { deleted.push(id); return { id }; }
        edits.set(id, body.content);
        return { id };
      },
    };
    const lm = new LiveMessage(adapter, 'chan');
    lm.onEvent({ type: 'text', delta: 'Mrknu na to… ' }); // pre-tool narration opens the answer bubble FIRST (m1)
    lm.onEvent({ type: 'tool', name: 'Bash', detail: 'apt list --upgradable', icon: '💻' }); // tool bubble posts below (m2)
    lm.onEvent({ type: 'tool', name: 'Read', icon: '📄' });
    await new Promise((r) => setTimeout(r, 20));
    await lm.finalize('Hotovo, vše běží.');
    // Bubbles created in order: [stranded draft m1, tool trace m2, re-anchored answer m3].
    const [draftId, progressId, finalId] = posts;
    expect(deleted).toContain(draftId); // the draft stranded ABOVE the trace is deleted, not left buried in scrollback
    expect(edits.get(progressId)).toBe('💻 `Bash`: "apt list --upgradable"\n📄 `Read`'); // single \n = tight; finalize closes every row
    expect(edits.get(progressId)).not.toContain('\n\n');
    expect(edits.get(finalId)).toBe('Hotovo, vše běží.'); // final answer re-posted BELOW the trace, as the LAST message
  });

  it('summary mode (cfg.streamAnswer=false): tools stream live, the answer posts once at the end', async () => {
    const { LiveMessage } = await load();
    const posts: { id: string; content: string }[] = [];
    const edits = new Map<string, string>();
    let nextId = 0;
    const adapter = {
      cfg: { streamAnswer: false },
      rest: async (method: string, path: string, body: { content: string }) => {
        if (method === 'POST') { const id = `m${++nextId}`; posts.push({ id, content: body.content }); edits.set(id, body.content); return { id }; }
        const id = path.split('/').pop()!;
        edits.set(id, body.content);
        return { id };
      },
    };
    const lm = new LiveMessage(adapter, 'chan');
    lm.onEvent({ type: 'text', delta: 'Koukám se na to, hned…' }); // narration is NOT streamed live in summary mode
    lm.onEvent({ type: 'tool', name: 'Bash', detail: 'npm test', icon: '💻' }); // the tool trace DOES stream (m1)
    await new Promise((r) => setTimeout(r, 20));
    await lm.finalize('Hotovo — vše zelené.');
    // Exactly two messages: the live tool trace and the single final summary — no intermediate answer bubble.
    expect(posts).toHaveLength(2);
    expect(edits.get(posts[0]!.id)).toContain('Bash'); // tool trace streamed live
    expect(posts[1]!.content).toContain('Hotovo — vše zelené.'); // the summary posted once, below the trace
    expect(posts.some((p) => p.content.includes('Koukám se na to'))).toBe(false); // narration never became its own message
  });

  it('per_tool layout gives each tool its own editable bubble and keeps the final answer last', async () => {
    const { LiveMessage } = await load();
    const posts: { id: string; content: string }[] = [];
    const edits = new Map<string, string>();
    let nextId = 0;
    const adapter = {
      cfg: {},
      rest: async (method: string, path: string, body: { content: string }) => {
        const id = method === 'POST' ? `m${++nextId}` : path.split('/').pop()!;
        if (method === 'POST') posts.push({ id, content: body.content });
        edits.set(id, body.content);
        return { id };
      },
    };
    const lm = new LiveMessage(adapter, 'chan', undefined, undefined, { toolActivity: 'status', answerMode: 'final', toolOutput: 'summary', toolMessageMode: 'per_tool' });
    lm.onEvent({ type: 'tool', id: 'a', name: 'Read', detail: 'a.ts', icon: '📄' });
    lm.onEvent({ type: 'tool', id: 'b', name: 'Bash', detail: 'npm test', icon: '💻' });
    lm.onEvent({ type: 'tool_output', id: 'b', output: { title: 'console output', kind: 'console', text: 'ok', status: 'exit 0', tone: 'success' } });
    await lm.finalize('Hotovo.');
    expect(posts.map((p) => p.id)).toEqual(['m1', 'm2', 'm3']);
    expect(edits.get('m1')).toContain('Read');
    expect(edits.get('m1')).not.toContain('Bash');
    expect(edits.get('m2')).toContain('Bash');
    expect(edits.get('m3')).toBe('Hotovo.');
  });

  it('tracks a live command by id: running tail → completed summary, while answerMode=final posts once', async () => {
    vi.useFakeTimers();
    try {
      const { LiveMessage } = await load();
      const posts: string[] = [];
      const edits = new Map<string, string>();
      let nextId = 0;
      const adapter = { cfg: {}, rest: async (method: string, path: string, body: { content: string }) => {
        const id = method === 'POST' ? `m${++nextId}` : path.split('/').pop()!;
        if (method === 'POST') posts.push(id);
        edits.set(id, body.content);
        return { id };
      } };
      const lm = new LiveMessage(adapter, 'chan', 'trigger', 'user', { toolActivity: 'live', answerMode: 'final', toolOutput: 'tail' });
      lm.onEvent({ type: 'text', delta: 'working narration' });
      lm.onEvent({ type: 'tool', id: 'cmd1', name: 'Bash', detail: 'npm test', icon: '💻' });
      await vi.advanceTimersByTimeAsync(0);
      expect(edits.get('m1')).toContain('💻 `Bash`');
      expect(posts).toEqual(['m1']); // no answer draft in final mode

      lm.onEvent({ type: 'tool_progress', id: 'cmd1', text: 'PASS a.test\nPASS b.test' });
      await vi.advanceTimersByTimeAsync(1200);
      expect(edits.get('m1')).toContain('> PASS b.test');

      lm.onEvent({ type: 'tool_output', id: 'cmd1', output: { title: 'console output', kind: 'console', text: '44 tests passed', status: 'exit 0', tone: 'success' } });
      await lm.finalize('Hotovo.');
      expect(edits.get('m1')).toContain('💻 `Bash`');
      expect(edits.get('m1')).toContain('44 tests passed');
      expect(posts).toEqual(['m1', 'm2']);
      expect(edits.get('m2')).toContain('Hotovo.');
    } finally { vi.useRealTimers(); }
  });

  it('updates parallel tool rows by toolCallId and preserves independent success/error states', async () => {
    const { LiveMessage } = await load();
    const edits = new Map<string, string>();
    let nextId = 0;
    const adapter = { cfg: {}, rest: async (method: string, path: string, body: { content: string }) => {
      const id = method === 'POST' ? `m${++nextId}` : path.split('/').pop()!;
      edits.set(id, body.content); return { id };
    } };
    const lm = new LiveMessage(adapter, 'chan', undefined, undefined, { toolActivity: 'status', answerMode: 'final', toolOutput: 'summary' });
    lm.onEvent({ type: 'tool', id: 'a', name: 'Read', detail: 'a.ts', icon: '📄' });
    lm.onEvent({ type: 'tool', id: 'b', name: 'Bash', detail: 'npm test', icon: '💻' });
    lm.onEvent({ type: 'tool_output', id: 'b', output: { title: 'console output', kind: 'console', text: 'Test failed', status: 'exit 1', tone: 'warning' } });
    lm.onEvent({ type: 'tool_end', id: 'a' });
    await lm.finalize('Opravil jsem chybu.');
    expect(edits.get('m1')).toContain('📄 `Read`: "a.ts"');
    expect(edits.get('m1')).toContain('💻 `Bash`: "npm test" — exit 1');
  });

  it('bounds a long trace around the newest tools and neutralizes mentions from tool data', async () => {
    const { LiveMessage } = await load();
    const edits = new Map<string, string>();
    let nextId = 0;
    const adapter = { cfg: {}, rest: async (method: string, path: string, body: { content: string }) => {
      const id = method === 'POST' ? `m${++nextId}` : path.split('/').pop()!;
      edits.set(id, body.content); return { id };
    } };
    const lm = new LiveMessage(adapter, 'chan', undefined, undefined, { toolActivity: 'live', answerMode: 'final', toolOutput: 'tail' });
    for (let i = 0; i < 140; i++) lm.onEvent({ type: 'tool', id: `t${i}`, name: `tool_${i}`, detail: i === 139 ? '@everyone <@123>' : `item ${i}` });
    lm.onEvent({ type: 'tool_progress', id: 't139', text: '@here still running' });
    lm.onEvent({ type: 'tool_output', id: 't139', output: { title: 'tool result', kind: 'result', text: '@here done', tone: 'success' } });
    await lm.finalize('done');
    const trace = edits.get('m1')!;
    expect(trace.length).toBeLessThanOrEqual(1990);
    expect(trace).toContain('tool_139');
    expect(trace).not.toContain('tool_0`');
    expect(trace).not.toContain('@everyone');
    expect(trace).not.toContain('<@123>');
    expect(trace).not.toContain('@here');
  });

  it('a turn without tools posts only the answer', async () => {
    const { LiveMessage } = await load();
    const posts: string[] = [];
    const adapter = { rest: async (_m: string, _p: string, body: { content: string }) => { posts.push(body.content); return { id: `m${posts.length}` }; } };
    const lm = new LiveMessage(adapter, 'chan');
    lm.onEvent({ type: 'text', delta: 'Jen odpověď.' });
    await lm.finalize('Jen odpověď.');
    expect(posts).toEqual(['Jen odpověď.']);
  });

  it('consecutive repeats of one tool collapse into a ×N counter with the latest detail', async () => {
    const { LiveMessage } = await load();
    const edits = new Map<string, string>();
    let nextId = 0;
    const adapter = {
      rest: async (method: string, path: string, body: { content: string }) => {
        const id = method === 'POST' ? `m${++nextId}` : path.split('/').pop()!;
        edits.set(id, body.content);
        return { id };
      },
    };
    const lm = new LiveMessage(adapter, 'chan');
    // The icon now rides the tool event (daemon resolves it from the core map + plugin manifest icons);
    // the progress line renders event.icon and falls back to the generic wrench when absent.
    lm.onEvent({ type: 'tool', name: 'sarah_hair', detail: 'list_services', icon: '✂️' });
    lm.onEvent({ type: 'tool', name: 'sarah_hair', detail: 'list_bookings', icon: '✂️' });
    lm.onEvent({ type: 'tool', name: 'sarah_hair', icon: '✂️' }); // detail-less repeat keeps the latest detail
    lm.onEvent({ type: 'tool', name: 'Read', icon: '📄' });  // different tool → new line
    lm.onEvent({ type: 'tool', name: 'sarah_hair', icon: '✂️' }); // NON-consecutive → a fresh line, no merge back
    await new Promise((r) => setTimeout(r, 20));
    await lm.finalize('done');
    expect(edits.get('m1')).toBe('✂️ `sarah_hair`: "list_bookings" ×3\n📄 `Read`\n✂️ `sarah_hair`');
  });

  // Every real tool call carries a PI toolCallId — and the trace collapsed only calls that had none, so on
  // Discord a run of nine identical calls printed nine identical lines.
  it('collapses a run of the same tool even though every call carries its own id', async () => {
    const { LiveMessage } = await load();
    const edits = new Map<string, string>();
    let nextId = 0;
    const adapter = {
      rest: async (method: string, path: string, body: { content: string }) => {
        const id = method === 'POST' ? `m${++nextId}` : path.split('/').pop()!;
        edits.set(id, body.content);
        return { id };
      },
    };
    const lm = new LiveMessage(adapter, 'chan');
    let calls = 0;
    const call = (name: string, icon: string, detail?: string) =>
      lm.onEvent({ type: 'tool', id: `call-${++calls}`, name, icon, detail });
    call('sarah_hair_public', '✂️', 'dlouhá');
    call('sarah_hair_public', '✂️');
    call('sarah_hair_public', '✂️');
    call('todo_write', '📋');
    call('todo_write', '📋');
    call('sarah_hair', '✂️'); // a different tool → its own row, no merging back into the first run
    await new Promise((r) => setTimeout(r, 20));
    await lm.finalize('done');
    expect(edits.get('m1')).toBe('✂️ `sarah_hair_public`: "dlouhá" ×3\n📋 `todo_write` ×2\n✂️ `sarah_hair`');
  });

  // Folding is for rows that say nothing on their own. A result — or a failure — is the row's whole point.
  it('leaves a call that carries a result (or failed) on its own line', async () => {
    const { LiveMessage } = await load();
    const edits = new Map<string, string>();
    let nextId = 0;
    const adapter = {
      rest: async (method: string, path: string, body: { content: string }) => {
        const id = method === 'POST' ? `m${++nextId}` : path.split('/').pop()!;
        edits.set(id, body.content);
        return { id };
      },
    };
    const lm = new LiveMessage(adapter, 'chan');
    for (const id of ['a', 'b', 'c']) lm.onEvent({ type: 'tool', id, name: 'Read', icon: '📄' });
    lm.onEvent({ type: 'tool_output', id: 'b', output: { kind: 'result', tone: 'success', status: 'ok', text: '42 rows' } });
    lm.onEvent({ type: 'tool_output', id: 'c', output: { kind: 'result', tone: 'danger', status: 'needs attention', text: 'no such file' } });
    await new Promise((r) => setTimeout(r, 20));
    await lm.finalize('done');
    const trace = edits.get('m1')!;
    expect(trace).toContain('📄 `Read` — 42 rows');       // the one with a result keeps its line…
    expect(trace).toContain('📄 `Read` — needs attention'); // …as does the failure
    expect(trace.split('\n').filter((l) => l.startsWith('📄')).length).toBe(3); // and nothing is folded away
  });

  // The CLI transcript already folds a run of the SAME failure into one counted row; Discord matches it,
  // so three refusals that differ only by the path they name collapse instead of stacking three lines.
  it('folds a run of the same failure into one counted row', async () => {
    const { LiveMessage } = await load();
    const edits = new Map<string, string>();
    let nextId = 0;
    const adapter = {
      rest: async (method: string, path: string, body: { content: string }) => {
        const id = method === 'POST' ? `m${++nextId}` : path.split('/').pop()!;
        edits.set(id, body.content);
        return { id };
      },
    };
    const lm = new LiveMessage(adapter, 'chan');
    for (const id of ['a', 'b', 'c']) lm.onEvent({ type: 'tool', id, name: 'Read', icon: '📄' });
    for (const [id, path] of [['a', '/x/1.txt'], ['b', '/y/2.txt'], ['c', '/z/3.txt']] as const)
      lm.onEvent({ type: 'tool_output', id, output: { kind: 'result', tone: 'danger', status: 'needs attention', text: `no such file: ${path}` } });
    await new Promise((r) => setTimeout(r, 20));
    await lm.finalize('done');
    const trace = edits.get('m1')!;
    expect(trace.split('\n').filter((l) => l.startsWith('📄')).length).toBe(1); // three refusals → one row
    expect(trace).toContain('×3');
    expect(trace).toContain('needs attention');
  });

  it('renders a ctx.emitCard card in the progress bubble; an empty card removes it', async () => {
    const { LiveMessage } = await load();
    const mk = () => {
      const edits = new Map<string, string>();
      let nextId = 0;
      const adapter = { rest: async (method: string, path: string, body: { content: string }) => {
        const id = method === 'POST' ? `m${++nextId}` : path.split('/').pop()!;
        edits.set(id, body.content); return { id };
      } };
      return { edits, adapter };
    };
    // Present: a tool line + a card → the settled bubble (flushed on finalize) carries the card.
    const a = mk();
    const lmA = new LiveMessage(a.adapter, 'chan');
    lmA.onEvent({ type: 'tool', name: 'todo_write', icon: '📋' });
    lmA.onEvent({ type: 'card', card: { id: 'todos', title: 'Todos', pinned: true, items: [{ text: 'Alpha', status: 'completed' }, { text: 'Beta', status: 'in_progress' }] } });
    await new Promise((r) => setTimeout(r, 20));
    await lmA.finalize('done');
    const bubbleA = a.edits.get('m1')!;
    expect(bubbleA).toContain('📋 **Todos** (1/2)');
    expect(bubbleA).toContain('~~Alpha~~'); // completed struck through
    expect(bubbleA).toContain('🔸 Beta');   // in-progress
    // Remove: a later empty card (no items/body) drops it from the settled bubble.
    const b = mk();
    const lmB = new LiveMessage(b.adapter, 'chan');
    lmB.onEvent({ type: 'tool', name: 'todo_write', icon: '📋' });
    lmB.onEvent({ type: 'card', card: { id: 'todos', title: 'Todos', pinned: true, items: [{ text: 'Alpha' }] } });
    lmB.onEvent({ type: 'card', card: { id: 'todos', items: [] } });
    await new Promise((r) => setTimeout(r, 20));
    await lmB.finalize('done');
    expect(b.edits.get('m1')!).not.toContain('Todos');
  });

  it('the idle event yields a runtime footer under the final answer (opt-out via config)', async () => {
    const { LiveMessage, footerLine } = (await import(join(repoRoot, 'plugins/discord/index.mjs'))) as {
      LiveMessage: new (adapter: unknown, channelId: string) => { onEvent: (e: unknown) => void; finalize: (reply?: string) => Promise<void> };
      footerLine: (idle: unknown) => string;
    };
    // Unit: provider dropped (a chat footer is not where anyone picks a model or reconciles spend, so the
    // qualified identity stays in the CLI status line and the web pickers), percent rounded, missing data
    // → no fragment / empty line.
    expect(footerLine({ model: 'anthropic/claude-sonnet-5', usage: { percent: 41.6 } })).toBe('-# claude-sonnet-5 · 42 %');
    expect(footerLine({ model: 'gpt-5' })).toBe('-# gpt-5');
    expect(footerLine(null)).toBe('');
    // Integration: the footer rides the final message; cfg.runtimeFooter === false disables it.
    const mk = (cfg: Record<string, unknown>) => {
      const posts: string[] = [];
      const adapter = { cfg, rest: async (_m: string, _p: string, body: { content: string }) => { posts.push(body.content); return { id: `m${posts.length}` }; } };
      return { posts, adapter };
    };
    const on = mk({});
    const lmOn = new LiveMessage(on.adapter, 'chan');
    lmOn.onEvent({ type: 'idle', model: 'openai/gpt-5', usage: { percent: 12 } });
    await lmOn.finalize('Hotovo.');
    expect(on.posts).toEqual(['Hotovo.\n\n-# gpt-5 · 12 %']);
    const off = mk({ runtimeFooter: false });
    const lmOff = new LiveMessage(off.adapter, 'chan');
    lmOff.onEvent({ type: 'idle', model: 'openai/gpt-5', usage: { percent: 12 } });
    await lmOff.finalize('Hotovo.');
    expect(off.posts).toEqual(['Hotovo.']);
  });
});

describe('discord display settings', () => {
  it('defaults to live tool status + one final answer, while preserving legacy booleans', async () => {
    const { resolveDisplaySettings } = (await import(join(repoRoot, 'plugins/discord/index.mjs'))) as {
      resolveDisplaySettings: (cfg?: Record<string, unknown>, state?: Record<string, unknown>) => Record<string, unknown>;
    };
    expect(resolveDisplaySettings({})).toMatchObject({ toolActivity: 'status', answerMode: 'final', toolOutput: 'summary', toolMessageMode: 'single' });
    expect(resolveDisplaySettings({ streaming: true, streamAnswer: true })).toMatchObject({ toolActivity: 'status', answerMode: 'live' });
    expect(resolveDisplaySettings({ streaming: true, streamAnswer: false })).toMatchObject({ toolActivity: 'status', answerMode: 'final' });
    expect(resolveDisplaySettings({ streaming: false })).toMatchObject({ toolActivity: 'off', answerMode: 'final' });
  });

  it('lets each channel override one axis and reset it to the global default independently', async () => {
    const { resolveDisplaySettings, updateDisplayOverrides } = (await import(join(repoRoot, 'plugins/discord/index.mjs'))) as {
      resolveDisplaySettings: (cfg?: Record<string, unknown>, state?: Record<string, unknown>) => Record<string, unknown>;
      updateDisplayOverrides: (current: Record<string, string>, values: Record<string, string>) => Record<string, string>;
    };
    const cfg = { toolActivity: 'status', answerMode: 'final', toolOutput: 'summary' };
    const display = updateDisplayOverrides({}, { toolActivity: 'live', toolOutput: 'tail' });
    expect(resolveDisplaySettings(cfg, { display })).toMatchObject({ toolActivity: 'live', answerMode: 'final', toolOutput: 'tail', toolMessageMode: 'single' });
    const reset = updateDisplayOverrides(display, { toolActivity: 'default' });
    expect(resolveDisplaySettings(cfg, { display: reset })).toMatchObject({ toolActivity: 'status', answerMode: 'final', toolOutput: 'tail', toolMessageMode: 'single' });
  });

  it('/display persists operator-only channel overrides and reports the resolved policy', async () => {
    const { DiscordAdapter } = await import(join(repoRoot, 'plugins/discord/lib/adapter.mjs')) as { DiscordAdapter: new (...args: unknown[]) => any };
    const channels: Record<string, Record<string, unknown>> = {};
    const state = {
      get: (id: string) => channels[id] ?? {},
      patch: (id: string, fields: Record<string, unknown>) => { channels[id] = { ...(channels[id] ?? {}), ...fields }; },
    };
    const adapter = new DiscordAdapter(
      { language: 'en', toolActivity: 'status', answerMode: 'final', toolOutput: 'summary', rolePolicies: [{ roleId: 'ADMIN', admin: true }] },
      log, state, async () => [],
    );
    const replies: unknown[] = [];
    adapter.rest = async (_method: string, _path: string, body: unknown) => { replies.push(body); return {}; };
    await adapter.onInteraction({
      type: 2, id: 'I', token: 'T', channel_id: 'C', guild_id: 'G', member: { roles: ['ADMIN'] },
      data: { name: 'display', options: [{ name: 'tools', value: 'live' }, { name: 'output', value: 'tail' }, { name: 'layout', value: 'per_tool' }] },
    });
    expect(channels.C?.display).toEqual({ toolActivity: 'live', toolOutput: 'tail', toolMessageMode: 'per_tool' });
    expect(JSON.stringify(replies[0])).toContain('tools **live** · layout **per_tool** · answer **final** · output **tail**');
  });
});

// The daemon's single source of truth for the Discord surface (ctx.chatCommands('discord')). The adapter
// derives its registered slash-command LIST from this (passed LAZILY as a function), so registration tests
// must pass it in — and since the control set is derived too, `execution` is no longer decoration: drop it
// and the adapter correctly stops claiming /new. Copied field for field from
// `GET /brain/commands?surface=discord` (25 Aug), plus a trailing plugin prompt-command (kind:'prompt')
// that exercises the generic args option + RAW dispatch path.
const DISCORD_CHAT_COMMANDS = [
  { name: 'new', description: 'Start a fresh conversation', kind: 'action', execution: 'session-control' },
  { name: 'stop', description: 'Stop the running agent', kind: 'action', execution: 'session-control' },
  { name: 'status', description: 'Session info — model, context and usage', kind: 'info', execution: 'session-control' },
  { name: 'compact', description: 'Summarize the conversation to free up context (add text to steer what to keep)', kind: 'action', execution: 'session-control' },
  { name: 'model', description: 'Switch the AI model', kind: 'picker', execution: 'surface-local' },
  { name: 'context', description: 'Continue this channel in one of your conversations', kind: 'picker', execution: 'session-control' },
  { name: 'fast', description: 'Toggle OpenAI OAuth priority processing', kind: 'action', execution: 'session-control' },
  { name: 'reasoning', description: 'Set the reasoning effort · "show" toggles Thought rows', kind: 'picker', execution: 'surface-local' },
  { name: 'restart', description: 'Restart the Elowen daemon', kind: 'action', execution: 'session-control' },
  { name: 'help', description: 'Show the available commands', kind: 'info', execution: 'surface-local' },
  { name: 'deploy', description: 'Ship it to $1', kind: 'prompt', execution: 'plugin-prompt' },
];
const discordCommands = () => DISCORD_CHAT_COMMANDS;

describe('discord reasoning picker', () => {
  const makeAdapter = async (models: unknown[], initial: Record<string, unknown> = {}, language = 'en') => {
    const { DiscordAdapter } = await import(join(repoRoot, 'plugins/discord/lib/adapter.mjs')) as { DiscordAdapter: new (...args: unknown[]) => any };
    const channels: Record<string, Record<string, unknown>> = { C: initial };
    const state = {
      get: (id: string) => channels[id] ?? {},
      patch: (id: string, fields: Record<string, unknown>) => { channels[id] = { ...(channels[id] ?? {}), ...fields }; },
    };
    const adapter = new DiscordAdapter(
      { language, rolePolicies: [{ roleId: 'ADMIN', admin: true }] },
      log, state, async () => models, [], () => null, () => false, discordCommands,
    );
    const replies: unknown[] = [];
    adapter.rest = async (_method: string, _path: string, body: unknown) => { replies.push(body); return {}; };
    return { adapter, channels, replies };
  };

  it('registers /reasoning without a static universal choice list', async () => {
    const { adapter, replies } = await makeAdapter([]);
    adapter.appId = 'APP';
    await adapter.registerCommands();
    const commands = replies[0] as Array<{ name: string; options?: unknown[] }>;
    expect(commands.find((command) => command.name === 'reasoning')).toEqual({
      name: 'reasoning', description: 'Set the reasoning effort · "show" toggles Thought rows', type: 1,
    });
  });

  it('uses only the selected model capabilities and shows the supplied xhigh label as ultra', async () => {
    const models = [
      { provider: 'plain', providerLabel: 'Plain', model: 'chat-only' },
      {
        provider: 'oauth', providerLabel: 'OpenAI OAuth', model: 'gpt-5.4',
        reasoningLevels: ['low', 'medium', 'high', 'xhigh'],
        reasoningLabels: { low: 'low', medium: 'medium', high: 'high', xhigh: 'ultra' },
      },
    ];
    const { adapter, channels, replies } = await makeAdapter(models, {
      model: { provider: 'oauth', model: 'gpt-5.4' }, thinkingLevel: 'xhigh',
    });
    await adapter.onInteraction({
      type: 2, id: 'I', token: 'T', channel_id: 'C', guild_id: 'G', member: { roles: ['ADMIN'] }, data: { name: 'reasoning' },
    });
    const response = replies[0] as { type: number; data: { components: Array<{ components: Array<{ options: Array<{ label: string; value: string; default: boolean }> }> }> } };
    expect(response.type).toBe(4);
    expect(response.data.components[0]!.components[0]!.options).toEqual([
      { label: 'Default (model default)', value: 'default', default: false },
      { label: 'low', value: 'low', default: false },
      { label: 'medium', value: 'medium', default: false },
      { label: 'high', value: 'high', default: false },
      { label: 'ultra', value: 'xhigh', default: true },
    ]);

    replies.length = 0;
    await adapter.onInteraction({
      type: 3, id: 'I2', token: 'T2', channel_id: 'C', guild_id: 'G', member: { roles: ['ADMIN'] },
      data: { custom_id: 'pick_reasoning', values: ['xhigh'] },
    });
    expect(channels.C?.thinkingLevel).toBe('xhigh');
    expect(JSON.stringify(replies[0])).toContain('Reasoning effort set to **ultra**');
  });

  it('uses the daemon-resolved default when the channel has no model override', async () => {
    const models = [
      { provider: 'plain', providerLabel: 'Plain', model: 'catalog-first' },
      { provider: 'oauth', providerLabel: 'OAuth', model: 'actual-default', default: true, reasoningLevels: ['low'] },
    ];
    const { adapter, replies } = await makeAdapter(models);
    await adapter.onInteraction({
      type: 2, id: 'I', token: 'T', channel_id: 'C', guild_id: 'G', member: { roles: ['ADMIN'] }, data: { name: 'reasoning' },
    });
    expect(JSON.stringify(replies[0])).toContain('"value":"low"');

    replies.length = 0;
    await adapter.onInteraction({
      type: 2, id: 'I2', token: 'T2', channel_id: 'C', guild_id: 'G', member: { roles: ['ADMIN'] }, data: { name: 'model' },
    });
    const options = (replies[0] as { data: { components: Array<{ components: Array<{ options: Array<{ label: string; value: string; description: string; default: boolean }> }> }> } })
      .data.components[0]!.components[0]!.options;
    expect(options.find((option) => option.value === 'oauth::actual-default')).toMatchObject({
      label: 'OAuth / actual-default', description: 'oauth/actual-default', default: true,
    });
  });

  it('localizes the model-default reasoning reply', async () => {
    const models = [{ provider: 'oauth', providerLabel: 'OAuth', model: 'reasoner', default: true, reasoningLevels: ['low'] }];
    const { adapter, replies } = await makeAdapter(models, {}, 'cs');
    await adapter.onInteraction({
      type: 3, id: 'I', token: 'T', channel_id: 'C', guild_id: 'G', member: { roles: ['ADMIN'] },
      data: { custom_id: 'pick_reasoning', values: ['default'] },
    });
    expect(JSON.stringify(replies[0])).toContain('**výchozí**');
    expect(JSON.stringify(replies[0])).not.toContain('**default**');
  });

  it('clearly rejects a selected model without configurable reasoning in both locales', async () => {
    const models = [
      { provider: 'oauth', providerLabel: 'OpenAI OAuth', model: 'gpt-5.4', reasoningLevels: ['low', 'high'] },
      { provider: 'plain', providerLabel: 'Plain', model: 'chat-only' },
    ];
    for (const [language, message] of [
      ['en', 'does not support configurable reasoning effort'],
      ['cs', 'nepodporuje nastavitelnou úroveň uvažování'],
    ] as const) {
      const { adapter, replies } = await makeAdapter(models, { model: { provider: 'plain', model: 'chat-only' } }, language);
      await adapter.onInteraction({
        type: 2, id: 'I', token: 'T', channel_id: 'C', guild_id: 'G', member: { roles: ['ADMIN'] }, data: { name: 'reasoning' },
      });
      const response = replies[0] as { data: { content: string; components?: unknown[] } };
      expect(response.data.content).toContain(message);
      expect(response.data.components).toBeUndefined();
    }
  });

  it('revalidates component values against current model capabilities before persisting', async () => {
    const models = [{
      provider: 'oauth', providerLabel: 'OpenAI OAuth', model: 'gpt-5.4',
      reasoningLevels: ['low', 'high'], reasoningLabels: { low: 'low', high: 'high' },
    }];
    const { adapter, channels, replies } = await makeAdapter(models, {
      model: { provider: 'oauth', model: 'gpt-5.4' }, thinkingLevel: 'low',
    });
    await adapter.onInteraction({
      type: 3, id: 'I', token: 'T', channel_id: 'C', guild_id: 'G', member: { roles: ['ADMIN'] },
      data: { custom_id: 'pick_reasoning', values: ['xhigh'] },
    });
    expect(channels.C?.thinkingLevel).toBe('low');
    expect(JSON.stringify(replies[0])).toContain('does not support configurable reasoning effort');
  });

  it('keeps explicit off distinct from the model default', async () => {
    const models = [{
      provider: 'oauth', providerLabel: 'OAuth', model: 'reasoner',
      reasoningLevels: ['off', 'low', 'high'],
    }];
    const { adapter, channels } = await makeAdapter(models, { model: { provider: 'oauth', model: 'reasoner' } });
    await adapter.onInteraction({
      type: 3, id: 'I-off', token: 'T-off', channel_id: 'C', guild_id: 'G', member: { roles: ['ADMIN'] },
      data: { custom_id: 'pick_reasoning', values: ['off'] },
    });
    expect(channels.C?.thinkingLevel).toBe('off');
  });
});

describe('discord /fast capability gate', () => {
  const makeAdapter = async (models: unknown[], initial: Record<string, unknown> = {}, commands = discordCommands) => {
    const { DiscordAdapter } = await import(join(repoRoot, 'plugins/discord/lib/adapter.mjs')) as { DiscordAdapter: new (...args: unknown[]) => any };
    const channels: Record<string, Record<string, unknown>> = { C: initial };
    const state = {
      get: (id: string) => channels[id] ?? {},
      patch: (id: string, fields: Record<string, unknown>) => { channels[id] = { ...(channels[id] ?? {}), ...fields }; },
    };
    const adapter = new DiscordAdapter(
      { language: 'en', rolePolicies: [{ roleId: 'ADMIN', admin: true }] },
      log, state, async () => models, [], () => null, () => false, commands,
    );
    const replies: unknown[] = [];
    adapter.rest = async (_method: string, _path: string, body: unknown) => { replies.push(body); return {}; };
    return { adapter, channels, replies };
  };

  /** Discord used to assert `fastEnabled: true` into the shared core, so it would have run /fast even for
   *  a daemon that never published it — the one surface where publication was NOT the answer. It derives
   *  the control set from the catalog now, so an omitted /fast is simply not one of ours: no state change
   *  and no invented reply. It cannot be reached in practice either, since registration comes from the
   *  same catalog; this pins the dispatch half so the two cannot part ways again. */
  it('does not claim /fast when the daemon has not published it for this surface', async () => {
    const models = [{ provider: 'oauth', providerLabel: 'OpenAI OAuth', model: 'gpt-5.4', fastAvailable: true }];
    const withoutFast = () => discordCommands().filter((c) => c.name !== 'fast');
    const { adapter, channels, replies } = await makeAdapter(models, { model: { provider: 'oauth', model: 'gpt-5.4' } }, withoutFast);
    adapter.control({ status: () => null, setFast: () => ({ fast: true, fastAvailable: true }) });

    await adapter.onInteraction({
      type: 2, id: 'I', token: 'T', channel_id: 'C', guild_id: 'G', member: { roles: ['ADMIN'] }, data: { name: 'fast' },
    });
    expect(replies).toEqual([]);
    expect(channels.C?.fast).toBeUndefined();
  });

  it('does not let a stale OAuth live session enable fast for a selected non-OAuth model', async () => {
    const models = [{ provider: 'plain', providerLabel: 'Plain', model: 'chat-only' }];
    const { adapter, channels, replies } = await makeAdapter(models, {
      model: { provider: 'plain', model: 'chat-only' }, fast: false,
    });
    const setFast = vi.fn(() => ({ fast: true, fastAvailable: true }));
    adapter.control({
      status: () => ({ provider: 'oauth', model: 'gpt-5.4', streaming: false, usage: {}, fast: false, fastAvailable: true }),
      setFast,
    });

    await adapter.onInteraction({
      type: 2, id: 'I', token: 'T', channel_id: 'C', guild_id: 'G', member: { roles: ['ADMIN'] }, data: { name: 'fast' },
    });
    expect(setFast).not.toHaveBeenCalled();
    expect(channels.C?.fast).toBe(false);
    expect(JSON.stringify(replies[0])).toContain('available only with an OpenAI OAuth model');
  });

  it('persists Fast for a newly selected OAuth model without asking the stale non-OAuth live session', async () => {
    const models = [{ provider: 'oauth', providerLabel: 'OpenAI OAuth', model: 'gpt-5.4', fastAvailable: true }];
    const { adapter, channels } = await makeAdapter(models, { model: { provider: 'oauth', model: 'gpt-5.4' }, fast: false });
    const setFast = vi.fn(() => ({ fast: false, fastAvailable: false }));
    adapter.control({
      status: () => ({ provider: 'plain', model: 'chat-only', streaming: false, usage: {}, fast: false, fastAvailable: false }),
      setFast,
    });

    await adapter.onInteraction({
      type: 2, id: 'I', token: 'T', channel_id: 'C', guild_id: 'G', member: { roles: ['ADMIN'] },
      data: { name: 'fast', options: [{ name: 'state', value: 'on' }] },
    });

    expect(setFast).not.toHaveBeenCalled();
    expect(channels.C?.fast).toBe(true);
  });

  it('toggles fast for an OAuth model and allows stale state to be disabled elsewhere', async () => {
    const models = [
      { provider: 'oauth', providerLabel: 'OpenAI OAuth', model: 'gpt-5.4', fastAvailable: true },
      { provider: 'plain', providerLabel: 'Plain', model: 'chat-only' },
    ];
    const { adapter, channels, replies } = await makeAdapter(models, {
      model: { provider: 'oauth', model: 'gpt-5.4' }, fast: false,
    });
    const setFast = vi.fn((_ref: unknown, on?: boolean) => ({ fast: on === true, fastAvailable: true }));
    adapter.control({
      status: () => ({ provider: 'oauth', model: 'gpt-5.4', streaming: false, usage: {}, fast: false, fastAvailable: true }),
      setFast,
    });

    await adapter.onInteraction({
      type: 2, id: 'I1', token: 'T1', channel_id: 'C', guild_id: 'G', member: { roles: ['ADMIN'] },
      data: { name: 'fast', options: [{ name: 'state', value: 'on' }] },
    });
    expect(setFast).toHaveBeenCalledWith({ platform: 'discord', channelId: 'C#0' }, true);
    expect(channels.C?.fast).toBe(true);
    expect(JSON.stringify(replies.at(-1))).toContain('Fast mode **on**');

    channels.C = { model: { provider: 'plain', model: 'chat-only' }, fast: true };
    setFast.mockClear();
    await adapter.onInteraction({
      type: 2, id: 'I2', token: 'T2', channel_id: 'C', guild_id: 'G', member: { roles: ['ADMIN'] },
      data: { name: 'fast', options: [{ name: 'state', value: 'off' }] },
    });
    expect(setFast).not.toHaveBeenCalled();
    expect(channels.C?.fast).toBe(false);
    expect(JSON.stringify(replies.at(-1))).toContain('Fast mode **off**');
  });

  it('clears fast when the model picker moves the channel away from OpenAI OAuth', async () => {
    const models = [
      { provider: 'oauth', providerLabel: 'OpenAI OAuth', model: 'gpt-5.4', fastAvailable: true },
      { provider: 'plain', providerLabel: 'Plain', model: 'chat-only' },
    ];
    const { adapter, channels } = await makeAdapter(models, {
      model: { provider: 'oauth', model: 'gpt-5.4' }, fast: true,
    });
    await adapter.onInteraction({
      type: 3, id: 'I', token: 'T', channel_id: 'C', guild_id: 'G', member: { roles: ['ADMIN'] },
      data: { custom_id: 'pick_model', values: ['plain::chat-only'] },
    });
    expect(channels.C).toMatchObject({ model: { provider: 'plain', model: 'chat-only' }, fast: false });
  });
});

describe('discord answer streaming (live reply edits, two-bubble model)', () => {
  interface Ev { type: string; name?: string; detail?: string; icon?: string; delta?: string; model?: string; usage?: { percent: number } }
  const load = async () => (await import(join(repoRoot, 'plugins/discord/index.mjs'))) as {
    LiveMessage: new (adapter: unknown, channelId: string, replyToId?: string) => {
      onEvent: (e: Ev) => void; finalize: (reply?: string) => Promise<void>; abandon: () => void;
    };
  };
  interface Call { method: string; id: string; content: string }
  const mk = (cfg?: Record<string, unknown>) => {
    const calls: Call[] = [];
    const posts: string[] = [];
    const edits = new Map<string, string>();
    let nextId = 0;
    const adapter = {
      cfg: { answerMode: 'live', ...(cfg ?? {}) },
      rest: async (method: string, path: string, body?: { content?: string }) => {
        const content = body?.content ?? '';
        if (method === 'POST') { const id = `m${++nextId}`; posts.push(id); edits.set(id, content); calls.push({ method, id, content }); return { id }; }
        const id = path.split('/').pop()!;
        if (method === 'PATCH') edits.set(id, content);
        calls.push({ method, id, content });
        return { id };
      },
    };
    return { calls, posts, edits, adapter };
  };

  it('streams the answer into ONE message, PATCHing progressively; the trailing delta lands via the throttle timer', async () => {
    vi.useFakeTimers();
    try {
      const { LiveMessage } = await load();
      const { posts, edits, adapter } = mk();
      const lm = new LiveMessage(adapter, 'chan');
      lm.onEvent({ type: 'text', delta: 'Hello' });   // first delta → immediate POST
      await vi.advanceTimersByTimeAsync(0);
      expect(posts).toEqual(['m1']);
      expect(edits.get('m1')).toBe('Hello');
      lm.onEvent({ type: 'text', delta: ' world' });  // inside the throttle window → deferred
      lm.onEvent({ type: 'text', delta: '!' });        // still inside → coalesced with the above
      expect(edits.get('m1')).toBe('Hello');           // nothing landed yet — throttled
      await vi.advanceTimersByTimeAsync(1200);          // the self-rescheduled trailing flush fires
      expect(posts).toEqual(['m1']);                    // still exactly ONE answer message
      expect(edits.get('m1')).toBe('Hello world!');     // coalesced to the latest content
    } finally { vi.useRealTimers(); }
  });

  it('keeps the tool bubble tool-only, then re-anchors the answer BELOW it so the final answer is LAST', async () => {
    vi.useFakeTimers();
    try {
      const { LiveMessage } = await load();
      const { calls, adapter } = mk();
      const lm = new LiveMessage(adapter, 'chan');
      lm.onEvent({ type: 'text', delta: 'Let me check. ' }); // narration opens the answer draft FIRST (m1)
      await vi.advanceTimersByTimeAsync(0);
      lm.onEvent({ type: 'tool', name: 'Read', icon: '📄' }); // tool bubble posts below (m2) → answer stranded above
      await vi.advanceTimersByTimeAsync(0);
      lm.onEvent({ type: 'text', delta: 'Found it.' }); // streams live into the stranded draft during the turn
      await vi.advanceTimersByTimeAsync(1300);
      await lm.finalize('Found it.');
      const tools = calls.filter((c) => c.id === 'm2');   // the tool bubble
      expect(tools.length).toBeGreaterThan(0);
      expect(tools.every((c) => c.content.includes('Read'))).toBe(true); // tool bubble only ever holds tool lines
      expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.id)).toContain('m1'); // stranded draft deleted
      const posts = calls.filter((c) => c.method === 'POST').map((c) => c.id);
      const finalId = posts.at(-1)!; // the answer re-posted LAST, below the trace
      expect(finalId).not.toBe('m1');
      const finalBubble = calls.filter((c) => c.id === finalId);
      expect(finalBubble.every((c) => !c.content.includes('Read'))).toBe(true); // never gets tool lines
      expect(finalBubble.at(-1)!.content).toBe('Found it.'); // authoritative reply, as the channel's LAST message
    } finally { vi.useRealTimers(); }
  });

  it('overflows a long answer into a code-fence-aware continuation message', async () => {
    vi.useFakeTimers();
    try {
      const { LiveMessage } = await load();
      const { posts, edits, adapter } = mk();
      const lm = new LiveMessage(adapter, 'chan');
      const big = '```js\n' + 'const x = 1;\n'.repeat(300) + '```'; // > 1990 chars, one open fence
      lm.onEvent({ type: 'text', delta: big });
      await vi.advanceTimersByTimeAsync(1300);
      await lm.finalize(big);
      expect(posts.length).toBeGreaterThanOrEqual(2); // split across ≥2 answer bubbles
      for (const id of posts) {
        const c = edits.get(id)!;
        expect(c.length).toBeLessThanOrEqual(2100);
        expect((c.match(/```/g)?.length ?? 0) % 2).toBe(0); // every bubble has balanced fences
      }
      expect(posts.map((id) => edits.get(id)).join('')).toContain('const x = 1;');
    } finally { vi.useRealTimers(); }
  });

  it('finalize replaces the streamed draft with the returned reply and appends the footer once', async () => {
    vi.useFakeTimers();
    try {
      const { LiveMessage } = await load();
      const { edits, adapter } = mk({});
      const lm = new LiveMessage(adapter, 'chan');
      lm.onEvent({ type: 'text', delta: 'streamed draft that will be replaced' });
      lm.onEvent({ type: 'idle', model: 'openai/gpt-5', usage: { percent: 30 } });
      await vi.advanceTimersByTimeAsync(1300);
      await lm.finalize('Final clean answer.');
      expect(edits.get('m1')).toBe('Final clean answer.\n\n-# gpt-5 · 30 %'); // reply wins over the draft, footer once
    } finally { vi.useRealTimers(); }
  });

  it('abandon() freezes both bubbles — no edit lands after the error reply', async () => {
    vi.useFakeTimers();
    try {
      const { LiveMessage } = await load();
      const { calls, adapter } = mk();
      const lm = new LiveMessage(adapter, 'chan');
      lm.onEvent({ type: 'text', delta: 'partial answer' });
      lm.onEvent({ type: 'tool', name: 'Read', icon: '📄' });
      await vi.advanceTimersByTimeAsync(0);
      lm.onEvent({ type: 'text', delta: ' more text' }); // queued behind the throttle
      lm.onEvent({ type: 'tool', name: 'Read', icon: '📄' }); // queued behind the throttle
      lm.abandon();
      const before = calls.length;
      await vi.advanceTimersByTimeAsync(5000); // any armed trailing flush would fire in here
      expect(calls.length).toBe(before); // both bubbles frozen — nothing landed
    } finally { vi.useRealTimers(); }
  });

  it('the first answer bubble is a real reply to the triggering message; continuations are plain', async () => {
    vi.useFakeTimers();
    try {
      const { LiveMessage } = await load();
      const refs: (unknown)[] = [];
      let nextId = 0;
      const adapter = {
        cfg: { answerMode: 'live' },
        rest: async (method: string, _path: string, body?: { message_reference?: unknown }) => {
          if (method === 'POST') { refs.push(body?.message_reference); return { id: `m${++nextId}` }; }
          return { id: 'x' };
        },
      };
      const lm = new LiveMessage(adapter, 'chan', 'TRIGGER');
      lm.onEvent({ type: 'text', delta: 'answer text' });
      await vi.advanceTimersByTimeAsync(0);
      expect(refs[0]).toEqual({ message_id: 'TRIGGER', fail_if_not_exists: false }); // reply ref rides the first POST
    } finally { vi.useRealTimers(); }
  });

  it('retries a failed final PATCH instead of freezing the answer at the mid-stream draft (#2)', async () => {
    const { LiveMessage } = await load();
    const edits = new Map<string, string>();
    let nextId = 0;
    let failNextPatch = false;
    let patchAttempts = 0;
    const adapter = {
      cfg: { answerMode: 'live' },
      rest: async (method: string, path: string, body?: { content?: string }) => {
        if (method === 'POST') { const id = `m${++nextId}`; edits.set(id, body?.content ?? ''); return { id }; }
        if (method === 'PATCH') {
          patchAttempts++;
          if (failNextPatch) { failNextPatch = false; throw new Error('429 rate limited'); } // one transient blip
          edits.set(path.split('/').pop()!, body?.content ?? '');
        }
        return { id: 'x' };
      },
    };
    const lm = new LiveMessage(adapter, 'chan');
    lm.onEvent({ type: 'text', delta: 'streamed draft' });
    await new Promise((r) => setTimeout(r, 20)); // the draft POSTs as m1
    failNextPatch = true;                         // the finalize settle's FIRST PATCH hits a 429
    await lm.finalize('Final clean answer.');
    expect(patchAttempts).toBe(2);                         // first PATCH threw and was swallowed → retried once
    expect(edits.get('m1')).toBe('Final clean answer.');   // authoritative reply landed, NOT frozen at the draft
  });

  it('an image-only reply deletes the streamed raw-markdown draft instead of freezing it (#4)', async () => {
    const { LiveMessage } = await load();
    const calls: { method: string; id: string; content: string }[] = [];
    let uploads = 0;
    let nextId = 0;
    const adapter = {
      cfg: { answerMode: 'live' },
      resolveImageFiles: (names: string[]) => names.map((n) => ({ name: n, blob: new Uint8Array([1]) })),
      uploadImages: async () => { uploads++; },
      rest: async (method: string, path: string, body?: { content?: string }) => {
        if (method === 'POST') { const id = `m${++nextId}`; calls.push({ method, id, content: body?.content ?? '' }); return { id }; }
        const id = path.split('/').pop()!;
        calls.push({ method, id, content: body?.content ?? '' });
        return { id };
      },
    };
    const lm = new LiveMessage(adapter, 'chan');
    // The model streams text that is ONLY a generated-image link → a StreamingAnswer bubble is created
    // holding raw markdown, which is dead text on Discord.
    lm.onEvent({ type: 'text', delta: '![kočka](/api/brain/images/abc123.png)' });
    await new Promise((r) => setTimeout(r, 20)); // the draft bubble (m1) is POSTed
    await lm.finalize('![kočka](/api/brain/images/abc123.png)');
    expect(uploads).toBe(1); // the image rode its own upload
    // The raw-markdown draft is DELETED, not left frozen above the standalone image.
    expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.id)).toContain('m1');
  });

  it('deletes a leftover continuation bubble whose create POST is still in flight at finalize (#7)', async () => {
    vi.useFakeTimers();
    try {
      const { LiveMessage } = await load();
      const calls: { method: string; id: string }[] = [];
      let nextId = 0;
      const adapter = {
        cfg: { answerMode: 'live' },
        rest: (method: string, path: string) => {
          if (method === 'POST') {
            const id = `m${++nextId}`;
            calls.push({ method, id });
            // bubble0 (m1) posts instantly; the continuation's create (m2) is slow → still in flight at finalize.
            return new Promise<{ id: string }>((res) => setTimeout(() => res({ id }), id === 'm2' ? 50 : 0));
          }
          const id = path.split('/').pop()!;
          calls.push({ method, id });
          return Promise.resolve({ id });
        },
      };
      const lm = new LiveMessage(adapter, 'chan');
      const big = 'A'.repeat(1990) + '\n' + 'B'.repeat(500); // splits into 2 answer bubbles
      lm.onEvent({ type: 'text', delta: big });
      await vi.advanceTimersByTimeAsync(0);  // bubble0 (m1) resolves; bubble1's POST (m2) fires, in flight (+50ms)
      const done = lm.finalize('short');     // final reply is 1 piece → bubble1 (m2) is a leftover to delete
      await vi.advanceTimersByTimeAsync(0);  // finalize settles bubble0, reaches the leftover loop, awaits bubble1.sending
      await vi.advanceTimersByTimeAsync(60); // bubble1's in-flight POST resolves → deleteBubble now knows m2 and DELETEs it
      await done;
      expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.id)).toContain('m2'); // no orphan mid-stream chunk left
    } finally { vi.useRealTimers(); }
  });

  it('serializes continuation-bubble creates so split pieces post in channel order (#9)', async () => {
    const { LiveMessage } = await load();
    const initiated: string[] = []; // POST ids in the order they are actually SENT
    const queue: Array<() => void> = [];
    let nextId = 0;
    const adapter = {
      cfg: { answerMode: 'live' },
      rest: (method: string, path: string) => {
        if (method === 'POST') {
          const id = `m${++nextId}`;
          initiated.push(id);
          return new Promise<{ id: string }>((res) => queue.push(() => res({ id }))); // gated: resolve on demand
        }
        return Promise.resolve({ id: path.split('/').pop()! });
      },
    };
    const tick = () => new Promise((r) => setTimeout(r, 0));
    const lm = new LiveMessage(adapter, 'chan');
    // One big delta that splits into THREE pieces → bubble0,1,2 are created in a SINGLE update() call.
    const big = 'A'.repeat(1990) + '\n' + 'B'.repeat(1990) + '\n' + 'C'.repeat(500);
    lm.onEvent({ type: 'text', delta: big });
    await tick();
    expect(initiated).toEqual(['m1']);              // serialized: only bubble0's create is in flight
    queue.shift()!(); await tick();
    expect(initiated).toEqual(['m1', 'm2']);         // bubble1's create fires only AFTER bubble0's resolves
    queue.shift()!(); await tick();
    expect(initiated).toEqual(['m1', 'm2', 'm3']);   // bubble2's create fires only AFTER bubble1's — order preserved
    queue.shift()!(); await tick();                  // drain the last so no dangling promise
  });

  it('text→tool→text→tool→text yields exactly ONE final answer, BELOW the trace, no duplicates (#3)', async () => {
    vi.useFakeTimers();
    try {
      const { LiveMessage } = await load();
      const { calls, adapter } = mk();
      const lm = new LiveMessage(adapter, 'chan');
      lm.onEvent({ type: 'text', delta: 'First. ' });             // answer draft m1
      await vi.advanceTimersByTimeAsync(0);
      lm.onEvent({ type: 'tool', name: 'Read', icon: '📄' }); // tool bubble m2 → answer stranded above
      await vi.advanceTimersByTimeAsync(0);
      lm.onEvent({ type: 'text', delta: 'Second. ' });
      await vi.advanceTimersByTimeAsync(1300);
      lm.onEvent({ type: 'tool', name: 'Bash', icon: '💻' }); // same single trace bubble m2
      await vi.advanceTimersByTimeAsync(0);
      lm.onEvent({ type: 'text', delta: 'Third.' });
      await vi.advanceTimersByTimeAsync(1300);
      await lm.finalize('The complete answer.');
      expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.id)).toContain('m1'); // stranded draft removed
      const answered = new Set(calls.filter((c) => c.content === 'The complete answer.').map((c) => c.id));
      expect(answered.size).toBe(1);                 // exactly one bubble carries the final answer — no duplicates
      expect(answered.has('m1')).toBe(false);        // and it is NOT the stranded draft
      const finalId = [...answered][0];
      const posts = calls.filter((c) => c.method === 'POST').map((c) => c.id);
      expect(posts.indexOf(finalId)).toBeGreaterThan(posts.indexOf('m2')); // answer posted AFTER the tool trace
    } finally { vi.useRealTimers(); }
  });
});

describe('discord reasoning stream (off by default, opt-in via cfg.showReasoning)', () => {
  const load = async () => (await import(join(repoRoot, 'plugins/discord/index.mjs'))) as {
    LiveMessage: new (adapter: unknown, channelId: string) => { onEvent: (e: unknown) => void; finalize: (reply?: string) => Promise<void> };
  };
  const mk = (cfg?: Record<string, unknown>) => {
    const edits = new Map<string, string>();
    let nextId = 0;
    const adapter = {
      cfg,
      rest: async (method: string, path: string, body: { content: string }) => {
        const id = method === 'POST' ? `m${++nextId}` : path.split('/').pop()!;
        edits.set(id, body.content);
        return { id };
      },
    };
    return { edits, adapter };
  };

  it('drops reasoning entirely with no config (never opens a progress bubble)', async () => {
    const { LiveMessage } = await load();
    const { edits, adapter } = mk();
    const lm = new LiveMessage(adapter, 'chan');
    lm.onEvent({ type: 'reasoning', delta: 'thinking hard about it' });
    await new Promise((r) => setTimeout(r, 20));
    await lm.finalize('Answer.');
    expect([...edits.values()]).toEqual(['Answer.']); // only the answer, no reasoning bubble
  });

  it('streams reasoning into the progress bubble when cfg.showReasoning is on', async () => {
    const { LiveMessage } = await load();
    const { edits, adapter } = mk({ showReasoning: true });
    const lm = new LiveMessage(adapter, 'chan');
    lm.onEvent({ type: 'reasoning', delta: 'let me reason ' });
    lm.onEvent({ type: 'reasoning', delta: 'about this' });
    await new Promise((r) => setTimeout(r, 20));
    await lm.finalize('Answer.');
    expect(edits.get('m1')).toContain('💭'); // reasoning surfaced in the progress bubble
    expect(edits.get('m1')).toContain('let me reason about this');
  });
});

describe('discord stripForSpeech (markdown → plain prose for TTS)', () => {
  it('strips code, links, images and md punctuation into speakable text', async () => {
    const { stripForSpeech } = await import(join(repoRoot, 'plugins/discord/index.mjs')) as { stripForSpeech: (s: string) => string };
    expect(stripForSpeech('# Nadpis\n**tučně** a `kód`')).toBe('Nadpis tučně a kód');
    expect(stripForSpeech('viz [odkaz](https://x.io) tady')).toBe('viz odkaz tady');
    expect(stripForSpeech('```js\nconst x=1\n```\nhotovo')).toBe('hotovo');
    expect(stripForSpeech('čistý http://a.b/c konec')).toBe('čistý konec');
    expect(stripForSpeech('')).toBe('');
  });
});

describe('discord memberIsAdmin (operator-only picker gate)', () => {
  it('is true only for a member holding a role mapped admin:true', async () => {
    const { memberIsAdmin } = await import(join(repoRoot, 'plugins/discord/index.mjs')) as { memberIsAdmin: (r: unknown, p: unknown) => boolean };
    const policies = [
      { roleId: 'r-admin', admin: true, projectIds: [] },
      { roleId: 'r-user', projectIds: [1] },
    ];
    expect(memberIsAdmin(['r-admin'], policies)).toBe(true);
    expect(memberIsAdmin(['r-user'], policies)).toBe(false);       // mapped, but not admin
    expect(memberIsAdmin(['r-user', 'r-admin'], policies)).toBe(true);
    expect(memberIsAdmin(['r-nobody'], policies)).toBe(false);     // unmapped role
    expect(memberIsAdmin([], policies)).toBe(false);
    expect(memberIsAdmin(['r-admin'], undefined)).toBe(false);     // no policies configured
  });
});

// A `*` policy matches a member carrying NO roles on purpose: `member.roles` omits @everyone, so a plain
// guild member arrives with an empty list and a wildcard resolved only through that list would skip
// precisely the people it exists to cover. `onInteraction` had none of onMessage's origin guards, which
// turned that exception into a hole: in a DM `i.member` is undefined, was read as "a member with no
// roles", and the wildcard answered every operator gate — /model, /restart, answering someone else's
// parked question — while `dispatchSlashPrompt` handed the stranger a full turn with the wildcard's scope.
describe('discord interaction origin guard (a DM interaction is not a guild member)', () => {
  const makeAdapter = async (cfg: Record<string, unknown> = {}) => {
    const { DiscordAdapter } = await import(join(repoRoot, 'plugins/discord/lib/adapter.mjs')) as { DiscordAdapter: new (...args: unknown[]) => any };
    const channels: Record<string, Record<string, unknown>> = {};
    const state = {
      get: (id: string) => channels[id] ?? {},
      patch: (id: string, fields: Record<string, unknown>) => { channels[id] = { ...(channels[id] ?? {}), ...fields }; },
    };
    const adapter = new DiscordAdapter(
      { language: 'en', rolePolicies: [{ roleId: '*', admin: true, name: 'everyone' }], ...cfg },
      log, state, async () => [{ provider: 'p', providerLabel: 'Prov', model: 'm' }], [], () => null, () => false, discordCommands,
    );
    const rest: { method: string; path: string; body: any }[] = [];
    adapter.rest = async (method: string, path: string, body: unknown) => { rest.push({ method, path, body }); return {}; };
    const turns: string[] = [];
    adapter.handler = async (_src: unknown, text: string) => { turns.push(text); return 'done'; };
    return { adapter, channels, rest, turns };
  };

  it('ignores a DM slash command under a wildcard admin policy — no picker, no state change', async () => {
    const { adapter, channels, rest } = await makeAdapter();
    // A DM interaction: Discord sends `user`, never `member`, and no guild_id.
    await adapter.onInteraction({ type: 2, id: 'I', token: 'T', channel_id: 'DM', user: { id: 'STRANGER' }, data: { name: 'model' } });
    expect(rest).toEqual([]);
    expect(channels.DM).toBeUndefined();
  });

  it('ignores a DM prompt-command — a stranger gets no brain turn', async () => {
    const { adapter, rest, turns } = await makeAdapter();
    await adapter.onInteraction({
      type: 2, id: 'I', token: 'T', channel_id: 'DM', user: { id: 'STRANGER' },
      data: { name: 'deploy', options: [{ name: 'args', value: 'prod' }] },
    });
    expect(turns).toEqual([]);
    expect(rest).toEqual([]);
  });

  it('ignores a DM component interaction answering someone else\'s parked question', async () => {
    const { adapter, rest } = await makeAdapter();
    const settled: string[] = [];
    adapter.answerQuestion = (id: string) => { settled.push(id); return true; };
    adapter.pendingAsks.set('Q', {
      channelId: 'C', messageId: 'M', askerId: 'OWNER', selected: {}, awaitingText: false, title: 't', desc: 'd',
      questions: [{ header: 'h', question: 'q', options: [{ label: 'yes' }, { label: 'no' }] }],
    });
    await adapter.onInteraction({ type: 3, id: 'I', token: 'T', channel_id: 'DM', user: { id: 'STRANGER' }, data: { custom_id: 'ask:Q:0:0' } });
    expect(settled).toEqual([]);
    expect(adapter.pendingAsks.has('Q')).toBe(true);
    expect(rest).toEqual([]);
  });

  it('ignores an interaction from another guild when a guildId is configured', async () => {
    const { adapter, rest } = await makeAdapter({ guildId: 'HOME' });
    await adapter.onInteraction({ type: 2, id: 'I', token: 'T', channel_id: 'C', guild_id: 'ELSEWHERE', member: { roles: [], user: { id: 'U' } }, data: { name: 'model' } });
    expect(rest).toEqual([]);
  });

  it('ignores an interaction from a bot member', async () => {
    const { adapter, rest } = await makeAdapter();
    await adapter.onInteraction({ type: 2, id: 'I', token: 'T', channel_id: 'C', guild_id: 'G', member: { roles: [], user: { id: 'B', bot: true } }, data: { name: 'model' } });
    expect(rest).toEqual([]);
  });

  it('still serves a guild member holding NO roles through the wildcard policy', async () => {
    // The exception the hole grew out of stays intact where it is justified: in the guild.
    const { adapter, rest } = await makeAdapter();
    await adapter.onInteraction({ type: 2, id: 'I', token: 'T', channel_id: 'C', guild_id: 'G', member: { roles: [], user: { id: 'U' } }, data: { name: 'model' } });
    expect(JSON.stringify(rest[0]?.body)).toContain('pick_model');
  });

  it('resolves no access for a memberless payload even with a wildcard policy', async () => {
    // The other half of the fix: no member at all is not "a member with no roles", so the wildcard
    // cannot resolve one. Without this, any future caller that forgets the origin guard re-opens it.
    const { adapter } = await makeAdapter();
    expect(adapter.accessFor({ member: undefined }, 'C').access).toBeUndefined();
    expect(adapter.accessFor({ member: { roles: [] } }, 'C').access).toBeDefined();
    expect(adapter.isAdminMember(undefined)).toBe(false);
    expect(adapter.isAdminMember({ roles: [] })).toBe(true);
  });
});

describe('discord extractImageRefs (generated-image markdown → uploads)', () => {
  const load = async () => (await import(join(repoRoot, 'plugins/discord/index.mjs'))) as unknown as {
    extractImageRefs: (t: string) => { cleaned: string; files: string[] };
  };

  it('extracts a relative daemon link and removes it from the text', async () => {
    const { extractImageRefs } = await load();
    const r = extractImageRefs('Tady je obrázek: ![kočka](/api/brain/images/abc123.png) hotovo');
    expect(r.files).toEqual(['abc123.png']);
    expect(r.cleaned).toBe('Tady je obrázek:  hotovo');
  });

  it('extracts multiple links, including an absolute-URL variant', async () => {
    const { extractImageRefs } = await load();
    const r = extractImageRefs('![a](/api/brain/images/aaa1.png)\n![b](https://example.com/api/brain/images/bbb2.png)');
    expect(r.files).toEqual(['aaa1.png', 'bbb2.png']);
    expect(r.cleaned.trim()).toBe('');
  });

  it('leaves text-only messages untouched', async () => {
    const { extractImageRefs } = await load();
    const r = extractImageRefs('žádný obrázek tady není');
    expect(r.files).toEqual([]);
    expect(r.cleaned).toBe('žádný obrázek tady není');
  });

  it('rejects names outside the daemon route pattern (path traversal stays inert text)', async () => {
    const { extractImageRefs } = await load();
    const r = extractImageRefs('![x](/api/brain/images/../evil.png) a ![y](/api/brain/images/UPPER.png)');
    expect(r.files).toEqual([]);
    expect(r.cleaned).toContain('../evil.png'); // untouched — never treated as a file
  });
});

/** An image the agent shares (ShareImage) arrives as an `image` stream event, not as markdown in the
 *  reply — Discord must still turn it into a real upload, because the daemon path in the ref is dead text
 *  in a chat client. */
describe('discord shared-image delivery (image event → upload)', () => {
  const load = async () => (await import(join(repoRoot, 'plugins/discord/index.mjs'))) as unknown as {
    LiveMessage: new (adapter: unknown, channelId: string) => { onEvent: (e: unknown) => void; finalize: (reply?: string) => Promise<void> };
  };
  const NAME = `${'a'.repeat(64)}.webp`;

  const mk = () => {
    const uploads: { content: string; names: string[] }[] = [];
    const asked: string[][] = [];
    const posted: string[] = [];
    const adapter = {
      cfg: { runtimeFooter: false, answerMode: 'final' },
      rest: async (_m: string, _p: string, body?: { content?: string }) => { posted.push(body?.content ?? ''); return { id: 'm1' }; },
      // The text path asks with an empty list for every reply; only a real lookup is interesting here.
      resolveImageFiles: (names: string[]) => {
        if (names.length) asked.push(names);
        return names.map((name) => ({ name, data: Buffer.from('IMG') }));
      },
      uploadImages: async (_c: string, content: string, files: { name: string }[]) => {
        uploads.push({ content, names: files.map((f) => f.name) });
        return { id: 'm2' };
      },
    };
    return { adapter, uploads, asked, posted };
  };

  it('uploads the file the ref points at and sends the caption as that message', async () => {
    const { LiveMessage } = await load();
    const { adapter, uploads, asked } = mk();
    const lm = new LiveMessage(adapter, 'chan');
    lm.onEvent({ type: 'image', ref: `/api/brain/chat-images/${NAME}`, id: 't1', caption: 'Tady je ten graf.' });
    await lm.finalize('Hotovo.');
    expect(asked).toEqual([[NAME]]);                    // the stored name, not the whole daemon path
    expect(uploads.map((u) => u.names)).toEqual([[NAME]]);
    expect(uploads[0].content).toBe('Tady je ten graf.'); // the caption rides the attachment
  });

  it('still uploads a generated image referenced the older way', async () => {
    const { LiveMessage } = await load();
    const { adapter, uploads } = mk();
    const lm = new LiveMessage(adapter, 'chan');
    lm.onEvent({ type: 'image', ref: '/api/brain/images/abc123.png', id: 't1' });
    await lm.finalize('Hotovo.');
    expect(uploads.map((u) => u.names)).toEqual([['abc123.png']]);
    expect(uploads[0].content).toBe(''); // no caption — the attachment stands on its own
  });

  it('never turns a ref outside the two image routes into a file read', async () => {
    const { LiveMessage } = await load();
    const { adapter, uploads, asked } = mk();
    const lm = new LiveMessage(adapter, 'chan');
    for (const ref of ['/api/brain/chat-images/../../secret.png', '/etc/passwd', `/api/brain/chat-images/${'a'.repeat(64)}.svg`]) {
      lm.onEvent({ type: 'image', ref, id: 't1' });
    }
    await lm.finalize('Hotovo.');
    expect(asked).toEqual([]);   // nothing was ever looked up on disk
    expect(uploads).toEqual([]);
  });
});

describe('discord context helpers', () => {
  const load = async () => (await import(join(repoRoot, 'plugins/discord/index.mjs'))) as unknown as {
    displayNameOf: (m: unknown) => string;
    resolveMentions: (text: string, mentions: unknown[], rolePolicies: unknown[], channelNames: Map<string, string>) => string;
    buildReplyContext: (ref: unknown) => string;
  };

  it('displayNameOf prefers server nick > global name > username > unknown', async () => {
    const { displayNameOf } = await load();
    expect(displayNameOf({ member: { nick: 'Anička' }, author: { global_name: 'Anna G', username: 'anna' } })).toBe('Anička');
    expect(displayNameOf({ member: {}, author: { global_name: 'Anna G', username: 'anna' } })).toBe('Anna G');
    expect(displayNameOf({ author: { username: 'anna' } })).toBe('anna');
    expect(displayNameOf({})).toBe('unknown');
  });

  it('resolveMentions replaces <@id> and <@!id> with display names, roles from policies, channels from the cache', async () => {
    const { resolveMentions } = await load();
    const mentions = [
      { id: '1', username: 'bob', global_name: 'Bobby' },
      { id: '2', username: 'eva', member: { nick: 'Evka' } },
    ];
    const policies = [{ roleId: '9', name: 'Dev tým' }];
    const channels = new Map([['77', 'general']]);
    const out = resolveMentions('hey <@1> and <@!2>, ping <@&9> + <@&8> in <#77> or <#88>', mentions, policies, channels);
    expect(out).toBe('hey @Bobby and @Evka, ping @Dev tým + @role in #general or <#88>');
  });

  it('buildReplyContext caps the excerpt at 300 chars and falls back through author names', async () => {
    const { buildReplyContext } = await load();
    expect(buildReplyContext(null)).toBe(''); // deleted/absent original
    const short = buildReplyContext({ author: { username: 'bob', global_name: 'Bobby' }, content: 'hello' });
    expect(short).toBe('[Replying to Bobby: "hello"]');
    const long = buildReplyContext({ author: { username: 'bob' }, content: 'x'.repeat(400) });
    expect(long).toBe(`[Replying to bob: "${'x'.repeat(300)}…"]`);
  });
});

describe('discord onMessage context pipeline', () => {
  it('classifies only a fetched 1:1 DM channel as direct', async () => {
    const reg = await loadPlugins({
      dirs: [join(repoRoot, 'plugins')], enabled: ['discord'], logger: log,
      config: { discord: { botToken: 'tok', rolePolicies: [{ roleId: 'R1', projectIds: [1] }], toolActivity: 'off' } },
    });
    const adapter = reg.platforms[0] as any;
    const channelTypes: Record<string, number> = { dm: 1, group: 3, guild: 0 };
    adapter.rest = async (method: string, path: string) => {
      if (method === 'GET') {
        const channelId = path.split('/').pop()!;
        return { id: channelId, name: channelId, type: channelTypes[channelId] };
      }
      return {};
    };
    adapter.respond = async () => undefined;
    const direct: boolean[] = [];
    adapter.listen(async (src: { direct: boolean }) => { direct.push(src.direct); return undefined; });

    for (const channelId of ['dm', 'group', 'guild']) {
      await adapter.dispatchSlashPrompt({
        id: `i-${channelId}`, application_id: 'app', token: 'token', channel_id: channelId,
        ...(channelId === 'guild' ? { guild_id: 'G' } : {}),
        member: { user: { id: 'U1', username: 'anna' }, roles: ['R1'] },
      }, '/test');
    }

    expect(direct).toEqual([true, false, false]);
  });

  it('strips the bot mention, resolves other mentions, prefixes the speaker, quotes the reply, notes non-image attachments, and carries channel metadata', async () => {
    const reg = await loadPlugins({
      dirs: [join(repoRoot, 'plugins')], enabled: ['discord'], logger: log,
      config: { discord: { botToken: 'tok', rolePolicies: [{ roleId: 'R1', name: 'Dev', projectIds: [1] }], streaming: false, reactions: false } },
    });
    const adapter = reg.platforms[0] as unknown as {
      botId: string | null;
      rest: (method: string, path: string, body?: unknown) => Promise<unknown>;
      listen: (h: (src: Record<string, unknown>, text: string) => Promise<string | undefined>) => void;
      onMessage: (m: unknown) => Promise<void>;
    };
    adapter.botId = 'BOT';
    adapter.rest = async (_method: string, path: string) => {
      if (path === '/channels/100') return { id: '100', name: 'general', topic: 'Team chat', type: 0 };
      return {};
    };
    let seen: { src: Record<string, unknown>; text: string } | undefined;
    adapter.listen(async (src, text) => { seen = { src, text }; return 'ok'; });

    await adapter.onMessage({
      type: 19, // REPLY — a real user turn
      guild_id: 'G', channel_id: '100', id: 'MSG',
      author: { id: 'U1', username: 'anna', global_name: 'Anna G' },
      member: { nick: 'Anička', roles: ['R1'] },
      mentions: [{ id: 'BOT', username: 'elowen' }, { id: 'U2', username: 'bob', global_name: 'Bobby' }],
      content: '<@BOT> ahoj <@!U2> mrkni na <#100>',
      referenced_message: { author: { id: 'U2', username: 'bob', global_name: 'Bobby' }, content: 'původní zpráva' },
      attachments: [{ filename: 'spec.pdf', content_type: 'application/pdf', size: 1000, url: 'http://cdn/spec.pdf' }],
    });

    expect(seen).toBeDefined();
    // The CDN is unreachable in this test, so there are no bytes to hand over and the note is all that is
    // left — the one case where a document still degrades to a mention of itself.
    expect(seen!.text).toBe('[Replying to Bobby: "původní zpráva"]\nahoj @Bobby mrkni na #general\n[Attachment: spec.pdf (application/pdf)]');
    expect(seen!.src.attachments).toBeUndefined();
    expect(seen!.src.userName).toBe('Anička');
    expect(seen!.src.channelName).toBe('general');
    expect(seen!.src.channelTopic).toBe('Team chat');
    expect(seen!.src.images).toBeUndefined();
    expect(seen!.src.channelId).toBe('100#0');
  });

  // A document used to reach the room turn as the note `[Attachment: spec.pdf (…)]`: the agent was told a
  // file existed and given no way to open it, while the same file dropped into the web chat became a real
  // path in the sender's project. The bytes now travel, and the HOST decides where they land.
  it('downloads a non-image attachment and hands its bytes to the host instead of noting it', async () => {
    const reg = await loadPlugins({
      dirs: [join(repoRoot, 'plugins')], enabled: ['discord'], logger: log,
      config: { discord: { botToken: 'tok', rolePolicies: [{ roleId: 'R1', name: 'Dev', projectIds: [1] }], streaming: false, reactions: false } },
    });
    const adapter = reg.platforms[0] as unknown as {
      botId: string | null;
      rest: (method: string, path: string, body?: unknown) => Promise<unknown>;
      listen: (h: (src: Record<string, unknown>, text: string) => Promise<string | undefined>) => void;
      onMessage: (m: unknown) => Promise<void>;
    };
    adapter.botId = 'BOT';
    adapter.rest = async () => ({});
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => ({
      ok: true, status: 200,
      arrayBuffer: async () => new TextEncoder().encode(`bytes-of:${url}`).buffer,
    })) as unknown as typeof fetch;
    let seen: { src: Record<string, unknown>; text: string } | undefined;
    adapter.listen(async (src, text) => { seen = { src, text }; return 'ok'; });
    try {
      await adapter.onMessage({
        type: 0, guild_id: 'G', channel_id: '100', id: 'MSG',
        author: { id: 'U1', username: 'anna' }, member: { roles: ['R1'] }, mentions: [],
        content: 'co je v té smlouvě?',
        attachments: [
          { filename: 'smlouva.pdf', content_type: 'application/pdf', size: 1000, url: 'http://cdn/smlouva.pdf' },
          // Over the transport ceiling: nothing to hand over, so the note survives for this one.
          { filename: 'huge.zip', content_type: 'application/zip', size: 999_999_999, url: 'http://cdn/huge.zip' },
        ],
      });
    } finally {
      globalThis.fetch = realFetch;
    }

    expect(seen!.src.attachments).toEqual([
      { name: 'smlouva.pdf', data: Buffer.from('bytes-of:http://cdn/smlouva.pdf').toString('base64'), mimeType: 'application/pdf' },
    ]);
    // The stored file is announced by the HOST from the path it chose; the adapter adds no note for it.
    expect(seen!.text).toBe('co je v té smlouvě?\n[Attachment: huge.zip (application/zip)]');
  });

  it('treats a file with no words as a real turn rather than dropping the message', async () => {
    const reg = await loadPlugins({
      dirs: [join(repoRoot, 'plugins')], enabled: ['discord'], logger: log,
      config: { discord: { botToken: 'tok', rolePolicies: [{ roleId: 'R1', name: 'Dev', projectIds: [1] }], streaming: false, reactions: false } },
    });
    const adapter = reg.platforms[0] as unknown as {
      botId: string | null;
      rest: (method: string, path: string, body?: unknown) => Promise<unknown>;
      listen: (h: (src: Record<string, unknown>, text: string) => Promise<string | undefined>) => void;
      onMessage: (m: unknown) => Promise<void>;
    };
    adapter.botId = 'BOT';
    adapter.rest = async () => ({});
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode('x').buffer })) as unknown as typeof fetch;
    let seen: { src: Record<string, unknown>; text: string } | undefined;
    adapter.listen(async (src, text) => { seen = { src, text }; return 'ok'; });
    try {
      await adapter.onMessage({
        type: 0, guild_id: 'G', channel_id: '100', id: 'MSG',
        author: { id: 'U1', username: 'anna' }, member: { roles: ['R1'] }, mentions: [], content: '',
        attachments: [{ filename: 'a.pdf', content_type: 'application/pdf', size: 10, url: 'http://cdn/a.pdf' }],
      });
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(seen!.text).toBe('[The user sent a file]');
    expect((seen!.src.attachments as unknown[]) ?? []).toHaveLength(1);
  });

  it('clears Fast only on a temporary non-OAuth vision fallback without changing channel state', async () => {
    const reg = await loadPlugins({
      dirs: [join(repoRoot, 'plugins')], enabled: ['discord'], logger: log,
      config: { discord: {
        botToken: 'tok', visionModel: 'elowen:vision/image-model',
        rolePolicies: [{ roleId: 'R1', name: 'Dev', projectIds: [1] }], streaming: false, reactions: false,
      } },
      listModels: async () => [
        { provider: 'oauth', providerLabel: 'OAuth', model: 'normal', fastAvailable: true },
        { provider: 'vision', providerLabel: 'Vision', model: 'image-model' },
      ],
    });
    const adapter = reg.platforms[0] as unknown as {
      botId: string | null;
      state: { get(id: string): Record<string, unknown>; patch(id: string, fields: Record<string, unknown>): void };
      rest: (method: string, path: string, body?: unknown) => Promise<unknown>;
      listen: (h: (src: { access?: Record<string, unknown> }) => Promise<string | undefined>) => void;
      onMessage: (m: unknown) => Promise<void>;
    };
    adapter.botId = 'BOT';
    adapter.state.patch('100', { model: { provider: 'oauth', model: 'normal' }, fast: true });
    adapter.rest = async (_method, path) => path === '/channels/100' ? { id: '100', name: 'general', type: 0 } : {};
    let turnAccess: Record<string, unknown> | undefined;
    adapter.listen(async (src) => { turnAccess = src.access; return undefined; });
    const oldFetch = global.fetch;
    global.fetch = vi.fn(async () => new Response(new Uint8Array([1]), { status: 200 })) as unknown as typeof fetch;
    try {
      await adapter.onMessage({
        type: 0, guild_id: 'G', channel_id: '100', id: 'MSG',
        author: { id: 'U1', username: 'anna' }, member: { roles: ['R1'] }, content: 'look',
        attachments: [{ filename: 'x.png', content_type: 'image/png', size: 1, url: 'http://cdn/x.png' }],
      });
    } finally { global.fetch = oldFetch; }

    expect(turnAccess).toMatchObject({ model: { provider: 'vision', model: 'image-model' }, fast: false });
    expect(adapter.state.get('100')).toMatchObject({ model: { provider: 'oauth', model: 'normal' }, fast: true });
  });

  it('ignores Discord system messages (channel renames, pins, joins) — only DEFAULT/REPLY are turns', async () => {
    const reg = await loadPlugins({
      dirs: [join(repoRoot, 'plugins')], enabled: ['discord'], logger: log,
      config: { discord: { botToken: 'tok', rolePolicies: [{ roleId: 'R1', name: 'Dev', projectIds: [1] }], streaming: false, reactions: false } },
    });
    const adapter = reg.platforms[0] as unknown as {
      botId: string | null;
      listen: (h: (src: Record<string, unknown>, text: string) => Promise<string | undefined>) => void;
      onMessage: (m: unknown) => Promise<void>;
    };
    adapter.botId = 'BOT';
    let fired = false;
    adapter.listen(async () => { fired = true; return 'ok'; });
    // type 4 = CHANNEL_NAME_CHANGE ("X changed the channel name"): authored by a real member, not a bot.
    await adapter.onMessage({ type: 4, guild_id: 'G', channel_id: '100', id: 'SYS', author: { id: 'U1', username: 'anna' }, member: { roles: ['R1'] }, content: '' });
    expect(fired).toBe(false);
  });

  it('keeps an interleaved final below newer ingress, while an ordered turn still collapses by edit', async () => {
    const make = async () => {
      const reg = await loadPlugins({
        dirs: [join(repoRoot, 'plugins')], enabled: ['discord'], logger: log,
        config: { discord: {
          botToken: 'tok', rolePolicies: [{ roleId: 'R1', projectIds: [1] }], reactions: false,
          streaming: true, deleteToolActivityAfterTurn: true, runtimeFooter: false,
        } },
      });
      const adapter = reg.platforms[0] as any;
      adapter.botId = 'BOT';
      const calls: { method: string; path: string; body: any }[] = [];
      let seq = 0;
      adapter.rest = async (method: string, path: string, body: any = {}) => {
        calls.push({ method, path, body });
        if (method === 'GET') return { id: '100', name: 'general', type: 0 };
        return { id: `out-${++seq}` };
      };
      const message = (id: string, role = 'R1') => ({
        type: 0, guild_id: 'G', channel_id: '100', id,
        author: { id: role === 'R1' ? 'U1' : 'U2', username: role === 'R1' ? 'anna' : 'bob' },
        member: { roles: role ? [role] : [] }, content: id,
      });
      return { adapter, calls, message };
    };

    const interleaved = await make();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let progress!: () => void;
    const progressPosted = new Promise<void>((resolve) => { progress = resolve; });
    const originalRest = interleaved.adapter.rest;
    interleaved.adapter.rest = async (method: string, path: string, body: any = {}) => {
      const result = await originalRest(method, path, body);
      if (method === 'POST' && body.content?.includes('Read')) progress();
      return result;
    };
    interleaved.adapter.listen(async (_src: unknown, _text: string, onEvent: (e: unknown) => void) => {
      onEvent({ type: 'tool', id: 't1', name: 'Read', detail: 'config', icon: '📄' });
      await gate;
      return 'Final answer.';
    });
    const first = interleaved.adapter.onMessage(interleaved.message('M1'));
    await progressPosted;
    await interleaved.adapter.onMessage(interleaved.message('M2', '')); // visible, but rejected by access
    release();
    await first;

    const posts = interleaved.calls.filter((c) => c.method === 'POST' && c.path === '/channels/100/messages');
    expect(posts).toHaveLength(2);
    expect(posts[0].body.message_reference?.message_id).toBe('M1');
    expect(posts[1].body).toMatchObject({ content: 'Final answer.', message_reference: { message_id: 'M1' } });
    expect(interleaved.calls.filter((c) => c.method === 'PATCH').some((c) => c.body.content === 'Final answer.')).toBe(false);

    const ordered = await make();
    ordered.adapter.listen(async (_src: unknown, _text: string, onEvent: (e: unknown) => void) => {
      onEvent({ type: 'tool', id: 't1', name: 'Read', detail: 'config', icon: '📄' });
      return 'Final answer.';
    });
    await ordered.adapter.onMessage(ordered.message('M1'));
    expect(ordered.calls.filter((c) => c.method === 'POST' && c.path === '/channels/100/messages')).toHaveLength(1);
    expect(ordered.calls.filter((c) => c.method === 'PATCH').at(-1)?.body.content).toBe('Final answer.');
  });
});

describe('discord buildAskComponents (AskUserQuestion rendering)', () => {
  interface Component { type: number; custom_id?: string; label?: string; style?: number; options?: { label: string; value: string }[]; min_values?: number; max_values?: number }
  interface Row { type: number; components: Component[] }
  const load = async () => (await import(join(repoRoot, 'plugins/discord/index.mjs'))) as {
    buildAskComponents: (id: string, questions: unknown[], opts?: { cs?: boolean; selected?: Record<number, string[]> }) => Row[];
  };
  const q = (over: Record<string, unknown> = {}) => ({
    question: 'Which colour?', header: 'Colour', multiSelect: false,
    options: [{ label: 'Blue' }, { label: 'Green' }], ...over,
  });

  it('renders a small single-select question as one button row (≤5 buttons) with no Submit — a click answers', async () => {
    const { buildAskComponents } = await load();
    const rows = buildAskComponents('ID', [q()]);
    expect(rows).toHaveLength(2); // options row + footer (Other only)
    expect(rows[0].components.map((c) => c.type)).toEqual([2, 2]); // buttons
    expect(rows[0].components.map((c) => c.custom_id)).toEqual(['ask:ID:0:0', 'ask:ID:0:1']);
    const footer = rows[1].components.map((c) => c.custom_id);
    expect(footer).not.toContain('ask:ID:submit');
    expect(footer).toContain('ask:ID:other');
  });

  it('uses a select menu when multiple=true or when a question has more than 5 options', async () => {
    const { buildAskComponents } = await load();
    const multi = buildAskComponents('ID', [q({ multiSelect: true })]);
    expect(multi[0].components[0].type).toBe(3); // string select
    expect(multi[0].components[0].max_values).toBe(2);
    const many = buildAskComponents('ID', [q({ options: Array.from({ length: 7 }, (_, i) => ({ label: `o${i}` })) })]);
    expect(many[0].components[0].type).toBe(3);
    expect(many[0].components[0].options).toHaveLength(7);
    // Both need the explicit Submit button.
    expect(multi.at(-1)!.components.map((c) => c.custom_id)).toContain('ask:ID:submit');
  });

  it('omits the free-text "Other" button when custom is false, keeps it when absent (older events)', async () => {
    const { buildAskComponents } = await load();
    const strict = buildAskComponents('ID', [q({ custom: false })]);
    const ids = strict.flatMap((r) => r.components.map((c) => c.custom_id));
    expect(ids).not.toContain('ask:ID:other');
    const legacy = buildAskComponents('ID', [q()]);
    expect(legacy.flatMap((r) => r.components.map((c) => c.custom_id))).toContain('ask:ID:other');
  });

  it('marks the picked option button green and keeps Submit on multi-question asks', async () => {
    const { buildAskComponents } = await load();
    const rows = buildAskComponents('ID', [q(), q({ question: 'Pick tools', header: 'Tools' })], { selected: { 0: ['Green'] } });
    expect(rows[0].components.map((c) => c.style)).toEqual([2, 3]); // Green picked
    expect(rows.at(-1)!.components.map((c) => c.custom_id)).toContain('ask:ID:submit');
  });

  it('caps at 4 question rows + 1 footer row (Discord allows 5 action rows)', async () => {
    const { buildAskComponents } = await load();
    const rows = buildAskComponents('ID', Array.from({ length: 6 }, (_, i) => q({ question: `Q${i}` })));
    expect(rows.length).toBeLessThanOrEqual(5);
  });
});

describe('discord configurable media/timeout limits', () => {
  const mkAdapter = async (extraCfg: Record<string, unknown> = {}) => {
    const reg = await loadPlugins({
      dirs: [join(repoRoot, 'plugins')], enabled: ['discord'], logger: log,
      config: { discord: { botToken: 'tok', rolePolicies: [{ roleId: 'R1', name: 'Dev', projectIds: [1] }], streaming: false, reactions: false, ...extraCfg } },
    });
    const adapter = reg.platforms[0] as unknown as {
      botId: string | null;
      pendingAsks: Map<string, { channelId: string; askerId: string; createdAt: number }>;
      rest: (method: string, path: string, body?: unknown) => Promise<unknown>;
      listen: (h: (src: Record<string, unknown>, text: string) => Promise<string | undefined>) => void;
      onMessage: (m: unknown) => Promise<void>;
    };
    adapter.botId = 'BOT';
    adapter.rest = async (_method: string, path: string) => {
      if (path === '/channels/100') return { id: '100', name: 'general', topic: '', type: 0 };
      return {};
    };
    return adapter;
  };

  it('maxImages unset reproduces the default cap (4): a 5th image attachment falls over it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })));
    const adapter = await mkAdapter();
    let seen: { src: Record<string, unknown> } | undefined;
    adapter.listen(async (src) => { seen = { src }; return undefined; });
    await adapter.onMessage({
      type: 0, guild_id: 'G', channel_id: '100', id: 'MSG',
      author: { id: 'U1', username: 'anna' }, member: { roles: ['R1'] },
      content: 'look',
      attachments: [0, 1, 2, 3, 4].map((i) => ({ filename: `i${i}.png`, content_type: 'image/png', size: 100, url: `http://cdn/${i}.png` })),
    });
    expect((seen!.src.images as unknown[])?.length).toBe(4);
  });

  it('a configured maxImages overrides the default, capping how many attachments become vision images', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })));
    const adapter = await mkAdapter({ maxImages: 2 });
    let seen: { src: Record<string, unknown> } | undefined;
    adapter.listen(async (src) => { seen = { src }; return undefined; });
    await adapter.onMessage({
      type: 0, guild_id: 'G', channel_id: '100', id: 'MSG',
      author: { id: 'U1', username: 'anna' }, member: { roles: ['R1'] },
      content: 'look',
      attachments: [0, 1, 2].map((i) => ({ filename: `i${i}.png`, content_type: 'image/png', size: 100, url: `http://cdn/${i}.png` })),
    });
    expect((seen!.src.images as unknown[])?.length).toBe(2); // 3rd attachment fell over the configured cap
  });

  it('askTimeoutMs unset reproduces the default (~6 min): a 60s-old pending ask is NOT pruned', async () => {
    const adapter = await mkAdapter();
    adapter.listen(async () => undefined);
    adapter.pendingAsks.set('ask1', { channelId: 'OTHER', askerId: 'U9', createdAt: Date.now() - 60_000 });
    // An unrelated message (unmapped role → onMessage returns right after the prune loop) still runs the prune.
    await adapter.onMessage({ type: 0, guild_id: 'G', channel_id: '999', id: 'M2', author: { id: 'U2', username: 'x' }, member: { roles: [] }, content: 'hi' });
    expect(adapter.pendingAsks.has('ask1')).toBe(true);
  });

  // The plugin used to run its own `askTimeoutMs` clock beside the core's five-minute one. Two clocks
  // for one fact could only disagree: a question left live after the turn gave up, or one refused while
  // the core would still have taken the answer. The core announces every exit; this retires the message.
  it('retires an expired question message when the core reports it resolved', async () => {
    const adapter = await mkAdapter({});
    adapter.listen(async () => undefined);
    const patches: { path: string; body: any }[] = [];
    adapter.rest = async (method: string, path: string, body: unknown) => {
      if (method === 'PATCH') patches.push({ path, body: body as any });
      return { id: 'ASKMSG' };
    };
    await adapter.postAsk('C1', 'M1', 'U9', 'q-1', [{ header: 'Colour', question: 'Which?', options: [{ label: 'Blue' }] }]);
    expect(adapter.pendingAsks.has('q-1')).toBe(true);

    await adapter.resolveAsk('C1', 'q-1', 'timeout');

    expect(adapter.pendingAsks.has('q-1')).toBe(false);
    expect(patches).toHaveLength(1);
    expect(patches[0]!.path).toBe('/channels/C1/messages/ASKMSG');
    // No live buttons may survive — clicking one is a dead end for the person in the room.
    expect(patches[0]!.body.components).toEqual([]);
    expect(JSON.stringify(patches[0]!.body.embeds)).toContain('expired');
  });

  it('leaves an ANSWERED question alone — the surface that answered already settled it', async () => {
    const adapter = await mkAdapter({});
    adapter.listen(async () => undefined);
    const patches: unknown[] = [];
    adapter.rest = async (method: string, _path: string, body: unknown) => {
      if (method === 'PATCH') patches.push(body);
      return { id: 'ASKMSG' };
    };
    await adapter.postAsk('C1', 'M1', 'U9', 'q-1', [{ header: 'Colour', question: 'Which?', options: [{ label: 'Blue' }] }]);
    await adapter.resolveAsk('C1', 'q-1', 'answered');
    expect(adapter.pendingAsks.has('q-1')).toBe(false);
    expect(patches).toEqual([]);
  });
});

/** The previous round of this work added a `file` and an `ask_resolved` branch to the shared reducer, every
 *  test passed, and NOTHING reached a user — because the adapters resolve `elowen-plugin-shared` from
 *  node_modules, which still held a build with neither branch, and no test ever drove an event THROUGH that
 *  installed package into an adapter method.
 *
 *  So these tests deliberately go the whole way: they import the plugin's own `index.mjs` (which imports the
 *  INSTALLED `elowen-plugin-shared`), build a real `DiscordAdapter`, and hand the reducer a real event. What
 *  they assert is what the adapter would have put on the wire. Only the single HTTP boundary is stubbed. */
describe('discord delivers a shared file through the installed shared reducer', () => {
  const STORED = `${'a'.repeat(64)}.bin`;
  let root: string;
  let chatFiles: string;

  const mkAdapter = async (cfg: Record<string, unknown> = {}) => {
    const { DiscordAdapter } = await import(join(repoRoot, 'plugins/discord/lib/adapter.mjs')) as { DiscordAdapter: new (...args: unknown[]) => any };
    const { LiveMessage } = await import(join(repoRoot, 'plugins/discord/index.mjs')) as {
      LiveMessage: new (...args: unknown[]) => { onEvent: (e: unknown) => void; finalize: (reply?: string) => Promise<void> };
    };
    const state = { get: () => ({}), patch: () => {} };
    const adapter = new DiscordAdapter(
      { language: 'en', runtimeFooter: false, ...cfg },
      log, state, async () => [], [], () => null, () => false, () => [], chatFiles,
    );
    // The wire: every text message and every multipart upload this turn would have sent, in order.
    const wire: { kind: string; content: string; files?: { name: string; mime: string; bytes: string }[] }[] = [];
    let n = 0;
    adapter.rest = async (method: string, path: string, body: any) => {
      if (method === 'POST') { wire.push({ kind: 'text', content: String(body?.content ?? '') }); return { id: `m${++n}` }; }
      if (method === 'PATCH') wire.push({ kind: 'edit', content: String(body?.content ?? '') });
      return { id: path.split('/').pop() };
    };
    adapter.uploadAttachments = async (_channelId: string, content: string, files: { name: string; data: Buffer }[], mimeFor: (n: string) => string) => {
      wire.push({ kind: 'upload', content, files: files.map((f) => ({ name: f.name, mime: mimeFor(f.name), bytes: f.data.toString() })) });
      return { id: `u${++n}` };
    };
    return { adapter, LiveMessage, wire };
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'elowen-discord-files-'));
    chatFiles = join(root, 'chat-files');
    mkdirSync(chatFiles);
    writeFileSync(join(chatFiles, STORED), 'PDF-BYTES');
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('turns a `file` event into a real upload of the stored bytes, ahead of the answer text', async () => {
    const { adapter, LiveMessage, wire } = await mkAdapter();
    const lm = new LiveMessage(adapter, 'C1', 'M1');
    lm.onEvent({ type: 'file', ref: `/api/brain/chat-files/${STORED}`, name: 'report.pdf', size: 9, caption: 'Here is the report.' });
    await lm.finalize('Done — the report is attached.');

    const upload = wire.find((w) => w.kind === 'upload');
    expect(upload, 'the file event produced no upload at all — the exact original defect').toBeDefined();
    expect(upload!.files).toEqual([{ name: 'report.pdf', mime: 'application/pdf', bytes: 'PDF-BYTES' }]);
    // The agent's caption is the upload message's own text, exactly as it is on the image path.
    expect(upload!.content).toBe('Here is the report.');
    // The file goes out BEFORE the answer, so the reply stays the last thing in the conversation.
    expect(wire.findIndex((w) => w.kind === 'upload'))
      .toBeLessThan(wire.findIndex((w) => w.content.includes('Done — the report is attached.')));
  });

  it('skips a ref that is not a stored chat-file URL and still delivers the answer text', async () => {
    const { adapter, LiveMessage, wire } = await mkAdapter();
    const lm = new LiveMessage(adapter, 'C1', 'M1');
    // Each of these has a last path segment that WOULD resolve if the ref were parsed by taking the
    // basename: the stored file genuinely sits in this directory. Only the full daemon-URL shape is
    // accepted, so a ref-shaped string in model prose cannot address bytes on disk.
    lm.onEvent({ type: 'file', ref: `/api/brain/chat-images/${STORED}`, name: 'wrong-route', size: 9 });
    lm.onEvent({ type: 'file', ref: `https://evil.example/${STORED}`, name: 'off-host', size: 9 });
    lm.onEvent({ type: 'file', ref: '/api/brain/chat-files/../../../etc/passwd', name: 'passwd', size: 1 });
    await lm.finalize('Nothing to attach.');
    expect(wire.some((w) => w.kind === 'upload')).toBe(false);
    expect(wire.some((w) => w.content.includes('Nothing to attach.'))).toBe(true);
  });

  it('routes an `ask_resolved` event to resolveAsk, retiring the question the reducer raised', async () => {
    const { adapter, LiveMessage } = await mkAdapter();
    const patches: { path: string; body: any }[] = [];
    adapter.rest = async (method: string, path: string, body: unknown) => {
      if (method === 'PATCH') patches.push({ path, body: body as any });
      return { id: 'ASKMSG' };
    };
    const lm = new LiveMessage(adapter, 'C1', 'M1');
    lm.onEvent({ type: 'ask', id: 'q-1', questions: [{ header: 'Colour', question: 'Which?', options: [{ label: 'Blue' }] }] });
    await new Promise((r) => setTimeout(r, 0)); // postAsk is fire-and-forget inside the reducer
    expect(adapter.pendingAsks.has('q-1')).toBe(true);

    lm.onEvent({ type: 'ask_resolved', id: 'q-1', reason: 'timeout' });
    await new Promise((r) => setTimeout(r, 0)); // so is resolveAsk

    expect(adapter.pendingAsks.has('q-1'), 'the reducer never reached resolveAsk').toBe(false);
    expect(patches).toHaveLength(1);
    expect(patches[0]!.body.components).toEqual([]); // no live buttons may survive
    expect(JSON.stringify(patches[0]!.body.embeds)).toContain('expired');
  });

  it('retires the question with streaming OFF too — that path routes events by hand', async () => {
    const reg = await loadPlugins({
      dirs: [join(repoRoot, 'plugins')], enabled: ['discord'], logger: log,
      config: { discord: { botToken: 'tok', rolePolicies: [{ roleId: 'R1', name: 'Dev' }], streaming: false, reactions: false } },
    });
    const adapter = reg.platforms[0] as any;
    adapter.botId = 'BOT';
    const patches: any[] = [];
    adapter.rest = async (method: string, path: string, body: any) => {
      if (path === '/channels/100') return { id: '100', name: 'general', topic: '', type: 0 };
      if (method === 'PATCH') patches.push(body);
      return { id: 'ASKMSG' };
    };
    adapter.listen(async (_src: unknown, _text: string, onEvent: (e: unknown) => void) => {
      onEvent({ type: 'ask', id: 'q-1', questions: [{ header: 'Colour', question: 'Which?', options: [{ label: 'Blue' }] }] });
      await new Promise((r) => setTimeout(r, 0));
      onEvent({ type: 'ask_resolved', id: 'q-1', reason: 'timeout' });
      await new Promise((r) => setTimeout(r, 0));
      return 'ok';
    });
    await adapter.onMessage({
      type: 0, guild_id: 'G', channel_id: '100', id: 'MSG',
      author: { id: 'U1', username: 'anna' }, member: { roles: ['R1'] }, content: 'hi',
    });
    expect(adapter.pendingAsks.has('q-1')).toBe(false);
    expect(patches.some((b) => Array.isArray(b.components) && b.components.length === 0)).toBe(true);
  });

  it('the REGISTERED plugin gets a real chat-files dir, so this works outside the test harness too', async () => {
    const reg = await loadPlugins({
      dirs: [join(repoRoot, 'plugins')], enabled: ['discord'], logger: log,
      config: { discord: { botToken: 'tok', rolePolicies: [] } },
    });
    const adapter = reg.platforms[0] as unknown as { chatFilesDir: string };
    // Beside the database, NOT under the plugin data root — a wrong derivation silently drops every file.
    expect(resolve(adapter.chatFilesDir).endsWith(`${sep}chat-files`)).toBe(true);
    expect(resolve(adapter.chatFilesDir)).not.toContain(`${sep}plugins-data${sep}`);
  });
});

describe('discord paged pickers + /context', () => {
  const makeAdapter = async (models: unknown[], initial: Record<string, unknown> = {}, language = 'en') => {
    const { DiscordAdapter } = await import(join(repoRoot, 'plugins/discord/lib/adapter.mjs')) as { DiscordAdapter: new (...args: unknown[]) => any };
    const channels: Record<string, Record<string, unknown>> = { C: initial };
    const state = {
      get: (id: string) => channels[id] ?? {},
      patch: (id: string, fields: Record<string, unknown>) => { channels[id] = { ...(channels[id] ?? {}), ...fields }; },
    };
    const adapter = new DiscordAdapter(
      { language, rolePolicies: [{ roleId: 'ADMIN', admin: true }] },
      log, state, async () => models, [], () => null, () => false, discordCommands,
    );
    const replies: any[] = [];
    adapter.rest = async (_method: string, _path: string, body: unknown) => { replies.push(body); return {}; };
    return { adapter, channels, replies };
  };

  const models30 = Array.from({ length: 30 }, (_, i) => ({ provider: 'p', providerLabel: 'Prov', model: `model-${i}` }));

  it('registers /context in the slash-command set', async () => {
    const { adapter, replies } = await makeAdapter([]);
    adapter.appId = 'APP';
    await adapter.registerCommands();
    const commands = replies[0] as Array<{ name: string }>;
    expect(commands.find((c) => c.name === 'context')).toEqual({
      name: 'context', description: 'Continue this channel in one of your conversations', type: 1,
    });
  });

  it('buildPagedSelect windows options into ≤25-row selects with prev/next nav', async () => {
    const { adapter } = await makeAdapter([]);
    const options = Array.from({ length: 30 }, (_, i) => ({ label: `l${i}`, value: `v${i}` }));
    const page0 = adapter.buildPagedSelect(options, 0, 'pick_model', 'ph');
    expect(page0[0].components[0].options).toHaveLength(25);
    const nav0 = page0[1].components;
    expect(nav0[0]).toMatchObject({ custom_id: 'pick_model_page:-1', disabled: true });   // prev disabled on page 0
    expect(nav0[1]).toMatchObject({ label: '1/2', disabled: true });
    expect(nav0[2]).toMatchObject({ custom_id: 'pick_model_page:1', disabled: false });    // next enabled
    const page1 = adapter.buildPagedSelect(options, 1, 'pick_model', 'ph');
    expect(page1[0].components[0].options).toHaveLength(5);
    expect(page1[1].components[0]).toMatchObject({ custom_id: 'pick_model_page:0', disabled: false }); // prev enabled
    expect(page1[1].components[2]).toMatchObject({ disabled: true }); // next disabled on the last page
  });

  it('/model no longer truncates: a model past row 25 renders on page 2 and can be selected', async () => {
    const { adapter, channels, replies } = await makeAdapter(models30);
    await adapter.onInteraction({ type: 2, id: 'I', token: 'T', channel_id: 'C', guild_id: 'G', member: { roles: ['ADMIN'] }, data: { name: 'model' } });
    // Page 0: exactly 25 options + a nav row (no silent drop of the remaining 5).
    expect(replies[0].data.components[0].components[0].options).toHaveLength(25);
    // Navigate to page 1 → the 30th model (model-29) is now rendered.
    replies.length = 0;
    await adapter.onInteraction({ type: 3, id: 'I2', token: 'T2', channel_id: 'C', guild_id: 'G', member: { roles: ['ADMIN'] }, data: { custom_id: 'pick_model_page:1' } });
    const values = replies[0].data.components[0].components[0].options.map((o: { value: string }) => o.value);
    expect(values).toContain('p::model-29');
    // Selecting it persists it — proving the removed .slice(0,25) no longer hides it.
    await adapter.onInteraction({ type: 3, id: 'I3', token: 'T3', channel_id: 'C', guild_id: 'G', member: { roles: ['ADMIN'] }, data: { custom_id: 'pick_model', values: ['p::model-29'] } });
    expect(channels.C?.model).toEqual({ provider: 'p', model: 'model-29' });
  });

  it('/context renders the caller\'s own conversations from the control surface', async () => {
    const { adapter, replies } = await makeAdapter([]);
    const listContext = vi.fn(() => ({ items: [{ id: 'brain-7-1', title: 'Refactor', model: 'gpt-5' }], total: 1, hasMore: false }));
    adapter.control({ listContext, bindContext: vi.fn() });
    await adapter.onInteraction({ type: 2, id: 'I', token: 'T', channel_id: 'C', guild_id: 'G', member: { roles: ['ADMIN'], user: { id: 'U1' } }, data: { name: 'context' } });
    expect(listContext).toHaveBeenCalledWith({ platform: 'discord', channelId: 'C#0' }, 'U1', { offset: 0, limit: 200 });
    const options = replies[0].data.components[0].components[0].options;
    expect(options).toEqual([{ label: 'Refactor', value: 'brain-7-1', description: 'gpt-5' }]);
  });

  it('/context is operator-gated: a non-admin member is refused and never reaches the control surface', async () => {
    const { adapter, replies } = await makeAdapter([]);
    const listContext = vi.fn();
    adapter.control({ listContext, bindContext: vi.fn() });
    await adapter.onInteraction({ type: 2, id: 'I', token: 'T', channel_id: 'C', guild_id: 'G', member: { roles: [] }, data: { name: 'context' } });
    expect(listContext).not.toHaveBeenCalled();
    expect(JSON.stringify(replies[0])).toContain('Only the operator');
  });

  it('picking a conversation dispatches the bind and warns about shared history', async () => {
    const { adapter, replies } = await makeAdapter([]);
    const bindContext = vi.fn(async () => ({ title: 'Refactor' }));
    adapter.control({ listContext: vi.fn(), bindContext });
    await adapter.onInteraction({ type: 3, id: 'I', token: 'T', channel_id: 'C', guild_id: 'G', member: { roles: ['ADMIN'], user: { id: 'U1' } }, data: { custom_id: 'pick_context', values: ['brain-7-1'] } });
    expect(bindContext).toHaveBeenCalledWith({ platform: 'discord', channelId: 'C#0' }, 'U1', 'brain-7-1');
    const content = replies[0].data.content as string;
    expect(content).toContain('Refactor');
    expect(content).toContain('continues');
    expect(replies[0].data.components).toEqual([]); // the picker is closed out
  });

  it('surfaces a bind guard rejection as an error reply', async () => {
    const { adapter, replies } = await makeAdapter([]);
    const bindContext = vi.fn(async () => { throw new Error('unknown session'); });
    adapter.control({ listContext: vi.fn(), bindContext });
    await adapter.onInteraction({ type: 3, id: 'I', token: 'T', channel_id: 'C', guild_id: 'G', member: { roles: ['ADMIN'], user: { id: 'U1' } }, data: { custom_id: 'pick_context', values: ['brain-7-1'] } });
    expect(JSON.stringify(replies[0])).toContain('unknown session');
  });
});

// Part A/B for Discord: a plugin prompt-command (kind:'prompt') is natively registered with a generic
// `args` option, appears in /help via its own description, and is dispatched RAW to the brain so PI
// expands the macro. The shared catalog `discordCommands` ends with a `deploy` prompt command.
describe('discord plugin prompt-commands (native registration + RAW dispatch)', () => {
  const makeAdapter = async () => {
    const { DiscordAdapter } = await import(join(repoRoot, 'plugins/discord/lib/adapter.mjs')) as { DiscordAdapter: new (...args: unknown[]) => any };
    const channels: Record<string, Record<string, unknown>> = {};
    const state = {
      get: (id: string) => channels[id] ?? {},
      patch: (id: string, fields: Record<string, unknown>) => { channels[id] = { ...(channels[id] ?? {}), ...fields }; },
    };
    const adapter = new DiscordAdapter(
      { language: 'en', toolActivity: 'off', answerMode: 'final', rolePolicies: [{ roleId: 'ADMIN', admin: true }] },
      log, state, async () => [], [], () => null, () => false, discordCommands,
    );
    const rest: { method: string; path: string; body: any }[] = [];
    adapter.rest = async (method: string, path: string, body: unknown) => { rest.push({ method, path, body }); return {}; };
    return { adapter, rest };
  };

  it('registers a plugin prompt-command with a generic optional string `args` option (built-ins keep theirs)', async () => {
    const { adapter, rest } = await makeAdapter();
    adapter.appId = 'APP';
    await adapter.registerCommands();
    const commands = rest.find((r) => r.method === 'PUT')!.body as Array<{ name: string; options?: unknown[] }>;
    expect(commands.find((c) => c.name === 'deploy')).toEqual({
      name: 'deploy', description: 'Ship it to $1', type: 1,
      options: [{ name: 'args', description: 'arguments', type: 3, required: false }],
    });
    expect(commands.find((c) => c.name === 'reasoning')!.options).toBeUndefined(); // a built-in picker gets none
  });

  it('lists the plugin command (own description) and adapter-local voice/display in /help', async () => {
    const { adapter, rest } = await makeAdapter();
    await adapter.onInteraction({ type: 2, id: 'I', token: 'T', channel_id: 'C', guild_id: 'G', member: { roles: ['ADMIN'] }, data: { name: 'help' } });
    const content = (rest.find((r) => r.path.includes('/callback'))!.body as { data: { content: string } }).data.content;
    expect(content).toContain('`/deploy` — Ship it to $1'); // plugin command via its own description
    expect(content).toContain('`/voice`');   // adapter-local
    expect(content).toContain('`/display`'); // adapter-local
  });

  it('routes a slash prompt-command RAW to the brain, args expanded into the macro', async () => {
    const { adapter } = await makeAdapter();
    let captured: { text: string; channelId: string; promptCommand?: boolean } | null = null;
    adapter.handler = async (src: { channelId: string; promptCommand?: boolean }, text: string) => {
      captured = { text, channelId: src.channelId, promptCommand: src.promptCommand };
      return 'shipped';
    };
    let posted: string | null = null;
    adapter.reply = async (_c: string, t: string) => { posted = t; };
    await adapter.onInteraction({
      type: 2, id: 'I', token: 'T', channel_id: 'C', guild_id: 'G', member: { roles: ['ADMIN'], user: { id: 'U1' } },
      data: { name: 'deploy', options: [{ name: 'args', value: 'prod now' }] },
    });
    expect(captured).toEqual({ text: '/deploy prod now', channelId: 'C#0', promptCommand: true });
    expect(posted).toBe('shipped');
  });

  it('an unmapped member cannot run a plugin prompt-command', async () => {
    const { adapter, rest } = await makeAdapter();
    let called = false;
    adapter.handler = async () => { called = true; return 'x'; };
    await adapter.onInteraction({
      type: 2, id: 'I', token: 'T', channel_id: 'C', guild_id: 'G', member: { roles: [] },
      data: { name: 'deploy', options: [{ name: 'args', value: 'prod' }] },
    });
    expect(called).toBe(false);
    expect(JSON.stringify(rest.find((r) => r.path.includes('/callback'))!.body)).toContain('Only the operator');
  });

  // Regression: `fetchHistory` fed raw channel content into a new conversation's first prompt, footers and
  // all. A model shown "every message here ends with `-# <model> · <n> %`" adopted it as house style and
  // began forging that line itself — observed live emitting `-# claude · 4 %` from a qwen-only session,
  // which then re-entered the next history window and reinforced the pattern.
  describe('runtime footer never re-enters the prompt', () => {
    const loadFormat = () => import(join(repoRoot, 'plugins/discord/index.mjs')) as Promise<{
      footerLine: (idle: unknown) => string;
      withoutFooter: (text: string) => string;
    }>;

    it('round-trips: whatever footerLine writes, withoutFooter takes back off', async () => {
      const { footerLine, withoutFooter } = await loadFormat();
      const footer = footerLine({ model: 'alibaba/qwen3.8-max-preview', usage: { percent: 4 } });
      expect(footer).toBe('-# qwen3.8-max-preview · 4 %');
      expect(withoutFooter(`Hotovo.\n\n${footer}`)).toBe('Hotovo.');
      // Model-only footer (no context percentage) comes off just the same.
      expect(withoutFooter(`Hotovo.\n\n${footerLine({ model: 'gpt-5' })}`)).toBe('Hotovo.');
    });

    it('leaves a message that merely looks similar alone', async () => {
      const { withoutFooter } = await loadFormat();
      // No footer at all.
      expect(withoutFooter('Hotovo.')).toBe('Hotovo.');
      // Subtext in the MIDDLE is content, not a trailing footer.
      expect(withoutFooter('-# poznámka\n\nHotovo.')).toBe('-# poznámka\n\nHotovo.');
      // A bare fence carries nothing to strip.
      expect(withoutFooter('Hotovo.\n\n-#')).toBe('Hotovo.\n\n-#');
      expect(withoutFooter('')).toBe('');
    });

    it('strips only our own messages when building history context', async () => {
      const { adapter } = await makeAdapter([]);
      adapter.botId = 'BOT';
      adapter.cfg.historyLimit = 10;
      adapter.rest = async () => [
        // newest-first, the order Discord's API returns
        { content: 'Filipe, hotovo.\n\n-# qwen3.8-max-preview · 4 %', author: { id: 'BOT', username: 'Elowen', bot: true } },
        { content: 'build passed\n-# ci-runner #481', author: { id: 'CI', username: 'CI', bot: true } },
        { content: 'a co tohle\n-# můj vlastní subtext', author: { id: 'U1', username: 'dragocz95' }, attachments: [{ filename: 'report.pdf', content_type: 'application/pdf' }] },
      ];
      const history = await adapter.fetchHistory('C', 'before');
      expect(history.map((message) => message.author.name)).toEqual(['dragocz95', 'CI', 'Elowen']);
      expect(history.map((message) => message.role)).toEqual(['user', 'assistant', 'assistant']);
      // Our footer is gone…
      expect(history.at(-1)?.text).toBe('Filipe, hotovo.');
      expect(JSON.stringify(history)).not.toContain('qwen3.8-max-preview');
      // …but another bot's trailing subtext is ITS text, not our metadata…
      expect(history[1]?.text).toContain('-# ci-runner #481');
      // …and a person's own subtext line is theirs and survives verbatim.
      expect(history[0]?.text).toContain('-# můj vlastní subtext');
      expect(history[0]?.attachments).toEqual([{ name: 'report.pdf', mimeType: 'application/pdf', kind: 'file' }]);
    });

    // The reply quote is the OTHER door into the prompt, and unlike history it fires on every single reply
    // to one of our messages — the quoted body is taken verbatim, so any answer short enough to fit the
    // excerpt carried its footer straight back in.
    it('quotes our own message without its footer, a foreign subtext line verbatim', async () => {
      const reg = await loadPlugins({
        dirs: [join(repoRoot, 'plugins')], enabled: ['discord'], logger: log,
        config: { discord: { botToken: 'tok', rolePolicies: [{ roleId: 'R1', name: 'Dev', projectIds: [1] }], streaming: false, reactions: false } },
      });
      const adapter = reg.platforms[0] as unknown as {
        botId: string | null;
        rest: (method: string, path: string, body?: unknown) => Promise<unknown>;
        listen: (h: (src: Record<string, unknown>, text: string) => Promise<string | undefined>) => void;
        onMessage: (m: unknown) => Promise<void>;
      };
      adapter.botId = 'BOT';
      adapter.rest = async () => ({});
      const seen: string[] = [];
      adapter.listen(async (_src, text) => { seen.push(text); return 'ok'; });
      const turn = {
        type: 19, guild_id: 'G', channel_id: '100',
        author: { id: 'U1', username: 'anna' }, member: { roles: ['R1'] }, mentions: [], attachments: [],
      };

      await adapter.onMessage({
        ...turn, id: 'M1', content: 'a proč?',
        referenced_message: { author: { id: 'BOT', username: 'Elowen' }, content: 'Hotovo.\n\n-# qwen3.8-max-preview · 4 %' },
      });
      expect(seen[0]).toBe('[Replying to Elowen: "Hotovo."]\na proč?');

      await adapter.onMessage({
        ...turn, id: 'M2', content: 'jak to myslíš?',
        referenced_message: { author: { id: 'U2', username: 'bob' }, content: 'tohle\n-# můj vlastní subtext' },
      });
      expect(seen[1]).toBe('[Replying to bob: "tohle\n-# můj vlastní subtext"]\njak to myslíš?');
    });
  });
});

describe('discord /help renders the passed command list (single-source, no drift)', () => {
  // Adopted from the package's sharedMessages suite, which covered every adapter at once and so could
  // not travel with any single one. help() renders whatever list it is handed; the shared renderer
  // localizes the built-ins, and a plugin's own command falls back to its English description.
  const list = (names: string[]) => names.map((name) => ({ name }));

  it('lists /context localized in every language', async () => {
    const { MESSAGES } = await import(join(repoRoot, 'plugins/discord/lib/messages.mjs')) as {
      MESSAGES: Record<string, { help(name: string, cmds: { name: string; description?: string }[]): string }>;
    };
    for (const lang of ['en', 'cs', 'sk']) {
      expect(MESSAGES[lang].help('Elowen', list(['context']))).toContain('/context');
    }
  });

  it('renders a plugin prompt-command via its own English description', async () => {
    const { MESSAGES } = await import(join(repoRoot, 'plugins/discord/lib/messages.mjs')) as {
      MESSAGES: Record<string, { help(name: string, cmds: { name: string; description?: string }[]): string }>;
    };
    const body = MESSAGES.en.help('Elowen', [{ name: 'stop' }, { name: 'deploy', description: 'Ship it' }]);
    expect(body).toContain('Elowen on Discord');
    expect(body).toContain('/stop'); // built-in still localized from HELP_DESCRIPTIONS
    expect(body).toContain('`/deploy` — Ship it'); // plugin command appears, fallback description
  });

  // Shared-message inheritance for this adapter moved to tests/sharedMessages.test.ts, which asserts
  // EVERY shared key for all four chat adapters at once — this checked three of them, for discord alone.
});
