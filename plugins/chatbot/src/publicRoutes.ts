import { randomUUID } from 'node:crypto';
import type { BotRow } from './db.js';
import type { ChatbotAdapter } from './adapter.js';
import type { ChatbotHookRequest, ChatbotStores } from './coreSeams.js';
import type { ChatbotStore } from './store.js';
import type { ChatbotTurnQueue } from './queue.js';
import { checkAllowedOrigin, corsHeaders, isTrustedRequestOrigin, readRequestOrigin } from './origin.js';
import { inspectAccount } from './preflight.js';
import { hashToken, mintVisitorToken, newTokenId, newVisitorId, readAuthorizationToken, sameHash, verifyVisitorToken } from './token.js';
import { validateTokenIssuance, validateTurnSubmission } from './validation.js';

/** The one mount this plugin declares: every public endpoint is a remainder under it, so a later version
 *  can be served beside this one instead of changing what a deployed widget talks to.
 *
 *  Nothing here is authorisation by CORS. The daemon's global permissive CORS middleware answers a
 *  preflight (204 with `*`) before the hook dispatcher is reached, and a preflight reads nothing and grants
 *  nothing either way: what admits a request is the plugin's own decision below — an `Origin` header that
 *  matches one of the chatbot's allowed domains, a host-resolved trusted network origin, and a live visitor
 *  token. A caller outside the allowlist is refused here regardless of what any CORS header says. */
export const PUBLIC_MOUNT = 'v1';

export interface PublicRouteDeps {
  store: ChatbotStore;
  queue: ChatbotTurnQueue;
  adapter: ChatbotAdapter;
  stores: ChatbotStores;
  secret: () => string;
  /** Visitor token lifetime, from the plugin's own configuration. */
  tokenTtlSeconds: () => number;
  now: () => Date;
  warn: (message: string) => void;
}

interface Reply {
  status: number;
  headers: Record<string, string>;
  body: object;
}

const reply = (status: number, body: object, headers: Record<string, string> = {}): Reply => ({ status, headers, body });

export function createPublicRoute(deps: PublicRouteDeps) {
  const { store, queue, adapter, stores, now, warn } = deps;

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
      schemaVersion: 1,
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
      schemaVersion: 1,
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

    return reply(202, { schemaVersion: 1, turnId: turn.turn_id, status: 'queued', lastSeq: 0 }, corsHeaders(origin));
  };

  return async function handlePublicRequest(req: ChatbotHookRequest): Promise<Reply> {
    const path = req.path.replace(/^\/+|\/+$/g, '');
    const origin = req.headers.origin ?? req.headers.Origin;

    const gate = checkRequestOrigin(req);
    if (gate) return gate;
    // The browser's own statement of which site asked. A request without one is not a request this
    // endpoint serves, and it is checked before anything is parsed.
    if (typeof origin !== 'string' || origin === '') return reply(403, { error: 'origin_not_allowed' });

    if (req.method === 'POST' && path === 'visitors') return handleTokenIssuance(req, origin);
    if (req.method === 'POST' && path === 'visitors/refresh') return handleRefresh(req, origin);
    if (req.method === 'POST' && path === 'turns') return handleTurn(req, origin);
    return reply(404, { error: 'not_found' });
  };
}

async function readJson(req: ChatbotHookRequest): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await req.json() };
  } catch {
    return { ok: false, error: 'body must be valid JSON' };
  }
}
