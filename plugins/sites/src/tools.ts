import { existsSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { join, posix, resolve, sep } from 'node:path';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import type { SitesContext } from './coreSeams.js';
import type { Site, SitesStore, PublicationKind, Visibility } from './store.js';
import { VISIBILITIES } from './store.js';
import { mayPublish, type AccessDeps } from './access.js';
import { SITE_BASE_PATH, siteUrl, type SitesConfig } from './config.js';
import { PublishError, pruneReleases, relativeAssetWarning, snapshotRelease } from './publish.js';
import { snapshotManagedRelease } from './managedPublish.js';
import type { ProjectPreviewService } from './preview.js';
import { publicationPort, type ProjectPublicationService } from './publication.js';
import { recordedCertificate, type RecordedCertificate, type SiteCertificateReadiness } from './certificate.js';
import { requireSandbox, SandboxRequiredError } from './sandboxControl.js';

export interface ToolDeps {
  ctx: SitesContext;
  store: SitesStore;
  access: AccessDeps;
  config(): SitesConfig;
  people(): Map<number, { id: number; username: string; name: string; avatar: string }>;
  previews?: Pick<ProjectPreviewService, 'request'>;
  siteDir(siteId: string): string;
  releaseDir(siteId: string, releaseId: string): string;
  deleteSite(siteId: string): Promise<void>;
  /** The transport half of a proxy publication: asking the Project's environment for it, reading through
   *  it, and remembering where it answered. */
  publications: Pick<ProjectPublicationService, 'establish' | 'probe' | 'adopt'>;
  /** Per-site certificate operations, for a site the caller has already been proved to own. `publish` asks
   *  for THIS site's certificate and reports what is actually served afterwards; `readiness` only reports.
   *  Neither hands a tool the privileged broker, and neither waits for anything. */
  certificates: {
    publish(site: Site): Promise<SiteCertificateReadiness>;
    readiness(site: Site): Promise<SiteCertificateReadiness>;
  };
}

const text = (body: string, details: Record<string, unknown> = {}) =>
  ({ content: [{ type: 'text' as const, text: body }], details });

/** Thrown, never returned. A tool that hands a refusal back as ordinary text is recorded as a
 *  SUCCESSFUL call, so the model reads "No site of yours has the id X" as an answer rather than a
 *  failure and tries another guess. The host turns a throw into an error result. */
class ToolError extends Error {}

/** Errors whose message is already written for the model. A tool refusal is one; so is the shared Sandbox
 *  refusal, which names the plugin to switch on and would be useless behind a "Could not publish: Error:"
 *  prefix. Everything else is an unexpected failure and keeps the prefix that says which operation lost. */
const isRefusal = (error: unknown): error is Error =>
  error instanceof ToolError || error instanceof SandboxRequiredError;

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
 *  root, or the daemon's own working directory, and neither is a place the caller chose.
 *
 *  A managed Project has no host path to fall back to: it is mounted inside its own container at its own
 *  name (`/<slug>`, core's `managedGuestRoot` in `src/shared/projectExecution.ts`), and the turn's working
 *  directory IS that root. `/workspace` is a reserved name and no such directory exists there, so a folder
 *  built under it landed outside the Project: the agent was told to write into a tree the Project tools
 *  and the publish export never looked at. */
function resolveSourceRoot(ctx: SitesContext, slug: string): { dir: string; projectId: number; rel: string } {
  const rel = posix.join('sites', slug);
  const selected = ctx.currentAccess().projectRef;
  if (selected?.kind === 'managed') {
    const root = ctx.workDir();
    if (!root) throw new ToolError('This turn has no Project directory, so the site has nowhere to put its source.');
    return { dir: posix.join(root, rel), projectId: selected.projectId, rel };
  }
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

  return { dir: join(project.path, ...rel.split('/')), projectId: project.id, rel };
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
  // A site queued for deletion is already gone from every listing and answers nothing. Handing its row
  // back would let a publish write `live` over the durable marker and revive a site whose members and
  // tickets have been destroyed, while the slug it still holds waits to be swept.
  if (!site || site.status === 'deleting' || site.ownerUserId !== userId) {
    const owned = deps.store.sitesOwnedBy(userId);
    const known = owned.length === 0
      ? 'This account has no sites yet - create one with SiteCreate.'
      : `This account's sites are: ${owned.map((entry) => `${entry.slug} (id ${entry.id})`).join(', ')}.`;
    throw new ToolError(`No site of yours matches "${wanted}". Give either the slug or the id. ${known}`);
  }
  return site;
};

const requireManaged = (deps: ToolDeps, ref: string, userId: number): Site => {
  const wanted = ref.trim();
  const site = deps.store.siteById(wanted) ?? deps.store.siteBySlug(wanted);
  if (!site || site.status === 'deleting' || (site.ownerUserId !== userId && !deps.access.isAdmin(userId))) {
    throw new ToolError(`No manageable site matches "${wanted}".`);
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

/** End a detail as one sentence. A certificate detail may be several sentences and already carry its own
 *  closing punctuation, so appending a period unconditionally printed "... on its next gateway sweep..". */
const ended = (detail: string): string => (/[.!?]$/.test(detail) ? detail : `${detail}.`);

/** What a just-published address is actually worth to whoever opens it next.
 *
 *  Publishing writes the release and marks the site live; the certificate for its hostname is a separate
 *  fact. Until it exists the hostname is answered by the catch-all block holding ANOTHER site's
 *  certificate, which a browser rejects outright, so the address is presented as usable HTTPS only against
 *  an observed certificate: `ready` means a TLS handshake established that the gateway serves THIS
 *  hostname's certificate, and nothing weaker earns the plain address line. */
const publishedAddressLines = (address: string | null, certificate: SiteCertificateReadiness): string[] => {
  if (address === null) return [`The public hostname is unavailable: ${ended(certificate.detail)}`];
  if (certificate.state === 'ready') return [`Address: ${address}`, `Certificate: verified - ${ended(certificate.detail)}`];
  if (certificate.state === 'error') {
    return [`Address: ${address} - NOT usable over HTTPS.`, `Certificate error: ${ended(certificate.detail)}`];
  }
  return [`Address: ${address} - not usable over HTTPS yet.`, `Certificate pending: ${ended(certificate.detail)}`];
};

/** How a listing prints one site's certificate facts. The verdict comes from the row, so the line says so:
 *  `SiteGet` is the only reader that opens a handshake and the only one entitled to describe what is being
 *  served. An absent record is written as such rather than as a state, because "unrecorded (recorded)"
 *  contradicts itself in the one place an agent is scanning quickly. */
const recordedCertificateLine = (recorded: RecordedCertificate): string => {
  const label = recorded.state === 'unrecorded' ? 'nothing recorded' : `${recorded.state} (recorded)`;
  return `  certificate ${label} - ${recorded.detail}`;
};


/** What a proxy publication is, in the words its reader needs.
 *
 *  A proxy publication has no release and no container of its own, so the two facts that matter are the
 *  port inside the Project and which Project that is. It prints nothing at all for a static publication,
 *  whose summary already says everything it has. The last line is the answer to the question an agent
 *  actually has when a site of this kind misbehaves — whose environment is this, and where do I look at
 *  it — and it is phrased as one line so it survives being read out of a longer summary. */
const projectLines = (
  site: Site,
  project?: { slug: string | null; executionKind?: string } | null,
): string[] => {
  if (site.kind !== 'proxy') return [];
  const name = project?.slug ?? `Project ${site.projectId}`;
  return [
    `  kind       proxy`,
    `  target     ${site.target || '(no port)'} inside the Project`,
    `  project    ${name}${project?.executionKind ? ` (${project.executionKind})` : ''}`,
    `  transport  managed Project ${name}`,
  ];
};

const describe = (
  site: Site,
  config: SitesConfig,
  project?: { slug: string | null; path?: string; executionKind?: string } | null,
): string => {
  const address = siteUrl(config, site.slug);
  const source = project?.executionKind === 'managed'
    ? posix.join(`/${project.slug ?? ''}`, site.sourceRel)
    : project?.path ? join(project.path, ...site.sourceRel.split('/')) : site.sourceRel;
  return [
    `${site.title}`,
    `  id         ${site.id}`,
    `  slug       ${site.slug}   (either identifier works wherever a site is named)`,
    `  address    ${address ?? 'unavailable until the domain gateway is ready'}`,
    `  visibility ${site.visibility}`,
    `  status     ${site.status === 'live' && site.lastError !== null ? 'degraded' : site.status}`,
    ...projectLines(site, project),
    site.kind === 'proxy'
      ? `  published  ${site.lastPublishAt ?? 'never'}${site.lastPublishAt && site.lastPublishModel ? ` by ${site.lastPublishModel}` : ''}`
      : site.lastPublishAt
          ? `  published  ${site.lastPublishAt}${site.lastPublishModel ? ` by ${site.lastPublishModel}` : ''}`
          : '  published  never',
    ...(site.kind === 'proxy' ? [] : [`  source     ${source}`]),
  ].join('\n');
};

export function registerTools(deps: ToolDeps): void {
  const { ctx, store } = deps;

  /** The Project a publication belongs to, as every summary line reports it. A read of the in-process
   *  Project register, never a container round trip, so a listing pays nothing for it. */
  const projectOf = (site: Site): { slug: string; path: string; executionKind: string } | null => {
    const project = ctx.host.stores().projects.get(site.projectId);
    return project ? { slug: project.slug, path: project.path, executionKind: project.executionKind } : null;
  };

  const guardPublisher = (userId: number): void => {
    if (!mayPublish(userId, deps.access, deps.config().publishers)) {
      throw new ToolError('This account is not allowed to publish sites on this instance.');
    }
  };

  ctx.registerTool(defineTool({
    name: 'SitePreview',
    label: 'Preview a project',
    description: 'Open a running managed Project application on an isolated preview origin. Only current Project members and administrators may access it; it is not a published release.',
    parameters: Type.Object({ port: Type.Number({ minimum: 1, maximum: 65535, description: 'HTTP port inside the selected managed Project.' }) }),
    execute: async (_id, input) => {
      const userId = ownerOf(ctx);
      const project = ctx.currentAccess().projectRef;
      if (project?.kind !== 'managed') throw new ToolError('Select a managed Project before opening its preview.');
      if (!deps.previews) throw new ToolError('Project previews are unavailable.');
      const result = await deps.previews.request(project.projectId, input.port, userId);
      return text(`Project preview: ${result.url}\nAccess requires current Project membership.`, result);
    },
  }));

  ctx.registerTool(defineTool({
    name: 'SiteCreate',
    label: 'Create a site',
    description: 'Create a static release site or a proxy publication. Static sites remain drafts until SitePublish copies a finished build. Proxy publications forward to an application already running inside the selected managed Project on the port given in target.',
    parameters: Type.Object({
      title: Type.String({ minLength: 1, maxLength: 120, description: 'Human title shown in the Sites screen.' }),
      summary: Type.Optional(Type.String({ maxLength: 400, description: 'One line describing what the page is for.' })),
      visibility: Type.Optional(Type.Union(
        [Type.Literal('private'), Type.Literal('project'), Type.Literal('authenticated')],
        { description: 'Who may open it. Defaults to the instance setting. A site is never made public here; that is confirmed by a person in the Sites screen.' },
      )),
      spa: Type.Optional(Type.Boolean({ description: 'Serve index.html for unknown paths, for a client-side router. Default false.' })),
      kind: Type.Optional(Type.Union(
        [Type.Literal('static'), Type.Literal('proxy')],
        { description: 'What the address publishes. "static" copies a built folder into a release on SitePublish; "proxy" forwards to an application already running inside the selected managed Project, and needs target.' },
      )),
      target: Type.Optional(Type.String({
        maxLength: 64,
        description: 'For kind "proxy": the TCP port the application listens on at 127.0.0.1 INSIDE the Project container, e.g. "3000". Nothing else is copied or started.',
      })),
    }),
    execute: async (_id, input) => {
      try {
        const userId = ownerOf(ctx);
        guardPublisher(userId);
        const config = deps.config();
        const kind: PublicationKind = input.kind === 'proxy' ? 'proxy' : 'static';
        // The same rule as everywhere else in this tool: a value decides, never the presence of a key. A
        // model that echoes every optional property sends `target: ""` with a plain static site, and that
        // is not an instruction to publish anything else.
        const target = (input.target ?? '').trim();
        if (kind === 'static' && target !== '') {
          throw new ToolError('target is only for a proxy publication. A static site publishes a folder, so leave target out or send kind "proxy" with the port the application listens on.');
        }
        if (kind === 'proxy') {
          // A proxy publication is not a folder: the application already runs inside the Project, and the
          // only thing this row adds is an address and the transport that carries requests to its port.
          if (!/^\d+$/.test(target) || Number(target) < 1 || Number(target) > 65535) {
            throw new ToolError('A proxy publication needs target: the TCP port the application listens on at 127.0.0.1 inside the Project, for example "3000".');
          }
          const selected = ctx.currentAccess().projectRef;
          if (selected?.kind !== 'managed') {
            throw new ToolError('A proxy publication is served by a managed Project, so select that Project before creating it.');
          }
          requireSandbox(ctx.control('sandbox'));
          if (store.countOwnedBy(userId) >= config.maxSitesPerAccount) {
            throw new ToolError(`This account already has ${config.maxSitesPerAccount} sites, which is the configured limit.`);
          }
          const project = ctx.host.stores().projects.get(selected.projectId);
          if (!project) throw new ToolError('The Project no longer exists.');
          if (project.executionKind !== 'managed') {
            throw new ToolError(`Project ${project.slug} is a host Project, so it has no environment to publish from. A proxy publication needs a managed Project.`);
          }

          let slug = slugify(input.title);
          while (store.slugTaken(slug)) slug = slugify(input.title);
          const now = new Date().toISOString();
          const site: Site = {
            id: randomUUID(),
            slug,
            title: input.title.trim(),
            summary: (input.summary ?? '').trim(),
            projectId: selected.projectId,
            ownerUserId: userId,
            visibility: (input.visibility as Visibility | undefined) ?? config.defaultVisibility,
            accessGeneration: 1,
            // Nothing is copied for this publication, so it owns no folder. Its application lives in the
            // Project, which is also where its logs and its environment state come from.
            sourceRel: '',
            spa: false,
            kind: 'proxy',
            target: String(Number(target)),
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
          const address = siteUrl(config, site.slug);
          return text([
            `Created "${site.title}" as a proxy publication of project ${project.slug}.`,
            `  id   ${site.id}`,
            `  slug ${site.slug}`,
            `  port ${site.target} (inside the Project)`,
            'Name the site by either identifier in Sites tools.',
            '',
            `The application must listen on 127.0.0.1:${site.target} inside the Project ${project.slug}.`,
            'Run it there with the Project shell, a service, or an Elowen turn, and call SitePublish once it answers.',
            address
              ? `It will be published at: ${address}`
              : 'No public address is available until the domain gateway DNS is ready.',
            '',
            'Nothing is copied: the published page is the application itself, reached through the managed Project.',
            'Lifecycle and logs belong to the managed Project, not to this publication.',
          ].join('\n'), {
            siteId: site.id, slug: site.slug, kind: site.kind, target: site.target,
            projectId: site.projectId, projectSlug: project.slug, url: address,
            visibility: site.visibility,
          });
        }
        if (store.countOwnedBy(userId) >= config.maxSitesPerAccount) {
          throw new ToolError(`This account already has ${config.maxSitesPerAccount} sites, which is the configured limit.`);
        }

        let slug = slugify(input.title);
        while (store.slugTaken(slug)) slug = slugify(input.title);

        // File-published sites need a public origin before the first side effect.
        const address = addressOf(config, slug);

        const { dir, projectId, rel: sourceRel } = resolveSourceRoot(ctx, slug);
        const sourceProject = ctx.host.stores().projects.get(projectId);
        if (!sourceProject) throw new ToolError('The source Project no longer exists.');
        const managed = sourceProject.executionKind === 'managed';
        const siteId = randomUUID();
        let allowed: string;
        if (managed) {
          const sandbox = requireSandbox(ctx.control('sandbox'));
          allowed = dir;
          await sandbox.projectFiles({ project: { kind: 'managed', projectId }, accountUserId: userId, operation: { kind: 'mkdir', path: dir } });
        } else {
          try { allowed = ctx.assertPathAllowed(dir); }
          catch { throw new ToolError(`The site folder ${dir} is outside what this account may write to.`); }
          if (existsSync(allowed)) throw new ToolError(`${allowed} already exists.`);
          mkdirSync(allowed, { recursive: true });
        }

        const now = new Date().toISOString();
        const site: Site = {
          id: siteId,
          slug,
          title: input.title.trim(),
          summary: (input.summary ?? '').trim(),
          projectId,
          ownerUserId: userId,
          visibility: (input.visibility as Visibility | undefined) ?? config.defaultVisibility,
          accessGeneration: 1,
          sourceRel,
          spa: input.spa === true,
          kind: 'static',
          target: '',
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
          'Name the site by either of those in Sites tools.',
          '',
          `Write the project here: ${allowed}`,
          'For an isolated Git worktree, create and activate a Sandbox workspace before SiteCreate; Sites automatically uses the active workspace.',
          `Configure the build with base path: ${SITE_BASE_PATH}`,
          `It will be published at: ${address}`,
          '',
          'Asset URLs must be absolute. A relative reference (./assets/...) resolves against whatever address the visitor opened, so it works at the root and breaks on every deeper route.',
          'When the output is ready, call SitePublish with the output directory.',
        ].join('\n'), {
          siteId: site.id, slug: site.slug, sourceDir: allowed,
          basePath: SITE_BASE_PATH, url: address, visibility: site.visibility,
        });
      } catch (error) {
        throw isRefusal(error) ? error : new Error(`Could not create the site: ${String(error)}`);
      }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'SitePublish',
    label: 'Publish a site',
    description: 'Publish a site. For a file publication, copy a finished build output into a new release and make it the live one: build it yourself first, because this publishes what is already on disk and runs nothing. For a proxy publication, verify that the application inside the Project answers on its port and make the address live; nothing is copied and nothing is started.',
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
        const address = siteUrl(config, site.slug);

        // A proxy publication has nothing to copy: publishing it means proving the application inside the
        // Project answers through the same transport a visitor's request takes, and only then making the
        // address live. A failure is recorded on the row and reported, never a site that is live behind a
        // dead port.
        if (site.kind === 'proxy') {
          const port = publicationPort(site);
          if (port === null) throw new ToolError('This publication has no usable port. Recreate it with SiteCreate (kind "proxy" and the port in target).');
          // Response facts are resolved before the transport or row is mutated. A missing public base is a
          // valid installation state, so success reports the verified socket and leaves the URL null.
          const projectName = ctx.host.stores().projects.get(site.projectId)?.slug ?? String(site.projectId);
          let socketPath: string;
          try {
            socketPath = (await deps.publications.establish(site, userId)).socketPath;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            store.updateSite(site.id, { status: 'failed', lastError: message });
            throw new ToolError(`The managed Project could not be reached, so nothing was published: ${message}`);
          }
          const probe = await deps.publications.probe(socketPath);
          if (!probe.answered || probe.status === null || probe.status >= 500) {
            const message = probe.answered
              ? `127.0.0.1:${port} inside the Project answered with an unhealthy status (${probe.detail})`
              : `nothing answered on 127.0.0.1:${port} inside the Project (${probe.detail})`;
            store.updateSite(site.id, { status: 'failed', lastError: message });
            throw new ToolError(`Not published: ${message}. Start or fix the application in the managed Project, then call SitePublish again.`);
          }
          const now = new Date().toISOString();
          const model = modelLabel(ctx);
          // The transport is already established and verified, so the very next visitor request is served
          // through it instead of waiting for the next sweep to adopt the same socket.
          deps.publications.adopt(site.id, socketPath);
          store.updateSite(site.id, {
            status: 'live',
            lastPublishAt: now,
            lastPublishModel: model,
            lastError: null,
          });
          // Only now: the row has to be live before a certificate is asked for, because the gateway serves
          // what the store says is published and the HTTP-01 challenge is answered through that config.
          const certificate = await deps.certificates.publish(site);
          return text([
            `Published "${site.title}" - the application inside project ${projectName} answered on 127.0.0.1:${port} (${probe.detail}).`,
            ...publishedAddressLines(address, certificate),
            `Transport socket: ${socketPath}`,
            `Visible to: ${site.visibility}`,
            '',
            'Nothing was copied, so the address always shows what the application serves right now. Restarting, snapshotting and reading its logs happen in the managed Project.',
          ].join('\n'), {
            siteId: site.id, slug: site.slug, kind: site.kind, target: site.target,
            url: address, socketPath, visibility: site.visibility, status: 'live', answered: probe.status,
            certificate,
          });
        }

        const relative = (input.outputDir ?? '').replace(/^\/+/, '');
        if (relative.split('/').some((segment) => segment === '..')) {
          throw new ToolError('outputDir must stay inside the site folder.');
        }
        const sourceProject = ctx.host.stores().projects.get(site.projectId);
        if (!sourceProject) throw new ToolError('The source Project no longer exists.');
        const managed = sourceProject.executionKind === 'managed';
        const sourceRoot = managed
          ? posix.join(`/${sourceProject.slug}`, site.sourceRel)
          : join(sourceProject.path, ...site.sourceRel.split('/'));
        const source = resolve(sourceRoot, relative);
        const root = resolve(sourceRoot);
        if (source !== root && !source.startsWith(root + sep)) {
          throw new ToolError('outputDir must stay inside the site folder.');
        }
        const selected = ctx.currentAccess().projectRef;
        if (selected?.kind === 'managed' && selected.projectId !== site.projectId) throw new ToolError('The publication source is outside the selected managed Project.');
        if (!managed) {
          if (!existsSync(source)) throw new ToolError(`${source} does not exist. Build the project first.`);
          ctx.assertPathAllowed(source);
        }

        const releaseId = randomUUID();
        const target = deps.releaseDir(site.id, releaseId);
        let snapshot;
        try {
          snapshot = managed
            ? await snapshotManagedRelease(requireSandbox(ctx.control('sandbox')), {
              projectId: site.projectId,
              accountUserId: userId,
              sourceRoot: source,
              releaseDir: target,
              limits: { maxAssetBytes: config.maxAssetBytes, maxTotalBytes: config.maxSiteBytes },
            })
            : snapshotRelease(source, target, {
              maxAssetBytes: config.maxAssetBytes,
              maxTotalBytes: config.maxSiteBytes,
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

        pruneReleases(store, site.id, deps.siteDir(site.id), config.releasesKept, releaseId);

        const relativeWarning = relativeAssetWarning(target, SITE_BASE_PATH);
        if (relativeWarning) warnings.push(relativeWarning);

        // After the release is live: a certificate for a
        // hostname whose publish then failed would be issued for a page nobody published.
        const certificate = await deps.certificates.publish(site);

        return text([
          `Published "${site.title}" - ${snapshot.fileCount} files, ${(snapshot.sizeBytes / 1048576).toFixed(2)} MB.`,
          ...publishedAddressLines(address, certificate),
          `Visible to: ${site.visibility}`,
          ...(warnings.length > 0 ? ['', 'Warnings:', ...warnings.map((line) => `  - ${line}`)] : []),
        ].join('\n'), {
          siteId: site.id, slug: site.slug, releaseId, url: address,
          visibility: site.visibility, fileCount: snapshot.fileCount, sizeBytes: snapshot.sizeBytes, warnings,
          certificate,
        });
      } catch (error) {
        throw isRefusal(error) ? error : new Error(`Could not publish: ${String(error)}`);
      }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'SiteList',
    label: 'List sites',
    description: 'List owned sites with address, visibility and publication kind, plus what each site row records about its certificate.',
    parameters: Type.Object({}),
    execute: async () => {
      try {
        const userId = ownerOf(ctx);
        const config = deps.config();
        const sites = store.sitesOwnedBy(userId);
        if (sites.length === 0) return text('This account has no sites yet.');
        const rows = sites.map((site) => ({ site, certificate: recordedCertificate(site) }));
        return text(rows.map((row) => [
          describe(row.site, config, projectOf(row.site)),
          ...(row.certificate ? [recordedCertificateLine(row.certificate)] : []),
        ].join('\n')).join('\n\n'), {
          sites: rows.map((row) => ({
            id: row.site.id,
            slug: row.site.slug,
            kind: row.site.kind,
            target: row.site.target,
            ...(row.certificate ? { certificate: row.certificate } : {}),
          })),
        });
      } catch (error) {
        throw isRefusal(error) ? error : new Error(String(error));
      }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'SiteGet',
    label: 'Read a site',
    description: 'Full site detail including source, visibility and retained file releases. A proxy publication reports the managed Project and port it publishes.',
    parameters: Type.Object({ site: Type.String({ description: 'Which site: its slug (as shown in the address and in SiteList) or its id. Both work.' }) }),
    execute: async (_id, input) => {
      try {
        const userId = ownerOf(ctx);
        const site = deps.access.isAdmin(userId)
          ? requireManaged(deps, input.site, userId)
          : requireOwned(deps, input.site, userId);
        // An administrator reads the operational detail of what an account published just as they do for
        // an environment: helping with a page nobody can open is exactly when that is needed.
        if (site.ownerUserId !== userId && site.kind !== 'proxy') {
          throw new ToolError('Only the site owner may read this site detail.');
        }
        const config = deps.config();
        const releases = store.releases(site.id);
        // What serves this publication, read through the account the Project belongs to rather than through
        // whoever is asking: the environment seam answers per account, and a reader of a site is not
        // necessarily a member of its Project.
        const project = ctx.host.stores().projects.get(site.projectId);
        const projectInfo = project
          ? { slug: project.slug, path: project.path, executionKind: project.executionKind }
          : null;
        const people = deps.people();
        const guests = store.memberIds(site.id)
          .map((id) => ({ id, name: people.get(id)?.name || people.get(id)?.username || `#${id}` }));
        // One handshake for the one site being read. A published page that a browser refuses is the single
        // most useful thing this tool can report, and it is only true if it is observed each time.
        const certificate = site.status === 'live' ? await deps.certificates.readiness(site) : null;
        return text([
          describe(site, config, projectInfo),
          `  base path  ${SITE_BASE_PATH}`,
          ...(certificate ? [`  certificate ${certificate.state} - ${certificate.detail}`] : []),
          `  guests     ${guests.length === 0 ? 'none' : guests.map((guest) => guest.name).join(', ')}`,
          '',
          site.kind === 'proxy'
            ? `Releases: none. A proxy publication serves whatever the application inside project ${project?.slug ?? site.projectId} is running right now.`
            : releases.length === 0
              ? 'No releases yet.'
              : ['Releases:', ...releases.filter((release) => release.kind !== 'environment-snapshot')
                .map((release) => `  ${release.id}  ${release.createdAt}  ${release.fileCount} files  ${(release.sizeBytes / 1048576).toFixed(2)} MB${release.note ? `  ${release.note}` : ''}`)].join('\n'),
          site.lastError ? `\nLast error: ${site.lastError}` : '',
        ].join('\n'), {
          siteId: site.id, slug: site.slug, url: siteUrl(config, site.slug), visibility: site.visibility,
          status: site.status, degraded: site.status === 'live' && site.lastError !== null,
          sourceDir: project?.executionKind === 'managed' ? posix.join(`/${project.slug}`, site.sourceRel) : project ? join(project.path, ...site.sourceRel.split('/')) : site.sourceRel,
          basePath: SITE_BASE_PATH, kind: site.kind, target: site.target,
          guests, currentReleaseId: site.currentReleaseId,
          ...(certificate ? { certificate } : {}),
          // `projectInfo.path` exists for `describe`, which needs the HOST root to print a host Project's
          // source line. It must not be spread into the structured result: a managed Project is addressed
          // by its guest root everywhere else in this payload, so a host path the agent cannot use is a
          // leak rather than a fact.
          ...(projectInfo ? { project: {
            id: site.projectId, slug: projectInfo.slug,
            executionKind: projectInfo.executionKind,
          } } : {}),
          releases: releases.filter((release) => release.kind !== 'environment-snapshot').map((release) => ({
            id: release.id, createdAt: release.createdAt, note: release.note, kind: 'files' as const,
          })),
        });
      } catch (error) {
        throw isRefusal(error) ? error : new Error(String(error));
      }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'SiteUpdate',
    label: 'Update a site',
    description: 'Change a site\'s title, summary, router behaviour or visibility. Visibility cannot be set to public here: making a site readable by anyone is confirmed by a person in the Sites screen.',
    parameters: Type.Object({
      site: Type.String({ description: 'Which site: its slug (as shown in the address and in SiteList) or its id. Both work.' }),
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
        const site = requireOwned(deps, input.site, userId);
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
        if (!updated) return text('Updated.');
        return text(`Updated.\n\n${describe(updated, deps.config(), projectOf(updated))}`);
      } catch (error) {
        throw isRefusal(error) ? error : new Error(String(error));
      }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'SiteRollback',
    label: 'Roll back a site',
    description: 'Restore a retained file release and make it live again.',
    parameters: Type.Object({
      site: Type.String({ description: 'Which site: its slug or id.' }),
      releaseId: Type.String({ description: 'File release id from SiteGet.' }),
    }),
    execute: async (_id, input) => {
      try {
        const userId = ownerOf(ctx);
        const site = requireManaged(deps, input.site, userId);
        if (site.kind === 'proxy') throw new ToolError('A proxy publication has no file releases to restore.');
        const release = store.release(site.id, input.releaseId);
        if (!release || release.kind === 'environment-snapshot') throw new ToolError('That file release is not retained for this site.');
        if (site.ownerUserId !== userId) throw new ToolError('Only the site owner may roll back a file release.');
        store.updateSite(site.id, { currentReleaseId: release.id, status: 'live', lastError: null });
        return text(`"${site.title}" now serves the release from ${release.createdAt}.`);
      } catch (error) {
        throw isRefusal(error) ? error : new Error(String(error));
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
      const address = siteUrl(deps.config(), site.slug);
      return text([
        `${person.name} can now open "${site.title}".`,
        address
          ? `They will find it at ${address} and in their own Sites screen.`
          : 'It will appear in their Sites screen, but no public address is available until the domain gateway DNS is ready.',
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
        return text(`Deleted "${site.title}". Its Project source folder ${site.sourceRel} was left in place.`);
      } catch (error) {
        throw isRefusal(error) ? error : new Error(String(error));
      }
    },
  }));
}
