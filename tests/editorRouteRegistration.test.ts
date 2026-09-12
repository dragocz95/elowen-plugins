// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { PluginRegistry } from 'elowen/dist/plugins/registry.js';
import type { PluginContext, PluginApiRequest, PluginApiRoute } from 'elowen/dist/plugins/api.js';
import { registerEditorApi } from '../plugins/editor/src/api.js';
import manifest from '../plugins/editor/elowen-plugin.json' with { type: 'json' };

/** The editor answers on the daemon's ROOT router, not under `/plugins/editor/api/`.
 *
 *  That distinction has cost a live debugging session: `GET /plugins/editor/api/projects/2/files`
 *  answers 404 while the plugin is loaded and healthy, because the namespaced dispatcher resolves a
 *  path against the routes a plugin registered WITHOUT `rootMount`, and the editor registers none. The
 *  live URL is `GET /projects/2/files?root=project`.
 *
 *  This suite drives the two contracts that stand between a loaded plugin and a served request, using
 *  core's own code for both: the declaration check that decides whether a mount registers at all, and
 *  `PluginRegistry.rootApiRoute`, the resolver the daemon's root dispatcher calls per request. A mount
 *  the manifest forgets, or a path the resolver hands a different remainder, is a 404 on a plugin that
 *  reports itself healthy — which is indistinguishable, from the browser, from an empty project. */

const declared: string[] = (manifest as { provides: { apiRoutes: string[] } }).provides.apiRoutes;

interface RootRouteEntry { plugin: string; routes: { method?: string; access: string; handler: PluginApiRoute['handler'] }[] }

/** Registration as core performs it: a root mount must be an absolute lowercase path whose segments are
 *  literals or `:param`, and the FULL mount must be declared in `provides.apiRoutes` — core refuses it
 *  with a warning otherwise, and the route simply never exists. */
function registerThroughCore(): { routes: Map<string, RootRouteEntry>; refused: string[] } {
  const routes = new Map<string, RootRouteEntry>();
  const refused: string[] = [];
  const segsOk = (mount: string) => mount.startsWith('/') && mount.slice(1).split('/').every((seg) =>
    /^[a-z0-9][a-z0-9-]*$/.test(seg) || /^:[a-zA-Z][a-zA-Z0-9]*$/.test(seg));
  const ctx = {
    host: { projectFiles: () => ({ safe: () => { throw new Error('host filesystem must not be used'); } }), stores: () => ({ projects: { get: () => null } }) },
    control: () => null,
    registerApiRoute: (route: PluginApiRoute & { rootMount?: string }) => {
      const clean = route.path?.trim().replace(/^\/+|\/+$/g, '') ?? '';
      const mount = (route.rootMount ?? '').trim().replace(/\/+$/g, '');
      if (!segsOk(mount)) { refused.push(`segments ${mount}`); return; }
      const full = clean ? `${mount}/${clean}` : mount;
      if (!declared.includes(full)) { refused.push(`undeclared ${full}`); return; }
      const entry = routes.get(full) ?? { plugin: 'editor', routes: [] };
      entry.routes.push({ ...(route.method ? { method: route.method.toUpperCase() } : {}), access: route.access, handler: route.handler });
      routes.set(full, entry);
    },
  } as unknown as PluginContext;
  registerEditorApi(ctx);
  return { routes, refused };
}

/** Core's own resolver, run against the mounts the plugin actually registered. It reads nothing but
 *  `rootApiRoutes`, so the real method is called on a seeded shape rather than reimplemented here. */
function resolve(routes: Map<string, RootRouteEntry>, path: string, method: string) {
  return (PluginRegistry.prototype as unknown as {
    rootApiRoute(this: { rootApiRoutes: Map<string, RootRouteEntry> }, path: string, method: string):
      { mount: string; remainder: string; params: Record<string, string>; handler: PluginApiRoute['handler'] } | undefined;
  }).rootApiRoute.call({ rootApiRoutes: routes }, path, method);
}

describe('editor route registration', () => {
  it('registers every mount it declares, and declares every mount it registers', () => {
    const { routes, refused } = registerThroughCore();
    expect(refused).toEqual([]);
    expect([...routes.keys()].sort()).toEqual([...declared].sort());
  });

  it.each([
    ['/projects/2/files', 'GET', '/projects/:id/files'],
    ['/projects/2/file', 'GET', '/projects/:id/file'],
    ['/projects/2/file', 'PUT', '/projects/:id/file'],
    ['/projects/2/raw', 'GET', '/projects/:id/raw'],
    ['/projects/2/upload', 'PUT', '/projects/:id/upload'],
    ['/projects/2/entry', 'DELETE', '/projects/:id/entry'],
    ['/projects/2/office-preview', 'GET', '/projects/:id/office-preview'],
    ['/projects/2/commit/abc123/diff', 'GET', '/projects/:id/commit/:hash/diff'],
  ])('resolves the live URL %s %s to %s with an empty remainder', (path, method, mount) => {
    const { routes } = registerThroughCore();
    const match = resolve(routes, path, method);
    expect(match?.mount).toBe(mount);
    // The handler refuses anything but the mount itself, so the remainder core hands it must be ''.
    expect(match?.remainder).toBe('');
    expect(match?.params.id).toBe('2');
  });

  // The namespaced surface is a different dispatcher: it looks up routes registered WITHOUT rootMount,
  // of which the editor has none. Asking there is the 404 that looks like a broken plugin.
  it('registers nothing on the namespaced /plugins/editor/api surface', () => {
    const { routes } = registerThroughCore();
    expect([...routes.keys()].every((mount) => mount.startsWith('/projects/'))).toBe(true);
    expect(resolve(routes, '/plugins/editor/api/projects/2/files', 'GET')).toBeUndefined();
  });
});

