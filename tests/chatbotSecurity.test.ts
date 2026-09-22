// @vitest-environment node
/** The layer in front of a chatbot: who may talk to it at all, how often, and how many turns it may hold.
 *
 *  Everything here is about an anonymous caller — a website outside the allowlist, an address that is not the
 *  one the host resolved, a visitor who sends faster than the chatbot allows, a queue that is full. Each of
 *  those has to end in a refusal that reaches no model, and each refusal below is asserted TOGETHER with the
 *  thing it protects: the relay was never called, or the extra turn was never written down. */
import { randomUUID } from 'node:crypto';
import { describe, expect, it, beforeEach } from 'vitest';
import { createAdminApi } from '../plugins/chatbot/src/adminApi.js';
import { DEFAULT_LIMITS, MANDATORY_LIMITS, OPTIONAL_LIMITS, readBotLimits } from '../plugins/chatbot/src/limits.js';
import { windowAt } from '../plugins/chatbot/src/rateLimit.js';
import { utcDay } from '../plugins/chatbot/src/budget.js';
import {
  CHATBOT_SITE as SITE,
  CLIENT_TURN_ID as UUID,
  NOW_MS,
  TEST_LIMITS,
  createChatbotHost,
  issueToken,
  postRequest,
  publicRequest,
  registerBot,
  settledTurn,
  type ChatbotHost,
} from './helpers/chatbotHost.js';

let host: ChatbotHost;
beforeEach(async () => {
  host = createChatbotHost();
  registerBot(host);
  await host.adapter.connect();
});

async function submit(current: ChatbotHost, token: string, body: Record<string, unknown> = {}) {
  return current.handler(postRequest({
    path: 'turns',
    headers: { origin: SITE, authorization: `ChatbotVisitor ${token}` },
    body: { schemaVersion: 1, clientTurnId: UUID, message: 'ahoj', ...body },
  }));
}

/** A relay that never answers: a turn that HOLDS its slot, which is what makes the queue's own rules
 *  observable instead of a race against a promise that resolves in the same tick. */
function holdTurns(current: ChatbotHost): void {
  current.handleTurn = () => new Promise<string | undefined>(() => {});
}

describe('a chatbot that cannot serve is refused before anything is spent', () => {
  it('refuses an enabled chatbot whose limits nobody has decided', async () => {
    const bare = createChatbotHost();
    registerBot(bare, { limits: {} });
    bare.db.prepare('UPDATE p_chatbot_bots SET daily_turn_limit = NULL WHERE chatbot_user_id = 12').run();
    await bare.adapter.connect();
    // The public id is handed out, because a token is not a turn; the TURN is what needs numbers to run under.
    const issued = await issueToken(bare);
    expect(issued.status).toBe(200);
    expect(await submit(bare, issued.body.token)).toMatchObject({ status: 503, body: { error: 'bot_unavailable' } });
    expect(bare.calls).toHaveLength(0);
    expect(bare.store.queuedCount(12)).toBe(0);
  });

  it('serves the same chatbot once its numbers are there', async () => {
    const bare = createChatbotHost();
    registerBot(bare, { limits: {} });
    bare.db.prepare('UPDATE p_chatbot_bots SET daily_turn_limit = NULL WHERE chatbot_user_id = 12').run();
    await bare.adapter.connect();
    const issued = await issueToken(bare);
    bare.setLimits(12, {});
    expect(await submit(bare, issued.body.token)).toMatchObject({ status: 202 });
    expect(await settledTurn(bare, (await bare.store.recentTurns({ chatbotUserId: 12, visitorId: issued.body.visitorId as string, limit: 1 }))[0]!.turn_id)).toBe('done');
  });
});

