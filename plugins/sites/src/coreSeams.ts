import type { PluginContext, PluginHttpRequest, PluginHttpResponse, SandboxControl } from 'elowen/plugin-api';
import type { ManagedProjectFiles } from './managedPublish.js';

/** The registry compiles against the published package while Sites targets a newer core. Keep the narrow
 * runtime shape here until that package release contains the same project transports. */
type SitesSandboxControl = Pick<
  SandboxControl,
  'projectPreviewBinding' | 'projectPublicationBinding' | 'projectPublicationRelease'
> & ManagedProjectFiles;

export interface SitesGatewayStatus {
  available: boolean;
  active: boolean;
  hostnameBase: string | null;
  detail?: string;
  slugs?: string[];
}

interface SitesGatewayControl {
  hostnameBase(): string | null;
  syncSites(input: { gatewayToken: string }): Promise<SitesGatewayStatus>;
  ensureSite(input: { slug: string; email: string; gatewayToken: string }): Promise<SitesGatewayStatus>;
  removeSite(input: { slug: string; gatewayToken: string }): Promise<SitesGatewayStatus>;
  deny(): Promise<SitesGatewayStatus>;
  status(): Promise<SitesGatewayStatus>;
}

export interface SitesUserView {
  id: number;
  username: string;
  name: string;
  avatar: string;
  isAdmin: boolean;
}

export type SitesHttpResponse = Omit<PluginHttpResponse, 'headers' | 'body'> & {
  headers?: Record<string, string | string[]>;
  body?: string | Uint8Array | ReadableStream<Uint8Array> | object;
};

export type SitesHttpRequest = PluginHttpRequest & { acceptsStreamBody?: boolean };

export type SitesContext = Omit<PluginContext, 'control' | 'registerHttpRoute' | 'registerService'> & {
  control(name: 'sandbox'): SitesSandboxControl | undefined;
  control(name: 'publishedSitesGateway'): SitesGatewayControl | undefined;
  registerHttpRoute(route: {
    path: string;
    handler(req: SitesHttpRequest): SitesHttpResponse | Promise<SitesHttpResponse>;
  }): void;
  registerService(service: {
    name: string;
    criticalStop?: boolean;
    start(): void | Promise<void>;
    stop(): void | Promise<void>;
  }): void;
};

export const asUserViews = (users: readonly { id: number; username: string; isAdmin: boolean }[]): SitesUserView[] =>
  users as unknown as SitesUserView[];

export const asSitesContext = (ctx: PluginContext): SitesContext => ctx as unknown as SitesContext;
