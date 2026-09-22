import { randomBytes } from 'node:crypto';
import { Resolver } from 'node:dns/promises';
import { derivedHostnameBase } from './config.js';
import { GatewayDnsTargetService, } from './dns.js';
const TOKEN_KEY = 'gatewayToken';
const PROBE_LABEL_BYTES = 8;
const READINESS_DNS_SAMPLES = 2;
const unavailableStatus = (detail, hostnameBase) => ({
    available: false,
    active: false,
    hostnameBase,
    detail,
});
export class SiteGatewayManager {
    ctx;
    status = null;
    inFlight = null;
    destination;
    randomLabel;
    constructor(ctx, deps = {}) {
        this.ctx = ctx;
        const resolver = deps.resolver ?? new Resolver({ timeout: 5_000, tries: 2 });
        const trafficResolver = {
            resolveCname: (hostname) => resolver.resolveCname(hostname),
            resolve4: (hostname) => resolver.resolve4(hostname),
            resolve6: (hostname) => resolver.resolve6(hostname),
        };
        this.destination = new GatewayDnsTargetService({
            configured: () => this.ctx.config.gatewayDnsTarget,
            fallbackHostname: () => this.appHostname(),
            resolver: trafficResolver,
        });
        this.randomLabel = deps.randomLabel ?? (() => `elowen-probe-${randomBytes(PROBE_LABEL_BYTES).toString('hex')}`);
    }
    control() {
        return this.ctx.control('publishedSitesGateway');
    }
    appHostname() {
        const web = this.ctx.publicWebUrl();
        if (!web)
            return null;
        try {
            return new URL(web).hostname.toLowerCase();
        }
        catch {
            return null;
        }
    }
    hostnameBase() {
        return this.control()?.hostnameBase() ?? derivedHostnameBase(this.ctx.publicWebUrl());
    }
    reservedHostnames() {
        return this.control()?.reservedHostnames() ?? [];
    }
    gatewayToken() {
        const existing = this.ctx.instanceSecrets().get(TOKEN_KEY);
        if (existing)
            return existing.value;
        const token = randomBytes(32).toString('base64url');
        this.ctx.instanceSecrets().set(TOKEN_KEY, token);
        return token;
    }
    hasBroker() {
        return this.control() !== undefined;
    }
    isActive() {
        return this.status?.active === true;
    }
    bindingStatuses() {
        return this.status?.bindings ?? [];
    }
    hasCertificate(hostname) {
        return this.bindingStatuses().some((binding) => binding.hostname === hostname && binding.present);
    }
    requiredRecord() {
        const base = this.hostnameBase();
        const target = this.destination.current().target;
        return base && target ? target.requiredRecord(`*.${base}`) : null;
    }
    async checkGatewayDns() {
        const base = this.hostnameBase();
        const resolved = this.destination.current();
        if (!base) {
            return { ok: false, status: 'unavailable', detail: 'This Elowen installation has no HTTPS domain available for published sites.' };
        }
        if (!resolved.target) {
            return { ok: false, status: 'unavailable', detail: resolved.error ?? 'The Sites DNS destination is not configured.' };
        }
        const probe = `${this.randomLabel()}.${base}`;
        const observed = await resolved.target.verifyHostname(probe, READINESS_DNS_SAMPLES);
        const required = resolved.target.requiredRecord(`*.${base}`);
        const fix = [
            { label: 'Type', value: required.type },
            { label: 'Name', value: required.name },
            { label: 'Value', value: required.value },
        ];
        if (observed.state === 'ready') {
            return { ok: true, status: 'ready', detail: 'The published-sites gateway is active.' };
        }
        if (observed.state === 'missing') {
            return {
                ok: false,
                status: 'missing',
                detail: `The wildcard *.${base} does not resolve yet.`,
                hint: 'Create this DNS record at the registrar that controls the domain.',
                fix,
                observedTargets: observed.observedTargets,
            };
        }
        if (observed.state === 'misdirected') {
            return {
                ok: false,
                status: 'misdirected',
                detail: `The wildcard *.${base} resolves, but not to ${required.value}.`,
                hint: 'Replace the wildcard record at the registrar with the required destination.',
                fix,
                observedTargets: observed.observedTargets,
            };
        }
        return {
            ok: false,
            status: 'unavailable',
            detail: `DNS lookup could not complete: ${observed.detail ?? 'unknown resolver failure'}`,
            fix,
            observedTargets: observed.observedTargets,
        };
    }
    async recordPlan(hostname) {
        const resolved = this.destination.current();
        if (!resolved.target) {
            return {
                state: 'unavailable',
                hostname: hostname.ascii,
                kind: hostname.kind,
                delegatedRootWarning: hostname.delegatedRootWarning,
                preferred: [],
                fallback: [],
                detail: resolved.error ?? 'The Sites DNS destination is unavailable.',
            };
        }
        return resolved.target.recordPlan(hostname);
    }
    async verifyHostnameDns(hostname) {
        const resolved = this.destination.current();
        if (!resolved.target) {
            return { state: 'unavailable', observedTargets: [], detail: resolved.error ?? 'The Sites DNS destination is unavailable.' };
        }
        return resolved.target.verifyHostname(hostname, READINESS_DNS_SAMPLES);
    }
    reconcile(bindings) {
        if (this.inFlight)
            return this.inFlight;
        this.inFlight = this.reconcileOnce(bindings).finally(() => { this.inFlight = null; });
        return this.inFlight;
    }
    async reconcileOnce(bindings) {
        const control = this.control();
        if (!control) {
            this.status = unavailableStatus('The published-sites gateway broker is unavailable in this process.', this.hostnameBase());
            return this.status;
        }
        const dns = await this.checkGatewayDns();
        if (!dns.ok) {
            this.status = { available: true, active: false, hostnameBase: this.hostnameBase(), detail: dns.detail };
            return this.status;
        }
        try {
            this.status = await control.syncBindings({ bindings, gatewayToken: this.gatewayToken() });
        }
        catch (error) {
            this.status = unavailableStatus(error instanceof Error ? error.message : String(error), this.hostnameBase());
        }
        return this.status;
    }
    async ensureBinding(binding, bindings) {
        const control = this.control();
        if (!control)
            throw new Error('No published-sites gateway broker is available in this process.');
        const email = typeof this.ctx.config.contactEmail === 'string' ? this.ctx.config.contactEmail.trim() : '';
        if (!email)
            throw new Error('A contact email is required before a site certificate can be issued.');
        const status = await control.ensureBinding({
            binding,
            bindings,
            email,
            gatewayToken: this.gatewayToken(),
        });
        this.status = status;
        if (!status.available || !status.active)
            throw new Error(status.detail ?? `The gateway did not activate ${binding.hostname}.`);
        return status;
    }
    async removeBinding(hostname, slug, bindings) {
        const control = this.control();
        if (!control)
            throw new Error('No published-sites gateway broker is available in this process.');
        const status = await control.removeBinding({
            hostname,
            slug,
            bindings,
            gatewayToken: this.gatewayToken(),
        });
        this.status = status;
        if (!status.available)
            throw new Error(status.detail ?? `The gateway did not remove ${hostname}.`);
        return status;
    }
    async readiness() {
        const row = { id: 'sites-gateway', label: 'Published sites gateway' };
        const dns = await this.checkGatewayDns();
        if (!dns.ok)
            return { ...row, ...dns };
        const status = this.control() ? (this.status ?? await this.control()?.status()) : null;
        if (!status?.available) {
            return { ...row, ok: false, status: 'unavailable', detail: status?.detail ?? 'The published-sites gateway broker is unavailable.' };
        }
        return status.active
            ? { ...row, ok: true, status: 'ready', detail: status.detail ?? 'The published-sites gateway is active.' }
            : { ...row, ok: false, status: 'unavailable', detail: status.detail ?? 'The published-sites gateway is inactive.' };
    }
}