describe('the browser origin allowlist', () => {
  it('refuses a website outside the allowlist and a request that names no website at all', async () => {
    const issued = await issueToken(host);
    expect(await host.handler(postRequest({
      path: 'turns',
      headers: { origin: 'https://evil.cz', authorization: `ChatbotVisitor ${issued.body.token}` },
      body: { schemaVersion: 1, clientTurnId: UUID, message: 'ahoj' },
    }))).toMatchObject({ status: 403, body: { error: 'origin_not_allowed' } });
    expect(await host.handler(publicRequest({
      method: 'POST',
      path: 'turns',
      headers: { authorization: `ChatbotVisitor ${issued.body.token}`, 'content-type': 'application/json' },
      body: { schemaVersion: 1, clientTurnId: UUID, message: 'ahoj' },
    }))).toMatchObject({ status: 403, body: { error: 'origin_not_allowed' } });
    expect(host.calls).toHaveLength(0);
  });

  it('answers a preflight only for an origin an enabled chatbot serves, and only for its own methods', async () => {
    const preflight = (origin: string, method = 'POST') => host.handler(publicRequest({
      method: 'OPTIONS',
      path: 'turns',
      headers: { origin, 'access-control-request-method': method, 'access-control-request-headers': 'authorization,content-type' },
    }));

    const allowed = await preflight(SITE);
    expect(allowed.status).toBe(204);
    expect(allowed.headers).toMatchObject({
      'access-control-allow-origin': SITE,
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'authorization, content-type',
      vary: 'Origin',
    });
    // A website nobody serves gets no grant at all — not a grant with a refusal inside it.
    const outside = await preflight('https://evil.cz');
    expect(outside).toMatchObject({ status: 403, body: { error: 'origin_not_allowed' } });
    expect(outside.headers?.['access-control-allow-origin']).toBeUndefined();
    // A method the widget never uses is not granted either.
    expect(await preflight(SITE, 'DELETE')).toMatchObject({ status: 403 });
  });

  it('refuses a caller the host could not resolve a trusted address for, and grants no CORS either', async () => {
    const issued = await issueToken(host);
    for (const origin of [{ value: '203.0.113.9', kind: 'ip' as const, trusted: false }, null]) {
      const answer = await host.handler(postRequest({
        path: 'turns',
        headers: { origin: SITE, authorization: `ChatbotVisitor ${issued.body.token}` },
        body: { schemaVersion: 1, clientTurnId: UUID, message: 'ahoj' },
        origin,
      }));
      expect(answer).toMatchObject({ status: 403, body: { error: 'trusted_origin_required' } });
      expect(answer.headers?.['access-control-allow-origin']).toBeUndefined();
    }
    expect(host.calls).toHaveLength(0);
  });
});

