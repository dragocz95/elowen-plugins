import type { PluginApiRequest, PluginHttpResponse } from 'elowen/plugin-api';
import type { Site, SitesStore, Visibility } from './store.js';
import { VISIBILITIES } from './store.js';
import { mayOpen, mintTicket, normalizeReturnPath, type AccessDeps } from './access.js';
import { SITE_BASE_PATH, siteUrl, type SitesConfig } from './config.js';

/** A person as this plugin's surfaces show them. Mirrored in web-src/runtime.ts, which cannot import
 *  from here: the browser bundle is a separate compile unit. */
export interface Person {
  id: number;
  username: string;
  name: string;
  /** Stored filename of an uploaded picture, empty when there is none. A presence flag for the host
   *  Avatar, which mints its own signed link from the id — never a path to build a URL from. */
  avatar: string;
}

export interface ApiDeps {
  store: SitesStore;
  access: AccessDeps;
  config(): SitesConfig;
  people(): Map<number, Person>;
  projectSlug(projectId: number): string | null;
  deleteSite(siteId: string): Promise<void> | void;
  activateRelease(site: Site, releaseId: string): void;
  runtimeState(siteId: string): { running: boolean; logTail: string };
  restartRuntime(site: Site): Promise<void>;
}

const json = (status: number, body: unknown): PluginHttpResponse => ({
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  body: body as object,
});

const TICKET_TTL_MS = 60_000;

/** Whether the caller may change this site. Viewing is a different question, answered by `mayOpen`. */
const canManage = (site: Site, auth: PluginApiRequest['auth']): boolean =>
  auth.admin || (auth.userId !== null && auth.userId === site.ownerUserId);

interface SiteView {
  id: string;
  slug: string;
  title: string;
  summary: string;
  visibility: Visibility;
  status: string;
  /** Null when this instance has no site hostname, so there is nowhere for the site to live. */
  url: string | null;
  basePath: string;
  projectId: number;
  projectSlug: string | null;
  ownerUserId: number;
  owner: Person;
  /** Which release is live, so a list of releases can say which one it is looking at. */
  currentReleaseId: string | null;
  createdAt: string;
  createdModel: string;
  lastPublishAt: string | null;
  lastPublishModel: string | null;
  spa: boolean;
  canManage: boolean;
}

const toView = (site: Site, deps: ApiDeps, auth: PluginApiRequest['auth']): SiteView => {
  const config = deps.config();
  return {
    id: site.id,
    slug: site.slug,
    title: site.title,
    summary: site.summary,
    visibility: site.visibility,
    status: site.status,
    url: siteUrl(config, site.slug),
    basePath: SITE_BASE_PATH,
    projectId: site.projectId,
    projectSlug: deps.projectSlug(site.projectId),
    ownerUserId: site.ownerUserId,
    currentReleaseId: site.currentReleaseId,
    owner: deps.people().get(site.ownerUserId)
      ?? { id: site.ownerUserId, username: `#${site.ownerUserId}`, name: `#${site.ownerUserId}`, avatar: '' },
    createdAt: site.createdAt,
    createdModel: site.createdModel,
    lastPublishAt: site.lastPublishAt,
    lastPublishModel: site.lastPublishModel,
    spa: site.spa,
    canManage: canManage(site, auth),
  };
};

/** Sites the caller may see listed.
 *
 *  Membership and Project visibility are listed; a site that is merely visible to every signed-in account
 *  is not, because listing those would turn one person's dashboard into everybody's menu. It stays
 *  reachable by its address, which is what that setting means. */
function visibleSites(deps: ApiDeps, auth: PluginApiRequest['auth']): { mine: Site[]; shared: Site[] } {
  const userId = auth.userId;
  if (userId === null) return { mine: [], shared: [] };
  const mine = deps.store.sitesOwnedBy(userId);
  const mineIds = new Set(mine.map((site) => site.id));

  const shared = new Map<string, Site>();
  for (const site of deps.store.sitesSharedWith(userId)) {
    if (!mineIds.has(site.id)) shared.set(site.id, site);
  }
  const projectIds = auth.accessibleProjects;
  const projectScoped = projectIds === null
    ? (auth.admin ? deps.store.allSites() : [])
    : deps.store.sitesInProjects(projectIds);
  for (const site of projectScoped) {
    if (mineIds.has(site.id) || shared.has(site.id)) continue;
    if (site.visibility === 'project' || auth.admin) shared.set(site.id, site);
  }
  return { mine, shared: [...shared.values()] };
}

