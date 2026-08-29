import { randomBytes } from 'node:crypto';
import { Resolver } from 'node:dns/promises';
const GATEWAY_TOKEN_KEY = 'gatewayToken';
const DNS_TIMEOUT_MS = 5_000;
const MIN_BACKOFF_MS = 60_000;
const MAX_BACKOFF_MS = 3600_000;
/** Owns the one conversation with the root broker: the shared marker token, per-site certificates, and
 *  the check that the wildcard DNS record this whole feature stands on actually exists.
 *
 *  There are no credentials here and no provisioning form. A certificate is obtained over HTTP-01, which
 *  needs nothing but the wildcard record already resolving to this machine, so the only thing that can
 *  be missing is that record — and the only useful thing to do about it is say so precisely. */
export class SiteGatewayManager {
    ctx;
    current = {
        available: false,
        active: false,
        hostnameBase: null,
        detail: 'the published-sites gateway has not been checked yet',
    };
    cachedToken = null;
    reconciling = null;
    nextAttempt = new Map();
    backoffMs = new Map();
    constructor(ctx) {
        this.ctx = ctx;
    }
    /** Whether sites can be served at all right now, as of the last reconcile. */
    isActive() {
        return this.current.active;
    }
    status() {
        return this.current;
    }
    /** The base every site hostname is built on. Read straight from the broker, which derives it from
     *  trusted install metadata — NOT from the last reconcile. A tool call runs in a forked runner that
     *  never reconciles, and a site's address must be the same fact there as in the daemon. Whether the
     *  address currently WORKS is a separate question, answered by `isActive`. */
    hostnameBase() {
        return this.brokerHostnameBase();
    }
    gatewayToken() {
        if (this.cachedToken)
            return this.cachedToken;
        const bag = this.ctx.instanceSecrets();
        const existing = bag.get(GATEWAY_TOKEN_KEY)?.value;
        if (existing) {
            this.cachedToken = existing;
            return existing;
        }
        const minted = randomBytes(32).toString('base64url');
        try {
            bag.set(GATEWAY_TOKEN_KEY, minted);
            this.cachedToken = minted;
        }
        catch {
            this.cachedToken = bag.get(GATEWAY_TOKEN_KEY)?.value ?? minted;
        }
        return this.cachedToken;
    }
    /** The record an operator must create for this instance, derived from the hostname the broker owns.
     *  Null only when the daemon has no site hostname at all, in which case there is nothing to point at. */
    requiredRecord() {
        const base = this.brokerHostnameBase();
        const appHost = this.appHost();
        if (!base || !appHost)
            return null;
        // Fully qualified on both sides, because registrar panels disagree about whether they append the
        // zone. A CNAME rather than an A record: it follows the app's own name, so it survives the address
        // changing underneath, and chaining to another CNAME is well-defined.
        return { name: `*.${base}`, type: 'CNAME', value: `${appHost}.` };
    }
    brokerHostnameBase() {
        return this.ctx.control('publishedSitesGateway')?.hostnameBase() ?? null;
    }
    appHost() {
        const url = this.ctx.publicWebUrl();
        if (!url)
            return null;
        try {
            return new URL(url).hostname;
        }
        catch {
            return null;
        }
    }
    reconcile() {
        if (this.reconciling)
            return this.reconciling;
        const run = this.reconcileNow().finally(() => { this.reconciling = null; });
        this.reconciling = run;
        return run;
    }
    /** Does the wildcard actually resolve? Asked with a random label so the answer proves the WILDCARD
     *  exists rather than one leftover record, and so a cached negative for a real slug cannot mask it. */
    async wildcardResolves(base) {
        const resolver = new Resolver({ timeout: DNS_TIMEOUT_MS, tries: 2 });
        const probe = `elowen-${randomBytes(6).toString('hex')}.${base}`;
        try {
            const addresses = await resolver.resolve4(probe);
            return addresses.length > 0;
        }
        catch {
            return false;
        }
    }
    async reconcileNow() {
        const gateway = this.ctx.control('publishedSitesGateway');
        if (!gateway) {
            this.current = { available: false, active: false, hostnameBase: null, detail: 'this daemon has no published-sites gateway broker' };
            return this.current;
        }
        const base = gateway.hostnameBase();
        if (!base) {
            this.current = await gateway.status();
            return this.current;
        }
        if (!await this.wildcardResolves(base)) {
            // Fail loudly and stay failed. Serving the pages from the app's own origin instead would put
            // agent-authored script next to the app's session cookie, so there is nothing to fall back to.
            this.current = {
                available: false,
                active: false,
                hostnameBase: base,
                detail: `*.${base} does not resolve, so no site can be addressed or given a certificate`,
            };
            return this.current;
        }
        // Make the gateway live before anything asks for a certificate: HTTP-01 is answered by a port-80
        // block that has to be serving already.
        this.current = await gateway.syncSites({ gatewayToken: this.gatewayToken() });
        return this.current;
    }
    /** Which sites already hold a certificate, as of the last gateway sync. */
    issuedSlugs() {
        return this.current.active ? this.current.slugs ?? [] : [];
    }
    /** Whether a certificate for this site may be attempted right now.
     *
     *  A certificate authority counts failed validations per hostname per hour and stops answering when
     *  that budget runs out. Retrying a site whose DNS is simply wrong would spend the budget the working
     *  sites need, so each failure backs its own slug off, doubling up to an hour. */
    mayAttempt(slug) {
        return (this.nextAttempt.get(slug) ?? 0) <= Date.now();
    }
    /** Give one site its hostname and certificate. Throws: a publish that cannot be reached is a failed
     *  publish, not a published site with a caveat.
     *
     *  One site failing is not the gateway failing, so this never overwrites the gateway's own status —
     *  a single bad slug must not make every other site look unaddressable. */
    async ensureSite(slug) {
        const gateway = this.ctx.control('publishedSitesGateway');
        if (!gateway)
            throw new Error('this daemon has no published-sites gateway broker');
        try {
            const result = await gateway.ensureSite({ slug, email: this.contactEmail(), gatewayToken: this.gatewayToken() });
            if (!result.available || !result.active) {
                throw new Error(result.detail ?? `the site gateway could not publish ${slug}`);
            }
            this.nextAttempt.delete(slug);
            this.backoffMs.delete(slug);
            if (result.slugs)
                this.current = { ...this.current, slugs: result.slugs };
        }
        catch (error) {
            const next = Math.min(MAX_BACKOFF_MS, (this.backoffMs.get(slug) ?? MIN_BACKOFF_MS / 2) * 2);
            this.backoffMs.set(slug, next);
            this.nextAttempt.set(slug, Date.now() + next);
            throw error;
        }
    }
    /** Take one site's hostname and certificate away. Never throws: the site is already gone from the
     *  store by the time this runs, and a stuck certificate must not block the deletion that removed it. */
    async removeSite(slug) {
        const gateway = this.ctx.control('publishedSitesGateway');
        // Whatever becomes of the certificate, this slug is gone. Keeping its backoff would hand the delay
        // to whoever is issued that slug next, and would grow both maps for the life of the process.
        this.nextAttempt.delete(slug);
        this.backoffMs.delete(slug);
        if (!gateway)
            return;
        try {
            const result = await gateway.removeSite({ slug, gatewayToken: this.gatewayToken() });
            if (result.slugs)
                this.current = { ...this.current, slugs: result.slugs };
        }
        catch (error) {
            this.ctx.logger.warn(`site gateway kept ${slug}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    contactEmail() {
        const configured = this.ctx.config.contactEmail;
        if (typeof configured !== 'string' || configured.trim() === '') {
            throw new Error('Set a contact email in the Sites plugin settings: a certificate authority requires one to issue certificates.');
        }
        return configured.trim();
    }
    /** The gateway's health as the Settings screen reports it. This readiness check is the ONE place the
     *  required DNS record is surfaced to a person: there is no configuration form, because the record
     *  lives at a registrar and is not something this instance could write. */
    async readiness() {
        await this.reconcile();
        const record = this.requiredRecord();
        return {
            id: 'sites-gateway',
            label: 'Published sites gateway',
            ok: this.current.active,
            detail: this.current.active ? this.current.hostnameBase ?? 'active' : this.current.detail ?? 'not configured',
            ...(this.current.active || !record ? {} : {
                hint: `Create this DNS record at your domain's registrar: ${record.name} ${record.type} ${record.value}`,
            }),
        };
    }
}
