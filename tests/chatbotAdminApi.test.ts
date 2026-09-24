// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { PluginApiAuth } from 'elowen/plugin-api';
import { createAdminApi, percentileMs } from '../plugins/chatbot/src/adminApi.js';
import { DEFAULT_LIMITS } from '../plugins/chatbot/src/limits.js';
import { CHATBOT_SITE as SITE, NOW_MS, TURN_PAGE, createChatbotHost, registerBot, type ChatbotHost } from './helpers/chatbotHost.js';

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
const NOW_ISO = new Date(NOW_MS).toISOString();
const iso = (ms: number): string => new Date(ms).toISOString();

function adminApiFor(host: ChatbotHost, clock: { ms: number } = { ms: NOW_MS }) {
  const warnings: string[] = [];
  return {
    api: createAdminApi({
      store: host.store,
      stores: host.stores,
      publicBaseUrl: () => 'https://elowen.example.com',
      now: () => new Date(clock.ms),
      warn: (message) => { warnings.push(message); },
    }),
    clock,
    warnings,
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
  sessionId?: string;
}): void {
  host.store.createTurn({
    turnId: input.turnId,
    chatbotUserId: input.chatbotUserId,
    visitorId: input.visitorId,
    clientTurnId: `uuid-${input.turnId}`,
    message: input.message,
    page: TURN_PAGE,
    now: iso(input.at),
  });
  if (input.startedAt !== undefined) {
    host.store.markTurnRunning(input.turnId, iso(input.startedAt));
  }
  if (input.status === 'done' || input.status === 'error') {
    host.store.finishTurn({
      turnId: input.turnId,
      status: input.status,
      coreSessionId: input.sessionId ?? `core-session-${input.visitorId}`,
      errorCode: input.errorCode ?? null,
      now: iso(input.at + HOUR),
    });
    host.store.appendEvent(input.turnId, input.status, input.status === 'done' ? { text: input.reply ?? '' } : { code: input.errorCode ?? 'relay_failed' }, iso(input.at + HOUR));
  }
}

