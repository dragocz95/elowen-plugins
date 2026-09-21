// @vitest-environment node
import { describe, expect, it, beforeEach } from 'vitest';
import type { SessionSource } from 'elowen/plugin-api';
import { pluginDbFor } from './helpers/pluginDb.js';
import { ChatbotAdapter } from '../plugins/chatbot/src/adapter.js';
import { migrate } from '../plugins/chatbot/src/db.js';
import { createPublicRoute } from '../plugins/chatbot/src/publicRoutes.js';
import { ChatbotStore } from '../plugins/chatbot/src/store.js';
import { ChatbotTurnQueue } from '../plugins/chatbot/src/queue.js';
import { mintVisitorToken, newSecret } from '../plugins/chatbot/src/token.js';
import type { ChatbotAccountView, ChatbotProjectView, ChatbotStores } from '../plugins/chatbot/src/coreSeams.js';

/** The public message path, driven end to end against a fake host: a website asks for a token, sends a
 *  message, and the plugin's queue turns it into a relay call owned by the chatbot account. What is
 *  checked here is exactly what the security model rests on — the origin gate, the trusted network origin,
 *  the token as the only visitor authority, and one session per chatbot-and-visitor pair. */

const SECRET = newSecret();
const UUID = '2f1a4c3e-9b7d-4f6a-8c2e-1d5b7a9f0c34';
const SITE = 'https://www.example.cz';

interface Host {
  store: ChatbotStore;
  adapter: ChatbotAdapter;
  queue: ChatbotTurnQueue;
  stores: ChatbotStores;
  handler: ReturnType<typeof createPublicRoute>;
  calls: { src: SessionSource; text: string }[];
  warnings: string[];
  /** What the relay resolves to; `undefined` is the documented "deliberate silence" case. */
  reply: string | undefined;
}

let hostCount = 0;

/** The host as this plugin sees it. `accounts` and `projects` are handed in as LIVE arrays so a test can
 *  change the world between two requests — which is exactly what the per-admission preflight exists for. */
function host(options: { accounts?: ChatbotAccountView[]; projects?: ChatbotProjectView[] } = {}): Host {
  hostCount += 1;
  // One in-memory database per host, addressed the way the loader addresses it: the helper returns the
  // per-plugin resolver, so the plugin's own migration bookkeeping is exercised for real.
  const db = pluginDbFor(`chatbot-test-${hostCount}`)('chatbot');
  migrate(db);
  const store = new ChatbotStore(db);
  const accounts: ChatbotAccountView[] = options.accounts ?? [
    { id: 12, username: 'ured-bot', name: 'Úřad', avatar: '', isAdmin: false, type: 'chatbot' },
  ];
  const projects: ChatbotProjectView[] = options.projects ?? [{ id: 4, slug: 'ured', path: '/ured', executionKind: 'managed' }];
  const stores = {
    usersRead: {
      list: () => accounts,
      isAdmin: (id: number) => accounts.find((account) => account.id === id)?.isAdmin === true,
      allowedExecs: () => [],
      mayUsePlugin: () => true,
    },
    projects: { get: (id: number) => projects.find((project) => project.id === id) ?? null, list: () => projects },
    userProjects: { canAccess: () => true, canManage: () => true },
  } as unknown as ChatbotStores;

  const calls: Host['calls'] = [];
  const warnings: string[] = [];
  const warn = (message: string): void => { warnings.push(message); };
  const adapter = new ChatbotAdapter(warn);
  adapter.listen(async () => undefined);
  const state: { reply: string | undefined } = { reply: 'Dobrý den, s čím pomohu?' };
  adapter.control({
    relay: async (src, text, observer) => {
      calls.push({ src, text });
      observer?.onEvent({ type: 'session', sessionId: 'brain-ch-chatbot-session' });
      // Reasoning and tool traffic are what a public log must never carry; the queue's allowlist drops them.
      observer?.onEvent({ type: 'reasoning', delta: 'internal thinking' });
      observer?.onEvent({ type: 'tool', name: 'Search' });
      observer?.onEvent({ type: 'text', delta: state.reply ?? '' });
      return Promise.resolve(state.reply);
    },
  });

  const queue = new ChatbotTurnQueue({ store, adapter, now: () => new Date(1_800_000_000_000).toISOString(), warn });
  const handler = createPublicRoute({
    store,
    queue,
    adapter,
    stores,
    secret: () => SECRET,
    tokenTtlSeconds: () => 30 * 86_400,
    now: () => new Date(1_800_000_000_000),
    warn,
  });

  return {
    store, adapter, queue, stores, handler, calls, warnings,
    get reply() { return state.reply; },
    set reply(value: string | undefined) { state.reply = value; },
  };
}

