import { ownershipTxtRecord, type DnsRecord, type DnsRecordPlan } from './dns.js';
import { parseSiteHostname, SiteHostnameError, type ReservedSiteHostnames } from './hostname.js';
import type { SiteAddressService } from './address.js';
import type { SiteGatewayManager } from './gateway.js';
import type { SiteHostnameCoordinator } from './hostnameCoordinator.js';
import {
  HostnameClaimError,
  type Site,
  type SiteHostnameCertificateState,
  type SiteHostnameDnsState,
  type SiteHostnameOwnershipState,
  type SiteHostnameRecord,
  type SitesStore,
} from './store.js';

export type SiteDomainErrorCode =
  | 'invalid_hostname'
  | 'reserved_hostname'
  | 'domain_claimed'
  | 'domain_limit'
  | 'claim_expired';

type SiteDomainStatus =
  | 'awaiting_ownership'
  | 'awaiting_routing'
  | 'misdirected'
  | 'issuing'
  | 'ready'
  | 'authority_refused'
  | 'rate_limited'
  | 'renewal_blocked'
  | 'expired'
  | 'removing';

type SiteDomainStatusCode =
  | 'ownership_missing'
  | 'ownership_mismatch'
  | 'ownership_unavailable'
  | 'ownership_ready'
  | 'dns_missing'
  | 'dns_misdirected'
  | 'dns_unavailable'
  | 'dns_ready'
  | 'certificate_waiting'
  | 'certificate_requested'
  | 'certificate_issuing'
  | 'certificate_reload_pending'
  | 'certificate_ready'
  | 'authority_refused'
  | 'rate_limited'
  | 'gateway_configuration_failed'
  | 'gateway_not_serving'
  | 'renewal_dns_missing'
  | 'renewal_dns_misdirected'
  | 'certificate_expired';

export class SiteDomainError extends Error {
  constructor(
    readonly status: number,
    readonly code: SiteDomainErrorCode,
    readonly params: Record<string, string | number> = {},
  ) {
    super(code);
    this.name = 'SiteDomainError';
  }
}

interface SiteDomainRecordView {
  type: DnsRecord['type'] | 'TXT';
  name: string;
  value: string;
}

interface SiteDomainStepView<TState extends string> {
  state: TState;
  code: SiteDomainStatusCode;
  params: Record<string, string>;
}

export interface SiteDomainView {
  id: string;
  hostname: string;
  displayHostname: string;
  url: string;
  kind: 'root' | 'subdomain';
  delegatedRootWarning: boolean;
  status: SiteDomainStatus;
  statusCode: SiteDomainStatusCode;
  statusParams: Record<string, string>;
  isPrimary: boolean;
  canOpen: boolean;
  removalState: 'active' | 'removing';
  ownership: SiteDomainStepView<SiteHostnameOwnershipState> & {
    record: SiteDomainRecordView;
    checkedAt: string | null;
    expiresAt: string | null;
  };
  routing: SiteDomainStepView<SiteHostnameDnsState> & {
    hint: 'routingHintRoot' | 'routingHintSubdomain';
    recommended: SiteDomainRecordView[];
    alternatives: SiteDomainRecordView[];
    observed: string[];
    checkedAt: string | null;
    nextCheckAt: string | null;
    planState: DnsRecordPlan['state'];
  };
  certificate: SiteDomainStepView<SiteHostnameCertificateState> & {
    requestedAt: string | null;
    retryAt: string | null;
    notAfter: string | null;
  };
}

interface SiteGeneratedAddressView {
  id: string;
  hostname: string;
  displayHostname: string;
  url: string;
  effective: boolean;
}

export interface SiteDomainsView {
  siteId: string;
  effectiveUrl: string | null;
  generated: SiteGeneratedAddressView | null;
  primaryHostnameId: string | null;
  domains: SiteDomainView[];
}

interface SiteDomainDeps {
  store: Pick<SitesStore,
    'claimCustomHostname' | 'customHostnames' | 'generatedHostname' | 'hostnameById'
    | 'setPrimaryCustomHostname' | 'requestHostnameRemoval' | 'siteById'>;
  addresses: Pick<SiteAddressService,
    'activeCustomHostnames' | 'effectiveHostname' | 'urlForHostname' | 'urlForSite'>;
  gateway: Pick<SiteGatewayManager, 'hostnameBase' | 'recordPlan' | 'reservedHostnames'>;
  coordinator: Pick<SiteHostnameCoordinator, 'checkCustom' | 'cleanupRemoved'>;
  appHostname(): string | null;
  gatewayHostname(): string | null;
}

const bounded = (value: string | null | undefined): string =>
  typeof value === 'string' ? value.slice(0, 600) : '';

