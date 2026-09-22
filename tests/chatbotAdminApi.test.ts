// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { PluginApiAuth } from 'elowen/plugin-api';
import { createAdminApi, percentileMs } from '../plugins/chatbot/src/adminApi.js';
import { validateActionRules } from '../plugins/chatbot/src/validation.js';
import { CHATBOT_SITE as SITE, NOW_MS, createChatbotHost, registerBot, type ChatbotHost } from './helpers/chatbotHost.js';

/** The administrator's own surface: the conversations of ONE chatbot, what was said in one of them, the
 *  plugin's own counters over a window of days, and the page-action rules that travel with a bot.
 *
 *  Every read here names the chatbot it is about, and the two things that make that name load-bearing are
 *  what this suite is really about: a second chatbot's visitor is not this chatbot's history, and a rule
 *  is stored only for a domain this chatbot actually answers on. Nothing here reads core: spend is not part
 *  of this API at all, because the only origin-attributed spend in this codebase is core's rollup. */

const ADMIN = { admin: true, userId: 1 } as PluginApiAuth;
const VIEWER = { admin: false, userId: 2 } as PluginApiAuth;

const HOUR = 3_600_000;
const iso = (ms: number): string => new Date(ms).toISOString();

function adminApiFor(host: ChatbotHost, clock: { ms: number } = { ms: NOW_MS }) {
  return {
    api: createAdminApi({
      store: host.store,
      stores: host.stores,
      publicBaseUrl: () => 'https://elowen.example.com',
      now: () => new Date(clock.ms),
    }),
    clock,
  };
}

/** Two chatbot accounts on one instance, which is the only arrangement in which "scoped to this chatbot"
 *  means anything. */
function twoChatbots(): ChatbotHost {
  return createChatbotHost({
    accounts: [
      { id: 12, username: 'ured-bot', name: 'Úřad', avatar: '', isAdmin: false, type: 'chatbot' },
      { id: 13, username: 'skola-bot', name: 'Škola', avatar: '', isAdmin: false, type: 'chatbot' },
    ],
  });
}

/** One finished turn with the answer the queue would have published, written straight into the plugin's
 *  own tables: this suite is about what the ADMIN API reads, not about how a turn is run. */
function recordTurn(host: ChatbotHost, input: {
  turnId: string;
  chatbotUserId: number;
  visitorId: string;
  at: number;
  status: 'done' | 'error' | 'running' | 'queued';
  message: string;
  reply?: string;
  startedAt?: number;
  errorCode?: string;
}): void {
  host.store.createTurn({
    turnId: input.turnId,
    chatbotUserId: input.chatbotUserId,
    visitorId: input.visitorId,
    clientTurnId: `uuid-${input.turnId}`,
    message: input.message,
    now: iso(input.at),
  });
  if (input.startedAt !== undefined) {
    host.store.markTurnRunning(input.turnId, iso(input.startedAt));
  }
  if (input.status === 'done' || input.status === 'error') {
    host.store.finishTurn({
      turnId: input.turnId,
      status: input.status,
      coreSessionId: null,
      errorCode: input.errorCode ?? null,
      now: iso(input.at + HOUR),
    });
    host.store.appendEvent(input.turnId, input.status, input.status === 'done' ? { text: input.reply ?? '' } : { code: input.errorCode ?? 'relay_failed' }, iso(input.at + HOUR));
  }
}

describe('the admin routes are admin-only, whatever the manifest says', () => {
  it.each(['list', 'conversations', 'conversation', 'stats'] as const)('refuses a non-admin caller at %s', async (method) => {
    const host = twoChatbots();
    const { api } = adminApiFor(host);
    const answer = method === 'list'
      ? await api.list(VIEWER)
      : method === 'conversations' ? await api.conversations(VIEWER, { chatbotUserId: '12' })
        : method === 'conversation' ? await api.conversation(VIEWER, { chatbotUserId: '12', visitorId: 'v1' })
          : await api.stats(VIEWER, { chatbotUserId: '12' });
    expect(answer).toMatchObject({ status: 403, body: { error: 'forbidden' } });
  });
});

