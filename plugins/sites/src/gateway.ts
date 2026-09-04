import { randomBytes } from 'node:crypto';
import { Resolver } from 'node:dns/promises';
import type { SitesContext, SitesGatewayStatus } from './coreSeams.js';

const GATEWAY_TOKEN_KEY = 'gatewayToken';
const DNS_TIMEOUT_MS = 5_000;
const MIN_BACKOFF_MS = 60_000;
const MAX_BACKOFF_MS = 3600_000;

/** The exact record an operator has to create, so the failure is actionable without documentation. */
export type RequiredRecord = { name: string; type: 'CNAME'; value: string };

export interface GatewayDnsResolver {
  resolveCname(hostname: string): Promise<string[]>;
  resolve4(hostname: string): Promise<string[]>;
  resolve6(hostname: string): Promise<string[]>;
}

export type GatewayDnsState = 'ready' | 'missing' | 'misdirected' | 'unavailable';

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
type DnsAnswer = { values: string[]; missing: boolean; error: string | null };

const normalizedHost = (value: string): string => value.trim().replace(/\.+$/, '').toLowerCase();
const fqdn = (value: string): string => `${normalizedHost(value)}.`;
const negativeDnsError = (error: unknown): boolean => {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : '';
  return code === 'ENODATA' || code === 'ENOTFOUND' || code === 'EAI_NONAME';
};

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
  private readonly resolver: GatewayDnsResolver;
  private readonly randomLabel: () => string;
  private dnsCheck: DnsCheck = { state: 'unavailable', observedTargets: [], detail: 'DNS has not been checked yet.' };

  constructor(private readonly ctx: SitesContext, deps: {
    resolver?: GatewayDnsResolver;
    randomLabel?: () => string;
  } = {}) {
    const resolver = new Resolver({ timeout: DNS_TIMEOUT_MS, tries: 2 });
    this.resolver = deps.resolver ?? {
      resolveCname: (hostname) => resolver.resolveCname(hostname),
      resolve4: (hostname) => resolver.resolve4(hostname),
      resolve6: (hostname) => resolver.resolve6(hostname),
    };
    this.randomLabel = deps.randomLabel ?? (() => `elowen-${randomBytes(6).toString('hex')}`);
  }

  /** Whether sites can be served at all right now, as of the last reconcile. */
  isActive(): boolean {
    return this.current.active;
  }

  status(): SitesGatewayStatus {
    return this.current;
  }

  /** The base every site hostname is built on. Read straight from the broker, which derives it from
   *  trusted install metadata — NOT from the last reconcile. A tool call runs in a forked runner that
   *  never reconciles, and a site's address must be the same fact there as in the daemon. Whether the
   *  address currently WORKS is a separate question, answered by `isActive`. */
  hostnameBase(): string | null {
    return this.brokerHostnameBase();
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

  /** The record an operator must create for this instance, derived from the hostname the broker owns.
   *  Null only when the daemon has no site hostname at all, in which case there is nothing to point at. */
  requiredRecord(): RequiredRecord | null {
    const base = this.brokerHostnameBase();
    const appHost = this.appHost();
    if (!base || !appHost) return null;
    // Fully qualified on both sides, because registrar panels disagree about whether they append the
    // zone. A CNAME rather than an A record: it follows the app's own name, so it survives the address
    // changing underneath, and chaining to another CNAME is well-defined.
    return { name: `*.${base}`, type: 'CNAME', value: `${appHost}.` };
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

  private async answer(query: () => Promise<string[]>): Promise<DnsAnswer> {
    try { return { values: await query(), missing: false, error: null }; }
    catch (error) {
      if (negativeDnsError(error)) return { values: [], missing: true, error: null };
      return { values: [], missing: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async cnameTargets(probe: string, appHost: string): Promise<{
    reachesApp: boolean;
    observed: string[];
    errors: string[];
  }> {
    const pending = [probe];
    const visited = new Set<string>();
    const observed = new Set<string>();
    const errors: string[] = [];
    for (let depth = 0; pending.length > 0 && depth < 8; depth += 1) {
      const current = normalizedHost(pending.shift() ?? '');
      if (!current || visited.has(current)) continue;
      visited.add(current);
      const answer = await this.answer(() => this.resolver.resolveCname(fqdn(current)));
      if (answer.error) errors.push(answer.error);
      for (const raw of answer.values) {
        const target = normalizedHost(raw);
        if (!target) continue;
        observed.add(target);
        if (target === appHost) return { reachesApp: true, observed: [...observed], errors };
        if (!visited.has(target)) pending.push(target);
      }
    }
    return { reachesApp: false, observed: [...observed], errors };
  }

  private async sampledAddresses(hostname: string): Promise<{
    ipv4: Set<string>;
    ipv6: Set<string>;
    answered: boolean;
    errors: string[];
  }> {
    const ipv4 = new Set<string>();
    const ipv6 = new Set<string>();
    const errors: string[] = [];
    let answered = false;
    for (let sample = 0; sample < 2; sample += 1) {
      const [v4, v6] = await Promise.all([
        this.answer(() => this.resolver.resolve4(fqdn(hostname))),
        this.answer(() => this.resolver.resolve6(fqdn(hostname))),
      ]);
      for (const value of v4.values) ipv4.add(value);
      for (const value of v6.values) ipv6.add(value.toLowerCase());
      answered = answered || v4.values.length > 0 || v6.values.length > 0;
      if (v4.error) errors.push(v4.error);
      if (v6.error) errors.push(v6.error);
    }
    return { ipv4, ipv6, answered, errors };
  }

  /** Prove that a random wildcard label reaches this instance, either through a CNAME chain or through
   *  flattened A/AAAA answers. Every query is absolute so a host search domain cannot change the result. */
  private async checkWildcard(base: string, appHostname: string): Promise<DnsCheck> {
    const probe = normalizedHost(`${this.randomLabel()}.${base}`);
    const appHost = normalizedHost(appHostname);
    const cname = await this.cnameTargets(probe, appHost);
    if (cname.reachesApp) return { state: 'ready', observedTargets: cname.observed };

    const [probeAddresses, appAddresses] = await Promise.all([
      this.sampledAddresses(probe),
      this.sampledAddresses(appHost),
    ]);
    const ipv4Matches = [...probeAddresses.ipv4].some((address) => appAddresses.ipv4.has(address));
    const ipv6Matches = [...probeAddresses.ipv6].some((address) => appAddresses.ipv6.has(address));
    const observedTargets = [...new Set([
      ...cname.observed,
      ...probeAddresses.ipv4,
      ...probeAddresses.ipv6,
    ])].slice(0, 8);
    if (ipv4Matches || ipv6Matches) return { state: 'ready', observedTargets };
    if (!probeAddresses.answered && cname.observed.length === 0) {
      const errors = [...cname.errors, ...probeAddresses.errors];
      return errors.length > 0
        ? { state: 'unavailable', observedTargets, detail: errors[0] }
        : { state: 'missing', observedTargets };
    }
    const errors = [...cname.errors, ...probeAddresses.errors, ...appAddresses.errors];
    if (errors.length > 0) return { state: 'unavailable', observedTargets, detail: errors[0] };
    return { state: 'misdirected', observedTargets };
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
    const appHost = this.appHost();
    if (!appHost) {
      this.dnsCheck = { state: 'unavailable', observedTargets: [], detail: 'The application hostname is unavailable.' };
      this.current = {
        available: false,
        active: false,
        hostnameBase: base,
        detail: this.dnsCheck.detail,
      };
      return this.current;
    }
    this.dnsCheck = await this.checkWildcard(base, appHost);
    if (this.dnsCheck.state !== 'ready') {
      // Fail loudly and stay failed. Serving the pages from the app's own origin instead would put
      // agent-authored script next to the app's session cookie, so there is nothing to fall back to.
      const observed = this.dnsCheck.observedTargets.length > 0
        ? ` Observed: ${this.dnsCheck.observedTargets.join(', ')}.`
        : '';
      const detail = this.dnsCheck.state === 'missing'
        ? `*.${base} does not resolve, so no site can be addressed or given a certificate.`
        : this.dnsCheck.state === 'misdirected'
          ? `*.${base} resolves, but not to ${appHost}.${observed}`
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
      if (result.slugs) this.current = { ...this.current, slugs: result.slugs };
    } catch (error) {
      const next = Math.min(MAX_BACKOFF_MS, (this.backoffMs.get(slug) ?? MIN_BACKOFF_MS / 2) * 2);
      this.backoffMs.set(slug, next);
      this.nextAttempt.set(slug, Date.now() + next);
      throw error;
    }
  }

  /** Take one site's hostname and certificate away. Never throws: the site is already gone from the
   *  store by the time this runs, and a stuck certificate must not block the deletion that removed it. */
  async removeSite(slug: string): Promise<void> {
    const gateway = this.ctx.control('publishedSitesGateway');
    // Whatever becomes of the certificate, this slug is gone. Keeping its backoff would hand the delay
    // to whoever is issued that slug next, and would grow both maps for the life of the process.
    this.nextAttempt.delete(slug);
    this.backoffMs.delete(slug);
    if (!gateway) return;
    try {
      const result = await gateway.removeSite({ slug, gatewayToken: this.gatewayToken() });
      if (result.slugs) this.current = { ...this.current, slugs: result.slugs };
    } catch (error) {
      this.ctx.logger.warn(`site gateway kept ${slug}: ${error instanceof Error ? error.message : String(error)}`);
    }
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
