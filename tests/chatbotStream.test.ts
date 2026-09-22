// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it, beforeEach } from 'vitest';
import {
  CHATBOT_SITE as SITE,
  CLIENT_TURN_ID,
  createChatbotHost,
  issueToken,
  postRequest,
  publicRequest,
  registerBot,
  settledTurn,
  type ChatbotHookReply,
  type ChatbotHost,
  type RelayCall,
} from './helpers/chatbotHost.js';

/** The reconnectable half of the public path: the visitor's own conversation, one turn's public event log as
 *  NDJSON, and a client that goes away mid-answer. What is checked here is that the answer reaches a page
 *  that is still connected, that losing the connection never loses the turn, and that a returning client
 *  reads exactly what it missed out of the plugin's own tables rather than out of daemon memory. */

interface Frame {
  schemaVersion: number;
  type: string;
  turnId?: string;
  seq?: number;
  data?: Record<string, unknown>;
}

/** One NDJSON frame at a time, so a test can watch a turn that is still running instead of a buffered answer. */
class FrameReader {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly decoder = new TextDecoder();
  private buffer = '';
  private ended = false;

  constructor(body: ReadableStream<Uint8Array>) {
    this.reader = body.getReader();
  }

  async next(timeoutMs = 2_000): Promise<Frame | null> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const newline = this.buffer.indexOf('\n');
      if (newline >= 0) {
        const line = this.buffer.slice(0, newline).trim();
        this.buffer = this.buffer.slice(newline + 1);
        if (line !== '') return JSON.parse(line) as Frame;
        continue;
      }
      if (this.ended) return null;
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('timed out waiting for a frame');
      let timer: ReturnType<typeof setTimeout> | undefined;
      const read = this.reader.read();
      try {
        const chunk = await Promise.race([
          read,
          new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('timed out waiting for a frame')), remaining); }),
        ]);
        if (chunk.done) { this.ended = true; continue; }
        this.buffer += this.decoder.decode(chunk.value, { stream: true });
      } finally {
        clearTimeout(timer);
      }
    }
  }

  /** What a browser that closed the tab does: drop the connection, keep the turn. */
  async disconnect(): Promise<void> {
    this.ended = true;
    await this.reader.cancel();
  }
}

/** A turn that stays open until the test drives it, so "live" really is live. */
function manualTurn(host: ChatbotHost) {
  let sink: RelayCall['observer'];
  let settle: ((reply: string | undefined) => void) | null = null;
  host.handleTurn = ({ observer }) => {
    sink = observer;
    return new Promise<string | undefined>((resolve) => { settle = resolve; });
  };
  return {
    emit: (event: { type: string; delta?: string }): void => sink?.onEvent(event),
    finish: (reply: string): void => settle?.(reply),
    started: (): boolean => settle !== null,
  };
}

async function until(condition: () => boolean | Promise<boolean>, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`condition never held: ${what}`);
}

async function submitTurn(host: ChatbotHost, token: string, message = 'ahoj'): Promise<string> {
  const answer = await host.handler(postRequest({
    path: 'turns',
    headers: { origin: SITE, authorization: `ChatbotVisitor ${token}` },
    body: { schemaVersion: 2, clientTurnId: CLIENT_TURN_ID, message },
  }));
  expect(answer.status).toBe(202);
  return (answer.body as Record<string, string>).turnId!;
}

function openStream(host: ChatbotHost, token: string, turnId: string, after = 0, overrides: Partial<Parameters<typeof publicRequest>[0]> = {}): Promise<ChatbotHookReply> {
  return host.handler(publicRequest({
    method: 'GET',
    path: `turns/${turnId}/events`,
    query: { after: String(after) },
    headers: { origin: SITE, authorization: `ChatbotVisitor ${token}` },
    ...overrides,
  }));
}

function conversation(host: ChatbotHost, token: string, overrides: Partial<Parameters<typeof publicRequest>[0]> = {}): Promise<ChatbotHookReply> {
  return host.handler(publicRequest({
    method: 'GET',
    path: 'conversation',
    headers: { origin: SITE, authorization: `ChatbotVisitor ${token}` },
    ...overrides,
  }));
}

let host: ChatbotHost;
let token: string;

/** A registered, connected host with one live visitor token. The keep-alive interval is the real one unless
 *  a test asks for a smaller one, so no frame ordering here depends on a timer. */
async function freshHost(options: Parameters<typeof createChatbotHost>[0] = {}): Promise<{ host: ChatbotHost; token: string }> {
  const created = createChatbotHost(options);
  registerBot(created);
  await created.adapter.connect();
  const issued = await issueToken(created);
  expect(issued.status).toBe(200);
  return { host: created, token: issued.body.token as string };
}

