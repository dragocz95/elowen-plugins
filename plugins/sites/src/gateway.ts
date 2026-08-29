import { randomBytes } from 'node:crypto';
import type { PluginApiRequest, PluginHttpResponse } from 'elowen/plugin-api';
import type { SitesContext, SitesGatewayStatus } from './coreSeams.js';

const GATEWAY_TOKEN_KEY = 'gatewayToken';
const NAMECHEAP_KEYS = {
  apiUser: 'namecheapApiUser',
  apiKey: 'namecheapApiKey',
  username: 'namecheapUsername',
  clientIp: 'namecheapClientIp',
  email: 'acmeEmail',
} as const;

type CredentialField = keyof typeof NAMECHEAP_KEYS;
type Credentials = Record<CredentialField, string>;

export interface GatewayPayload {
  status: SitesGatewayStatus;
  configured: Record<CredentialField, boolean>;
}

const json = (status: number, body: unknown): PluginHttpResponse => ({
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  body: body as object,
});

/** Owns the encrypted Namecheap credentials and the one root-broker conversation. Kept out of index.ts
 * so the security boundary is directly testable without loading the whole plugin and starting services. */
export class SiteGatewayManager {
  private current: SitesGatewayStatus = {
    available: false,
    active: false,
    hostnameBase: null,
    detail: 'the published-sites gateway has not been checked yet',
  };
  private cachedToken: string | null = null;
  private reconciling: Promise<SitesGatewayStatus> | null = null;

  constructor(private readonly ctx: SitesContext) {}

  status(): SitesGatewayStatus {
    return this.current;
  }

  hostnameBase(): string | null {
    return this.current.active ? this.current.hostnameBase : null;
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

  private credentials(): Credentials {
    const bag = this.ctx.instanceSecrets();
    return Object.fromEntries(
      Object.entries(NAMECHEAP_KEYS).map(([field, key]) => [field, bag.get(key)?.value ?? '']),
    ) as unknown as Credentials;
  }

  payload(): GatewayPayload {
    const credentials = this.credentials();
    return {
      status: this.current,
      configured: Object.fromEntries(
        Object.keys(NAMECHEAP_KEYS).map((field) => [field, credentials[field as CredentialField] !== '']),
      ) as Record<CredentialField, boolean>,
    };
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
    const credentials = this.credentials();
    const complete = Object.values(credentials).every((value) => value !== '');
    this.current = complete
      ? await gateway.provisionNamecheap({ ...credentials, gatewayToken: this.gatewayToken() })
      : await gateway.status();
    return this.current;
  }

  async handle(req: PluginApiRequest): Promise<PluginHttpResponse> {
    if (req.method === 'GET') {
      await this.reconcile();
      return json(200, this.payload());
    }
    if (req.method === 'PUT') {
      const body = await req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
      const bag = this.ctx.instanceSecrets();
      for (const [field, key] of Object.entries(NAMECHEAP_KEYS)) {
        const value = body[field];
        if (value === null) bag.delete(key);
        else if (typeof value === 'string' && value.trim() !== '') bag.set(key, value.trim());
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
      try { this.current = await gateway.deny(); }
      catch (error) {
        this.current = {
          available: false,
          active: true,
          hostnameBase: this.current.hostnameBase,
          detail: error instanceof Error ? error.message : String(error),
        };
        return json(503, this.payload());
      }
      if (!this.current.available || this.current.active) return json(503, this.payload());
      const bag = this.ctx.instanceSecrets();
      for (const key of Object.values(NAMECHEAP_KEYS)) bag.delete(key);
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
