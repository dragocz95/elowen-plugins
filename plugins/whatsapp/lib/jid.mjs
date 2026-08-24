// WhatsApp identity helpers: JID normalization and sender-policy matching.
import { jidDecode } from 'baileys';

/** Digits-only comparison of two WhatsApp identifiers so a policy `roleId` written as a bare number,
 *  a full JID, or with punctuation still matches the sender. Group JIDs (…@g.us) compare by their full
 *  id (which is also digits) — a group's id never collides with a personal number in practice. */
export function sameId(a, b) {
  const norm = (x) => String(x ?? '').replace(/[^0-9]/g, '');
  const na = norm(a);
  const nb = norm(b);
  return na.length > 0 && na === nb;
}

/** Whether a JID is a group chat (…@g.us) rather than a direct chat. */
export function isGroup(jid) { return typeof jid === 'string' && jid.endsWith('@g.us'); }

/** Whether a chat JID is one the assistant may handle: a group or a personal PN/LID chat. Status,
 *  newsletters, broadcast lists and future non-chat namespaces are rejected rather than treated as direct. */
export function isSupportedChat(jid) {
  return isGroup(jid) || (typeof jid === 'string' && (jid.endsWith('@s.whatsapp.net') || jid.endsWith('@lid')));
}

/** The bare phone number of a personal JID (…@s.whatsapp.net / …@lid) — digits only. */
export function numberOf(jid) { return jidDecode(jid)?.user ?? String(jid ?? '').replace(/[@:].*$/, ''); }

/** Normalize a user-supplied recipient (number or JID) into a sendable JID. A value already carrying an
 *  @-suffix is trusted as-is (group or user); a bare number becomes a personal JID. */
export function toJid(recipient) {
  const s = String(recipient ?? '').trim();
  if (!s) return '';
  if (s.includes('@')) return s;
  return `${s.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
}

/** The roleId that matches anyone. */
export const WILDCARD = '*';

/** Whether a policy id IS the wildcard. Trimmed, like every other comparison here: a row saved as
 *  `' * '` must mean the same thing in the policy-level branch and in the per-id one. */
export const isWildcard = (policyId) => String(policyId ?? '').trim() === WILDCARD;

/** Whether a policy `roleId` matches one of a sender's identifiers. `*` matches every sender; everything
 *  else is the digits-only comparison above. The wildcard lives HERE rather than in `sameId` because
 *  `sameId` also decides whether a mention or a parked question's asker is a given person — a `*`
 *  answering true to those would hand one person's question to whoever replied next. */
export function matchesId(policyId, id) {
  const a = String(policyId ?? '').trim();
  if (!a || !String(id ?? '').trim()) return false;
  if (isWildcard(a)) return true;
  return sameId(a, id);
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
  return list.find((p) => isWildcard(p.roleId) || (p.roleId && idList.some((id) => matchesId(p.roleId, id))));
}

/** Whether the sender's effective first-match policy grants operator access. Gates the shared per-chat
 *  pickers (/model, /reasoning) and the group tools. */
export function senderIsAdmin(ids, policies) {
  return matchPolicy(ids, policies)?.admin === true;
}