describe('the admin routes are admin-only, whatever the manifest says', () => {
  it.each(['list', 'conversations', 'visitors', 'stats'] as const)('refuses a non-admin caller at %s', async (method) => {
    const host = twoChatbots();
    const { api } = adminApiFor(host);
    const answer = method === 'list'
      ? await api.list(VIEWER)
      : method === 'conversations' ? await api.conversations(VIEWER, { chatbotUserId: '12' })
        : method === 'visitors' ? await api.visitors(VIEWER, { chatbotUserId: '12' })
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

/** The models core resolves for the fixture accounts. Unlike each other on purpose: a payload that carried
 *  the wrong one, or that named a source other than the one core attributed, cannot pass. */
const PICKED = 'elowen:anthropic/claude-sonnet-4';
const INSTANCE = 'anthropic/claude-haiku-4';
const FORCED = 'relay/kimi-k2';

describe('the model a chatbot\'s visitors are answered by', () => {
  it('carries core\'s own answer for the account, with the source core attributed it to', async () => {
    // Every account with a different source: the account's own pick, the instance default it fell back to,
    // and a model its allow-list forced it onto because the default is not permitted to it.
    const answers: Record<number, { exec: string; source: 'preference' | 'instance' | 'allowed' }> = {
      12: { exec: PICKED, source: 'preference' },
      13: { exec: INSTANCE, source: 'instance' },
      14: { exec: FORCED, source: 'allowed' },
    };
    const asked: number[] = [];
    const host = createChatbotHost({
      accounts: [
        { id: 12, username: 'ured-bot', name: 'Úřad', avatar: '', isAdmin: false, type: 'chatbot' },
        { id: 13, username: 'skola-bot', name: 'Škola', avatar: '', isAdmin: false, type: 'chatbot' },
        { id: 14, username: 'gymnazium-bot', name: 'Gymnázium', avatar: '', isAdmin: false, type: 'chatbot' },
      ],
      effectiveChatExec: (id) => { asked.push(id); return answers[id] ?? null; },
    });
    const { api } = adminApiFor(host);
    for (const id of [12, 13, 14]) registerBot(host, { chatbotUserId: id, publicId: `cbt_${String(id).repeat(24)}` });

    const answer = await api.list(ADMIN);
    expect(answer.status).toBe(200);
    const models = new Map((answer.body as { bots: { chatbotUserId: number; model: unknown }[] }).bots
      .map((bot) => [bot.chatbotUserId, bot.model]));
    expect(models.get(12)).toEqual({ exec: PICKED, source: 'preference' });
    expect(models.get(13)).toEqual({ exec: INSTANCE, source: 'instance' });
    expect(models.get(14)).toEqual({ exec: FORCED, source: 'allowed' });
    // The answer comes from the host, not from anything this plugin stores: the row is read again on every
    // listing, so a model changed in the account is what the next payload carries.
    answers[12] = { exec: FORCED, source: 'allowed' };
    const after = await api.list(ADMIN);
    expect((after.body as { bots: { chatbotUserId: number; model: unknown }[] }).bots
      .find((bot) => bot.chatbotUserId === 12)?.model).toEqual({ exec: FORCED, source: 'allowed' });
    expect(asked).toEqual([12, 13, 14, 12, 13, 14]);
  });

  it('names no model for an account core cannot answer for', async () => {
    // Core returns null for an account it does not know and for an instance with no provider configured.
    // Neither is "the instance default", so the payload carries no model rather than a guess — and the
    // plugin has nothing of its own to put there.
    const host = twoChatbots();
    const { api } = adminApiFor(host);
    registerBot(host, { chatbotUserId: 12 });

    const answer = await api.list(ADMIN);
    expect(answer.status).toBe(200);
    const bots = (answer.body as { bots: { chatbotUserId: number; model: unknown }[] }).bots;
    expect(bots.find((bot) => bot.chatbotUserId === 12)?.model).toBeNull();
  });

  it('keeps the register when core refuses one account\'s model read', async () => {
    // Core THROWS for an account that may run no configured model at all. That is a refusal about ONE
    // chatbot, and it must not take the register down with it: the rest of the rows still answer, and the
    // refused one states no model while core's own reason goes to the log.
    const host = createChatbotHost({
      accounts: [
        { id: 12, username: 'ured-bot', name: 'Úřad', avatar: '', isAdmin: false, type: 'chatbot' },
        { id: 13, username: 'skola-bot', name: 'Škola', avatar: '', isAdmin: false, type: 'chatbot' },
      ],
      effectiveChatExec: (id) => {
        if (id === 13) throw new Error('no configured model is allowed for this account');
        return { exec: PICKED, source: 'preference' };
      },
    });
    const { api, warnings } = adminApiFor(host);
    registerBot(host, { chatbotUserId: 12 });
    registerBot(host, { chatbotUserId: 13, publicId: `cbt_${'c'.repeat(24)}` });

    const answer = await api.list(ADMIN);
    expect(answer.status).toBe(200);
    const models = new Map((answer.body as { bots: { chatbotUserId: number; model: unknown }[] }).bots
      .map((bot) => [bot.chatbotUserId, bot.model]));
    expect(models.get(12)).toEqual({ exec: PICKED, source: 'preference' });
    expect(models.get(13)).toBeNull();
    expect(warnings).toEqual([`chatbot: no model could be named for account 13 (no configured model is allowed for this account)`]);
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
      { visitorId: 'v2', ip: null, sessionId: 'core-session-v2', title: null, turns: 1, errors: 0, firstAt: iso(dayMs + 2 * HOUR), lastAt: iso(dayMs + 2 * HOUR), lastStatus: 'done' },
      { visitorId: 'v1', ip: null, sessionId: 'core-session-v1', title: null, turns: 2, errors: 1, firstAt: iso(dayMs), lastAt: iso(dayMs + HOUR), lastStatus: 'error' },
    ]);

    // Paging is the server's: the second page of one per page holds the other conversation, and nothing of
    // the other chatbot's.
    const paged = await api.conversations(ADMIN, { chatbotUserId: '12', limit: '1', offset: '1' });
    expect(paged.body).toMatchObject({ total: 2, limit: 1, offset: 1 });
    expect((paged.body as { conversations: { visitorId: string }[] }).conversations.map((row) => row.visitorId)).toEqual(['v1']);

    const other = await api.conversations(ADMIN, { chatbotUserId: '13' });
    expect((other.body as { conversations: { visitorId: string }[] }).conversations.map((row) => row.visitorId)).toEqual(['v9']);
  });

  it('names each conversation with the title core gave its session, and never another account\'s', async () => {
    const target = (id: string, title: string, ownerUserId: number) =>
      ({ id, key: `key-${id}`, title, ownerUserId, platform: 'chatbot', direct: false, updatedAt: NOW_ISO });
    const host = createChatbotHost({
      accounts: twoChatbots().stores.usersRead.list(),
      conversations: [
        target('core-session-v1', 'Otevírací doba podatelny', 12),
        // Core has the row but has not named it yet.
        target('core-session-v2', '', 12),
        // A session of the SAME id under another owner must not lend this chatbot its title.
        target('core-session-v3', 'Cizí konverzace', 13),
      ],
    });
    const { api } = adminApiFor(host);
    registerBot(host, { chatbotUserId: 12 });
    const dayMs = Date.parse('2026-09-20T08:00:00.000Z');
    recordTurn(host, { turnId: 'a', chatbotUserId: 12, visitorId: 'v1', at: dayMs, status: 'done', message: 'ahoj', reply: 'Ahoj' });
    recordTurn(host, { turnId: 'b', chatbotUserId: 12, visitorId: 'v2', at: dayMs + HOUR, status: 'done', message: 'ahoj', reply: 'Ahoj' });
    recordTurn(host, { turnId: 'c', chatbotUserId: 12, visitorId: 'v3', at: dayMs + 2 * HOUR, status: 'done', message: 'ahoj', reply: 'Ahoj' });
    // Admitted but not answered yet: no core session was reported, so there is nothing to ask core about.
    recordTurn(host, { turnId: 'd', chatbotUserId: 12, visitorId: 'v4', at: dayMs + 3 * HOUR, status: 'queued', message: 'ahoj' });

    const answer = await api.conversations(ADMIN, { chatbotUserId: '12' });
    expect(answer.status).toBe(200);
    expect((answer.body as { conversations: { visitorId: string; title: string | null }[] }).conversations
      .map(({ visitorId, title }) => ({ visitorId, title }))).toEqual([
      { visitorId: 'v4', title: null },
      { visitorId: 'v3', title: null },
      { visitorId: 'v2', title: null },
      { visitorId: 'v1', title: 'Otevírací doba podatelny' },
    ]);
    // Core decides the scope from the verified caller, and the plugin asks only for this chatbot's sessions.
    // One listing per page, however many rows it holds.
    expect(host.conversationReads).toEqual([{ actorUserId: 1, ownerUserId: 12 }]);

    // Without an account there is no scope to ask core for.
    expect(await api.conversations({ admin: true, userId: null } as PluginApiAuth, { chatbotUserId: '12' }))
      .toMatchObject({ status: 403, body: { error: 'forbidden' } });
  });

  it('orders the whole register by the column asked for before cutting a page, blanks last either way', async () => {
    const target = (id: string, title: string) =>
      ({ id, key: `key-${id}`, title, ownerUserId: 12, platform: 'chatbot', direct: false, updatedAt: NOW_ISO });
    const host = createChatbotHost({
      accounts: twoChatbots().stores.usersRead.list(),
      // v2 is not named yet, so it has no title to sort by.
      conversations: [target('core-session-v1', 'Účty'), target('core-session-v3', 'adresa'), target('core-session-v4', 'Otevírací doba')],
    });
    const { api } = adminApiFor(host);
    registerBot(host, { chatbotUserId: 12 });
    const dayMs = Date.parse('2026-09-20T08:00:00.000Z');
    recordTurn(host, { turnId: 'a', chatbotUserId: 12, visitorId: 'v1', at: dayMs, status: 'done', message: 'ahoj', reply: 'Ahoj' });
    recordTurn(host, { turnId: 'b', chatbotUserId: 12, visitorId: 'v2', at: dayMs + HOUR, status: 'error', message: 'ahoj', errorCode: 'relay_failed' });
    recordTurn(host, { turnId: 'c', chatbotUserId: 12, visitorId: 'v3', at: dayMs + 2 * HOUR, status: 'done', message: 'ahoj', reply: 'Ahoj' });
    recordTurn(host, { turnId: 'd', chatbotUserId: 12, visitorId: 'v3', at: dayMs + 3 * HOUR, status: 'done', message: 'ahoj', reply: 'Ahoj' });
    recordTurn(host, { turnId: 'e', chatbotUserId: 12, visitorId: 'v4', at: dayMs + 4 * HOUR, status: 'done', message: 'ahoj', reply: 'Ahoj' });
    const ip = (visitorId: string, address: string) =>
      host.db.prepare('UPDATE p_chatbot_conversations SET last_ip = ? WHERE visitor_id = ?').run(address, visitorId);
    ip('v1', '10.0.0.2');
    ip('v2', '9.0.0.1');
    ip('v4', '192.168.1.5');

    const order = async (query: Record<string, string>) => {
      const answer = await api.conversations(ADMIN, { chatbotUserId: '12', ...query });
      expect(answer.status).toBe(200);
      return (answer.body as { conversations: { visitorId: string }[] }).conversations.map((row) => row.visitorId);
    };
    // Default: newest activity first.
    expect(await order({})).toEqual(['v4', 'v3', 'v2', 'v1']);
    // Titles read without regard to case or accents; the untitled one last in both directions.
    expect(await order({ sort: 'title', direction: 'asc' })).toEqual(['v3', 'v4', 'v1', 'v2']);
    expect(await order({ sort: 'title', direction: 'desc' })).toEqual(['v1', 'v4', 'v3', 'v2']);
    // Addresses by value, not by characters; the one never kept last.
    expect(await order({ sort: 'ip', direction: 'asc' })).toEqual(['v2', 'v1', 'v4', 'v3']);
    // Ties fall back to newest activity.
    expect(await order({ sort: 'turns', direction: 'desc' })).toEqual(['v3', 'v4', 'v2', 'v1']);
    expect(await order({ sort: 'lastStatus', direction: 'asc' })).toEqual(['v4', 'v3', 'v1', 'v2']);
    expect(await order({ sort: 'lastAt', direction: 'asc' })).toEqual(['v1', 'v2', 'v3', 'v4']);
    // The page is cut from the ordered whole, not ordered within itself.
    expect(await order({ sort: 'title', direction: 'asc', limit: '2', offset: '0' })).toEqual(['v3', 'v4']);
    expect(await order({ sort: 'title', direction: 'asc', limit: '2', offset: '2' })).toEqual(['v1', 'v2']);

    expect(await api.conversations(ADMIN, { chatbotUserId: '12', sort: 'visitorId' })).toMatchObject({ status: 400 });
    expect(await api.conversations(ADMIN, { chatbotUserId: '12', direction: 'up' })).toMatchObject({ status: 400 });
  });

  it('narrows the register to exactly the visitor picked, and restores it when the pick is cleared', async () => {
    const host = twoChatbots();
    const { api } = adminApiFor(host);
    registerBot(host, { chatbotUserId: 12 });
    registerBot(host, { chatbotUserId: 13, publicId: `cbt_${'c'.repeat(24)}` });
    const dayMs = Date.parse('2026-09-20T08:00:00.000Z');
    const [first, second, foreign] = ['ab12'.padEnd(32, '0'), 'ab12'.padEnd(32, '1'), 'ab12'.padEnd(32, '2')];
    recordTurn(host, { turnId: 'a', chatbotUserId: 12, visitorId: first, at: dayMs, status: 'done', message: 'ahoj', reply: 'Ahoj' });
    recordTurn(host, { turnId: 'b', chatbotUserId: 12, visitorId: second, at: dayMs + HOUR, status: 'done', message: 'ahoj', reply: 'Ahoj' });
    recordTurn(host, { turnId: 'c', chatbotUserId: 13, visitorId: foreign, at: dayMs + 2 * HOUR, status: 'done', message: 'ahoj', reply: 'Ahoj' });
    const visitors = (answer: { body: object }) =>
      (answer.body as { conversations: { visitorId: string }[] }).conversations.map((row) => row.visitorId);

    // The pick is one whole id, so two visitors sharing a prefix are two different answers, and the count
    // follows the pick so the pager never offers a page the narrowed read would answer empty.
    const picked = await api.conversations(ADMIN, { chatbotUserId: '12', visitor: first });
    expect(picked.body).toMatchObject({ total: 1, offset: 0 });
    expect(visitors(picked)).toEqual([first]);

    // Another chatbot's visitor is not this chatbot's history, even when named exactly.
    expect((await api.conversations(ADMIN, { chatbotUserId: '12', visitor: foreign })).body).toMatchObject({ total: 0, conversations: [] });

    const cleared = await api.conversations(ADMIN, { chatbotUserId: '12' });
    expect(cleared.body).toMatchObject({ total: 2 });
    expect(visitors(cleared)).toEqual([second, first]);

    // A fragment is no longer a filter: anything that is not a whole visitor id is a malformed request.
    for (const visitor of ['ab12', first.toUpperCase(), '', `${first}0`]) {
      expect(await api.conversations(ADMIN, { chatbotUserId: '12', visitor }), visitor).toMatchObject({ status: 400 });
    }
  });

  it('lists a chatbot\'s visitors for the picker, newest activity first, with the last address or none', async () => {
    const host = twoChatbots();
    const { api } = adminApiFor(host);
    registerBot(host, { chatbotUserId: 12 });
    registerBot(host, { chatbotUserId: 13, publicId: `cbt_${'c'.repeat(24)}` });
    const dayMs = Date.parse('2026-09-20T08:00:00.000Z');
    const [older, newer, foreign] = ['a'.repeat(32), 'b'.repeat(32), 'c'.repeat(32)];
    recordTurn(host, { turnId: 'a', chatbotUserId: 12, visitorId: older, at: dayMs, status: 'done', message: 'ahoj', reply: 'Ahoj' });
    recordTurn(host, { turnId: 'b', chatbotUserId: 12, visitorId: newer, at: dayMs + HOUR, status: 'done', message: 'ahoj', reply: 'Ahoj' });
    recordTurn(host, { turnId: 'c', chatbotUserId: 13, visitorId: foreign, at: dayMs + 2 * HOUR, status: 'done', message: 'ahoj', reply: 'Ahoj' });
    // Only the newer visitor was admitted through a host that vouched for an address; the older row is one
    // written before addresses were kept.
    host.db.prepare("UPDATE p_chatbot_conversations SET last_ip = '203.0.113.9' WHERE visitor_id = ?").run(newer);

    const answer = await api.visitors(ADMIN, { chatbotUserId: '12' });
    expect(answer).toEqual({
      status: 200,
      body: {
        visitors: [
          { visitorId: newer, ip: '203.0.113.9', lastAt: iso(dayMs + HOUR) },
          { visitorId: older, ip: null, lastAt: iso(dayMs) },
        ],
        truncated: false,
      },
    });
    // The register shows the same address beside the same visitor.
    expect((await api.conversations(ADMIN, { chatbotUserId: '12', visitor: newer })).body)
      .toMatchObject({ conversations: [{ visitorId: newer, ip: '203.0.113.9' }] });

    expect(await api.visitors(VIEWER, { chatbotUserId: '12' })).toMatchObject({ status: 403, body: { error: 'forbidden' } });
    expect(await api.visitors(ADMIN, { chatbotUserId: '99' })).toMatchObject({ status: 404 });
    expect(await api.visitors(ADMIN, {})).toMatchObject({ status: 400 });
  });

  it('bounds the picker to the most recently active visitors, and says so', async () => {
    const host = twoChatbots();
    const { api } = adminApiFor(host);
    registerBot(host, { chatbotUserId: 12 });
    const dayMs = Date.parse('2026-09-20T08:00:00.000Z');
    for (let index = 0; index <= 500; index += 1) {
      recordTurn(host, { turnId: `t${index}`, chatbotUserId: 12, visitorId: index.toString(16).padStart(32, '0'), at: dayMs + index * 1_000, status: 'queued', message: 'ahoj' });
    }
    const body = (await api.visitors(ADMIN, { chatbotUserId: '12' })).body as { visitors: { visitorId: string }[]; truncated: boolean };
    expect(body.truncated).toBe(true);
    expect(body.visitors).toHaveLength(500);
    // The one left out is the one least recently active.
    expect(body.visitors.at(-1)!.visitorId).toBe((1).toString(16).padStart(32, '0'));
  });

  it('refuses a chatbot it does not know, and a request that names none', async () => {
    const host = twoChatbots();
    const { api } = adminApiFor(host);
    registerBot(host, { chatbotUserId: 12 });

    expect(await api.conversations(ADMIN, { chatbotUserId: '99' })).toMatchObject({ status: 404, body: { error: 'not_found' } });
    expect(await api.conversations(ADMIN, { chatbotUserId: 'nonsense' })).toMatchObject({ status: 400 });
    expect(await api.stats(ADMIN, {})).toMatchObject({ status: 400 });

    // An account that is not a chatbot at all is not a chatbot, even with a plugin row pointing at it.
    host.stores.usersRead.list().splice(0, host.stores.usersRead.list().length);
    expect(await api.conversations(ADMIN, { chatbotUserId: '12' })).toMatchObject({ status: 404, body: { error: 'account_unknown' } });
  });
});

describe('chatbot registration defaults', () => {
  it('creates a complete default limit profile and enables form submission', async () => {
    const host = twoChatbots();
    const { api } = adminApiFor(host);
    const answer = await api.create(ADMIN, { chatbotUserId: 12, displayName: 'Úřad', origins: [SITE] });

    expect(answer.status).toBe(200);
    expect((answer.body as { bot: { limits: unknown; missingLimits: unknown[]; maySubmitForms: boolean } }).bot)
      .toMatchObject({ limits: DEFAULT_LIMITS, missingLimits: [], maySubmitForms: true });
  });

  it('stores the form submission switch through the admin boundary', async () => {
    const host = twoChatbots();
    const { api } = adminApiFor(host);
    const created = await api.create(ADMIN, { chatbotUserId: 12, origins: [SITE] });
    const bot = (created.body as { bot: { updatedAt: string } }).bot;

    const updated = await api.update(ADMIN, {
      chatbotUserId: 12,
      expectedUpdatedAt: bot.updatedAt,
      displayName: '',
      origins: [SITE],
      maySubmitForms: false,
    });
    expect(updated).toMatchObject({ status: 200, body: { bot: { maySubmitForms: false } } });
    expect(host.store.botByUserId(12)!.may_submit_forms).toBe(0);
  });
});
