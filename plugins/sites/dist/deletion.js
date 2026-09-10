import { rmSync } from 'node:fs';
export const environmentAlreadyDeleted = (error) => error instanceof Error && /\benvironment has been deleted\b/i.test(error.message);
/** Finish the daemon-owned phase of a durable site deletion. */
export async function deleteSiteResources(siteId, deps) {
    const site = deps.store.siteById(siteId);
    if (!site)
        return;
    if (site.runtime !== 'environment')
        await deps.stopLegacy(siteId);
    if (site.kind === 'proxy')
        await deps.releasePublication(site);
    if (site.runtime === 'environment' || deps.store.runtimeRecord(siteId, 'binding')) {
        try {
            await deps.deleteEnvironment(siteId);
        }
        catch (error) {
            if (!environmentAlreadyDeleted(error))
                throw error;
        }
    }
    rmSync(deps.siteDir(siteId), { recursive: true, force: true });
    deps.store.deleteSite(siteId);
    try {
        await deps.removeGateway(site.slug);
    }
    catch (error) {
        deps.reportGatewayError?.(site, error);
    }
}