export function createApiHandlers(deps: ApiDeps) {
  /** GET /plugins/sites/api/sites */
  const list = async (req: PluginApiRequest): Promise<PluginHttpResponse> => {
    const config = deps.config();
    const { mine, shared } = visibleSites(deps, req.auth);
    return json(200, {
      mine: mine.map((site) => toView(site, deps, req.auth)),
      shared: shared.map((site) => toView(site, deps, req.auth)),
      allowPublicSites: config.allowPublicSites,
    });
  };

  /** GET|PATCH|DELETE /plugins/sites/api/site/<id>[/…] */
  const site = async (req: PluginApiRequest): Promise<PluginHttpResponse> => {
    const segments = req.path.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
    const siteId = segments[0] ?? '';
    const action = segments[1] ?? '';
    const target = deps.store.siteById(siteId);
    if (!target) return json(404, { error: 'not found' });

    const viewer = { userId: req.auth.userId, admin: req.auth.admin };
    if (!canManage(target, req.auth) && !mayOpen(target, viewer, deps.store, deps.access)) {
      return json(404, { error: 'not found' });
    }

    if (req.method === 'GET' && action === '') {
      const people = deps.people();
      const since = new Date(Date.now() - 29 * 86400_000).toISOString().slice(0, 10);
      return json(200, {
        site: toView(target, deps, req.auth),
        // Only somebody who can EDIT the guest list may read it. A guest seeing the whole list learns
        // who else the owner shared with, which is the owner's business and not part of opening a page.
        members: !canManage(target, req.auth) ? [] : deps.store.memberIds(target.id).map((id) => people.get(id)
          ?? { id, username: `#${id}`, name: `#${id}`, avatar: '' }),
        releases: deps.store.releases(target.id),
        hits: deps.store.hits(target.id, since),
        sourceDir: canManage(target, req.auth) ? target.sourceDir : null,
        // The command and the log are operational detail about a process, so they go only to somebody
        // who can act on them; a guest sees whether the site is up and nothing else.
        runtime: target.runtime !== 'command' ? null : {
          running: deps.runtimeState(target.id).running,
          startCommand: canManage(target, req.auth) ? target.startCommand : null,
          logTail: canManage(target, req.auth) ? deps.runtimeState(target.id).logTail : null,
          lastError: canManage(target, req.auth) ? target.lastError : null,
        },
      });
    }

    if (!canManage(target, req.auth)) return json(403, { error: 'forbidden' });

    if (req.method === 'PATCH' && action === '') return patchSite(req, target);
    if (req.method === 'DELETE' && action === '') {
      await deps.deleteSite(target.id);
      return json(200, { ok: true });
    }
    if (req.method === 'POST' && action === 'members') {
      if (segments[2] === 'replace') return replaceMembers(req, target);
      return addMember(req, target);
    }
    if (req.method === 'DELETE' && action === 'members') {
      const userId = Number(segments[2]);
      if (!Number.isSafeInteger(userId)) return json(400, { error: 'invalid account' });
      deps.store.removeMember(target.id, userId);
      deps.store.bumpAccessGeneration(target.id);
      return json(200, { ok: true });
    }
    if (req.method === 'POST' && action === 'restart') {
      if (target.runtime !== 'command') return json(400, { error: 'this site has no runtime' });
      try {
        await deps.restartRuntime(target);
      } catch (error) {
        return json(502, { error: error instanceof Error ? error.message : 'the runtime did not start' });
      }
      return json(200, { ok: true });
    }
    if (req.method === 'POST' && action === 'rollback') {
      const body = await req.json<{ releaseId?: string }>().catch(() => ({} as { releaseId?: string }));
      const releaseId = typeof body.releaseId === 'string' ? body.releaseId : '';
      const release = deps.store.release(target.id, releaseId);
      if (!release) return json(404, { error: 'unknown release' });
      deps.activateRelease(target, release.id);
      return json(200, { ok: true });
    }
    return json(405, { error: 'method not allowed' });
  };

  const patchSite = async (req: PluginApiRequest, target: Site): Promise<PluginHttpResponse> => {
    const body = await req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    const patch: Parameters<SitesStore['updateSite']>[1] = {};
    let accessChanged = false;

    if (typeof body.title === 'string' && body.title.trim() !== '') patch.title = body.title.trim().slice(0, 120);
    if (typeof body.summary === 'string') patch.summary = body.summary.trim().slice(0, 400);
    if (typeof body.spa === 'boolean') patch.spa = body.spa;
    if (typeof body.visibility === 'string') {
      if (!(VISIBILITIES as readonly string[]).includes(body.visibility)) {
        return json(400, { error: 'unknown visibility' });
      }
      const next = body.visibility as Visibility;
      if (next === 'public' && !deps.config().allowPublicSites) {
        return json(403, { error: 'public sites are turned off for this instance' });
      }
      if (next !== target.visibility) {
        patch.visibility = next;
        accessChanged = true;
      }
    }
    deps.store.updateSite(target.id, patch);
    if (accessChanged) deps.store.bumpAccessGeneration(target.id);
    const updated = deps.store.siteById(target.id);
    return json(200, { site: updated ? toView(updated, deps, req.auth) : null });
  };

  const addMember = async (req: PluginApiRequest, target: Site): Promise<PluginHttpResponse> => {
    const body = await req.json<{ userId?: unknown }>().catch(() => ({} as { userId?: unknown }));
    const userId = Number(body.userId);
    if (!Number.isSafeInteger(userId) || !deps.access.accountExists(userId)) {
      return json(400, { error: 'unknown account' });
    }
    deps.store.addMember(target.id, userId);
    deps.store.bumpAccessGeneration(target.id);
    return json(200, { ok: true });
  };

  const replaceMembers = async (req: PluginApiRequest, target: Site): Promise<PluginHttpResponse> => {
    const body = await req.json<{ userIds?: unknown }>().catch(() => ({} as { userIds?: unknown }));
    if (!Array.isArray(body.userIds)) return json(400, { error: 'userIds must be an array' });
    const userIds = [...new Set(body.userIds.map(Number))];
    if (userIds.some((userId) => !Number.isSafeInteger(userId) || !deps.access.accountExists(userId))) {
      return json(400, { error: 'unknown account' });
    }
    deps.store.replaceMembers(target.id, userIds);
    return json(200, { ok: true, members: deps.store.memberIds(target.id) });
  };

  /** POST /plugins/sites/api/ticket — the app half of the sign-in handshake.
   *
   *  This is the ONE place a visitor's right to open a site is established, because it is the only place
   *  the daemon has already authenticated them. The ticket that comes back proves nothing beyond "this
   *  account asked"; the public side re-checks the decision before it admits anyone. */
  const ticket = async (req: PluginApiRequest): Promise<PluginHttpResponse> => {
    if (req.method !== 'POST') return json(405, { error: 'method not allowed' });
    const body = await req.json<{ slug?: unknown; r?: unknown }>().catch(() => ({} as { slug?: unknown; r?: unknown }));
    const slug = typeof body.slug === 'string' ? body.slug : '';
    const target = deps.store.siteBySlug(slug);
    const viewer = { userId: req.auth.userId, admin: req.auth.admin };
    if (!target || target.status !== 'live' || !mayOpen(target, viewer, deps.store, deps.access)) {
      // Deliberately the same answer for an unknown site and one this account may not open.
      return json(403, { error: 'no access' });
    }
    if (req.auth.userId === null) return json(403, { error: 'no access' });

    const address = siteUrl(deps.config(), target.slug);
    // No address means no gateway, and a ticket is only useful as a form post TO that address. Minting
    // one anyway would burn a single-use token against a form the page could not submit.
    if (address === null) return json(503, { error: 'published sites are not available on this instance' });

    const minted = mintTicket();
    deps.store.putTicket(minted.tokenHash, {
      siteId: target.id,
      userId: req.auth.userId,
      returnPath: normalizeReturnPath(body.r),
      expiresAt: Date.now() + TICKET_TTL_MS,
    });
    return json(200, {
      token: minted.token,
      action: `${address}__elowen/session`,
      title: target.title,
    });
  };

  /** GET /plugins/sites/api/directory — accounts that can be added as guests.
   *
   *  Core keeps its own account directory admin-only, so this returns the narrowest thing that makes the
   *  guest picker work — who someone is and what they look like, nothing else — and only to someone who
   *  actually owns a site to share. It is not a general account listing for every signed-in user. */
  const directory = async (req: PluginApiRequest): Promise<PluginHttpResponse> => {
    const userId = req.auth.userId;
    if (userId === null) return json(403, { error: 'forbidden' });
    if (!req.auth.admin && deps.store.countOwnedBy(userId) === 0) return json(403, { error: 'forbidden' });
    const accounts = [...deps.people().values()].sort((a, b) => a.name.localeCompare(b.name));
    return json(200, { accounts });
  };

  return { list, site, ticket, directory };
}