const codeParams = (
  code: SiteDomainStatusCode,
  record: SiteHostnameRecord,
): Record<string, string> => {
  switch (code) {
    case 'dns_missing':
      return { hostname: record.hostname };
    case 'dns_misdirected':
      return { hostname: record.hostname, observed: record.dnsObserved.join(', ') };
    case 'dns_unavailable':
    case 'ownership_unavailable':
    case 'authority_refused':
    case 'gateway_configuration_failed':
      return { detail: bounded(code === 'ownership_unavailable' ? record.ownershipErrorDetail : code === 'dns_unavailable' ? record.dnsErrorDetail : record.certificateErrorDetail) };
    case 'rate_limited':
      return { time: record.certificateRetryAt ?? '' };
    case 'certificate_ready':
      return { date: record.certificateNotAfter ?? '' };
    case 'renewal_dns_missing':
      return { hostname: record.hostname, date: record.certificateNotAfter ?? '' };
    case 'renewal_dns_misdirected':
      return {
        hostname: record.hostname,
        observed: record.dnsObserved.join(', '),
        date: record.certificateNotAfter ?? '',
      };
    case 'certificate_expired':
      return { date: record.certificateNotAfter ?? '' };
    default:
      return {};
  }
};

const ownershipCode = (state: SiteHostnameOwnershipState): SiteDomainStatusCode => {
  if (state === 'ready') return 'ownership_ready';
  if (state === 'mismatch') return 'ownership_mismatch';
  if (state === 'unavailable') return 'ownership_unavailable';
  return 'ownership_missing';
};

const routingCode = (state: SiteHostnameDnsState): SiteDomainStatusCode => {
  if (state === 'ready') return 'dns_ready';
  if (state === 'misdirected') return 'dns_misdirected';
  if (state === 'unavailable') return 'dns_unavailable';
  return 'dns_missing';
};

const certificateCode = (record: SiteHostnameRecord): SiteDomainStatusCode => {
  if (record.certificateErrorCode && [
    'authority_refused',
    'rate_limited',
    'gateway_configuration_failed',
    'gateway_not_serving',
    'renewal_dns_missing',
    'renewal_dns_misdirected',
    'certificate_expired',
  ].includes(record.certificateErrorCode)) {
    return record.certificateErrorCode as SiteDomainStatusCode;
  }
  switch (record.certificateState) {
    case 'requested': return 'certificate_requested';
    case 'issuing': return 'certificate_issuing';
    case 'ready': return 'certificate_ready';
    case 'authority_refused': return 'authority_refused';
    case 'rate_limited': return 'rate_limited';
    case 'renewal_blocked': return record.dnsState === 'misdirected' ? 'renewal_dns_misdirected' : 'renewal_dns_missing';
    case 'expired': return 'certificate_expired';
    default: return 'certificate_waiting';
  }
};

const domainStatus = (
  record: SiteHostnameRecord,
  ownership: SiteDomainStatusCode,
  routing: SiteDomainStatusCode,
  certificate: SiteDomainStatusCode,
): { status: SiteDomainStatus; code: SiteDomainStatusCode } => {
  if (record.removalRequestedAt !== null) return { status: 'removing', code: certificate };
  if (certificate === 'certificate_expired') return { status: 'expired', code: certificate };
  if (record.certificateState === 'renewal_blocked') return { status: 'renewal_blocked', code: certificate };
  if (record.certificateState === 'ready') return { status: 'ready', code: certificate };
  if (certificate === 'rate_limited') return { status: 'rate_limited', code: certificate };
  if (certificate === 'authority_refused' || certificate === 'gateway_configuration_failed') {
    return { status: 'authority_refused', code: certificate };
  }
  if (ownership !== 'ownership_ready') return { status: 'awaiting_ownership', code: ownership };
  if (routing === 'dns_misdirected') return { status: 'misdirected', code: routing };
  if (routing !== 'dns_ready') return { status: 'awaiting_routing', code: routing };
  return { status: 'issuing', code: certificate };
};

export class SiteDomainService {
  constructor(private readonly deps: SiteDomainDeps) {}

  private reserved(site: Site): ReservedSiteHostnames {
    return {
      appHostname: this.deps.appHostname(),
      generatedHostnameBase: this.deps.gateway.hostnameBase(),
      gatewayHostname: this.deps.gatewayHostname(),
      reservedHostnames: this.deps.gateway.reservedHostnames(),
      ownGeneratedHostname: this.deps.store.generatedHostname(site.id)?.hostname ?? null,
    };
  }

  private custom(site: Site, id: string): SiteHostnameRecord {
    const record = this.deps.store.hostnameById(id);
    if (!record || record.siteId !== site.id || record.kind !== 'custom') {
      throw new SiteDomainError(404, 'claim_expired');
    }
    return record;
  }

