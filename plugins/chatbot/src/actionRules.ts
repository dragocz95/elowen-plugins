import { requiresVisitorConfirmation, type ActionKind, type ActionRuleRefusal } from './publicContract.js';

/** Where an action may be performed, and how often. The allowlist is SERVER data — rows an administrator
 *  writes in `p_chatbot_action_rules` — never a field a page or a model supplies. This module answers one
 *  question, from the origin and the path the turn recorded and from nothing else: may THIS kind be done on
 *  THAT page?
 *
 *  The rules of one origin are the policy of that origin. The longest matching path prefix wins, so
 *  `/formular/priloha` can be stricter than `/formular`; an action a matching rule does not name is refused,
 *  even when the element itself claimed it could do it; and a path no rule of that origin covers is closed.
 *  An origin with NO rule at all is governed by the implicit policy its own allowlist entry already implies
 *  — the chatbot answers there because an administrator allowed the domain — bounded by the plugin's own
 *  per-turn ceiling. That is what lets a chatbot act usefully before its first rule is written, without the
 *  default becoming a second allowlist that could drift away from `p_chatbot_origins`. */

/** One stored rule, as the plugin reads it back. */
export interface ActionRule {
  origin: string;
  path_prefix: string;
  action: string;
  requires_confirmation: number;
  max_per_turn: number;
}

/** Why an action is not allowed here. Both reasons are about the REQUEST, never about what the page holds.
 *
 *  The vocabulary lives in the shared contract rather than here, because these are not private to this file:
 *  the server answers a model with them, together with the reasons the page-action policy itself has. */
export type { ActionRuleRefusal };

export type ActionRuleVerdict = { ok: true; maxPerTurn: number } | { ok: false; reason: ActionRuleRefusal };

export function resolveActionRule(input: {
  rules: readonly ActionRule[];
  /** The domains this chatbot answers on. An action is inside the allowlist only where its traffic is. */
  allowedOrigins: readonly string[];
  origin: string;
  path: string;
  action: ActionKind;
  /** The plugin's own per-turn ceiling: the implicit policy's cap, and the ceiling a rule can only lower. */
  ceiling: number;
}): ActionRuleVerdict {
  if (!input.allowedOrigins.includes(input.origin)) return { ok: false, reason: 'action_not_allowed' };

  const forOrigin = input.rules.filter((rule) => rule.origin === input.origin);
  if (forOrigin.length === 0) return { ok: true, maxPerTurn: input.ceiling };

  const covering = forOrigin.filter((rule) => covers(rule.path_prefix, input.path));
  if (covering.length === 0) return { ok: false, reason: 'action_not_allowed' };
  // The most specific rule wins. `covers` is a path-prefix test, so the longest prefix of the matching ones
  // is the narrowest place an administrator has described.
  const prefix = covering.reduce((longest, rule) => (rule.path_prefix.length > longest.length ? rule.path_prefix : longest), '');
  const rule = covering.find((candidate) => candidate.path_prefix === prefix && candidate.action === input.action);
  if (!rule) return { ok: false, reason: 'action_not_allowed' };
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
function covers(prefix: string, path: string): boolean {
  if (prefix === '/') return path.startsWith('/');
  if (path === prefix) return true;
  return path.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`);
}
