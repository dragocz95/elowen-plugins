import { randomBytes, randomUUID } from 'node:crypto';
import type { SandboxControl } from 'elowen/plugin-api';
import { cookieName, type AccessDeps, type Viewer } from './access.js';
import type { SitesHttpRequest, SitesHttpResponse } from './coreSeams.js';
import type { ProjectPreview, Site, SitesStore } from './store.js';
import type { SitesConfig } from './config.js';
import { proxyToProject, type ProxyLimits } from './proxy.js';
import type { SiteAddressService } from './address.js';
import type { SitesGatewayBinding, SitesGatewayStatus } from './coreSeams.js';
import { requireSandbox } from './sandboxControl.js';

export interface PreviewDeps {
  store: SitesStore;
  access: AccessDeps;
  project(id: number): { executionKind: string; lifecycle: string } | null | undefined;
  control(): Pick<SandboxControl, 'projectPreviewBinding'> | undefined;
  config(): SitesConfig;
  addresses: SiteAddressService;
  gateway: {
    reconcile(bindings: readonly SitesGatewayBinding[]): Promise<SitesGatewayStatus>;
    ensureBinding(binding: SitesGatewayBinding, bindings: readonly SitesGatewayBinding[]): Promise<unknown>;
    removeBinding(hostname: string, slug: string, bindings: readonly SitesGatewayBinding[]): Promise<unknown>;
    hasCertificate(hostname: string): boolean;
  };
  proxyLimits(): ProxyLimits;
  usernameOf(id: number): string | null;
  proxy?: typeof proxyToProject;
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
    const control = requireSandbox(this.deps.control());
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
    const bindings = this.deps.addresses.bindings();
    const address = bindings.find((entry) => entry.siteId === preview.id && entry.class === 'generated');
    if (!address) throw new Error('the isolated Sites origin is unavailable');
    const synced = await this.deps.gateway.reconcile(bindings);
    if (!synced.available || !synced.active) throw new Error(synced.detail ?? 'the isolated Sites gateway is unavailable');
    await this.deps.gateway.ensureBinding(address, bindings);
    const url = this.deps.addresses.urlForHostname(address.hostname);
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
      sourceRel: '', spa: false, kind: 'proxy', target: String(preview.port),
      status: 'live', currentReleaseId: null, createdAt: preview.createdAt, updatedAt: preview.createdAt,
      createdModel: '', lastPublishAt: null, lastPublishModel: null, lastError: null,
      primaryCustomHostnameId: null };
  }
  async serve(site: Site, req: SitesHttpRequest, rest: string, viewer: Viewer, siteRoot: string): Promise<SitesHttpResponse> {
    const denied = (): SitesHttpResponse => ({ status: 404, headers: { 'cache-control': 'no-store' }, body: '' });
    const preview = this.deps.store.previewById(site.id);
    if (!preview || viewer.userId === null || !this.allowed(preview.projectId, viewer.userId)) return denied();
    // Deliberately NOT `requireSandbox`: this is a browser request from a visitor, and a plugin the
    // reader cannot switch on is not their answer. The unavailability is reported as the transport
    // status it is, and the operator gets the named refusal on every path they can act on.
    const control = this.deps.control();
    if (!control) return { status: 503, headers: { 'cache-control': 'no-store' }, body: 'The managed Project transport is unavailable.' };
    let binding;
    try {
      binding = await control.projectPreviewBinding({ project: { kind: 'managed', projectId: preview.projectId }, accountUserId: viewer.userId, port: preview.port });
      if (binding.projectId !== preview.projectId || binding.port !== preview.port) throw new Error('preview binding identity mismatch');
      const response = await (this.deps.proxy ?? proxyToProject)({ kind: 'socket', path: binding.socketPath }, req, rest,
        { userId: viewer.userId, name: this.deps.usernameOf(viewer.userId) }, this.deps.proxyLimits(), siteRoot, [cookieName(site.id)]);
      // The proxy buffers a bounded response. Revocation during that await must discard it too.
      if (!this.allowed(preview.projectId, viewer.userId)) return denied();
      return { ...response, headers: { ...response.headers, 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex, nofollow' } };
    } catch {
      return { status: 503, headers: { 'cache-control': 'no-store' }, body: 'The project preview is unavailable.' };
    } finally { await binding?.release(); }
  }
  async syncGateway(renew: boolean): Promise<void> {
    const bindings = this.deps.addresses.bindings();
    const synced = await this.deps.gateway.reconcile(bindings);
    if (!synced.available || !synced.active) return;
    for (const preview of this.deps.store.allPreviews()) {
      if (!this.active(preview.projectId)) continue;
      const binding = bindings.find((entry) => entry.siteId === preview.id && entry.class === 'generated');
      if (binding && (renew || !this.deps.gateway.hasCertificate(binding.hostname))) {
        await this.deps.gateway.ensureBinding(binding, bindings);
      }
    }
  }
  async removeProject(projectId: number): Promise<void> {
    const previews = this.deps.store.previewsInProject(projectId);
    const hostnameBase = this.deps.config().siteHostBase;
    const remaining = this.deps.addresses.bindings(
      Date.now(),
      new Set(previews.map((preview) => preview.id)),
    );
    if (hostnameBase) {
      for (const preview of previews) {
        await this.deps.gateway.removeBinding(
          `${preview.slug}.${hostnameBase}`,
          preview.slug,
          remaining,
        );
      }
    }
    this.deps.store.deletePreviews(projectId);
  }
}
