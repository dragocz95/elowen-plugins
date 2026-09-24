// @vitest-environment node
/** Retention: the one thing that makes "we keep a visitor's conversation for N days" true.
 *
 *  Two halves are exercised here and they are deliberately separate. The CLEANER decides when a conversation
 *  is due and in what order the two deletions happen; the CORE BRIDGE decides what an answer from the daemon
 *  means. Both fail closed, both are made to fail closed on purpose below, and the failure mode that matters
 *  most — a transcript this plugin cannot confirm deleted — is asserted as "everything is still here". */
import { randomUUID } from 'node:crypto';
import { describe, expect, it, beforeEach } from 'vitest';
import { createCoreSessionBridge, type CoreSessionDeletion } from '../plugins/chatbot/src/coreSessions.js';
import { RETENTION_INTERVAL_MS, createRetentionCleaner, eraseConversations } from '../plugins/chatbot/src/retention.js';
import { utcDay } from '../plugins/chatbot/src/budget.js';
import {
  CHATBOT_SITE as SITE,
  CLIENT_TURN_ID as UUID,
  NOW_MS,
  TEST_LIMITS,
  createChatbotHost,
  issueToken,
  postRequest,
  registerBot,
  settledTurn,
  type ChatbotHost,
  TURN_PAGE,
} from './helpers/chatbotHost.js';

const DAY = utcDay(NOW_MS);
const VISITOR = 'visitor-1';
/** The address the host vouched for when the fixture visitor's turn was admitted. */
const VISITOR_IP = '198.51.100.7';

let host: ChatbotHost;
beforeEach(async () => {
  host = createChatbotHost();
  registerBot(host);
  await host.adapter.connect();
});

/** The daemon, as the cleaner sees it: one recorded call per conversation it asks about, and one answer a
 *  test chooses. */
function fakeCore(answer: CoreSessionDeletion = { ok: true, outcome: 'deleted' }) {
  const asked: { chatbotUserId: number; sessionId: string }[] = [];
  return {
    asked,
    bridge: {
      async deleteSession(input: { chatbotUserId: number; sessionId: string }): Promise<CoreSessionDeletion> {
        asked.push(input);
        return answer;
      },
    },
  };
}

function cleaner(bridge: { deleteSession(input: { chatbotUserId: number; sessionId: string }): Promise<CoreSessionDeletion> }) {
  const warnings: string[] = [];
  const infos: string[] = [];
  return {
    warnings,
    infos,
    run: () => createRetentionCleaner({
      store: host.store,
      now: () => new Date(NOW_MS),
      core: bridge,
      info: (message) => { infos.push(message); },
      warn: (message) => { warnings.push(message); },
    }).run(),
  };
}

/** One conversation of this chatbot, due `daysAgo` days ago, with the visitor's last address, a turn, its
 *  event log and one action. */
function conversation(input: { visitorId?: string; daysAgo: number; sessionId?: string | null; activeTurn?: boolean }): string {
  const visitorId = input.visitorId ?? VISITOR;
  host.store.createVisitor(visitorId, 12, new Date(NOW_MS).toISOString());
  host.store.touchConversation({
    chatbotUserId: 12,
    visitorId,
    sessionId: input.sessionId === undefined ? 'brain-ch-chatbot-12:visitor-1' : input.sessionId,
    ip: VISITOR_IP,
    retentionDays: TEST_LIMITS.retentionDays!,
    now: new Date(NOW_MS - input.daysAgo * 86_400_000).toISOString(),
  });
  const turnId = randomUUID();
  const at = new Date(NOW_MS).toISOString();
  host.store.createTurn({ turnId, chatbotUserId: 12, visitorId, clientTurnId: randomUUID(), message: 'ahoj', page: TURN_PAGE, now: at });
  if (input.activeTurn === true) host.store.markTurnRunning(turnId, at);
  host.store.appendEvent(turnId, 'done', { text: 'Dobrý den.' }, at);
  // A settled turn, unless the test is about a live one: a conversation with a queued or running turn is
  // deliberately never due, so a fixture that forgot to settle it would be testing that rule by accident.
  if (input.activeTurn !== true) {
    host.store.finishTurn({ turnId, status: 'done', coreSessionId: null, errorCode: null, now: new Date(NOW_MS - input.daysAgo * 86_400_000).toISOString() });
  }
  host.db.prepare(`INSERT INTO p_chatbot_actions (id, turn_id, action, request_json, status, requires_confirmation, created_at, expires_at)
                   VALUES (?, ?, 'read', '{"schemaVersion":1,"kind":"read","targetId":"e0","value":null}', 'done', 0, ?, ?)`)
    .run(randomUUID(), turnId, new Date(NOW_MS).toISOString(), new Date(NOW_MS + 60_000).toISOString());
  return turnId;
}