describe('what the register offers to create a chatbot from', () => {
  it('offers accounts of kind chatbot, and never a person', async () => {
    // The server refuses a person at creation time anyway, but a register that OFFERS one invites an
    // administrator to fill a form that cannot succeed. Only the kind that may carry a chatbot is listed.
    const host = createChatbotHost({
      accounts: [
        { id: 12, username: 'ured-bot', name: 'Úřad', avatar: '', isAdmin: false, type: 'chatbot' },
        { id: 13, username: 'skola-bot', name: 'Škola', avatar: '', isAdmin: false, type: 'chatbot' },
        { id: 20, username: 'patulka', name: 'Patricie', avatar: '', isAdmin: false, type: 'human' },
        { id: 21, username: 'sabi', name: 'Sabina', avatar: '', isAdmin: false },
        { id: 1, username: 'boss', name: 'Šéf', avatar: '', isAdmin: true, type: 'human' },
      ],
    });
    const { api } = adminApiFor(host);

    const answer = await api.list(ADMIN);
    expect(answer.status).toBe(200);
    expect((answer.body as { candidates: { id: number }[] }).candidates.map((candidate) => candidate.id)).toEqual([12, 13]);

    // A chatbot that already has a register row is not offered again, whichever kind it is.
    registerBot(host, { chatbotUserId: 12 });
    const after = await api.list(ADMIN);
    expect((after.body as { candidates: { id: number }[] }).candidates.map((candidate) => candidate.id)).toEqual([13]);
  });
});

describe('the plugin\'s own counters', () => {
  it('counts this chatbot\'s turns per UTC day and reports the queue wait of the ones that started', async () => {
    const host = twoChatbots();
    const { api } = adminApiFor(host);
    registerBot(host, { chatbotUserId: 12 });
    registerBot(host, { chatbotUserId: 13, publicId: `cbt_${'c'.repeat(24)}` });

    const day = '2026-09-20';
    const dayMs = Date.parse(`${day}T08:00:00.000Z`);
    recordTurn(host, { turnId: 'a', chatbotUserId: 12, visitorId: 'v1', at: dayMs, status: 'done', message: 'ahoj', reply: 'Dobrý den', startedAt: dayMs + 2_000 });
    recordTurn(host, { turnId: 'b', chatbotUserId: 12, visitorId: 'v1', at: dayMs + HOUR, status: 'error', message: 'ahoj', startedAt: dayMs + HOUR + 8_000, errorCode: 'relay_failed' });
    recordTurn(host, { turnId: 'c', chatbotUserId: 12, visitorId: 'v2', at: dayMs + 2 * HOUR, status: 'queued', message: 'ahoj' });
    recordTurn(host, { turnId: 'd', chatbotUserId: 13, visitorId: 'v9', at: dayMs + 3 * HOUR, status: 'done', message: 'ahoj', reply: 'Nazdar', startedAt: dayMs + 3 * HOUR });

    const answer = await api.stats(ADMIN, { chatbotUserId: '12', from: day, to: '2026-09-22' });
    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({
      chatbotUserId: 12,
      from: day,
      to: '2026-09-22',
      days: [{ day, turns: 3, done: 1, errors: 1 }],
      totals: { turns: 3, done: 1, errors: 1, queued: 1, running: 0 },
      queueWait: { samples: 2, p50Seconds: 2, p95Seconds: 8 },
    });
    // The other chatbot's turn on the same day is not in this chatbot's counters.
    const other = await api.stats(ADMIN, { chatbotUserId: '13', from: day, to: '2026-09-22' });
    expect(other.body).toMatchObject({ days: [{ day, turns: 1, done: 1, errors: 0 }] });
  });

  it('states a window it cannot serve rather than answering something shorter', async () => {
    const host = twoChatbots();
    const { api } = adminApiFor(host);
    registerBot(host, { chatbotUserId: 12 });

    expect(await api.stats(ADMIN, { chatbotUserId: '12', from: '2026-09-21', to: '2026-09-01' }))
      .toMatchObject({ status: 400 });
    expect(await api.stats(ADMIN, { chatbotUserId: '12', from: '2024-01-01', to: '2026-09-21' }))
      .toMatchObject({ status: 400, body: { error: 'invalid_request' } });
    // A day the caller made up is not a window: the default one is used instead of a 400, exactly as the
    // route documents, and the answer says which window it answered for.
    const answer = await api.stats(ADMIN, { chatbotUserId: '12', from: 'nonsense', to: '2026-09-21' });
    expect(answer.status).toBe(200);
    expect((answer.body as { to: string }).to).toBe('2026-09-21');
  });

  it('reads the nearest-rank percentile off a real sample, and says nothing at all about an empty one', () => {
    expect(percentileMs([], 0.5)).toBeNull();
    expect(percentileMs([1_000, 2_000, 3_000, 4_000], 0.5)).toBe(2_000);
    expect(percentileMs([1_000, 2_000, 3_000, 4_000], 0.95)).toBe(4_000);
    // A single sample is its own p50 and its own p95 — the one turn anybody waited on.
    expect(percentileMs([7_000], 0.95)).toBe(7_000);
  });
});

