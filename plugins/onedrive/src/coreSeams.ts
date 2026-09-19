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
interface ProjectIndicator {
  projectId: number;
  label: string;
  value?: string;
  icon?: string;
  tone?: 'muted' | 'accent' | 'success' | 'warning' | 'danger';
}

interface MicrosoftIdentity {
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
  /** Deadline for this one request, when the client's default is the wrong shape for it — a content
   *  upload takes as long as the file and the link decide. Bounded by the client. */
  timeoutMs?: number;
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

export interface ManagedProjectFileRoot {
  root: string;
  generation: number;
  state: 'unprovisioned' | 'starting' | 'running' | 'stopped' | 'failed' | 'deleting' | 'deleted';
  workspaceId: string | null;
}
interface GuestFileEntry { path: string; kind: 'file' | 'directory' | 'symlink' | 'other'; size: number; modifiedAt: string; version?: string }
export type GuestFileResult =
  | { kind: 'stat'; entry: GuestFileEntry | null }
  | { kind: 'list'; entries: GuestFileEntry[]; truncated: boolean; nextCursor: string | null }
  | { kind: 'read'; base64: string; version: string; totalBytes: number }
  | { kind: 'write' | 'mkdir' | 'rename' | 'write-commit'; entry: GuestFileEntry }
  | { kind: 'write-begin'; uploadId: string; chunkSize: number; received: number; resolvedPath: string }
  | { kind: 'write-chunk'; received: number }
  | { kind: 'write-abort'; aborted: true }
  | { kind: 'remove'; removed: boolean }
  | { kind: 'walk'; root: string; rootKind: 'file' | 'directory' | 'symlink' | 'other' | null; entries: { path: string; kind: 'file' | 'directory' | 'symlink'; size: number; mtime: number }[]; truncated: boolean };
interface SandboxProjectControl {
  projectFileRoot(input: { project: { kind: 'managed'; projectId: number }; accountUserId: number; workspaceId?: string | null }): Promise<ManagedProjectFileRoot>;
  projectFiles(input: { project: { kind: 'managed'; projectId: number }; accountUserId: number; operation: Record<string, unknown>; expectedGeneration?: number; workspaceId?: string | null; startIfNeeded?: boolean }): Promise<GuestFileResult>;
  prepareExecution(input: { command: { type: 'argv'; file: string; args: string[] }; cwd: string; leaseKind: 'files'; projectRef: { kind: 'managed'; projectId: number } }, options?: { accountUserId: number | null; roots: readonly string[] }): Promise<{
    mode: 'managed';
    projectRef?: { kind: 'managed'; projectId: number };
    cwd: string;
    start(): Promise<import('elowen/plugin-api').ManagedExecutionSession>;
    cancel(): Promise<void>;
    lease: { heartbeat(): void | Promise<void>; release(): void | Promise<void> };
    sanitizeOutput(text: string): string;
  }>;
}

interface SandboxWorkspaceView {
  workspaceId: string;
  projectId: number;
  path: string;
  label: string;
  branch: string;
  baseRef: string;
}

export interface SandboxAccountControl extends SandboxProjectControl {
  managedWorktrees(input: { project: { kind: 'managed'; projectId: number }; accountUserId: number; action: { kind: 'list' }; startIfNeeded?: boolean }): Promise<{ id: string; label: string; state?: string }[]>;
  workspacesFor?(input: { userId: number; projectIds?: readonly number[] }): SandboxWorkspaceView[];
}

type UiVisibility = (req: { userId: number | null; isAdmin: boolean }) =>
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
      projects: { get(id: number): { id: number; slug: string; path: string; executionKind: 'host' | 'managed' } | null };
      userProjects: { canAccess(userId: number, projectId: number): boolean };
    };
  };
};

/** The single place the published context is read as the one the daemon actually provides. */
export const asOneDriveContext = (ctx: PluginContext): OneDriveContext => ctx as unknown as OneDriveContext;