/** The origin the HOST resolved, which is a separate fact from the browser's Origin header. */
const requestOrigin = { value: '203.0.113.9', kind: 'ip' as const, trusted: true };

function request(input: { method: string; path: string; headers?: Record<string, string>; body?: unknown; origin?: typeof requestOrigin | null }): Parameters<ReturnType<typeof createPublicRoute>>[0] {
  // `null` drops the field entirely, which is how an older daemon that does not carry the seam looks.
  const origin = input.origin === undefined ? requestOrigin : input.origin;
  return {
    ...(origin === null ? {} : { origin }),
    method: input.method,
    path: input.path,
    query: {},
    headers: input.headers ?? {},
    body: () => Promise.resolve(Buffer.from(JSON.stringify(input.body ?? {}), 'utf8')),
    json: () => Promise.resolve(input.body ?? {}),
  } as Parameters<ReturnType<typeof createPublicRoute>>[0];
}

async function issueToken(current: Host, site = SITE, publicId?: string): Promise<{ status: number; body: Record<string, any> }> {
  const bot = publicId ?? current.store.listBots()[0]!.public_id;
  const answer = await current.handler(request({ method: 'POST', path: 'visitors', headers: { origin: site }, body: { schemaVersion: 1, bot } }));
  return { status: answer.status, body: answer.body as Record<string, any> };
}

function registerBot(current: Host, input: { chatbotUserId: number; origins?: string[]; status?: 'draft' | 'enabled' } = { chatbotUserId: 12 }): void {
  const row = current.store.createBot({
    chatbotUserId: input.chatbotUserId,
    publicId: `cbt_${'a'.repeat(24)}`,
    displayName: 'Městský úřad',
    prompt: 'Pomáhej s formuláři.',
    origins: input.origins ?? [SITE],
    now: new Date(1_800_000_000_000).toISOString(),
  });
  if ((input.status ?? 'enabled') === 'enabled') current.store.setBotStatus({ chatbotUserId: row.chatbot_user_id, status: 'enabled', now: row.updated_at });
}

/** The queue runs off the request path by design, so a test waits for the turn to settle rather than for
 *  the POST that submitted it. */
async function settled(current: Host, turnId: string): Promise<string> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const row = current.store.turn(turnId);
    if (row && (row.status === 'done' || row.status === 'error')) return row.status;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('turn never settled');
}

let current: Host;
beforeEach(async () => {
  current = host();
  registerBot(current);
  await current.adapter.connect();
});