beforeEach(async () => {
  ({ host, token } = await freshHost());
});

describe('the visitor;s own conversation', () => {
  it('requires the token and the allowed website, like every other stateful endpoint', async () => {
    expect(await conversation(host, '')).toMatchObject({ status: 401, body: { error: 'token_required' } });
    expect(await conversation(host, token, { headers: { origin: 'https://evil.cz', authorization: `ChatbotVisitor ${token}` } }))
      .toMatchObject({ status: 403, body: { error: 'origin_not_allowed' } });
    expect(await conversation(host, token, { origin: null }))
      .toMatchObject({ status: 403, body: { error: 'trusted_origin_required' } });
  });

  it('returns this visitor;s turns with the answer each one finished with, and nobody else;s', async () => {
    const turnId = await submitTurn(host, token, 'Potřebuji formulář.');
    expect(await settledTurn(host, turnId)).toBe('done');

    const other = await issueToken(host);
    const answer = await conversation(host, token);
    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({
      schemaVersion: 2,
      activeTurnId: null,
      truncated: false,
      turns: [{
        turnId,
        clientTurnId: CLIENT_TURN_ID,
        status: 'done',
        message: 'Potřebuji formulář.',
        reply: 'Dobrý den, s čím pomohu?',
        errorCode: null,
      }],
    });
    // A second visitor of the SAME chatbot has a conversation of their own, and it is empty.
    expect(await conversation(host, other.body.token as string)).toMatchObject({ status: 200, body: { turns: [] } });
  });

  it('names the turn that is still running, and how far its log has got', async () => {
    const turn = manualTurn(host);
    const turnId = await submitTurn(host, token);
    await until(() => turn.started(), 'the relay to start');
    turn.emit({ type: 'text', delta: 'Dobr' });
    await until(() => host.store.events(turnId).length === 2, 'the delta to be durable');

    expect(await conversation(host, token)).toMatchObject({
      status: 200,
      body: { activeTurnId: turnId, turns: [{ turnId, status: 'running', lastSeq: 2, reply: null }] },
    });
    turn.finish('Dobrý den.');
  });

  it('keeps the answer inside its byte budget and says when older turns were left out', async () => {
    // Four finished turns whose answers together are larger than the whole response may be. The log is the
    // only source, so they are seeded through the same append the queue uses, a second apart so the order
    // they are read back in is the order a visitor wrote them.
    const sizes = [40_000, 60_000, 60_000, 60_000];
    sizes.forEach((size, index) => {
      const turnId = randomUUID();
      const at = new Date(1_800_000_000_000 + index * 1_000).toISOString();
      host.store.createTurn({ turnId, chatbotUserId: 12, visitorId: visitorIdOf(token), clientTurnId: randomUUID(), message: 'x'.repeat(size), now: at });
      host.store.appendEvent(turnId, 'done', { text: 'y'.repeat(size) }, at);
      host.store.finishTurn({ turnId, status: 'done', coreSessionId: null, errorCode: null, now: at });
    });

    const answer = await conversation(host, token);
    const body = answer.body as { truncated: boolean; turns: { message: string }[] };
    expect(Buffer.byteLength(JSON.stringify(body), 'utf8')).toBeLessThanOrEqual(256 * 1024);
    expect(body.truncated).toBe(true);
    // The newest turn is always the one a reconnect needs most, so the budget drops from the OTHER end.
    expect(body.turns.at(-1)!.message).toHaveLength(60_000);
    expect(body.turns).toHaveLength(2);
    expect(body.turns.some((turn) => turn.message.length === 40_000)).toBe(false);
  });
});

