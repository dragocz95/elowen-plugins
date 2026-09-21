import { randomUUID } from 'node:crypto';
import type { BotRow } from './db.js';
import type { ChatbotAdapter } from './adapter.js';
import type { TurnEventBroker } from './broker.js';
import type { ChatbotHookRequest, ChatbotPublicResponse, ChatbotStores } from './coreSeams.js';
import { eventPayload, type ChatbotStore } from './store.js';
import type { TurnEventRow } from './db.js';
import type { ChatbotTurnQueue } from './queue.js';
import { checkAllowedOrigin, corsHeaders, isTrustedRequestOrigin, readRequestOrigin } from './origin.js';
import { inspectAccount } from './preflight.js';
import { EVENTS_AFTER_QUERY, PUBLIC_PATHS, PUBLIC_SCHEMA_VERSION, PUBLIC_SEGMENTS } from './publicContract.js';
import { hashToken, mintVisitorToken, newTokenId, newVisitorId, readAuthorizationToken, sameHash, verifyVisitorToken } from './token.js';
import { isCanonicalUuid, validateTokenIssuance, validateTurnSubmission, type Validated } from './validation.js';
import { matchesEtag, widgetAsset, widgetAssetHeaders } from './widgetAsset.js';

/** How much of the visitor's OWN conversation a reconnect may read back. Bounded because a reconnect is a
 *  restoration aid rather than a history export, and because the whole answer has to stay small enough for
 *  the phone the widget runs on. */
const CONVERSATION_TURN_LIMIT = 50;
const CONVERSATION_MAX_BYTES = 256 * 1024;

/** How often an idle turn-events stream sends a ping frame. Never stored and never counted as an event: it
 *  exists so a proxy does not close a connection that is waiting on a model, and it tells the client nothing
 *  about the turn beyond the fact that the stream is alive. */
export const STREAM_PING_INTERVAL_MS = 15_000;

export interface PublicRouteDeps {
  store: ChatbotStore;
  queue: ChatbotTurnQueue;
  adapter: ChatbotAdapter;
  stores: ChatbotStores;
  /** Woken after an event committed. A subscriber reads the durable log itself; it is never handed one. */
  broker: TurnEventBroker;
  /** Ping interval of an idle stream, injected so a test can watch one without waiting 15 seconds. */
  pingIntervalMs: number;
  secret: () => string;
  /** Visitor token lifetime, from the plugin's own configuration. */
  tokenTtlSeconds: () => number;
  now: () => Date;
  warn: (message: string) => void;
}

/** Every answer this route builds — including the streamed one, whose body is not a parsed object. */
type Reply = ChatbotPublicResponse & { status: number };

const reply = (status: number, body: ChatbotPublicResponse['body'], headers: Record<string, string> = {}): Reply => ({ status, headers, body });