describe('rate limits', () => {
  it('refuses the request over a conversation window and tells the caller when the window ends', async () => {
    host.setLimits(12, { rateConversationPerMinute: 2 });
    holdTurns(host);
    const issued = await issueToken(host);
    const token = issued.body.token as string;
    expect((await submit(host, token)).status).toBe(202);
    // The second message of this conversation is refused for the OTHER reason — one live turn per
    // conversation — but it is still an attempt, and the window counts it.
    expect(await submit(host, token, { clientTurnId: '2f1a4c3e-9b7d-4f6a-8c2e-1d5b7a9f0c35' }))
      .toMatchObject({ status: 409, body: { error: 'turn_in_progress' } });

    const callsBefore = host.calls.length;
    const over = await submit(host, token, { clientTurnId: '2f1a4c3e-9b7d-4f6a-8c2e-1d5b7a9f0c36' });
    expect(over).toMatchObject({ status: 429, body: { error: 'rate_limited' } });
    const retryAfter = Number((over.headers as Record<string, string>)['retry-after']);
    // The window is a minute of wall clock and it does not move with the request, so the wait is what is left
    // of it: one to sixty seconds, never a number this plugin invented.
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);
    // Nothing was queued and no model was reached.
    expect(host.calls).toHaveLength(callsBefore);
    expect(host.store.turnByClientId(12, issued.body.visitorId as string, '2f1a4c3e-9b7d-4f6a-8c2e-1d5b7a9f0c36')).toBeNull();
  });

  it('counts one address against one chatbot, and a different address against its own window', async () => {
    host.setLimits(12, { rateIpPerMinute: 1, rateConversationPerMinute: 100, rateChatbotPerMinute: 100 });
    const first = await issueToken(host);
    const second = await issueToken(host);
    const from = (token: string, clientTurnId: string, address: string) => host.handler(postRequest({
      path: 'turns',
      headers: { origin: SITE, authorization: `ChatbotVisitor ${token}` },
      body: { schemaVersion: 1, clientTurnId, message: 'ahoj' },
      origin: { value: address, kind: 'ip', trusted: true },
    }));

    const firstTurn = await from(first.body.token as string, UUID, '203.0.113.9');
    expect(firstTurn.status).toBe(202);
    await settledTurn(host, (firstTurn.body as { turnId: string }).turnId);
    // A SECOND visitor from the same address is over the address's ceiling...
    expect(await from(second.body.token as string, '2f1a4c3e-9b7d-4f6a-8c2e-1d5b7a9f0c37', '203.0.113.9'))
      .toMatchObject({ status: 429, body: { error: 'rate_limited' } });
    // ...while the same visitor from another address is not, because the window is per address AND chatbot.
    const elsewhere = await from(second.body.token as string, '2f1a4c3e-9b7d-4f6a-8c2e-1d5b7a9f0c38', '203.0.113.10');
    expect(elsewhere.status).toBe(202);
  });

  it('stops the whole chatbot at its own window however many addresses ask', async () => {
    host.setLimits(12, { rateChatbotPerMinute: 1, rateIpPerMinute: 100, rateConversationPerMinute: 100 });
    const issued = await issueToken(host);
    const accepted = await submit(host, issued.body.token as string);
    expect(accepted.status).toBe(202);
    await settledTurn(host, (accepted.body as { turnId: string }).turnId);
    const other = await issueToken(host);
    expect(await submit(host, other.body.token as string, { clientTurnId: '2f1a4c3e-9b7d-4f6a-8c2e-1d5b7a9f0c39' }))
      .toMatchObject({ status: 429, body: { error: 'rate_limited' } });
  });

  it('counts a REFUSED attempt too, so a caller cannot retry its way past the window', async () => {
    host.setLimits(12, { rateConversationPerMinute: 1 });
    const issued = await issueToken(host);
    const token = issued.body.token as string;
    expect((await submit(host, token)).status).toBe(202);
    const turn = host.store.recentTurns({ chatbotUserId: 12, visitorId: issued.body.visitorId as string, limit: 1 })[0]!;
    await settledTurn(host, turn.turn_id);
    for (const clientTurnId of ['2f1a4c3e-9b7d-4f6a-8c2e-1d5b7a9f0c40', '2f1a4c3e-9b7d-4f6a-8c2e-1d5b7a9f0c41']) {
      expect(await submit(host, token, { clientTurnId })).toMatchObject({ status: 429 });
    }
    const window = windowAt('conversation', `12:${issued.body.visitorId}`, NOW_MS);
    const row = host.db.prepare('SELECT count FROM p_chatbot_rate_windows WHERE scope = ? AND scope_key = ? AND window_started_at = ?')
      .get('conversation', window.key, window.startedAt) as { count: number };
    // Three attempts, one admitted: the window counts ATTEMPTS, which is what makes it a rate limit rather
    // than a success counter a retry loop could sit under.
    expect(row.count).toBe(3);
  });

  it('gives every minute its own window', async () => {
    host.setLimits(12, { rateConversationPerMinute: 1 });
    const issued = await issueToken(host);
    const token = issued.body.token as string;
    const first = await submit(host, token);
    await settledTurn(host, (first.body as { turnId: string }).turnId);
    // The next minute is a NEW row, so the ceiling applies again rather than the counter growing forever.
    host.setNow(NOW_MS + 60_000);
    expect(await submit(host, token, { clientTurnId: '2f1a4c3e-9b7d-4f6a-8c2e-1d5b7a9f0c42' })).toMatchObject({ status: 202 });
  });
});

