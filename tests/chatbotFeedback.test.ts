// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { PluginApiAuth } from 'elowen/plugin-api';
import { createAdminApi } from '../plugins/chatbot/src/adminApi.js';
import { FEEDBACK_COMMENT_MAX_CHARS } from '../plugins/chatbot/src/publicContract.js';
import { CHATBOT_SITE, NOW_MS, TEST_LIMITS, TURN_PAGE, createChatbotHost, issueToken, postRequest, publicRequest, registerBot } from './helpers/chatbotHost.js';

const iso = (offset = 0) => new Date(NOW_MS + offset).toISOString();
function record(host: ReturnType<typeof createChatbotHost>, visitorId: string, chatbotUserId = 12, done = true) {
  const turnId = randomUUID();
  host.store.createTurn({ turnId, chatbotUserId, visitorId, clientTurnId: randomUUID(), message: 'Question', page: TURN_PAGE, now: iso() });
  if (done) {
    host.store.markTurnRunning(turnId, iso(1000));
    host.store.appendEvent(turnId, 'done', { text: 'Answer' }, iso(2000));
    host.store.finishTurn({ turnId, status: 'done', coreSessionId: 'session-feedback', errorCode: null, now: iso(2000) });
  }
  return turnId;
}
const headers = (token: string, origin = CHATBOT_SITE) => ({ origin, authorization: `ChatbotVisitor ${token}` });
const vote = (host: ReturnType<typeof createChatbotHost>, token: string, turnId: string, rating: string, comment?: string) =>
  host.handler(postRequest({ path: `turns/${turnId}/feedback`, headers: headers(token), body: { schemaVersion: 2, rating, ...(comment === undefined ? {} : { comment }) } }));

describe('visitor feedback', () => {
  it('accepts only this visitor’s finished turn on an allowed origin, and rejects long comments', async () => {
    const host = createChatbotHost();
    registerBot(host);
    await host.adapter.connect();
    const a = (await issueToken(host)).body;
    const b = (await issueToken(host)).body;
    const owned = record(host, a.visitorId);
    const other = record(host, b.visitorId);
    const waiting = record(host, a.visitorId, 12, false);
    expect((await vote(host, a.token, other, 'up')).status).toBe(404);
    expect((await vote(host, a.token, waiting, 'up')).status).toBe(404);
    expect((await host.handler(postRequest({ path: `turns/${owned}/feedback`, headers: headers(a.token, 'https://foreign.test'), body: { schemaVersion: 2, rating: 'up' } }))).status).toBe(403);
    expect((await vote(host, a.token, owned, 'down', 'x'.repeat(501))).status).toBe(400);
    expect((await vote(host, a.token, owned, 'down', '  Needs work  '))).toMatchObject({ status: 200, body: { rating: 'down', comment: 'Needs work' } });
  });

  it('changes a rating, restores it and removes it with the conversation', async () => {
    const host = createChatbotHost(); registerBot(host);
    await host.adapter.connect();
    const { token, visitorId } = (await issueToken(host)).body;
    const turnId = record(host, visitorId);
    expect((await vote(host, token, turnId, 'down', '  Try again  ')).status).toBe(200);
    expect((await vote(host, token, turnId, 'up')).status).toBe(200);
    const read = await host.handler(publicRequest({ method: 'GET', path: 'conversation', headers: headers(token) }));
    expect((read.body as { turns: { feedback: unknown }[] }).turns[0]!.feedback).toEqual({ rating: 'up', comment: null });
    expect(host.store.feedbackOf([turnId]).size).toBe(1);
    const conversation = host.store.erasableConversations({ chatbotUserId: 12, limit: 10 }).find((row) => row.visitor_id === visitorId)!;
    host.store.deleteConversation(conversation);
    expect(host.store.feedbackOf([turnId]).size).toBe(0);
  });

  it('counts unknown turn ids and malformed bodies before validation, then refuses the next attempt', async () => {
    const host = createChatbotHost();
    registerBot(host, { limits: { ...TEST_LIMITS, rateConversationPerMinute: 2 } });
    await host.adapter.connect();
    const { token, visitorId } = (await issueToken(host)).body;
    const owned = record(host, visitorId);
    expect((await vote(host, token, randomUUID(), 'up')).status).toBe(404);
    expect((await vote(host, token, owned, 'sideways')).status).toBe(400);
    expect((await vote(host, token, owned, 'sideways')).status).toBe(429);
    expect(host.store.feedbackOf([owned]).size).toBe(0);
  });

  it('uses the same rate windows as messages and removes votes when a bot is deleted', async () => {
    const host = createChatbotHost();
    registerBot(host, { limits: { ...TEST_LIMITS, rateConversationPerMinute: 1 } });
    await host.adapter.connect();
    const { token, visitorId } = (await issueToken(host)).body;
    const turnId = record(host, visitorId);
    expect((await vote(host, token, turnId, 'down')).status).toBe(200);
    expect((await vote(host, token, turnId, 'up')).status).toBe(429);
    expect(host.store.feedbackOf([turnId]).get(turnId)?.rating).toBe('down');
    host.store.deleteBot(12);
    expect(host.store.feedbackOf([turnId]).size).toBe(0);
  });

  it('filters the admin register and totals by bot and rating, refusing non-admin reads', async () => {
    const host = createChatbotHost({ accounts: [
      { id: 12, username: 'first', name: 'First', avatar: '', isAdmin: false, type: 'chatbot' },
      { id: 13, username: 'second', name: 'Second', avatar: '', isAdmin: false, type: 'chatbot' },
    ] });
    registerBot(host); registerBot(host, { chatbotUserId: 13 });
    for (const [bot, rating] of [[12, 'up'], [12, 'down'], [13, 'up']] as const) {
      const id = record(host, `v-${bot}-${rating}`, bot);
      host.store.saveFeedback({ turnId: id, chatbotUserId: bot, visitorId: `v-${bot}-${rating}`, rating, comment: null, now: iso(3000) });
    }
    const api = createAdminApi({ store: host.store, stores: host.stores, publicBaseUrl: () => null, now: () => new Date(NOW_MS), erase: async () => ({ deleted: 0, kept: 0 }), warn: () => undefined });
    const admin = { admin: true, userId: 1 } as PluginApiAuth;
    const guest = { admin: false, userId: 2 } as PluginApiAuth;
    expect((await api.feedback(guest, {})).status).toBe(403);
    expect((await api.feedback(admin, {})).body).toMatchObject({ totals: { up: 2, down: 1, total: 3 } });
    const filtered = await api.feedback(admin, { chatbotUserId: '12', rating: 'down' });
    expect(filtered.body).toMatchObject({ totals: { up: 0, down: 1, total: 1 }, rows: [{ chatbotUserId: 12, rating: 'down', reply: 'Answer', message: 'Question', sessionId: 'session-feedback' }] });
    expect((await api.feedback(admin, { rating: 'other' })).status).toBe(400);
  });

  it('keeps the database comment ceiling on the contract number', () => {
    // The hook validates first, so this drives the store directly: a comment at the ceiling stores, one
    // past it is refused by the table CHECK rather than truncated.
    const host = createChatbotHost();
    registerBot(host);
    const turnId = record(host, 'visitor-boundary');
    const save = (comment: string) =>
      host.store.saveFeedback({ turnId, chatbotUserId: 12, visitorId: 'visitor-boundary', rating: 'up', comment, now: iso() });
    save('x'.repeat(FEEDBACK_COMMENT_MAX_CHARS));
    expect(() => save('x'.repeat(FEEDBACK_COMMENT_MAX_CHARS + 1))).toThrow();
  });
});