export function createPublicRoute(deps: PublicRouteDeps) {
  const { store, queue, adapter, stores, broker, now, warn } = deps;

  const iso = (): string => now().toISOString();

  /** The gate every stateful endpoint passes first: the host must have resolved a NETWORK origin it
   *  considers canonical. It is deliberately not derived from a header the plugin could read itself — the
   *  deployment's proxy trust is one decision, and it is core's. */
  const checkRequestOrigin = (req: ChatbotHookRequest): Reply | null =>
    isTrustedRequestOrigin(readRequestOrigin(req)) ? null : reply(403, { error: 'trusted_origin_required' });

  /** An enabled, started chatbot, or the refusal a caller gets instead. Unknown, draft and disabled
   *  chatbots answer identically: a public id is not a secret, but which sites' chatbots exist is not
   *  something an anonymous caller needs mapped for them. */
  const admitBot = (bot: BotRow | null): Reply | null => {
    if (!bot || bot.status !== 'enabled') return reply(404, { error: 'bot_unavailable' });
    if (!adapter.isReady()) {
      warn('chatbot public request refused: the platform adapter is not ready');
      return reply(503, { error: 'bot_unavailable' });
    }
    return null;
  };

  /** Re-check the account invariants on every admission: an account can lose its Project, gain a second
   *  one or be promoted while its chatbot still reads "enabled", and a turn must never run in a container
   *  this rule did not pick. */
  const blockedReply = (bot: BotRow): Reply | null => {
    const { blockers } = inspectAccount(stores, bot.chatbot_user_id);
    if (blockers.length === 0) return null;
    warn(`chatbot ${bot.public_id} refused a request: ${blockers.join(', ')}`);
    return reply(503, { error: 'bot_unavailable' });
  };

  const issueVisitorToken = (bot: BotRow, visitorId: string | null): { token: string; expiresAt: string; visitorId: string } => {
    const existing = visitorId === null ? null : store.visitor(visitorId);
    const visitor = existing && existing.chatbot_user_id === bot.chatbot_user_id
      ? { visitor_id: existing.visitor_id }
      : store.createVisitor(newVisitorId(), bot.chatbot_user_id, iso());
    const issuedAtSeconds = Math.floor(now().getTime() / 1000);
    const expiresAtSeconds = issuedAtSeconds + deps.tokenTtlSeconds();
    const payload = {
      v: 1 as const,
      bot: bot.public_id,
      sub: visitor.visitor_id,
      jti: newTokenId(),
      iat: issuedAtSeconds,
      exp: expiresAtSeconds,
    };
    const token = mintVisitorToken(deps.secret(), payload);
    store.issueToken({
      jti: payload.jti,
      chatbotUserId: bot.chatbot_user_id,
      visitorId: visitor.visitor_id,
      tokenHash: hashToken(token),
      issuedAt: new Date(issuedAtSeconds * 1000).toISOString(),
      expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
      rotate: true,
    });
    return { token, expiresAt: new Date(expiresAtSeconds * 1000).toISOString(), visitorId: visitor.visitor_id };
  };

  /** Verify a presented token down to the live database row. The row is what makes a revoked or rotated
   *  token stop working immediately, which a signature alone can never do. */
  const presentedToken = (req: ChatbotHookRequest): { bot: BotRow; visitorId: string } | Reply => {
    const presented = readAuthorizationToken(req.headers);
    if (!presented) return reply(401, { error: 'token_required' });
    const verified = verifyVisitorToken({ secret: deps.secret(), token: presented, nowMs: now().getTime() });
    if (!verified.ok) return reply(401, { error: 'invalid_token' });
    const row = store.token(verified.payload.jti);
    if (!row || row.revoked_at !== null) return reply(401, { error: 'invalid_token' });
    if (!sameHash(hashToken(presented), row.token_hash)) return reply(401, { error: 'invalid_token' });
    const bot = store.botByPublicId(verified.payload.bot);
    const refusal = admitBot(bot);
    if (refusal) return refusal;
    const visitor = store.visitor(verified.payload.sub);
    if (!visitor || visitor.revoked_at !== null) return reply(401, { error: 'invalid_token' });
    // The token row, the signed payload and the visitor row must all agree on both identities. A visitor
    // id is bound to ONE chatbot: a token naming a visitor that belongs elsewhere is refused rather than
    // creating a second conversation for a bot it was not issued for.
    if (row.visitor_id !== visitor.visitor_id
      || row.chatbot_user_id !== bot!.chatbot_user_id
      || visitor.chatbot_user_id !== bot!.chatbot_user_id) {
      return reply(401, { error: 'invalid_token' });
    }
    return { bot: bot!, visitorId: visitor.visitor_id };
  };

  /** `POST v1/visitors`: hand out a token for a website origin the chatbot allows. */
  const handleTokenIssuance = async (req: ChatbotHookRequest, origin: string): Promise<Reply> => {
    const notJson = requireJsonBody(req, origin);
    if (notJson) return notJson;
    const body = await readJson(req);
    if (!body.ok) return reply(400, { error: 'invalid_request', detail: body.error }, corsHeaders(origin));
    const parsed = validateTokenIssuance(body.value);
    if (!parsed.ok) return reply(400, { error: 'invalid_request', detail: parsed.error }, corsHeaders(origin));

    const bot = store.botByPublicId(parsed.value.bot);
    const refusal = admitBot(bot);
    if (refusal) return refusal;
    const allowed = checkAllowedOrigin(origin, store.originsOf(bot!.chatbot_user_id));
    if (!allowed.ok) return reply(403, { error: 'origin_not_allowed' });
    const blocked = blockedReply(bot!);
    if (blocked) return blocked;

    const issued = issueVisitorToken(bot!, null);
    return reply(200, {
      schemaVersion: PUBLIC_SCHEMA_VERSION,
      token: issued.token,
      visitorId: issued.visitorId,
      expiresAt: issued.expiresAt,
      bot: { publicId: bot!.public_id, displayName: bot!.display_name },
    }, corsHeaders(origin));
  };

  /** `POST v1/visitors/refresh`: rotate a live token for the SAME visitor, so a widget can keep one
   *  conversation going past a token's lifetime without ever choosing its own identity. */
  const handleRefresh = async (req: ChatbotHookRequest, origin: string): Promise<Reply> => {
    const admitted = presentedToken(req);
    if ('status' in admitted) return admitted;
    const allowed = checkAllowedOrigin(origin, store.originsOf(admitted.bot.chatbot_user_id));
    if (!allowed.ok) return reply(403, { error: 'origin_not_allowed' });
    const blocked = blockedReply(admitted.bot);
    if (blocked) return blocked;

    const issued = issueVisitorToken(admitted.bot, admitted.visitorId);
    return reply(200, {
      schemaVersion: PUBLIC_SCHEMA_VERSION,
      token: issued.token,
      visitorId: issued.visitorId,
      expiresAt: issued.expiresAt,
    }, corsHeaders(origin));
  };

  /** `POST v1/turns`: admit one visitor message. The answer is a receipt, never a reply — the turn runs on
   *  the owner side of the relay, so a client that disconnects has stopped watching, not stopped work. */
  const handleTurn = async (req: ChatbotHookRequest, origin: string): Promise<Reply> => {
    const admitted = presentedToken(req);
    if ('status' in admitted) return admitted;
    const allowed = checkAllowedOrigin(origin, store.originsOf(admitted.bot.chatbot_user_id));
    if (!allowed.ok) return reply(403, { error: 'origin_not_allowed' });
    const blocked = blockedReply(admitted.bot);
    if (blocked) return blocked;

    const notJson = requireJsonBody(req, origin);
    if (notJson) return notJson;
    const body = await readJson(req);
    if (!body.ok) return reply(400, { error: 'invalid_request', detail: body.error }, corsHeaders(origin));
    const parsed = validateTurnSubmission(body.value);
    if (!parsed.ok) return reply(400, { error: 'invalid_request', detail: parsed.error }, corsHeaders(origin));
    // Idempotent submission: a widget that lost the 202 retries with the same client turn id and receives
    // the SAME turn, never a second model turn for one message it showed once.
    const existing = store.turnByClientId(admitted.bot.chatbot_user_id, admitted.visitorId, parsed.value.clientTurnId);
    const turn = existing ?? store.createTurn({
      turnId: randomUUID(),
      chatbotUserId: admitted.bot.chatbot_user_id,
      visitorId: admitted.visitorId,
      clientTurnId: parsed.value.clientTurnId,
      message: parsed.value.message,
      now: iso(),
    });
    store.touchVisitor(admitted.visitorId, iso());
    if (!existing) queue.submit(turn.turn_id);

    // A receipt describes ADMISSION, not the turn's current state: the widget attaches to the turn's own
    // event stream next, and that is where a retry after a lost 202 learns what has already happened.
    return reply(202, { schemaVersion: PUBLIC_SCHEMA_VERSION, turnId: turn.turn_id, status: 'queued', lastSeq: 0 }, corsHeaders(origin));
  };

  /** `GET v1/conversation`: what this visitor's widget needs after a reload or a lost connection — its own
   *  recent turns, each one's public status and the answer it finished with. It is deliberately NOT a
   *  transcript read: the plugin serves the projection it published, never core's conversation. */
  const handleConversation = (req: ChatbotHookRequest, origin: string): Reply => {
    const admitted = presentedToken(req);
    if ('status' in admitted) return admitted;
    const allowed = checkAllowedOrigin(origin, store.originsOf(admitted.bot.chatbot_user_id));
    if (!allowed.ok) return reply(403, { error: 'origin_not_allowed' });

    const recent = store.recentTurns({
      chatbotUserId: admitted.bot.chatbot_user_id,
      visitorId: admitted.visitorId,
      limit: CONVERSATION_TURN_LIMIT,
    });
    const ids = recent.map((turn) => turn.turn_id);
    const seqs = store.lastSeqsOf(ids);
    const replies = store.doneRepliesOf(ids);

    // Newest first while the answer still fits. A reconnect has to be able to rebuild what the visitor saw
    // most recently, so the newest turn is always included and older ones drop off once the budget is spent.
    const turns: Record<string, unknown>[] = [];
    let bytes = Buffer.byteLength(JSON.stringify({
      schemaVersion: PUBLIC_SCHEMA_VERSION, activeTurnId: null, truncated: false, turns: [],
    }), 'utf8');
    // A full window means there may be older turns this answer cannot carry; the flag says so rather than
    // letting a client believe it restored the whole conversation.
    let truncated = recent.length === CONVERSATION_TURN_LIMIT;
    for (const turn of recent) {
      const view = {
        turnId: turn.turn_id,
        clientTurnId: turn.client_turn_id,
        status: turn.status,
        lastSeq: seqs.get(turn.turn_id) ?? 0,
        message: turn.message,
        reply: replies.get(turn.turn_id) ?? null,
        errorCode: turn.error_code,
      };
      // One byte for the comma that joins the entries, which is what makes this an upper bound.
      const size = Buffer.byteLength(JSON.stringify(view), 'utf8') + 1;
      if (bytes + size > CONVERSATION_MAX_BYTES) {
        truncated = true;
        break;
      }
      bytes += size;
      turns.push(view);
    }
    turns.reverse();

    return reply(200, {
      schemaVersion: PUBLIC_SCHEMA_VERSION,
      activeTurnId: recent.find((turn) => turn.status === 'queued' || turn.status === 'running')?.turn_id ?? null,
      truncated,
      turns,
    }, corsHeaders(origin));
  };

  /** `GET v1/turns/:turnId/events`: one turn's public log as NDJSON over `fetch`. The built-in SSE helper is
   *  documented for AUTHENTICATED plugin API only and this endpoint is public, so the stream is one this
   *  plugin owns; `after` replays exactly what a reconnecting widget has not rendered yet. */
  const handleTurnEvents = (req: ChatbotHookRequest, origin: string, turnId: string): Reply => {
    const admitted = presentedToken(req);
    if ('status' in admitted) return admitted;
    const allowed = checkAllowedOrigin(origin, store.originsOf(admitted.bot.chatbot_user_id));
    if (!allowed.ok) return reply(403, { error: 'origin_not_allowed' });
    // An older daemon buffers whatever body it is handed, which would turn this stream into a single JSON
    // object no widget can read. Refuse instead of answering something that only looks like a stream.
    if (req.acceptsStreamBody !== true) return reply(503, { error: 'stream_unavailable' });
    const after = readAfter(req.query[EVENTS_AFTER_QUERY]);
    if (!after.ok) return reply(400, { error: 'invalid_request', detail: after.error }, corsHeaders(origin));

    const turn = isCanonicalUuid(turnId) ? store.turn(turnId) : null;
    // Another visitor's turn is not distinguishable from one that does not exist: a guess learns nothing
    // about the other visitors of this chatbot.
    if (!turn || turn.chatbot_user_id !== admitted.bot.chatbot_user_id || turn.visitor_id !== admitted.visitorId) {
      return reply(404, { error: 'not_found' });
    }

    return reply(200, turnEventStream({
      store,
      broker,
      turnId: turn.turn_id,
      after: after.value,
      pingIntervalMs: deps.pingIntervalMs,
    }), {
      ...corsHeaders(origin),
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
    });
  };

  return async function handlePublicRequest(req: ChatbotHookRequest): Promise<Reply> {
    const segments = req.path.replace(/^\/+|\/+$/g, '').split('/').filter((segment) => segment !== '');
    const path = segments.join('/');
    const origin = req.headers.origin ?? req.headers.Origin;

    // The widget script, answered BEFORE anything else: a customer's own page fetches it with a classic
    // `<script src>`, which carries no `Origin` header and is not a request by a visitor of any chatbot.
    // The asset is public by design and grants nothing — every request that asks for state still passes
    // the origin and token gates below.
    if (req.method === 'GET' && path === PUBLIC_PATHS.widget) return widgetAssetReply(req);

    // Nothing below is authorisation by CORS. The daemon's global permissive CORS middleware answers a
    // preflight (204 with `*`) before the hook dispatcher is reached, and a preflight reads nothing and
    // grants nothing either way: what admits a request is the plugin's own decision — an `Origin` header
    // matching one of the chatbot's allowed domains, a host-resolved trusted network origin, and a live
    // visitor token. A caller outside the allowlist is refused here regardless of any CORS header.
    const gate = checkRequestOrigin(req);
    if (gate) return gate;
    // The browser's own statement of which site asked. A request without one is not a request this
    // endpoint serves, and it is checked before anything is parsed.
    if (typeof origin !== 'string' || origin === '') return reply(403, { error: 'origin_not_allowed' });

    if (req.method === 'POST' && path === PUBLIC_PATHS.visitors) return handleTokenIssuance(req, origin);
    if (req.method === 'POST' && path === PUBLIC_PATHS.refresh) return handleRefresh(req, origin);
    if (req.method === 'POST' && path === PUBLIC_PATHS.turns) return handleTurn(req, origin);
    if (req.method === 'GET' && path === PUBLIC_PATHS.conversation) return handleConversation(req, origin);
    if (req.method === 'GET' && segments.length === 3
      && segments[0] === PUBLIC_SEGMENTS.turns && segments[2] === PUBLIC_SEGMENTS.events) {
      return handleTurnEvents(req, origin, segments[1]!);
    }
    return reply(404, { error: 'not_found' });
  };
}

