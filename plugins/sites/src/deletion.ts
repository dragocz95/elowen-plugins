import { rmSync } from 'node:fs';

import type { Site, SitesStore } from './store.js';

export const environmentAlreadyDeleted = (error: unknown): boolean =>
  error instanceof Error && /\benvironment has been deleted\b/i.test(error.message);

export interface SiteDeletionDeps {
  store: SitesStore;
  siteDir(siteId: string): string;
  stopLegacy(siteId: string): Promise<void>;
  releasePublication(site: Site): Promise<void>;
  deleteEnvironment(siteId: string): Promise<void>;
  removeGateway(slug: string): Promise<void>;
  reportGatewayError?(site: Site, error: unknown): void;
}

/** Finish the daemon-owned phase of a durable site deletion. */
export async function deleteSiteResources(siteId: string, deps: SiteDeletionDeps): Promise<void> {
  const site = deps.store.siteById(siteId);
  if (!site) return;
  if (site.runtime !== 'environment') await deps.stopLegacy(siteId);
  if (site.kind === 'proxy') await deps.releasePublication(site);
  if (site.runtime === 'environment' || deps.store.runtimeRecord(siteId, 'binding')) {
    try { await deps.deleteEnvironment(siteId); }
    catch (error) { if (!environmentAlreadyDeleted(error)) throw error; }
  }
  rmSync(deps.siteDir(siteId), { recursive: true, force: true });
  deps.store.deleteSite(siteId);
  try { await deps.removeGateway(site.slug); }
  catch (error) { deps.reportGatewayError?.(site, error); }
}
