/** The administrator's surface, as ONE contract: the shapes the plugin's own admin routes answer with and
 *  the browser page reads. Types only and deliberately dependency-free, so the bundle can import them the
 *  way the widget imports `publicContract` — a second copy of these shapes in `web-src/` is how a page ends
 *  up reading a field the server stopped sending.
 *
 *  Nothing here is a secret: the visitor token, the signing key and the turn's own internals never appear
 *  on this contract. What travels is an administrator's own configuration and aggregate counts. */
export {};