describe('the turn event stream', () => {
  it('keeps both assistant steps across a page action in the terminal frame and restored transcript', async () => {
    const turn = manualTurn(host);
    const turnId = await submitTurn(host, token);
    await until(() => turn.started(), 'the relay to start');
    const before = 'Zjistím otevírací dobu…\n\n';
    const after = '**Otevírací doba**\n\n- Pondělí: 9–17\n- Úterý: 9–17';
    turn.emit({ type: 'text', delta: before });
    turn.emit({ type: 'tool_start', delta: 'private page-action arguments' });
    host.store.appendEvent(turnId, 'action_request', { action: 'read', snapshotId: 'page-1', targetId: 'e1' }, new Date().toISOString());
    turn.emit({ type: 'tool_end', delta: 'private page-action result' });
    turn.emit({ type: 'text', delta: after });
    // Exactly what the host returns: ONLY the final assistant message.
    turn.finish(after);
    expect(await settledTurn(host, turnId)).toBe('done');
    const events = host.store.events(turnId);
    const shown = events.filter((event) => event.type === 'text_delta').map((event) => JSON.parse(event.data).text).join('');
    expect(shown).toBe(before + after);
    expect(JSON.parse(events.find((event) => event.type === 'done')!.data).text).toBe(shown);
    expect(await conversation(host, token)).toMatchObject({ body: { turns: [{ reply: shown }] } });
    expect(JSON.stringify(events)).not.toContain('private page-action');
  });

  it('replays the whole log, and closes once the turn has ended', async () => {
    const turnId = await submitTurn(host, token);
    expect(await settledTurn(host, turnId)).toBe('done');

    const answer = await openStream(host, token, turnId);
    expect(answer.status).toBe(200);
    expect(answer.headers).toMatchObject({
      'content-type': 'application/x-ndjson; charset=utf-8',
      'access-control-allow-origin': SITE,
      'cache-control': 'no-store',
    });

    const reader = new FrameReader(answer.body as ReadableStream<Uint8Array>);
    expect(await reader.next()).toMatchObject({ schemaVersion: 2, turnId, seq: 1, type: 'accepted', data: {} });
    expect(await reader.next()).toMatchObject({ turnId, seq: 2, type: 'text_delta', data: { text: 'Dobrý den, s čím pomohu?' } });
    expect(await reader.next()).toMatchObject({ turnId, seq: 3, type: 'done', data: { text: 'Dobrý den, s čím pomohu?' } });
    // The terminal event ends the stream: a widget is never left holding a connection to a turn that will
    // not say anything again.
    expect(await reader.next()).toBeNull();
  });

  it('sends only what a widget has not rendered yet, so `after` is a cursor and not a filter', async () => {
    const turnId = await submitTurn(host, token);
    expect(await settledTurn(host, turnId)).toBe('done');
    const reader = new FrameReader((await openStream(host, token, turnId, 2)).body as ReadableStream<Uint8Array>);
    expect(await reader.next()).toMatchObject({ seq: 3, type: 'done' });
    expect(await reader.next()).toBeNull();
  });

  it('delivers an answer while the turn is still running, and pings without storing anything', async () => {
    // A deliberately small keep-alive interval, so a waiting stream can be watched without waiting 15
    // seconds for it; every other test keeps the real one so no frame order depends on a timer.
    const fast = await freshHost({ pingIntervalMs: 20 });
    const turn = manualTurn(fast.host);
    const turnId = await submitTurn(fast.host, fast.token);
    await until(() => turn.started(), 'the relay to start');

    const reader = new FrameReader((await openStream(fast.host, fast.token, turnId)).body as ReadableStream<Uint8Array>);
    expect(await reader.next()).toMatchObject({ seq: 1, type: 'accepted' });
    // Nothing else is in the log yet, so this is the keep-alive: never stored, never an event of the turn.
    expect(await reader.next()).toMatchObject({ schemaVersion: 2, type: 'ping' });
    expect(fast.host.store.events(turnId).some((event) => event.type === 'ping')).toBe(false);

    turn.emit({ type: 'text', delta: 'Dobrý' });
    expect(await reader.next()).toMatchObject({ seq: 2, type: 'text_delta', data: { text: 'Dobrý' } });
    turn.emit({ type: 'text', delta: ' den.' });
    expect(await reader.next()).toMatchObject({ seq: 3, type: 'text_delta', data: { text: ' den.' } });
    turn.finish('Dobrý den.');
    for (;;) {
      const frame = await reader.next();
      if (frame === null) break;
      if (frame.type === 'ping') continue;
      expect(frame).toMatchObject({ seq: 4, type: 'done', data: { text: 'Dobrý den.' } });
      break;
    }
    // The answer and the closing event are durable even though the client is only now reading them.
    expect(await settledTurn(fast.host, turnId)).toBe('done');
    expect(fast.host.store.events(turnId).map((event) => event.type)).toEqual(['accepted', 'text_delta', 'text_delta', 'done']);
  });

  it('loses nothing when the page goes away mid-answer, and hands the missing frames to the reconnect', async () => {
    const turn = manualTurn(host);
    const turnId = await submitTurn(host, token);
    await until(() => turn.started(), 'the relay to start');

    const first = new FrameReader((await openStream(host, token, turnId)).body as ReadableStream<Uint8Array>);
    expect(await first.next()).toMatchObject({ seq: 1, type: 'accepted' });
    turn.emit({ type: 'text', delta: 'Dobrý' });
    expect(await first.next()).toMatchObject({ seq: 2, type: 'text_delta' });
    await first.disconnect();

    // The turn carries on exactly as if the browser had never left: one relay call, no cancelled observer,
    // and the answer written to the durable log.
    turn.emit({ type: 'text', delta: ' den.' });
    turn.finish('Dobrý den.');
    expect(await settledTurn(host, turnId)).toBe('done');
    expect(host.calls).toHaveLength(1);
    expect(host.calls[0]!.observer?.signal).toBeUndefined();

    const second = new FrameReader((await openStream(host, token, turnId, 2)).body as ReadableStream<Uint8Array>);
    expect(await second.next()).toMatchObject({ seq: 3, type: 'text_delta', data: { text: ' den.' } });
    expect(await second.next()).toMatchObject({ seq: 4, type: 'done', data: { text: 'Dobrý den.' } });
    expect(await second.next()).toBeNull();
  });

  it('refuses what it cannot serve, and never leaks another visitor;s turn', async () => {
    const turnId = await submitTurn(host, token);
    expect(await settledTurn(host, turnId)).toBe('done');
    const other = await issueToken(host);

    // The same chatbot, a different visitor: a guessed turn id is indistinguishable from one that is not
    // there, so one visitor learns nothing about the other's conversation.
    expect(await openStream(host, other.body.token as string, turnId)).toMatchObject({ status: 404, body: { error: 'not_found' } });
    expect(await openStream(host, token, randomUUID())).toMatchObject({ status: 404, body: { error: 'not_found' } });
    expect(await openStream(host, token, 'not-a-turn-id')).toMatchObject({ status: 404, body: { error: 'not_found' } });
    expect(await openStream(host, token, turnId, 0, { query: { after: 'later' } })).toMatchObject({ status: 400, body: { error: 'invalid_request' } });
    expect(await openStream(host, token, turnId, 0, { headers: { origin: 'https://evil.cz', authorization: `ChatbotVisitor ${token}` } }))
      .toMatchObject({ status: 403, body: { error: 'origin_not_allowed' } });
    expect(await openStream(host, token, turnId, 0, { headers: { origin: SITE } })).toMatchObject({ status: 401, body: { error: 'token_required' } });
  });

  it('refuses a daemon that would buffer the stream into a single JSON object', async () => {
    const turnId = await submitTurn(host, token);
    expect(await settledTurn(host, turnId)).toBe('done');
    // `acceptsStreamBody` absent is a daemon older than the seam: it would serialise the stream instead of
    // piping it, so the honest answer is a refusal rather than a body no widget can parse.
    expect(await openStream(host, token, turnId, 0, { acceptsStreamBody: false }))
      .toMatchObject({ status: 503, body: { error: 'stream_unavailable' } });
  });
});

