import { randomBytes } from 'node:crypto';
import { Resolver } from 'node:dns/promises';
import type { SitesContext, SitesGatewayStatus } from './coreSeams.js';
import { derivedHostnameBase } from './config.js';
import { GatewayDnsTargetService, type TrafficDnsResolver } from './dns.js';

const GATEWAY_TOKEN_KEY = 'gatewayToken';
const DNS_TIMEOUT_MS = 5_000;
const MIN_BACKOFF_MS = 60_000;
const MAX_BACKOFF_MS = 3600_000;

/** The exact configured or backward-compatible default record an operator has to create. */
export type RequiredRecord = { name: string; type: 'CNAME' | 'A' | 'AAAA'; value: string };

export type GatewayDnsResolver = TrafficDnsResolver;

type GatewayDnsState = 'ready' | 'missing' | 'misdirected' | 'unavailable';

export interface SiteGatewayReadiness {
  id: 'sites-gateway';
  label: string;
  ok: boolean;
  status: GatewayDnsState;
  detail: string;
  observedTargets?: string[];
  hint?: string;
  fix?: { label: string; value: string }[];
}

type DnsCheck = { state: GatewayDnsState; observedTargets: string[]; detail?: string };

/** Owns the one conversation with the root broker: the shared marker token, per-site certificates, and
 *  the check that the wildcard DNS record this whole feature stands on actually exists.
 *
 *  There are no credentials here and no provisioning form. A certificate is obtained over HTTP-01, which
 *  needs nothing but the wildcard record already resolving to this machine, so the only thing that can
 *  be missing is that record — and the only useful thing to do about it is say so precisely. */
export class SiteGatewayManager {
  private current: SitesGatewayStatus = {
    available: false,
    active: false,
    hostnameBase: null,
    detail: 'the published-sites gateway has not been checked yet',
  };
  private cachedToken: string | null = null;
  private reconciling: Promise<SitesGatewayStatus> | null = null;
  private readonly nextAttempt = new Map<string, number>();
  private readonly backoffMs = new Map<string, number>();
  private readonly destination: GatewayDnsTargetService;
  private readonly randomLabel: () => string;
  private dnsCheck: DnsCheck = { state: 'unavailable', observedTargets: [], detail: 'DNS has not been checked yet.' };

  constructor(private readonly ctx: SitesContext, deps: {
    resolver?: GatewayDnsResolver;
    randomLabel?: () => string;
  } = {}) {
    const resolver = new Resolver({ timeout: DNS_TIMEOUT_MS, tries: 2 });
    const dnsResolver = deps.resolver ?? {
      resolveCname: (hostname: string) => resolver.resolveCname(hostname),
      resolve4: (hostname: string) => resolver.resolve4(hostname),
      resolve6: (hostname: string) => resolver.resolve6(hostname),
    };
    this.destination = new GatewayDnsTargetService({
      configured: () => (this.ctx.config as Record<string, unknown>).gatewayDnsTarget,
      fallbackHostname: () => this.appHost(),
      resolver: dnsResolver,
    });
    this.randomLabel = deps.randomLabel ?? (() => `elowen-${randomBytes(6).toString('hex')}`);
  }

  /** Whether sites can be served at all right now, as of the last reconcile. */
  isActive(): boolean {
    return this.current.active;
  }

  status(): SitesGatewayStatus {
    return this.current;
  }

  /** The base every site hostname is built on. The broker answers it wherever it exists, because it derives
   *  it from trusted install metadata — NOT from the last reconcile. A tool call runs in a forked runner
   *  that never reconciles, and a site's address must be the same fact there as in the daemon. Whether the
   *  address currently WORKS is a separate question, answered by `isActive`.
   *
   *  A forked runner holds no broker at all, and answering null there made every site in it addressless: the
   *  same instance reported an address from the daemon and "no HTTPS domain" from a tool. The fallback
   *  recomputes the broker's own rule from the app URL the plugin context carries in BOTH processes, so the
   *  answer is one fact rather than a property of which process asked. It grants nothing: naming a hostname
   *  is not issuing a certificate, and every privileged operation below still goes through the control. */
  hostnameBase(): string | null {
    return this.brokerHostnameBase() ?? derivedHostnameBase(this.ctx.publicWebUrl());
  }

