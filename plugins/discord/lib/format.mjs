// Discord text/format helpers. The transport-neutral pieces (stripForSpeech, extractImageRefs,
// stripThinking, parseModelExec, the fenced-split core) live in elowen-plugin-shared/format; only Discord's
// own chunk size, mention/name resolution, reply-quote and subtext footer stay here.
import { splitContent as splitAtChunk, renderChatTables, extractImageRefs, stripThinking, parseModelExec, stripForSpeech, runtimeFooter, stripRuntimeFooter } from 'elowen-plugin-shared/format';
export { extractImageRefs, stripThinking, parseModelExec, stripForSpeech };

export const CHUNK = 1990;
// Wide enough that an ordinary four-column table stays a table. Narrower values look kinder to a phone but
// push every table with one longer cell into the stacked key/value fallback, which is the worse read of the
// two: a Discord code block scrolls horizontally on desktop and mobile alike, so overflow costs a swipe,
// while stacking costs the comparison the table existed to show.
const CHAT_TABLE_WIDTH = 72;
const REPLY_EXCERPT = 300;               // quoted-reply excerpt length

/** Render chat tables first, then split the final fenced text without breaking its code block. */
export const splitContent = (text) => splitAtChunk(renderChatTables(text, { fence: true, maxWidth: CHAT_TABLE_WIDTH }), CHUNK);

/** The roleId that matches anyone. */
export const WILDCARD = '*';

/** Whether a policy id IS the wildcard. Trimmed, like every other comparison here: a row saved as
 *  `' * '` must mean the same thing in the policy-level branch and in the per-id one. */
export const isWildcard = (policyId) => String(policyId ?? '').trim() === WILDCARD;

/** Whether a policy `roleId` matches one of a member's role ids. Discord role ids are opaque snowflakes
 *  and compare exactly; `*` matches every role. */
export function matchesId(policyId, roleId) {
  const a = String(policyId ?? '').trim();
  const b = String(roleId ?? '').trim();
  if (!a || !b) return false;
  if (isWildcard(a)) return true;
  return a === b;
}

/** The FIRST rolePolicy matching a member, or undefined when none does.
 *
 *  Policies are ORDERED and the first match wins — the same resolution `accessFor` uses, which is why
 *  both go through this one function. Deriving the admin gate from a separate "does any admin policy
 *  match" scan is how a member whose effective (first) policy is restricted could still pass the
 *  operator gate by ALSO holding a role listed admin further down: they answered another person's
 *  parked question and changed the whole channel's model while holding the narrow role's scope.
 *
 *  A `*` policy matches even a member carrying no roles at all — `m.member.roles` omits @everyone, so a
 *  plain member arrives here with an empty list and a wildcard that only matched through the id list
 *  would skip exactly the people it exists to cover. It therefore belongs LAST: above the named
 *  policies it swallows them all and everyone shares one role.
 *
 *  That exception is about a GUILD MEMBER who holds no roles, and callers must not widen it into "no
 *  member at all": a payload carrying no member describes somebody outside the guild, and the adapter
 *  keeps those away from here (see `guildRoleIds`). */
export function matchPolicy(roleIds, rolePolicies) {
  const ids = Array.isArray(roleIds) ? roleIds : [];
  const list = Array.isArray(rolePolicies) ? rolePolicies : [];
  return list.find((p) => isWildcard(p.roleId) || (p.roleId && ids.some((id) => matchesId(p.roleId, id))));
}

/** Whether the member's effective first-match policy grants operator access. Gates the shared
 *  per-channel pickers (/model, /reasoning) to the operator only. */
export function memberIsAdmin(roleIds, rolePolicies) {
  return matchPolicy(roleIds, rolePolicies)?.admin === true;
}

/** The name a human sees for a message author: server nick > global display name > username. */
export function displayNameOf(m) {
  return m?.member?.nick || m?.author?.global_name || m?.author?.username || 'unknown';
}

/** Replace raw mention tokens with readable names: `<@id>`/`<@!id>` from the payload's mention list,
 *  `<@&id>` from the configured role policies (else a generic `@role`), `<#id>` from the channel-name
 *  cache (else left as-is). The bot's own mention must be stripped BEFORE calling this. */
export function resolveMentions(text, mentions, rolePolicies, channelNames) {
  let out = text;
  for (const u of Array.isArray(mentions) ? mentions : []) {
    const name = u.member?.nick || u.global_name || u.username || u.id;
    out = out.replaceAll(`<@${u.id}>`, `@${name}`).replaceAll(`<@!${u.id}>`, `@${name}`);
  }
  out = out.replace(/<@&(\d+)>/g, (_, id) => {
    const policy = (Array.isArray(rolePolicies) ? rolePolicies : []).find((p) => p.roleId === id);
    return policy?.name ? `@${policy.name}` : '@role';
  });
  return out.replace(/<#(\d+)>/g, (match, id) => {
    const name = channelNames?.get(id);
    return name ? `#${name}` : match;
  });
}

/** Quote context for a reply: who is being answered + a capped excerpt of what they said.
 *  `referenced_message` may be absent/null (not a reply, or the original was deleted) → ''.
 *  `ourId` is the bot's own user id: quoting a message WE wrote drops our runtime footer first (see
 *  `withoutFooter`) — the excerpt is short enough that the footer would otherwise survive the clip and
 *  re-enter the prompt on every single reply to the bot. */
export function buildReplyContext(ref, ourId) {
  if (!ref) return '';
  const raw = String(ref.content ?? '');
  const content = (ourId && ref.author?.id === ourId ? withoutFooter(raw) : raw).trim();
  const excerpt = content.length > REPLY_EXCERPT ? `${content.slice(0, REPLY_EXCERPT)}…` : content;
  return `[Replying to ${displayNameOf(ref)}: "${excerpt}"]`;
}

/** The subtext markup Discord's runtime footer is wrapped in — shared by the writer (`footerLine`) and
 *  the reader (`stripRuntimeFooter`), so the two can never drift into recognising different shapes. */
const FOOTER_FENCE = { open: '-# ', close: '' };

/** Runtime footer: `model · 42 %` as Discord subtext under the final answer. Discord used to keep a
 *  byte-for-byte copy of the shared writer here in order to keep the provider in the line; now that no
 *  chat surface shows it, the copy had nothing left to differ by and only offered somewhere for the two
 *  to drift apart. Only the fence is Discord's own. */
export const footerLine = (idle) => runtimeFooter(idle, FOOTER_FENCE);

/** Drop our own trailing footer from a message before it is fed back as prompt context. */
export const withoutFooter = (text) => stripRuntimeFooter(text, FOOTER_FENCE);
