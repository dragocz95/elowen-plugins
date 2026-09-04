import { existsSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { join, resolve, sep } from 'node:path';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import type { SitesContext } from './coreSeams.js';
import type { Site, SitesStore, Visibility } from './store.js';
import { VISIBILITIES } from './store.js';
import { mayPublish, type AccessDeps } from './access.js';
import { SITE_BASE_PATH, siteUrl, type SitesConfig } from './config.js';
import { PublishError, pruneReleases, relativeAssetWarning, snapshotRelease } from './publish.js';
import { isDaemonProcess, type SiteRuntimeSupervisor } from './runtime.js';

export interface ToolDeps {
  ctx: SitesContext;
  store: SitesStore;
  access: AccessDeps;
  config(): SitesConfig;
  people(): Map<number, { id: number; username: string; name: string; avatar: string }>;
  siteDir(siteId: string): string;
  releaseDir(siteId: string, releaseId: string): string;
  deleteSite(siteId: string): Promise<void>;
  runtime: SiteRuntimeSupervisor;
}

/** A command runtime is only offered where the operator has turned it on. */
function commandRuntimeRefusal(config: SitesConfig): string | null {
  if (!config.allowCommandRuntime) {
    return 'Site runtimes are turned off for this instance. An administrator can enable them in the plugin settings.';
  }
  return null;
}

const text = (body: string, details: Record<string, unknown> = {}) =>
  ({ content: [{ type: 'text' as const, text: body }], details });

/** Thrown, never returned. A tool that hands a refusal back as ordinary text is recorded as a
 *  SUCCESSFUL call, so the model reads "No site of yours has the id X" as an answer rather than a
 *  failure and tries another guess. The host turns a throw into an error result. */
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
  // The DEEPEST Project containing the working directory, not one whose root happens to equal it.
  // Agents work from subdirectories constantly, and exact equality refused every one of them with a
  // message that read as "you are nowhere" while standing well inside a registered Project.
  const within = (root: string): boolean => {
    const base = (() => { try { return realpathSync(root); } catch { return root; } })();
    return real === base || real.startsWith(base.endsWith(sep) ? base : base + sep);
  };
  const project = ctx.host.stores().projects.list()
    .filter((entry) => within(entry.path))
    .sort((a, b) => b.path.length - a.path.length)[0];
  if (!project) {
    throw new ToolError(`${real} is not inside any registered Project, so there is nowhere to put the site's source. Open a Project first.`);
  }

  const sessionId = ctx.currentSessionId();
  const workspace = sessionId
    ? ctx.control('sandbox')?.activeWorkspace({ sessionId, projectId: project.id }) ?? null
    : null;
  const base = workspace?.path ?? project.path;
  return { dir: join(base, 'sites', slug), projectId: project.id };
}

/** Resolve whichever identifier the caller had to hand.
 *
 *  The slug is the only identifier that appears in the address and in every listing, so it is the one an
 *  agent naturally reaches for; accepting the internal id alone made the id a secret the tools never
 *  disclosed, and publishing was unreachable because of it. Both are unique, so accepting both is
 *  unambiguous rather than lenient. */
const requireOwned = (deps: ToolDeps, ref: string, userId: number): Site => {
  const wanted = ref.trim();
  const site = deps.store.siteById(wanted) ?? deps.store.siteBySlug(wanted);
  if (!site || site.ownerUserId !== userId) {
    const owned = deps.store.sitesOwnedBy(userId);
    const known = owned.length === 0
      ? 'This account has no sites yet - create one with SiteCreate.'
      : `This account's sites are: ${owned.map((entry) => `${entry.slug} (id ${entry.id})`).join(', ')}.`;
    throw new ToolError(`No site of yours matches "${wanted}". Give either the slug or the id. ${known}`);
  }
  return site;
};

/** Resolve a person by account name or numeric id, for the sharing tools. */
const requirePerson = (deps: ToolDeps, ref: string): { id: number; name: string } => {
  const wanted = ref.trim();
  const people = [...deps.people().values()];
  const numeric = Number(wanted);
  const match = people.find((person) => person.id === numeric)
    ?? people.find((person) => person.username.toLowerCase() === wanted.toLowerCase())
    ?? people.find((person) => person.name.toLowerCase() === wanted.toLowerCase());
  if (!match) {
    throw new ToolError(`No account matches "${wanted}". Known accounts: ${people.map((person) => person.username).join(', ')}.`);
  }
  return { id: match.id, name: match.name || match.username };
};

