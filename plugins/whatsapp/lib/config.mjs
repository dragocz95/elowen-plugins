/** Normalize the ordered WhatsApp sender-policy list at the runtime boundary.
 * Invalid rows are ignored, identifiers are trimmed and duplicate identifiers keep their first entry.
 * Wildcard access is always evaluated last, matching the manifest's documented first-match semantics. */
export function normalizeSenderPolicies(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const named = [];
  const wildcard = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const roleId = typeof item.roleId === 'string' ? item.roleId.trim() : '';
    if (!roleId || seen.has(roleId)) continue;
    seen.add(roleId);
    const policy = {
      ...item,
      roleId,
      ...(Object.hasOwn(item, 'name') ? { name: typeof item.name === 'string' ? item.name.trim() : '' } : {}),
      ...(Object.hasOwn(item, 'prompt') ? { prompt: typeof item.prompt === 'string' ? item.prompt : '' } : {}),
      ...(Object.hasOwn(item, 'admin') ? { admin: item.admin === true } : {}),
    };
    (roleId === '*' ? wildcard : named).push(policy);
  }
  return [...named, ...wildcard];
}

const BOOLEAN_DEFAULTS = {
  respondWithoutMention: true,
  streaming: true,
  deleteToolActivityAfterTurn: false,
  reactions: true,
  runtimeFooter: true,
  showReasoning: false,
};
const ENUM_DEFAULTS = { language: ['en', 'cs', 'sk'] };

export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const config = { ...source, senderPolicies: normalizeSenderPolicies(source.senderPolicies) };
  for (const [key, fallback] of Object.entries(BOOLEAN_DEFAULTS)) {
    if (source[key] !== undefined) config[key] = typeof source[key] === 'boolean' ? source[key] : fallback;
  }
  for (const [key, options] of Object.entries(ENUM_DEFAULTS)) {
    if (source[key] !== undefined) config[key] = typeof source[key] === 'string' && options.includes(source[key]) ? source[key] : options[0];
  }
  return config;
}
