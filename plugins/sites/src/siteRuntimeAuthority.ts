import { join } from 'node:path';
import type { SiteRuntimeArtifact, SiteRuntimeAuthority } from 'elowen/plugin-api';
import type { SitesSiteEnvironmentRegistration as SiteEnvironmentRegistration } from './coreSeams.js';
import type { AccessDeps } from './access.js';
import type { SitesStore } from './store.js';

export interface SeededSiteRuntimeAuthority extends SiteRuntimeAuthority {
  containerSeed?(siteId: string): Promise<Extract<SiteRuntimeArtifact, { kind: 'data' }> | null>;
}

interface SiteRuntimeAuthorityDeps {
  store: Pick<SitesStore, 'siteById' | 'conversionSuspends'>;
  access: AccessDeps;
  resolveArtifact?: SiteRuntimeAuthority['resolveArtifact'];
  imageRecipe?: SiteRuntimeAuthority['imageRecipe'];
  projectDependents?: SiteRuntimeAuthority['projectDependents'];
  beforeCreate?: SiteRuntimeAuthority['beforeCreate'];
  containerSeed?: SeededSiteRuntimeAuthority['containerSeed'];
  /** The durable handover binding, never a model-supplied container or mount specification. */
  registration(siteId: string): SiteEnvironmentRegistration | null | Promise<SiteEnvironmentRegistration | null>;
  gateway(): {
    prepareRuntimeSocket(siteId: string): Promise<{ path: string }>;
    removeRuntimeSocket(siteId: string): Promise<void>;
  } | undefined;
}

/** Sites retains resource authority and ingress preparation. Sandbox alone owns runtime lifecycle. */
export function createSiteRuntimeAuthority(deps: SiteRuntimeAuthorityDeps): SeededSiteRuntimeAuthority {
  const bindingFor = async (siteId: string): Promise<SiteEnvironmentRegistration> => {
    const site = deps.store.siteById(siteId);
    const binding = await deps.registration(siteId);
    if (!site || !binding || binding.siteId !== site.id || binding.projectId !== site.projectId
      || (binding.sourceRel !== undefined && binding.sourceRel !== site.sourceRel)) {
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
    resolveArtifact: deps.resolveArtifact,
    imageRecipe: deps.imageRecipe,
    projectDependents: deps.projectDependents,
    beforeCreate: deps.beforeCreate,
    containerSeed: deps.containerSeed,
    async resolve({ siteId, accountUserId }) {
      const site = deps.store.siteById(siteId);
      if (!site || !deps.access.accountExists(accountUserId)) return null;
      if (site.runtime !== 'environment' && !(await deps.registration(siteId))?.staging) return null;
      // Runtime logs and commands are privileged even when the published application is public.
      // Project membership grants application access, not ownership of an independently published Site.
      const admin = deps.access.isAdmin(accountUserId);
      if (!admin && (site.ownerUserId !== accountUserId || !deps.access.canAccessProject(accountUserId, site.projectId))) return null;
      return await bindingFor(siteId);
    },
    async beforeStart(siteId) {
      const site = deps.store.siteById(siteId);
      if (!site || site.runtime !== 'environment' || site.status === 'deleting') {
        throw new Error('the site is absent, deleting, or not a persistent environment');
      }
      if (deps.store.conversionSuspends(siteId) === 'environment' && !(await deps.registration(siteId))?.staging) {
        throw new Error('the site runtime is suspended by a conversion');
      }
      const binding = await bindingFor(siteId);
      const prepared = await gateway().prepareRuntimeSocket(siteId);
      if (prepared.path !== join(binding.brokerDir, 'app.sock')) {
        throw new Error('the site runtime socket does not match the handover binding');
      }
      // Socket sealing and application probes happen after startup, in Sites readiness handling.
    },
    async afterStop(siteId) {
      const binding = await bindingFor(siteId);
      // A conversion may still owe its legacy runtime this broker. Its explicit cleanup decides
      // whether it created the directory and may remove it after the runtime has stopped.
      if (binding.staging) return;
      await gateway().removeRuntimeSocket(siteId);
    },
  };
}