describe('the durable log is what a subscriber reads', () => {
  it('announces an event only after it can be read back', async () => {
    const turn = manualTurn(host);
    const turnId = await submitTurn(host, token);
    await until(() => turn.started(), 'the relay to start');

    // The subscriber reads the log itself, so a wake-up must never arrive before the row it is about.
    const seen: number[][] = [];
    host.broker.subscribe(turnId, () => { seen.push(host.store.events(turnId).map((event) => event.seq)); });
    turn.emit({ type: 'text', delta: 'a' });
    turn.emit({ type: 'text', delta: 'b' });
    turn.finish('Dobrý den.');
    expect(await settledTurn(host, turnId)).toBe('done');

    // One wake per event, and each one already saw its own event: the accepted event was durable before the
    // subscription, so the three wakes see two, three and four rows.
    expect(seen.map((seqs) => seqs.length)).toEqual([2, 3, 4]);
  });

  it('closes an interrupted turn with the same error event a live stream would have sent', async () => {
    const turn = manualTurn(host);
    const turnId = await submitTurn(host, token);
    await until(() => turn.started(), 'the relay to start');

    // A daemon restart: this process no longer runs the turn, so the log has to say so rather than leaving
    // a widget with an answer that never comes.
    const closed = host.store.closeOrphanedTurns(new Date().toISOString(), 'server_restarted');
    expect(closed).toEqual([turnId]);
    expect(host.store.turn(turnId)).toMatchObject({ status: 'error', error_code: 'server_restarted' });

    const reader = new FrameReader((await openStream(host, token, turnId)).body as ReadableStream<Uint8Array>);
    expect(await reader.next()).toMatchObject({ seq: 1, type: 'accepted' });
    expect(await reader.next()).toMatchObject({ seq: 2, type: 'error', data: { code: 'server_restarted' } });
    expect(await reader.next()).toBeNull();
    // The interrupted turn is NOT replayed: one submitted message never becomes two model turns.
    expect(host.calls).toHaveLength(1);
    expect(host.store.closeOrphanedTurns(new Date().toISOString(), 'server_restarted')).toEqual([]);
  });
});

/** The visitor id a token speaks for, read out of its signed payload. */
function visitorIdOf(visitorToken: string): string {
  const payload = JSON.parse(Buffer.from(visitorToken.split('.')[1]!, 'base64url').toString('utf8')) as { sub: string };
  return payload.sub;
}