// WhatsApp binding for the shared live-message engine (elowen-plugin-shared/liveMessage): the Baileys
// transport, the plain-text render style and the final-answer send. The throttled editable message, the
// brain-event reducer and the render/fold core all live in the shared engine. WhatsApp used to carry its
// own copy of that lifecycle and kept drifting away from it (a final settle with no retry, an error reply
// that could overtake an in-flight progress send), so only what genuinely differs stays here.
import { CHUNK, splitContent, footerLine } from './format.mjs';
import { createLiveMessage } from 'elowen-plugin-shared/liveMessage';
import { resolveDisplaySettings } from 'elowen-plugin-shared/display';

const EDIT_THROTTLE_MS = 1500; // WhatsApp is stricter than Discord/Telegram on edits — stay well under any limit

/** Post the final answer text, quoting the trigger. Shared images travel as image events. */
async function postFinalText(adapter, jid, text, quoted) {
  await adapter.sendText(jid, text, quoted);
}

// The Baileys transport for one editable message. Each closure receives the adapter so it calls the same
// `sock.sendMessage` / `sendImages` the plugin tests mock. Create returns the message key (null on failure,
// so the next drain retries the create), edit returns whether it landed, and remove uses Baileys' delete
// protocol when ephemeral tool progress is enabled. WhatsApp may render its standard deletion tombstone.
const transport = {
  create: (a, jid, content, extra) =>
    a.sock.sendMessage(jid, { text: content }, extra).then((s) => s?.key ?? null, () => null),
  edit: (a, jid, key, content) =>
    a.sock.sendMessage(jid, { text: content, edit: key }).then(() => true, () => false),
  remove: (a, jid, key) => a.sock.sendMessage(jid, { delete: key }).catch(() => {}),
  replyRef: (quoted) => ({ quoted }),
  hasImages: (a) => typeof a.resolveImageFiles === 'function' && typeof a.sendImages === 'function',
  // Forward the trigger quote exactly like postFinalText does for text: the image reply keeps its link
  // to the message it answers. The adapter quotes only the first image (matching sendText's first piece).
  // The fifth argument is the agent's caption for the shared images (see the shared engine's finalize);
  // the adapter puts it on the first image message, where Baileys renders it as the message's text.
  postImages: (a, jid, data, quoted, caption) => a.sendImages(jid, data, quoted, caption),
  // Files the agent shared (ShareFile) go out as document messages, which keep the name and the bytes an
  // image message would re-encode away. The caption rides along the same way as for images.
  hasFiles: (a) => typeof a.resolveSharedFiles === 'function' && typeof a.sendDocuments === 'function',
  postFiles: (a, jid, data, quoted, caption) => a.sendDocuments(jid, data, quoted, caption),
};

// WhatsApp renders plain text (nothing to escape for mentions/fences), `*bold*` titles, no strikethrough on
// completed items (`~x~` reads as "cancelled" here), `_italic_`, no dim/subtext style, and an indented `↳`
// result line — the surface style the shared engine renders through.
const style = {
  mentionSafe: (s) => s,
  fenceSafe: (s) => s,
  bold: (s) => `*${s}*`,
  strike: (s) => s,
  italic: (s) => `_${s}_`,
  subtext: (s) => s,
  summaryLine: (s) => `  ↳ ${s}`,
  // WhatsApp renders `> ` as a quoted block, so the checklist gets its own panel instead of a drawn
  // divider — the one piece of block markup this otherwise plain-text surface does support.
  quoteBlock: (lines) => lines.map((l) => `> ${l}`).join('\n'),
};

const LiveBase = createLiveMessage({ transport, style, CHUNK, splitContent, postFinalText, footerLine, editThrottleMs: EDIT_THROTTLE_MS });

/** The WhatsApp live message: the shared engine with the answer pinned to `final`. The engine's live-answer
 *  path re-anchors and discards draft bubbles by DELETING them, and a deleted Baileys message leaves a
 *  "this message was deleted" tombstone in every client — so the answer stays ONE clean message sent after
 *  the run settles, quoted to the trigger, while tool activity streams into the progress bubble. */
export class LiveMessage extends LiveBase {
  constructor(adapter, jid, quoted, askerJid, options = {}) {
    super(adapter, jid, quoted, askerJid, { ...resolveDisplaySettings(adapter.cfg), answerMode: 'final' }, options);
  }
}
