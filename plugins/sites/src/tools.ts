import { existsSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { dirname, join, posix, resolve, sep } from 'node:path';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import type { SitesContext } from './coreSeams.js';
import type { Site, SitesStore, PublicationKind, Visibility } from './store.js';
import { VISIBILITIES } from './store.js';
import { mayPublish, type AccessDeps } from './access.js';
import { SITE_BASE_PATH, environmentLimitOverrides, siteUrl, type EnvironmentLimitOverrides, type SitesConfig } from './config.js';
import { PublishError, pruneReleases, relativeAssetWarning, snapshotRelease } from './publish.js';
import { isDaemonProcess, type SiteRuntimeSupervisor } from './runtime.js';
import type { EnvironmentState, EnvironmentSupervisor } from './environment.js';
import type { ProjectPreviewService } from './preview.js';
import { publicationPort, type ProjectEnvironmentView, type ProjectPublicationService } from './publication.js';
import type { SiteCertificateReadiness } from './certificate.js';

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
  runtime: SiteRuntimeSupervisor;
  environment: Pick<EnvironmentSupervisor, 'state' | 'exec' | 'logs' | 'applyLimits' | 'request' | 'scheduleSnapshot' | 'scheduleRestore' | 'pendingAction' | 'exportProject'>;
  /** The transport half of a proxy publication: asking the Project's environment for it, reading through
   *  it, and remembering where it answered. */
  publications: Pick<ProjectPublicationService, 'establish' | 'probe' | 'adopt'>;
  /** The state of the environment a proxy publication is served by, read for the current manager. */
  projectEnvironment(projectId: number, actor: number): Promise<ProjectEnvironmentView | null>;
  /** Per-site certificate operations, for a site the caller has already been proved to own. `publish` asks
   *  for THIS site's certificate and reports what is actually served afterwards; `readiness` only reports.
   *  Neither hands a tool the privileged broker, and neither waits for anything. */
  certificates: {
    publish(site: Site): Promise<SiteCertificateReadiness>;
    readiness(site: Site): Promise<SiteCertificateReadiness>;
  };
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
  if (!site || site.ownerUserId !== userId) {
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
  if (!site || (site.ownerUserId !== userId && !deps.access.isAdmin(userId))) {
    throw new ToolError(`No manageable site matches "${wanted}".`);
  }
  return site;
};

/** One environment action owns the durable slot at a time. The supervisor is the authority that refuses
 *  a second one; this turns its refusal into an agent-facing message that says the work is already
 *  running rather than reading like the request itself was malformed. */
const scheduleExclusively = async <T>(schedule: () => Promise<T>): Promise<T> => {
  try { return await schedule(); }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/environment action or execution is in progress/.test(message)) {
      throw new ToolError('Another environment action or execution is already in progress for this site. Wait for it to finish, or read its state with SiteGet.');
    }
    throw error;
  }
};

const requireEnvironmentAuthority = (deps: ToolDeps, site: Site, userId: number): void => {
  if (deps.access.isAdmin(userId)) return;
  if (!mayPublish(userId, deps.access, deps.config().publishers)) {
    throw new ToolError('This account is not allowed to publish sites on this instance.');
  }
  if (!deps.access.canAccessProject(userId, site.projectId)) {
    throw new ToolError('Current Project access is required to administer this environment.');
  }
};

/** Why a per-site lifecycle tool refuses a proxy publication.
 *
 *  Not because the capability is missing — the application inside the Project can be started, stopped,
 *  snapshotted and read — but because this is not the name it has. Every one of those operations acts on
 *  the Project and on everything else in it, and saying so is the whole answer the caller needs. */
const proxyRefusal = (what: string): string =>
  `This publication is served by the environment of its Project, which owns no per-site lifecycle or logs. ${what}`;

const workdirOf = (value: unknown): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.includes('\0') || !value.startsWith('/')) {
    throw new ToolError('workdir must be an absolute normalized in-container path.');
  }
  const normalized = posix.normalize(value);
  if (normalized !== value || normalized.includes('/../')) {
    throw new ToolError('workdir must be an absolute normalized in-container path.');
  }
  return normalized;
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

/** What a just-published address is actually worth to whoever opens it next.
 *
 *  Publishing writes the release and marks the site live; the certificate for its hostname is a separate
 *  fact. Until it exists the hostname is answered by the catch-all block holding ANOTHER site's
 *  certificate, which a browser rejects outright, so the address is presented as usable HTTPS only against
 *  an observed certificate: `ready` means a TLS handshake established that the gateway serves THIS
 *  hostname's certificate, and nothing weaker earns the plain address line. */
