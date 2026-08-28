// @vitest-environment node
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlugins } from 'elowen/dist/plugins/loader.js';

const log = { info() {}, warn() {}, error() {} };
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('telegram chat and member lookups', () => {
  type Tool = { name: string; execute: (id: string, p: unknown) => Promise<{ content: { text: string }[] }> };
  const loadTools = async (api: Record<string, unknown>, admin = true): Promise<Tool[]> => {
    const { registerTools } = await import(join(repoRoot, 'plugins/telegram/lib/tools.mjs')) as {
      registerTools: (ctx: unknown, adapter: unknown) => void;
    };
    const tools: Tool[] = [];
    registerTools(
      {
        registerTool: (t: never) => tools.push(t),
        isAdminSession: () => admin,
        currentIdentity: () => ({ owner: false }),
        config: {},
      },
      { requireBot: () => ({ api }), callApi: async () => ({ ok: true }) },
    );
    return tools;
  };
  const run = async (api: Record<string, unknown>, name: string, params: unknown, admin = true) => {
    const tool = (await loadTools(api, admin)).find((t) => t.name === name)!;
    return (await tool.execute('t', params)).content[0].text;
  };

  it('reports the pinned message id so it can be unpinned', async () => {
    const text = await run(
      { getChat: async () => ({ id: -100, type: 'supergroup', pinned_message: { message_id: 42, text: 'Read  the\nrules' } }) },
      'TelegramChatInfo', { chatId: '-100' },
    );
    expect(text).toContain('pinned: 42 — Read the rules');
  });

  it('says so explicitly when nothing is pinned, and survives a pin with no text', async () => {
    expect(await run({ getChat: async () => ({ id: 1, type: 'group' }) }, 'TelegramChatInfo', { chatId: '1' }))
      .toContain('pinned: none');
    expect(await run(
      { getChat: async () => ({ id: 1, type: 'group', pinned_message: { message_id: 7 } }) },
      'TelegramChatInfo', { chatId: '1' },
    )).toContain('pinned: 7 (no text)');
  });

  it('lists the administrator rights the response actually granted', async () => {
    const text = await run(
      {
        getChatMember: async () => ({
          status: 'administrator', user: { id: 5, first_name: 'Ada' },
          custom_title: 'Boss', is_anonymous: true,
          can_delete_messages: true, can_pin_messages: true, can_promote_members: false,
        }),
      },
      'TelegramMemberInfo', { chatId: '1', userId: 5 },
    );
    expect(text).toContain('rights: can_delete_messages, can_pin_messages');
    expect(text).not.toContain('can_promote_members'); // not granted → not advertised
    expect(text).toContain('title: Boss');
    expect(text).toContain('anonymous: true');
  });

  it('leaves the rights line out for an ordinary member', async () => {
    const text = await run(
      { getChatMember: async () => ({ status: 'member', user: { id: 9, first_name: 'Bo' } }) },
      'TelegramMemberInfo', { chatId: '1', userId: 9 },
    );
    expect(text).toContain('status: member');
    expect(text).not.toContain('rights:');
  });

  // No tool in this plugin decides for itself who may call it any more: that is the users modal's job
  // (per-account plugin grants plus the per-tool deny-list). A scoped, non-operator session therefore
  // reaches the curated tools AND the raw Bot API passthrough — an admin withholds either by unticking it.
  it('lets a project-scoped session reach curated tools and raw bot access alike', async () => {
    const info = await run(
      { getChat: async () => ({ id: 1, type: 'group' }) },
      'TelegramChatInfo', { chatId: '1' }, false,
    );
    expect(info).toContain('id: 1');
    expect(info).not.toContain('admin session');

    const raw = await run({ getMe: async () => ({ ok: true }) }, 'TelegramApi', { method: 'getMe' }, false);
    expect(raw).not.toContain('only available to the operator');
    expect(raw).not.toContain('admin session');
  });
});

describe('telegram plugin', () => {
  it('registers no platform without a botToken (warns instead of crashing)', async () => {
    const reg = await loadPlugins({ dirs: [join(repoRoot, 'plugins')], enabled: ['telegram'], logger: log });
    expect(reg.platforms).toHaveLength(0);
  });

  it('registers the platform adapter when a botToken is configured', async () => {
    const reg = await loadPlugins({
      dirs: [join(repoRoot, 'plugins')], enabled: ['telegram'], logger: log,
      config: { telegram: { botToken: 'tok', rolePolicies: [] } },
    });
    expect(reg.platforms.map((p) => p.name)).toEqual(['telegram']);
  });

  it('declares every registered tool in its manifest (registry refuses undeclared tools)', async () => {
    const reg = await loadPlugins({
      dirs: [join(repoRoot, 'plugins')], enabled: ['telegram'], logger: log,
      config: { telegram: { botToken: 'tok', rolePolicies: [] } },
    });
    const names = reg.tools.map((t) => t.name).filter((n) => n.startsWith('Telegram'));
    expect(names).toContain('TelegramSend');
    expect(names).toContain('TelegramApi');
    expect(names).toContain('TelegramCreateForumTopic');
    expect(names.length).toBe(16);
  });
});