/** One request for the widget script. `If-None-Match` is answered with a bodiless `304` so a page load that
 *  already holds the bundle costs one round trip and no bytes, which is what makes the short cache window
 *  above affordable: a fix reaches visitors on the next load, and an unchanged bundle costs almost nothing
 *  in between. */
function widgetAssetReply(req: ChatbotHookRequest): Reply {
  const asset = widgetAsset();
  const headers = widgetAssetHeaders(asset.etag);
  const ifNoneMatch = req.headers['if-none-match'] ?? req.headers['If-None-Match'];
  if (matchesEtag(ifNoneMatch, asset.etag)) return { status: 304, headers, body: undefined };
  return { status: 200, headers, body: asset.body };
}

/** A body this endpoint will INTERPRET must say it is JSON. A form-encoded or text/plain body is not a
 *  request this API takes, and answering it as though it were would be guessing at what the caller meant. */
function requireJsonBody(req: ChatbotHookRequest, origin: string): Reply | null {
  const declared = req.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
  return declared === 'application/json' ? null : reply(415, { error: 'unsupported_media_type' }, corsHeaders(origin));
}

/** `after` is the sequence number a widget has already rendered. Absent means "from the beginning", and
 *  anything that is not a plain non-negative integer is refused rather than coerced. */
function readAfter(raw: string | undefined): Validated<number> {
  if (raw === undefined || raw === '') return { ok: true, value: 0 };
  if (!/^\d{1,15}$/.test(raw)) return { ok: false, error: '"after" must be a non-negative integer' };
  return { ok: true, value: Number(raw) };
}

