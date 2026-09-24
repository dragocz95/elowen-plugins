// Telegram binding for the shared live-message engine (elowen-plugin-shared/liveMessage): the grammY
// transport (bot.api.sendMessage / editMessageText / deleteMessage via the adapter's tg* helpers), the
// plain-text render style, and the final-answer image strategy (photos ahead of the text). The throttled
// editable message, the streaming answer and the brain-event reducer all live in the shared engine — only
// the pieces that genuinely differ from Discord/other surfaces stay here. Telegram messages are sent
// without a parse_mode, so the markdown decorations render as plain text.
import { CHUNK, splitContent, footerLine } from './format.mjs';
import { createLiveMessage } from 'elowen-plugin-shared/liveMessage';

/** Post final text to a chat. Shared images are sent from authorized image events. */
export async function postWithImages(adapter, chatId, text, replyToId) {
  const reply = replyToId ? { reply_parameters: { message_id: replyToId, allow_sending_without_reply: true } } : {};
  const pieces = splitContent(text);
  for (let i = 0; i < pieces.length; i++) {
    await adapter.tgSend(chatId, pieces[i], i === 0 ? reply : {});
  }
}

// The grammY transport for one editable message. Each closure receives the adapter so it calls the same
// tg* helpers the plugin tests mock. Create returns the new message id (null on failure), edit returns
// whether the edit landed, remove is best-effort delete (tgDelete swallows its own errors).
const transport = {
  create: (a, chatId, content, extra) => a.tgSend(chatId, content, extra).then((id) => id ?? null),
  edit: (a, chatId, messageId, content) => a.tgEdit(chatId, messageId, content),
  remove: (a, chatId, messageId) => a.tgDelete(chatId, messageId),
  replyRef: (replyToId) => ({ reply_parameters: { message_id: replyToId, allow_sending_without_reply: true } }),
  hasImages: (a) => typeof a.resolveImageFiles === 'function' && typeof a.sendPhotos === 'function',
  postImages: (a, chatId, data, _replyToId, caption) => a.sendPhotos(chatId, data, {}, caption),
  // Files the agent shared (ShareFile) go out as documents rather than photos: a document keeps its name
  // and bytes, which is what a shared PDF or spreadsheet is FOR.
  hasFiles: (a) => typeof a.resolveSharedFiles === 'function' && typeof a.sendDocuments === 'function',
  postFiles: (a, chatId, data, _replyToId, caption) => a.sendDocuments(chatId, data, {}, caption),
};

// Telegram sends plain text (no parse_mode), so the style is all-identity — nothing to escape
// (mentions/fences are inert) and no bold/strike/italic/subtext markers — with a plain `  ↳` output line.
// The fold rule and summaries come from the shared core (elowen-plugin-shared/liveTrace).
const style = {
  mentionSafe: (s) => s,
  fenceSafe: (s) => s,
  bold: (s) => s,
  strike: (s) => s,
  italic: (s) => s,
  subtext: (s) => s,
  summaryLine: (s) => `  ↳ ${s}`,
};

export const LiveMessage = createLiveMessage({ transport, style, CHUNK, splitContent, postWithImages, footerLine });
