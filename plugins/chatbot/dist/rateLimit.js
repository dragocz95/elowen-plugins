import { conversationChannelId } from './adapter.js';
/** The three fixed-window rate limits, as pure arithmetic on an instant.
 *
 *  A window is a minute of wall clock, not a sliding one: the counter lives in one row per (scope, key,
 *  minute) and a new minute is a new row. That is what makes the decision a single atomic increment-and-read
 *  in one transaction, which is the only form of rate limiting that cannot be raced by two simultaneous
 *  requests. Its known property — a burst across a minute boundary can reach twice the limit — is accepted:
 *  the number is a coarse guard whose real counterpart is the daily budget. */
const RATE_WINDOW_MS = 60_000;
/** The key of the address window: the chatbot and the address that reached it.
 *
 *  The address is the one the HOST resolved (never a header this plugin read itself), and admission has
 *  already refused anything that is not an `ip` origin, so the value carries no colon of its own making...
 *  which the concatenation does not even need: the chatbot id comes first, so a reader splitting on the
 *  first colon gets the id back whatever the address looks like. */
export function ipScopeKey(chatbotUserId, originValue) {
    return `${chatbotUserId}:${originValue}`;
}
/** The key of the chatbot window. One chatbot is one account, so its own id is the key. */
export function chatbotScopeKey(chatbotUserId) {
    return String(chatbotUserId);
}
/** The key of the conversation window. It is the SAME string core keys the channel session by — the chatbot
 *  and the visitor together — because a window that counted something other than the conversation would be a
 *  second definition of it. */
export function conversationScopeKey(chatbotUserId, visitorId) {
    return conversationChannelId(chatbotUserId, visitorId);
}
/** The window an instant falls in, as the two ISO strings the row holds: the minute's start and its end. */
export function windowAt(scope, key, nowMs) {
    const startedAtMs = Math.floor(nowMs / RATE_WINDOW_MS) * RATE_WINDOW_MS;
    return {
        scope,
        key,
        startedAt: new Date(startedAtMs).toISOString(),
        expiresAt: new Date(startedAtMs + RATE_WINDOW_MS).toISOString(),
    };
}
/** Seconds a caller is told to wait, for `Retry-After`. Always at least one: `0` would invite an immediate
 *  retry inside the window that refused it. */
export function retryAfterSeconds(untilIso, nowMs) {
    const until = Date.parse(untilIso);
    if (!Number.isFinite(until))
        return 1;
    return Math.max(1, Math.ceil((until - nowMs) / 1000));
}