/** One turn's public event log, pushed as it grows.
 *
 *  Push rather than pull: rows are read from the durable log and written as they appear, and a broker
 *  wake-up only says that MORE rows exist. The stream ends when the turn writes its terminal event, or when
 *  the turn is already terminal and its log has been replayed in full — a widget must never be left holding
 *  a connection to a turn that will never say anything again. */
function turnEventStream(input: {
  store: ChatbotStore;
  broker: TurnEventBroker;
  turnId: string;
  after: number;
  pingIntervalMs: number;
}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let cursor = input.after;
  let released = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let detach: (() => void) | null = null;

  const release = (): void => {
    if (released) return;
    released = true;
    if (timer !== null) clearInterval(timer);
    timer = null;
    detach?.();
    detach = null;
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (chunk: string): boolean => {
        if (released) return false;
        try {
          controller.enqueue(encoder.encode(chunk));
          return true;
        } catch {
          // The consumer closed or errored underneath us; there is nobody left to write to.
          release();
          return false;
        }
      };
      const frame = (event: TurnEventRow): string => `${JSON.stringify({
        schemaVersion: PUBLIC_SCHEMA_VERSION,
        turnId: input.turnId,
        seq: event.seq,
        type: event.type,
        data: eventPayload(event),
      })}\n`;
      const drain = (): void => {
        if (released) return;
        for (const event of input.store.events(input.turnId, cursor)) {
          cursor = event.seq;
          if (!write(frame(event))) return;
          if (event.type === 'done' || event.type === 'error') {
            release();
            controller.close();
            return;
          }
        }
        const turn = input.store.turn(input.turnId);
        if (!turn || turn.status === 'done' || turn.status === 'error') {
          release();
          controller.close();
        }
      };

      detach = input.broker.subscribe(input.turnId, drain);
      timer = setInterval(() => {
        write(`${JSON.stringify({ schemaVersion: PUBLIC_SCHEMA_VERSION, type: 'ping' })}\n`);
      }, input.pingIntervalMs);
      drain();
    },
    cancel() {
      // A client that went away has stopped WATCHING. The turn is untouched: the queue owns the relay
      // promise, and the log it keeps writing is exactly what the next connection reads.
      release();
    },
  });
}

async function readJson(req: ChatbotHookRequest): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await req.json() };
  } catch {
    return { ok: false, error: 'body must be valid JSON' };
  }
}