const publishedAddressLines = (address: string | null, certificate: SiteCertificateReadiness): string[] => {
  if (address === null) return [`The public hostname is unavailable: ${certificate.detail}.`];
  if (certificate.state === 'ready') return [`Address: ${address}`, `Certificate: verified - ${certificate.detail}.`];
  if (certificate.state === 'error') {
    return [`Address: ${address} - NOT usable over HTTPS.`, `Certificate error: ${certificate.detail}.`];
  }
  return [`Address: ${address} - not usable over HTTPS yet.`, `Certificate pending: ${certificate.detail}.`];
};

/** What an environment has instead of a publish.
 *
 *  SitePublish refuses an environment outright, so its `lastPublishAt` stays null forever. Reading the
 *  summary line from that field therefore reported "snapshot never" to an agent that had just taken one.
 *  Releases come back newest first. */
const latestSnapshotAt = (store: SitesStore, site: Site): string | null => (site.runtime !== 'environment'
  ? null
  : store.releases(site.id).find((release) => release.kind === 'environment-snapshot')?.createdAt ?? null);

/** What a proxy publication is, in the words its reader needs.
 *
 *  A proxy publication has no release and no container of its own, so the two facts that matter are the
 *  port inside the Project and which Project that is. It prints nothing at all for a static publication,
 *  whose summary already says everything it has. The last line is the answer to the question an agent
 *  actually has when a site of this kind misbehaves — whose environment is this, and where do I look at
 *  it — and it is phrased as one line so it survives being read out of a longer summary. */
const projectLines = (
  site: Site,
  project?: { slug: string | null; executionKind?: string; environment?: ProjectEnvironmentView | null } | null,
): string[] => {
  if (site.kind !== 'proxy') return [];
  const name = project?.slug ?? `Project ${site.projectId}`;
  const state = project?.environment;
  return [
    `  kind       proxy`,
    `  target     ${site.target || '(no port)'} inside the Project`,
    `  project    ${name}${project?.executionKind ? ` (${project.executionKind})` : ''}`,
    ...(state ? [`  environment ${state.state ?? 'unknown'}${state.lastError ? ` - ${state.lastError}` : ''}`] : []),
    `  Served by the environment of project ${name}`,
  ];
};

