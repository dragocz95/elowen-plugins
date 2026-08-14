/** A request-interception layer for the jsdom tests, in the shape the core repo gets from msw.
 *
 *  The host runtime talks to the daemon with plain `fetch`, which is exactly the seam msw intercepts —
 *  so replacing `globalThis.fetch` with a handler router puts the boundary in the same place, without
 *  pulling a service-worker library into a registry that has no other use for one.
 *
 *  Handlers match on METHOD + PATHNAME (the query string selects the target set, never the route), most
 *  recently registered first, so a test can override a default the way `server.use(...)` does. An
 *  unhandled request REJECTS rather than answering something plausible: a silently-invented response is
 *  how a UI test starts asserting on the mock.
 */

type Handler = (input: { request: Request; url: URL }) => Response | Promise<Response>;

interface Route { method: string; path: string; handler: Handler }

const routes: Route[] = [];
let realFetch: typeof globalThis.fetch | undefined;

const jsonResponse = (body: unknown, init: { status?: number } = {}) =>
  new Response(JSON.stringify(body), { status: init.status ?? 200, headers: { 'content-type': 'application/json' } });

export const http = {
  get: (path: string, handler: Handler): Route => ({ method: 'GET', path, handler }),
  post: (path: string, handler: Handler): Route => ({ method: 'POST', path, handler }),
  patch: (path: string, handler: Handler): Route => ({ method: 'PATCH', path, handler }),
  delete: (path: string, handler: Handler): Route => ({ method: 'DELETE', path, handler }),
};

export const HttpResponse = { json: jsonResponse };

/** Install the router (call once per file, in beforeAll). */
export function listen(): void {
  if (realFetch) return;
  realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(new URL(String(input), 'http://host'), init);
    const url = new URL(request.url);
    // Newest first: a per-test handler shadows a file-level default, exactly like msw's server.use().
    for (let i = routes.length - 1; i >= 0; i--) {
      const route = routes[i]!;
      if (route.method !== request.method) continue;
      if (url.pathname !== route.path) continue;
      return route.handler({ request, url });
    }
    // Logged as well as thrown: react-query swallows the rejection into `isError`, so the component
    // renders its error state and the test fails on a waitFor timeout that names the missing element
    // rather than the missing handler.
    const message = `unhandled request: ${request.method} ${url.pathname}${url.search}`;
    console.error(message);
    throw new Error(message);
  }) as typeof globalThis.fetch;
}

/** File-level defaults, kept across resetHandlers(). */
export function setDefaults(...defaults: Route[]): void {
  base.length = 0;
  base.push(...defaults);
  resetHandlers();
}

/** Per-test handlers, layered on top of the defaults. */
export function use(...added: Route[]): void {
  routes.push(...added);
}

const base: Route[] = [];

export function resetHandlers(): void {
  routes.length = 0;
  routes.push(...base);
}

export function close(): void {
  if (realFetch) globalThis.fetch = realFetch;
  realFetch = undefined;
  routes.length = 0;
  base.length = 0;
}