  /** Whether THIS process can ask for a certificate at all.
   *
   *  The privileged broker is withheld from a forked tool runner on purpose, so a publish arriving there has
   *  to route its request through the daemon rather than pretend it issued anything. Asked of the registry
   *  rather than inferred from the process, so the answer is the real capability. */
  hasBroker(): boolean {
    return this.ctx.control('publishedSitesGateway') !== undefined;
  }

  gatewayToken(): string {
    if (this.cachedToken) return this.cachedToken;
    const bag = this.ctx.instanceSecrets();
    const existing = bag.get(GATEWAY_TOKEN_KEY)?.value;
    if (existing) { this.cachedToken = existing; return existing; }
    const minted = randomBytes(32).toString('base64url');
    try { bag.set(GATEWAY_TOKEN_KEY, minted); this.cachedToken = minted; }
    catch { this.cachedToken = bag.get(GATEWAY_TOKEN_KEY)?.value ?? minted; }
    return this.cachedToken;
  }

  /** The record an operator must create for this instance. Its value and readiness expectation are the
   *  same parsed target, so the UI can never instruct one destination while validation checks another. The
   *  name is the SAME base sites are addressed at, for the same reason: a record naming a base no site is
   *  served from is a wildcard an operator creates and nothing ever uses. */
  requiredRecord(): RequiredRecord | null {
    const base = this.hostnameBase();
    const { target } = this.destination.current();
    if (!base || !target) return null;
    return target.requiredRecord(`*.${base}`);
  }

  private brokerHostnameBase(): string | null {
    return this.ctx.control('publishedSitesGateway')?.hostnameBase() ?? null;
  }

  private appHost(): string | null {
    const url = this.ctx.publicWebUrl();
    if (!url) return null;
    try { return new URL(url).hostname; } catch { return null; }
  }

  reconcile(): Promise<SitesGatewayStatus> {
    if (this.reconciling) return this.reconciling;
    const run = this.reconcileNow().finally(() => { this.reconciling = null; });
    this.reconciling = run;
    return run;
  }

  private async reconcileNow(): Promise<SitesGatewayStatus> {
    const gateway = this.ctx.control('publishedSitesGateway');
    if (!gateway) {
      this.current = { available: false, active: false, hostnameBase: null, detail: 'this daemon has no published-sites gateway broker' };
      return this.current;
    }
    const base = gateway.hostnameBase();
    if (!base) {
      this.dnsCheck = { state: 'unavailable', observedTargets: [], detail: 'The gateway hostname is unavailable.' };
      this.current = await gateway.status();
      return this.current;
    }
    const destination = this.destination.current();
    if (!destination.target) {
      this.dnsCheck = {
        state: 'unavailable',
        observedTargets: [],
        detail: destination.error ?? 'The Sites DNS destination is unavailable.',
      };
      this.current = { available: false, active: false, hostnameBase: base, detail: this.dnsCheck.detail };
      return this.current;
    }
    const probe = `${this.randomLabel()}.${base}`.toLowerCase();
    this.dnsCheck = await destination.target.verifyHostname(probe, 2);
    if (this.dnsCheck.state !== 'ready') {
      // Fail loudly and stay failed. Serving the pages from the app's own origin instead would put
      // agent-authored script next to the app's session cookie, so there is nothing to fall back to.
      const observed = this.dnsCheck.observedTargets.length > 0
        ? ` Observed: ${this.dnsCheck.observedTargets.join(', ')}.`
        : '';
      const detail = this.dnsCheck.state === 'missing'
        ? `*.${base} does not resolve, so no site can be addressed or given a certificate.`
        : this.dnsCheck.state === 'misdirected'
          ? `*.${base} resolves, but not to ${destination.target.value}.${observed}`
          : `DNS verification for *.${base} could not complete: ${this.dnsCheck.detail ?? 'resolver unavailable'}.`;
      this.current = { available: false, active: false, hostnameBase: base, detail };
      return this.current;
    }
    // Make the gateway live before anything asks for a certificate: HTTP-01 is answered by a port-80
    // block that has to be serving already.
    this.current = await gateway.syncSites({ gatewayToken: this.gatewayToken() });
    return this.current;
  }

  /** Which sites already hold a certificate, as of the last gateway sync. */
  issuedSlugs(): readonly string[] {
    return this.current.active ? this.current.slugs ?? [] : [];
  }

  /** Whether a certificate for this site may be attempted right now.
   *
   *  A certificate authority counts failed validations per hostname per hour and stops answering when
   *  that budget runs out. Retrying a site whose DNS is simply wrong would spend the budget the working
   *  sites need, so each failure backs its own slug off, doubling up to an hour. */
  mayAttempt(slug: string): boolean {
    return (this.nextAttempt.get(slug) ?? 0) <= Date.now();
  }