describe('admitting a public request', () => {
  it('refuses a request the host could not resolve a trusted network origin for', async () => {
    const untrusted = await current.handler(request({ method: 'POST', path: 'visitors', headers: { origin: SITE }, body: { schemaVersion: 1, bot: current.store.listBots()[0]!.public_id }, origin: { value: '1.2.3.4', kind: 'ip', trusted: false } }));
    expect(untrusted).toMatchObject({ status: 403, body: { error: 'trusted_origin_required' } });

    const loopback = await current.handler(request({ method: 'POST', path: 'visitors', headers: { origin: SITE }, body: { schemaVersion: 1, bot: current.store.listBots()[0]!.public_id }, origin: { value: 'local', kind: 'local', trusted: true } }));
    expect(loopback).toMatchObject({ status: 403, body: { error: 'trusted_origin_required' } });
  });

  it('refuses a daemon that does not carry the origin seam at all', async () => {
    const answer = await current.handler(request({ method: 'POST', path: 'visitors', headers: { origin: SITE }, body: { schemaVersion: 1, bot: current.store.listBots()[0]!.public_id }, origin: null }));
    expect(answer).toMatchObject({ status: 403, body: { error: 'trusted_origin_required' } });
  });

  it('refuses a website that is not on the chatbot;s allowlist, or that sends no Origin at all', async () => {
    const bot = current.store.listBots()[0]!.public_id;
    expect(await current.handler(request({ method: 'POST', path: 'visitors', headers: { origin: 'https://evil.cz' }, body: { schemaVersion: 1, bot } })))
      .toMatchObject({ status: 403, body: { error: 'origin_not_allowed' } });
    expect(await current.handler(request({ method: 'POST', path: 'visitors', headers: {}, body: { schemaVersion: 1, bot } })))
      .toMatchObject({ status: 403, body: { error: 'origin_not_allowed' } });
  });

  it('answers an unknown or not-yet-enabled chatbot the same way, without revealing which it is', async () => {
    expect((await issueToken(current, SITE, `cbt_${'b'.repeat(24)}`)).status).toBe(404);
    const draft = host();
    registerBot(draft, { status: 'draft' });
    await draft.adapter.connect();
    expect((await issueToken(draft)).status).toBe(404);
  });

  it('refuses everything while the platform adapter is not wired', async () => {
    const cold = host();
    registerBot(cold);
    // No connect(): the host never handed this adapter its relay control.
    expect((await issueToken(cold)).status).toBe(503);
  });
});

describe('the visitor token is the only visitor authority', () => {
  it('issues a token bound to the chatbot, and refuses a message without one', async () => {
    const issued = await issueToken(current);
    expect(issued.status).toBe(200);
    expect(issued.body.visitorId).toMatch(/^[0-9a-f]{32}$/);
    expect(issued.body.token).toMatch(/^v1\./);
    expect(issued.body.bot.publicId).toBe(current.store.listBots()[0]!.public_id);

    expect(await current.handler(request({ method: 'POST', path: 'turns', headers: { origin: SITE }, body: { schemaVersion: 1, clientTurnId: UUID, message: 'ahoj' } })))
      .toMatchObject({ status: 401, body: { error: 'token_required' } });
    expect(await current.handler(request({ method: 'POST', path: 'turns', headers: { origin: SITE, authorization: 'ChatbotVisitor nonsense' }, body: { schemaVersion: 1, clientTurnId: UUID, message: 'ahoj' } })))
      .toMatchObject({ status: 401, body: { error: 'invalid_token' } });
  });

  it('refuses a token that a REVOKED row records, even though its signature is still valid', async () => {
    const first = await issueToken(current);
    // Rotation revokes the predecessor in the same transaction that issues the successor.
    const rotated = await current.handler(request({ method: 'POST', path: 'visitors/refresh', headers: { origin: SITE, authorization: `ChatbotVisitor ${first.body.token}` } }));
    expect(rotated.status).toBe(200);
    expect(await current.handler(request({ method: 'POST', path: 'turns', headers: { origin: SITE, authorization: `ChatbotVisitor ${first.body.token}` }, body: { schemaVersion: 1, clientTurnId: UUID, message: 'ahoj' } })))
      .toMatchObject({ status: 401, body: { error: 'invalid_token' } });
    expect(await current.handler(request({ method: 'POST', path: 'turns', headers: { origin: SITE, authorization: `ChatbotVisitor ${(rotated.body as Record<string, string>).token}` }, body: { schemaVersion: 1, clientTurnId: UUID, message: 'ahoj' } })))
      .toMatchObject({ status: 202 });
  });

  it('cannot be used from another website than the one it was issued for', async () => {
    const issued = await issueToken(current);
    expect(await current.handler(request({ method: 'POST', path: 'turns', headers: { origin: 'https://evil.cz', authorization: `ChatbotVisitor ${issued.body.token}` }, body: { schemaVersion: 1, clientTurnId: UUID, message: 'ahoj' } })))
      .toMatchObject({ status: 403, body: { error: 'origin_not_allowed' } });
  });

  it('refuses a token whose signed chatbot, token row and visitor row do not all agree', async () => {
    const issued = await issueToken(current);
    const visitorId = issued.body.visitorId as string;
    const jti = (JSON.parse(Buffer.from((issued.body.token as string).split('.')[1]!, 'base64url').toString('utf8')) as { jti: string }).jti;

    // A second chatbot is registered, and a token is forged for it that reuses the FIRST chatbot's token
    // row and visitor. Re-signing with the plugin's own key is the strongest form of this attack a caller
    // could mount, so the database binding — not the signature — is what has to refuse it.
    current.store.createBot({ chatbotUserId: 13, publicId: `cbt_${'c'.repeat(24)}`, displayName: 'Škola', prompt: '', origins: [SITE], now: new Date().toISOString() });
    current.store.setBotStatus({ chatbotUserId: 13, status: 'enabled', now: new Date().toISOString() });
    const forged = mintVisitorToken(SECRET, {
      v: 1,
      bot: `cbt_${'c'.repeat(24)}`,
      sub: visitorId,
      jti,
      iat: Math.floor(1_800_000_000_000 / 1000),
      exp: Math.floor(1_800_000_000_000 / 1000) + 3600,
    });
    expect(await current.handler(request({ method: 'POST', path: 'turns', headers: { origin: SITE, authorization: `ChatbotVisitor ${forged}` }, body: { schemaVersion: 1, clientTurnId: UUID, message: 'ahoj' } })))
      .toMatchObject({ status: 401, body: { error: 'invalid_token' } });
    expect(current.calls).toHaveLength(0);
  });
});

