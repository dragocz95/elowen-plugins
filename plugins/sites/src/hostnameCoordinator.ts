import { Resolver } from 'node:dns/promises';
import { probeGatewayCertificate, type GatewayCertificateProbe } from './certificate.js';
import { verifyOwnershipTxt, type OwnershipDnsResolver } from './dns.js';
import type { SiteAddressBinding, SiteAddressService } from './address.js';
import type { SiteGatewayManager } from './gateway.js';
import type { Site, SiteHostnameRecord, SitesStore } from './store.js';

const DNS_DELAYS_MS = [60_000, 2 * 60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000] as const;
const CERTIFICATE_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000] as const;

interface CoordinatorDeps {
  store: SitesStore;
  gateway: SiteGatewayManager;
  addresses: SiteAddressService;
  ownershipResolver?: OwnershipDnsResolver;
  probe?: GatewayCertificateProbe;
  now?(): number;
  logger?: { warn(message: string): void };
}

const delayAt = (delays: readonly number[], failures: number): number =>
  delays[Math.min(failures, delays.length - 1)] ?? delays[delays.length - 1] ?? 60_000;

const dateAfter = (now: number, delay: number): string => new Date(now + delay).toISOString();

export class SiteHostnameCoordinator {
  private readonly ownershipResolver: OwnershipDnsResolver;
  private readonly probe: GatewayCertificateProbe;
  private readonly customChecks = new Map<string, Promise<void>>();

