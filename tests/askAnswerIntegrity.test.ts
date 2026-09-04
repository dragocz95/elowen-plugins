// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { buildAskComponents, collectQuestionAnswers as collectDiscordAnswers } from '../plugins/discord/lib/ask.mjs';
import { buildAskKeyboard, collectQuestionAnswers as collectTelegramAnswers } from '../plugins/telegram/lib/ask.mjs';
import { collectQuestionAnswers as collectWhatsAppAnswers } from '../plugins/whatsapp/lib/ask.mjs';
import { buildAskCard, collectQuestionAnswers as collectTeamsAnswers } from '../plugins/msteams/lib/cards.mjs';

const log = { info() {}, warn() {}, error() {} };
const state = { get: () => ({}), patch: () => {} };

const questions = [
  { header: 'Mode', question: 'Which mode?', custom: false, options: [{ label: 'Safe' }, { label: 'Fast' }] },
  { header: 'Notes', question: 'Any details?', custom: true, options: [{ label: 'Short' }, { label: 'Detailed' }] },
];

const completeSelected = { 0: ['Safe'], 1: ['Detailed'] };

const collectors = [
  ['discord', collectDiscordAnswers],
  ['telegram', collectTelegramAnswers],
  ['whatsapp', collectWhatsAppAnswers],
  ['msteams', collectTeamsAnswers],
] as const;

describe.each(collectors)('%s pending answer contract', (_platform, collectAnswers) => {
  it('preserves question order and points at the first unanswered item', () => {
    expect(collectAnswers(questions, { 0: ['Safe'] }, { 1: ' Needs review ' })).toEqual({
      answers: [
        { header: 'Mode', selected: ['Safe'] },
        { header: 'Notes', selected: [], other: 'Needs review' },
      ],
      next: -1,
    });
    expect(collectAnswers(questions, { 0: ['Safe'] }, {})).toMatchObject({ next: 1 });
  });
});

describe('discord AskUserQuestion answer integrity', () => {
  const makeAdapter = async (answerQuestion: (id: string, answers: unknown[]) => boolean) => {
    const { DiscordAdapter } = await import('../plugins/discord/lib/adapter.mjs') as { DiscordAdapter: new (...args: unknown[]) => any };
    const adapter = new DiscordAdapter({ language: 'en' }, log, state, async () => [], [], () => null, answerQuestion);
    const responses: unknown[] = [];
    const edits: unknown[] = [];
    adapter.respond = async (_interaction: unknown, _type: number, body: unknown) => { responses.push(body); };
    adapter.rest = async (method: string, _path: string, body: unknown) => {
      if (method === 'PATCH') edits.push(body);
      return {};
    };
    adapter.handler = async () => undefined;
    return { adapter, responses, edits };
  };

  const interaction = (customId: string) => ({ data: { custom_id: customId }, member: { user: { id: 'U' }, roles: [] } });

  it('keeps a complete pending ask interactive when core refuses the answer', async () => {
    const calls: unknown[][] = [];
    const { adapter, responses } = await makeAdapter((_id, answers) => { calls.push(answers); return false; });
    adapter.pendingAsks.set('Q', {
      channelId: 'C', messageId: 'M', askerId: 'U', questions, selected: structuredClone(completeSelected), other: {},
      awaitingText: false, title: 'Input needed', desc: 'Questions',
    });

    await adapter.onAskInteraction(interaction('ask:Q:submit'));

    expect(calls).toHaveLength(1);
    expect(adapter.pendingAsks.has('Q')).toBe(true);
    expect(JSON.stringify(responses)).not.toContain('expired');
  });

  it('does not submit an unanswered item and still renders a way to complete it', async () => {
    const calls: unknown[][] = [];
    const { adapter, responses } = await makeAdapter((_id, answers) => { calls.push(answers); return true; });
    adapter.pendingAsks.set('Q', {
      channelId: 'C', messageId: 'M', askerId: 'U', questions, selected: { 0: ['Safe'] }, other: {},
      awaitingText: false, title: 'Input needed', desc: 'Questions',
    });

    await adapter.onAskInteraction(interaction('ask:Q:submit'));

    expect(calls).toEqual([]);
    expect(adapter.pendingAsks.has('Q')).toBe(true);
    expect(JSON.stringify(responses)).toContain('ask:Q:other:1');
  });

  it('submits one answer per question after a multi-question custom reply', async () => {
    const calls: unknown[][] = [];
    const { adapter } = await makeAdapter((_id, answers) => { calls.push(answers); return true; });
    adapter.pendingAsks.set('Q', {
      channelId: 'C', messageId: 'M', askerId: 'U', questions, selected: { 0: ['Safe'] }, other: {},
      awaitingText: false, title: 'Input needed', desc: 'Questions',
    });

    await adapter.onAskInteraction(interaction('ask:Q:other:1'));
    await adapter.onMessage({ type: 0, guild_id: 'G', channel_id: 'C', author: { id: 'U', bot: false }, content: 'Needs review' });

    expect(calls).toEqual([[
      { header: 'Mode', selected: ['Safe'] },
      { header: 'Notes', selected: [], other: 'Needs review' },
    ]]);
    expect(adapter.pendingAsks.has('Q')).toBe(false);
  });

  it('offers Other for the unanswered custom item in a multi-question ask', () => {
    const ids = buildAskComponents('Q', questions, { selected: { 0: ['Safe'] } })
      .flatMap((row: { components: { custom_id?: string }[] }) => row.components.map((component) => component.custom_id));
    expect(ids).toContain('ask:Q:other:1');
  });
});

