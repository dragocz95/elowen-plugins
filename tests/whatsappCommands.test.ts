// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { join } from 'node:path';

const repoRoot = join(__dirname, '..');
const log = { info() {}, warn() {}, error() {} };
const CHAT = '420123456789@s.whatsapp.net';

describe('whatsapp token-list config compatibility', () => {
  it('accepts legacy and array group JIDs', async () => {
    const { splitList } = await import(join(repoRoot, 'plugins/whatsapp/lib/adapter.mjs')) as {
      splitList: (value: unknown) => string[];
    };
    expect(splitList('111@g.us, 222@g.us\n999@g.us')).toEqual(['111@g.us', '222@g.us', '999@g.us']);
    expect(splitList(['111@g.us', ' 999@g.us ', '222@g.us'])).toEqual(['111@g.us', '999@g.us', '222@g.us']);
  });
});

interface ModelOption {
  provider: string;
  providerLabel: string;
  model: string;
  reasoningLevels?: string[];
  reasoningLabels?: Record<string, string>;
  fastAvailable?: boolean;
  default?: boolean;
}

interface TestAdapter {
  pendingMenus: Map<string, unknown>;
  control(api: {
    status?: (ref: unknown) => { provider?: string; model: string } | null;
    fastStatus?: (ref: unknown, sender: string) => { fast: boolean; fastAvailable: boolean } | null;
    setAccountFast?: (ref: unknown, sender: string, on?: boolean) => { fast: boolean; fastAvailable: boolean } | null;
    listContext?: (ref: unknown, sender: string, opts: unknown) => { items: { id: string; title: string; model: string }[]; total: number; hasMore: boolean } | null;
    bindContext?: (ref: unknown, sender: string, sessionId: string) => Promise<{ title: string }>;
  }): void;
  handleCommand(chatJid: string, senderJid: string, text: string): Promise<boolean>;
  isPromptCommand(text: string): boolean;
  handleTextReply(chatJid: string, senderJid: string, text: string, message: unknown): Promise<boolean>;
}

/** A projection with one entry per CLASSIFICATION the adapter reacts to, not a transcript of the real
 *  catalog. `kind` × `execution` is the entire input to both decisions the adapter makes — which names go
 *  to the shared control core, and which it dispatches itself — so one representative of each is what the
 *  tests actually exercise, and copying the daemon's roster in would only add names that exercise a case
 *  already covered. The specific names are the ones individual tests below reach for.
 *
 *  A catalog entry without `execution` is a command this adapter will not claim at all, which is why
 *  every entry carries it. */
const CATALOG = [
  { name: 'fast', kind: 'action', execution: 'session-control' },      // daemon-run action
  { name: 'stats', kind: 'info', execution: 'session-control' },       // daemon-run, replies rather than acts
  { name: 'model', kind: 'picker', execution: 'surface-local' },       // adapter-run picker
  { name: 'reasoning', kind: 'picker', execution: 'surface-local' },   // adapter-run picker (named by tests below)
  { name: 'help', kind: 'info', execution: 'surface-local' },          // adapter-run, non-picker
  { name: 'context', kind: 'picker', execution: 'session-control' },   // daemon-owned, but the chooser is local
];

const makeAdapter = async (models: ModelOption[], initial: Record<string, unknown> = {}, language = 'en', commands: { name: string; kind?: string; execution?: string }[] = CATALOG) => {
  const { WhatsAppAdapter } = await import(join(repoRoot, 'plugins/whatsapp/lib/adapter.mjs')) as {
    WhatsAppAdapter: new (...args: unknown[]) => TestAdapter & { sendText: (jid: string, text: string) => Promise<void> };
  };
  const chats: Record<string, Record<string, unknown>> = { [CHAT]: initial };
  const state = {
    get: (id: string) => chats[id] ?? {},
    patch: (id: string, fields: Record<string, unknown>) => { chats[id] = { ...(chats[id] ?? {}), ...fields }; },
  };
  const adapter = new WhatsAppAdapter(
    { language, senderPolicies: [{ roleId: CHAT, admin: true }] },
    log, state, async () => models, [], '', '', () => false, () => commands,
  );
  const sent: string[] = [];
  adapter.sendText = async (_jid: string, text: string) => { sent.push(text); };
  return { adapter, chats, sent };
};

