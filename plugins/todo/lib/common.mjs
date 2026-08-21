export const ok = (value) => ({
  content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
  details: {},
});

export const fail = (error) => ok(`Error: ${error instanceof Error ? error.message : String(error)}`);

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
