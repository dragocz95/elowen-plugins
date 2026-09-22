/** The administrator's surface, as ONE contract: the shapes the plugin's own admin routes answer with and
 *  the browser page reads. Types only, and its sole dependency is the plugin's own limit table — because the
 *  limits a chatbot carries ARE the server's numbers, and a page that declared them for itself would be free
 *  to read a field the server stopped sending.
 *
 *  Nothing here is a secret: the visitor token, the signing key and the turn's own internals never appear
 *  on this contract. What travels is an administrator's own configuration and aggregate counts. */
export const DISPLAY_NAME_MAX_CHARS = 80;
