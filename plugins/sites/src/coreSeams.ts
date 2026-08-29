import type {
  PluginContext, PluginHttpRequest, PluginHttpResponse, SandboxExecutionCommand, SandboxPreparedExecution,
} from 'elowen/plugin-api';

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

interface SandboxWorkspaceView {
  workspaceId: string;
  projectId: number;
  path: string;
  label: string;
  branch: string;
  baseRef: string;
}

interface SitesSandboxControl {
  activeWorkspace(input: { sessionId: string; projectId: number }): SandboxWorkspaceView | null;
  /** The explicit form, for a caller with no ambient turn to read. A background service has neither an
   *  identity nor a set of allowed roots, so it names both. It cannot ask for unconfined execution:
   *  an explicit request always runs under bubblewrap. */
  prepareExecution(
    input: {
      command: SandboxExecutionCommand;
      cwd: string;
      leaseKind: 'terminal' | 'github' | 'sites';
      network?: 'shared' | 'isolated';
    },
    options?: { accountUserId: number | null; roots: readonly string[] },
  ): SandboxPreparedExecution | Promise<SandboxPreparedExecution>;
}

export interface SitesGatewayStatus {
  available: boolean;
  active: boolean;
  hostnameBase: string | null;
  detail?: string;
}

interface SitesGatewayControl {
  hostnameBase(): string | null;
  provisionNamecheap(input: {
    apiUser: string; apiKey: string; username: string; clientIp: string; email: string; gatewayToken: string;
  }): Promise<SitesGatewayStatus>;
  deny(): Promise<SitesGatewayStatus>;
  status(): Promise<SitesGatewayStatus>;
  prepareRuntimeSocket(siteId: string): Promise<{ path: string }>;
  sealRuntimeSocket(siteId: string): Promise<void>;
  removeRuntimeSocket(siteId: string): Promise<void>;
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

export type SitesHttpResponse = Omit<PluginHttpResponse, 'headers'> & {
  headers?: Record<string, string | string[]>;
};

/** The plugin context as this plugin actually uses it. */
export type SitesContext = Omit<PluginContext, 'control' | 'registerHttpRoute' | 'registerService'> & {
  control(name: 'sandbox'): SitesSandboxControl | undefined;
  control(name: 'publishedSitesGateway'): SitesGatewayControl | undefined;
  registerHttpRoute(route: {
    path: string;
    handler(req: PluginHttpRequest): SitesHttpResponse | Promise<SitesHttpResponse>;
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