describe('the message path', () => {
  it('accepts a message with a receipt and runs the turn in the chatbot;s own session', async () => {
    const issued = await issueToken(current);
    const accepted = await current.handler(request({
      method: 'POST',
      path: 'turns',
      headers: { origin: SITE, authorization: `ChatbotVisitor ${issued.body.token}` },
      body: { schemaVersion: 1, clientTurnId: UUID, message: 'Potřebuji vyplnit formulář.' },
    }));
    expect(accepted).toMatchObject({ status: 202, body: { status: 'queued', lastSeq: 0 } });
    const turnId = (accepted.body as Record<string, string>).turnId;
    expect(await settled(current, turnId)).toBe('done');

    expect(current.calls).toHaveLength(1);
    const call = current.calls[0]!;
    expect(call.text).toBe('Potřebuji vyplnit formulář.');
    expect(call.src.platform).toBe('chatbot');
    expect(call.src.channelId).toBe(`12:${issued.body.visitorId}`);
    expect(call.src.access?.actAsUserId).toBe(12);
    expect(current.store.turn(turnId)?.core_session_id).toBe('brain-ch-chatbot-session');

    // The public log carries the answer and the lifecycle, and nothing the model thought or ran.
    const events = current.store.events(turnId);
    expect(events.map((event) => event.type)).toEqual(['accepted', 'text_delta', 'done']);
    expect(JSON.parse(events[2]!.data)).toEqual({ text: 'Dobrý den, s čím pomohu?' });
    expect(events.some((event) => event.data.includes('internal thinking'))).toBe(false);
  });

  it('keeps two visitors of one chatbot in two sessions', async () => {
    const first = await issueToken(current);
    const second = await issueToken(current);
    expect(first.body.visitorId).not.toBe(second.body.visitorId);
    for (const issued of [first, second]) {
      await current.handler(request({
        method: 'POST',
        path: 'turns',
        headers: { origin: SITE, authorization: `ChatbotVisitor ${issued.body.token}` },
        body: { schemaVersion: 1, clientTurnId: UUID, message: 'ahoj' },
      }));
    }
    for (let attempt = 0; attempt < 200 && current.calls.length < 2; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    expect(current.calls.map((call) => call.src.channelId)).toEqual([`12:${first.body.visitorId}`, `12:${second.body.visitorId}`]);
  });

  it('gives two chatbots different acting accounts and different sessions', async () => {
    const second = host({
      accounts: [
        { id: 12, username: 'ured-bot', name: 'Úřad', avatar: '', isAdmin: false, type: 'chatbot' },
        { id: 13, username: 'skola-bot', name: 'Škola', avatar: '', isAdmin: false, type: 'chatbot' },
      ],
    });
    second.store.createBot({ chatbotUserId: 13, publicId: `cbt_${'c'.repeat(24)}`, displayName: 'Škola', prompt: '', origins: [SITE], now: new Date().toISOString() });
    second.store.setBotStatus({ chatbotUserId: 13, status: 'enabled', now: new Date().toISOString() });
    await second.adapter.connect();

    const firstToken = await issueToken(current);
    const secondToken = await issueToken(second, SITE, `cbt_${'c'.repeat(24)}`);
    expect(secondToken.status).toBe(200);

    for (const [target, token] of [[current, firstToken.body.token], [second, secondToken.body.token]] as const) {
      await target.handler(request({ method: 'POST', path: 'turns', headers: { origin: SITE, authorization: `ChatbotVisitor ${token}` }, body: { schemaVersion: 1, clientTurnId: UUID, message: 'ahoj' } }));
      for (let attempt = 0; attempt < 200 && target.calls.length < 1; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(current.calls[0]!.src.access?.actAsUserId).toBe(12);
    expect(second.calls[0]!.src.access?.actAsUserId).toBe(13);
    expect(current.calls[0]!.src.channelId).not.toBe(second.calls[0]!.src.channelId);
  });

  it('submits one message once, however many times the widget retries it', async () => {
    const issued = await issueToken(current);
    const post = () => current.handler(request({
      method: 'POST',
      path: 'turns',
      headers: { origin: SITE, authorization: `ChatbotVisitor ${issued.body.token}` },
      body: { schemaVersion: 1, clientTurnId: UUID, message: 'ahoj' },
    }));
    const first = await post();
    const retry = await post();
    expect(retry.body).toEqual(first.body);
    await settled(current, (first.body as Record<string, string>).turnId!);
    expect(current.store.queuedTurns(10)).toHaveLength(0);
    expect(current.calls).toHaveLength(1);
  });

  it('reports a relay that resolved without a reply as an error, never as an empty answer', async () => {
    current.reply = undefined;
    const issued = await issueToken(current);
    const accepted = await current.handler(request({
      method: 'POST',
      path: 'turns',
      headers: { origin: SITE, authorization: `ChatbotVisitor ${issued.body.token}` },
      body: { schemaVersion: 1, clientTurnId: UUID, message: 'ahoj' },
    }));
    const turnId = (accepted.body as Record<string, string>).turnId;
    expect(await settled(current, turnId)).toBe('error');
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
    const live = host({ accounts, projects });
    registerBot(live);
    await live.adapter.connect();
    const issued = await issueToken(live);
    expect(issued.status).toBe(200);

    // A second managed Project appears for the same account: "exactly one" no longer holds.
    projects.push({ id: 5, slug: 'ured-2', path: '/ured2', executionKind: 'managed' });
    const post = () => live.handler(request({ method: 'POST', path: 'turns', headers: { origin: SITE, authorization: `ChatbotVisitor ${issued.body.token}` }, body: { schemaVersion: 1, clientTurnId: UUID, message: 'ahoj' } }));
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
    const human = host({ accounts: [{ id: 12, username: 'operator', name: 'Operátor', avatar: '', isAdmin: false, type: 'human' }] });
    registerBot(human);
    await human.adapter.connect();
    expect((await issueToken(human)).status).toBe(503);
  });
});

describe('the public path rejects what it does not implement', () => {
  it('404s an unknown endpoint and 400s a body with an unknown field', async () => {
    const bot = current.store.listBots()[0]!.public_id;
    expect(await current.handler(request({ method: 'GET', path: 'conversation', headers: { origin: SITE } })))
      .toMatchObject({ status: 404, body: { error: 'not_found' } });
    expect(await current.handler(request({ method: 'POST', path: 'visitors', headers: { origin: SITE }, body: { schemaVersion: 1, bot, page: {} } })))
      .toMatchObject({ status: 400, body: { error: 'invalid_request' } });
  });
});