describe('whatsapp reasoning command capabilities', () => {
  it('builds the numbered menu only from the selected model and displays max/ultra labels', async () => {
    const models: ModelOption[] = [
      { provider: 'plain', providerLabel: 'Plain', model: 'chat-only' },
      {
        provider: 'openai', providerLabel: 'OpenAI OAuth', model: 'gpt-5.4',
        reasoningLevels: ['low', 'xhigh'], reasoningLabels: { low: 'low', xhigh: 'ultra' },
      },
      {
        provider: 'anthropic', providerLabel: 'Anthropic', model: 'claude-opus-4-8',
        reasoningLevels: ['minimal', 'high', 'xhigh'], reasoningLabels: { minimal: 'minimal', high: 'high', xhigh: 'max' },
      },
    ];
    const { adapter, chats, sent } = await makeAdapter(models, { model: { provider: 'openai', model: 'gpt-5.4' } });

    expect(await adapter.handleCommand(CHAT, CHAT, '/reasoning')).toBe(true);
    expect(sent[0]).toContain('1. *default* — model default');
    expect(sent[0]).toContain('2. *low*');
    expect(sent[0]).toContain('3. *ultra*');
    expect(sent[0]).not.toContain('*minimal*');

    expect(await adapter.handleTextReply(CHAT, CHAT, '3', {})).toBe(true);
    expect(chats[CHAT]?.thinkingLevel).toBe('xhigh');
    expect(sent.at(-1)).toContain('Reasoning effort set to *ultra*');

    chats[CHAT] = { model: { provider: 'anthropic', model: 'claude-opus-4-8' } };
    await adapter.handleCommand(CHAT, CHAT, '/reasoning');
    expect(sent.at(-1)).toContain('4. *max*');
    expect(sent.at(-1)).not.toContain('*ultra*');
  });

  it('gives a clear localized message for models without configurable reasoning', async () => {
    const models = [{ provider: 'plain', providerLabel: 'Plain', model: 'chat-only' }];
    for (const [language, expected] of [
      ['en', 'does not support configurable reasoning effort'],
      ['cs', 'nepodporuje nastavitelnou úroveň uvažování'],
    ] as const) {
      const { adapter, sent } = await makeAdapter(models, { model: { provider: 'plain', model: 'chat-only' } }, language);
      await adapter.handleCommand(CHAT, CHAT, '/reasoning');
      expect(sent.at(-1)).toContain(expected);
      expect(adapter.pendingMenus.has(CHAT)).toBe(false);
    }
  });

  it('uses the daemon-resolved default model and localizes its default-level reply', async () => {
    const models: ModelOption[] = [
      { provider: 'plain', providerLabel: 'Plain', model: 'catalog-first' },
      { provider: 'openai', providerLabel: 'OAuth', model: 'actual-default', default: true, reasoningLevels: ['low'] },
    ];
    const { adapter, chats, sent } = await makeAdapter(models, {}, 'cs');
    await adapter.handleCommand(CHAT, CHAT, '/reasoning');
    expect(sent.at(-1)).toContain('*low*');
    expect(sent.at(-1)).toContain('*výchozí*');

    expect(await adapter.handleTextReply(CHAT, CHAT, '1', {})).toBe(true);
    expect(chats[CHAT]?.thinkingLevel).toBe('');
    expect(sent.at(-1)).toContain('*výchozí*');
    expect(sent.at(-1)).not.toContain('*default*');
  });

  it('revalidates a numeric menu reply when model capabilities change', async () => {
    const models: ModelOption[] = [{
      provider: 'openai', providerLabel: 'OpenAI OAuth', model: 'gpt-5.4',
      reasoningLevels: ['low', 'xhigh'], reasoningLabels: { xhigh: 'ultra' },
    }];
    const { adapter, chats, sent } = await makeAdapter(models, {
      model: { provider: 'openai', model: 'gpt-5.4' }, thinkingLevel: 'low',
    });
    await adapter.handleCommand(CHAT, CHAT, '/reasoning');
    models[0] = { provider: 'openai', providerLabel: 'OpenAI OAuth', model: 'gpt-5.4' };

    expect(await adapter.handleTextReply(CHAT, CHAT, '3', {})).toBe(true);
    expect(chats[CHAT]?.thinkingLevel).toBe('low');
    expect(sent.at(-1)).toContain('does not support configurable reasoning effort');
    expect(adapter.pendingMenus.has(CHAT)).toBe(false);
  });
});

