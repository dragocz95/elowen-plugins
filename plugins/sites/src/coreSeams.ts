import type { PluginContext, PluginHttpRequest, PluginHttpResponse, SandboxControl } from 'elowen/plugin-api';

/** The registry compiles against the published package while Sites targets a newer core. Keep the narrow
 * runtime shape here until that package release contains the same project transports. `projectFiles` is
 * deliberately absent: a publication no longer copies anything out of a Project, so Sites never asks the
 * Sandbox for a guest file. */
type SitesSandboxControl = Pick<
  SandboxControl,
  'projectPreviewBinding' | 'projectPublicationBinding' | 'projectPublicationRelease'
>;

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

/** The Browser plugin's capture control, as core names it (`browserCapture`).
 *
 *  Restated here for the same reason as the Sandbox transports above: the registry compiles against the
 *  published `elowen` package, which does not carry this type until the core release that introduces it
 *  lands. It is the ONLY way this plugin can render a page: a throwaway browser, no account, one hostname
 *  it may resolve, and nothing of the reader's. Core hands it to Sites and to nobody else. */
interface SitesBrowserCapture {
  /** Whether this instance can render at all: a browser is installed and its control library loads. */
  available(): boolean;
  capture(request: {
    url: string;
    headers?: Readonly<Record<string, string>>;
    viewport: { width: number; height: number; deviceScaleFactor?: number };
    timeoutMs?: number;
    format?: 'png' | 'webp';
    maxBytes?: number;
  }): Promise<{ image: Uint8Array; mimeType: 'image/png' | 'image/webp'; width: number; height: number }>;
}

export type SitesContext = Omit<PluginContext, 'control' | 'registerHttpRoute' | 'registerService'> & {
  control(name: 'sandbox'): SitesSandboxControl | undefined;
  control(name: 'browserCapture'): SitesBrowserCapture | undefined;
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