describe('telegram AskUserQuestion answer integrity', () => {
  const makeAdapter = async (answerQuestion: (id: string, answers: unknown[]) => boolean) => {
    const { TelegramAdapter } = await import('../plugins/telegram/lib/adapter.mjs') as { TelegramAdapter: new (...args: unknown[]) => any };
    const adapter = new TelegramAdapter({ language: 'en' }, log, state, async () => [], [], () => null, answerQuestion);
    const edits: { text: string; extra: unknown }[] = [];
    adapter.tgEdit = async (_chatId: number, _messageId: number, text: string, extra: unknown) => { edits.push({ text, extra }); return true; };
    adapter.handler = async () => undefined;
    return { adapter, edits };
  };

  const callback = (data: string) => ({
    callbackQuery: { data, from: { id: 42 }, message: { chat: { id: 5 }, message_id: 11 } },
    answerCallbackQuery: async () => {},
  });
  const pending = (selected: Record<number, string[]>) => ({
    id: 'ask-1', chatId: 5, messageId: 11, askerId: 42, questions, selected, other: {}, awaitingText: false,
    title: 'Input needed', desc: 'Questions', createdAt: Date.now(),
  });

  it('keeps a complete pending ask and does not render expired when core returns false', async () => {
    const calls: unknown[][] = [];
    const { adapter, edits } = await makeAdapter((_id, answers) => { calls.push(answers); return false; });
    adapter.pendingAsks.set('t', pending(structuredClone(completeSelected)));

    await adapter.onAskInteraction(callback('a:t:submit'));

    expect(calls).toHaveLength(1);
    expect(adapter.pendingAsks.has('t')).toBe(true);
    expect(edits.map((edit) => edit.text).join('\n')).not.toContain('expired');
  });

  it('does not submit an unanswered item and keeps completion controls visible', async () => {
    const calls: unknown[][] = [];
    const { adapter, edits } = await makeAdapter((_id, answers) => { calls.push(answers); return true; });
    adapter.pendingAsks.set('t', pending({ 0: ['Safe'] }));

    await adapter.onAskInteraction(callback('a:t:submit'));

    expect(calls).toEqual([]);
    expect(adapter.pendingAsks.has('t')).toBe(true);
    expect(JSON.stringify(edits.at(-1)?.extra)).toContain('a:t:other:1');
  });

  it('submits the full payload after custom text answers the missing item', async () => {
    const calls: unknown[][] = [];
    const { adapter } = await makeAdapter((_id, answers) => { calls.push(answers); return true; });
    adapter.pendingAsks.set('t', pending({ 0: ['Safe'] }));

    await adapter.onAskInteraction(callback('a:t:other:1'));
    await adapter.onMessage({ message: { from: { id: 42 }, chat: { id: 5, type: 'private' }, text: 'Needs review' } });

    expect(calls).toEqual([[
      { header: 'Mode', selected: ['Safe'] },
      { header: 'Notes', selected: [], other: 'Needs review' },
    ]]);
    expect(adapter.pendingAsks.has('t')).toBe(false);
  });

  it('offers Other for the unanswered custom item in a multi-question ask', () => {
    const ids = buildAskKeyboard('t', questions, { selected: { 0: ['Safe'] } }).flat().map((button) => button.callback_data);
    expect(ids).toContain('a:t:other:1');
  });
});