  constructor(private readonly deps: CoordinatorDeps) {
    const resolver = new Resolver({ timeout: 5_000, tries: 2 });
    this.ownershipResolver = deps.ownershipResolver ?? {
      resolveTxt: (hostname) => resolver.resolveTxt(hostname),
    };
    this.probe = deps.probe ?? probeGatewayCertificate;
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private binding(record: SiteHostnameRecord): SiteAddressBinding | null {
    const site = this.deps.store.siteById(record.siteId);
    if (!site) return null;
    return this.deps.addresses.bindings(this.now())
      .find((binding) => binding.id === record.id && binding.siteId === site.id) ?? null;
  }

  private async issue(record: SiteHostnameRecord): Promise<void> {
    const binding = this.binding(record);
    if (!binding) return;
    const retryAt = record.certificateRetryAt === null ? 0 : Date.parse(record.certificateRetryAt);
    if (Number.isFinite(retryAt) && retryAt > this.now()) return;

    this.deps.store.recordHostnameCertificate(record.id, { state: 'requested' });
    const bindings = this.deps.addresses.bindings(this.now());
    try {
      const synced = await this.deps.gateway.reconcile(bindings);
      if (!synced.available || !synced.active) {
        throw new Error(synced.detail ?? 'The gateway did not activate the desired binding set.');
      }
    } catch (error) {
      this.deps.store.recordHostnameCertificate(record.id, {
        state: 'authority_refused',
        errorCode: 'gateway_configuration_failed',
        errorDetail: error instanceof Error ? error.message : String(error),
        retryAt: dateAfter(this.now(), delayAt(CERTIFICATE_DELAYS_MS, record.certificateFailures)),
      });
      return;
    }

    this.deps.store.recordHostnameCertificate(record.id, { state: 'issuing' });
    try {
      const status = await this.deps.gateway.ensureBinding(binding, bindings);
      const gatewayRecord = status.bindings?.find((entry) => entry.hostname === record.hostname);
      const observed = await this.probe(record.hostname);
      if (!gatewayRecord?.present || !observed.covered) {
        this.deps.store.recordHostnameCertificate(record.id, {
          state: 'requested',
          errorCode: 'gateway_not_serving',
          errorDetail: observed.detail,
          retryAt: dateAfter(this.now(), 60_000),
          notAfter: gatewayRecord?.notAfter ?? null,
        });
        return;
      }
      this.deps.store.recordHostnameCertificate(record.id, {
        state: 'ready',
        notAfter: gatewayRecord.notAfter ?? null,
      });
    } catch (error) {
      this.deps.store.recordHostnameCertificate(record.id, {
        state: 'authority_refused',
        errorCode: 'authority_refused',
        errorDetail: error instanceof Error ? error.message : String(error),
        retryAt: dateAfter(this.now(), delayAt(CERTIFICATE_DELAYS_MS, record.certificateFailures)),
      });
    }
  }

  checkCustom(record: SiteHostnameRecord, renew = false): Promise<void> {
    const running = this.customChecks.get(record.id);
    if (running) return running;
    const check = this.runCustomCheck(record, renew);
    this.customChecks.set(record.id, check);
    check.then(
      () => {
        if (this.customChecks.get(record.id) === check) this.customChecks.delete(record.id);
      },
      () => {
        if (this.customChecks.get(record.id) === check) this.customChecks.delete(record.id);
      },
    );
    return check;
  }

  private async runCustomCheck(record: SiteHostnameRecord, renew: boolean): Promise<void> {
    if (record.kind !== 'custom' || record.removalRequestedAt !== null || !record.ownershipToken) return;
    const [ownership, traffic] = await Promise.all([
      record.ownershipVerifiedAt === null
        ? verifyOwnershipTxt(record.hostname, record.ownershipToken, this.ownershipResolver)
        : Promise.resolve({ state: 'ready' as const, observedValues: [] }),
      this.deps.gateway.verifyHostnameDns(record.hostname),
    ]);

    const nextDnsCheck = dateAfter(this.now(), delayAt(DNS_DELAYS_MS, record.dnsAttempts));
    if (record.ownershipVerifiedAt === null) {
      this.deps.store.recordHostnameOwnership(
        record.id,
        ownership.state,
        'detail' in ownership ? ownership.detail ?? null : null,
      );
    }
    this.deps.store.recordHostnameDns(
      record.id,
      traffic.state,
      traffic.observedTargets,
      nextDnsCheck,
      traffic.detail ?? null,
    );
    if (ownership.state === 'ready' && record.ownershipVerifiedAt === null) {
      this.deps.store.verifyHostnameOwnership(record.id);
    }

    const current = this.deps.store.hostnameById(record.id);
    if (!current || current.removalRequestedAt !== null) return;
    const notAfter = current.certificateNotAfter === null ? null : Date.parse(current.certificateNotAfter);
    if (current.certificateState === 'ready' || current.certificateState === 'renewal_blocked') {
      if (notAfter !== null && Number.isFinite(notAfter) && notAfter <= this.now()) {
        this.deps.store.recordHostnameCertificate(current.id, {
          state: 'expired',
          errorCode: 'certificate_expired',
          notAfter: current.certificateNotAfter,
        });
        return;
      }
      if (traffic.state !== 'ready') {
        this.deps.store.recordHostnameCertificate(current.id, {
          state: 'renewal_blocked',
          errorCode: traffic.state === 'misdirected' ? 'renewal_dns_misdirected' : 'renewal_dns_missing',
          notAfter: current.certificateNotAfter,
        });
        return;
      }
      if (current.certificateState === 'renewal_blocked' || renew) {
        this.deps.store.recordHostnameCertificate(current.id, { state: 'requested', notAfter: current.certificateNotAfter });
      }
    }

    const refreshed = this.deps.store.hostnameById(record.id);
    if (refreshed?.ownershipVerifiedAt !== null && refreshed?.dnsState === 'ready'
      && refreshed.certificateState !== 'ready') {
      await this.issue(refreshed);
    }
  }

  private async issueGenerated(site: Site, renew: boolean): Promise<void> {
    if (site.status !== 'live') return;
    const record = this.deps.store.generatedHostname(site.id);
    if (!record || record.removalRequestedAt !== null) return;
    const requested = record.certificateRequestedAt !== null
      || record.certificateState === 'requested'
      || record.certificateState === 'authority_refused';
    if (!renew && !requested && this.deps.gateway.hasCertificate(record.hostname)) return;
    if (!renew && !requested && record.certificateState === 'none') {
      this.deps.store.requestGeneratedCertificate(site.id, new Date(this.now()).toISOString());
    }
    const retryAt = record.certificateRetryAt === null ? 0 : Date.parse(record.certificateRetryAt);
    if (Number.isFinite(retryAt) && retryAt > this.now()) return;
    const binding = this.binding(record);
    if (!binding) return;
    try {
      const bindings = this.deps.addresses.bindings(this.now());
      const synced = await this.deps.gateway.reconcile(bindings);
      if (!synced.available || !synced.active) {
        throw new Error(synced.detail ?? 'The gateway did not activate the desired binding set.');
      }
      await this.deps.gateway.ensureBinding(binding, bindings);
      this.deps.store.clearGeneratedCertificateRequest(site.id);
    } catch (error) {
      this.deps.store.failGeneratedCertificate(site.id, error instanceof Error ? error.message : String(error));
      this.deps.store.recordHostnameCertificate(record.id, {
        state: 'authority_refused',
        errorCode: 'authority_refused',
        errorDetail: error instanceof Error ? error.message : String(error),
        retryAt: dateAfter(this.now(), delayAt(CERTIFICATE_DELAYS_MS, record.certificateFailures)),
      });
    }
  }

  async sweep(options: { renew?: boolean } = {}): Promise<void> {
    this.deps.store.expireUnverifiedHostnameReservations();
    const customCandidates = options.renew === true
      ? this.deps.store.allCustomHostnames()
      : this.deps.store.customHostnamesDueForDns(this.now());
    for (const record of customCandidates) {
      try {
        await this.checkCustom(record, options.renew === true);
      } catch (error) {
        this.deps.logger?.warn(`custom hostname ${record.hostname} check failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    for (const site of this.deps.store.allSites()) {
      try {
        await this.issueGenerated(site, options.renew === true);
      } catch (error) {
        this.deps.logger?.warn(`generated hostname for ${site.slug} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  async cleanupRemoved(): Promise<void> {
    for (const record of this.deps.store.hostnamesPendingRemoval()) {
      const site = this.deps.store.siteForCleanup(record.siteId);
      if (!site) continue;
      const remaining = this.deps.addresses.bindings(this.now());
      await this.deps.gateway.removeBinding(record.hostname, site.slug, remaining);
      this.deps.store.completeHostnameRemoval(record.id);
    }
  }
}