describe('whatsapp /fast account control', () => {
  const GROUP = '120363000000000000@g.us';
  const ALICE = '420111111111@s.whatsapp.net';
  const BOB = '420222222222@s.whatsapp.net';
  const models: ModelOption[] = [{ provider: 'openai', providerLabel: 'OpenAI', model: 'gpt-5.6-sol', fastAvailable: true }];

  it('passes each authentic sender JID, never the group chat id, for on/off/status and bare toggle', async () => {
    const { adapter, chats } = await makeAdapter(models);
    const setAccountFast = vi.fn((_ref: unknown, sender: string, on?: boolean) => ({ fast: on ?? sender === ALICE, fastAvailable: true }));
    const fastStatus = vi.fn((_ref: unknown, sender: string) => ({ fast: sender === ALICE, fastAvailable: true }));
    adapter.control({ setAccountFast, fastStatus });

    await adapter.handleCommand(GROUP, ALICE, '/fast on');
    await adapter.handleCommand(GROUP, BOB, '/fast off');
    await adapter.handleCommand(GROUP, ALICE, '/fast status');
    await adapter.handleCommand(GROUP, BOB, '/fast');

    const ref = { platform: 'whatsapp', channelId: `${GROUP}#0` };
    expect(setAccountFast).toHaveBeenNthCalledWith(1, ref, ALICE, true);
    expect(setAccountFast).toHaveBeenNthCalledWith(2, ref, BOB, false);
    expect(setAccountFast).toHaveBeenNthCalledWith(3, ref, BOB, undefined);
    expect(fastStatus).toHaveBeenCalledWith(ref, ALICE);
    expect(setAccountFast.mock.calls.flat()).not.toContain(GROUP);
    expect(chats[GROUP]?.fast).toBeUndefined();
  });

  it('fails closed for an unlinked sender without creating plugin-owned Fast state', async () => {
    const { adapter, chats, sent } = await makeAdapter(models);
    adapter.control({ setAccountFast: () => null, fastStatus: () => null });
    expect(await adapter.handleCommand(GROUP, ALICE, '/fast on')).toBe(true);
    expect(sent.at(-1)).toContain('Link this platform identity');
    expect(chats[GROUP]?.fast).toBeUndefined();
  });

  it('keeps model selection independent from the account Fast preference', async () => {
    const choices: ModelOption[] = [
      { provider: 'openai', providerLabel: 'OpenAI', model: 'gpt-5.6-sol', fastAvailable: true },
      { provider: 'plain', providerLabel: 'Plain', model: 'chat-only' },
    ];
    const { adapter, chats } = await makeAdapter(choices, { model: { provider: 'openai', model: 'gpt-5.6-sol' } });
    await adapter.handleCommand(CHAT, CHAT, '/model');
    expect(await adapter.handleTextReply(CHAT, CHAT, '2', {})).toBe(true);
    expect(chats[CHAT]).toEqual({ model: { provider: 'plain', model: 'chat-only' } });
  });

  it('does not claim /fast when the shared WhatsApp command catalog omits it', async () => {
    const models = [{ provider: 'openai', providerLabel: 'OpenAI OAuth', model: 'gpt-5.4', fastAvailable: true }];
    const { adapter, sent } = await makeAdapter(models, { model: { provider: 'openai', model: 'gpt-5.4' } }, 'en', []);
    expect(await adapter.handleCommand(CHAT, CHAT, '/fast')).toBe(false);
    expect(sent).toEqual([]);
  });

  /** The other half of "the catalog decides". `/fast` goes through the shared control core, which is
   *  derived from the projection and so refused correctly on an empty one. The pickers and /help are
   *  dispatched by the adapter itself, and used to answer from a hardcoded switch no matter what the
   *  daemon had published — so removing a command from the projection did not stop anyone running it.
   *
   *  Empty is the shape a failed or unanswered catalog fetch takes, which is why the whole switch has to
   *  fail closed rather than each name being checked individually. */
  describe('an empty catalog means the adapter accepts nothing', () => {
    const models = [{ provider: 'openai', providerLabel: 'OpenAI OAuth', model: 'gpt-5.4', fastAvailable: true, reasoningLevels: ['low'] }];

    it.each(['/fast', '/model', '/reasoning', '/help', '/context'])('refuses %s and invents no reply', async (text) => {
      const { adapter, sent } = await makeAdapter(models, { model: { provider: 'openai', model: 'gpt-5.4' } }, 'en', []);
      adapter.control({ status: () => null, listContext: () => ({ items: [{ id: 's', title: 'T', model: 'm' }], total: 1, hasMore: false }) });
      expect(await adapter.handleCommand(CHAT, CHAT, text)).toBe(false);
      expect(sent).toEqual([]);
    });

    it('still runs each of them once the daemon publishes it', async () => {
      // The permissive direction: a gate that refused everything would pass every case above while
      // silently taking the commands away from a healthy channel.
      for (const text of ['/fast', '/model', '/reasoning', '/help', '/context']) {
        const { adapter, sent } = await makeAdapter(models, { model: { provider: 'openai', model: 'gpt-5.4' } });
        adapter.control({ status: () => null, listContext: () => ({ items: [{ id: 's', title: 'T', model: 'm' }], total: 1, hasMore: false }) });
        expect(await adapter.handleCommand(CHAT, CHAT, text), text).toBe(true);
        expect(sent.length, text).toBeGreaterThan(0);
      }
    });

    it('drops a local command the daemon stopped publishing, while the rest keep working', async () => {
      // Per-name, not just all-or-nothing: this is the promise that the projection — not the switch — is
      // what says a command exists.
      const withoutModel = CATALOG.filter((c) => c.name !== 'model');
      const { adapter, sent } = await makeAdapter(models, { model: { provider: 'openai', model: 'gpt-5.4' } }, 'en', withoutModel);
      expect(await adapter.handleCommand(CHAT, CHAT, '/model')).toBe(false);
      expect(sent).toEqual([]);
      expect(await adapter.handleCommand(CHAT, CHAT, '/reasoning')).toBe(true);
    });
  });

  /** The OTHER direction of the same rollout rule, and the one with no test before: a daemon NEWER than
   *  this adapter publishes a `session-control` command the shared core has no case for. `/clear` is real
   *  — it is session-control on the CLI and the web dock. The adapter must not swallow it just because the
   *  catalog listed it; only the intersection of "published" and "the core implements it" runs, so this
   *  falls through as an unknown /word and reaches the brain as ordinary text. */
  it('falls through a published control command the shared core cannot run', async () => {
    const catalog = [{ name: 'clear', kind: 'action', execution: 'session-control' }];
    const { adapter, sent } = await makeAdapter([], {}, 'en', catalog);
    expect(await adapter.handleCommand(CHAT, CHAT, '/clear')).toBe(false);
    expect(sent).toEqual([]); // no reply invented, and nothing silently eaten
  });

  it('joins ALL argument tokens, not just the first (the multi-arg parsing fix)', async () => {
    const models = [{ provider: 'openai', providerLabel: 'OpenAI OAuth', model: 'gpt-5.4', fastAvailable: true }];
    const { adapter, sent } = await makeAdapter(models, { model: { provider: 'openai', model: 'gpt-5.4' } });
    // Pre-fix, `const [cmd, arg] = split()` captured only 'on' and silently turned Fast on, dropping 'extra'.
    // Now the whole argument 'on extra' is passed, so the shared core rejects it as an invalid /fast value.
    expect(await adapter.handleCommand(CHAT, CHAT, '/fast on extra')).toBe(true);
    expect(sent.at(-1)).toContain('Usage');
  });
});

