import { randomUUID, randomBytes } from 'node:crypto';
import { actionRequestPayload, eventPayload } from './store.js';
import { checkAllowedOrigin, corsHeaders, isTrustedRequestOrigin, readRequestOrigin } from './origin.js';
import { inspectAccount } from './preflight.js';
import { parseStoredAppearance, resolveAppearance } from './appearanceContract.js';
import { AVATAR_CACHE_CONTROL } from './avatarProxy.js';
import { VISITOR_CREDENTIAL_ERRORS, HANDOFF_FRAGMENT_KEY, HANDOFF_CODE_PATTERN, HANDOFF_TTL_MS, EVENTS_AFTER_QUERY, PUBLIC_PATHS, PUBLIC_SCHEMA_VERSION, PUBLIC_SEGMENTS } from './publicContract.js';
import { hashToken, mintVisitorToken, newTokenId, newVisitorId, readAuthorizationToken, sameHash, verifyVisitorToken } from './token.js';
import { isCanonicalUuid, validateActionDecision, validateActionResult, validatePublicBotRequest, validateTurnSubmission } from './validation.js';
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
const reply = (status, body, headers = {}) => ({ status, headers, body });
export function createPublicRoute(deps) {
    const { store, queue, adapter, stores, broker, actions, now, warn } = deps;
    const iso = () => now().toISOString();
    /** The gate every stateful endpoint passes first: the host must have resolved a NETWORK origin it
     *  considers canonical. It is deliberately not derived from a header the plugin could read itself — the
     *  deployment's proxy trust is one decision, and it is core's. The resolved origin is returned because it is
     *  also the key the per-address rate window counts, and a second read of it would be a second answer to
     *  "where did this request come from". */
    const trustedOrigin = (req) => {
        const origin = readRequestOrigin(req);
        return isTrustedRequestOrigin(origin) ? origin : null;
    };
    /** An enabled, started chatbot, or the refusal a caller gets instead. Unknown, draft and disabled
     *  chatbots answer identically: a public id is not a secret, but which sites' chatbots exist is not
     *  something an anonymous caller needs mapped for them. */
    const admitBot = (bot) => {
        if (!bot || bot.status !== 'enabled')
            return reply(404, { error: 'bot_unavailable' });
        if (!adapter.isReady()) {
            warn('chatbot public request refused: the platform adapter is not ready');
            return reply(503, { error: 'bot_unavailable' });
        }
        return null;
    };
    /** Re-check the account invariants on every admission: an account can lose its Project, gain a second
     *  one or be promoted while its chatbot still reads "enabled", and a turn must never run in a container
     *  this rule did not pick. */
    const blockedReply = (bot) => {
        const { blockers } = inspectAccount(stores, bot.chatbot_user_id);
        if (blockers.length === 0)
            return null;
        warn(`chatbot ${bot.public_id} refused a request: ${blockers.join(', ')}`);
        return reply(503, { error: 'bot_unavailable' });
    };
    /** The bot's own look, or the reason its row cannot be read. The bootstrap and avatar reader share this
     *  resolution so neither can grow its own idea of a stored row. */
    const readAppearance = (bot) => {
        try {
            return { ok: true, appearance: resolveAppearance(parseStoredAppearance(bot.appearance)) };
        }
        catch (error) {
            return { ok: false, error };
        }
    };
    const issueVisitorToken = (bot, visitorId) => {
        const existing = visitorId === null ? null : store.visitor(visitorId);
        const visitor = existing && existing.chatbot_user_id === bot.chatbot_user_id
            ? { visitor_id: existing.visitor_id }
            : store.createVisitor(newVisitorId(), bot.chatbot_user_id, iso());
        const issuedAtSeconds = Math.floor(now().getTime() / 1000);
        const expiresAtSeconds = issuedAtSeconds + deps.tokenTtlSeconds();
        const payload = {
            v: 1,
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
    const presentedToken = (req) => {
        const presented = readAuthorizationToken(req.headers);
        if (!presented)
            return reply(401, { error: VISITOR_CREDENTIAL_ERRORS.required });
        const verified = verifyVisitorToken({ secret: deps.secret(), token: presented, nowMs: now().getTime() });
        if (!verified.ok)
            return reply(401, { error: VISITOR_CREDENTIAL_ERRORS.invalid });
        const row = store.token(verified.payload.jti);
        if (!row || row.revoked_at !== null)
            return reply(401, { error: VISITOR_CREDENTIAL_ERRORS.invalid });
        if (!sameHash(hashToken(presented), row.token_hash))
            return reply(401, { error: VISITOR_CREDENTIAL_ERRORS.invalid });
        const bot = store.botByPublicId(verified.payload.bot);
        const refusal = admitBot(bot);
        if (refusal)
            return refusal;
        const visitor = store.visitor(verified.payload.sub);
        if (!visitor || visitor.revoked_at !== null)
            return reply(401, { error: VISITOR_CREDENTIAL_ERRORS.invalid });
        // The token row, the signed payload and the visitor row must all agree on both identities. A visitor
        // id is bound to ONE chatbot: a token naming a visitor that belongs elsewhere is refused rather than
        // creating a second conversation for a bot it was not issued for.
        if (row.visitor_id !== visitor.visitor_id
            || row.chatbot_user_id !== bot.chatbot_user_id
            || visitor.chatbot_user_id !== bot.chatbot_user_id) {
            return reply(401, { error: VISITOR_CREDENTIAL_ERRORS.invalid });
        }
        return { bot: bot, visitorId: visitor.visitor_id };
    };
    /** Public requests naming a chatbot share the exact admission gate used by token issuance. */
    const publicBotRequest = async (req, origin) => {
        const notJson = requireJsonBody(req, origin);
        if (notJson)
            return { reply: notJson };
        const body = await readJson(req);
        if (!body.ok)
            return { reply: reply(400, { error: 'invalid_request', detail: body.error }, corsHeaders(origin)) };
        const parsed = validatePublicBotRequest(body.value);
        if (!parsed.ok)
            return { reply: reply(400, { error: 'invalid_request', detail: parsed.error }, corsHeaders(origin)) };
        const bot = store.botByPublicId(parsed.value.bot);
        const refusal = admitBot(bot);
        if (refusal)
            return { reply: refusal };
        const allowed = checkAllowedOrigin(origin, store.originsOf(bot.chatbot_user_id));
        if (!allowed.ok)
            return { reply: reply(403, { error: 'origin_not_allowed' }) };
        const blocked = blockedReply(bot);
        if (blocked)
            return { reply: blocked };
        return { bot: bot };
    };
    /** `POST v2/bootstrap`: read this chatbot's name and appearance without creating visitor state. */
    const handleBootstrap = async (req, origin) => {
        const admitted = await publicBotRequest(req, origin);
        if ('reply' in admitted)
            return admitted.reply;
        const stored = readAppearance(admitted.bot);
        if (!stored.ok) {
            warn(`chatbot ${admitted.bot.public_id} has an unreadable appearance: ${stored.error instanceof Error ? stored.error.message : String(stored.error)}`);
            return reply(503, { error: 'appearance_invalid' }, corsHeaders(origin));
        }
        return reply(200, {
            schemaVersion: PUBLIC_SCHEMA_VERSION,
            name: admitted.bot.display_name,
            appearance: stored.appearance,
            allowedOrigins: store.originsOf(admitted.bot.chatbot_user_id),
        }, { ...corsHeaders(origin), 'cache-control': 'no-store' });
    };
    /** `POST v1/visitors`: hand out a token for a website origin the chatbot allows. */
    const handleTokenIssuance = async (req, origin) => {
        const admitted = await publicBotRequest(req, origin);
        if ('reply' in admitted)
            return admitted.reply;
        const issued = issueVisitorToken(admitted.bot, null);
        return reply(200, {
            schemaVersion: PUBLIC_SCHEMA_VERSION,
            token: issued.token,
            visitorId: issued.visitorId,
            expiresAt: issued.expiresAt,
            bot: { publicId: admitted.bot.public_id, displayName: admitted.bot.display_name },
        }, { ...corsHeaders(origin), 'cache-control': 'no-store' });
    };
    /** `POST v1/visitors/refresh`: rotate a live token for the SAME visitor, so a widget can keep one
     *  conversation going past a token's lifetime without ever choosing its own identity. */
    const handleRefresh = async (req, origin) => {
        const admitted = presentedToken(req);
        if ('status' in admitted)
            return admitted;
        const allowed = checkAllowedOrigin(origin, store.originsOf(admitted.bot.chatbot_user_id));
        if (!allowed.ok)
            return reply(403, { error: 'origin_not_allowed' });
        const blocked = blockedReply(admitted.bot);
        if (blocked)
            return blocked;
        const issued = issueVisitorToken(admitted.bot, admitted.visitorId);
        return reply(200, {
            schemaVersion: PUBLIC_SCHEMA_VERSION,
            token: issued.token,
            visitorId: issued.visitorId,
            expiresAt: issued.expiresAt,
        }, corsHeaders(origin));
    };
    /** `POST v1/turns`: admit one visitor message. The answer is a receipt, never a reply — the turn runs on
     *  the owner side of the relay, so a client that disconnects has stopped watching, not stopped work.
     *
     *  Everything that decides whether this message may be served happens in `store.admitTurn`, in the order the
     *  implementation plan fixes: the chatbot's own numbers, then the rate windows, then the daily budget, then
     *  the visitor's conversation and the chatbot's queue, and only then the turn row. Nothing here re-decides
     *  any of it, and nothing below can spend anything. */
    const handleTurn = async (req, origin, requestOrigin) => {
        const admitted = presentedToken(req);
        if ('status' in admitted)
            return admitted;
        const allowed = checkAllowedOrigin(origin, store.originsOf(admitted.bot.chatbot_user_id));
        if (!allowed.ok)
            return reply(403, { error: 'origin_not_allowed' });
        const blocked = blockedReply(admitted.bot);
        if (blocked)
            return blocked;
        const notJson = requireJsonBody(req, origin);
        if (notJson)
            return notJson;
        const body = await readJson(req);
        if (!body.ok)
            return reply(400, { error: 'invalid_request', detail: body.error }, corsHeaders(origin));
        const parsed = validateTurnSubmission(body.value);
        if (!parsed.ok)
            return reply(400, { error: 'invalid_request', detail: parsed.error }, corsHeaders(origin));
        // Idempotent submission: a widget that lost the 202 retries with the same client turn id and receives
        // the SAME turn, never a second model turn for one message it showed once. Checked before anything is
        // counted, so a retry costs neither a rate window nor a turn of the budget.
        const existing = store.turnByClientId(admitted.bot.chatbot_user_id, admitted.visitorId, parsed.value.clientTurnId);
        if (existing)
            return turnReceipt(existing, origin);
        let outcome;
        try {
            outcome = store.admitTurn({
                turnId: randomUUID(),
                bot: admitted.bot,
                visitorId: admitted.visitorId,
                clientTurnId: parsed.value.clientTurnId,
                message: parsed.value.message,
                page: parsed.value.page,
                originValue: requestOrigin.value,
                now: iso(),
                nowMs: now().getTime(),
            });
        }
        catch (error) {
            // Admission reads core's own spend rollup, so it can fail for reasons that are not this request's fault.
            // The visitor gets the same stable code every other unavailable chatbot answers with, and the operator
            // gets the detail: nothing was queued and nothing was spent.
            warn(`chatbot ${admitted.bot.public_id} could not admit a turn: ${error instanceof Error ? error.message : String(error)}`);
            return reply(503, { error: 'bot_unavailable' }, corsHeaders(origin));
        }
        if (!outcome.ok) {
            if (outcome.reason === 'duplicate')
                return turnReceipt(outcome.turn, origin);
            return admissionReply(outcome, origin);
        }
        store.touchVisitor(admitted.visitorId, iso());
        queue.submit(outcome.turn.turn_id);
        // A receipt describes ADMISSION, not the turn's current state: the widget attaches to the turn's own
        // event stream next, and that is where a retry after a lost 202 learns what has already happened.
        return turnReceipt(outcome.turn, origin);
    };
    /** `GET v2/avatar`: this chatbot's avatar as BYTES, over the connection the widget's page already allows.
     *
     *  The panel cannot load the owner's image address itself: a customer's Content-Security-Policy decides
     *  which image hosts their page may reach, and a widget that demanded a new entry for an arbitrary address
     *  would be asking the customer to widen a security policy on our behalf. What their page already permits
     *  is the widget's own origin on `connect-src`, so the bytes come from here and the panel renders them from
     *  memory.
     *
     *  The admission is the appearance route's, exactly: the visitor's own token, the origin allowlist and the
     *  account preflight. What a refusal answers is deliberately NOT an error the widget has to interpret — an
     *  avatar is chrome, and a panel without one is a panel that works. */
    const handleAvatar = async (req, origin) => {
        const admitted = presentedToken(req);
        if ('status' in admitted)
            return admitted;
        const allowed = checkAllowedOrigin(origin, store.originsOf(admitted.bot.chatbot_user_id));
        if (!allowed.ok)
            return reply(403, { error: 'origin_not_allowed' });
        const blocked = blockedReply(admitted.bot);
        if (blocked)
            return blocked;
        const stored = readAppearance(admitted.bot);
        const source = stored.ok ? stored.appearance.avatarUrl : '';
        // Nothing configured, or an image that already carries its own bytes: the widget draws it directly, so
        // this route has nothing to add and says so rather than inventing an answer. A row that cannot be read is
        // the same answer — the panel keeps its own built-in look, and the appearance route is where the operator
        // is told why (this one would only repeat it on the same page load).
        if (source === '' || source.startsWith('data:'))
            return reply(404, { error: 'no_avatar' }, corsHeaders(origin));
        const fetched = await deps.avatar(source);
        if (!fetched.ok) {
            warn(`chatbot ${admitted.bot.public_id} could not serve its avatar (${fetched.reason})`);
            return reply(404, { error: 'no_avatar' }, corsHeaders(origin));
        }
        // The upstream's own media type travels on, so the browser and the panel both see what the owner's host
        // actually served. The cache window is the one thing this route decides about the answer, and it is the
        // avatar module's.
        return reply(200, fetched.bytes, {
            ...corsHeaders(origin),
            'content-type': fetched.contentType,
            'cache-control': AVATAR_CACHE_CONTROL,
        });
    };
    /** `GET v1/conversation`: what this visitor's widget needs after a reload or a lost connection — its own
     *  recent turns, each one's public status and the answer it finished with. It is deliberately NOT a
     *  transcript read: the plugin serves the projection it published, never core's conversation. */
    const handleConversation = (req, origin) => {
        const admitted = presentedToken(req);
        if ('status' in admitted)
            return admitted;
        const allowed = checkAllowedOrigin(origin, store.originsOf(admitted.bot.chatbot_user_id));
        if (!allowed.ok)
            return reply(403, { error: 'origin_not_allowed' });
        const recent = store.recentTurns({
            chatbotUserId: admitted.bot.chatbot_user_id,
            visitorId: admitted.visitorId,
            limit: CONVERSATION_TURN_LIMIT,
        });
        const ids = recent.map((turn) => turn.turn_id);
        const seqs = store.lastSeqsOf(ids);
        const replies = store.doneRepliesOf(ids);
        const offers = store.offersOf(ids);
        // Newest first while the answer still fits. A reconnect has to be able to rebuild what the visitor saw
        // most recently, so the newest turn is always included and older ones drop off once the budget is spent.
        const turns = [];
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
                pendingActions: store.pendingActions(turn.turn_id).map(action => action.id),
                message: turn.message,
                reply: replies.get(turn.turn_id) ?? null,
                offer: offers.get(turn.turn_id) ?? null,
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
    const handleTurnEvents = (req, origin, turnId) => {
        const admitted = presentedToken(req);
        if ('status' in admitted)
            return admitted;
        const allowed = checkAllowedOrigin(origin, store.originsOf(admitted.bot.chatbot_user_id));
        if (!allowed.ok)
            return reply(403, { error: 'origin_not_allowed' });
        // An older daemon buffers whatever body it is handed, which would turn this stream into a single JSON
        // object no widget can read. Refuse instead of answering something that only looks like a stream.
        if (req.acceptsStreamBody !== true)
            return reply(503, { error: 'stream_unavailable' });
        const after = readAfter(req.query[EVENTS_AFTER_QUERY]);
        if (!after.ok)
            return reply(400, { error: 'invalid_request', detail: after.error }, corsHeaders(origin));
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
    /** `POST v1/turns/:turnId/actions/:actionId/result` and `…/confirmation`: the two things a widget reports
     *  about a page action.
     *
     *  Both carry the visitor's own token and the origin allowlist gate, both must name THIS visitor's turn —
     *  an action id from another conversation is indistinguishable from one that does not exist — and both are
     *  answered by the action's own row: what is still live may report, what is closed may not, and a closed
     *  action says so with a status rather than by disappearing. */
    const handleActionReport = async (req, origin, turnId, actionId, kind) => {
        const admitted = presentedToken(req);
        if ('status' in admitted)
            return admitted;
        const allowed = checkAllowedOrigin(origin, store.originsOf(admitted.bot.chatbot_user_id));
        if (!allowed.ok)
            return reply(403, { error: 'origin_not_allowed' });
        const notJson = requireJsonBody(req, origin);
        if (notJson)
            return notJson;
        const body = await readJson(req);
        if (!body.ok)
            return reply(400, { error: 'invalid_request', detail: body.error }, corsHeaders(origin));
        const turn = isCanonicalUuid(turnId) ? store.turn(turnId) : null;
        if (!turn || turn.chatbot_user_id !== admitted.bot.chatbot_user_id || turn.visitor_id !== admitted.visitorId) {
            return reply(404, { error: 'not_found' }, corsHeaders(origin));
        }
        if (!isCanonicalUuid(actionId))
            return reply(404, { error: 'not_found' }, corsHeaders(origin));
        if (kind === 'result') {
            const parsed = validateActionResult(body.value, store.action(actionId)?.action);
            if (!parsed.ok)
                return reply(400, { error: 'invalid_request', detail: parsed.error }, corsHeaders(origin));
            return actionReportReply(actions.reportResult({ turn, actionId, outcome: parsed.value.outcome, detail: parsed.value.detail, origin }), origin);
        }
        const parsed = validateActionDecision(body.value);
        if (!parsed.ok)
            return reply(400, { error: 'invalid_request', detail: parsed.error }, corsHeaders(origin));
        return actionReportReply(actions.reportDecision({ turn, actionId, decision: parsed.value.decision, nonce: parsed.value.nonce }), origin);
    };
    /** A preflight for a cross-origin call the widget makes.
     *
     *  The allowlist is per chatbot, and a preflight names no chatbot: it carries only the page's origin and the
     *  method it is about to use. So the answer is "some ENABLED chatbot of this deployment answers on that
     *  origin" — which grants nothing on its own, because the request that follows still has to present a token
     *  that matches THIS chatbot and a visitor's own conversation. What it does give away is which domains this
     *  deployment serves; the alternative, answering every preflight, would be telling a caller nothing true at
     *  all while making the browser attempt a request the plugin then refuses.
     *
     *  The requested method is checked because a preflight is a question about a method: `GET` and `POST` are
     *  the two the widget uses, and nothing else is worth a grant. */
    const handlePreflight = (req, origin) => {
        const requested = (req.headers['access-control-request-method'] ?? req.headers['Access-Control-Request-Method'] ?? '').toUpperCase();
        if (requested !== '' && requested !== 'GET' && requested !== 'POST')
            return reply(403, { error: 'origin_not_allowed' });
        const served = store.listBots()
            .some((bot) => bot.status === 'enabled' && store.originsOf(bot.chatbot_user_id).includes(origin));
        return served ? reply(204, undefined, corsHeaders(origin)) : reply(403, { error: 'origin_not_allowed' });
    };
    /** A navigation ticket contains no conversation token. It is single-use, expires quickly, and can only
     * be redeemed by the target origin for this bot while the approved navigation remains pending. */
    const handleHandoff = async (req, origin) => {
        const headers = { ...corsHeaders(origin), 'cache-control': 'no-store' };
        const bad = () => reply(400, { error: 'invalid_request' }, headers);
        const notJson = requireJsonBody(req, origin);
        if (notJson)
            return notJson;
        const body = await readJson(req);
        if (!body.ok || !body.value || typeof body.value !== 'object' || Array.isArray(body.value))
            return bad();
        const value = body.value;
        if (value.schemaVersion !== PUBLIC_SCHEMA_VERSION)
            return bad();
        if ('code' in value) {
            if (Object.keys(value).some(key => !['schemaVersion', 'bot', 'code'].includes(key))
                || typeof value.code !== 'string' || !HANDOFF_CODE_PATTERN.test(value.code)
                || typeof value.bot !== 'string')
                return bad();
            const bot = store.botByPublicId(value.bot);
            const refused = admitBot(bot);
            if (refused)
                return refused;
            if (!checkAllowedOrigin(origin, store.originsOf(bot.chatbot_user_id)).ok)
                return reply(403, { error: 'origin_not_allowed' });
            const blocked = blockedReply(bot);
            if (blocked)
                return blocked;
            const actionId = store.consumeHandoff(hashToken(value.code), origin, iso(), bot.chatbot_user_id);
            if (!actionId)
                return reply(403, { error: 'invalid_handoff' }, headers);
            const action = store.action(actionId);
            const turn = store.turn(action.turn_id);
            const issued = issueVisitorToken(bot, turn.visitor_id);
            const result = actions.reportResult({ turn, actionId, outcome: 'done', detail: null, origin });
            if (!result.ok)
                return reply(409, { error: 'action_closed' }, headers);
            return reply(200, { schemaVersion: PUBLIC_SCHEMA_VERSION, token: issued.token, turnId: turn.turn_id }, headers);
        }
        if (Object.keys(value).some(key => !['schemaVersion', 'turnId', 'actionId'].includes(key))
            || typeof value.turnId !== 'string' || !isCanonicalUuid(value.turnId)
            || typeof value.actionId !== 'string' || !isCanonicalUuid(value.actionId))
            return bad();
        const admitted = presentedToken(req);
        if ('status' in admitted)
            return admitted;
        if (!checkAllowedOrigin(origin, store.originsOf(admitted.bot.chatbot_user_id)).ok)
            return reply(403, { error: 'origin_not_allowed' });
        const turn = store.turn(value.turnId);
        const action = store.action(value.actionId);
        if (!turn || turn.visitor_id !== admitted.visitorId || turn.chatbot_user_id !== admitted.bot.chatbot_user_id
            || !action || action.turn_id !== turn.turn_id || action.action !== 'navigate' || action.status !== 'pending'
            || action.expires_at <= iso())
            return reply(404, { error: 'not_found' }, headers);
        const request = actionRequestPayload(action);
        let url;
        try {
            url = new URL(request.value ?? '');
        }
        catch {
            return bad();
        }
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
            || !checkAllowedOrigin(url.origin, store.originsOf(admitted.bot.chatbot_user_id)).ok)
            return reply(403, { error: 'origin_not_allowed' }, headers);
        const code = randomBytes(32).toString('hex');
        store.createHandoff({ hash: hashToken(code), actionId: action.id, origin: url.origin,
            expiresAt: new Date(Math.min(now().getTime() + HANDOFF_TTL_MS, Date.parse(action.expires_at))).toISOString(), now: iso() });
        url.hash += (url.hash ? '&' : '') + HANDOFF_FRAGMENT_KEY + '=' + code;
        return reply(200, { schemaVersion: PUBLIC_SCHEMA_VERSION, url: url.href }, headers);
    };
    return async function handlePublicRequest(req) {
        const segments = req.path.replace(/^\/+|\/+$/g, '').split('/').filter((segment) => segment !== '');
        const path = segments.join('/');
        const origin = req.headers.origin ?? req.headers.Origin;
        // The widget script, answered BEFORE anything else: a customer's own page fetches it with a classic
        // `<script src>`, which carries no `Origin` header and is not a request by a visitor of any chatbot.
        // The asset is public by design and grants nothing — every request that asks for state still passes
        // the origin and token gates below.
        if (req.method === 'GET' && path === PUBLIC_PATHS.widget)
            return widgetAssetReply(req);
        // Nothing below is authorisation by CORS. The daemon's global permissive CORS middleware answers a
        // preflight (204 with `*`) before the hook dispatcher is reached, and a preflight reads nothing and
        // grants nothing either way: what admits a request is the plugin's own decision — an `Origin` header
        // matching one of the chatbot's allowed domains, a host-resolved trusted network origin, and a live
        // visitor token. A caller outside the allowlist is refused here regardless of any CORS header.
        const requestOrigin = trustedOrigin(req);
        if (!requestOrigin)
            return reply(403, { error: 'trusted_origin_required' });
        // The browser's own statement of which site asked. A request without one is not a request this
        // endpoint serves, and it is checked before anything is parsed.
        if (typeof origin !== 'string' || origin === '')
            return reply(403, { error: 'origin_not_allowed' });
        // The preflight a cross-origin call with an `Authorization` header is preceded by. Answered HERE rather
        // than left to the daemon's own middleware, which knows nothing about chatbot domains and would tell a
        // website outside every allowlist that its request may proceed.
        if (req.method === 'OPTIONS')
            return handlePreflight(req, origin);
        if (req.method === 'POST' && path === PUBLIC_PATHS.handoff)
            return handleHandoff(req, origin);
        if (req.method === 'POST' && path === PUBLIC_PATHS.bootstrap)
            return handleBootstrap(req, origin);
        if (req.method === 'POST' && path === PUBLIC_PATHS.visitors)
            return handleTokenIssuance(req, origin);
        if (req.method === 'POST' && path === PUBLIC_PATHS.refresh)
            return handleRefresh(req, origin);
        if (req.method === 'POST' && path === PUBLIC_PATHS.turns)
            return handleTurn(req, origin, requestOrigin);
        if (req.method === 'GET' && path === PUBLIC_PATHS.avatar)
            return handleAvatar(req, origin);
        if (req.method === 'GET' && path === PUBLIC_PATHS.conversation)
            return handleConversation(req, origin);
        if (req.method === 'GET' && segments.length === 3
            && segments[0] === PUBLIC_SEGMENTS.turns && segments[2] === PUBLIC_SEGMENTS.events) {
            return handleTurnEvents(req, origin, segments[1]);
        }
        if (req.method === 'POST' && segments.length === 5
            && segments[0] === PUBLIC_SEGMENTS.turns && segments[2] === PUBLIC_SEGMENTS.actions
            && (segments[4] === PUBLIC_SEGMENTS.result || segments[4] === PUBLIC_SEGMENTS.confirmation)) {
            return handleActionReport(req, origin, segments[1], segments[3], segments[4] === PUBLIC_SEGMENTS.result ? 'result' : 'confirmation');
        }
        return reply(404, { error: 'not_found' });
    };
}
/** The receipt one admitted turn is answered with, and the same receipt a retried submission of it gets: the
 *  two are one function because a retry must be indistinguishable from the original answer.
 *
 *  It describes ADMISSION, never the turn's current state — the widget attaches to the turn's own event stream
 *  next, and that is where a reconnect learns what has already happened. */
function turnReceipt(turn, origin) {
    return reply(202, { schemaVersion: PUBLIC_SCHEMA_VERSION, turnId: turn.turn_id, status: 'queued', lastSeq: 0 }, corsHeaders(origin));
}
/** Why one message was not admitted, as the caller is told. This is the only place these codes exist, and each
 *  one is a stable fact rather than a description: a widget shows the visitor one sentence for all of them,
 *  while the operator sees which ceiling answered in the plugin's own log.
 *
 *  `Retry-After` is present exactly where this plugin can say when the refusal stops being true — the end of
 *  the rate window, or the beginning of the next UTC day — and absent where it cannot, because a made-up
 *  number invites a retry loop that the ceiling will keep refusing. */
function admissionReply(outcome, origin) {
    const headers = corsHeaders(origin);
    switch (outcome.reason) {
        case 'rate_limited':
            return reply(429, { error: 'rate_limited' }, { ...headers, 'retry-after': String(outcome.retryAfterSeconds) });
        case 'budget_exhausted':
            return reply(429, { error: 'budget_exhausted' }, { ...headers, 'retry-after': String(outcome.retryAfterSeconds) });
        case 'budget_unverifiable':
            return reply(429, { error: 'budget_unverifiable' }, headers);
        case 'turn_in_progress':
            // 409: the same visitor already has a turn this chatbot has not finished. The widget's answer is to
            // follow THAT turn rather than to send this one again.
            return reply(409, { error: 'turn_in_progress' }, headers);
        case 'chatbot_busy':
            return reply(429, { error: 'chatbot_busy' }, headers);
        case 'limits_missing':
            // An enabled chatbot whose numbers are absent: there is no set to serve under and nothing to fall back
            // on, so it is the same refusal as any other chatbot that cannot run.
            return reply(503, { error: 'bot_unavailable' }, headers);
    }
}
/** What a widget is told after reporting an action. The success body is deliberately thin — the widget
 *  reads the status code and nothing else — while a refusal distinguishes the three ways a report can
 *  arrive too late to be believed. */
function actionReportReply(outcome, origin) {
    if (outcome.ok)
        return reply(200, { schemaVersion: PUBLIC_SCHEMA_VERSION, status: outcome.row.status }, corsHeaders(origin));
    // Every answer a widget can trigger carries the CORS grant, including this one: a cross-origin reply without
    // it is unreadable in a browser, so a widget would never LEARN that the action it reported is unknown to
    // this deployment — it would keep reporting, and the 404 would look like a network fault forever.
    if (outcome.reason === 'invalid_result')
        return reply(400, { error: 'invalid_request' }, corsHeaders(origin));
    if (outcome.reason === 'not_found')
        return reply(404, { error: 'not_found' }, corsHeaders(origin));
    if (outcome.reason === 'expired')
        return reply(409, { error: 'action_expired' }, corsHeaders(origin));
    if (outcome.reason === 'invalid_nonce')
        return reply(403, { error: 'invalid_nonce' }, corsHeaders(origin));
    return reply(409, { error: 'action_closed' }, corsHeaders(origin));
}
/** One request for the widget script. `If-None-Match` is answered with a bodiless `304` so a page load that
 *  already holds the bundle costs one round trip and no bytes, which is what makes the short cache window
 *  above affordable: a fix reaches visitors on the next load, and an unchanged bundle costs almost nothing
 *  in between. */
function widgetAssetReply(req) {
    const asset = widgetAsset();
    const headers = widgetAssetHeaders(asset.etag);
    const ifNoneMatch = req.headers['if-none-match'] ?? req.headers['If-None-Match'];
    if (matchesEtag(ifNoneMatch, asset.etag))
        return { status: 304, headers, body: undefined };
    return { status: 200, headers, body: asset.body };
}
/** A body this endpoint will INTERPRET must say it is JSON. A form-encoded or text/plain body is not a
 *  request this API takes, and answering it as though it were would be guessing at what the caller meant. */
function requireJsonBody(req, origin) {
    const declared = req.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
    return declared === 'application/json' ? null : reply(415, { error: 'unsupported_media_type' }, corsHeaders(origin));
}
/** `after` is the sequence number a widget has already rendered. Absent means "from the beginning", and
 *  anything that is not a plain non-negative integer is refused rather than coerced. */
function readAfter(raw) {
    if (raw === undefined || raw === '')
        return { ok: true, value: 0 };
    if (!/^\d{1,15}$/.test(raw))
        return { ok: false, error: '"after" must be a non-negative integer' };
    return { ok: true, value: Number(raw) };
}
/** One turn's public event log, pushed as it grows.
 *
 *  Push rather than pull: rows are read from the durable log and written as they appear, and a broker
 *  wake-up only says that MORE rows exist. The stream ends when the turn writes its terminal event, or when
 *  the turn is already terminal and its log has been replayed in full — a widget must never be left holding
 *  a connection to a turn that will never say anything again. */
function turnEventStream(input) {
    const encoder = new TextEncoder();
    let cursor = input.after;
    let released = false;
    let timer = null;
    let detach = null;
    const release = () => {
        if (released)
            return;
        released = true;
        if (timer !== null)
            clearInterval(timer);
        timer = null;
        detach?.();
        detach = null;
    };
    return new ReadableStream({
        start(controller) {
            const write = (chunk) => {
                if (released)
                    return false;
                try {
                    controller.enqueue(encoder.encode(chunk));
                    return true;
                }
                catch {
                    // The consumer closed or errored underneath us; there is nobody left to write to.
                    release();
                    return false;
                }
            };
            const frame = (event) => `${JSON.stringify({
                schemaVersion: PUBLIC_SCHEMA_VERSION,
                turnId: input.turnId,
                seq: event.seq,
                type: event.type,
                data: eventPayload(event),
            })}\n`;
            const drain = () => {
                if (released)
                    return;
                for (const event of input.store.events(input.turnId, cursor)) {
                    cursor = event.seq;
                    if (!write(frame(event)))
                        return;
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
async function readJson(req) {
    try {
        return { ok: true, value: await req.json() };
    }
    catch {
        return { ok: false, error: 'body must be valid JSON' };
    }
}
