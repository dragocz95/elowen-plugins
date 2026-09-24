/** The administrator's surface, as ONE contract: the shapes the plugin's own admin routes answer with and
 *  the browser page reads. Types only, and its sole dependency is the plugin's own limit table — because the
 *  limits a chatbot carries ARE the server's numbers, and a page that declared them for itself would be free
 *  to read a field the server stopped sending.
 *
 *  Nothing here is a secret: the visitor token, the signing key and the turn's own internals never appear
 *  on this contract. What travels is an administrator's own configuration and aggregate counts. */
export const DISPLAY_NAME_MAX_CHARS = 80;
export const STATS_MAX_DAYS = 366;
export const DAY_MS = 86_400_000;
export const TABLE_MOBILE_HIDDEN = '@max-[40rem]:hidden';
/** Shows an element only on a phone-width table, where the host DataTable switches to its mobile columns.
 *  A static literal beside {@link TABLE_MOBILE_HIDDEN}, never built dynamically: Tailwind only generates
 *  classes it can read in the source. */
export const TABLE_PHONE_ONLY = '@min-[40rem]:hidden';
/** The columns the conversations register can be ordered by: the route validates a request against this
 *  list and the page's sortable headers name exactly these. */
export const CHATBOT_CONVERSATION_SORTS = ['title', 'ip', 'lastAt', 'turns', 'lastStatus'];
