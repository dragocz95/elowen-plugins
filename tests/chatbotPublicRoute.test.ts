// @vitest-environment node
import { describe, expect, it, beforeEach } from 'vitest';
import {
  CHATBOT_SECRET,
  CHATBOT_SITE as SITE,
  CLIENT_TURN_ID as UUID,
  createChatbotHost,
  issueToken,
  postRequest,
  publicRequest,
  registerBot,
  scriptedTurn,
  TEST_LIMITS,
  settledTurn,
  type ChatbotHost,
} from './helpers/chatbotHost.js';
import type { ChatbotAccountView, ChatbotProjectView } from '../plugins/chatbot/src/coreSeams.js';
import { mintVisitorToken } from '../plugins/chatbot/src/token.js';

/** The public message path, driven end to end against a fake host: a website asks for a token, sends a
 *  message, and the plugin's queue turns it into a relay call owned by the chatbot account. What is
 *  checked here is exactly what the security model rests on — the origin gate, the trusted network origin,
 *  the token as the only visitor authority, and one session per chatbot-and-visitor pair. */

async function issue(current: ChatbotHost, site = SITE, publicId?: string): Promise<{ status: number; body: Record<string, any> }> {
  return issueToken(current, { site, ...(publicId === undefined ? {} : { publicId }) });
}

/** One admitted message, reduced to what every test here asserts about it. */
function submit(current: ChatbotHost, token: string, body: Record<string, unknown> = {}): Promise<Awaited<ReturnType<ChatbotHost['handler']>>> {
  return current.handler(postRequest({
    path: 'turns',
    headers: { origin: SITE, authorization: `ChatbotVisitor ${token}` },
    body: { schemaVersion: 1, clientTurnId: UUID, message: 'ahoj', ...body },
  }));
}

/** The signed payload of a token this server issued. */
function payloadOf(visitorToken: string): { bot: string; sub: string; jti: string } {
  return JSON.parse(Buffer.from(visitorToken.split('.')[1]!, 'base64url').toString('utf8')) as { bot: string; sub: string; jti: string };
}

let current: ChatbotHost;
beforeEach(async () => {
  current = createChatbotHost();
  registerBot(current);
  await current.adapter.connect();
});

describe('admitting a public request', () => {
  it('refuses a request the host could not resolve a trusted network origin for', async () => {
    const bot = current.store.listBots()[0]!.public_id;
    const untrusted = await current.handler(postRequest({
      path: 'visitors',
      headers: { origin: SITE },
      body: { schemaVersion: 1, bot },
      origin: { value: '1.2.3.4', kind: 'ip', trusted: false },
    }));
    expect(untrusted).toMatchObject({ status: 403, body: { error: 'trusted_origin_required' } });

    const loopback = await current.handler(postRequest({
      path: 'visitors',
      headers: { origin: SITE },
      body: { schemaVersion: 1, bot },
      origin: { value: 'local', kind: 'local', trusted: true },
    }));
    expect(loopback).toMatchObject({ status: 403, body: { error: 'trusted_origin_required' } });
  });

  it('refuses a daemon that does not carry the origin seam at all', async () => {
    const answer = await current.handler(postRequest({
      path: 'visitors',
      headers: { origin: SITE },
      body: { schemaVersion: 1, bot: current.store.listBots()[0]!.public_id },
      origin: null,
    }));
    expect(answer).toMatchObject({ status: 403, body: { error: 'trusted_origin_required' } });
  });

  it('refuses a website that is not on the chatbot;s allowlist, or that sends no Origin at all', async () => {
    const bot = current.store.listBots()[0]!.public_id;
    expect(await current.handler(postRequest({ path: 'visitors', headers: { origin: 'https://evil.cz' }, body: { schemaVersion: 1, bot } })))
      .toMatchObject({ status: 403, body: { error: 'origin_not_allowed' } });
    expect(await current.handler(postRequest({ path: 'visitors', headers: {}, body: { schemaVersion: 1, bot } })))
      .toMatchObject({ status: 403, body: { error: 'origin_not_allowed' } });
  });

  it('refuses a body it is not told to interpret as JSON', async () => {
    const issued = await issue(current);
    // A form post from a third-party page carries no authorization header, but the refusal must not depend
    // on that: a body this API would have to GUESS at is never parsed.
    const answer = await current.handler(publicRequest({
      method: 'POST',
      path: 'turns',
      headers: { origin: SITE, authorization: `ChatbotVisitor ${issued.body.token}`, 'content-type': 'text/plain' },
      body: { schemaVersion: 1, clientTurnId: UUID, message: 'ahoj' },
    }));
    expect(answer).toMatchObject({ status: 415, body: { error: 'unsupported_media_type' } });
    expect(current.store.queuedTurns(10)).toHaveLength(0);
  });

  it('answers an unknown or not-yet-enabled chatbot the same way, without revealing which it is', async () => {
    expect((await issue(current, SITE, `cbt_${'b'.repeat(24)}`)).status).toBe(404);
    const draft = createChatbotHost();
    registerBot(draft, { status: 'draft' });
    await draft.adapter.connect();
    expect((await issue(draft)).status).toBe(404);
  });

  it('refuses everything while the platform adapter is not wired', async () => {
    const cold = createChatbotHost();
    registerBot(cold);
    // No connect(): the host never handed this adapter its relay control.
    expect((await issue(cold)).status).toBe(503);
  });
});

