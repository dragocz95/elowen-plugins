import type {
  PluginContext, PluginHttpRequest, PluginHttpResponse, SandboxControl, SiteEnvironmentRegistration,
} from 'elowen/plugin-api';

export type SitesSiteEnvironmentRegistration = SiteEnvironmentRegistration & { sourceRel?: string; persistentRootfs?: boolean };

/** ⚠️ WHY THIS SHAPE IS WRITTEN OUT HERE INSTEAD OF IMPORTED.
 *
 *  This registry compiles against the PUBLISHED `elowen` package, which is currently older than the
 *  daemon this plugin targets: `prepareExecution` gained a second argument, and the `sites` lease kind,
 *  in the release named by `requiresCore`. Casting `ctx` to `any` would compile just as well and would
 *  hide a real mismatch, so the shape is stated once, here, and used everywhere else.
 *
 *  The guard that actually protects a running instance is `requiresCore` in the manifest: the loader
 *  refuses to load this plugin on a daemon older than the release that carries the seam, so the
 *  declaration below can never be wrong at runtime in the way an unchecked cast could be. When the
 *  package catches up, delete this file and import the types directly. */

export type SitesSandboxControl = Omit<SandboxControl, 'requestSiteEnvironment'> & {
  projectWorkspaceHostPath(input: { projectId: number }): Promise<string>;
  requestSiteEnvironment(
    input: Parameters<SandboxControl['requestSiteEnvironment']>[0] & { handover?: boolean },
  ): ReturnType<SandboxControl['requestSiteEnvironment']>;
};

export interface SitesGatewayStatus {
  available: boolean;
  active: boolean;
  hostnameBase: string | null;
  detail?: string;
  slugs?: string[];
}

export interface PublishedSitesEnvironmentStatusItem {
  id: string;
  label: string;
  ok: boolean;
  /** The check could not run, so this row is informational and must not be treated as installable failure. */
  unknown?: boolean;
  detail?: string;
}

export interface PublishedSitesEnvironmentStatus {
  ready: boolean;
  items: PublishedSitesEnvironmentStatusItem[];
  detail?: string;
}

interface SitesGatewayControl {
  hostnameBase(): string | null;
  syncSites(input: { gatewayToken: string }): Promise<SitesGatewayStatus>;
  ensureSite(input: { slug: string; email: string; gatewayToken: string }): Promise<SitesGatewayStatus>;
  removeSite(input: { slug: string; gatewayToken: string }): Promise<SitesGatewayStatus>;
  deny(): Promise<SitesGatewayStatus>;
  status(): Promise<SitesGatewayStatus>;
  prepareRuntimeSocket(siteId: string): Promise<{ path: string }>;
  sealRuntimeSocket(siteId: string): Promise<void>;
  removeRuntimeSocket(siteId: string): Promise<void>;
  environmentsStatus(): Promise<PublishedSitesEnvironmentStatus>;
  provisionEnvironments(): Promise<PublishedSitesEnvironmentStatus>;
}

/** An account as the host hands it over. The published package still describes it without the display
 *  name and the avatar, which arrived in the release named by `requiresCore`. */
export interface SitesUserView {
  id: number;
  username: string;
  name: string;
  avatar: string;
  isAdmin: boolean;
}

export type SitesHttpResponse = Omit<PluginHttpResponse, 'headers' | 'body'> & {
  headers?: Record<string, string | string[]>;
  /** A stream body reaches the client without the daemon holding the file, which is what makes a
   *  multi-gigabyte asset servable at all. The published package still types the body without it. */
  body?: string | Uint8Array | ReadableStream<Uint8Array> | object;
};

/** The inbound request with the one field this plugin reads that the published package predates.
 *
 *  `acceptsStreamBody` is how a plugin that ships separately from the daemon learns whether THIS daemon
 *  can send a stream. It is absent on every daemon released before the seam, where a stream body would
 *  be JSON-serialized into `{}` — so the answer decides between streaming and the old buffered path. */
export type SitesHttpRequest = PluginHttpRequest & { acceptsStreamBody?: boolean };

/** The plugin context as this plugin actually uses it. */
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

/** The account list as the daemon actually returns it, for the one call site that needs the picture. */
export const asUserViews = (users: readonly { id: number; username: string; isAdmin: boolean }[]): SitesUserView[] =>
  users as unknown as SitesUserView[];

/** The single place the published context is read as the one the daemon actually provides. */
export const asSitesContext = (ctx: PluginContext): SitesContext => ctx as unknown as SitesContext;