/** The listing a real managed project answers with, end to end: core's resolver picks the handler for
 *  the live URL, and the handler walks the project's own guest root. */
describe('the live listing of a managed project', () => {
  const SLUG = 'sdilene';
  const ROOT = `/${SLUG}`;
  /** The DIRECT children of the real project root, which is all one request reads: 64 entries, a mix of
   *  files and directories, plus a staging leftover expected to be absent from the answer. */
  const entries = [
    ...['README.md', 'package.json', 'tsconfig.json', '.env.example'].map((name) => ({ path: `${ROOT}/${name}`, kind: 'file' as const, size: 128, mtime: 0 })),
    ...Array.from({ length: 52 }, (_, i) => ({ path: `${ROOT}/module-${i}.ts`, kind: 'file' as const, size: 512, mtime: 0 })),
    ...Array.from({ length: 8 }, (_, i) => ({ path: `${ROOT}/dir-${i}`, kind: 'directory' as const, size: 0, mtime: 0 })),
    { path: `${ROOT}/.env.local.elowen-upload`, kind: 'file' as const, size: 1, mtime: 0 },
  ];

  function serve(root: string, query: Record<string, string> = {}) {
    const { routes } = registerThroughCore();
    const match = resolve(routes, '/projects/2/files', 'GET');
    if (!match) throw new Error('the live URL resolved to no route');
    const operations: { kind: string; path?: string }[] = [];
    const provider = {
      projectFiles: async ({ operation }: { operation: { kind: string; path: string } }) => {
        operations.push(operation);
        if (operation.kind !== 'walk') return { kind: operation.kind };
        return { kind: 'walk', root: operation.path, rootKind: 'directory', truncated: false, entries };
      },
    };
    // Registered again with a live project row and provider, then invoked through the handler core
    // resolved above — the resolution and the execution are the same route.
    const live = {
      host: {
        projectFiles: () => ({ safe: () => { throw new Error('host filesystem must not be used'); } }),
        stores: () => ({ projects: { get: () => ({ id: 2, slug: SLUG, path: '', executionKind: 'managed' }) } }),
      },
      control: () => provider,
      registerApiRoute: () => undefined,
    } as unknown as PluginContext;
    const handlers: PluginApiRoute[] = [];
    registerEditorApi({ ...live, registerApiRoute: (r: PluginApiRoute) => handlers.push(r) } as unknown as PluginContext);
    const handler = handlers.find((r) => (r as { rootMount?: string }).rootMount === match.mount && r.method === 'GET')!;
    return {
      operations,
      response: handler.handler({
        path: match.remainder, params: match.params, query: { ...query, ...(root ? { root } : {}) },
        headers: {}, auth: { admin: false, accessibleProjects: [2], userId: 11 },
        json: async () => ({}), body: async () => Buffer.alloc(0),
      } as unknown as PluginApiRequest),
    };
  }

  it('answers the project tree from the slug-derived guest root', async () => {
    const call = serve('project');
    const body = (await call.response).body as { path: string; type: string }[];
    expect(call.operations[0]).toMatchObject({ kind: 'walk', path: ROOT });
    expect(Array.isArray(body)).toBe(true);
    // The regression this exists for: a non-empty environment must not answer with an empty tree.
    expect(body.length).toBeGreaterThan(50);
    expect(body.map((node) => node.path)).toContain('README.md');
    expect(body.map((node) => node.path)).toContain('dir-7');
    // One level: nothing the answer carries lies below the root that was asked for.
    expect(body.every((node) => !node.path.includes('/'))).toBe(true);
    // Staging leftovers stay out, and every path is relative to the root that was asked for.
    expect(body.some((node) => node.path.endsWith('.elowen-upload'))).toBe(false);
    expect(body.every((node) => !node.path.startsWith('/'))).toBe(true);
  });

  it('answers the same request with no root named, because project is the default', async () => {
    const call = serve('');
    const body = (await call.response).body as { path: string }[];
    expect(call.operations[0]).toMatchObject({ kind: 'walk', path: ROOT });
    expect(body.length).toBeGreaterThan(50);
  });
});
