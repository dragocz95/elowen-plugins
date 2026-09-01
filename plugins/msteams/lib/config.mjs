/** Normalize the ordered Microsoft Teams role-policy list at the runtime boundary.
 * Invalid rows are ignored, identifiers are trimmed and duplicate identifiers keep their first entry.
 * Wildcard, conversation and other broad policies remain in their stored order except that a wildcard is
 * moved last, matching the adapter's documented first-match semantics. */
export function normalizeRolePolicies(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const named = [];
  const wildcard = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const roleId = typeof item.roleId === 'string' ? item.roleId.trim() : '';
    if (!roleId) continue;
    const key = roleId.includes('@') ? roleId.toLowerCase() : roleId;
    if (seen.has(key)) continue;
    seen.add(key);
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
  accountLinking: false,
  ssoEnabled: false,
  ssoLinkByEmail: true,
  ssoDefaultYolo: false,
  graphLookup: false,
  respondWithoutMention: true,
  deleteToolActivityAfterTurn: false,
  reactions: true,
  runtimeFooter: true,
  showReasoning: false,
  channelMessagesRsc: false,
};
const ENUM_DEFAULTS = {
  ssoProvision: ['off', 'tenant'],
  m365AccessMode: ['read_only', 'read_write'],
  toolActivity: ['off', 'status', 'live'],
  answerMode: ['final', 'live'],
  toolOutput: ['hidden', 'summary', 'tail'],
  toolMessageMode: ['single', 'per_tool'],
  language: ['en', 'cs', 'sk'],
};

export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const config = { ...source, rolePolicies: normalizeRolePolicies(source.rolePolicies) };
  for (const [key, fallback] of Object.entries(BOOLEAN_DEFAULTS)) {
    if (source[key] !== undefined) config[key] = typeof source[key] === 'boolean' ? source[key] : fallback;
  }
  for (const [key, options] of Object.entries(ENUM_DEFAULTS)) {
    if (source[key] !== undefined) config[key] = typeof source[key] === 'string' && options.includes(source[key]) ? source[key] : options[0];
  }
  return config;
}
