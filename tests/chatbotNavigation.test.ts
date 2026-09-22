// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CHATBOT_SITE, NOW_MS, createChatbotHost, issueToken, postRequest, publicRequest, registerBot } from './helpers/chatbotHost.js';
import { PUBLIC_SCHEMA_VERSION, HANDOFF_FRAGMENT_KEY } from '../plugins/chatbot/src/publicContract.js';
import { composeMessage } from '../plugins/chatbot/embed-src/protocol.js';
import { verifyVisitorToken, hashToken } from '../plugins/chatbot/src/token.js';
import { CHATBOT_SECRET } from './helpers/chatbotHost.js';

const TARGET = 'https://other.example.cz';
const snapshotId = 's0123456789abcdef';
const now = new Date(NOW_MS).toISOString();
const snapshot = JSON.stringify({ snapshotId, url: CHATBOT_SITE + '/form', title: 'Form', aria: '- textbox "Name [e0]"',
  targets: [{ id: 'e0', caps: ['read', 'fill'] }], truncated: false });

async function setup() {
  const host = createChatbotHost({ actionTimeoutMs: 100 });
  registerBot(host, { origins: [CHATBOT_SITE, TARGET] });
  await host.adapter.connect();
  const issued = await issueToken(host);
  const bot = host.store.listBots()[0]!;
  const turn = host.store.createTurn({ turnId: randomUUID(), chatbotUserId: bot.chatbot_user_id,
    visitorId: issued.body.visitorId, clientTurnId: randomUUID(),
    message: composeMessage('Help', JSON.stringify({ url: CHATBOT_SITE + '/form', title: 'Form' })).message, now });
  host.store.markTurnRunning(turn.turn_id, now);
  const ask = (kind: string, value: string | null = null, id: string | null = snapshotId, targetId: string | null = null) =>
    host.actions.request({ turn, chatbotUserId: 12, sessionId: undefined, request: { snapshotId: id, kind, value, targetId } });
  const first = ask('snapshot', null, null);
  const row = host.store.latestPageAction(turn.turn_id)!;
  expect(host.actions.reportResult({ turn, actionId: row.id, outcome: 'done', detail: snapshot, origin: CHATBOT_SITE }).ok).toBe(true);
  expect(await first).toMatchObject({ status: 'done', detail: snapshot });
  const handoff = (body: Record<string, unknown>, origin = CHATBOT_SITE, token: string | null = issued.body.token) =>
    host.handler(postRequest({ path: 'handoff', headers: { origin, ...(token ? { authorization: 'ChatbotVisitor ' + token } : {}) },
      body: { schemaVersion: PUBLIC_SCHEMA_VERSION, ...body } }));
  return { host, bot, turn, issued, ask, handoff };
}

describe('on-demand snapshots and bounded navigation handoff', () => {
  it('binds each action to exactly the snapshot returned by the tool', async () => {
    const { host, turn, ask } = await setup();
    expect(turn.message).not.toContain('targets');
    expect(await ask('fill', 'A', 'sffffffffffffffff', 'e0')).toMatchObject({ status: 'refused', reason: 'stale_snapshot' });
    const reading = ask('snapshot', null, null);
    const row = host.store.latestPageAction(turn.turn_id)!;
    expect(host.actions.reportResult({ turn, actionId: row.id, outcome: 'done', detail: snapshot, origin: TARGET }))
      .toMatchObject({ ok: false, reason: 'invalid_result' });
    host.actions.reportResult({ turn, actionId: row.id, outcome: 'done', detail: snapshot.replace(snapshotId, 'sffffffffffffffff'), origin: CHATBOT_SITE });
    await reading;
    expect(await ask('fill', 'A', snapshotId, 'e0')).toMatchObject({ status: 'refused', reason: 'stale_snapshot' });
  });

  it('refuses off-origin destinations, credentials, script URLs and all history actions', async () => {
    const { ask } = await setup();
    for (const value of ['https://evil.example/a', 'https://user:secret@other.example.cz/', 'javascript:alert(1)']) {
      expect(await ask('navigate', value)).toMatchObject({ status: 'refused', reason: 'navigation_not_allowed' });
    }
    for (const kind of ['back', 'forward']) expect(await ask(kind)).toMatchObject({ status: 'refused', reason: 'unknown_action' });
  });

  it('redeems once, only on the target origin, preserving visitor and active turn', async () => {
    const { host, bot, turn, issued, ask, handoff } = await setup();
    host.store.appendEvent(turn.turn_id, 'text_delta', { text: 'Before navigation' }, now);
    const navigating = ask('navigate', TARGET + '/next#section');
    const action = host.store.latestPageAction(turn.turn_id)!;
    const ticket = await handoff({ turnId: turn.turn_id, actionId: action.id });
    expect(ticket.status).toBe(200);
    const url = new URL((ticket.body as { url: string }).url);
    const code = url.hash.split(HANDOFF_FRAGMENT_KEY + '=')[1]!;
    expect(url.hash).toContain('#section&');
    expect(code).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(ticket.body)).not.toContain(issued.body.token);
    const stored = host.db.prepare('SELECT code_hash FROM p_chatbot_handoffs').get() as { code_hash: string };
    expect(stored.code_hash).toBe(hashToken(code));
    expect((await handoff({ bot: bot.public_id, code }, CHATBOT_SITE, null)).status).toBe(403);
    const redeemed = await handoff({ bot: bot.public_id, code }, TARGET, null);
    expect(redeemed.status).toBe(200);
    const credential = (redeemed.body as { token: string }).token;
    const verified = verifyVisitorToken({ secret: CHATBOT_SECRET, token: credential, nowMs: NOW_MS });
    expect(verified.ok && verified.payload.sub).toBe(issued.body.visitorId);
    expect(await navigating).toMatchObject({ status: 'done', kind: 'navigate' });
    expect((await handoff({ bot: bot.public_id, code }, TARGET, null)).status).toBe(403);
    const conversation = await host.handler(publicRequest({ method: 'GET', path: 'conversation',
      headers: { origin: TARGET, authorization: 'ChatbotVisitor ' + credential } }));
    expect(conversation.body).toMatchObject({ activeTurnId: turn.turn_id });
    expect(await ask('fill', 'A', snapshotId, 'e0')).toMatchObject({ status: 'refused', reason: 'no_page_state' });
  });

  it('refuses expired handoffs and wrong visitor issuance', async () => {
    const { host, bot, turn, ask, handoff } = await setup();
    const navigating = ask('navigate', TARGET + '/next');
    const row = host.store.latestPageAction(turn.turn_id)!;
    const another = await issueToken(host);
    expect((await handoff({ turnId: turn.turn_id, actionId: row.id }, CHATBOT_SITE, another.body.token)).status).toBe(404);
    const ticket = await handoff({ turnId: turn.turn_id, actionId: row.id });
    const code = new URL((ticket.body as { url: string }).url).hash.split('=')[1]!;
    host.setNow(NOW_MS + 61_000);
    expect((await handoff({ bot: bot.public_id, code }, TARGET, null)).status).toBe(403);
    expect(await navigating).toMatchObject({ status: 'expired' });
  });
});
