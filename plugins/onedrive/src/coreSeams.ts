import type { PluginContext } from 'elowen/plugin-api';

/** ⚠️ WHY THESE SHAPES ARE WRITTEN OUT HERE INSTEAD OF IMPORTED.
 *
 *  This registry compiles against the PUBLISHED `elowen` package, which is currently older than the
 *  daemon this plugin targets: the seams below (`registerUiVisibility`, `microsoftIdentity`, the
 *  account-explicit `workspacesFor`, and `userProjects` on the host stores) all exist in core but are not
 *  in the published type declarations yet. Casting `ctx` to `any` would compile just as well and would
 *  hide a real mismatch, so the shapes are stated once, here, and used everywhere else.
 *
 *  The guard that actually protects a running instance is `requiresCore` in the manifest: the loader
 *  refuses to load this plugin on a daemon older than the release that carries these seams, so the
 *  declarations below can never be wrong at runtime in the way an unchecked cast could be. When the
 *  package catches up, delete this file and import the types directly. */

/** One badge on a project row in the Projects list. Written out for the same reason as everything else
 *  in this file: the published package predates its export. */
export interface ProjectIndicator {
  projectId: number;
  label: string;
  value?: string;
  icon?: string;
  tone?: 'muted' | 'accent' | 'success' | 'warning' | 'danger';
}

export interface MicrosoftIdentity {
  linked: boolean;
  upn?: string;
  displayName?: string;
}

export interface MicrosoftGraphRequestOptions {
  body?: unknown;
  contentType?: string;
  accept?: string;
  ifMatch?: string;
  headers?: Record<string, string>;
  maxBytes?: number;
}

/** A delegated Microsoft Graph client already confined to the signed-in person's drive namespace. */
export interface MicrosoftDriveGraph {
  json(method: string, path: string, options?: MicrosoftGraphRequestOptions): Promise<unknown>;
  binary(path: string, options?: MicrosoftGraphRequestOptions): Promise<{ body: Uint8Array; contentType: string }>;
  request(method: string, path: string, options?: MicrosoftGraphRequestOptions): Promise<Response>;
}

export interface MicrosoftIdentityControl {
  identityFor(userId: number): MicrosoftIdentity;
  driveGraphFor(userId: number): Promise<MicrosoftDriveGraph | null>;
}

export interface SandboxWorkspaceView {
  workspaceId: string;
  projectId: number;
  path: string;
  label: string;
  branch: string;
  baseRef: string;
}

export interface SandboxAccountControl {
  workspacesFor(input: { userId: number; projectIds?: readonly number[] }): SandboxWorkspaceView[];
}

export type UiVisibility = (req: { userId: number | null; isAdmin: boolean }) =>
  { account?: readonly string[]; project?: readonly string[] } | null;

/** The plugin context as this plugin actually uses it. */
export type OneDriveContext = Omit<PluginContext, 'control' | 'host'> & {
  control(name: 'microsoftIdentity'): MicrosoftIdentityControl | undefined;
  control(name: 'sandbox'): SandboxAccountControl | undefined;
  registerUiVisibility(fn: UiVisibility): void;
  registerProjectIndicators(
    provider: (request: { projects: readonly { id: number }[]; user: { id: number; isAdmin: boolean } | null }) => ProjectIndicator[],
  ): void;
  registerProjectRemoved(fn: (projectId: number) => void | Promise<void>): void;
  registerUserRemoved?(fn: (userId: number) => void | Promise<void>): void;
  // `stores` is REPLACED rather than intersected: an intersection of two call signatures resolves to the
  // first one, so the extra member would type-check as absent at every call site.
  host: Omit<PluginContext['host'], 'stores'> & {
    stores: () => ReturnType<PluginContext['host']['stores']> & {
      userProjects: { canAccess(userId: number, projectId: number): boolean };
    };
  };
};

/** The single place the published context is read as the one the daemon actually provides. */
export const asOneDriveContext = (ctx: PluginContext): OneDriveContext => ctx as unknown as OneDriveContext;