// WhatsApp advertises its commands ONLY through /help — there is no native command list on this
// transport. So /help is the contract: everything it lists must actually be dispatchable here. `voice`
// and `display` are reserved globally and appended by Discord/Telegram, but this adapter dispatches
// neither, so listing them would advertise dead commands.
describe('whatsapp /help lists only commands it can dispatch', () => {
  // The default classification set plus the two remaining shapes /help has to survive: a daemon-run
  // non-picker (`new`) and a plugin prompt macro, which is advertised but reaches the brain raw instead of
  // going through handleCommand.
  const catalog = [
    { name: 'new', kind: 'action', execution: 'session-control' },
    ...CATALOG,
    { name: 'standup', kind: 'prompt', execution: 'plugin-prompt', description: 'Write today\'s standup' },
  ];

  it('advertises exactly the catalog, and every advertised command is handled', async () => {
    const { adapter, sent } = await makeAdapter([], {}, 'en', catalog);
    adapter.control({ status: () => null, listContext: () => ({ items: [], total: 0, hasMore: false }) });

    expect(await adapter.handleCommand(CHAT, CHAT, '/help')).toBe(true);
    const listed = [...sent[0].matchAll(/`\/([a-z0-9_]+)`/g)].map((m) => m[1]);
    expect(listed).toEqual(catalog.map((c) => c.name));
    expect(listed).not.toContain('voice');   // not dispatched here — advertising it would be the drift
    expect(listed).not.toContain('display');

    for (const name of listed) {
      const handled = name === 'standup'
        ? adapter.isPromptCommand(`/${name}`) // routed RAW to the brain, not through handleCommand
        : await adapter.handleCommand(CHAT, CHAT, `/${name}`);
      expect(handled, `/${name} is advertised but not dispatched`).toBe(true);
    }
  });
});

