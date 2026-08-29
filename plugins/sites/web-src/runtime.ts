import type { ComponentType, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

export type Visibility = 'private' | 'project' | 'authenticated' | 'public';
export type SiteStatus = 'draft' | 'live' | 'failed';

export interface SiteView {
  id: string;
  slug: string;
  title: string;
  summary: string;
  visibility: Visibility;
  status: SiteStatus;
  url: string;
  basePath: string;
  projectId: number;
  projectSlug: string | null;
  ownerUserId: number;
  owner: Person;
  currentReleaseId: string | null;
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

/** One person as the API hands them over: the account id and the display name, nothing else. Core's
/** A person, in the exact shape the host Avatar takes. Mirrors `Person` in src/api.ts. */
export interface Person {
  id: number;
  username: string;
  name: string;
  /** Stored filename of an uploaded picture, empty when there is none. The Avatar treats it as a
   *  presence flag and fetches a short-lived signed link itself. */
  avatar: string;
}

export interface SiteDetailResponse {
  site: SiteView;
  members: Person[];
  releases: ReleaseView[];
  hits: { day: string; count: number }[];
  sourceDir: string | null;
  runtime: {
    running: boolean;
    startCommand: string | null;
    logTail: string | null;
    lastError: string | null;
  } | null;
}

export interface DirectoryResponse {
  accounts: Person[];
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
  usePersistentState<T extends string>(key: string, initial: T, allowed: readonly T[] | ((raw: string) => boolean)): [T, (value: T) => void];
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
  IconButton: ComponentType<{
    icon: LucideIcon;
    label: string;
    onClick?: () => void;
    variant?: 'default' | 'danger';
    disabled?: boolean;
  }>;
  Input: ComponentType<{
    value: string;
    onChange(event: { target: { value: string } }): void;
    placeholder?: string;
    className?: string;
    disabled?: boolean;
  }>;
  RegisterSearch: ComponentType<{
    value: string;
    onChange(value: string): void;
    placeholder?: string;
    label?: string;
    onClear?: () => void;
    clearLabel?: string;
    count?: number;
    countLabel?: string;
    className?: string;
  }>;
  Badge: ComponentType<{ tone?: 'default' | 'accent' | 'muted' | 'danger' | 'success' | 'warning'; children: ReactNode }>;
  Avatar: ComponentType<{
    name?: string;
    src?: string;
    user?: { id: number; username: string; name?: string; avatar?: string };
    size?: number | 'sm' | 'md' | 'lg';
  }>;
  HelpTip: ComponentType<{ align?: 'left' | 'right'; children: ReactNode }>;
  /** Single-choice dropdown. It has no disabled state on purpose, so a view that may not change the
   *  value has to render the value instead of a control that ignores the click. */
  SelectMenu: ComponentType<{
    value: string;
    onChange(value: string): void;
    options: { value: string; label: string; icon?: ReactNode }[];
    label: string;
    variant?: 'default' | 'line';
    className?: string;
  }>;
  ConfirmDialog: ComponentType<{
    open: boolean;
    title: string;
    description?: string;
    confirmLabel?: string;
    onConfirm(): void;
    onClose(): void;
  }>;
  /** The host's people picker: search, grouped rows and a local selection that is handed over whole on
   *  save. Each row carries an `icon`, which is where the Avatar goes — so a person is a face and a
   *  name here exactly as in the drawer behind it. */
  ManageSelectionModal: ComponentType<{
    open: boolean;
    title: string;
    subtitle?: string;
    onClose(): void;
    items: {
      id: string;
      label: string;
      group: string;
      groupLabel?: string;
      icon?: ReactNode;
      disabled?: boolean;
      disabledHint?: string;
    }[];
    countLabel?(n: number): string;
    selected: Set<string>;
    onSave(next: Set<string>): void | Promise<void>;
    saving?: boolean;
    emptySelectionHint?: string;
  }>;
  WorkspacePage: ComponentType<{ className?: string; children: ReactNode }>;
  PluginPageHeader: ComponentType<{ title: string; description?: string; icon?: LucideIcon; action?: ReactNode }>;
  SpatialWorkspaceLayout: ComponentType<{
    hero: {
      eyebrow?: string;
      title: string;
      count?: number;
      description?: string;
      status?: ReactNode;
      action?: ReactNode;
      mascotState?: 'idle' | 'saving' | 'success' | 'error';
      metrics: ReactNode;
    };
    navigation?: {
      sections: { id: string; label: string; icon: LucideIcon; description?: string; count?: number }[];
      value: string;
      onChange(id: string): void;
      ariaLabel: string;
    };
    className?: string;
    children: ReactNode;
  }>;
  WorkspaceMetric: ComponentType<{ label: string; value: ReactNode; icon?: LucideIcon }>;
  /** The app's one detail drawer. Its width is fixed by the host stylesheet, so every drawer on every
   *  surface is the same size — this bundle must never wrap it in anything that resizes it. */
  WorkspaceDetailRail: ComponentType<{ label: string; closeLabel: string; onClose(): void; children: ReactNode }>;
  ControlSurfaceDocument: ComponentType<{ className?: string; children: ReactNode }>;
  ControlSurfaceToolbar: ComponentType<{ className?: string; children: ReactNode }>;
  ControlSurfaceRegister: ComponentType<{ className?: string; children: ReactNode }>;
  ControlSurfaceState: ComponentType<{ tone?: 'default' | 'danger'; className?: string; children: ReactNode }>;
  DataTable: ComponentType<{ ariaLabel: string; columns: string; compactColumns?: string; className?: string; children: ReactNode }>;
  DataTableRow: ComponentType<{
    header?: boolean;
    selected?: boolean;
    interactive?: boolean;
    className?: string;
    role?: string;
    'aria-selected'?: boolean;
    children: ReactNode;
  }>;
  DataTableCell: ComponentType<{
    header?: boolean;
    priority?: 'always' | 'wide';
    className?: string;
    title?: string;
    role?: string;
    'aria-hidden'?: boolean;
    children: ReactNode;
  }>;
  DetailBlock: ComponentType<{ icon: LucideIcon; title: string; hint?: string; children: ReactNode }>;
  MotionPresence: ComponentType<{ mode?: 'sync' | 'wait' | 'popLayout'; children: ReactNode }>;
  MotionLayoutItem: ComponentType<{ layoutId?: string; role?: string; className?: string; children: ReactNode }>;
  LoadingState: ComponentType<{ variant?: 'list' | 'cards' | 'kanban' | 'block'; height?: string }>;
  LoadingLine: ComponentType<{ label?: string; layout?: 'inline' | 'block' | 'page'; spinner?: boolean }>;
  ErrorState: ComponentType<{ message: string; onRetry?: () => void }>;
  EmptyState: ComponentType<{ title: string; description?: string; icon?: LucideIcon; action?: ReactNode }>;
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

export const SITES_LIST_KEY = ['sites', 'list'];
export const siteDetailKey = (siteId: string): unknown[] => ['sites', 'detail', siteId];

/** The Avatar takes exactly this shape already, so this is an identity — kept as a named function so
 *  every call site goes through one place if the host contract ever widens. */
export const avatarUser = (person: Person): Person => person;

/** Relative time in the shape the register uses: short, and never a bare timestamp nobody reads. */
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