/** Everything the plugin holds about one visitor, as counts. `addresses` is the visitor's IP: it lives on
 *  the conversation row, so it has to go exactly when the conversation goes. */
function holdings(visitorId = VISITOR): Record<string, number> {
  const count = (sql: string): number => (host.db.prepare(sql).get(12, visitorId) as { count: number }).count;
  return {
    turns: count('SELECT COUNT(*) AS count FROM p_chatbot_turns WHERE chatbot_user_id = ? AND visitor_id = ?'),
    events: count(`SELECT COUNT(*) AS count FROM p_chatbot_turn_events WHERE turn_id IN (
                     SELECT turn_id FROM p_chatbot_turns WHERE chatbot_user_id = ? AND visitor_id = ?)`),
    actions: count(`SELECT COUNT(*) AS count FROM p_chatbot_actions WHERE turn_id IN (
                      SELECT turn_id FROM p_chatbot_turns WHERE chatbot_user_id = ? AND visitor_id = ?)`),
    conversations: count('SELECT COUNT(*) AS count FROM p_chatbot_conversations WHERE chatbot_user_id = ? AND visitor_id = ?'),
    addresses: count('SELECT COUNT(*) AS count FROM p_chatbot_conversations WHERE chatbot_user_id = ? AND visitor_id = ? AND last_ip IS NOT NULL'),
  };
}