describe('one chatbot\'s conversations', () => {
  it('lists a page of them per chatbot and never mixes two chatbots up', async () => {
    const host = twoChatbots();
    const { api } = adminApiFor(host);
    registerBot(host, { chatbotUserId: 12 });
    registerBot(host, { chatbotUserId: 13, publicId: `cbt_${'c'.repeat(24)}` });
    const dayMs = Date.parse('2026-09-20T08:00:00.000Z');
    recordTurn(host, { turnId: 'a', chatbotUserId: 12, visitorId: 'v1', at: dayMs, status: 'done', message: 'ahoj', reply: 'Ahoj' });
    recordTurn(host, { turnId: 'b', chatbotUserId: 12, visitorId: 'v1', at: dayMs + HOUR, status: 'error', message: 'ahoj', errorCode: 'relay_failed' });
    recordTurn(host, { turnId: 'c', chatbotUserId: 12, visitorId: 'v2', at: dayMs + 2 * HOUR, status: 'done', message: 'ahoj', reply: 'Ahoj' });
    recordTurn(host, { turnId: 'd', chatbotUserId: 13, visitorId: 'v9', at: dayMs + 3 * HOUR, status: 'done', message: 'ahoj', reply: 'Ahoj' });

    const first = await api.conversations(ADMIN, { chatbotUserId: '12' });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ total: 2, limit: 25, offset: 0 });
    // Newest activity first, with the counts of the turns behind each conversation.
    expect((first.body as { conversations: unknown[] }).conversations).toEqual([
      { visitorId: 'v2', turns: 1, errors: 0, firstAt: iso(dayMs + 2 * HOUR), lastAt: iso(dayMs + 2 * HOUR), lastStatus: 'done' },
      { visitorId: 'v1', turns: 2, errors: 1, firstAt: iso(dayMs), lastAt: iso(dayMs + HOUR), lastStatus: 'error' },
    ]);

    // Paging is the server's: the second page of one per page holds the other conversation, and nothing of
    // the other chatbot's.
    const paged = await api.conversations(ADMIN, { chatbotUserId: '12', limit: '1', offset: '1' });
    expect(paged.body).toMatchObject({ total: 2, limit: 1, offset: 1 });
    expect((paged.body as { conversations: { visitorId: string }[] }).conversations.map((row) => row.visitorId)).toEqual(['v1']);

    const other = await api.conversations(ADMIN, { chatbotUserId: '13' });
    expect((other.body as { conversations: { visitorId: string }[] }).conversations.map((row) => row.visitorId)).toEqual(['v9']);
  });

  it('reads one conversation oldest first, with the answers the plugin published', async () => {
    const host = twoChatbots();
    const { api } = adminApiFor(host);
    registerBot(host, { chatbotUserId: 12 });
    const dayMs = Date.parse('2026-09-20T08:00:00.000Z');
    recordTurn(host, { turnId: 'a', chatbotUserId: 12, visitorId: 'v1', at: dayMs, status: 'done', message: 'Kdy máte otevřeno?', reply: 'V pondělí od osmi.' });
    recordTurn(host, { turnId: 'b', chatbotUserId: 12, visitorId: 'v1', at: dayMs + HOUR, status: 'running', message: 'A v úterý?', startedAt: dayMs + HOUR });

    const answer = await api.conversation(ADMIN, { chatbotUserId: '12', visitorId: 'v1' });
    expect(answer.status).toBe(200);
    expect(answer.body).toEqual({
      chatbotUserId: 12,
      visitorId: 'v1',
      turns: [
        { turnId: 'a', visitorText: 'Kdy máte otevřeno?', reply: 'V pondělí od osmi.', status: 'done', errorCode: null, at: iso(dayMs) },
        // A turn that has not answered yet has no reply, which is not the same as an empty answer.
        { turnId: 'b', visitorText: 'A v úterý?', reply: null, status: 'running', errorCode: null, at: iso(dayMs + HOUR) },
      ],
    });
  });

  it('reads another chatbot\'s visitor as an empty conversation rather than as this chatbot\'s history', async () => {
    const host = twoChatbots();
    const { api } = adminApiFor(host);
    registerBot(host, { chatbotUserId: 12 });
    registerBot(host, { chatbotUserId: 13, publicId: `cbt_${'c'.repeat(24)}` });
    const dayMs = Date.parse('2026-09-20T08:00:00.000Z');
    recordTurn(host, { turnId: 'd', chatbotUserId: 13, visitorId: 'v9', at: dayMs, status: 'done', message: 'tajemství', reply: 'Ahoj' });

    const answer = await api.conversation(ADMIN, { chatbotUserId: '12', visitorId: 'v9' });
    expect(answer).toMatchObject({ status: 200, body: { chatbotUserId: 12, visitorId: 'v9', turns: [] } });
  });

  it('refuses a chatbot it does not know, and a request that names none', async () => {
    const host = twoChatbots();
    const { api } = adminApiFor(host);
    registerBot(host, { chatbotUserId: 12 });

    expect(await api.conversations(ADMIN, { chatbotUserId: '99' })).toMatchObject({ status: 404, body: { error: 'not_found' } });
    expect(await api.conversations(ADMIN, { chatbotUserId: 'nonsense' })).toMatchObject({ status: 400 });
    expect(await api.conversation(ADMIN, { chatbotUserId: '12' })).toMatchObject({ status: 400 });
    expect(await api.stats(ADMIN, {})).toMatchObject({ status: 400 });

    // An account that is not a chatbot at all is not a chatbot, even with a plugin row pointing at it.
    host.stores.usersRead.list().splice(0, host.stores.usersRead.list().length);
    expect(await api.conversations(ADMIN, { chatbotUserId: '12' })).toMatchObject({ status: 404, body: { error: 'account_unknown' } });
  });
});

