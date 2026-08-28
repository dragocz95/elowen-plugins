import { existsSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { join, resolve, sep } from 'node:path';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import type { SitesContext } from './coreSeams.js';
import type { Site, SitesStore, Visibility } from './store.js';
import { VISIBILITIES } from './store.js';
import { mayPublish, type AccessDeps } from './access.js';
import { siteBasePath, siteUrl, type SitesConfig } from './config.js';
import { PublishError, pruneReleases, relativeAssetWarning, snapshotRelease } from './publish.js';
import { isDaemonProcess, type SiteRuntimeSupervisor } from './runtime.js';

export interface ToolDeps {
  ctx: SitesContext;
  store: SitesStore;
  access: AccessDeps;
  config(): SitesConfig;
  siteDir(siteId: string): string;
  releaseDir(siteId: string, releaseId: string): string;
  runtime: SiteRuntimeSupervisor;
}

/** A command runtime is only offered where it can be run honestly: the operator has to have turned it
 *  on, and sites must be on their own hostname. On the shared origin a published page is served with
 *  no scripts at all, because it would otherwise be same-origin with the app and its session — which
 *  makes "an application" a contradiction there rather than a limitation to warn about. */
function commandRuntimeRefusal(config: SitesConfig): string | null {
  if (!config.allowCommandRuntime) {
    return 'Site runtimes are turned off for this instance. An administrator can enable them in the plugin settings.';
  }
  if (config.siteHostBase === null) {
    return 'A site runtime needs sites to be served from their own hostname, because on the app\'s own origin a published page is not allowed to run scripts. Set a dedicated site hostname in the plugin settings first.';
  }
  return null;
}

const text = (body: string) => ({ content: [{ type: 'text' as const, text: body }], details: {} });

class ToolError extends Error {}

const modelLabel = (ctx: SitesContext): string => {
  const model = ctx.currentModel();
  if (!model) return '';
  return model.provider ? `${model.provider}/${model.model}` : model.model;
};

const ownerOf = (ctx: SitesContext): number => {
  const userId = ctx.currentContributionUserId() ?? ctx.currentIdentity()?.elowenUserId ?? null;
  if (userId === null) throw new ToolError('This turn is not acting as an Elowen account, so there is nobody to own a site.');
  return userId;
};

const slugify = (title: string): string => {
  const base = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/g, '');
  const stem = base.length >= 2 ? base : 'site';
  // A random suffix, always. A slug derived only from the title would let anyone probe which titles
  // other accounts have already published just by watching which names are refused.
  return `${stem}-${randomBytes(3).toString('hex')}`;
};

/** Where the agent should write this site's source.
 *
 *  The active Sandbox workspace comes first because it is a real Git worktree: the source is versioned,
 *  committable and publishable like anything else the agent is working on. The bound Project is the
 *  fallback. There is deliberately no third option — `defaultCwd()` answers with an arbitrary allowed
 *  root, or the daemon's own working directory, and neither is a place the caller chose. */
function resolveSourceRoot(ctx: SitesContext, slug: string): { dir: string; projectId: number } {
  const workDir = ctx.workDir();
  if (!workDir) {
    throw new ToolError('This conversation is not bound to a Project. Open a Project first, and create a Sandbox workspace if you want the site under version control.');
  }
  const real = (() => {
    try { return realpathSync(workDir); } catch { return workDir; }
  })();
  const project = ctx.host.stores().projects.list().find((entry) => {
    try { return realpathSync(entry.path) === real; } catch { return entry.path === workDir; }
  });
  if (!project) throw new ToolError('The current working directory does not belong to a registered Project.');

  const sessionId = ctx.currentSessionId();
  const workspace = sessionId
    ? ctx.control('sandbox')?.activeWorkspace({ sessionId, projectId: project.id }) ?? null
    : null;
  const base = workspace?.path ?? project.path;
  return { dir: join(base, 'sites', slug), projectId: project.id };
}

const requireOwned = (deps: ToolDeps, siteId: string, userId: number): Site => {
  const site = deps.store.siteById(siteId);
  if (!site || site.ownerUserId !== userId) throw new ToolError(`No site of yours has the id ${siteId}.`);
  return site;
};