describe('telegram splitContent (code-block-aware chunking)', () => {
  it('never breaks a fenced code block across a chunk boundary', async () => {
    const { splitContent } = await import(join(repoRoot, 'plugins/telegram/index.mjs')) as { splitContent: (t: string) => string[] };
    const big = '```js\n' + 'const x = 1;\n'.repeat(500) + '```'; // > 4000 chars, one fence
    const pieces = splitContent(big);
    expect(pieces.length).toBeGreaterThan(1);
    for (const p of pieces) {
      expect(p.length).toBeLessThanOrEqual(4100);
      expect((p.match(/```/g)?.length ?? 0) % 2).toBe(0); // every piece has balanced fences
    }
    expect(pieces.join('')).toContain('const x = 1;');
  });

  it('leaves short text untouched', async () => {
    const { splitContent } = await import(join(repoRoot, 'plugins/telegram/index.mjs')) as { splitContent: (t: string) => string[] };
    expect(splitContent('ahoj')).toEqual(['ahoj']);
  });

  it('renders markdown tables as bare rows because Telegram sends without parse_mode', async () => {
    const { splitContent } = await import(join(repoRoot, 'plugins/telegram/index.mjs')) as { splitContent: (t: string) => string[] };
    const pieces = splitContent('| A | B |\n| --- | --- |\n| 1 | 2 |');
    expect(pieces).toEqual(['A  B\n1  2']);
    expect(pieces[0]).not.toContain('```');
  });
});

describe('telegram buildAskKeyboard (inline keyboard)', () => {
  it('single-select single-question ask needs no Submit (a click answers instantly)', async () => {
    const { buildAskKeyboard } = await import(join(repoRoot, 'plugins/telegram/index.mjs')) as {
      buildAskKeyboard: (token: string, qs: unknown[], opts?: unknown) => { text: string; callback_data: string }[][];
    };
    const rows = buildAskKeyboard('t', [{ header: 'Pick', question: 'q', options: [{ label: 'A' }, { label: 'B' }] }]);
    const flat = rows.flat().map((b) => b.callback_data);
    expect(flat).toContain('a:t:0:0');
    expect(flat).toContain('a:t:0:1');
    expect(flat.some((d) => d.endsWith(':submit'))).toBe(false); // a single-select click answers instantly
    expect(flat.some((d) => d.endsWith(':other'))).toBe(true); // free-text Other on a single-question ask
  });

  it('a multiSelect ask carries a Submit button and no instant Other', async () => {
    const { buildAskKeyboard } = await import(join(repoRoot, 'plugins/telegram/index.mjs')) as {
      buildAskKeyboard: (token: string, qs: unknown[], opts?: unknown) => { text: string; callback_data: string }[][];
    };
    const rows = buildAskKeyboard('t', [{ header: 'Pick', question: 'q', multiSelect: true, options: [{ label: 'A' }, { label: 'B' }] }]);
    const flat = rows.flat().map((b) => b.callback_data);
    expect(flat.some((d) => d.endsWith(':submit'))).toBe(true);
  });
});

describe('telegram identity matching (rolePolicies)', () => {
  it('matches a Telegram user id, @username (case-insensitive) and chat id', async () => {
    const { matchesId, senderIds, senderIsAdmin } = await import(join(repoRoot, 'plugins/telegram/index.mjs')) as {
      matchesId: (a: string, b: string) => boolean;
      senderIds: (from: { id: number; username?: string }, chatId: number) => string[];
      senderIsAdmin: (ids: string[], policies: unknown[]) => boolean;
    };
    expect(matchesId('123456789', '123456789')).toBe(true);
    expect(matchesId('@Alice', '@alice')).toBe(true);
    expect(matchesId('@alice', 'alice')).toBe(true);
    expect(matchesId('123', '456')).toBe(false);
    const ids = senderIds({ id: 42, username: 'bob' }, -1001);
    expect(ids).toEqual(['42', '@bob', '-1001']);
    expect(senderIsAdmin(ids, [{ roleId: '@bob', admin: true }])).toBe(true);
    expect(senderIsAdmin(ids, [{ roleId: '@bob' }])).toBe(false); // not flagged admin
    expect(senderIsAdmin(ids, [{ roleId: '-1001', admin: true }])).toBe(true); // whole-chat admin policy
  });
});

/** The projection entries the adapter dispatches ITSELF, one per classification rather than a copy of the
 *  daemon's roster: a `surface-local` picker, a `session-control` picker (daemon-owned, but the chooser is
 *  drawn here) and a `surface-local` non-picker. That pair of fields is the adapter's whole input, so a
 *  longer list would only repeat cases these three already cover. */
const LOCAL_CATALOG = [
  { name: 'model', description: 'Switch the AI model', kind: 'picker', execution: 'surface-local' },
  { name: 'context', description: 'Continue this channel in one of your conversations', kind: 'picker', execution: 'session-control' },
  { name: 'help', description: 'Show the available commands', kind: 'info', execution: 'surface-local' },
];
const FAST_CATALOG = [...LOCAL_CATALOG, { name: 'fast', description: 'Set Fast mode', kind: 'action', execution: 'session-control' }];

describe('telegram paged pickers + /context', () => {
  const makeAdapter = async (models: unknown[], initial: Record<string, unknown> = {}, commands: unknown[] = LOCAL_CATALOG) => {
    const { TelegramAdapter } = await import(join(repoRoot, 'plugins/telegram/lib/adapter.mjs')) as { TelegramAdapter: new (...args: unknown[]) => any };
    const chats: Record<string, Record<string, unknown>> = { '5': initial };
    const state = {
      get: (id: string) => chats[id] ?? {},
      patch: (id: string, fields: Record<string, unknown>) => { chats[id] = { ...(chats[id] ?? {}), ...fields }; },
    };
    const adapter = new TelegramAdapter(
      { language: 'en', rolePolicies: [{ roleId: '42', admin: true }] },
      log, state, async () => models, [], () => null, () => false, () => commands,
    );
    const sent: { text: string; extra: any }[] = [];
    const edits: { text: string; extra: any }[] = [];
    const markups: any[] = [];
    adapter.tgSend = async (_chatId: number, text: string, extra: any = {}) => { sent.push({ text, extra }); return 111; };
    adapter.tgEdit = async (_chatId: number, _mid: number, text: string, extra: any = {}) => { edits.push({ text, extra }); return true; };
    adapter.bot = { api: { editMessageReplyMarkup: async (_c: number, _mid: number, other: any) => { markups.push(other); } } };
    return { adapter, chats, sent, edits, markups };
  };
  // A callback_query ctx for onCallback (admin sender id 42).
  const cbCtx = (data: string, fromId = 42) => ({
    callbackQuery: { data, from: { id: fromId }, message: { chat: { id: 5 }, message_id: 111 } },
    answerCallbackQuery: async () => {},
  });
  const adminIds = ['42'];

  const models20 = Array.from({ length: 20 }, (_, i) => ({ provider: 'p', providerLabel: 'Prov', model: `model-${i}` }));

  it('publishes /context in the command menu', async () => {
    const { adapter } = await makeAdapter([]);
    // The menu is built from the catalog now, so /context reaches Telegram exactly when the daemon
    // publishes it for this surface (it does — the catalog scopes it to the chat platforms).
    adapter.chatCommands = () => [{ name: 'context', description: 'Continue this channel in one of your conversations', kind: 'picker' }];
    let published: any[] = [];
    adapter.bot = { api: { setMyCommands: async (cmds: any[]) => { published = cmds; } } };
    await adapter.publishCommands();
    expect(published.find((c) => c.command === 'context')).toBeTruthy();
  });

  it('/model pages the FULL catalog (no .slice(0,40) truncation) and picks a model from a later page', async () => {
    const { adapter, chats, sent, markups } = await makeAdapter(models20);
    await adapter.handleCommand(5, { id: 42 }, adminIds, '/model');
    const kb0 = sent[0].extra.reply_markup.inline_keyboard;
    expect(kb0).toHaveLength(9); // 8 model rows + 1 nav row (PICKER_PAGE = 8)
    expect(adapter.pendingPickers.get('5').models).toHaveLength(20); // full list cached, nothing dropped
    // Navigate to page 1 → the keyboard redraws in place (no re-fetch).
    await adapter.onCallback(cbCtx('m_page:1'));
    const kb1 = markups[0].reply_markup.inline_keyboard;
    expect(kb1[0][0].callback_data).toBe('m:8'); // absolute indices continue past the first page
    // Pick model-12 (index 12, only reachable because the list is no longer truncated).
    await adapter.onCallback(cbCtx('m:12'));
    expect(chats['5']?.model).toEqual({ provider: 'p', model: 'model-12' });
  });

  it('/context lists the caller\'s own conversations and binds the pick with a privacy warning', async () => {
    const { adapter, sent, edits } = await makeAdapter([]);
    const listContext = vi.fn(() => ({ items: [{ id: 'brain-7-1', title: 'Refactor', model: 'gpt-5' }], total: 1, hasMore: false }));
    const bindContext = vi.fn(async () => ({ title: 'Refactor' }));
    adapter.control({ listContext, bindContext });
    await adapter.handleCommand(5, { id: 42 }, adminIds, '/context');
    expect(listContext).toHaveBeenCalledWith({ platform: 'telegram', channelId: '5#0' }, '42', { offset: 0, limit: 200 });
    expect(sent[0].extra.reply_markup.inline_keyboard[0][0].callback_data).toBe('c:0');
    await adapter.onCallback(cbCtx('c:0'));
    expect(bindContext).toHaveBeenCalledWith({ platform: 'telegram', channelId: '5#0' }, '42', 'brain-7-1');
    expect(edits.at(-1)!.text).toContain('Refactor');
    expect(edits.at(-1)!.text).toContain('continues');
  });

  it('/context is operator-gated (a non-admin sender is refused)', async () => {
    const { adapter, sent } = await makeAdapter([]);
    const listContext = vi.fn();
    adapter.control({ listContext, bindContext: vi.fn() });
    await adapter.handleCommand(5, { id: 999 }, ['999'], '/context');
    expect(listContext).not.toHaveBeenCalled();
    expect(sent.at(-1)!.text).toContain('Only the operator');
  });

  it('/fast passes the authentic Telegram user id for two senders, not the chat id', async () => {
    const models = [{ provider: 'openai', providerLabel: 'OpenAI', model: 'gpt-5.6-sol', fastAvailable: true }];
    const { adapter, chats } = await makeAdapter(models, {}, FAST_CATALOG);
    const setAccountFast = vi.fn((_ref: unknown, sender: string, on?: boolean) => ({ fast: on ?? sender === '42', fastAvailable: true }));
    const fastStatus = vi.fn((_ref: unknown, sender: string) => ({ fast: sender === '42', fastAvailable: true }));
    adapter.control({ setAccountFast, fastStatus });

    await adapter.handleCommand(5, { id: 42 }, ['42'], '/fast on');
    await adapter.handleCommand(5, { id: 43 }, ['43'], '/fast off');
    await adapter.handleCommand(5, { id: 42 }, ['42'], '/fast status');
    await adapter.handleCommand(5, { id: 43 }, ['43'], '/fast');

    const ref = { platform: 'telegram', channelId: '5#0' };
    expect(setAccountFast).toHaveBeenNthCalledWith(1, ref, '42', true);
    expect(setAccountFast).toHaveBeenNthCalledWith(2, ref, '43', false);
    expect(setAccountFast).toHaveBeenNthCalledWith(3, ref, '43', undefined);
    expect(fastStatus).toHaveBeenCalledWith(ref, '42');
    expect(setAccountFast.mock.calls.flat()).not.toContain('5');
    expect(chats['5']?.fast).toBeUndefined();
  });

  it('/fast fails closed for an unlinked Telegram user', async () => {
    const models = [{ provider: 'openai', providerLabel: 'OpenAI', model: 'gpt-5.6-sol', fastAvailable: true }];
    const { adapter, sent, chats } = await makeAdapter(models, {}, FAST_CATALOG);
    adapter.control({ setAccountFast: () => null, fastStatus: () => null });
    await adapter.handleCommand(5, { id: 99 }, ['99'], '/fast on');
    expect(sent.at(-1)!.text).toContain('Link this platform identity');
    expect(chats['5']?.fast).toBeUndefined();
  });

  /** The catalog decides for the LOCAL half too, not just for the names routed to the shared control core.
   *  An empty projection is what a failed or unanswered catalog fetch looks like, and this adapter used to
   *  answer its hardcoded switch through it regardless — so taking a command out of the projection did not
   *  take it away from anyone who typed it. */
  describe('an empty catalog means the adapter accepts nothing', () => {
    it.each(['/model', '/context', '/help'])('refuses %s and says nothing', async (text) => {
      const { adapter, sent } = await makeAdapter(models20, {}, []);
      adapter.control({ listContext: vi.fn(() => ({ items: [{ id: 'x', title: 'T', model: 'm' }], total: 1, hasMore: false })), bindContext: vi.fn() });
      expect(await adapter.handleCommand(5, { id: 42 }, adminIds, text)).toBe(false);
      expect(sent).toEqual([]);
    });

    /** The adapter's OWN commands go too. They are never published — the catalog declares them and each
     *  adapter registers its own — so nothing in the projection could gate them by name. What gates them
     *  is the projection being there AT ALL: a live catalog is this adapter's only evidence it is talking
     *  to a daemon, and a chat whose commands have gone quiet must not keep flipping stored state. */
    it.each(['/voice', '/display'])('refuses its own %s as well, and stores nothing', async (text) => {
      const { adapter, chats, sent } = await makeAdapter([], {}, []);
      expect(await adapter.handleCommand(5, { id: 42 }, adminIds, text)).toBe(false);
      expect(sent).toEqual([]);
      expect(chats['5']).toEqual({});
    });

    it('runs all five again once the daemon publishes a catalog', async () => {
      // The permissive direction: a gate that refused everything would pass every case above while
      // quietly taking the commands away from a healthy chat.
      for (const text of ['/model', '/context', '/help', '/voice', '/display']) {
        const { adapter, sent } = await makeAdapter(models20);
        adapter.control({ listContext: vi.fn(() => ({ items: [{ id: 'x', title: 'T', model: 'm' }], total: 1, hasMore: false })), bindContext: vi.fn() });
        expect(await adapter.handleCommand(5, { id: 42 }, adminIds, text), text).toBe(true);
        expect(sent.length, text).toBeGreaterThan(0);
      }
    });

    it('drops one local command the daemon stopped publishing, and keeps the rest', async () => {
      const { adapter } = await makeAdapter(models20, {}, LOCAL_CATALOG.filter((c) => c.name !== 'model'));
      expect(await adapter.handleCommand(5, { id: 42 }, adminIds, '/model')).toBe(false);
      expect(await adapter.handleCommand(5, { id: 42 }, adminIds, '/help')).toBe(true);
      // …and its own commands ride on the catalog being present, not on which names are in it.
      expect(await adapter.handleCommand(5, { id: 42 }, adminIds, '/voice')).toBe(true);
    });
  });
});

// Regression: the reply quote fed our own runtime footer (`— model · n %`) straight back into the prompt.
// Shown that line as the house style, the model starts writing it itself, inventing a model name it never
// ran on — and the forged line then rides the NEXT reply quote, reinforcing the pattern.
describe('telegram reply quote', () => {
  const makeAdapter = async () => {
    const { TelegramAdapter } = await import(join(repoRoot, 'plugins/telegram/lib/adapter.mjs')) as { TelegramAdapter: new (...args: unknown[]) => any };
    const state = { get: () => ({}), patch: () => {} };
    const adapter = new TelegramAdapter(
      { language: 'en', rolePolicies: [{ roleId: '42' }], streaming: false, reactions: false },
      log, state, async () => [],
    );
    adapter.botId = 7;
    adapter.bot = { api: { sendChatAction: async () => {} } };
    const seen: string[] = [];
    adapter.listen(async (_src: unknown, text: string) => { seen.push(text); return ''; });
    return { adapter, seen };
  };

  const turn = (reply: unknown) => ({
    message: {
      message_id: 1, chat: { id: 5, type: 'private' }, from: { id: 42, first_name: 'Anna' },
      text: 'a proč?', reply_to_message: reply,
    },
  });

  it('drops the footer when quoting our own message', async () => {
    const { adapter, seen } = await makeAdapter();
    await adapter.onMessage(turn({ from: { id: 7, first_name: 'Elowen', is_bot: true }, text: 'Hotovo.\n\n— qwen3.8-max-preview · 4 %' }));
    expect(seen[0]).toBe('[Replying to Elowen: "Hotovo."]\na proč?');
  });

  it('keeps a person\'s own trailing dim line verbatim', async () => {
    const { adapter, seen } = await makeAdapter();
    await adapter.onMessage(turn({ from: { id: 99, first_name: 'Bob' }, text: 'tohle\n— můj vlastní řádek' }));
    expect(seen[0]).toBe('[Replying to Bob: "tohle\n— můj vlastní řádek"]\na proč?');
  });
});

// Regression: publishCommands used to build its OWN hardcoded array of command names, so anything the
// daemon added to the catalog (plugin prompt macros, /stats, /skills, …) never reached the Bot API menu.
describe('telegram command menu publication', () => {
  type Published = { command: string; description: string };
  const makeAdapter = async (commands: { name: string; description: string; kind?: string; adminOnly?: boolean }[]) => {
    const { TelegramAdapter } = await import(join(repoRoot, 'plugins/telegram/lib/adapter.mjs')) as { TelegramAdapter: new (...args: unknown[]) => any };
    const warns: string[] = [];
    const adapter = new TelegramAdapter(
      { language: 'en' }, { ...log, warn: (m: string) => warns.push(m) },
      { get: () => ({}), patch: () => {} }, async () => [], [], () => null, () => false, () => commands,
    );
    const published: Published[][] = [];
    adapter.bot = { api: { setMyCommands: async (c: Published[]) => { published.push(c); } } };
    return { adapter, published, warns };
  };

  /** publishCommands reads exactly two fields off an entry: `kind` (which menu rank it lands in) and
   *  `adminOnly` (whether it may be advertised globally at all). So the fixture carries one entry per RANK
   *  and one of each gate — the smallest catalog that can tell a correct menu from a wrong one — instead
   *  of restating the daemon's roster, where seven of the eleven entries were the same case again. Two
   *  `action`s on purpose: rank 2 is the bucket that must keep the catalog's own order, and one entry
   *  could never show that. `standup` (a plugin prompt macro) and `restart` (operator-only) are the two
   *  regressions this block exists for, so both stay. */
  const catalog = [
    { name: 'new', description: 'Start a fresh conversation', kind: 'action' },
    { name: 'model', description: 'Switch the AI model', kind: 'picker' },
    { name: 'status', description: 'Session info — model, context and usage', kind: 'info' },
    { name: 'compact', description: 'Summarize the conversation to free up context', kind: 'action' },
    { name: 'restart', description: 'Restart the Elowen daemon', kind: 'action', adminOnly: true },
    { name: 'help', description: 'Show the available commands', kind: 'info' },
    { name: 'standup', description: 'Write today\'s standup', kind: 'prompt' },
  ];

  it('publishes every public catalog entry — including the ones no hardcoded list carried', async () => {
    const { adapter, published, warns } = await makeAdapter([
      ...catalog,
      { name: 'stats', description: 'Usage stats — this conversation and per-model totals', kind: 'info' },
    ]);
    await adapter.publishCommands();

    const names = published[0].map((c) => c.command);
    expect(names).toContain('stats');   // catalog entry the old hardcoded array could never publish
    expect(names).toContain('standup'); // plugin prompt macro, likewise
    expect(names).not.toContain('restart'); // the Bot API list is global; operator-only commands stay private
    // Ordering intent of the old list, now driven by catalog data: pickers, adapter-local, the rest in
    // catalog order, /help last.
    expect(names).toEqual([
      'model', 'voice', 'display',
      'new', 'status', 'compact', 'standup', 'stats', 'help',
    ]);
    // Descriptions come from the catalog, not from a local copy that can go stale.
    expect(published[0].find((c) => c.command === 'status')?.description).toBe('Session info — model, context and usage');
    expect(published[0].find((c) => c.command === 'voice')?.description).toBe('Toggle spoken audio replies in this chat');
    expect(warns).toEqual([]);
  });

  it('drops the entries Telegram would reject instead of losing the whole menu', async () => {
    const { adapter, published, warns } = await makeAdapter([
      // Core accepts kebab-case plugin macros, but Telegram forbids the dash.
      { name: 'weekly-report', description: 'valid plugin command, invalid Telegram command', kind: 'prompt' },
      { name: 'x'.repeat(33), description: 'over the 32-char name limit', kind: 'prompt' },
      { name: 'silent', description: '   ', kind: 'prompt' },
      { name: 'ok_macro', description: 'a'.repeat(400), kind: 'prompt' },
      ...catalog,
    ]);
    await adapter.publishCommands();

    const names = published[0].map((c) => c.command);
    expect(names).toContain('ok_macro');
    expect(names).toContain('help'); // the rest of the menu survived
    expect(names).not.toContain('silent');
    expect(names.some((n) => n.includes(' ') || n !== n.toLowerCase() || n.length > 32)).toBe(false);
    expect(published[0].find((c) => c.command === 'ok_macro')?.description).toHaveLength(256);
    expect(warns.join(' ')).toContain('weekly-report');
    expect(warns.join(' ')).toContain('silent');
  });

  it('stays inside the Bot API cap of 100 commands without dropping /help', async () => {
    const many = [
      ...Array.from({ length: 120 }, (_, i) => ({ name: `macro_${i}`, description: `macro ${i}`, kind: 'prompt' })),
      { name: 'help', description: 'Show the available commands', kind: 'info' },
    ];
    const { adapter, published, warns } = await makeAdapter(many);
    await adapter.publishCommands();

    const names = published[0].map((c) => c.command);
    expect(published[0]).toHaveLength(100);
    expect(names.slice(0, 3)).toEqual(['voice', 'display', 'macro_0']);
    expect(names.at(-1)).toBe('help');
    expect(names).not.toContain('macro_119');
    expect(warns.join(' ')).toContain('macro_97'); // the first dropped entry is named, not silently lost
  });
});

describe('telegram interleaved final ordering', () => {
  const makeAdapter = async () => {
    const { TelegramAdapter } = await import(join(repoRoot, 'plugins/telegram/lib/adapter.mjs')) as { TelegramAdapter: new (...args: unknown[]) => any };
    const adapter = new TelegramAdapter(
      {
        language: 'en', rolePolicies: [{ roleId: '42' }], reactions: false,
        streaming: true, deleteToolActivityAfterTurn: true, runtimeFooter: false,
      },
      log, { get: () => ({}), patch: () => {} }, async () => [],
    );
    adapter.botId = 7;
    adapter.bot = { api: { sendChatAction: async () => {} } };
    const sends: { text: string; extra: any }[] = [];
    const edits: string[] = [];
    adapter.tgSend = async (_chatId: number, text: string, extra: any = {}) => { sends.push({ text, extra }); return sends.length; };
    adapter.tgEdit = async (_chatId: number, _messageId: number, text: string) => { edits.push(text); return true; };
    adapter.tgDelete = async () => {};
    const turn = (messageId: number, userId: number) => ({
      message: { message_id: messageId, chat: { id: 5, type: 'private' }, from: { id: userId, first_name: userId === 42 ? 'Anna' : 'Bob' }, text: `message ${messageId}` },
    });
    return { adapter, sends, edits, turn };
  };

  it('sends a stale final as a new anchored reply and keeps the ordered control as an edit', async () => {
    const interleaved = await makeAdapter();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let progress!: () => void;
    const progressPosted = new Promise<void>((resolve) => { progress = resolve; });
    const originalSend = interleaved.adapter.tgSend;
    interleaved.adapter.tgSend = async (chatId: number, text: string, extra: any = {}) => {
      const result = await originalSend(chatId, text, extra);
      if (text.includes('Read')) progress();
      return result;
    };
    interleaved.adapter.listen(async (_src: unknown, _text: string, onEvent: (e: unknown) => void) => {
      onEvent({ type: 'tool', id: 't1', name: 'Read', detail: 'config', icon: '📄' });
      await gate;
      return 'Final answer.';
    });
    const first = interleaved.adapter.onMessage(interleaved.turn(1, 42));
    await progressPosted;
    await interleaved.adapter.onMessage(interleaved.turn(2, 99)); // visible, but rejected by access
    release();
    await first;

    expect(interleaved.sends).toHaveLength(2);
    expect(interleaved.sends[0].extra.reply_parameters.message_id).toBe(1);
    expect(interleaved.sends[1]).toMatchObject({ text: 'Final answer.', extra: { reply_parameters: { message_id: 1 } } });
    expect(interleaved.edits).not.toContain('Final answer.');

    const ordered = await makeAdapter();
    ordered.adapter.listen(async (_src: unknown, _text: string, onEvent: (e: unknown) => void) => {
      onEvent({ type: 'tool', id: 't1', name: 'Read', detail: 'config', icon: '📄' });
      return 'Final answer.';
    });
    await ordered.adapter.onMessage(ordered.turn(1, 42));
    expect(ordered.sends).toHaveLength(1);
    expect(ordered.edits.at(-1)).toBe('Final answer.');
  });
});

/** The same proof the Discord suite carries, for the same reason: the previous round added the reducer
 *  branches, every test passed, and nothing reached a user because no test drove an event THROUGH the
 *  installed `elowen-plugin-shared` into an adapter method. These do. */
describe('telegram delivers a shared file and retires a settled question through the installed reducer', () => {
  const STORED = `${'a'.repeat(64)}.bin`;
  let root: string;
  let chatFiles: string;

  const mkAdapter = async () => {
    const { TelegramAdapter } = await import(join(repoRoot, 'plugins/telegram/lib/adapter.mjs')) as { TelegramAdapter: new (...args: unknown[]) => any };
    const { LiveMessage } = await import(join(repoRoot, 'plugins/telegram/lib/stream.mjs')) as {
      LiveMessage: new (...args: unknown[]) => { onEvent: (e: unknown) => void; finalize: (reply?: string) => Promise<void> };
    };
    const state = { get: () => ({}), patch: () => {} };
    const adapter = new TelegramAdapter(
      { language: 'en', runtimeFooter: false },
      log, state, async () => [], [], () => null, () => false, () => [], chatFiles,
    );
    const wire: { kind: string; text: string }[] = [];
    const documents: { name: string; bytes: string; caption?: string }[] = [];
    const edits: { text: string; extra: any }[] = [];
    let n = 0;
    adapter.tgSend = async (_chatId: number, text: string) => { wire.push({ kind: 'text', text }); return ++n; };
    adapter.tgEdit = async (_chatId: number, _mid: number, text: string, extra: any = {}) => { edits.push({ text, extra }); return true; };
    adapter.bot = { api: {
      sendDocument: async (_chatId: number, file: any, opts: any = {}) => {
        wire.push({ kind: 'document', text: opts.caption ?? '' });
        documents.push({ name: file.filename ?? file.name, bytes: file.fileData?.toString?.() ?? '', caption: opts.caption });
      },
    } };
    return { adapter, LiveMessage, wire, documents, edits };
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'elowen-telegram-files-'));
    chatFiles = join(root, 'chat-files');
    mkdirSync(chatFiles);
    writeFileSync(join(chatFiles, STORED), 'PDF-BYTES');
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('sends a `file` event as a DOCUMENT, keeping the name and the bytes, ahead of the answer text', async () => {
    const { adapter, LiveMessage, wire, documents } = await mkAdapter();
    const lm = new LiveMessage(adapter, 5, 111);
    lm.onEvent({ type: 'file', ref: `/api/brain/chat-files/${STORED}`, name: 'report.pdf', size: 9, caption: 'Here is the report.' });
    await lm.finalize('Done — the report is attached.');

    expect(documents, 'the file event produced no document at all — the exact original defect').toHaveLength(1);
    expect(documents[0]!.name).toBe('report.pdf');
    expect(documents[0]!.bytes).toBe('PDF-BYTES');
    expect(documents[0]!.caption).toBe('Here is the report.');
    // A photo would re-encode and rename it; a document is what a shared PDF has to arrive as.
    expect(wire.findIndex((w) => w.kind === 'document'))
      .toBeLessThan(wire.findIndex((w) => w.text.includes('Done — the report is attached.')));
  });

  it('routes an `ask_resolved` event to resolveAsk, clearing the keyboard on the posted prompt', async () => {
    const { adapter, LiveMessage, edits } = await mkAdapter();
    const lm = new LiveMessage(adapter, 5, 111);
    lm.onEvent({ type: 'ask', id: 'q-1', questions: [{ header: 'Colour', question: 'Which?', options: [{ label: 'Blue' }] }] });
    await new Promise((r) => setTimeout(r, 0)); // postAsk is fire-and-forget inside the reducer
    expect(adapter.pendingAsks.size).toBe(1);

    lm.onEvent({ type: 'ask_resolved', id: 'q-1', reason: 'timeout' });
    await new Promise((r) => setTimeout(r, 0)); // so is resolveAsk

    expect(adapter.pendingAsks.size, 'the reducer never reached resolveAsk').toBe(0);
    expect(edits).toHaveLength(1);
    expect(edits[0]!.text).toContain('expired');
    expect(edits[0]!.extra.reply_markup.inline_keyboard).toEqual([]); // no live buttons may survive
  });

  it('leaves an ANSWERED question alone — the surface that answered already settled it', async () => {
    const { adapter, LiveMessage, edits } = await mkAdapter();
    const lm = new LiveMessage(adapter, 5, 111);
    lm.onEvent({ type: 'ask', id: 'q-1', questions: [{ header: 'Colour', question: 'Which?', options: [{ label: 'Blue' }] }] });
    await new Promise((r) => setTimeout(r, 0));
    lm.onEvent({ type: 'ask_resolved', id: 'q-1', reason: 'answered' });
    await new Promise((r) => setTimeout(r, 0));
    expect(adapter.pendingAsks.size).toBe(0);
    expect(edits).toEqual([]);
  });

  it('the REGISTERED plugin gets a real chat-files dir, beside the database not under plugins-data', async () => {
    const reg = await loadPlugins({
      dirs: [join(repoRoot, 'plugins')], enabled: ['telegram'], logger: log,
      config: { telegram: { botToken: 'tok', rolePolicies: [] } },
    });
    const adapter = reg.platforms[0] as unknown as { chatFilesDir: string };
    expect(resolve(adapter.chatFilesDir).endsWith(`${sep}chat-files`)).toBe(true);
    expect(resolve(adapter.chatFilesDir)).not.toContain(`${sep}plugins-data${sep}`);
  });
});