  /** Give one site its hostname and certificate. Throws: a publish that cannot be reached is a failed
   *  publish, not a published site with a caveat.
   *
   *  One site failing is not the gateway failing, so this never overwrites the gateway's own status —
   *  a single bad slug must not make every other site look unaddressable. */
  async ensureSite(slug: string): Promise<void> {
    const gateway = this.ctx.control('publishedSitesGateway');
    if (!gateway) throw new Error('this daemon has no published-sites gateway broker');
    try {
      const result = await gateway.ensureSite({ slug, email: this.contactEmail(), gatewayToken: this.gatewayToken() });
      if (!result.available || !result.active) {
        throw new Error(result.detail ?? `the site gateway could not publish ${slug}`);
      }
      this.nextAttempt.delete(slug);
      this.backoffMs.delete(slug);
      // `active` comes along, because the check above already refused anything else: the broker has just
      // confirmed a live gateway. Without it a stale `active: false` from an earlier failed reconcile made
      // `issuedSlugs` answer with nothing right after a successful issuance, and a caller asking which
      // certificates exist was told none of them did.
      if (result.slugs) this.current = { ...this.current, active: true, slugs: result.slugs };
    } catch (error) {
      const next = Math.min(MAX_BACKOFF_MS, (this.backoffMs.get(slug) ?? MIN_BACKOFF_MS / 2) * 2);
      this.backoffMs.set(slug, next);
      this.nextAttempt.set(slug, Date.now() + next);
      throw error;
    }
  }

  /** Take one site's hostname and certificate away. Failure propagates to the durable Site deletion marker,
   *  which keeps the slug reserved and retries until the privileged gateway confirms cleanup. */
  async removeSite(slug: string): Promise<void> {
    const gateway = this.ctx.control('publishedSitesGateway');
    // Whatever becomes of the certificate, its issuance backoff must not delay cleanup or transfer to the
    // next owner after deletion eventually completes.
    this.nextAttempt.delete(slug);
    this.backoffMs.delete(slug);
    if (!gateway) throw new Error('this daemon has no published-sites gateway broker');
    const result = await gateway.removeSite({ slug, gatewayToken: this.gatewayToken() });
    if (!result.available || !result.active) throw new Error(result.detail ?? `the site gateway could not remove ${slug}`);
    if (result.slugs) this.current = { ...this.current, slugs: result.slugs };
  }

  private contactEmail(): string {
    const configured = (this.ctx.config as Record<string, unknown>).contactEmail;
    if (typeof configured !== 'string' || configured.trim() === '') {
      throw new Error('Set a contact email in the Sites plugin settings: a certificate authority requires one to issue certificates.');
    }
    return configured.trim();
  }

  /** The gateway's health as the Settings screen reports it. This readiness check is the ONE place the
   *  required DNS record is surfaced to a person: there is no configuration form, because the record
   *  lives at a registrar and is not something this instance could write.
   *
   *  The record goes out as `fix` — labelled fields the screen renders as copyable values — rather than
   *  only as a sentence. It is transcribed by hand into somebody else's control panel, where one wrong
   *  character produces no error anywhere: the wildcard simply does not resolve, and the gateway reports
   *  the same "does not resolve" it reports when nobody created the record at all. */
  async readiness(): Promise<SiteGatewayReadiness> {
    await this.reconcile();
    const record = this.requiredRecord();
    const status: GatewayDnsState = this.current.active
      ? 'ready'
      : this.dnsCheck.state === 'ready' ? 'unavailable' : this.dnsCheck.state;
    return {
      id: 'sites-gateway',
      label: 'Published sites gateway',
      ok: this.current.active,
      status,
      detail: this.current.active ? this.current.hostnameBase ?? 'active' : this.current.detail ?? 'not configured',
      ...(this.dnsCheck.observedTargets.length > 0 ? { observedTargets: this.dnsCheck.observedTargets } : {}),
      ...(this.current.active || !record ? {} : {
        hint: 'Add this DNS record at the registrar for your domain. Sites start working within a minute of it resolving — nothing else has to be configured.',
        fix: [
          { label: 'Type', value: record.type },
          { label: 'Name', value: record.name },
          { label: 'Value', value: record.value },
        ],
      }),
    };
  }
}