describe('when a conversation becomes due', () => {
  it('asks core to delete the transcript FIRST, and only then removes what the plugin holds', async () => {
    conversation({ daysAgo: TEST_LIMITS.retentionDays! + 1 });
    const core = fakeCore();
    const { run } = cleaner(core.bridge);
    const result = await run();

    expect(core.asked).toEqual([{ chatbotUserId: 12, sessionId: 'brain-ch-chatbot-12:visitor-1' }]);
    expect(result).toMatchObject({ deleted: 1, deferred: 0 });
    // Nothing about that visitor is left: not the transcript projection, not the action audit, not the
    // conversation row itself.
    expect(holdings()).toEqual({ turns: 0, events: 0, actions: 0, conversations: 0, addresses: 0 });
  });

  it('leaves a conversation alone until its due date, and a live one alone however old', async () => {
    conversation({ daysAgo: 1 });
    conversation({ visitorId: 'visitor-2', daysAgo: TEST_LIMITS.retentionDays! + 5, activeTurn: true });
    const core = fakeCore();
    const result = await cleaner(core.bridge).run();

    expect(core.asked).toHaveLength(0);
    expect(result).toMatchObject({ deleted: 0, deferred: 0 });
    expect(holdings()).toMatchObject({ conversations: 1, addresses: 1 });
    expect(holdings('visitor-2')).toMatchObject({ conversations: 1, turns: 1, events: 1, actions: 1, addresses: 1 });
  });

  it('removes a conversation that never ran anything, without asking core about a session it never had', async () => {
    conversation({ daysAgo: TEST_LIMITS.retentionDays! + 1, sessionId: null });
    const core = fakeCore();
    const result = await cleaner(core.bridge).run();

    expect(core.asked).toHaveLength(0);
    expect(result).toMatchObject({ deleted: 1 });
    expect(holdings()).toEqual({ turns: 0, events: 0, actions: 0, conversations: 0, addresses: 0 });
  });

  it('works off a backlog in bounded batches rather than in one pass', async () => {
    for (let index = 0; index < 30; index += 1) {
      conversation({ visitorId: `visitor-${index}`, daysAgo: TEST_LIMITS.retentionDays! + 1 + index });
    }
    const core = fakeCore();
    const run = () => createRetentionCleaner({
      store: host.store,
      now: () => new Date(NOW_MS),
      core: core.bridge,
      info: () => undefined,
      warn: () => undefined,
    }).run();

    const first = await run();
    expect(first).toMatchObject({ deleted: 25 });
    expect(core.asked).toHaveLength(25);
    // The next pass takes the next batch: a backlog is worked off, not skipped.
    expect(await run()).toMatchObject({ deleted: 5 });
    expect(await run()).toMatchObject({ deleted: 0 });
  });

  it('does not run two passes at once', async () => {
    conversation({ daysAgo: TEST_LIMITS.retentionDays! + 1 });
    const core = fakeCore();
    const warnings: string[] = [];
    const one = createRetentionCleaner({
      store: host.store,
      now: () => new Date(NOW_MS),
      core: core.bridge,
      info: () => undefined,
      warn: (message) => { warnings.push(message); },
    });
    const [first, second] = await Promise.all([one.run(), one.run()]);
    // One of them did the work and the other said why it did not: a second pass would delete the same
    // conversation again and pay for it twice.
    expect([first, second].filter((result) => result === null)).toHaveLength(1);
    expect(warnings.some((warning) => warning.includes('previous pass'))).toBe(true);
    expect(core.asked).toHaveLength(1);
  });

  it('keeps EVERYTHING when core does not confirm the delete', async () => {
    conversation({ daysAgo: TEST_LIMITS.retentionDays! + 1 });
    for (const answer of [
      { ok: false, reason: 'transport' },
      { ok: false, reason: 'no_credential' },
      { ok: false, reason: 'unverified' },
    ] as CoreSessionDeletion[]) {
      const core = fakeCore(answer);
      const { run, warnings } = cleaner(core.bridge);
      const result = await run();
      expect(result, answer.reason).toMatchObject({ deleted: 0, deferred: 1 });
      // The plugin's copy stays with it: a transcript this plugin could not confirm deleted is a transcript
      // that is still there, and dropping its own record of it would hide exactly that.
      expect(holdings(), answer.reason).toEqual({ turns: 1, events: 1, actions: 1, conversations: 1, addresses: 1 });
      expect(warnings.some((warning) => warning.includes('core did not confirm'))).toBe(true);
    }
  });

  it('accepts core saying the session is already gone', async () => {
    conversation({ daysAgo: TEST_LIMITS.retentionDays! + 1 });
    const core = fakeCore({ ok: true, outcome: 'absent' });
    expect(await cleaner(core.bridge).run()).toMatchObject({ deleted: 1 });
    expect(holdings()).toEqual({ turns: 0, events: 0, actions: 0, conversations: 0, addresses: 0 });
  });
});

