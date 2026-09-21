/** The administrator's surface, as ONE contract: the shapes the plugin's own admin routes answer with and
 *  the browser page reads. Types only, and its sole dependency is the plugin's own limit table — because the
 *  limits a chatbot carries ARE the server's numbers, and a page that declared them for itself would be free
 *  to read a field the server stopped sending.
 *
 *  Nothing here is a secret: the visitor token, the signing key and the turn's own internals never appear
 *  on this contract. What travels is an administrator's own configuration and aggregate counts. */
/** How long one action rule's path prefix may be. */
export const ACTION_PATH_PREFIX_MAX_CHARS = 200;
/** The one reading of a rule's path prefix, shared by the page's editor and the server that enforces it.
 *
 *  A prefix is a path SEGMENT prefix (see `actionRules.covers`), so it starts at the root exactly once and
 *  never carries a query, a fragment, a space or an empty segment: every run of slashes collapses to one,
 *  and a trailing slash goes, except for the root itself. Returns null when the text cannot be a path.
 *
 *  This lives on the contract rather than twice over because the two readings must not be able to disagree:
 *  the editor's field opens with `/`, and a reader who types their path without clearing it would otherwise
 *  store a prefix that matches no request while looking like one that does. */
export function normalizeActionPathPrefix(raw) {
    const value = raw.trim();
    if (value === '' || !value.startsWith('/'))
        return null;
    if (value.includes('?') || value.includes('#') || /\s/.test(value))
        return null;
    const collapsed = value.replace(/\/+/g, '/').replace(/(.)\/$/, '$1');
    return collapsed.length > ACTION_PATH_PREFIX_MAX_CHARS ? null : collapsed;
}