describe('whatsapp AskUserQuestion answer integrity', () => {
  const chat = '420111222333@s.whatsapp.net';
  const sender = '420111222333@s.whatsapp.net';
  const makeAdapter = async (answerQuestion: (id: string, answers: unknown[]) => boolean) => {
    const { WhatsAppAdapter } = await import('../plugins/whatsapp/lib/adapter.mjs') as { WhatsAppAdapter: new (...args: unknown[]) => any };
    const adapter = new WhatsAppAdapter({ language: 'en' }, log, state, async () => [], [], '', '', answerQuestion);
    const sent: string[] = [];
    adapter.sendText = async (_jid: string, text: string) => { sent.push(text); };
    return { adapter, sent };
  };

  const pending = (selected: Record<number, string[]>) => ({
    jid: chat, askerJid: sender, questions, selected, other: {}, createdAt: Date.now(),
  });

  it('keeps a complete pending ask and does not say expired when core returns false', async () => {
    const calls: unknown[][] = [];
    const { adapter, sent } = await makeAdapter((_id, answers) => { calls.push(answers); return false; });
    adapter.pendingAsks.set('ask-1', pending(structuredClone(completeSelected)));

    expect(await adapter.handleTextReply(chat, sender, 'submit', {})).toBe(true);

    expect(calls).toHaveLength(1);
    expect(adapter.pendingAsks.has('ask-1')).toBe(true);
    expect(sent.join('\n')).not.toContain('expired');
  });

  it('does not submit an unanswered item and prompts for that item', async () => {
    const calls: unknown[][] = [];
    const { adapter, sent } = await makeAdapter((_id, answers) => { calls.push(answers); return true; });
    adapter.pendingAsks.set('ask-1', pending({ 0: ['Safe'] }));

    expect(await adapter.handleTextReply(chat, sender, 'submit', {})).toBe(true);

    expect(calls).toEqual([]);
    expect(adapter.pendingAsks.has('ask-1')).toBe(true);
    expect(sent.at(-1)).toContain('Notes');
  });

  it('submits the full payload when text answers the missing custom item', async () => {
    const calls: unknown[][] = [];
    const { adapter } = await makeAdapter((_id, answers) => { calls.push(answers); return true; });
    adapter.pendingAsks.set('ask-1', pending({ 0: ['Safe'] }));

    expect(await adapter.handleTextReply(chat, sender, 'Needs review', {})).toBe(true);

    expect(calls).toEqual([[
      { header: 'Mode', selected: ['Safe'] },
      { header: 'Notes', selected: [], other: 'Needs review' },
    ]]);
    expect(adapter.pendingAsks.has('ask-1')).toBe(false);
  });
});

describe('msteams AskUserQuestion answer integrity', () => {
  const makeAdapter = async (answerQuestion: (id: string, answers: unknown[]) => boolean) => {
    const { MsTeamsAdapter } = await import('../plugins/msteams/lib/adapter.mjs') as { MsTeamsAdapter: new (...args: unknown[]) => any };
    const adapter = new MsTeamsAdapter({ language: 'en' }, log, state, async () => [], [], () => null, answerQuestion);
    const edits: unknown[] = [];
    adapter.tmEdit = async (...args: unknown[]) => { edits.push(args); };
    adapter.resolveUpn = async () => null;
    adapter.isAdmin = () => true;
    return { adapter, edits };
  };

  const pending = (selected: string[][]) => ({
    id: 'ask-1', conversationId: 'conv', activityId: 'activity', questions, selected, other: [], askerId: 'owner',
  });

  it('keeps a complete pending ask and does not settle it as expired when core returns false', async () => {
    const calls: unknown[][] = [];
    const { adapter, edits } = await makeAdapter((_id, answers) => { calls.push(answers); return false; });
    adapter.pendingAsks.set('t', pending([['Safe'], ['Detailed']]));

    await adapter.settleAsk('t', adapter.pendingAsks.get('t'));

    expect(calls).toHaveLength(1);
    expect(adapter.pendingAsks.has('t')).toBe(true);
    expect(JSON.stringify(edits)).not.toContain('expired');
  });

  it('does not submit an unanswered item', async () => {
    const calls: unknown[][] = [];
    const { adapter } = await makeAdapter((_id, answers) => { calls.push(answers); return true; });
    adapter.pendingAsks.set('t', pending([['Safe'], []]));

    await adapter.settleAsk('t', adapter.pendingAsks.get('t'));

    expect(calls).toEqual([]);
    expect(adapter.pendingAsks.has('t')).toBe(true);
  });

  it('submits one answer per question from a multi-question custom card value', async () => {
    const calls: unknown[][] = [];
    const { adapter } = await makeAdapter((_id, answers) => { calls.push(answers); return true; });
    adapter.pendingAsks.set('t', pending([['Safe'], []]));

    await adapter.onAskAction(
      { id: 'incoming', serviceUrl: 'https://example.test' },
      { id: 'conv' },
      { id: 'sender' },
      { ea: 't', s: 1, other1: 'Needs review' },
    );

    expect(calls).toEqual([[
      { header: 'Mode', selected: ['Safe'] },
      { header: 'Notes', selected: [], other: 'Needs review' },
    ]]);
    expect(adapter.pendingAsks.has('t')).toBe(false);
  });

  it('renders a custom text input for each eligible question', () => {
    const card = buildAskCard('t', questions) as { content: { body: { type: string; id?: string }[] } };
    const ids = card.content.body.filter((item) => item.type === 'Input.Text').map((item) => item.id);
    expect(ids).toEqual(['other1']);
  });
});
