// Telegram identity helpers: sender identification and role-policy matching (analog of whatsapp/lib/jid.mjs).
// A Telegram sender is known by a numeric user id, an optional @username, and — in a group — the numeric
// chat id. A rolePolicy `roleId` may be written as any of these, so matching accepts all three forms.

/** The roleId that matches anyone. */
export const WILDCARD = '*';

/** Whether a policy `roleId` matches one of a sender's identifiers. `@username` comparisons are
 *  case-insensitive (Telegram usernames are case-insensitive); numeric ids/chat ids compare exactly.
 *  `*` matches every sender — the way to serve a whole group without listing it person by person. */
export function matchesId(policyId, id) {
  const a = String(policyId ?? '').trim();
  const b = String(id ?? '').trim();
  if (!a || !b) return false;
  if (a === WILDCARD) return true;
  if (a.startsWith('@') || b.startsWith('@')) return a.replace(/^@/, '').toLowerCase() === b.replace(/^@/, '').toLowerCase();
  return a === b;
}

/** The identifiers a sender is known by, for policy matching: their numeric user id, their @username
 *  (when set), and the chat id (so a policy can grant a whole group/channel at once). */
export function senderIds(from, chatId) {
  const ids = [];
  if (from?.id != null) ids.push(String(from.id));
  if (from?.username) ids.push(`@${from.username}`);
  if (chatId != null) ids.push(String(chatId));
  return ids;
}

/** The FIRST policy matching a sender, or undefined when none does.
 *
 *  Policies are ORDERED and the first match wins — the same resolution `accessFor` uses, which is why
 *  both go through this one function. Deriving the admin gate from a separate "does any admin policy
 *  match" scan is how a sender whose effective (first) policy is restricted could still pass the
 *  operator gate by ALSO matching an admin policy further down: they answered another person's parked
 *  question and changed the whole chat's model while holding the narrow policy's scope.
 *
 *  A wildcard policy belongs LAST: above the named policies it swallows them all. */
export function matchPolicy(ids, policies) {
  const list = Array.isArray(policies) ? policies : [];
  const idList = Array.isArray(ids) ? ids : [];
  return list.find((p) => p.roleId === WILDCARD || (p.roleId && idList.some((id) => matchesId(p.roleId, id))));
}

/** Whether the sender's effective first-match policy grants operator access. Gates the shared per-chat
 *  pickers (/model, /reasoning) and the group/owner tools. */
export function senderIsAdmin(ids, policies) {
  return matchPolicy(ids, policies)?.admin === true;
}

/** The name a human sees for a message sender: first + last name, else @username, else the numeric id. */
export function displayNameOf(from) {
  const full = [from?.first_name, from?.last_name].filter(Boolean).join(' ').trim();
  return full || from?.username || String(from?.id ?? 'unknown');
}
