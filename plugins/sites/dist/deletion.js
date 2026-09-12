import { rmSync } from 'node:fs';
export const environmentAlreadyDeleted = (error) => error instanceof Error && /\benvironment has been deleted\b/i.test(error.message);
/** Finish the daemon-owned phase of a durable site deletion. */
export async function deleteSiteResources(siteId, deps) {
    const site = deps.store.siteById(siteId);
    if (!site)
        return;
    // Without the broker this phase cannot finish: the gateway removal below is a silent no-op there, and
    // once the Site row is gone nothing ever asks for it again — the vhost and the certificate outlive the
    // site for good. The durable `deleting` marker has already taken the site out of every read path, so
    // leaving the phase untouched lets the daemon's cleanup sweep run it where the broker exists.
    if (!deps.hasGatewayBroker())
        return;
    if (site.runtime !== 'environment')
        await deps.stopLegacy(siteId);
    if (site.kind === 'proxy')
        await deps.releasePublication(site);
    if (site.runtime === 'environment' || deps.store.runtimeRecord(siteId, 'binding')) {
        // The gateway is finalized below, after the environment, plugin files and durable Site rows are gone.
        // Keeping broker removal out of the environment delete makes an unavailable gateway a harmless final no-op.
        try {
            await deps.deleteEnvironment(siteId, { removeBroker: false, handover: true });
        }
        catch (error) {
            if (!environmentAlreadyDeleted(error))
                throw error;
        }
    }
    rmSync(deps.siteDir(siteId), { recursive: true, force: true });
    deps.store.deleteSite(siteId);
    try {
        await deps.removeRuntimeSocket(siteId);
    }
    catch (error) {
        deps.reportRuntimeSocketError?.(site, error);
    }
    try {
        await deps.removeGateway(site.slug);
    }
    catch (error) {
        deps.reportGatewayError?.(site, error);
    }
}