describe('the visitor token is the only visitor authority', () => {
  it('issues a token bound to the chatbot, and refuses a message without one', async () => {
    const issued = await issue(current);
    expect(issued.status).toBe(200);
    expect(issued.body.visitorId).toMatch(/^[0-9a-f]{32}$/);
    expect(issued.body.token).toMatch(/^v1\./);
    expect(issued.body.bot.publicId).toBe(current.store.listBots()[0]!.public_id);

    expect(await current.handler(postRequest({ path: 'turns', headers: { origin: SITE }, body: { schemaVersion: 1, clientTurnId: UUID, message: 'ahoj' } })))
      .toMatchObject({ status: 401, body: { error: 'token_required' } });
    expect(await current.handler(postRequest({ path: 'turns', headers: { origin: SITE, authorization: 'ChatbotVisitor nonsense' }, body: { schemaVersion: 1, clientTurnId: UUID, message: 'ahoj' } })))
      .toMatchObject({ status: 401, body: { error: 'invalid_token' } });
  });

  it('refuses a token that a REVOKED row records, even though its signature is still valid', async () => {
    const first = await issue(current);
    // Rotation revokes the predecessor in the same transaction that issues the successor.
    const rotated = await current.handler(publicRequest({ method: 'POST', path: 'visitors/refresh', headers: { origin: SITE, authorization: `ChatbotVisitor ${first.body.token}` } }));
    expect(rotated.status).toBe(200);
    expect(await submit(current, first.body.token)).toMatchObject({ status: 401, body: { error: 'invalid_token' } });
    expect(await submit(current, (rotated.body as Record<string, string>).token)).toMatchObject({ status: 202 });
  });

  it('cannot be used from another website than the one it was issued for', async () => {
    const issued = await issue(current);
    expect(await current.handler(postRequest({
      path: 'turns',
      headers: { origin: 'https://evil.cz', authorization: `ChatbotVisitor ${issued.body.token}` },
      body: { schemaVersion: 1, clientTurnId: UUID, message: 'ahoj' },
    }))).toMatchObject({ status: 403, body: { error: 'origin_not_allowed' } });
  });

  it('refuses a token whose signed chatbot, token row and visitor row do not all agree', async () => {
    const issued = await issue(current);
    const visitorId = issued.body.visitorId as string;
    const jti = (JSON.parse(Buffer.from((issued.body.token as string).split('.')[1]!, 'base64url').toString('utf8')) as { jti: string }).jti;

    // A second chatbot is registered, and a token is forged for it that reuses the FIRST chatbot's token
    // row and visitor. Re-signing with the plugin's own key is the strongest form of this attack a caller
    // could mount, so the database binding — not the signature — is what has to refuse it.
    current.store.createBot({ chatbotUserId: 13, publicId: `cbt_${'c'.repeat(24)}`, displayName: 'Škola', prompt: '', origins: [SITE], limits: TEST_LIMITS, now: new Date().toISOString() });
    current.store.setBotStatus({ chatbotUserId: 13, status: 'enabled', now: new Date().toISOString() });
    const forged = mintVisitorToken(CHATBOT_SECRET, {
      v: 1,
      bot: `cbt_${'c'.repeat(24)}`,
      sub: visitorId,
      jti,
      iat: Math.floor(1_800_000_000_000 / 1000),
      exp: Math.floor(1_800_000_000_000 / 1000) + 3600,
    });
    expect(await submit(current, forged)).toMatchObject({ status: 401, body: { error: 'invalid_token' } });
    expect(current.calls).toHaveLength(0);
  });

  it('refuses a stored token row that disagrees with its own signed payload', async () => {
    const issued = await issue(current);
    const { jti } = payloadOf(issued.body.token as string);
    // The row and the payload must agree on BOTH identities. The shape a bug could produce — the ledger
    // filing a live token under another chatbot's account — is the one this branch exists for, so it is
    // written straight into the plugin's table: the presented token still hashes to its own row, and only
    // the row-versus-payload comparison can refuse it.
    current.db.prepare('UPDATE p_chatbot_tokens SET chatbot_user_id = 13 WHERE jti = ?').run(jti);
    expect(await submit(current, issued.body.token)).toMatchObject({ status: 401, body: { error: 'invalid_token' } });
    expect(current.store.queuedTurns(10)).toHaveLength(0);
  });

  it('stops admitting turns the moment the chatbot is disabled, without queueing anything', async () => {
    const issued = await issue(current);
    current.store.setBotStatus({ chatbotUserId: 12, status: 'disabled', now: new Date().toISOString() });
    expect(await submit(current, issued.body.token)).toMatchObject({ status: 404, body: { error: 'bot_unavailable' } });
    expect(current.store.turnByClientId(12, issued.body.visitorId as string, UUID)).toBeNull();
    expect(current.calls).toHaveLength(0);
  });
});

