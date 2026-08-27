import type { ButtonHTMLAttributes, ComponentType, ReactNode } from 'react';

/** Lucide-shaped icon: what every host component means by `icon`. */
type IconComponent = ComponentType<{ size?: number | string; className?: string }>;

export interface MirrorRow {
  id: number;
  workspaceId: string | null;
  workspaceLabel: string | null;
  /** Which folder of the project this mirror covers; empty means the whole project. */
  subpath: string;
  remotePath: string;
  webUrl: string | null;
  enabled: boolean;
  /** 'blocked' is the deletion valve asking a question - a state the panel must offer an answer to,
   *  not an error it reports. Missing it here is why the UI type has to track the API exactly. */
  status: 'idle' | 'syncing' | 'error' | 'paused' | 'blocked';
  error: string | null;
  lastSyncAt: number | null;
  fileCount: number;
  byteCount: number;
  conflictCount: number;
  /** How many deletions the mirror refused and is waiting to be asked about. */
  blockedDeletions: number;
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
  /** The APP's language, which is not the browser's: `toLocaleString()` with no argument formats a
   *  Czech-language page as US English, which is exactly what it did here. */
  useTranslation(): { locale: string };
  useToast(): { toast(message: string, tone?: 'ok' | 'error'): void };
  useQuery<T>(options: Record<string, unknown>): QueryResult<T>;
  useMutation<TData, _TError, TVars>(options: Record<string, unknown>): MutationResult<TVars, TData>;
  useQueryClient(): QueryClient;
}

/** The host publishes its components as `Record<string, ComponentType<never>>`, so nothing on the other
 *  side of this boundary checks how they are called: every prop a plugin invents type-checks and then
 *  does nothing at runtime. These declarations are that missing check, and they are only worth anything
 *  while they match the host - each one mirrors a real signature in `web/components/ui/`. Notably
 *  `WorkspaceDetailRail` has NO `open` prop: it renders whenever it is mounted, so the CALLER decides
 *  whether the drawer exists. Getting that wrong opens every drawer at once. */
interface RuntimeComponents {
  Button: ComponentType<
    { variant?: 'default' | 'accent' | 'ghost' | 'danger' | 'ghost-danger'; icon?: IconComponent }
    & ButtonHTMLAttributes<HTMLButtonElement>
  >;
  Badge: ComponentType<{ children: ReactNode; tone?: 'default' | 'accent' | 'muted' | 'danger' | 'success' | 'warning' }>;
  LoadingState: ComponentType<{ variant?: 'list' | 'cards' | 'kanban' | 'block'; height?: string }>;
  ErrorState: ComponentType<{ message: string; onRetry?: () => void }>;
  EmptyState: ComponentType<{ title: string; description?: string; icon?: IconComponent; action?: ReactNode }>;
  WorkspaceDetailRail: ComponentType<{ label: string; closeLabel: string; onClose(): void; children: ReactNode }>;
  DataTable: ComponentType<{ ariaLabel: string; columns: string; compactColumns?: string; className?: string; children: ReactNode }>;
  DataTableRow: ComponentType<{ children: ReactNode; header?: boolean; selected?: boolean; interactive?: boolean; className?: string }>;
  DataTableCell: ComponentType<{ children: ReactNode; header?: boolean; priority?: 'always' | 'wide'; className?: string }>;
  ConfirmDialog: ComponentType<{
    open: boolean;
    title: string;
    description?: string;
    confirmLabel?: string;
    onConfirm(): void;
    onClose(): void;
  }>;
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
    project?: Record<string, ComponentType<{ project: { id: number; slug: string; path: string } }>>;
  }) => void;
}

export function runtime(): OneDriveRuntime {
  const value = (window as HostWindow).ElowenUiRuntime as OneDriveRuntime | undefined;
  if (!value) throw new Error('ElowenUiRuntime is not installed');
  return value;
}

export function registerOneDriveUi(project: ComponentType<{ project: { id: number; slug: string; path: string } }>): void {
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