  private async view(site: Site, record: SiteHostnameRecord): Promise<SiteDomainView> {
    if (!record.ownershipToken) throw new Error('A custom hostname has no ownership token.');
    const parsed = parseSiteHostname(record.hostname);
    const plan = await this.deps.gateway.recordPlan(parsed);
    const ownershipState = record.ownershipVerifiedAt !== null ? 'ready' : record.ownershipState;
    const ownership = ownershipCode(ownershipState);
    const routing = routingCode(record.dnsState);
    const certificate = certificateCode(record);
    const summary = domainStatus(record, ownership, routing, certificate);
    const active = this.deps.addresses.activeCustomHostnames(site).some((entry) => entry.id === record.id);
    return {
      id: record.id,
      hostname: parsed.ascii,
      displayHostname: parsed.unicode,
      url: this.deps.addresses.urlForHostname(parsed.ascii),
      kind: plan.kind,
      delegatedRootWarning: plan.delegatedRootWarning,
      status: summary.status,
      statusCode: summary.code,
      statusParams: codeParams(summary.code, record),
      isPrimary: site.primaryCustomHostnameId === record.id,
      canOpen: active,
      removalState: record.removalRequestedAt === null ? 'active' : 'removing',
      ownership: {
        state: ownershipState,
        code: ownership,
        params: codeParams(ownership, record),
        record: ownershipTxtRecord(parsed.ascii, record.ownershipToken),
        checkedAt: record.ownershipCheckedAt,
        expiresAt: record.ownershipExpiresAt,
      },
      routing: {
        state: record.dnsState,
        code: routing,
        params: codeParams(routing, record),
        hint: plan.kind === 'root' ? 'routingHintRoot' : 'routingHintSubdomain',
        recommended: plan.preferred,
        alternatives: plan.fallback,
        observed: record.dnsObserved,
        checkedAt: record.dnsCheckedAt,
        nextCheckAt: record.dnsNextCheckAt,
        planState: plan.state,
      },
      certificate: {
        state: record.certificateState,
        code: certificate,
        params: codeParams(certificate, record),
        requestedAt: record.certificateRequestedAt,
        retryAt: record.certificateRetryAt,
        notAfter: record.certificateNotAfter,
      },
    };
  }

  async list(site: Site): Promise<SiteDomainsView> {
    const generated = this.deps.store.generatedHostname(site.id);
    const effective = this.deps.addresses.effectiveHostname(site);
    return {
      siteId: site.id,
      effectiveUrl: this.deps.addresses.urlForSite(site),
      generated: generated && generated.removalRequestedAt === null ? {
        id: generated.id,
        hostname: generated.hostname,
        displayHostname: parseSiteHostname(generated.hostname).unicode,
        url: this.deps.addresses.urlForHostname(generated.hostname),
        effective: effective === generated.hostname,
      } : null,
      primaryHostnameId: site.primaryCustomHostnameId,
      domains: await Promise.all(this.deps.store.customHostnames(site.id).map((record) => this.view(site, record))),
    };
  }

  async add(site: Site, input: unknown): Promise<SiteDomainView> {
    let parsed;
    try {
      parsed = parseSiteHostname(input, this.reserved(site));
    } catch (error) {
      if (error instanceof SiteHostnameError) {
        throw new SiteDomainError(400, error.code === 'reserved_hostname' ? 'reserved_hostname' : 'invalid_hostname');
      }
      throw error;
    }
    let claimed: SiteHostnameRecord;
    try {
      claimed = this.deps.store.claimCustomHostname(site.id, parsed);
    } catch (error) {
      if (error instanceof HostnameClaimError) {
        const code = error.code === 'domain_claimed'
          ? 'domain_claimed'
          : error.code === 'hostname_limit' ? 'domain_limit' : 'claim_expired';
        throw new SiteDomainError(error.code === 'domain_claimed' ? 409 : 400, code, code === 'domain_limit' ? { count: 10 } : {});
      }
      throw error;
    }
    return this.view(site, claimed);
  }

  async check(site: Site, id: string): Promise<SiteDomainView> {
    const record = this.custom(site, id);
    if (record.removalRequestedAt !== null) return this.view(site, record);
    await this.deps.coordinator.checkCustom(record);
    return this.view(this.deps.store.siteById(site.id) ?? site, this.custom(site, id));
  }

  async makePrimary(site: Site, id: string): Promise<SiteDomainView> {
    this.custom(site, id);
    this.deps.store.setPrimaryCustomHostname(site.id, id);
    const current = this.deps.store.siteById(site.id) ?? { ...site, primaryCustomHostnameId: id };
    return this.view(current, this.custom(current, id));
  }

  async remove(site: Site, id: string): Promise<{ removed: boolean; domain?: SiteDomainView }> {
    const record = this.custom(site, id);
    if (record.removalRequestedAt === null) this.deps.store.requestHostnameRemoval(id);
    await this.deps.coordinator.cleanupRemoved();
    const pending = this.deps.store.hostnameById(id);
    return pending
      ? { removed: false, domain: await this.view(this.deps.store.siteById(site.id) ?? site, pending) }
      : { removed: true };
  }
}