describe('the message path', () => {
  it('accepts a message with a receipt and runs the turn in the chatbot;s own session', async () => {
    const issued = await issue(current);
    const accepted = await submit(current, issued.body.token, { message: 'Potřebuji vyplnit formulář.' });
    expect(accepted).toMatchObject({ status: 202, body: { status: 'queued', lastSeq: 0 } });
    const turnId = (accepted.body as Record<string, string>).turnId;
    expect(await settledTurn(current, turnId)).toBe('done');

    expect(current.calls).toHaveLength(1);
    const call = current.calls[0]!;
    expect(call.text).toBe('Potřebuji vyplnit formulář.');
    expect(call.src.platform).toBe('chatbot');
    expect(call.src.channelId).toBe(`12:${issued.body.visitorId}`);
    expect(call.src.access?.actAsUserId).toBe(12);
    // The relay is observed, never handed a cancellation: a browser that goes away is a detached watcher,
    // not a reason to abort a turn the host already owns.
    expect(call.observer?.signal).toBeUndefined();
    expect(current.store.turn(turnId)?.core_session_id).toBe('brain-ch-chatbot-session');

    // The public log carries the answer and the lifecycle, and nothing the model thought or ran.
    const events = current.store.events(turnId);
    expect(events.map((event) => event.type)).toEqual(['accepted', 'text_delta', 'done']);
    expect(JSON.parse(events[2]!.data)).toEqual({ text: 'Dobrý den, s čím pomohu?' });
    expect(events.some((event) => event.data.includes('internal thinking'))).toBe(false);
  });

  it('keeps two visitors of one chatbot in two sessions', async () => {
    const first = await issue(current);
    const second = await issue(current);
    expect(first.body.visitorId).not.toBe(second.body.visitorId);
    for (const issued of [first, second]) await submit(current, issued.body.token);
    for (let attempt = 0; attempt < 200 && current.calls.length < 2; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    expect(current.calls.map((call) => call.src.channelId)).toEqual([`12:${first.body.visitorId}`, `12:${second.body.visitorId}`]);
  });

  it('gives two chatbots different acting accounts and different sessions', async () => {
    const second = createChatbotHost({
      accounts: [
        { id: 12, username: 'ured-bot', name: 'Úřad', avatar: '', isAdmin: false, type: 'chatbot' },
        { id: 13, username: 'skola-bot', name: 'Škola', avatar: '', isAdmin: false, type: 'chatbot' },
      ],
    });
    second.store.createBot({ chatbotUserId: 13, publicId: `cbt_${'c'.repeat(24)}`, displayName: 'Škola', prompt: '', origins: [SITE], limits: TEST_LIMITS, now: new Date().toISOString() });
    second.store.setBotStatus({ chatbotUserId: 13, status: 'enabled', now: new Date().toISOString() });
    await second.adapter.connect();

    const firstToken = await issue(current);
    const secondToken = await issue(second, SITE, `cbt_${'c'.repeat(24)}`);
    expect(secondToken.status).toBe(200);

    await submit(current, firstToken.body.token);
    await second.handler(postRequest({
      path: 'turns',
      headers: { origin: SITE, authorization: `ChatbotVisitor ${secondToken.body.token}` },
      body: { schemaVersion: 1, clientTurnId: UUID, message: 'ahoj' },
    }));
    for (let attempt = 0; attempt < 200 && (current.calls.length < 1 || second.calls.length < 1); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    expect(current.calls[0]!.src.access?.actAsUserId).toBe(12);
    expect(second.calls[0]!.src.access?.actAsUserId).toBe(13);
    expect(current.calls[0]!.src.channelId).not.toBe(second.calls[0]!.src.channelId);
  });

  it('submits one message once, however many times the widget retries it', async () => {
    const issued = await issue(current);
    const first = await submit(current, issued.body.token);
    const retry = await submit(current, issued.body.token);
    expect(retry.body).toEqual(first.body);
    await settledTurn(current, (first.body as Record<string, string>).turnId!);
    expect(current.store.queuedTurns(10)).toHaveLength(0);
    expect(current.calls).toHaveLength(1);
  });

  it('keeps one client turn id from replaying into another visitor;s conversation', async () => {
    const first = await issue(current);
    const second = await issue(current);
    // The SAME client turn id from two visitors is two conversations: idempotence is keyed on the
    // conversation, so a leaked or repeated id cannot hand one visitor another's turn.
    const firstTurn = await submit(current, first.body.token);
    const secondTurn = await submit(current, second.body.token);
    expect((secondTurn.body as Record<string, string>).turnId).not.toBe((firstTurn.body as Record<string, string>).turnId);
    for (let attempt = 0; attempt < 200 && current.calls.length < 2; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    expect(current.calls.map((call) => call.src.userId)).toEqual([first.body.visitorId, second.body.visitorId]);
  });

  it('reports a relay that resolved without a reply as an error, never as an empty answer', async () => {
    current.handleTurn = scriptedTurn(undefined);
    const issued = await issue(current);
    const accepted = await submit(current, issued.body.token);
    const turnId = (accepted.body as Record<string, string>).turnId;
    expect(await settledTurn(current, turnId)).toBe('error');
    const events = current.store.events(turnId);
    // No text_delta at all: the relay produced no deltas, and an absent answer is never written as an
    // empty string a widget would render as a blank bubble.
    expect(events.map((event) => event.type)).toEqual(['accepted', 'error']);
    expect(JSON.parse(events[1]!.data)).toEqual({ code: 'relay_no_reply' });
    expect(current.warnings.some((warning) => warning.includes('no reply'))).toBe(true);
  });

  it('refuses a turn when the account stopped being usable, before anything is queued', async () => {
    const projects: ChatbotProjectView[] = [{ id: 4, slug: 'ured', path: '/ured', executionKind: 'managed' }];
    const accounts: ChatbotAccountView[] = [{ id: 12, username: 'ured-bot', name: 'Úřad', avatar: '', isAdmin: false, type: 'chatbot' }];
    const live = createChatbotHost({ accounts, projects });
    registerBot(live);
    await live.adapter.connect();
    const issued = await issue(live);
    expect(issued.status).toBe(200);

    // A second managed Project appears for the same account: "exactly one" no longer holds.
    projects.push({ id: 5, slug: 'ured-2', path: '/ured2', executionKind: 'managed' });
    const post = () => live.handler(postRequest({
      path: 'turns',
      headers: { origin: SITE, authorization: `ChatbotVisitor ${issued.body.token}` },
      body: { schemaVersion: 1, clientTurnId: UUID, message: 'ahoj' },
    }));
    expect(await post()).toMatchObject({ status: 503, body: { error: 'bot_unavailable' } });
    expect(live.store.turnByClientId(12, issued.body.visitorId as string, UUID)).toBeNull();

    // …and the same answer when the account is promoted, or turns out not to be a chatbot account, or is
    // gone entirely. Each is a different fact about the account, and all three fail closed at the same gate.
    projects.pop();
    accounts[0] = { id: 12, username: 'ured-bot', name: 'Úřad', avatar: '', isAdmin: true, type: 'chatbot' };
    expect(await post()).toMatchObject({ status: 503, body: { error: 'bot_unavailable' } });
    accounts[0] = { id: 12, username: 'ured-bot', name: 'Úřad', avatar: '', isAdmin: false, type: 'human' };
    expect(await post()).toMatchObject({ status: 503, body: { error: 'bot_unavailable' } });
    accounts.length = 0;
    expect(await post()).toMatchObject({ status: 503, body: { error: 'bot_unavailable' } });
    expect(live.calls).toHaveLength(0);
  });

  it('refuses an account that is not a chatbot account at all', async () => {
    const human = createChatbotHost({ accounts: [{ id: 12, username: 'operator', name: 'Operátor', avatar: '', isAdmin: false, type: 'human' }] });
    registerBot(human);
    await human.adapter.connect();
    expect((await issue(human)).status).toBe(503);
  });
});

describe('the visitor turn carries no account-wide authority', () => {
  it('denies every memory tool and never asks for admin', async () => {
    const issued = await issue(current);
    await settledTurn(current, (await submit(current, issued.body.token)).body.turnId as string);
    const access = current.calls[0]!.src.access;
    // One account serves every visitor, so an agent that REMEMBERS one visitor's details can put them in
    // the next visitor's prompt. The tools are denied per turn on top of core's account-level rule.
    expect(access?.denyTools).toHaveLength(10);
    expect(new Set(access?.denyTools)).toEqual(new Set([
      'MemorySearch', 'MemoryAdd', 'MemoryUpdate', 'MemoryMerge', 'MemoryDelete', 'MemoryListRecent',
      'MemoryCategories', 'MemoryCategoryCreate', 'MemoryCategoryDelete', 'MemoryRecategorize',
    ]));
    expect(access?.admin).toBe(false);
    expect(current.calls[0]!.src.roleIds).toEqual([]);
  });
});

describe('the public path rejects what it does not implement', () => {
  it('404s an unknown endpoint and 400s a body with an unknown field', async () => {
    const bot = current.store.listBots()[0]!.public_id;
    expect(await current.handler(publicRequest({ method: 'GET', path: 'nothing/here', headers: { origin: SITE } })))
      .toMatchObject({ status: 404, body: { error: 'not_found' } });
    expect(await current.handler(postRequest({ path: 'visitors', headers: { origin: SITE }, body: { schemaVersion: 1, bot, page: {} } })))
      .toMatchObject({ status: 400, body: { error: 'invalid_request' } });
  });
});
