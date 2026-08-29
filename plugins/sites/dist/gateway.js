import { randomBytes } from 'node:crypto';
const GATEWAY_TOKEN_KEY = 'gatewayToken';
const NAMECHEAP_KEYS = {
    apiUser: 'namecheapApiUser',
    apiKey: 'namecheapApiKey',
    username: 'namecheapUsername',
    clientIp: 'namecheapClientIp',
    email: 'acmeEmail',
};
const json = (status, body) => ({
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    body: body,
});
/** Owns the encrypted Namecheap credentials and the one root-broker conversation. Kept out of index.ts
 * so the security boundary is directly testable without loading the whole plugin and starting services. */
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
    constructor(ctx) {
        this.ctx = ctx;
    }
    status() {
        return this.current;
    }
    hostnameBase() {
        return this.current.active ? this.current.hostnameBase : null;
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
    credentials() {
        const bag = this.ctx.instanceSecrets();
        return Object.fromEntries(Object.entries(NAMECHEAP_KEYS).map(([field, key]) => [field, bag.get(key)?.value ?? '']));
    }
    payload() {
        const credentials = this.credentials();
        return {
            status: this.current,
            configured: Object.fromEntries(Object.keys(NAMECHEAP_KEYS).map((field) => [field, credentials[field] !== ''])),
        };
    }
    reconcile() {
        if (this.reconciling)
            return this.reconciling;
        const run = this.reconcileNow().finally(() => { this.reconciling = null; });
        this.reconciling = run;
        return run;
    }
    async reconcileNow() {
        const gateway = this.ctx.control('publishedSitesGateway');
        if (!gateway) {
            this.current = { available: false, active: false, hostnameBase: null, detail: 'this daemon has no published-sites gateway broker' };
            return this.current;
        }
        const credentials = this.credentials();
        const complete = Object.values(credentials).every((value) => value !== '');
        this.current = complete
            ? await gateway.provisionNamecheap({ ...credentials, gatewayToken: this.gatewayToken() })
            : await gateway.status();
        return this.current;
    }
    async handle(req) {
        if (req.method === 'GET') {
            await this.reconcile();
            return json(200, this.payload());
        }
        if (req.method === 'PUT') {
            const body = await req.json().catch(() => ({}));
            const bag = this.ctx.instanceSecrets();
            for (const [field, key] of Object.entries(NAMECHEAP_KEYS)) {
                const value = body[field];
                if (value === null)
                    bag.delete(key);
                else if (typeof value === 'string' && value.trim() !== '')
                    bag.set(key, value.trim());
            }
            await this.reconcile();
            // Saving and provisioning are separate facts. The encrypted write succeeded even when DNS or ACME
            // is not ready, so return that operational state as data rather than a success-shaped HTTP error.
            return json(200, this.payload());
        }
        if (req.method === 'DELETE') {
            const gateway = this.ctx.control('publishedSitesGateway');
            if (!gateway) {
                this.current = { available: false, active: false, hostnameBase: null, detail: 'this daemon has no published-sites gateway broker' };
                return json(503, this.payload());
            }
            try {
                this.current = await gateway.deny();
            }
            catch (error) {
                this.current = {
                    available: false,
                    active: true,
                    hostnameBase: this.current.hostnameBase,
                    detail: error instanceof Error ? error.message : String(error),
                };
                return json(503, this.payload());
            }
            if (!this.current.available || this.current.active)
                return json(503, this.payload());
            const bag = this.ctx.instanceSecrets();
            for (const key of Object.values(NAMECHEAP_KEYS))
                bag.delete(key);
            return json(200, this.payload());
        }
        return json(405, { error: 'method not allowed' });
    }
    async readiness() {
        await this.reconcile();
        return {
            id: 'sites-gateway',
            label: 'Published sites gateway',
            ok: this.current.active,
            detail: this.current.active ? this.current.hostnameBase ?? 'active' : this.current.detail ?? 'not configured',
            ...(this.current.active ? {} : { hint: 'Open Sites as an administrator and configure Namecheap DNS + ACME.' }),
        };
    }
}
