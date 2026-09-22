import type { SitesGatewayBinding } from './coreSeams.js';
import type { ProjectPreview, Site, SiteHostnameRecord, SitesStore } from './store.js';

export interface SiteAddressBinding extends SitesGatewayBinding {
  id: string;
  siteId: string;
}

type AddressStore = Pick<SitesStore,
  'allSites' | 'generatedHostname' | 'customHostnames' | 'hostnameById' | 'siteById'>;

export interface SiteAddressDeps {
  store: AddressStore;
  scheme(): string;
  hostnameBase(): string | null;
  previews(): readonly ProjectPreview[];
  previewActive(projectId: number): boolean;
}

const validHostHeader = (value: string | undefined): string | null => {
  if (!value) return null;
  const match = /^([^:]+)(?::(\d{1,5}))?$/.exec(value.trim());
  if (!match?.[1]) return null;
  if (match[2] !== undefined && Number(match[2]) > 65535) return null;
  return match[1].toLowerCase();
};

const certificateStillValid = (record: SiteHostnameRecord, now: number): boolean =>
  record.certificateNotAfter === null || Date.parse(record.certificateNotAfter) > now;

export class SiteAddressService {
  constructor(private readonly deps: SiteAddressDeps) {}

  generatedHostname(site: Pick<Site, 'id'>): SiteHostnameRecord | null {
    const hostname = this.deps.store.generatedHostname(site.id);
    return hostname?.removalRequestedAt === null ? hostname : null;
  }

  activeCustomHostnames(site: Pick<Site, 'id'>, now = Date.now()): SiteHostnameRecord[] {
    return this.deps.store.customHostnames(site.id).filter((hostname) =>
      hostname.removalRequestedAt === null
      && hostname.ownershipVerifiedAt !== null
      && (hostname.certificateState === 'ready' || hostname.certificateState === 'renewal_blocked')
      && certificateStillValid(hostname, now));
  }

  preferredHostname(site: Pick<Site, 'id' | 'primaryCustomHostnameId'>): SiteHostnameRecord | null {
    if (site.primaryCustomHostnameId === null) return this.generatedHostname(site);
    const primary = this.activeCustomHostnames(site)
      .find((hostname) => hostname.id === site.primaryCustomHostnameId);
    return primary ?? this.generatedHostname(site);
  }

  effectiveHostname(site: Pick<Site, 'id' | 'primaryCustomHostnameId'>): string | null {
    return this.preferredHostname(site)?.hostname ?? null;
  }

  urlForHostname(hostname: string): string {
    return `${this.deps.scheme()}//${hostname}/`;
  }

  urlForSite(site: Pick<Site, 'id' | 'primaryCustomHostnameId'>): string | null {
    const hostname = this.effectiveHostname(site);
    return hostname === null ? null : this.urlForHostname(hostname);
  }

  bindings(now = Date.now(), excludedSiteIds: ReadonlySet<string> = new Set()): SiteAddressBinding[] {
    const bindings: SiteAddressBinding[] = [];
    for (const site of this.deps.store.allSites()) {
      if (site.status !== 'live' || excludedSiteIds.has(site.id)) continue;
      const generated = this.generatedHostname(site);
      if (generated) {
        bindings.push({
          id: generated.id,
          siteId: site.id,
          hostname: generated.hostname,
          slug: site.slug,
          class: 'generated',
        });
      }
      for (const hostname of this.deps.store.customHostnames(site.id)) {
        if (hostname.removalRequestedAt !== null || hostname.ownershipVerifiedAt === null) continue;
        const hasUsableCertificate = (hostname.certificateState === 'ready'
          || hostname.certificateState === 'renewal_blocked') && certificateStillValid(hostname, now);
        if (hostname.dnsState !== 'ready' && !hasUsableCertificate) continue;
        if (hostname.certificateState === 'expired') continue;
        bindings.push({
          id: hostname.id,
          siteId: site.id,
          hostname: hostname.hostname,
          slug: site.slug,
          class: 'custom',
        });
      }
    }
    const base = this.deps.hostnameBase();
    if (base) {
      for (const preview of this.deps.previews()) {
        if (excludedSiteIds.has(preview.id) || !this.deps.previewActive(preview.projectId)) continue;
        bindings.push({
          id: `preview:${preview.id}`,
          siteId: preview.id,
          hostname: `${preview.slug}.${base}`,
          slug: preview.slug,
          class: 'generated',
        });
      }
    }
    return bindings.sort((left, right) => left.hostname.localeCompare(right.hostname));
  }

  bindingForRequest(slug: string, hostHeader: string | undefined): SiteAddressBinding | null {
    const hostname = validHostHeader(hostHeader);
    if (hostname === null) return null;
    return this.bindings().find((binding) => binding.hostname === hostname && binding.slug === slug) ?? null;
  }

  bindingById(siteId: string, bindingId: string): SiteAddressBinding | null {
    return this.bindings().find((binding) => binding.siteId === siteId && binding.id === bindingId) ?? null;
  }
}
