import type { ComponentType, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

export type Visibility = 'private' | 'project' | 'authenticated' | 'public';

export interface SiteView {
  id: string;
  slug: string;
  title: string;
  summary: string;
  visibility: Visibility;
  status: 'draft' | 'live' | 'failed';
  url: string;
  basePath: string;
  projectId: number;
  projectSlug: string | null;
  ownerUserId: number;
  ownerName: string;
  createdAt: string;
  createdModel: string;
  lastPublishAt: string | null;
  lastPublishModel: string | null;
  spa: boolean;
  canManage: boolean;
}

export interface SitesListResponse {
  mine: SiteView[];
  shared: SiteView[];
  allowPublicSites: boolean;
  dedicatedHost: boolean;
}

interface ReleaseView {
  id: string;
  siteId: string;
  createdAt: string;
  model: string;
  fileCount: number;
  sizeBytes: number;
  note: string;
}

export interface SiteDetailResponse {
  site: SiteView;
  members: { id: number; name: string }[];
  releases: ReleaseView[];
  hits: { day: string; count: number }[];
  sourceDir: string | null;
}

export interface DirectoryResponse {
  accounts: { id: number; name: string }[];
}

export interface TicketResponse {
  token: string;
  action: string;
  title: string;
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
  useMe(): QueryResult<{ user?: { id: number; username: string; is_admin: boolean } }>;
  useQuery<T>(options: Record<string, unknown>): QueryResult<T>;
  useMutation<TData, _TError, TVars>(options: Record<string, unknown>): MutationResult<TVars, TData>;
  useQueryClient(): QueryClient;
}

/** Only the host components this bundle actually mounts, typed with the props the host really accepts.
 *  Declaring them as "any component" is how a bundle ships a prop the host never had and silently does
 *  nothing; the repository's web typecheck can only catch that if the shapes are stated here. */
interface RuntimeComponents {
  Button: ComponentType<{
    variant?: 'default' | 'accent' | 'ghost' | 'danger' | 'ghost-danger';
    icon?: LucideIcon;
    className?: string;
    onClick?: () => void;
    disabled?: boolean;
    type?: 'button' | 'submit';
    title?: string;
    children?: ReactNode;
  }>;
  Input: ComponentType<{
    value: string;
    onChange(event: { target: { value: string } }): void;
    placeholder?: string;
    className?: string;
    disabled?: boolean;
  }>;
  Badge: ComponentType<{ tone?: 'default' | 'accent' | 'muted' | 'danger' | 'success' | 'warning'; children: ReactNode }>;
  Avatar: ComponentType<{
    name?: string;
    src?: string;
    user?: { id: number; username: string; name?: string; avatar?: string };
    size?: number | 'sm' | 'md' | 'lg';
  }>;
  Segmented: ComponentType<{
    options: { value: string; label: string; disabled?: boolean }[];
    value: string;
    onChange(value: string): void;
    size?: 'sm' | 'md';
    variant?: 'default' | 'line';
    className?: string;
    nowrap?: boolean;
  }>;
  Modal: ComponentType<{
    title: string;
    onClose(): void;
    size?: 'sm' | 'md' | 'lg';
    icon?: LucideIcon;
    description?: string;
    headerActions?: ReactNode;
    children: ReactNode;
  }>;
  ModalBody: ComponentType<{ gap?: 4 | 5 | 6; children: ReactNode }>;
  ConfirmDialog: ComponentType<{
    open: boolean;
    title: string;
    description?: ReactNode;
    confirmLabel?: string;
    onConfirm(): void;
    onClose(): void;
  }>;
  WorkspacePage: ComponentType<{ className?: string; children: ReactNode }>;
  PluginPageHeader: ComponentType<{ title: string; description?: string; icon?: LucideIcon; action?: ReactNode }>;
  EntityList: ComponentType<{ className?: string; children: ReactNode }>;
  EntityRow: ComponentType<{
    selected?: boolean;
    busy?: boolean;
    interactive?: boolean;
    className?: string;
    onClick?: () => void;
    children: ReactNode;
  }>;
  LoadingState: ComponentType<{ label?: string }>;
  ErrorState: ComponentType<{ title?: string; description?: string }>;
  EmptyState: ComponentType<{ title: string; description?: string; icon?: LucideIcon; action?: ReactNode }>;
  HelpTip: ComponentType<{ text: string }>;
}

interface SitesRuntime {
  components: RuntimeComponents;
  hooks: RuntimeHooks;
  utils: { apiErrorMessage(error: unknown): string; copyText(value: string): void };
  api(path: string, init?: RequestInit): Promise<unknown>;
  navigate(href: string): void;
}

interface HostWindow {
  ElowenUiRuntime?: unknown;
  __elowenRegisterPluginUi?: (plugin: string, registration: {
    requiresApiVersion: number;
    pages?: Record<string, ComponentType<never>>;
    project?: Record<string, ComponentType<never>>;
  }) => void;
}

export function runtime(): SitesRuntime {
  const value = (window as HostWindow).ElowenUiRuntime as SitesRuntime | undefined;
  if (!value) throw new Error('ElowenUiRuntime is not installed');
  return value;
}

export function registerSitesUi(
  pages: Record<string, ComponentType<never>>,
  project: Record<string, ComponentType<never>>,
): void {
  (window as HostWindow).__elowenRegisterPluginUi?.('sites', {
    requiresApiVersion: 7,
    pages,
    project,
  });
}

export const jsonBody = (method: string, value: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(value),
});

/** Relative time in the shape the cards use: short, and never a bare timestamp nobody reads. */
export function relativeTime(iso: string | null): string {
  if (!iso) return '';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 90) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 31) return `${days} d ago`;
  return new Date(then).toISOString().slice(0, 10);
}

export const formatBytes = (bytes: number): string =>
  bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} kB`;