/** The site's public address, or a refusal.
 *
 *  A null base means this instance has no HTTPS domain of its own, and published sites have no second
 *  place to live: a page on the app's own origin would be same-origin with the app's session cookie. */
const addressOf = (config: SitesConfig, slug: string): string => {
  const url = siteUrl(config, slug);
  if (url === null) {
    throw new ToolError('Published sites need this Elowen instance to be installed on its own HTTPS domain, because every site is served from its own hostname under that domain. There is no address to publish to here.');
  }
  return url;
};

const describe = (site: Site, config: SitesConfig): string => [
  `${site.title}`,
  `  id         ${site.id}`,
  `  slug       ${site.slug}   (either identifier works wherever a site is named)`,
  `  address    ${addressOf(config, site.slug)}`,
  `  visibility ${site.visibility}`,
  `  status     ${site.status}`,
  ...(site.runtime === 'command' ? [`  runtime    ${site.bind}${site.port === null ? '' : ` 127.0.0.1:${site.port}`} · ${config.runtimeNetwork} network`] : []),
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
        [Type.Literal('static'), Type.Literal('command'), Type.Literal('php')],
        { description: 'How the site answers. "static" serves built files (the default). "command" keeps a Node, Bun, Python or TypeScript HTTP process on the secure SOCKET_PATH or an explicitly enabled loopback port. "php" executes .php files through PHP-CGI per request. Active runtimes require administrator enablement.' },
      )),
      startCommand: Type.Optional(Type.String({
        maxLength: 500,
        description: 'For runtime "command": the shell command that starts the server inside the published release. Socket mode reads SOCKET_PATH; explicitly enabled port mode reads HOST and PORT. PHP sites do not take a start command.',
      })),
      bind: Type.Optional(Type.Union(
        [Type.Literal('socket'), Type.Literal('port')],
        { description: 'For runtime "command": listen on the secure pathname socket (default), or on an administrator-enabled loopback HOST/PORT for frameworks that do not support sockets.' },
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

        const runtime = (input.runtime as 'static' | 'command' | 'php' | undefined) ?? 'static';
        if (runtime !== 'static') {
          const refusal = commandRuntimeRefusal(config);
          if (refusal) throw new ToolError(refusal);
        }
        if (runtime === 'command' && !input.startCommand?.trim()) {
          throw new ToolError('A command site runtime needs startCommand.');
        }
        if (runtime === 'php' && input.startCommand?.trim()) {
          throw new ToolError('A PHP site runs through PHP-CGI and does not take startCommand.');
        }
        const bind = input.bind === 'port' ? 'port' : 'socket';
        if (runtime !== 'command' && input.bind !== undefined) {
          throw new ToolError('Only a command site has a runtime bind mode.');
        }
        if (bind === 'port' && !config.allowLoopbackPorts) {
          throw new ToolError('Loopback ports are turned off for this instance. Use socket mode or ask an administrator to enable them.');
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
        const port = runtime === 'command' && bind === 'port' ? await deps.runtime.allocatePort() : null;
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
          port,
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
          `  id   ${site.id}`,
          `  slug ${site.slug}`,
          'Name the site by either of those in SitePublish, SiteShare and the rest.',
          '',
          `Write the project here: ${allowed}`,
          'For an isolated Git worktree, create and activate a Sandbox workspace before SiteCreate; Sites automatically uses the active workspace.',
          `Configure the build with base path: ${SITE_BASE_PATH}`,
          `It will be published at: ${addressOf(config, slug)}`,
          '',
          'Asset URLs must be absolute. A relative reference (./assets/...) resolves against whatever address the visitor opened, so it works at the root and breaks on every deeper route.',
          ...(runtime === 'command'
            ? [
              '',
              ...(bind === 'socket'
                ? ['Bind the HTTP server directly to the pathname in SOCKET_PATH; this is the secure multi-user default.']
                : [`Bind the HTTP server to HOST and PORT. This site currently owns 127.0.0.1:${port}.`]),
              'Use the normal Files, Terminal and Sandbox tools here: install dependencies, test and build before publishing. Sites does not run a second build pipeline.',
              'A root .env file in the published command output is loaded into the runtime environment and must not be committed to Git.',
              config.runtimeNetwork === 'shared'
                ? 'The runtime has ordinary outbound network access. Requests are still buffered and a request body is capped at 1 MB.'
                : 'The runtime network is isolated by instance policy. Requests are buffered and a request body is capped at 1 MB.',
            ]
            : runtime === 'php'
              ? [
                '',
                'Put index.php (and any routed PHP scripts) in the published output. PHP-CGI runs one confined process per request; there is no long-running PHP server or loopback port.',
              ]
              : []),
          'When the output is ready, call SitePublish with the output directory.',
        ].join('\n'), {
          siteId: site.id, slug: site.slug, sourceDir: allowed,
          basePath: SITE_BASE_PATH, url: addressOf(config, slug), visibility: site.visibility,
          runtime: site.runtime, bind: site.bind, port: site.port,
        });
      } catch (error) {
        throw error instanceof ToolError ? error : new Error(`Could not create the site: ${String(error)}`);
      }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'SitePublish',
    label: 'Publish a site',
    description: 'Copy a finished build output into a new release and make it the live one. Build the project yourself first; this publishes what is already on disk and runs nothing. Files are copied, so the site keeps working even if the workspace is later removed.',
    parameters: Type.Object({
      site: Type.String({ description: 'Which site: its slug (as shown in the address and in SiteList) or its id. Both work.' }),
      outputDir: Type.Optional(Type.String({ description: 'Build output directory, relative to the site folder (e.g. "dist"). Defaults to the site folder itself.' })),
      note: Type.Optional(Type.String({ maxLength: 200, description: 'Short note about what changed in this release.' })),
    }),
    execute: async (_id, input) => {
      try {
        const userId = ownerOf(ctx);
        guardPublisher(userId);
        const site = requireOwned(deps, input.site, userId);
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
          const relativeWarning = relativeAssetWarning(target, SITE_BASE_PATH);
          if (relativeWarning) warnings.push(relativeWarning);
        }

        return text([
          `Published "${site.title}" - ${snapshot.fileCount} files, ${(snapshot.sizeBytes / 1048576).toFixed(2)} MB.`,
          `Live at ${addressOf(config, site.slug)}`,
          `Visible to: ${site.visibility}`,
          ...(site.runtime === 'command' && !isDaemonProcess()
            ? ['The daemon starts the runtime shortly; check SiteLogs if the address does not answer.']
            : []),
          ...(warnings.length > 0 ? ['', 'Warnings:', ...warnings.map((line) => `  - ${line}`)] : []),
        ].join('\n'), {
          siteId: site.id, slug: site.slug, releaseId, url: addressOf(config, site.slug),
          visibility: site.visibility, fileCount: snapshot.fileCount, sizeBytes: snapshot.sizeBytes, warnings,
        });
      } catch (error) {
        throw error instanceof ToolError ? error : new Error(`Could not publish: ${String(error)}`);
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
        throw error instanceof ToolError ? error : new Error(String(error));
      }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'SiteGet',
    label: 'Read a site',
    description: 'Full detail of one site: address, base path for the build, source folder, visibility, guests and release history.',
    parameters: Type.Object({ site: Type.String({ description: 'Which site: its slug (as shown in the address and in SiteList) or its id. Both work.' }) }),
    execute: async (_id, input) => {
      try {
        const userId = ownerOf(ctx);
        const site = requireOwned(deps, input.site, userId);
        const config = deps.config();
        const releases = store.releases(site.id);
        const people = deps.people();
        const guests = store.memberIds(site.id)
          .map((id) => ({ id, name: people.get(id)?.name || people.get(id)?.username || `#${id}` }));
        return text([
          describe(site, config),
          `  base path  ${SITE_BASE_PATH}`,
          `  guests     ${guests.length === 0 ? 'none' : guests.map((guest) => guest.name).join(', ')}`,
          '',
          releases.length === 0
            ? 'No releases yet.'
            : ['Releases:', ...releases.map((release) => `  ${release.id}  ${release.createdAt}  ${release.fileCount} files  ${(release.sizeBytes / 1048576).toFixed(2)} MB${release.note ? `  ${release.note}` : ''}`)].join('\n'),
          site.lastError ? `\nLast error: ${site.lastError}` : '',
        ].join('\n'), {
          siteId: site.id, slug: site.slug, url: addressOf(config, site.slug), visibility: site.visibility,
          status: site.status, sourceDir: site.sourceDir, basePath: SITE_BASE_PATH,
          runtime: site.runtime, startCommand: site.startCommand, bind: site.bind, port: site.port,
          network: config.runtimeNetwork, guests, currentReleaseId: site.currentReleaseId,
          releases: releases.map((release) => ({ id: release.id, createdAt: release.createdAt, note: release.note })),
        });
      } catch (error) {
        throw error instanceof ToolError ? error : new Error(String(error));
      }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'SiteUpdate',
    label: 'Update a site',
    description: 'Change a site\'s title, summary, router behaviour, command runtime or visibility. Visibility cannot be set to public here: making a site readable by anyone is confirmed by a person in the Sites screen.',
    parameters: Type.Object({
      site: Type.String({ description: 'Which site: its slug (as shown in the address and in SiteList) or its id. Both work.' }),
      title: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
      summary: Type.Optional(Type.String({ maxLength: 400 })),
      spa: Type.Optional(Type.Boolean()),
      startCommand: Type.Optional(Type.String({ maxLength: 500, description: 'Replacement start command for a command runtime.' })),
      bind: Type.Optional(Type.Union([Type.Literal('socket'), Type.Literal('port')], { description: 'Replacement bind mode for a command runtime.' })),
      visibility: Type.Optional(Type.Union(
        [Type.Literal('private'), Type.Literal('project'), Type.Literal('authenticated')],
      )),
    }),
    execute: async (_id, input) => {
      try {
        const userId = ownerOf(ctx);
        const site = requireOwned(deps, input.site, userId);
        const patch: Parameters<SitesStore['updateSite']>[1] = {};
        if (input.title !== undefined) patch.title = input.title.trim();
        if (input.summary !== undefined) patch.summary = input.summary.trim();
        if (input.spa !== undefined) patch.spa = input.spa;
        let runtimeChanged = false;
        if (input.startCommand !== undefined || input.bind !== undefined) {
          if (site.runtime !== 'command') throw new ToolError('Only a command site has runtime settings.');
          if (input.startCommand !== undefined) {
            const command = input.startCommand.trim();
            if (!command) throw new ToolError('A command site needs a non-empty startCommand.');
            patch.startCommand = command;
            runtimeChanged = command !== site.startCommand;
          }
          if (input.bind !== undefined) {
            const bind = input.bind === 'port' ? 'port' : 'socket';
            const runtimeConfig = deps.config();
            if (bind === 'port' && !runtimeConfig.allowLoopbackPorts) {
              throw new ToolError('Loopback ports are turned off for this instance.');
            }
            const currentPortValid = site.port !== null
              && site.port >= runtimeConfig.loopbackPortMin
              && site.port <= runtimeConfig.loopbackPortMax;
            patch.bind = bind;
            patch.port = bind === 'port' ? (currentPortValid ? site.port : await deps.runtime.allocatePort()) : null;
            runtimeChanged = runtimeChanged || bind !== site.bind || patch.port !== site.port;
          }
        }
        const nextVisibility = input.visibility as Visibility | undefined;
        if (nextVisibility !== undefined && !(VISIBILITIES as readonly string[]).includes(nextVisibility)) {
          throw new ToolError('Unknown visibility.');
        }
        const accessChanged = nextVisibility !== undefined && nextVisibility !== site.visibility;
        if (accessChanged) patch.visibility = nextVisibility;
        store.updateSite(site.id, patch);
        if (accessChanged) store.bumpAccessGeneration(site.id);
        const updated = store.siteById(site.id);
        if (runtimeChanged && updated?.currentReleaseId && isDaemonProcess()) {
          try {
            await deps.runtime.stop(site.id);
            await deps.runtime.start(updated);
            store.updateSite(site.id, { status: 'live', lastError: null });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            store.updateSite(site.id, { status: 'failed', lastError: message });
            throw new ToolError(`Runtime settings were saved, but the site did not restart: ${message}`);
          }
        }
        return text(updated ? `Updated.\n\n${describe(updated, deps.config())}` : 'Updated.');
      } catch (error) {
        throw error instanceof ToolError ? error : new Error(String(error));
      }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'SiteRollback',
    label: 'Roll back a site',
    description: 'Make an earlier release the live one again. The release must still be retained.',
    parameters: Type.Object({ site: Type.String({ description: 'Which site: its slug (as shown in the address and in SiteList) or its id. Both work.' }), releaseId: Type.String({ description: 'Release id from SiteGet.' }) }),
    execute: async (_id, input) => {
      try {
        const userId = ownerOf(ctx);
        const site = requireOwned(deps, input.site, userId);
        const release = store.release(site.id, input.releaseId);
        if (!release) throw new ToolError('That release is not retained for this site.');
        store.updateSite(site.id, { currentReleaseId: release.id, status: 'live', lastError: null });
        return text(`"${site.title}" now serves the release from ${release.createdAt}.`);
      } catch (error) {
        throw error instanceof ToolError ? error : new Error(String(error));
      }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'SiteLogs',
    label: 'Read a site runtime log',
    description: 'The recent output of a site runtime, which is where a server that refuses to start says why. Static sites have no runtime and no log.',
    parameters: Type.Object({ site: Type.String({ description: 'Which site: its slug (as shown in the address and in SiteList) or its id. Both work.' }) }),
    execute: async (_id, input) => {
      try {
        const userId = ownerOf(ctx);
        const site = requireOwned(deps, input.site, userId);
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
        throw error instanceof ToolError ? error : new Error(String(error));
      }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'SiteShare',
    label: 'Share a site with someone',
    description: 'Give one named account access to a site, whatever the site\'s visibility is. This is how a private site reaches a specific colleague: they keep access until it is taken away, and they see the site in their own Sites screen. Making a site readable by ANYONE is a separate decision a person confirms in the Sites screen; this tool never does that.',
    parameters: Type.Object({
      site: Type.String({ description: 'Which site: its slug (as shown in the address and in SiteList) or its id. Both work.' }),
      person: Type.String({ description: 'Who to share with: their account name, their display name, or their numeric id.' }),
    }),
    execute: async (_id, input) => {
      const userId = ownerOf(ctx);
      const site = requireOwned(deps, input.site, userId);
      const person = requirePerson(deps, input.person);
      if (person.id === site.ownerUserId) throw new ToolError(`${person.name} already owns this site.`);
      if (store.memberIds(site.id).includes(person.id)) {
        return text(`${person.name} could already open "${site.title}".`, { siteId: site.id, userId: person.id, changed: false });
      }
      store.addMember(site.id, person.id);
      return text([
        `${person.name} can now open "${site.title}".`,
        `They will find it at ${addressOf(deps.config(), site.slug)} and in their own Sites screen.`,
        site.status === 'live' ? '' : 'The site has not been published yet, so there is nothing to see there until SitePublish runs.',
      ].filter(Boolean).join('\n'), { siteId: site.id, slug: site.slug, userId: person.id, changed: true });
    },
  }));

  ctx.registerTool(defineTool({
    name: 'SiteUnshare',
    label: 'Stop sharing a site',
    description: 'Take one named account\'s access to a site away again. It applies immediately: their existing session stops working on the next request rather than lasting until it expires.',
    parameters: Type.Object({
      site: Type.String({ description: 'Which site: its slug (as shown in the address and in SiteList) or its id. Both work.' }),
      person: Type.String({ description: 'Whose access to remove: account name, display name, or numeric id.' }),
    }),
    execute: async (_id, input) => {
      const userId = ownerOf(ctx);
      const site = requireOwned(deps, input.site, userId);
      const person = requirePerson(deps, input.person);
      if (!store.memberIds(site.id).includes(person.id)) {
        return text(`${person.name} was not on this site's guest list.`, { siteId: site.id, userId: person.id, changed: false });
      }
      store.removeMember(site.id, person.id);
      // The generation is what makes the revocation immediate: a session minted earlier no longer
      // matches, so the next request re-decides access from live state instead of trusting the cookie.
      store.bumpAccessGeneration(site.id);
      return text(`${person.name} can no longer open "${site.title}".`, { siteId: site.id, userId: person.id, changed: true });
    },
  }));

  ctx.registerTool(defineTool({
    name: 'SiteDelete',
    label: 'Delete a site',
    description: 'Remove a site: the address stops working and every release is deleted. The source folder in the Project is left untouched.',
    parameters: Type.Object({ site: Type.String({ description: 'Which site: its slug (as shown in the address and in SiteList) or its id. Both work.' }) }),
    execute: async (_id, input) => {
      try {
        const userId = ownerOf(ctx);
        const site = requireOwned(deps, input.site, userId);
        await deps.deleteSite(site.id);
        return text(`Deleted "${site.title}". Its source folder ${site.sourceDir} was left in place.`);
      } catch (error) {
        throw error instanceof ToolError ? error : new Error(String(error));
      }
    },
  }));
}