describe('page-action rules travel with the bot and are stored as the server read them', () => {
  const rule = { origin: SITE, pathPrefix: '/kontakt', action: 'fill', requiresConfirmation: false, maxPerTurn: 2 };

  it('registers a draft with rules and reads them back', async () => {
    const host = twoChatbots();
    const { api } = adminApiFor(host);
    const answer = await api.create(ADMIN, {
      chatbotUserId: 12,
      displayName: 'Úřad',
      origins: [SITE],
      // The path arrives with a trailing slash and the action with a confirmation it may not carry: both are
      // normalised to what the policy resolver can actually match.
      actionRules: [{ ...rule, pathPrefix: '/kontakt/' }, { origin: SITE, pathPrefix: '/', action: 'request_submit', requiresConfirmation: true, maxPerTurn: 1 }],
    });
    expect(answer.status).toBe(200);
    expect((answer.body as { bot: { actionRules: unknown[] } }).bot.actionRules).toEqual([
      { origin: SITE, pathPrefix: '/kontakt', action: 'fill', requiresConfirmation: false, maxPerTurn: 2 },
      { origin: SITE, pathPrefix: '/', action: 'request_submit', requiresConfirmation: true, maxPerTurn: 1 },
    ]);
  });

  it('replaces the whole policy on a patch, so a removed rule is really gone', async () => {
    const host = twoChatbots();
    const { api } = adminApiFor(host);
    const created = await api.create(ADMIN, { chatbotUserId: 12, origins: [SITE], actionRules: [rule] });
    const updatedAt = (created.body as { bot: { updatedAt: string } }).bot.updatedAt;

    const cleared = await api.update(ADMIN, { chatbotUserId: 12, expectedUpdatedAt: updatedAt, displayName: '', prompt: '', origins: [SITE], actionRules: [] });
    expect(cleared.status).toBe(200);
    expect((cleared.body as { bot: { actionRules: unknown[] } }).bot.actionRules).toEqual([]);
    expect(host.store.actionRulesOf(12)).toEqual([]);
  });

  it('refuses a rule for a domain the chatbot does not answer on', async () => {
    const host = twoChatbots();
    const { api } = adminApiFor(host);
    const answer = await api.create(ADMIN, { chatbotUserId: 12, origins: [SITE], actionRules: [{ ...rule, origin: 'https://jiny.cz' }] });
    expect(answer).toMatchObject({ status: 400, body: { error: 'invalid_request' } });
    expect(host.store.actionRulesOf(12)).toEqual([]);
  });

  it('refuses a stale write and leaves the stored policy alone', async () => {
    const host = twoChatbots();
    const { api } = adminApiFor(host);
    await api.create(ADMIN, { chatbotUserId: 12, origins: [SITE], actionRules: [rule] });
    const answer = await api.update(ADMIN, {
      chatbotUserId: 12,
      expectedUpdatedAt: '2020-01-01T00:00:00.000Z',
      displayName: '',
      prompt: '',
      origins: [SITE],
      actionRules: [],
    });
    expect(answer).toMatchObject({ status: 409, body: { error: 'conflict' } });
    expect(host.store.actionRulesOf(12)).toHaveLength(1);
  });

  it('refuses a rule list the policy could never act on', () => {
    const good = { origin: SITE, pathPrefix: '/kontakt', action: 'fill', maxPerTurn: 2 };
    expect(validateActionRules([good])).toMatchObject({ ok: true });
    expect(validateActionRules([{ ...good, unknown: 1 }])).toMatchObject({ ok: false });
    expect(validateActionRules([{ ...good, action: 'rm -rf' }])).toMatchObject({ ok: false });
    expect(validateActionRules([{ ...good, pathPrefix: 'kontakt' }])).toMatchObject({ ok: false });
    expect(validateActionRules([{ ...good, pathPrefix: '/a?b' }])).toMatchObject({ ok: false });
    expect(validateActionRules([{ ...good, maxPerTurn: 0 }])).toMatchObject({ ok: false });
    // A limit above the plugin's own per-turn ceiling would be a setting that silently does nothing.
    expect(validateActionRules([{ ...good, maxPerTurn: 21 }])).toMatchObject({ ok: false });
    // Only submitting a form can be confirmed: such a rule could never be satisfied.
    expect(validateActionRules([{ ...good, action: 'click', requiresConfirmation: true }])).toMatchObject({ ok: false });
    expect(validateActionRules([good, { ...good, pathPrefix: '/kontakt/' }])).toMatchObject({ ok: false });
    expect(validateActionRules('nope')).toMatchObject({ ok: false });
  });

  it('reads a path the way the editor shows it, so a doubled slash still describes a real place', () => {
    // The editor's field opens with a "/", and a reader who types their path over it sends "//kontakt".
    // Stored verbatim that rule matches no request while looking exactly like one that does.
    expect(validateActionRules([{ origin: SITE, pathPrefix: '//kontakt', action: 'fill', maxPerTurn: 2 }]))
      .toEqual({ ok: true, value: [{ origin: SITE, pathPrefix: '/kontakt', action: 'fill', requiresConfirmation: false, maxPerTurn: 2 }] });
    expect(validateActionRules([{ origin: SITE, pathPrefix: '/a//b/', action: 'click', maxPerTurn: 1 }]))
      .toEqual({ ok: true, value: [{ origin: SITE, pathPrefix: '/a/b', action: 'click', requiresConfirmation: false, maxPerTurn: 1 }] });
    // Which is also what makes the duplicate check catch the same place written both ways.
    expect(validateActionRules([{ origin: SITE, pathPrefix: '/kontakt', action: 'fill', maxPerTurn: 2 }, { origin: SITE, pathPrefix: '//kontakt', action: 'fill', maxPerTurn: 2 }]))
      .toMatchObject({ ok: false });
  });
});
