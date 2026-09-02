export const ok = (value) => ({
  content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
  details: {},
});

export const fail = (error) => ok(`Error: ${error instanceof Error ? error.message : String(error)}`);

/** C0 controls and DEL, which a task subject or owner must never carry.
 *
 *  Both are SINGLE-LINE labels reproduced verbatim on every surface: a card row, the CLI's fixed bottom
 *  panel, and the `<subject>` element of the XML turn context. `escapeXml` neutralises markup but leaves a
 *  raw control byte exactly as it is, so a newline forges a line in the rendered context and an escape
 *  sequence walks the terminal cursor out of the row it was drawn in.
 *
 *  The check runs on the TRIMMED value, which is why an ordinary space still passes while a tab or a
 *  newline INSIDE the label does not: surrounding whitespace is what trimming is for, and a subject is
 *  one line. */
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/;

export const hasControlCharacters = (value) => CONTROL_CHARACTERS.test(String(value).trim());

export function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/** A live checklist belongs to exactly one conversation and identity. */
export function keyFor(ctx) {
  const sessionId = ctx.currentSessionId?.();
  if (!sessionId) return null;
  const identity = ctx.currentIdentity?.();
  const owner = !identity
    ? 'shared'
    : identity.elowenUserId != null
      ? `u${identity.elowenUserId}`
      : identity.platform && identity.userId
        ? `${identity.platform}:${identity.userId}`
        : 'shared';
  return `${owner}#${sessionId}`;
}

export function parseObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return { ...value };
}
