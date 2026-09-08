import { join } from 'node:path';
import type { SiteEnvironmentRegistration, SiteRuntimeAuthority } from 'elowen/plugin-api';
import type { AccessDeps } from './access.js';
import type { SitesStore } from './store.js';

interface SiteRuntimeAuthorityDeps {
  store: Pick<SitesStore, 'siteById' | 'conversionSuspends'>;
  access: AccessDeps;
  /** The durable handover binding, never a model-supplied container or mount specification. */
  registration(siteId: string): SiteEnvironmentRegistration | null;
  gateway(): {
    prepareRuntimeSocket(siteId: string): Promise<{ path: string }>;
    removeRuntimeSocket(siteId: string): Promise<void>;
  } | undefined;
}

/** Sites retains resource authority and ingress preparation. Sandbox alone owns runtime lifecycle. */
export function createSiteRuntimeAuthority(deps: SiteRuntimeAuthorityDeps): SiteRuntimeAuthority {
  const bindingFor = (siteId: string): SiteEnvironmentRegistration => {
    const site = deps.store.siteById(siteId);
    const binding = deps.registration(siteId);
    if (!site || !binding || binding.siteId !== site.id || binding.projectId !== site.projectId
      || binding.sourcePath !== site.sourceDir) {
      throw new Error('the site runtime handover binding is unavailable or no longer matches the site');
    }
    return binding;
  };
  const gateway = (): NonNullable<ReturnType<SiteRuntimeAuthorityDeps['gateway']>> => {
    const control = deps.gateway();
    if (!control) throw new Error('the published-sites socket broker is unavailable');
    return control;
  };
  return {
    async resolve({ siteId, accountUserId }) {
      const site = deps.store.siteById(siteId);
      if (!site || site.runtime !== 'environment' || !deps.access.accountExists(accountUserId)) return null;
      // Runtime logs and commands are privileged even when the published application is public.
      // Project membership grants application access, not ownership of an independently published Site.
      const admin = deps.access.isAdmin(accountUserId);
      if (!admin && (site.ownerUserId !== accountUserId || !deps.access.canAccessProject(accountUserId, site.projectId))) return null;
      return bindingFor(siteId);
    },
    async beforeStart(siteId) {
      const site = deps.store.siteById(siteId);
      if (!site || site.runtime !== 'environment' || site.status === 'deleting') {
        throw new Error('the site is absent, deleting, or not a persistent environment');
      }
      if (deps.store.conversionSuspends(siteId) === 'environment') {
        throw new Error('the site runtime is suspended by a conversion');
      }
      const binding = bindingFor(siteId);
      const prepared = await gateway().prepareRuntimeSocket(siteId);
      if (prepared.path !== join(binding.brokerDir, 'app.sock')) {
        throw new Error('the site runtime socket does not match the handover binding');
      }
      // Socket sealing and application probes happen after startup, in Sites readiness handling.
    },
    async afterStop(siteId) {
      bindingFor(siteId);
      await gateway().removeRuntimeSocket(siteId);
    },
  };
}