const describe = (
  site: Site,
  config: SitesConfig,
  environment?: EnvironmentState,
  lastSnapshotAt?: string | null,
  project?: { slug: string | null; path?: string; executionKind?: string; environment?: ProjectEnvironmentView | null } | null,
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
    ...(site.runtime === 'command' ? [`  runtime    ${site.bind}${site.port === null ? '' : ` 127.0.0.1:${site.port}`} · ${config.runtimeNetwork} network`] : []),
    ...(site.runtime === 'environment' ? [
      `  environment ${environment?.state ?? 'unknown'} · desired ${site.environmentDesiredState ?? 'running'} · ${config.environmentNetwork} network`,
      `  limits      ${environment?.limits.cpus ?? site.environmentCpus ?? config.environmentCpus} CPU · ${environment?.limits.memoryMb ?? site.environmentMemoryMb ?? config.environmentMemoryMb} MB · ${environment?.limits.pidsLimit ?? site.environmentPidsLimit ?? config.environmentPidsLimit} PIDs`,
    ] : []),
    site.kind === 'proxy'
      ? `  published  ${site.lastPublishAt ?? 'never'}${site.lastPublishAt && site.lastPublishModel ? ` by ${site.lastPublishModel}` : ''}`
      : site.runtime === 'environment'
        ? `  snapshot   ${lastSnapshotAt ?? 'never'}`
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
    description: 'Create a site and its Project source folder. Static, command and PHP sites remain drafts until SitePublish. A proxy publication forwards to an application that already runs inside the selected managed Project on the port given in target. Existing persistent environment sites remain supported, but new environments are created and managed at Project level.',
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
      runtime: Type.Optional(Type.Union(
        [Type.Literal('static'), Type.Literal('command'), Type.Literal('php')],
        { description: 'How a file publication answers. Persistent application environments are created and managed by the selected Project.' },
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
        const runtime = (input.runtime as 'static' | 'command' | 'php' | undefined) ?? 'static';
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
          if (runtime !== 'static') {
            throw new ToolError('A proxy publication has no runtime of its own; the application runs in the Project environment. Send kind "proxy" with the port in target, and leave runtime out.');
          }
          if (!/^\d+$/.test(target) || Number(target) < 1 || Number(target) > 65535) {
            throw new ToolError('A proxy publication needs target: the TCP port the application listens on at 127.0.0.1 inside the Project, for example "3000".');
          }
          const selected = ctx.currentAccess().projectRef;
          if (selected?.kind !== 'managed') {
            throw new ToolError('A proxy publication is served by a managed Project environment, so select that Project before creating it.');
          }
          if (!ctx.control('sandbox')) throw new ToolError('The Sandbox environment runtime is unavailable.');
          if (store.countOwnedBy(userId) - store.countEnvironmentOwnedBy(userId) >= config.maxSitesPerAccount) {
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
            runtime: 'static',
            startCommand: '',
            bind: 'socket',
            port: null,
            environmentCpus: null,
            environmentMemoryMb: null,
            environmentPidsLimit: null,
            environmentDesiredState: 'running',
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
            'Nothing is copied: the published page is the application itself, reached through the Project environment.',
            'Start, stop, snapshots and logs belong to that environment, not to this publication.',
          ].join('\n'), {
            siteId: site.id, slug: site.slug, kind: site.kind, target: site.target,
            projectId: site.projectId, projectSlug: project.slug, url: address,
            visibility: site.visibility,
          });
        }
        if (store.countOwnedBy(userId) - store.countEnvironmentOwnedBy(userId) >= config.maxSitesPerAccount) {
          throw new ToolError(`This account already has ${config.maxSitesPerAccount} sites, which is the configured limit.`);
        }
        if (runtime !== 'static') {
          const refusal = commandRuntimeRefusal(config);
          if (refusal) throw new ToolError(refusal);
        }
        // Some models (GPT-5.6 on Azure among them) fill every optional property with its default or an
        // empty string — `startCommand: ""`, `bind: "socket"` — even when told to send only a title. A
        // refusal therefore keys on the VALUE, not on the key being present: only a real instruction
        // that contradicts the runtime is a mistake.
        const startCommand = input.startCommand?.trim() ?? '';
        if (runtime === 'command' && !startCommand) {
          throw new ToolError('A command site runtime needs startCommand.');
        }
        if (runtime === 'php' && startCommand) {
          throw new ToolError('A PHP site runs through PHP-CGI and does not take startCommand.');
        }
        const bind = input.bind === 'port' ? 'port' : 'socket';
        if (runtime !== 'command' && bind === 'port') {
          throw new ToolError('Only a command site has a runtime bind mode.');
        }
        if (bind === 'port' && !config.allowLoopbackPorts) {
          throw new ToolError('Loopback ports are turned off for this instance. Use socket mode or ask an administrator to enable them.');
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
          const sandbox = ctx.control('sandbox');
          if (!sandbox) throw new ToolError('The Sandbox environment runtime is unavailable.');
          allowed = dir;
          await sandbox.projectFiles({ project: { kind: 'managed', projectId }, accountUserId: userId, operation: { kind: 'mkdir', path: dir } });
        } else {
          try { allowed = ctx.assertPathAllowed(dir); }
          catch { throw new ToolError(`The site folder ${dir} is outside what this account may write to.`); }
          if (existsSync(allowed)) throw new ToolError(`${allowed} already exists.`);
          mkdirSync(allowed, { recursive: true });
        }
        const port = runtime === 'command' && bind === 'port' ? await deps.runtime.allocatePort() : null;

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
          runtime,
          startCommand,
          bind,
          port,
          environmentCpus: null,
          environmentMemoryMb: null,
          environmentPidsLimit: null,
          environmentDesiredState: 'running',
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
          basePath: SITE_BASE_PATH, url: address, visibility: site.visibility,
          runtime: site.runtime, bind: site.bind, port: site.port,
        });
      } catch (error) {
        throw error instanceof ToolError ? error : new Error(`Could not create the site: ${String(error)}`);
      }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'SiteExec',
    label: 'Run a command in a site environment',
    description: 'Run a shell script synchronously as root inside a running persistent environment. The command is sent on stdin and never appears in the host process argv.',
    parameters: Type.Object({
      site: Type.String({ description: 'Environment slug or id.' }),
      command: Type.String({ minLength: 1, maxLength: 200_000, description: 'Bash script sent to /bin/bash on stdin.' }),
      timeoutSeconds: Type.Optional(Type.Number({ minimum: 1, maximum: 900, description: 'Execution timeout. Defaults to 120 seconds.' })),
      workdir: Type.Optional(Type.String({ description: 'Absolute normalized path inside the environment, such as /workspace.' })),
    }),
    execute: async (_id, input) => {
      const userId = ownerOf(ctx);
      const site = requireManaged(deps, input.site, userId);
      requireEnvironmentAuthority(deps, site, userId);
      if (site.kind === 'proxy') throw new ToolError(proxyRefusal('Run its commands in the Project environment with the Project shell and Sandbox tools.'));
      if (site.runtime !== 'environment') throw new ToolError('SiteExec works only with a persistent environment.');
      // Gate on an action that is still ACTIVE, not on the mere existence of a row. A failed action is
      // retained deliberately for display and retry ownership, and the store already lets a new action
      // replace an errored slot — so treating the retained row as "pending" was the inconsistent half: one
      // snapshot that could never quiesce locked the environment out of SiteExec permanently, with no
      // tool-reachable way to clear it. An errored action stays visible in SiteGet either way.
      const action = store.environmentAction(site.id);
      if ((action && action.lastError === null) || site.environmentDesiredState !== 'running') {
        throw new ToolError('SiteExec is unavailable while an environment action or lifecycle change is pending.');
      }
      const command = input.command;
      if (typeof command !== 'string' || command.length === 0 || command.includes('\0')) throw new ToolError('command must be non-empty text without NUL bytes.');
      const requestedTimeout = Number(input.timeoutSeconds ?? 120);
      if (!Number.isFinite(requestedTimeout)) throw new ToolError('timeoutSeconds must be a finite number.');
      const timeoutSeconds = Math.min(900, Math.max(1, Math.round(requestedTimeout)));
      const result = await deps.environment.exec(site, command, { timeoutSeconds, workdir: workdirOf(input.workdir), accountUserId: userId });
      return text([
        result.stdout,
        result.stderr ? `\n[stderr]\n${result.stderr}` : '',
        result.code === 0 ? '' : `\n[exit ${result.code}]`,
      ].join('').trim() || '(command produced no output)', { siteId: site.id, exitCode: result.code });
    },
  }));

  ctx.registerTool(defineTool({
    name: 'SiteControl',
    label: 'Control a site environment',
    description: 'Durably request start, stop or restart for a persistent environment. The daemon performs the broker-aware lifecycle even when this tool runs in a forked worker.',
    parameters: Type.Object({
      site: Type.String({ description: 'Environment slug or id.' }),
      action: Type.Union([Type.Literal('start'), Type.Literal('stop'), Type.Literal('restart')]),
    }),
    execute: async (_id, input) => {
      const userId = ownerOf(ctx);
      const site = requireManaged(deps, input.site, userId);
      requireEnvironmentAuthority(deps, site, userId);
      if (site.kind === 'proxy') throw new ToolError(proxyRefusal('Start, stop and restart belong to that Project, in the Sandbox plugin.'));
      if (site.runtime !== 'environment') throw new ToolError('SiteControl works only with a persistent environment.');
      const desired = input.action === 'stop' ? 'stopped' : input.action === 'restart' ? 'restarting' : 'running';
      await deps.environment.request(site, { kind: input.action }, userId);
      return text(`Scheduled ${input.action} for "${site.title}". The daemon will perform the durable lifecycle.`, {
        siteId: site.id, action: input.action, desiredState: desired, scheduled: true,
      });
    },
  }));

  ctx.registerTool(defineTool({
    name: 'SiteSnapshot',
    label: 'Snapshot a site environment',
    description: 'Schedule a crash-consistent environment snapshot and return its stable public id immediately. The root filesystem is committed while paused; /data is optionally exported while still paused. This is not a database-consistent backup.',
    parameters: Type.Object({
      site: Type.String({ description: 'Environment slug or id.' }),
      note: Type.Optional(Type.String({ maxLength: 200 })),
      includeData: Type.Optional(Type.Boolean({ description: 'Export /data into the snapshot. Defaults to true.' })),
    }),
    execute: async (_id, input) => {
      const userId = ownerOf(ctx);
      const site = requireManaged(deps, input.site, userId);
      requireEnvironmentAuthority(deps, site, userId);
      if (site.kind === 'proxy') throw new ToolError(proxyRefusal('A snapshot of that Project belongs to the Project, in the Sandbox plugin.'));
      if (site.runtime !== 'environment') throw new ToolError('SiteSnapshot works only with a persistent environment.');
      const scheduled = await scheduleExclusively(() => deps.environment.scheduleSnapshot(site, {
        includeData: input.includeData !== false,
        note: (input.note ?? '').trim().slice(0, 200),
        model: modelLabel(ctx),
      }, userId));
      return text([
        `Scheduled crash-consistent snapshot ${scheduled.id} for "${site.title}".`,
        'The daemon performs the snapshot; the release appears in SiteGet once it completes.',
        'Applications with databases still need their own database-consistent backup procedure.',
      ].join('\n'), { siteId: site.id, snapshotId: scheduled.id, scheduled: true });
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
        if (site.runtime === 'environment') {
          throw new ToolError('Persistent environments keep their own root filesystem and cannot be published as file releases. Use SiteExec and SiteSnapshot.');
        }
        if (site.runtime === 'unsupported') throw new ToolError(`This site has an unsupported runtime: ${site.unsupportedRuntime ?? 'unknown'}.`);

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
            throw new ToolError(`The Project environment could not be reached, so nothing was published: ${message}`);
          }
          const probe = await deps.publications.probe(socketPath);
          if (!probe.answered || probe.status === null || probe.status >= 500) {
            const message = probe.answered
              ? `127.0.0.1:${port} inside the Project answered with an unhealthy status (${probe.detail})`
              : `nothing answered on 127.0.0.1:${port} inside the Project (${probe.detail})`;
            store.updateSite(site.id, { status: 'failed', lastError: message });
            throw new ToolError(`Not published: ${message}. Start or fix the application in the Project environment, then call SitePublish again.`);
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
            'Nothing was copied, so the address always shows what the application serves right now. Restarting, snapshotting and reading its logs happen in the Project environment.',
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
        const exported = join(deps.siteDir(site.id), 'exports', releaseId);
        let exportCompleted = false;
        try {
          if (managed) {
            mkdirSync(dirname(exported), { recursive: true, mode: 0o700 });
            await deps.environment.exportProject(site, { kind: 'managed', projectId: site.projectId }, source, exported, userId);
            exportCompleted = true;
          }
          snapshot = snapshotRelease(managed ? exported : source, target, {
            maxAssetBytes: config.maxAssetBytes,
            maxTotalBytes: config.maxSiteBytes,
            mode: site.runtime,
          });
        } catch (error) {
          rmSync(target, { recursive: true, force: true });
          store.updateSite(site.id, { status: site.currentReleaseId ? 'live' : 'failed', lastError: error instanceof Error ? error.message : String(error) });
          throw new ToolError(error instanceof PublishError ? `Publish refused: ${error.message}` : `Publish failed: ${String(error)}`);
        } finally {
          if (exportCompleted) rmSync(exported, { recursive: true, force: true });
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

        // After the release is the live one and any runtime restart has succeeded: a certificate for a
        // hostname whose publish then failed would be issued for a page nobody published.
        const certificate = await deps.certificates.publish(site);

        return text([
          `Published "${site.title}" - ${snapshot.fileCount} files, ${(snapshot.sizeBytes / 1048576).toFixed(2)} MB.`,
          ...publishedAddressLines(address, certificate),
          `Visible to: ${site.visibility}`,
          ...(site.runtime === 'command' && !isDaemonProcess()
            ? ['The daemon starts the runtime shortly; check SiteLogs if the address does not answer.']
            : []),
          ...(warnings.length > 0 ? ['', 'Warnings:', ...warnings.map((line) => `  - ${line}`)] : []),
        ].join('\n'), {
          siteId: site.id, slug: site.slug, releaseId, url: address,
          visibility: site.visibility, fileCount: snapshot.fileCount, sizeBytes: snapshot.sizeBytes, warnings,
          certificate,
        });
      } catch (error) {
        throw error instanceof ToolError ? error : new Error(`Could not publish: ${String(error)}`);
      }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'SiteList',
    label: 'List sites',
    description: 'List owned sites with address, visibility and runtime state. Persistent environments include desired state and effective limits.',
    parameters: Type.Object({}),
    execute: async () => {
      try {
        const userId = ownerOf(ctx);
        const config = deps.config();
        const sites = store.sitesOwnedBy(userId);
        if (sites.length === 0) return text('This account has no sites yet.');
        const rows = await Promise.all(sites.map(async (site) => ({
          site,
          environment: site.runtime === 'environment' ? await deps.environment.state(site, userId) : undefined,
        })));
        return text(rows.map((row) => describe(row.site, config, row.environment, latestSnapshotAt(store, row.site), projectOf(row.site))).join('\n\n'), {
          sites: rows.map((row) => ({
            id: row.site.id,
            slug: row.site.slug,
            kind: row.site.kind,
            target: row.site.target,
            runtime: row.site.runtime,
            ...(row.environment ? { environment: row.environment } : {}),
          })),
        });
      } catch (error) {
        throw error instanceof ToolError ? error : new Error(String(error));
      }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'SiteGet',
    label: 'Read a site',
    description: 'Full site detail including source, visibility and releases. A proxy publication also reports the Project whose environment serves it and that environment\'s state. Persistent environments include actual and desired state, effective limits and snapshot ids.',
    parameters: Type.Object({ site: Type.String({ description: 'Which site: its slug (as shown in the address and in SiteList) or its id. Both work.' }) }),
    execute: async (_id, input) => {
      try {
        const userId = ownerOf(ctx);
        const site = deps.access.isAdmin(userId)
          ? requireManaged(deps, input.site, userId)
          : requireOwned(deps, input.site, userId);
        // An administrator reads the operational detail of what an account published just as they do for
        // an environment: helping with a page nobody can open is exactly when that is needed.
        if (site.ownerUserId !== userId && site.runtime !== 'environment' && site.kind !== 'proxy') {
          throw new ToolError('Only the site owner may read this site detail.');
        }
        const config = deps.config();
        const releases = store.releases(site.id);
        const environment = site.runtime === 'environment' ? await deps.environment.state(site, userId) : undefined;
        const environmentAction = site.runtime === 'environment' ? await deps.environment.pendingAction(site, userId) : null;
        // What serves this publication, read through the account the Project belongs to rather than through
        // whoever is asking: the environment seam answers per account, and a reader of a site is not
        // necessarily a member of its Project.
        const project = ctx.host.stores().projects.get(site.projectId);
        const projectEnvironmentState = site.kind === 'proxy' && project
          ? await deps.projectEnvironment(project.id, userId)
          : null;
        const projectInfo = project
          ? { slug: project.slug, path: project.path, executionKind: project.executionKind, environment: projectEnvironmentState }
          : null;
        const people = deps.people();
        const guests = store.memberIds(site.id)
          .map((id) => ({ id, name: people.get(id)?.name || people.get(id)?.username || `#${id}` }));
        // One handshake for the one site being read. A published page that a browser refuses is the single
        // most useful thing this tool can report, and it is only true if it is observed each time.
        const certificate = site.status === 'live' ? await deps.certificates.readiness(site) : null;
        return text([
          describe(site, config, environment, latestSnapshotAt(store, site), projectInfo),
          `  base path  ${SITE_BASE_PATH}`,
          ...(certificate ? [`  certificate ${certificate.state} - ${certificate.detail}`] : []),
          `  guests     ${guests.length === 0 ? 'none' : guests.map((guest) => guest.name).join(', ')}`,
          '',
          site.kind === 'proxy'
            ? `Releases: none. A proxy publication serves whatever the application inside project ${project?.slug ?? site.projectId} is running right now.`
            : releases.length === 0
              ? 'No releases yet.'
              : ['Releases:', ...releases.map((release) => release.kind === 'environment-snapshot'
                ? `  ${release.id}  ${release.createdAt}  environment snapshot${release.dataArchive || store.runtimeRecord(site.id, `snapshot-data:${release.id}`) === 'true' ? ' with /data' : ''}${release.note ? `  ${release.note}` : ''}`
                : `  ${release.id}  ${release.createdAt}  ${release.fileCount} files  ${(release.sizeBytes / 1048576).toFixed(2)} MB${release.note ? `  ${release.note}` : ''}`)].join('\n'),
          environmentAction ? `\nPending action: ${environmentAction.kind} ${environmentAction.snapshotId}${environmentAction.lastError ? `\nAction error: ${environmentAction.lastError}` : ''}` : '',
          site.lastError ? `\nLast error: ${site.lastError}` : '',
        ].join('\n'), {
          siteId: site.id, slug: site.slug, url: siteUrl(config, site.slug), visibility: site.visibility,
          status: site.status, degraded: site.status === 'live' && site.lastError !== null,
          sourceDir: project?.executionKind === 'managed' ? posix.join(`/${project.slug}`, site.sourceRel) : project ? join(project.path, ...site.sourceRel.split('/')) : site.sourceRel,
          basePath: SITE_BASE_PATH, kind: site.kind, target: site.target,
          runtime: site.runtime, startCommand: site.startCommand, bind: site.bind, port: site.port,
          network: site.runtime === 'environment' ? config.environmentNetwork : config.runtimeNetwork,
          guests, currentReleaseId: site.currentReleaseId,
          ...(certificate ? { certificate } : {}),
          ...(projectInfo ? { project: { id: site.projectId, ...projectInfo } } : {}),
          ...(environment ? { environment, environmentAction } : {}),
          releases: releases.map((release) => ({
            id: release.id, createdAt: release.createdAt, note: release.note, kind: release.kind,
            ...(release.kind === 'environment-snapshot' ? { snapshotId: release.id, includesData: Boolean(release.dataArchive) || store.runtimeRecord(site.id, `snapshot-data:${release.id}`) === 'true' } : {}),
          })),
        });
      } catch (error) {
        throw error instanceof ToolError ? error : new Error(String(error));
      }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'SiteUpdate',
    label: 'Update a site',
    description: 'Change a site\'s title, summary, router behaviour, command runtime, visibility or, for an administrator, the resource limits of a persistent environment. Visibility cannot be set to public here: making a site readable by anyone is confirmed by a person in the Sites screen.',
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
      environmentCpus: Type.Optional(Type.Union([Type.Number(), Type.Null()], {
        description: 'Administrator only, environment sites: CPU limit, or null to return to the instance default. Values outside the instance bounds are clamped.',
      })),
      environmentMemoryMb: Type.Optional(Type.Union([Type.Number(), Type.Null()], {
        description: 'Administrator only, environment sites: memory limit in MB, or null for the instance default.',
      })),
      environmentPidsLimit: Type.Optional(Type.Union([Type.Number(), Type.Null()], {
        description: 'Administrator only, environment sites: maximum processes and threads, or null for the instance default.',
      })),
    }),
    execute: async (_id, input) => {
      try {
        const userId = ownerOf(ctx);
        const site = requireOwned(deps, input.site, userId);
        const patch: Parameters<SitesStore['updateSite']>[1] = {};
        // The same gate, the same validator and the same apply seam as the Sites screen: a tool must not
        // be a second way to size an environment, nor a way past the bounds the settings schema declares.
        const limitKeys = ['environmentCpus', 'environmentMemoryMb', 'environmentPidsLimit'] as const;
        const raw = input as Record<string, unknown>;
        let limits: EnvironmentLimitOverrides | null = null;
        if (limitKeys.some((key) => raw[key] !== undefined)) {
          if (!deps.access.isAdmin(userId)) throw new ToolError('Environment resource limits may only be changed by an administrator.');
          // Resource limits belong to the Project's environment, which every publication of that Project
          // shares. Sizing "this site" does not exist in this model, so saying so beats a bounds error.
          if (site.kind === 'proxy') {
            throw new ToolError('A proxy publication has no environment limits of its own; set them on the Project environment in the Sandbox plugin.');
          }
          if (site.runtime !== 'environment') throw new ToolError('Only an environment has resource limits.');
          try {
            limits = environmentLimitOverrides(Object.fromEntries(
              limitKeys.filter((key) => raw[key] !== undefined).map((key) => [key, raw[key]]),
            ));
          } catch (error) {
            throw new ToolError(error instanceof Error ? error.message : 'Invalid environment limits.');
          }
        }
        if (input.title !== undefined) patch.title = input.title.trim();
        if (input.summary !== undefined) patch.summary = input.summary.trim();
        if (input.spa !== undefined) patch.spa = input.spa;
        let runtimeChanged = false;
        // As in SiteCreate: a model that echoes every optional property sends `startCommand: ""` and the
        // site's current bind mode along with a title change, so only a VALUE that would actually alter
        // the runtime counts as a runtime instruction.
        const commandInput = input.startCommand?.trim() ?? '';
        const bindInput = input.bind !== undefined && input.bind !== site.bind ? input.bind : undefined;
        if (commandInput || bindInput !== undefined) {
          if (site.runtime !== 'command') throw new ToolError('Only a command site has runtime settings.');
          if (commandInput) {
            patch.startCommand = commandInput;
            runtimeChanged = commandInput !== site.startCommand;
          }
          if (bindInput !== undefined) {
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
        // Limits first, and only then the ordinary patch: applying them talks to the container runtime and
        // can fail, and a title that had already been written would leave the caller holding a bare error
        // over a half-changed site.
        if (limits) {
          try {
            await deps.environment.applyLimits(site, limits, userId);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new ToolError(`The environment limits could not be applied, so nothing else was changed: ${message}`);
          }
        }
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
        if (!updated) return text('Updated.');
        // Report what the environment now actually runs with, not what was asked for: the values were
        // clamped, and an agent sizing a container has to read back the ceiling it was given.
        const environment = updated.runtime === 'environment' ? await deps.environment.state(updated, userId) : undefined;
        return text(
          `Updated.\n\n${describe(updated, deps.config(), environment, latestSnapshotAt(store, updated), projectOf(updated))}`,
          environment ? { limits: environment.limits } : {},
        );
      } catch (error) {
        throw error instanceof ToolError ? error : new Error(String(error));
      }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'SiteRollback',
    label: 'Roll back a site',
    description: 'Restore a retained file release, or durably schedule restoration of an environment snapshot with optional /data replacement.',
    parameters: Type.Object({
      site: Type.String({ description: 'Which site: its slug or id.' }),
      releaseId: Type.String({ description: 'File release or environment snapshot id from SiteGet.' }),
      restoreData: Type.Optional(Type.Boolean({ description: 'For environment snapshots, replace /data from the snapshot archive.' })),
    }),
    execute: async (_id, input) => {
      try {
        const userId = ownerOf(ctx);
        const site = requireManaged(deps, input.site, userId);
        if (site.kind === 'proxy') throw new ToolError(proxyRefusal('Read that Project environment\'s logs in the Sandbox plugin.'));
        const release = store.release(site.id, input.releaseId);
        if (!release) throw new ToolError('That release is not retained for this site.');
        if (site.runtime === 'environment') {
          requireEnvironmentAuthority(deps, site, userId);
          if (release.kind !== 'environment-snapshot') {
            throw new ToolError('That release is not an environment snapshot retained for this site.');
          }
          if (input.restoreData === true && !release.dataArchive && store.runtimeRecord(site.id, `snapshot-data:${release.id}`) !== 'true') {
            throw new ToolError('That snapshot does not include a verified /data archive.');
          }
          await scheduleExclusively(() => deps.environment.scheduleRestore(site, release.id, input.restoreData === true, userId));
          return text(`Scheduled restore of snapshot ${release.id} for "${site.title}". The daemon will perform the broker-aware rollback; the current pointer moves when the restore completes.`, {
            siteId: site.id, snapshotId: release.id, restoreData: input.restoreData === true, scheduled: true,
          });
        }
        if (site.ownerUserId !== userId) throw new ToolError('Only the site owner may roll back a file release.');
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
    description: 'Read command runtime output or an environment lifecycle log plus its bounded systemd journal tail. Static sites have no runtime log.',
    parameters: Type.Object({
      site: Type.String({ description: 'Which site: its slug or id.' }),
      lines: Type.Optional(Type.Number({ minimum: 1, maximum: 1000, description: 'Journal lines for an environment. Defaults to 200.' })),
    }),
    execute: async (_id, input) => {
      try {
        const userId = ownerOf(ctx);
        const site = requireManaged(deps, input.site, userId);
        if (site.kind === 'proxy') throw new ToolError(proxyRefusal('Its output is the Project environment\'s journal, read in the Sandbox plugin.'));
        if (site.runtime === 'environment') {
          if (!deps.access.isAdmin(userId) && !deps.access.canAccessProject(userId, site.projectId)) {
            throw new ToolError('Current Project access is required to read environment logs.');
          }
          const state = await deps.environment.state(site, userId);
          const logs = await deps.environment.logs(site, Math.min(1000, Math.max(1, Math.round(Number(input.lines ?? 200)))), userId);
          return text([
            `"${site.title}" is ${state.state ?? 'not created'}; desired ${state.desiredState}.`,
            site.lastError ? `Last error: ${site.lastError}` : '',
            '',
            '[lifecycle]',
            logs.lifecycle || '(no lifecycle output recorded)',
            '',
            '[journal]',
            logs.journal || '(environment is not running or journal is empty)',
          ].join('\n'), { siteId: site.id, environment: state });
        }
        if (site.ownerUserId !== userId) throw new ToolError('Only the site owner may read this runtime log.');
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
        throw error instanceof ToolError ? error : new Error(String(error));
      }
    },
  }));
}
