import { join } from 'node:path';
/** Sites retains resource authority and ingress preparation. Sandbox alone owns runtime lifecycle. */
export function createSiteRuntimeAuthority(deps) {
    const bindingFor = (siteId) => {
        const site = deps.store.siteById(siteId);
        const binding = deps.registration(siteId);
        if (!site || !binding || binding.siteId !== site.id || binding.projectId !== site.projectId
            || (!binding.staging && binding.sourcePath !== site.sourceDir)) {
            throw new Error('the site runtime handover binding is unavailable or no longer matches the site');
        }
        return binding;
    };
    const gateway = () => {
        const control = deps.gateway();
        if (!control)
            throw new Error('the published-sites socket broker is unavailable');
        return control;
    };
    return {
        resolveArtifact: deps.resolveArtifact,
        imageRecipe: deps.imageRecipe,
        projectDependents: deps.projectDependents,
        beforeCreate: deps.beforeCreate,
        async resolve({ siteId, accountUserId }) {
            const site = deps.store.siteById(siteId);
            if (!site || !deps.access.accountExists(accountUserId))
                return null;
            if (site.runtime !== 'environment' && !deps.registration(siteId)?.staging)
                return null;
            // Runtime logs and commands are privileged even when the published application is public.
            // Project membership grants application access, not ownership of an independently published Site.
            const admin = deps.access.isAdmin(accountUserId);
            if (!admin && (site.ownerUserId !== accountUserId || !deps.access.canAccessProject(accountUserId, site.projectId)))
                return null;
            return bindingFor(siteId);
        },
        async beforeStart(siteId) {
            const site = deps.store.siteById(siteId);
            if (!site || site.runtime !== 'environment' || site.status === 'deleting') {
                throw new Error('the site is absent, deleting, or not a persistent environment');
            }
            if (deps.store.conversionSuspends(siteId) === 'environment' && !deps.registration(siteId)?.staging) {
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
            const binding = bindingFor(siteId);
            // A conversion may still owe its legacy runtime this broker. Its explicit cleanup decides
            // whether it created the directory and may remove it after the runtime has stopped.
            if (binding.staging)
                return;
            await gateway().removeRuntimeSocket(siteId);
        },
    };
}
