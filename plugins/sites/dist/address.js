const validHostHeader = (value) => {
    if (!value)
        return null;
    const match = /^([^:]+)(?::(\d{1,5}))?$/.exec(value.trim());
    if (!match?.[1])
        return null;
    if (match[2] !== undefined && Number(match[2]) > 65535)
        return null;
    return match[1].toLowerCase();
};
const certificateStillValid = (record, now) => record.certificateNotAfter === null || Date.parse(record.certificateNotAfter) > now;
export class SiteAddressService {
    deps;
    constructor(deps) {
        this.deps = deps;
    }
    generatedHostname(site) {
        const hostname = this.deps.store.generatedHostname(site.id);
        return hostname?.removalRequestedAt === null ? hostname : null;
    }
    activeCustomHostnames(site, now = Date.now()) {
        return this.deps.store.customHostnames(site.id).filter((hostname) => hostname.removalRequestedAt === null
            && hostname.ownershipVerifiedAt !== null
            && (hostname.certificateState === 'ready' || hostname.certificateState === 'renewal_blocked')
            && certificateStillValid(hostname, now));
    }
    preferredHostname(site) {
        if (site.primaryCustomHostnameId === null)
            return this.generatedHostname(site);
        const primary = this.activeCustomHostnames(site)
            .find((hostname) => hostname.id === site.primaryCustomHostnameId);
        return primary ?? this.generatedHostname(site);
    }
    effectiveHostname(site) {
        return this.preferredHostname(site)?.hostname ?? null;
    }
    urlForHostname(hostname) {
        return `${this.deps.scheme()}//${hostname}/`;
    }
    urlForSite(site) {
        const hostname = this.effectiveHostname(site);
        return hostname === null ? null : this.urlForHostname(hostname);
    }
    urlForBinding(site, bindingId) {
        const binding = this.bindings().find((entry) => entry.id === bindingId && entry.siteId === site.id);
        return binding ? this.urlForHostname(binding.hostname) : null;
    }
    allAddresses(site) {
        const effective = this.effectiveHostname(site);
        const records = [
            ...(this.generatedHostname(site) ? [this.generatedHostname(site)] : []),
            ...this.activeCustomHostnames(site),
        ];
        return records.map((record) => ({
            id: record.id,
            hostname: record.hostname,
            url: this.urlForHostname(record.hostname),
            generated: record.kind === 'generated',
            effective: record.hostname === effective,
        }));
    }
    bindings(now = Date.now(), excludedSiteIds = new Set()) {
        const bindings = [];
        for (const site of this.deps.store.allSites()) {
            if (site.status !== 'live' || excludedSiteIds.has(site.id))
                continue;
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
                if (hostname.removalRequestedAt !== null || hostname.ownershipVerifiedAt === null)
                    continue;
                const hasUsableCertificate = (hostname.certificateState === 'ready'
                    || hostname.certificateState === 'renewal_blocked') && certificateStillValid(hostname, now);
                if (hostname.dnsState !== 'ready' && !hasUsableCertificate)
                    continue;
                if (hostname.certificateState === 'expired')
                    continue;
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
                if (excludedSiteIds.has(preview.id) || !this.deps.previewActive(preview.projectId))
                    continue;
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
    bindingForRequest(slug, hostHeader) {
        const hostname = validHostHeader(hostHeader);
        if (hostname === null)
            return null;
        return this.bindings().find((binding) => binding.hostname === hostname && binding.slug === slug) ?? null;
    }
    bindingById(siteId, bindingId) {
        return this.bindings().find((binding) => binding.siteId === siteId && binding.id === bindingId) ?? null;
    }
}