describe('the sweeps around retention', () => {
  it('removes expired visitor tokens and keeps live ones', async () => {
    const issued = await issueToken(host);
    const live = host.store.token((JSON.parse(Buffer.from((issued.body.token as string).split('.')[1]!, 'base64url').toString('utf8')) as { jti: string }).jti)!;
    // One token of the same visitor that ran out: only the ledger row is deleted, and only for that one.
    host.store.issueToken({
      jti: 'expired-jti',
      chatbotUserId: 12,
      visitorId: live.visitor_id,
      tokenHash: 'hash-of-a-token-nobody-holds',
      issuedAt: new Date(NOW_MS - 10 * 86_400_000).toISOString(),
      expiresAt: new Date(NOW_MS - 86_400_000).toISOString(),
      rotate: false,
    });

    const result = await cleaner(fakeCore().bridge).run();
    expect(result).toMatchObject({ tokens: 1 });
    expect(host.store.token('expired-jti')).toBeNull();
    expect(host.store.token(live.jti)).not.toBeNull();
  });

  it('removes a visitor once nothing can reach them and nothing is left to come back to', async () => {
    const issued = await issueToken(host);
    expect(host.store.visitor(issued.body.visitorId as string)).not.toBeNull();

    // A visitor with a live token is still reachable, so their identity stays.
    expect((await cleaner(fakeCore().bridge).run())!.visitors).toBe(0);
    expect(host.store.visitor(issued.body.visitorId as string)).not.toBeNull();

    // Revoke what they hold and the identity has nothing to come back to.
    host.db.prepare('UPDATE p_chatbot_tokens SET revoked_at = ? WHERE visitor_id = ?')
      .run(new Date(NOW_MS).toISOString(), issued.body.visitorId);
    expect((await cleaner(fakeCore().bridge).run())!.visitors).toBe(1);
    expect(host.store.visitor(issued.body.visitorId as string)).toBeNull();
  });

  it('keeps the identity of a visitor whose conversation is still inside its retention window', async () => {
    const issued = await issueToken(host);
    host.store.touchConversation({
      chatbotUserId: 12,
      visitorId: issued.body.visitorId as string,
      sessionId: null,
      ip: null,
      retentionDays: TEST_LIMITS.retentionDays!,
      now: new Date(NOW_MS).toISOString(),
    });
    host.db.prepare('UPDATE p_chatbot_tokens SET revoked_at = ? WHERE visitor_id = ?')
      .run(new Date(NOW_MS).toISOString(), issued.body.visitorId);

    expect((await cleaner(fakeCore().bridge).run())!.visitors).toBe(0);
    expect(host.store.visitor(issued.body.visitorId as string)).not.toBeNull();
  });

  it('removes rate windows whose minute is over and keeps the one in force', async () => {
    const issued = await issueToken(host);
    expect(await host.handler(postRequest({
      path: 'turns',
      headers: { origin: SITE, authorization: `ChatbotVisitor ${issued.body.token}` },
      body: { schemaVersion: 2, clientTurnId: UUID, message: 'ahoj', page: TURN_PAGE },
    }))).toMatchObject({ status: 202 });
    host.db.prepare(`INSERT INTO p_chatbot_rate_windows (scope, scope_key, window_started_at, count, expires_at)
                     VALUES ('ip', '12:203.0.113.9', ?, 4, ?)`)
      .run(new Date(NOW_MS - 120_000).toISOString(), new Date(NOW_MS - 60_000).toISOString());

    const result = await cleaner(fakeCore().bridge).run();
    expect(result).toMatchObject({ windows: 1 });
    const left = host.db.prepare('SELECT COUNT(*) AS count FROM p_chatbot_rate_windows').get() as { count: number };
    expect(left.count).toBe(3);
  });
});

describe('the conversation clock', () => {
  it('records the core session and moves the due date when a turn finishes', async () => {
    const issued = await issueToken(host);
    const accepted = await host.handler(postRequest({
      path: 'turns',
      headers: { origin: SITE, authorization: `ChatbotVisitor ${issued.body.token}` },
      body: { schemaVersion: 2, clientTurnId: UUID, message: 'ahoj', page: TURN_PAGE },
    }));
    const turnId = (accepted.body as { turnId: string }).turnId;
    await settledTurn(host, turnId);

    const conversation = host.store.erasableConversations({ chatbotUserId: 12, limit: 10 }).find((row) => row.visitor_id === issued.body.visitorId)!;
    // The session id is the one the RELAY reported, never one this plugin derived: it is what the cleaner
    // hands core, so a mistaken id here would delete somebody else's conversation or none at all.
    expect(conversation.session_id).toBe('brain-ch-chatbot-session');
    expect(conversation.last_activity_at).toBe(new Date(NOW_MS).toISOString());
    expect(conversation.delete_after).toBe(new Date(NOW_MS + TEST_LIMITS.retentionDays! * 86_400_000).toISOString());
  });

  it('keeps the visitor\'s LAST address the host vouched for, and only that', async () => {
    const issued = await issueToken(host);
    const visitorId = issued.body.visitorId as string;
    const submit = (clientTurnId: string, origin: { value: string; kind: 'ip'; trusted: boolean }) => host.handler(postRequest({
      path: 'turns',
      headers: { origin: SITE, authorization: `ChatbotVisitor ${issued.body.token}` },
      body: { schemaVersion: 2, clientTurnId, message: 'ahoj', page: TURN_PAGE },
      origin,
    }));

    const first = await submit(UUID, { value: '203.0.113.9', kind: 'ip', trusted: true });
    await settledTurn(host, (first.body as { turnId: string }).turnId);
    // The turn finishing re-stamps the conversation, and must not forget the address it was admitted from.
    expect(host.store.erasableConversations({ chatbotUserId: 12, limit: 10 }).find((row) => row.visitor_id === visitorId)!.last_ip).toBe('203.0.113.9');

    // A value the host does not vouch for is refused before anything is written, so it can never be stored.
    expect(await submit(randomUUID(), { value: '192.0.2.66', kind: 'ip', trusted: false })).toMatchObject({ status: 403 });
    expect(host.store.erasableConversations({ chatbotUserId: 12, limit: 10 }).find((row) => row.visitor_id === visitorId)!.last_ip).toBe('203.0.113.9');

    // The visitor moved networks: the next admitted message replaces the address rather than adding one.
    const second = await submit(randomUUID(), { value: '198.51.100.20', kind: 'ip', trusted: true });
    await settledTurn(host, (second.body as { turnId: string }).turnId);
    expect(host.store.erasableConversations({ chatbotUserId: 12, limit: 10 }).find((row) => row.visitor_id === visitorId)!.last_ip).toBe('198.51.100.20');
  });
});

