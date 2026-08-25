// WhatsApp text/format helpers. The transport-neutral pieces (extractImageRefs, stripThinking,
// parseModelExec, the fenced-split core) live in elowen-plugin-shared/format; only WhatsApp's own chunk size,
// reply-quote and footer stay here.
import { splitContent as splitAtChunk, renderChatTables, extractImageRefs, stripThinking, parseModelExec, runtimeFooter, stripRuntimeFooter } from 'elowen-plugin-shared/format';
export { extractImageRefs, stripThinking, parseModelExec };

export const CHUNK = 4000;               // split long replies into readable pieces
const CHAT_TABLE_WIDTH = 48;             // narrow rows survive portrait phone chats without horizontal scanning
const REPLY_EXCERPT = 300;               // quoted-reply excerpt length

/** Baileys sends text directly; keep rows bare because this plugin does not prove code-fence rendering. */
export const splitContent = (text) => splitAtChunk(renderChatTables(text, { fence: false, maxWidth: CHAT_TABLE_WIDTH }), CHUNK);

/** Quote context for a reply: who is being answered + a capped excerpt of what they said. */
export function buildReplyContext(name, body) {
  const content = String(body ?? '').trim();
  if (!content) return '';
  const excerpt = content.length > REPLY_EXCERPT ? `${content.slice(0, REPLY_EXCERPT)}…` : content;
  return `[Replying to ${name || 'someone'}: "${excerpt}"]`;
}

/** The italic markup WhatsApp's runtime footer is wrapped in — shared by the writer (`footerLine`) and
 *  the reader (`withoutFooter`), so the two can never drift into recognising different shapes. */
const FOOTER_FENCE = { open: '_', close: '_' };

/** Runtime footer: `model · 42 %`. Empty when the idle event carried no usable data. */
export const footerLine = (idle) => runtimeFooter(idle, FOOTER_FENCE);

/** Drop our own trailing footer from a message before it is fed back as prompt context. */
export const withoutFooter = (text) => stripRuntimeFooter(text, FOOTER_FENCE);

