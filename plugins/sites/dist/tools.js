import { existsSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { join, resolve, sep } from 'node:path';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { VISIBILITIES } from './store.js';
import { mayPublish } from './access.js';
import { siteBasePath, siteUrl } from './config.js';
import { PublishError, pruneReleases, relativeAssetWarning, snapshotRelease } from './publish.js';
const text = (body) => ({ content: [{ type: 'text', text: body }], details: {} });
class ToolError extends Error {
}
const modelLabel = (ctx) => {
    const model = ctx.currentModel();
    if (!model)
        return '';
    return model.provider ? `${model.provider}/${model.model}` : model.model;
};
const ownerOf = (ctx) => {
    const userId = ctx.currentContributionUserId() ?? ctx.currentIdentity()?.elowenUserId ?? null;
    if (userId === null)
        throw new ToolError('This turn is not acting as an Elowen account, so there is nobody to own a site.');
    return userId;
};
const slugify = (title) => {
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
function resolveSourceRoot(ctx, slug) {
    const workDir = ctx.workDir();
    if (!workDir) {
        throw new ToolError('This conversation is not bound to a Project. Open a Project first, and create a Sandbox workspace if you want the site under version control.');
    }
    const real = (() => {
        try {
            return realpathSync(workDir);
        }
        catch {
            return workDir;
        }
    })();
    const project = ctx.host.stores().projects.list().find((entry) => {
        try {
            return realpathSync(entry.path) === real;
        }
        catch {
            return entry.path === workDir;
        }
    });
    if (!project)
        throw new ToolError('The current working directory does not belong to a registered Project.');
    const sessionId = ctx.currentSessionId();
    const workspace = sessionId
        ? ctx.control('sandbox')?.activeWorkspace({ sessionId, projectId: project.id }) ?? null
        : null;
    const base = workspace?.path ?? project.path;
    return { dir: join(base, 'sites', slug), projectId: project.id };
}
const requireOwned = (deps, siteId, userId) => {
    const site = deps.store.siteById(siteId);
    if (!site || site.ownerUserId !== userId)
        throw new ToolError(`No site of yours has the id ${siteId}.`);
    return site;
};
const describe = (site, config) => [
    `${site.title} (${site.slug})`,
    `  address    ${siteUrl(config, site.slug)}`,
    `  visibility ${site.visibility}`,
    `  status     ${site.status}`,
    site.lastPublishAt ? `  published  ${site.lastPublishAt}${site.lastPublishModel ? ` by ${site.lastPublishModel}` : ''}` : '  published  never',
    `  source     ${site.sourceDir}`,
].join('\n');
export function registerTools(deps) {
    const { ctx, store } = deps;
    const guardPublisher = (userId) => {
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
            visibility: Type.Optional(Type.Union([Type.Literal('private'), Type.Literal('project'), Type.Literal('authenticated')], { description: 'Who may open it. Defaults to the instance setting. A site is never made public here; that is confirmed by a person in the Sites screen.' })),
            spa: Type.Optional(Type.Boolean({ description: 'Serve index.html for unknown paths, for a client-side router. Default false.' })),
        }),
        execute: async (_id, input) => {
            try {
                const userId = ownerOf(ctx);
                guardPublisher(userId);
                const config = deps.config();
                if (store.countOwnedBy(userId) >= config.maxSitesPerAccount) {
                    throw new ToolError(`This account already has ${config.maxSitesPerAccount} sites, which is the configured limit.`);
                }
                let slug = slugify(input.title);
                while (store.slugTaken(slug))
                    slug = slugify(input.title);
                const { dir, projectId } = resolveSourceRoot(ctx, slug);
                let allowed;
                try {
                    allowed = ctx.assertPathAllowed(dir);
                }
                catch {
                    throw new ToolError(`The site folder ${dir} is outside what this account may write to.`);
                }
                if (existsSync(allowed))
                    throw new ToolError(`${allowed} already exists.`);
                mkdirSync(allowed, { recursive: true });
                const now = new Date().toISOString();
                const site = {
                    id: randomUUID(),
                    slug,
                    title: input.title.trim(),
                    summary: (input.summary ?? '').trim(),
                    projectId,
                    ownerUserId: userId,
                    visibility: input.visibility ?? config.defaultVisibility,
                    accessGeneration: 1,
                    sourceDir: allowed,
                    spa: input.spa === true,
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
                    'When the build output is ready, call SitePublish with the output directory.',
                ].join('\n'));
            }
            catch (error) {
                return text(error instanceof ToolError ? error.message : `Could not create the site: ${String(error)}`);
            }
        },
    }));
    ctx.registerTool(defineTool({
        name: 'SitePublish',
        label: 'Publish a site',
        description: 'Copy a finished build output into a new immutable release and make it the live one. Build the project yourself first; this publishes what is already on disk and runs nothing. Files are copied, so the site keeps working even if the workspace is later removed.',
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
                if (!existsSync(source))
                    throw new ToolError(`${source} does not exist. Build the project first.`);
                ctx.assertPathAllowed(source);
                const releaseId = randomUUID();
                const target = deps.releaseDir(site.id, releaseId);
                let snapshot;
                try {
                    snapshot = snapshotRelease(source, target, {
                        maxAssetBytes: config.maxAssetBytes,
                        maxTotalBytes: config.maxSiteBytes,
                    });
                }
                catch (error) {
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
                pruneReleases(store, site.id, deps.siteDir(site.id), config.releasesKept, releaseId);
                const warnings = [...snapshot.warnings];
                const relativeWarning = relativeAssetWarning(target, siteBasePath(site.slug));
                if (relativeWarning)
                    warnings.push(relativeWarning);
                return text([
                    `Published "${site.title}" - ${snapshot.fileCount} files, ${(snapshot.sizeBytes / 1048576).toFixed(2)} MB.`,
                    `Live at ${siteUrl(config, site.slug)}`,
                    `Visible to: ${site.visibility}`,
                    ...(warnings.length > 0 ? ['', 'Warnings:', ...warnings.map((line) => `  - ${line}`)] : []),
                ].join('\n'));
            }
            catch (error) {
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
                if (sites.length === 0)
                    return text('This account has no sites yet.');
                return text(sites.map((site) => describe(site, config)).join('\n\n'));
            }
            catch (error) {
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
            }
            catch (error) {
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
            visibility: Type.Optional(Type.Union([Type.Literal('private'), Type.Literal('project'), Type.Literal('authenticated')])),
        }),
        execute: async (_id, input) => {
            try {
                const userId = ownerOf(ctx);
                const site = requireOwned(deps, input.siteId, userId);
                const patch = {};
                if (input.title !== undefined)
                    patch.title = input.title.trim();
                if (input.summary !== undefined)
                    patch.summary = input.summary.trim();
                if (input.spa !== undefined)
                    patch.spa = input.spa;
                const nextVisibility = input.visibility;
                if (nextVisibility !== undefined && !VISIBILITIES.includes(nextVisibility)) {
                    throw new ToolError('Unknown visibility.');
                }
                const accessChanged = nextVisibility !== undefined && nextVisibility !== site.visibility;
                if (accessChanged)
                    patch.visibility = nextVisibility;
                store.updateSite(site.id, patch);
                if (accessChanged)
                    store.bumpAccessGeneration(site.id);
                const updated = store.siteById(site.id);
                return text(updated ? `Updated.\n\n${describe(updated, deps.config())}` : 'Updated.');
            }
            catch (error) {
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
                if (!release)
                    throw new ToolError('That release is not retained for this site.');
                store.updateSite(site.id, { currentReleaseId: release.id, status: 'live', lastError: null });
                return text(`"${site.title}" now serves the release from ${release.createdAt}.`);
            }
            catch (error) {
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
                rmSync(deps.siteDir(site.id), { recursive: true, force: true });
                store.deleteSite(site.id);
                return text(`Deleted "${site.title}". Its source folder ${site.sourceDir} was left in place.`);
            }
            catch (error) {
                return text(error instanceof ToolError ? error.message : String(error));
            }
        },
    }));
}