describe('the plugin holds nothing after a visitor is gone', () => {
  it('takes a chatbot\'s conversations, budget days and identity away with its account', async () => {
    conversation({ daysAgo: 1 });
    host.store.admitTurn({
      turnId: randomUUID(),
      bot: host.store.botByUserId(12)!,
      visitorId: VISITOR,
      clientTurnId: randomUUID(),
      message: 'ahoj',
      page: TURN_PAGE,
      originValue: '203.0.113.9',
      now: new Date(NOW_MS).toISOString(),
      nowMs: NOW_MS,
    });
    expect(host.store.budgetDay(12, DAY).admitted_turns).toBe(1);

    host.store.deleteBot(12);
    expect(host.store.botByUserId(12)).toBeNull();
    expect(host.store.botByPublicId(host.store.listBots()[0]?.public_id ?? '')).toBeNull();
    expect(holdings()).toEqual({ turns: 0, events: 0, actions: 0, conversations: 0, addresses: 0 });
    expect(host.store.budgetDay(12, DAY).admitted_turns).toBe(0);
    expect(host.store.visitor(VISITOR)).toBeNull();
  });

  it('closes interrupted turns without losing admitted-turn counts', () => {
    conversation({ daysAgo: 0 });
    host.store.admitTurn({
      turnId: randomUUID(),
      bot: host.store.botByUserId(12)!,
      visitorId: VISITOR,
      clientTurnId: randomUUID(),
      message: 'ahoj',
      page: TURN_PAGE,
      originValue: '203.0.113.9',
      now: new Date(NOW_MS).toISOString(),
      nowMs: NOW_MS,
    });
    const closed = host.store.closeOrphanedTurns(new Date(NOW_MS).toISOString(), 'server_restarted');
    expect(closed).toHaveLength(1);
    expect(host.store.budgetDay(12, DAY).admitted_turns).toBe(1);
  });
});

