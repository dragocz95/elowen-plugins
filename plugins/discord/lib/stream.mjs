// Discord binding for the shared live-message engine (elowen-plugin-shared/liveMessage): the Discord REST
// transport, the markdown render style, and the final-answer image strategy. The throttled editable
// message, the streaming answer and the brain-event reducer all live in the shared engine — only the
// pieces that genuinely differ from Telegram/other surfaces stay here.
import { CHUNK, splitContent, footerLine } from './format.mjs';
import { createLiveMessage } from 'elowen-plugin-shared/liveMessage';

/** Post a final text to a channel. Shared images are sent from authorized image events. */
export async function postFinalText(adapter, channelId, text, replyToId) {
  const pieces = splitContent(text);
  // The first piece is a real Discord reply to the triggering message (fail_if_not_exists:false —
  // a deleted trigger degrades to a plain message instead of a 400).
  const ref = replyToId ? { message_reference: { message_id: replyToId, fail_if_not_exists: false } } : {};
  for (let i = 0; i < pieces.length; i++) {
    await adapter.rest('POST', `/channels/${channelId}/messages`, { content: pieces[i], ...(i === 0 ? ref : {}) });
  }
}

// The Discord REST transport for one editable message. Each closure receives the adapter so it calls the
// same `adapter.rest` the plugin tests mock. Create returns the new message id (null on failure), edit
// returns whether the PATCH landed, remove is best-effort DELETE.
const transport = {
  create: (a, channelId, content, extra) =>
    a.rest('POST', `/channels/${channelId}/messages`, { content, ...extra }).then((msg) => msg?.id ?? null, () => null),
  edit: (a, channelId, messageId, content) =>
    a.rest('PATCH', `/channels/${channelId}/messages/${messageId}`, { content }).then(() => true, () => false),
  remove: (a, channelId, messageId) =>
    a.rest('DELETE', `/channels/${channelId}/messages/${messageId}`).catch(() => {}),
  replyRef: (replyToId) => ({ message_reference: { message_id: replyToId, fail_if_not_exists: false } }),
  hasImages: (a) => typeof a.resolveImageFiles === 'function' && typeof a.uploadImages === 'function',
  // A Discord upload carries the message content itself, so an image the agent captioned arrives with its
  // caption as that message's text instead of as a separate bubble. Clamped to the surface limit — a
  // caption over it would fail the whole upload and lose the picture.
  postImages: (a, channelId, data, _replyToId, caption) => a.uploadImages(channelId, String(caption ?? '').slice(0, CHUNK), data, 0, {}),
  // Files the agent shared (ShareFile) ride the same multipart upload as images, for the same reason: the
  // event carries a relative daemon URL, which is dead text in a Discord channel.
  hasFiles: (a) => typeof a.resolveSharedFiles === 'function' && typeof a.uploadFiles === 'function',
  postFiles: (a, channelId, data, _replyToId, caption) => a.uploadFiles(channelId, String(caption ?? '').slice(0, CHUNK), data, 0, {}),
};

// Discord renders markdown, so the style escapes @everyone/<@ ping injection, neutralizes ``` fences, and
// uses **bold**/~~strike~~, a `-#` subtext line and `_italic_`; the fold rule, output summaries and diff
// summary come straight from the shared core (elowen-plugin-shared/liveTrace).
const style = {
  mentionSafe: (s) => s.replace(/@(?=everyone|here)/gi, '@​').replace(/<@(?=[!&]?\d)/g, '<@​'),
  fenceSafe: (s) => s.replace(/```/g, "'''"),
  bold: (s) => `**${s}**`,
  strike: (s) => `~~${s}~~`,
  italic: (s) => `_${s}_`,
  subtext: (s) => `-# ${s}`,
  summaryLine: (s) => `-# ↳ ${s}`,
  // Display cards (the todo checklist) render as a Discord block quote, whose left bar sets the plan
  // apart from the tool trace on its own — so the engine drops the drawn divider on this surface.
  // Discord continues one quote across consecutive `> ` lines, so prefixing each line is the whole job.
  quoteBlock: (lines) => lines.map((l) => `> ${l}`).join('\n'),
};

export const LiveMessage = createLiveMessage({ transport, style, CHUNK, splitContent, postFinalText, footerLine });
