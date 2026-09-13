import { rmSync } from 'node:fs';

import type { Site, SitesStore } from './store.js';


export interface SiteDeletionDeps {
  store: SitesStore;
  siteDir(siteId: string): string;
  /** Whether THIS process holds the privileged gateway broker. False in a forked tool runner, where the
   *  control is withheld so a runner never gains a path to sudo. */
  hasGatewayBroker(): boolean;
  stopLegacy(siteId: string): Promise<void>;
  releasePublication(site: Site): Promise<void>;
  removeRuntimeSocket(siteId: string): Promise<void>;
  removeGateway(slug: string): Promise<void>;
}

/** Finish the daemon-owned phase of a durable site deletion. */
export async function deleteSiteResources(siteId: string, deps: SiteDeletionDeps): Promise<void> {
  const site = deps.store.siteForCleanup(siteId);
  if (!site) return;
  // Without the broker this phase cannot finish: the gateway removal below is a silent no-op there, and
  // once the Site row is gone nothing ever asks for it again — the vhost and the certificate outlive the
  // site for good. The durable `deleting` marker has already taken the site out of every read path, so
  // leaving the phase untouched lets the daemon's cleanup sweep run it where the broker exists.
  if (!deps.hasGatewayBroker()) return;
  if (site.runtime === 'command') await deps.stopLegacy(siteId);
  if (site.kind === 'proxy') await deps.releasePublication(site);
  rmSync(deps.siteDir(siteId), { recursive: true, force: true });
  await deps.removeRuntimeSocket(siteId);
  await deps.removeGateway(site.slug);
  deps.store.deleteSite(siteId);
}