const describe = (site: Site, config: SitesConfig): string => [
  `${site.title} (${site.slug})`,
  `  address    ${siteUrl(config, site.slug)}`,
  `  visibility ${site.visibility}`,
  `  status     ${site.status}`,
  site.lastPublishAt ? `  published  ${site.lastPublishAt}${site.lastPublishModel ? ` by ${site.lastPublishModel}` : ''}` : '  published  never',
  `  source     ${site.sourceDir}`,
].join('\n');

export function registerTools(deps: ToolDeps): void {
  const { ctx, store } = deps;

  const guardPublisher = (userId: number): void => {
    if (!mayPublish(userId, deps.access, deps.config().publishers)) {
      throw new ToolError('This account is not allowed to publish sites on this instance.');
    }
  };

  ctx.registerTool(defineTool({
    name: 'SiteCreate',
    label: 'Create a site',
    description: 'Reserve a published web address and get the folder to build it in. Returns the directory to write the project into, the absolute base path the build must be configured with, and the address the site will have once published. The site is not reachable until SitePublish runs. Build with your normal tools; this does not run any build for you.',
    parameters: Type.Object({
      title: Type.String({ minLength: 1, maxLength: 120, description: 'Human title shown in the Sites screen.' }),
      summary: Type.Optional(Type.String({ maxLength: 400, description: 'One line describing what the page is for.' })),
      visibility: Type.Optional(Type.Union(
        [Type.Literal('private'), Type.Literal('project'), Type.Literal('authenticated')],
        { description: 'Who may open it. Defaults to the instance setting. A site is never made public here; that is confirmed by a person in the Sites screen.' },
      )),
      spa: Type.Optional(Type.Boolean({ description: 'Serve index.html for unknown paths, for a client-side router. Default false.' })),
      runtime: Type.Optional(Type.Union(
        [Type.Literal('static'), Type.Literal('command')],
        { description: 'How the site answers. "static" serves the built files (the default, and the right choice for anything that can be prerendered). "command" keeps a server process running - Node, Bun, Python, PHP - and forwards requests to it. A runtime must be enabled by an administrator and needs a dedicated site hostname.' },
      )),
      startCommand: Type.Optional(Type.String({
        maxLength: 500,
        description: 'For runtime "command": the shell command that starts the server, run inside the published release. It must listen on the unix socket given in SOCKET_PATH, or on 127.0.0.1:$PORT when the site is port-bound.',
      })),
      bind: Type.Optional(Type.Union(
        [Type.Literal('socket'), Type.Literal('port')],
        { description: 'For runtime "command": "socket" (default) listens on a unix socket only this daemon can reach. "port" listens on a loopback port, which any process on the machine can reach directly, bypassing this site\'s access rules - use it only for a server that cannot take a socket, such as PHP\'s built-in one.' },
      )),
    }),
    execute: async (_id, input) => {
      try {
        const userId = ownerOf(ctx);
        guardPublisher(userId);
        const config = deps.config();
        if (store.countOwnedBy(userId) >= config.maxSitesPerAccount) {
          throw new ToolError(`This account already has ${config.maxSitesPerAccount} sites, which is the configured limit.`);
        }

        const runtime = (input.runtime as 'static' | 'command' | undefined) ?? 'static';
        const bind = (input.bind as 'socket' | 'port' | undefined) ?? 'socket';
        if (runtime === 'command') {
          const refusal = commandRuntimeRefusal(config);
          if (refusal) throw new ToolError(refusal);
          if (!input.startCommand?.trim()) throw new ToolError('A site runtime needs startCommand.');
        }

        let slug = slugify(input.title);
        while (store.slugTaken(slug)) slug = slugify(input.title);

        const { dir, projectId } = resolveSourceRoot(ctx, slug);
        let allowed: string;
        try {
          allowed = ctx.assertPathAllowed(dir);
        } catch {
          throw new ToolError(`The site folder ${dir} is outside what this account may write to.`);
        }
        if (existsSync(allowed)) throw new ToolError(`${allowed} already exists.`);
        mkdirSync(allowed, { recursive: true });

        const now = new Date().toISOString();
        const site: Site = {
          id: randomUUID(),
          slug,
          title: input.title.trim(),
          summary: (input.summary ?? '').trim(),
          projectId,
          ownerUserId: userId,
          visibility: (input.visibility as Visibility | undefined) ?? config.defaultVisibility,
          accessGeneration: 1,
          sourceDir: allowed,
          spa: input.spa === true,
          runtime,
          startCommand: (input.startCommand ?? '').trim(),
          bind,
          port: runtime === 'command' && bind === 'port' ? deps.runtime.allocatePort() : null,
          status: 'draft',
          currentReleaseId: null,
          createdAt: now,
          updatedAt: now,
          createdModel: modelLabel(ctx),
          lastPublishAt: null,
          lastPublishModel: null,
          lastError: null,
        };
        store.insertSite(site);

        return text([
          `Created "${site.title}".`,
          '',
          `Write the project here: ${allowed}`,
          `Configure the build with base path: ${siteBasePath(slug)}`,
          `It will be published at: ${siteUrl(config, slug)}`,
          '',
          'Asset URLs must be absolute under that base path. A relative reference (./assets/...) breaks, because the published address is a path prefix.',
          ...(runtime === 'command'
            ? [
              '',
              bind === 'socket'
                ? 'The server must listen on the unix socket path in SOCKET_PATH, not on a port.'
                : 'The server must listen on 127.0.0.1 and the port in PORT.',
              'Install dependencies in the site folder before publishing: the release is a copy, and nothing is built or installed for you.',
              'Requests are forwarded buffered - no streaming, no server-sent events, no websockets - and a request body is capped at 1 MB.',
            ]
            : []),
          'When the output is ready, call SitePublish with the output directory.',
        ].join('\n'));
      } catch (error) {
        return text(error instanceof ToolError ? error.message : `Could not create the site: ${String(error)}`);
      }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'SitePublish',
    label: 'Publish a site',
    description: 'Copy a finished build output into a new release and make it the live one. Build the project yourself first; this publishes what is already on disk and runs nothing. Files are copied, so the site keeps working even if the workspace is later removed.',
    parameters: Type.Object({
      siteId: Type.String({ description: 'Site id from SiteCreate or SiteList.' }),
      outputDir: Type.Optional(Type.String({ description: 'Build output directory, relative to the site folder (e.g. "dist"). Defaults to the site folder itself.' })),
      note: Type.Optional(Type.String({ maxLength: 200, description: 'Short note about what changed in this release.' })),
    }),
    execute: async (_id, input) => {
      try {
        const userId = ownerOf(ctx);
        guardPublisher(userId);
        const site = requireOwned(deps, input.siteId, userId);
        const config = deps.config();

        const relative = (input.outputDir ?? '').replace(/^\/+/, '');
        if (relative.split('/').some((segment) => segment === '..')) {
          throw new ToolError('outputDir must stay inside the site folder.');
        }
        const source = resolve(site.sourceDir, relative);
        const root = resolve(site.sourceDir);
        if (source !== root && !source.startsWith(root + sep)) {
          throw new ToolError('outputDir must stay inside the site folder.');
        }
        if (!existsSync(source)) throw new ToolError(`${source} does not exist. Build the project first.`);
        ctx.assertPathAllowed(source);

        const releaseId = randomUUID();
        const target = deps.releaseDir(site.id, releaseId);
        let snapshot;
        try {
          snapshot = snapshotRelease(source, target, {
            maxAssetBytes: config.maxAssetBytes,
            maxTotalBytes: config.maxSiteBytes,
            mode: site.runtime,
          });
        } catch (error) {
          rmSync(target, { recursive: true, force: true });
          store.updateSite(site.id, { status: site.currentReleaseId ? 'live' : 'failed', lastError: error instanceof Error ? error.message : String(error) });
          throw new ToolError(error instanceof PublishError ? `Publish refused: ${error.message}` : `Publish failed: ${String(error)}`);
        }

        const model = modelLabel(ctx);
        const now = new Date().toISOString();
        store.transaction(() => {
          store.insertRelease({
            id: releaseId,
            siteId: site.id,
            createdAt: now,
            model,
            fileCount: snapshot.fileCount,
            sizeBytes: snapshot.sizeBytes,
            note: (input.note ?? '').trim().slice(0, 200),
          });
          store.updateSite(site.id, {
            status: 'live',
            currentReleaseId: releaseId,
            lastPublishAt: now,
            lastPublishModel: model,
            lastError: null,
          });
        });
        const warnings = [...snapshot.warnings];

        if (site.runtime === 'command') {
          const refusal = commandRuntimeRefusal(config);
          if (refusal) {
            store.updateSite(site.id, { status: 'failed', lastError: refusal });
            throw new ToolError(refusal);
          }
          // The new release is already the current one, so restarting picks it up. A failure leaves the
          // site marked failed with the runtime's own output rather than a live address serving nothing.
          try {
            if (isDaemonProcess()) {
              await deps.runtime.stop(site.id);
              const started = store.siteById(site.id);
              if (started) await deps.runtime.start(started);
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            store.updateSite(site.id, { status: 'failed', lastError: message });
            throw new ToolError(`Published, but the runtime did not start: ${message}`);
          }
        }

        pruneReleases(store, site.id, deps.siteDir(site.id), config.releasesKept, releaseId);

        if (site.runtime === 'static') {
          const relativeWarning = relativeAssetWarning(target, siteBasePath(site.slug));
          if (relativeWarning) warnings.push(relativeWarning);
        }

        return text([
          `Published "${site.title}" - ${snapshot.fileCount} files, ${(snapshot.sizeBytes / 1048576).toFixed(2)} MB.`,
          `Live at ${siteUrl(config, site.slug)}`,
          `Visible to: ${site.visibility}`,
          ...(site.runtime === 'command' && !isDaemonProcess()
            ? ['The daemon starts the runtime shortly; check SiteLogs if the address does not answer.']
            : []),
          ...(warnings.length > 0 ? ['', 'Warnings:', ...warnings.map((line) => `  - ${line}`)] : []),
        ].join('\n'));
      } catch (error) {
        return text(error instanceof ToolError ? error.message : `Could not publish: ${String(error)}`);
      }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'SiteList',
    label: 'List sites',
    description: 'List the sites this account owns, with their address, visibility and publish state.',
    parameters: Type.Object({}),
    execute: async () => {
      try {
        const userId = ownerOf(ctx);
        const config = deps.config();
        const sites = store.sitesOwnedBy(userId);
        if (sites.length === 0) return text('This account has no sites yet.');
        return text(sites.map((site) => describe(site, config)).join('\n\n'));
      } catch (error) {
        return text(error instanceof ToolError ? error.message : String(error));
      }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'SiteGet',
    label: 'Read a site',
    description: 'Full detail of one site: address, base path for the build, source folder, visibility, guests and release history.',
    parameters: Type.Object({ siteId: Type.String() }),
    execute: async (_id, input) => {
      try {
        const userId = ownerOf(ctx);
        const site = requireOwned(deps, input.siteId, userId);
        const config = deps.config();
        const releases = store.releases(site.id);
        const guests = store.memberIds(site.id);
        return text([
          describe(site, config),
          `  base path  ${siteBasePath(site.slug)}`,
          `  guests     ${guests.length === 0 ? 'none' : guests.map((id) => `#${id}`).join(', ')}`,
          '',
          releases.length === 0
            ? 'No releases yet.'
            : ['Releases:', ...releases.map((release) => `  ${release.id}  ${release.createdAt}  ${release.fileCount} files  ${(release.sizeBytes / 1048576).toFixed(2)} MB${release.note ? `  ${release.note}` : ''}`)].join('\n'),
          site.lastError ? `\nLast error: ${site.lastError}` : '',
        ].join('\n'));
      } catch (error) {
        return text(error instanceof ToolError ? error.message : String(error));
      }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'SiteUpdate',
    label: 'Update a site',
    description: 'Change a site\'s title, summary, router behaviour or visibility. Visibility cannot be set to public here: making a site readable by anyone is confirmed by a person in the Sites screen.',
    parameters: Type.Object({
      siteId: Type.String(),
      title: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
      summary: Type.Optional(Type.String({ maxLength: 400 })),
      spa: Type.Optional(Type.Boolean()),
      visibility: Type.Optional(Type.Union(
        [Type.Literal('private'), Type.Literal('project'), Type.Literal('authenticated')],
      )),
    }),
    execute: async (_id, input) => {
      try {
        const userId = ownerOf(ctx);
        const site = requireOwned(deps, input.siteId, userId);
        const patch: Parameters<SitesStore['updateSite']>[1] = {};
        if (input.title !== undefined) patch.title = input.title.trim();
        if (input.summary !== undefined) patch.summary = input.summary.trim();
        if (input.spa !== undefined) patch.spa = input.spa;
        const nextVisibility = input.visibility as Visibility | undefined;
        if (nextVisibility !== undefined && !(VISIBILITIES as readonly string[]).includes(nextVisibility)) {
          throw new ToolError('Unknown visibility.');
        }
        const accessChanged = nextVisibility !== undefined && nextVisibility !== site.visibility;
        if (accessChanged) patch.visibility = nextVisibility;
        store.updateSite(site.id, patch);
        if (accessChanged) store.bumpAccessGeneration(site.id);
        const updated = store.siteById(site.id);
        return text(updated ? `Updated.\n\n${describe(updated, deps.config())}` : 'Updated.');
      } catch (error) {
        return text(error instanceof ToolError ? error.message : String(error));
      }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'SiteRollback',
    label: 'Roll back a site',
    description: 'Make an earlier release the live one again. The release must still be retained.',
    parameters: Type.Object({ siteId: Type.String(), releaseId: Type.String() }),
    execute: async (_id, input) => {
      try {
        const userId = ownerOf(ctx);
        const site = requireOwned(deps, input.siteId, userId);
        const release = store.release(site.id, input.releaseId);
        if (!release) throw new ToolError('That release is not retained for this site.');
        store.updateSite(site.id, { currentReleaseId: release.id, status: 'live', lastError: null });
        return text(`"${site.title}" now serves the release from ${release.createdAt}.`);
      } catch (error) {
        return text(error instanceof ToolError ? error.message : String(error));
      }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'SiteLogs',
    label: 'Read a site runtime log',
    description: 'The recent output of a site runtime, which is where a server that refuses to start says why. Static sites have no runtime and no log.',
    parameters: Type.Object({ siteId: Type.String() }),
    execute: async (_id, input) => {
      try {
        const userId = ownerOf(ctx);
        const site = requireOwned(deps, input.siteId, userId);
        if (site.runtime !== 'command') return text('This is a static site, so it has no runtime log.');
        const tail = deps.runtime.logTail(site.id);
        const state = deps.runtime.isRunning(site.id) ? 'running' : 'not running';
        return text([
          `"${site.title}" is ${state}.`,
          site.lastError ? `Last error: ${site.lastError}` : '',
          '',
          tail || '(no output recorded)',
        ].join('\n'));
      } catch (error) {
        return text(error instanceof ToolError ? error.message : String(error));
      }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'SiteDelete',
    label: 'Delete a site',
    description: 'Remove a site: the address stops working and every release is deleted. The source folder in the Project is left untouched.',
    parameters: Type.Object({ siteId: Type.String() }),
    execute: async (_id, input) => {
      try {
        const userId = ownerOf(ctx);
        const site = requireOwned(deps, input.siteId, userId);
        // Stop first: removing the release under a running process would leave it serving from a
        // deleted directory at an address the store no longer knows about.
        if (isDaemonProcess()) await deps.runtime.stop(site.id);
        rmSync(deps.siteDir(site.id), { recursive: true, force: true });
        store.deleteSite(site.id);
        return text(`Deleted "${site.title}". Its source folder ${site.sourceDir} was left in place.`);
      } catch (error) {
        return text(error instanceof ToolError ? error.message : String(error));
      }
    },
  }));
}
