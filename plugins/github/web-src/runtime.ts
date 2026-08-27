import type { ComponentType } from 'react';

type AnyComponent = ComponentType<any>;
interface Account {
  userId: number; githubUserId: number; login: string; name: string | null; avatarUrl: string | null;
  status: 'connected' | 'reconnect_required'; lastError: string | null;
}
export interface StatusResponse {
  connected: boolean; reconnectRequired: boolean; account: Account | null; mappings: number;
  flow?: DeviceFlowResponse | null;
}
export interface DeviceFlowResponse {
  flowId: string; userId: number; verificationUrl: string | null; userCode: string | null; directory?: string | null;
  replaceIdentity: boolean; expiresAt: number; status: 'pending' | 'completing' | 'connected' | 'cancelled' | 'expired' | 'failed' | 'interrupted'; error: string | null;
  createdAt: number; updatedAt: number;
}
export interface RepositoryRow {
  project: { id: number; slug: string };
  mapping: null | { projectId: number; baseOwner: string; baseName: string; pushOwner: string; pushName: string; verifiedAt: number; active: boolean };
  remotes: { name: string; fetchUrl: string; pushUrl: string }[];
  detected: { ambiguous: boolean; base: { owner: string; name: string; remote: string } | null; push: { owner: string; name: string; remote: string } | null };
}
export interface PullRequest {
  number: number; title: string; state: 'open' | 'closed'; draft: boolean; htmlUrl: string; author: string;
  headRef: string; headSha: string; baseRef: string; updatedAt: string; mergeable: boolean | null; mergeableState: string | null;
  body?: string; additions?: number; deletions?: number; changedFiles?: number; reviewDecision?: 'approved' | 'changes_requested' | 'review_required' | null;
  files?: { path: string; status: string; additions: number; deletions: number; patch: string | null }[];
  reviews?: { id: number; user: string; state: string; body: string; submittedAt: string | null }[];
}
export interface Checks { state: 'pending' | 'success' | 'failure' | 'action_required'; items: { name: string; state: string; description: string | null; targetUrl: string | null }[] }
export interface Session { id: string; title: string; updated_at: string }
export interface Preview { action: Record<string, unknown>; title: string; description: string; confirmationToken: string; expiresAt: number }

interface QueryResult<T> { data?: T; isLoading: boolean; isError: boolean; error?: unknown; refetch(): void }
interface MutationResult<TVars, TData = unknown> { mutate(vars: TVars, callbacks?: { onSuccess?: (data: TData) => void; onError?: (error: unknown) => void }): void; mutateAsync(vars: TVars): Promise<TData>; isPending: boolean }
interface QueryClient { invalidateQueries(input: { queryKey: unknown[] }): Promise<void> }
interface RuntimeHooks {
  usePluginStrings(plugin: string): Record<string, string>;
  useToast(): { toast(message: string, tone?: 'ok' | 'error'): void };
  useMe(): QueryResult<{ user?: { id: number; username: string; is_admin: boolean } }>;
  useQuery<T>(options: Record<string, unknown>): QueryResult<T>;
  useMutation<TData, _TError, TVars>(options: Record<string, unknown>): MutationResult<TVars, TData>;
  useQueryClient(): QueryClient;
}
interface RuntimeComponents {
  Button: AnyComponent; Input: AnyComponent; Badge: AnyComponent; Field: AnyComponent; SelectMenu: AnyComponent;
  Modal: AnyComponent; ModalBody: AnyComponent; ModalFooter: AnyComponent; LoadingState: AnyComponent; ErrorState: AnyComponent;
  EmptyState: AnyComponent; SpatialWorkspaceLayout: AnyComponent; WorkspaceMetric: AnyComponent; WorkspaceDetailRail: AnyComponent;
  PluginSection: AnyComponent; DataTable: AnyComponent; DataTableRow: AnyComponent; DataTableCell: AnyComponent; PatchView: AnyComponent; ConfirmDialog: AnyComponent;
  // The host's own account primitives. The connection panel is one section of the Account page and
  // has to be built from the same pieces the native sections are, not from an approximation of them.
  SpatialIdentity: AnyComponent; SettingsRow: AnyComponent; Avatar: AnyComponent;
  Segmented: AnyComponent;
}
interface GitHubRuntime { components: RuntimeComponents; hooks: RuntimeHooks; utils: { apiErrorMessage(error: unknown): string }; api(path: string, init?: RequestInit): Promise<unknown>; navigate(href: string): void }
interface HostWindow { ElowenUiRuntime?: unknown; __elowenRegisterPluginUi?: (plugin: string, registration: { requiresApiVersion: number; account?: Record<string, ComponentType<any>>; project?: Record<string, ComponentType<any>> }) => void }

export function runtime(): GitHubRuntime {
  const value = (window as HostWindow).ElowenUiRuntime as GitHubRuntime | undefined;
  if (!value) throw new Error('ElowenUiRuntime is not installed');
  return value;
}
export function registerGitHubUi(account: ComponentType<any>, project: ComponentType<any>): void {
  (window as HostWindow).__elowenRegisterPluginUi?.('github', {
    requiresApiVersion: 6,
    account: { connection: account },
    project: { repository: project },
  });
}
export function jsonBody(value: unknown): RequestInit { return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) }; }
export function localizedError(error: unknown, strings: Record<string, string>): string { const code = runtime().utils.apiErrorMessage(error); return strings[`error_${code}`] || code || strings.errorFallback || 'The GitHub operation failed.'; }
