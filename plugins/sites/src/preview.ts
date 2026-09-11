import { randomBytes, randomUUID } from 'node:crypto';
import type { SandboxControl } from 'elowen/plugin-api';
import { cookieName, type AccessDeps, type Viewer } from './access.js';
import type { SitesHttpRequest, SitesHttpResponse } from './coreSeams.js';
import type { ProjectPreview, Site, SitesStore } from './store.js';
import type { SitesConfig } from './config.js';
import { siteUrl } from './config.js';
import { proxyToEnvironment, type ProxyLimits } from './proxy.js';

export interface PreviewDeps {
  store: SitesStore;
  access: AccessDeps;
  project(id: number): { executionKind: string; lifecycle: string } | null | undefined;
  control(): Pick<SandboxControl, 'projectPreviewBinding'> | undefined;
  config(): SitesConfig;
  gateway: { ensureSite(slug: string): Promise<unknown>; removeSite(slug: string): Promise<unknown> };
  proxyLimits(): ProxyLimits;
  usernameOf(id: number): string | null;
  proxy?: typeof proxyToEnvironment;
}

/** Preview records contain no ownership or visibility grants. Current Project membership is authority. */
export class ProjectPreviewService {
  constructor(private readonly deps: PreviewDeps) {}
  private active(projectId: number): boolean {
    const project = this.deps.project(projectId);
    return project?.executionKind === 'managed' && project.lifecycle === 'active';
  }
  private allowed(projectId: number, accountUserId: number): boolean {
    return this.active(projectId) && this.deps.access.accountExists(accountUserId)
      && (this.deps.access.isAdmin(accountUserId) || this.deps.access.canAccessProject(accountUserId, projectId));
  }
  async request(projectId: number, port: number, accountUserId: number): Promise<{ url: string; projectId: number; port: number }> {
    if (!Number.isSafeInteger(projectId) || !Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('invalid Project preview port or identity');
    if (!this.allowed(projectId, accountUserId)) throw new Error('current managed Project access is required');
    const control = this.deps.control();
    if (!control) throw new Error('the Sandbox environment runtime is unavailable');
    // Resolve the actual running target before creating an address. This lease never becomes a URL.
    const binding = await control.projectPreviewBinding({ project: { kind: 'managed', projectId }, accountUserId, port });
    await binding.release();
    if (binding.projectId !== projectId || binding.port !== port) throw new Error('preview binding identity mismatch');
    let preview = this.deps.store.projectPreview(projectId, port);
    if (!preview) {
      this.deps.store.insertPreview({ id: randomUUID(), slug: `preview-${randomBytes(12).toString('hex')}`, projectId, port, createdAt: new Date().toISOString() });
      preview = this.deps.store.projectPreview(projectId, port);
    }
    if (!preview) throw new Error('the Project preview record could not be created');
    const url = siteUrl(this.deps.config(), preview.slug);
    if (!url) throw new Error('the isolated Sites origin is unavailable');
    await this.deps.gateway.ensureSite(preview.slug);
    if (!this.allowed(projectId, accountUserId)) throw new Error('Project access changed while preparing the preview');
    return { url, projectId, port };
  }
  siteBySlug(slug: string): Site | null {
    const preview = this.deps.store.previewBySlug(slug);
    return preview && this.active(preview.projectId) ? this.view(preview) : null;
  }
  isPreview(siteId: string): boolean { return this.deps.store.previewById(siteId) !== null; }
  private view(preview: ProjectPreview): Site {
    // `proxy` is the honest kind for a preview: it is served through the Project's own transport, not
    // from files. What makes a preview a preview is its record, and serving asks that before the kind,
    // so this value never decides how a preview is answered.
    return { id: preview.id, slug: preview.slug, projectId: preview.projectId, ownerUserId: 0,
      title: 'Project preview', summary: '', visibility: 'project', accessGeneration: 1,
      sourceRel: '', spa: false, kind: 'proxy', target: String(preview.port), runtime: 'environment',
      startCommand: '', bind: 'socket', port: null,
      status: 'live', currentReleaseId: null, createdAt: preview.createdAt, updatedAt: preview.createdAt,
      createdModel: '', lastPublishAt: null, lastPublishModel: null, lastError: null };
  }
  async serve(site: Site, req: SitesHttpRequest, rest: string, viewer: Viewer, siteRoot: string): Promise<SitesHttpResponse> {
    const denied = (): SitesHttpResponse => ({ status: 404, headers: { 'cache-control': 'no-store' }, body: '' });
    const preview = this.deps.store.previewById(site.id);
    if (!preview || viewer.userId === null || !this.allowed(preview.projectId, viewer.userId)) return denied();
    const control = this.deps.control();
    if (!control) return { status: 503, headers: { 'cache-control': 'no-store' }, body: 'The environment runtime is unavailable.' };
    let binding;
    try {
      binding = await control.projectPreviewBinding({ project: { kind: 'managed', projectId: preview.projectId }, accountUserId: viewer.userId, port: preview.port });
      if (binding.projectId !== preview.projectId || binding.port !== preview.port) throw new Error('preview binding identity mismatch');
      const response = await (this.deps.proxy ?? proxyToEnvironment)({ kind: 'socket', path: binding.socketPath }, req, rest,
        { userId: viewer.userId, name: this.deps.usernameOf(viewer.userId) }, this.deps.proxyLimits(), siteRoot, cookieName(site.id));
      // The proxy buffers a bounded response. Revocation during that await must discard it too.
      if (!this.allowed(preview.projectId, viewer.userId)) return denied();
      return { ...response, headers: { ...response.headers, 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex, nofollow' } };
    } catch {
      return { status: 503, headers: { 'cache-control': 'no-store' }, body: 'The project preview is unavailable.' };
    } finally { await binding?.release(); }
  }
  async syncGateway(issued: ReadonlySet<string>, renew: boolean): Promise<void> {
    for (const preview of this.deps.store.allPreviews()) {
      if (!this.active(preview.projectId)) continue;
      if (renew || !issued.has(preview.slug)) await this.deps.gateway.ensureSite(preview.slug);
    }
  }
  async removeProject(projectId: number): Promise<void> {
    const previews = this.deps.store.previewsInProject(projectId);
    this.deps.store.deletePreviews(projectId);
    for (const preview of previews) await this.deps.gateway.removeSite(preview.slug);
  }
}