describe('whatsapp paged menus + /context', () => {
  const models20 = Array.from({ length: 20 }, (_, i) => ({ provider: 'p', providerLabel: 'Prov', model: `model-${i}` }));

  it('/model pages the FULL catalog (no .slice(0,20) truncation) and picks a model from a later page', async () => {
    const { adapter, chats, sent } = await makeAdapter(models20);
    await adapter.handleCommand(CHAT, CHAT, '/model');
    // Page 1/2: 18 numbered models + a "Next page" nav entry (numbered 19) — nothing dropped.
    expect(sent[0]).toContain('(1/2)');
    expect(sent[0]).toContain('19. *➡️ Next page*');
    expect((adapter.pendingMenus.get(CHAT) as { options: unknown[] }).options).toHaveLength(20);
    // Selecting the nav entry re-renders page 2.
    expect(await adapter.handleTextReply(CHAT, CHAT, '19', {})).toBe(true);
    expect(sent.at(-1)).toContain('(2/2)');
    expect(sent.at(-1)).toContain('1. *model-18*');
    // Pick the first row of page 2 → model-18 (index 18), only reachable because the list is not truncated.
    expect(await adapter.handleTextReply(CHAT, CHAT, '1', {})).toBe(true);
    expect(chats[CHAT]).toMatchObject({ model: { provider: 'p', model: 'model-18' } });
  });

  it('/context lists the caller\'s own conversations and binds the pick with a privacy warning', async () => {
    const { adapter, sent } = await makeAdapter([]);
    const listContext = vi.fn(() => ({ items: [{ id: 'brain-7-1', title: 'Refactor', model: 'gpt-5' }], total: 1, hasMore: false }));
    const bindContext = vi.fn(async () => ({ title: 'Refactor' }));
    adapter.control({ listContext, bindContext });
    expect(await adapter.handleCommand(CHAT, CHAT, '/context')).toBe(true);
    expect(listContext).toHaveBeenCalledWith({ platform: 'whatsapp', channelId: `${CHAT}#0` }, CHAT, { offset: 0, limit: 200 });
    expect(sent.at(-1)).toContain('1. *Refactor*');
    expect(await adapter.handleTextReply(CHAT, CHAT, '1', {})).toBe(true);
    expect(bindContext).toHaveBeenCalledWith({ platform: 'whatsapp', channelId: `${CHAT}#0` }, CHAT, 'brain-7-1');
    expect(sent.at(-1)).toContain('Refactor');
    expect(sent.at(-1)).toContain('continues');
  });

  it('/context is operator-gated (a non-admin sender is refused)', async () => {
    const { adapter, sent } = await makeAdapter([]);
    const listContext = vi.fn();
    adapter.control({ listContext, bindContext: vi.fn() });
    expect(await adapter.handleCommand(CHAT, 'stranger@s.whatsapp.net', '/context')).toBe(true);
    expect(listContext).not.toHaveBeenCalled();
    expect(sent.at(-1)).toContain('Only the operator');
  });
});
