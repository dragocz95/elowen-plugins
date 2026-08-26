import type { ComponentType } from 'react';

type AnyComponent = ComponentType<any>;

export interface MirrorRow {
  id: number;
  workspaceId: string | null;
  workspaceLabel: string | null;
  remotePath: string;
  webUrl: string | null;
  enabled: boolean;
  status: 'idle' | 'syncing' | 'error' | 'paused';
  error: string | null;
  lastSyncAt: number | null;
  fileCount: number;
  byteCount: number;
  conflictCount: number;
}

export interface WorkspaceRow {
  workspaceId: string;
  label: string;
  connected: boolean;
}

export interface Overview {
  identity: { linked: boolean; upn?: string; displayName?: string };
  rootFolder: string;
  workspaces: WorkspaceRow[];
  links: MirrorRow[];
}

export interface ConflictRow {
  rel: string;
  conflictCopy: string | null;
  updatedAt: number;
}

interface QueryResult<T> { data?: T; isLoading: boolean; isError: boolean; error?: unknown; refetch(): void }
interface MutationResult<TVars, TData = unknown> {
  mutate(vars: TVars, callbacks?: { onSuccess?: (data: TData) => void; onError?: (error: unknown) => void }): void;
  mutateAsync(vars: TVars): Promise<TData>;
  isPending: boolean;
}
interface QueryClient { invalidateQueries(input: { queryKey: unknown[] }): Promise<void> }

interface RuntimeHooks {
  usePluginStrings(plugin: string): Record<string, string>;
  useToast(): { toast(message: string, tone?: 'ok' | 'error'): void };
  useQuery<T>(options: Record<string, unknown>): QueryResult<T>;
  useMutation<TData, _TError, TVars>(options: Record<string, unknown>): MutationResult<TVars, TData>;
  useQueryClient(): QueryClient;
}

interface RuntimeComponents {
  Button: AnyComponent; Badge: AnyComponent; Toggle: AnyComponent;
  LoadingState: AnyComponent; ErrorState: AnyComponent; EmptyState: AnyComponent;
  PluginSection: AnyComponent; WorkspaceMetric: AnyComponent; WorkspaceDetailRail: AnyComponent;
  DataTable: AnyComponent; DataTableRow: AnyComponent; DataTableCell: AnyComponent;
  ConfirmDialog: AnyComponent; SettingsRow: AnyComponent;
}

interface OneDriveRuntime {
  components: RuntimeComponents;
  hooks: RuntimeHooks;
  utils: { apiErrorMessage(error: unknown): string };
  api(path: string, init?: RequestInit): Promise<unknown>;
}

interface HostWindow {
  ElowenUiRuntime?: unknown;
  __elowenRegisterPluginUi?: (plugin: string, registration: {
    requiresApiVersion: number;
    project?: Record<string, ComponentType<any>>;
  }) => void;
}

export function runtime(): OneDriveRuntime {
  const value = (window as HostWindow).ElowenUiRuntime as OneDriveRuntime | undefined;
  if (!value) throw new Error('ElowenUiRuntime is not installed');
  return value;
}

export function registerOneDriveUi(project: ComponentType<any>): void {
  (window as HostWindow).__elowenRegisterPluginUi?.('onedrive', {
    requiresApiVersion: 6,
    project: { mirror: project },
  });
}

export function jsonBody(value: unknown): RequestInit {
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) };
}

/** Bytes as something a person reads. Deliberately coarse: the exact byte count of a mirror is noise. */
export function humanBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'kB', 'MB', 'GB', 'TB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}