describe('the bridge to the daemon', () => {
  /** One delete through the bridge. `token: null` is a host that will not mint a credential for this account,
   *  which is a different thing from a token that is merely not a string. */
  const call = (fetchImpl: typeof fetch, token: string | null = 'advisor-token') =>
    createCoreSessionBridge({
      baseUrl: () => 'http://localhost:4400',
      tokenForUser: () => token ?? undefined,
      fetchImpl,
    }).deleteSession({ chatbotUserId: 12, sessionId: 'brain-ch-chatbot-12:visitor-1' });

  const response = (status: number, body: unknown): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('sends the account\'s own token to the daemon\'s own address, and nothing else', async () => {
    const seen: { url: string; init: RequestInit | undefined }[] = [];
    const answer = await call((async (url: string, init?: RequestInit) => {
      seen.push({ url, init });
      return response(200, { ok: true });
    }) as typeof fetch);

    expect(answer).toEqual({ ok: true, outcome: 'deleted' });
    expect(seen).toHaveLength(1);
    // The session id travels in the path, the credential in a header — never in a query string, which would
    // end up in an access log, a Referer and a shell history.
    expect(seen[0]!.url).toBe('http://localhost:4400/brain/sessions/brain-ch-chatbot-12%3Avisitor-1');
    expect(seen[0]!.init?.method).toBe('DELETE');
    expect((seen[0]!.init?.headers as Record<string, string>).authorization).toBe('Bearer advisor-token');
  });

  it('reads a 404 as "already gone" only when the daemon says so itself', async () => {
    expect(await call((async () => response(404, { error: 'unknown session' })) as typeof fetch))
      .toEqual({ ok: true, outcome: 'absent' });
    // A 404 from anything else — a proxy, a renamed route, a typo — is NOT proof that the transcript is gone,
    // and reading it as one would quietly stop deleting anything at all.
    for (const body of [{ error: 'not found' }, { errors: 'unknown session' }, 'unknown session']) {
      expect(await call((async () => response(404, body)) as typeof fetch), JSON.stringify(body))
        .toEqual({ ok: false, reason: 'unverified' });
    }
    expect(await call((async () => new Response('<html>404</html>', { status: 404 })) as typeof fetch))
      .toEqual({ ok: false, reason: 'unverified' });
  });

  it('keeps everything when the daemon answers anything else, or does not answer', async () => {
    for (const status of [401, 403, 409, 500, 502]) {
      expect(await call((async () => response(status, { error: 'x' })) as typeof fetch), String(status))
        .toEqual({ ok: false, reason: 'unverified' });
    }
    expect(await call((async () => { throw new Error('ECONNREFUSED'); }) as typeof fetch))
      .toEqual({ ok: false, reason: 'transport' });
  });

  it('refuses to invent a credential or an address', async () => {
    expect(await call((async () => response(200, { ok: true })) as typeof fetch, null))
      .toEqual({ ok: false, reason: 'no_credential' });
    expect(await createCoreSessionBridge({ baseUrl: () => null, tokenForUser: () => 'x' })
      .deleteSession({ chatbotUserId: 12, sessionId: 's' })).toEqual({ ok: false, reason: 'transport' });
  });
});

describe('the cleaner runs on a schedule the plugin sets', () => {
  it('asks for a pass every quarter of an hour', () => {
    expect(RETENTION_INTERVAL_MS).toBe(15 * 60_000);
  });
});
describe('when an operator erases a chatbot\'s conversations', () => {
  it('deletes them whatever their due date, through the same two steps as a pass', async () => {
    conversation({ visitorId: 'v-old', daysAgo: TEST_LIMITS.retentionDays! + 1 });
    conversation({ visitorId: 'v-today', daysAgo: 0 });
    const core = fakeCore();

    const result = await eraseConversations({
      store: host.store,
      now: () => new Date(NOW_MS),
      core: core.bridge,
      info: () => {},
      warn: () => {},
    }, { chatbotUserId: 12, limit: 50 });

    expect(result).toEqual({ deleted: 2, kept: 0 });
    // Core was asked first for every one of them, and nothing of the plugin's own survives.
    expect(core.asked).toHaveLength(2);
    expect(holdings('v-old')).toEqual({ turns: 0, events: 0, actions: 0, conversations: 0, addresses: 0 });
    expect(holdings('v-today')).toEqual({ turns: 0, events: 0, actions: 0, conversations: 0, addresses: 0 });
  });

  it('leaves a conversation whose answer is still being written, and says so', async () => {
    conversation({ visitorId: 'v-live', daysAgo: 0, activeTurn: true });
    const core = fakeCore();

    const result = await eraseConversations({
      store: host.store, now: () => new Date(NOW_MS), core: core.bridge, info: () => {}, warn: () => {},
    }, { chatbotUserId: 12, limit: 50 });

    expect(result).toEqual({ deleted: 0, kept: 0 });
    expect(core.asked).toHaveLength(0);
    expect(holdings('v-live')).toMatchObject({ conversations: 1, addresses: 1 });
  });

  it('keeps the plugin\'s rows when core does not confirm the delete', async () => {
    conversation({ visitorId: 'v-kept', daysAgo: 0 });
    const core = fakeCore({ ok: false, reason: 'unverified' });

    const result = await eraseConversations({
      store: host.store, now: () => new Date(NOW_MS), core: core.bridge, info: () => {}, warn: () => {},
    }, { chatbotUserId: 12, limit: 50 });

    expect(result).toEqual({ deleted: 0, kept: 1 });
    expect(holdings('v-kept')).toMatchObject({ conversations: 1, addresses: 1 });
  });
});
