import { requiresVisitorConfirmation } from './publicContract.js';
export function resolveActionRule(input) {
    if (!input.allowedOrigins.includes(input.origin))
        return { ok: false, reason: 'action_not_allowed' };
    const forOrigin = input.rules.filter((rule) => rule.origin === input.origin);
    if (forOrigin.length === 0)
        return { ok: true, maxPerTurn: input.ceiling };
    const covering = forOrigin.filter((rule) => covers(rule.path_prefix, input.path));
    if (covering.length === 0)
        return { ok: false, reason: 'action_not_allowed' };
    // The most specific rule wins. `covers` is a path-prefix test, so the longest prefix of the matching ones
    // is the narrowest place an administrator has described.
    const prefix = covering.reduce((longest, rule) => (rule.path_prefix.length > longest.length ? rule.path_prefix : longest), '');
    const rule = covering.find((candidate) => candidate.path_prefix === prefix && candidate.action === input.action);
    if (!rule)
        return { ok: false, reason: 'action_not_allowed' };
    // A rule may demand the visitor's confirmation for an ordinary kind — but a v1 frame can only carry a
    // confirmation requirement for the kind that IS one, and a widget handed a frame contradicting the
    // contract drops it. Answering with a refusal is the only honest option: the alternative is an action
    // nobody performs while the plugin waits for it.
    if (rule.requires_confirmation === 1 && !requiresVisitorConfirmation(input.action)) {
        return { ok: false, reason: 'confirmation_unavailable' };
    }
    // Two ceilings, the tighter one wins: the administrator's own cap for this place, and the plugin's own
    // per-turn bound, which no rule may raise.
    return { ok: true, maxPerTurn: Math.min(input.ceiling, rule.max_per_turn) };
}
/** Whether a path prefix covers a path.
 *
 *  A prefix is a path SEGMENT prefix, not a string one: `/formular` covers `/formular` and `/formular/2`
 *  and never `/formular-evil`, which a plain `startsWith` would happily let through. `/` covers the whole
 *  origin, which is what a rule written for a site's root is for. */
function covers(prefix, path) {
    if (prefix === '/')
        return path.startsWith('/');
    if (path === prefix)
        return true;
    return path.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`);
}