describe('the queue in front of a chatbot', () => {
  it('runs only as many turns at once as the chatbot allows, and refuses what will not fit', async () => {
    host.setLimits(12, { maxConcurrentTurns: 1, maxQueueDepth: 1 });
    holdTurns(host);
    const { token, visitorId } = await (async () => {
      const issued = await issueToken(host);
      return { token: issued.body.token as string, visitorId: issued.body.visitorId as string };
    })();
    // Three visitors: one runs, one waits, and the third does not fit in the queue at all.
    const others = [await issueToken(host), await issueToken(host)];
    expect((await submit(host, token)).status).toBe(202);
    expect((await submit(host, others[0]!.body.token as string, { clientTurnId: '2f1a4c3e-9b7d-4f6a-8c2e-1d5b7a9f0c43' })).status).toBe(202);
    const busy = await submit(host, others[1]!.body.token as string, { clientTurnId: '2f1a4c3e-9b7d-4f6a-8c2e-1d5b7a9f0c44' });
    expect(busy).toMatchObject({ status: 429, body: { error: 'chatbot_busy' } });

    expect(host.store.runningCount(12)).toBe(1);
    expect(host.store.queuedCount(12)).toBe(1);
    expect(host.calls).toHaveLength(1);
    expect(visitorId).not.toBe(others[0]!.body.visitorId);
    expect(host.store.turnByClientId(12, others[1]!.body.visitorId as string, '2f1a4c3e-9b7d-4f6a-8c2e-1d5b7a9f0c44')).toBeNull();
  });

  it('gives one conversation one turn at a time', async () => {
    holdTurns(host);
    const issued = await issueToken(host);
    const token = issued.body.token as string;
    expect((await submit(host, token)).status).toBe(202);
    const second = await submit(host, token, { clientTurnId: '2f1a4c3e-9b7d-4f6a-8c2e-1d5b7a9f0c45' });
    expect(second).toMatchObject({ status: 409, body: { error: 'turn_in_progress' } });
    // The SAME message, on the other hand, is the same turn: a retry is answered with its receipt, not with a
    // second turn and not with a refusal.
    const retry = await submit(host, token);
    expect(retry.status).toBe(202);
    expect((retry.body as { turnId: string }).turnId).toBe((await host.handler(postRequest({
      path: 'turns',
      headers: { origin: SITE, authorization: `ChatbotVisitor ${token}` },
      body: { schemaVersion: 1, clientTurnId: UUID, message: 'ahoj' },
    }))).body.turnId);
    expect(host.store.turnByClientId(12, issued.body.visitorId as string, '2f1a4c3e-9b7d-4f6a-8c2e-1d5b7a9f0c45')).toBeNull();
  });

  it('closes a turn that waited longer than the chatbot allows, without ever reaching the model', async () => {
    host.setLimits(12, { maxConcurrentTurns: 1, queueTimeoutSeconds: 30 });
    holdTurns(host);
    const first = await issueToken(host);
    const waiting = await issueToken(host);
    expect((await submit(host, first.body.token as string)).status).toBe(202);
    const accepted = await submit(host, waiting.body.token as string, { clientTurnId: '2f1a4c3e-9b7d-4f6a-8c2e-1d5b7a9f0c46' });
    expect(accepted.status).toBe(202);
    const waitingTurnId = (accepted.body as { turnId: string }).turnId;

    // The deadline is the chatbot's own number, in milliseconds, and nothing else.
    expect(host.queueDeadlines.get(waitingTurnId)?.delayMs).toBe(30_000);
    host.fireQueueTimeout(waitingTurnId);

    const closed = host.store.turn(waitingTurnId)!;
    expect(closed.status).toBe('error');
    expect(closed.error_code).toBe('queue_timeout');
    // The visitor's widget reads the reason off the durable log, and there is nothing else in it: no
    // `accepted`, because no turn of this one ever started.
    expect(host.store.events(waitingTurnId).map((event) => event.type)).toEqual(['error']);
    expect(JSON.parse(host.store.events(waitingTurnId)[0]!.data)).toEqual({ code: 'queue_timeout' });
    expect(host.calls).toHaveLength(1);
  });

  it('starts the next waiting turn when a slot comes free', async () => {
    host.setLimits(12, { maxConcurrentTurns: 1 });
    let release: ((reply: string) => void) | null = null;
    host.handleTurn = () => new Promise<string | undefined>((resolve) => { release = resolve; });
    const first = await issueToken(host);
    const second = await issueToken(host);
    expect((await submit(host, first.body.token as string)).status).toBe(202);
    const accepted = await submit(host, second.body.token as string, { clientTurnId: '2f1a4c3e-9b7d-4f6a-8c2e-1d5b7a9f0c47' });
    expect(accepted.status).toBe(202);
    const waitingTurnId = (accepted.body as { turnId: string }).turnId;
    expect(host.calls).toHaveLength(1);

    release!('Dobrý den.');
    await settledTurn(host, host.store.recentTurns({ chatbotUserId: 12, visitorId: first.body.visitorId as string, limit: 1 })[0]!.turn_id);
    // The slot is released in the turn's own `finally`, so the next one is picked up without another request.
    for (let attempt = 0; attempt < 200 && host.calls.length < 2; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    expect(host.calls).toHaveLength(2);
    expect(host.store.turn(waitingTurnId)!.status).not.toBe('queued');
  });

  it('fails a waiting turn of a chatbot whose numbers are gone instead of leaving a visitor waiting forever', async () => {
    // The numbers disappear while a turn is already waiting: nobody is coming to pick it up, and the queue
    // says so rather than leaving a visitor on a turn that can never run.
    host.db.prepare('UPDATE p_chatbot_bots SET max_concurrent_turns = NULL WHERE chatbot_user_id = 12').run();
    const turn = host.store.createTurn({
      turnId: randomUUID(),
      chatbotUserId: 12,
      visitorId: 'visitor-1',
      clientTurnId: randomUUID(),
      message: 'ahoj',
      now: new Date(NOW_MS).toISOString(),
    });
    host.queue.submit(turn.turn_id);

    expect(host.store.turn(turn.turn_id)!.status).toBe('error');
    expect(host.store.turn(turn.turn_id)!.error_code).toBe('turn_failed');
    expect(host.store.events(turn.turn_id).map((event) => event.type)).toEqual(['error']);
    expect(host.calls).toHaveLength(0);
    expect(host.warnings.some((warning) => warning.includes('no usable limits'))).toBe(true);
  });
});

describe('the sensitive-data mode', () => {
  const admin = { admin: true } as never;
  const api = (current: ChatbotHost) => createAdminApi({
    store: current.store,
    stores: current.stores,
    publicBaseUrl: () => 'https://elowen.example',
    now: () => new Date(NOW_MS),
  });

  it('answers a request for it with privacy_policy_unresolved rather than storing one', async () => {
    const request = await api(host).create(admin, { chatbotUserId: 15, sensitiveMode: true });
    expect(request).toMatchObject({ status: 409, body: { error: 'privacy_policy_unresolved' } });
    expect(host.store.botByUserId(15)).toBeNull();

    const saved = await api(host).update(admin, {
      chatbotUserId: 12,
      expectedUpdatedAt: host.store.botByUserId(12)!.updated_at,
      displayName: 'Městský úřad',
      origins: [SITE],
      maySubmitForms: true,
      limits: TEST_LIMITS,
      sensitiveMode: true,
    });
    expect(saved).toMatchObject({ status: 409, body: { error: 'privacy_policy_unresolved' } });
    // Nothing about the row changed, and the mode is not stored as granted.
    expect(host.store.botByUserId(12)!.sensitive_mode).toBe(0);
  });

  it('can enable a newly registered chatbot without filling numeric limits first', async () => {
    const draft = createChatbotHost();
    registerBot(draft, { status: 'draft', limits: {} });
    const answer = await api(draft).update(admin, {
      chatbotUserId: 12,
      expectedUpdatedAt: draft.store.botByUserId(12)!.updated_at,
      displayName: 'Městský úřad',
      origins: [SITE],
      maySubmitForms: true,
      limits: {},
      action: 'enable',
    });
    expect(answer).toMatchObject({ status: 200, body: { bot: { missingLimits: [] } } });
    expect(draft.store.botByUserId(12)!.status).toBe('enabled');
  });

  it('refuses a limit the server would not believe, instead of clamping it', async () => {
    const answer = await api(host).update(admin, {
      chatbotUserId: 12,
      expectedUpdatedAt: host.store.botByUserId(12)!.updated_at,
      displayName: 'Městský úřad',
      origins: [SITE],
      maySubmitForms: true,
      limits: { ...TEST_LIMITS, maxActionsPerTurn: 500 },
    });
    expect(answer).toMatchObject({ status: 400, body: { error: 'invalid_request' } });
    expect(host.store.botByUserId(12)!.max_actions_per_turn).toBe(TEST_LIMITS.maxActionsPerTurn);
  });

  it('will not save an ENABLED chatbot into a state it could not serve from', async () => {
    const answer = await api(host).update(admin, {
      chatbotUserId: 12,
      expectedUpdatedAt: host.store.botByUserId(12)!.updated_at,
      displayName: 'Městský úřad',
      origins: [SITE],
      maySubmitForms: true,
      limits: { ...TEST_LIMITS, retentionDays: null },
    });
    expect(answer).toMatchObject({ status: 400, body: { error: 'not_ready', detail: ['retentionDays'] } });
    expect(host.store.botByUserId(12)!.status).toBe('enabled');
  });
});

describe('the limits themselves', () => {
  it('reads a complete row and refuses an incomplete one', () => {
    const row = host.store.botByUserId(12)!;
    expect(readBotLimits(row)).toMatchObject({ rateIpPerMinute: TEST_LIMITS.rateIpPerMinute, maxConcurrentTurns: TEST_LIMITS.maxConcurrentTurns });
    expect(readBotLimits({ ...row, queue_timeout_seconds: null })).toBeNull();
    // A value outside the bounds it was validated against reads as UNSET, never as itself: a hand-edited row
    // must not hand the enforcement code a number the admin API would have refused.
    expect(readBotLimits({ ...row, daily_turn_limit: 0 })).toBeNull();
    expect(readBotLimits({ ...row, daily_token_limit: -1 })).toBeNull();
    expect(readBotLimits({ ...row, daily_token_limit: null })).not.toBeNull();
  });

  it('names every field it requires, and no field it does not', () => {
    const row = host.store.botByUserId(12)!;
    void row;
    // The mandatory set is what the admin surface reports as missing, so the two cannot disagree.
    expect(Object.keys(MANDATORY_LIMITS).sort()).toEqual([
      'dailyTurnLimit', 'maxActionsPerTurn', 'maxConcurrentTurns', 'maxQueueDepth',
      'queueTimeoutSeconds', 'rateChatbotPerMinute', 'rateConversationPerMinute', 'rateIpPerMinute', 'retentionDays',
    ]);
    const blank = { ...host.store.botByUserId(12)! };
    for (const spec of [...Object.values(MANDATORY_LIMITS), ...Object.values(OPTIONAL_LIMITS)]) blank[spec.column] = null;
    expect(readBotLimits(blank)).toBeNull();
  });

  it('writes the complete default profile when a chatbot is created', () => {
    const draft = createChatbotHost();
    registerBot(draft, { status: 'draft', limits: {} });
    const row = draft.store.botByUserId(12)!;
    for (const [field, spec] of Object.entries({ ...MANDATORY_LIMITS, ...OPTIONAL_LIMITS })) {
      expect(row[spec.column], field).toBe(DEFAULT_LIMITS[field as keyof typeof DEFAULT_LIMITS]);
    }
  });
});

describe('the per-turn action budget', () => {
  /** A live visitor turn whose message records what the page looked like, exactly as the widget composes it. */
  function liveTurn(current: ChatbotHost, message: string) {
    const turn = current.store.createTurn({
      turnId: randomUUID(),
      chatbotUserId: 12,
      visitorId: 'visitor-1',
      clientTurnId: randomUUID(),
      message,
      now: new Date(NOW_MS).toISOString(),
    });
    current.store.markTurnRunning(turn.turn_id, new Date(NOW_MS).toISOString());
    return current.store.turn(turn.turn_id)!;
  }

  const messageWithPage = (): string => `Visitor message:\nahoj\n\nUntrusted page state:\n${JSON.stringify({
    snapshotId: 's0123456789abcdef',
    url: `${SITE}/form.html`,
    title: 'Kontaktní formulář',
    viewport: { width: 390, height: 844 },
    language: 'cs',
    headings: [],
    forms: [],
    targets: [{ id: 'e0', tag: 'input', caps: ['read', 'fill', 'focus'], type: 'text', name: 'jmeno' }],
    iframes: [],
    truncated: false,
  })}`;

  const askRead = (current: ChatbotHost, turn: ReturnType<typeof liveTurn>) => current.actions.request({
    turn,
    chatbotUserId: 12,
    sessionId: 'brain-ch-chatbot-12:visitor-1',
    request: { snapshotId: 's0123456789abcdef', kind: 'read', targetId: 'e0', value: null },
  });

  /** The newest action row of a turn, in the order the plugin wrote them. */
  const newestAction = (turnId: string) => {
    const row = host.db.prepare('SELECT id FROM p_chatbot_actions WHERE turn_id = ? ORDER BY rowid DESC LIMIT 1').get(turnId) as { id: string };
    return host.store.action(row.id)!;
  };

  it('is the CHATBOT\'s own number, enforced on the server', async () => {
    host.setLimits(12, { maxActionsPerTurn: 2 });
    const turn = liveTurn(host, messageWithPage());
    // Two actions are approved and answered by the page...
    for (let index = 0; index < 2; index += 1) {
      const pending = askRead(host, turn);
      host.actions.reportResult({ turn, actionId: newestAction(turn.turn_id).id, outcome: 'done', detail: null });
      await expect(pending).resolves.toMatchObject({ status: 'done' });
    }
    // ...and the third is refused, because this chatbot's own budget is spent.
    await expect(askRead(host, turn)).resolves.toEqual({ status: 'refused', reason: 'action_budget_exhausted' });
    expect(host.store.actionCountOfTurn(turn.turn_id)).toBe(2);
  });

  it('approves nothing at all for a chatbot whose numbers are not configured', async () => {
    // No ceiling to act under is not a licence to act: the chatbot itself is what this decision is about, and
    // a turn running under a half-configured bot may not touch a page.
    host.db.prepare('UPDATE p_chatbot_bots SET max_actions_per_turn = NULL WHERE chatbot_user_id = 12').run();
    const turn = liveTurn(host, messageWithPage());
    await expect(askRead(host, turn)).resolves.toEqual({ status: 'refused', reason: 'action_not_allowed' });
    expect(host.store.actionCountOfTurn(turn.turn_id)).toBe(0);
    expect(host.warnings.some((warning) => warning.includes('no usable limit configuration'))).toBe(true);
  });
});

describe('a budget day is counted per UTC day', () => {
  it('uses the day the request arrived on', () => {
    expect(utcDay(NOW_MS)).toBe('2027-01-15');
    expect(utcDay(NOW_MS + 86_400_000)).toBe('2027-01-16');
  });
});
