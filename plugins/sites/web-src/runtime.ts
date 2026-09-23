import type { ComponentType, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { PluginPageProps, AssertPublished } from 'elowen-plugin-ui-kit';

export type Visibility = 'private' | 'project' | 'authenticated' | 'public';
export type SiteStatus = 'draft' | 'live' | 'failed';
/** How a publication reaches a visitor: its own copied release files, or a forwarder inside the managed
 *  Project's environment. A proxy publication has no release and no container of its own, which is why
 *  the drawer renders it from a different set of facts than a static one. */
export type PublicationKind = 'static' | 'proxy';

/** Whether a stored picture of the page exists, and whether it is still worth showing as current.
 *
 *  A picture past its age is not one of these states: opening the register takes it again, so the only
 *  thing to say about it would be work already under way. `failed` keeps the picture: what is out of date
 *  is the information about the page, not the picture of it. A register that dropped to a monogram every
 *  time a capture failed would be a register that flickers, and the monogram is reserved for having no
 *  picture at all. */
type SiteDomainStatus =
  | 'awaiting_ownership' | 'awaiting_routing' | 'misdirected' | 'issuing' | 'ready'
  | 'authority_refused' | 'renewal_blocked' | 'expired' | 'removing';

export interface SiteDomainRecordView {
  type: 'TXT' | 'A' | 'AAAA' | 'CNAME' | 'ALIAS/ANAME';
  name: string;
  value: string;
}

interface SiteDomainStepView {
  state: string;
  code: string;
  params: Record<string, string>;
}

export interface SiteDomainView {
  id: string;
  hostname: string;
  displayHostname: string;
  url: string;
  kind: 'root' | 'subdomain';
  delegatedRootWarning: boolean;
  status: SiteDomainStatus;
  statusCode: string;
  statusParams: Record<string, string>;
  isPrimary: boolean;
  canOpen: boolean;
  removalState: 'active' | 'removing';
  ownership: SiteDomainStepView & {
    record: SiteDomainRecordView;
    checkedAt: string | null;
    expiresAt: string | null;
  };
  routing: SiteDomainStepView & {
    hint: 'routingHintRoot' | 'routingHintSubdomain';
    recommended: SiteDomainRecordView[];
    alternatives: SiteDomainRecordView[];
    observed: string[];
    checkedAt: string | null;
    nextCheckAt: string | null;
    planState: 'ready' | 'unavailable';
  };
  certificate: SiteDomainStepView & {
    requestedAt: string | null;
    retryAt: string | null;
    notAfter: string | null;
  };
}

export interface SiteDomainsResponse {
  siteId: string;
  effectiveUrl: string | null;
  generated: {
    id: string;
    hostname: string;
    displayHostname: string;
    url: string;
    effective: boolean;
  } | null;
  primaryHostnameId: string | null;
  domains: SiteDomainView[];
}

interface PreviewView {
  state: 'none' | 'pending' | 'ready' | 'failed';
  /** Cache key of the stored picture; 0 when there is none. */
  version: number;
  capturedAt: string | null;
  width: number | null;
  height: number | null;
}

export interface SiteView {
  id: string;
  slug: string;
  title: string;
  summary: string;
  visibility: Visibility;
  status: SiteStatus;
  /** The address stays published, but its current proxy application or transport is unhealthy. */
  degraded: boolean;
  /** Null when the gateway is not provisioned: the site has no address to open. */
  url: string | null;
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
  /** Which of the two publication shapes this row is. */
  kind: PublicationKind;
  /** The forwarder port inside the Project environment for a proxy row ('3000'), empty for a static one:
   *  a static publication is served from its own files, so it has no target to reach. */
  target: string;
  /** The picture of the published page, as far as it is known without fetching it. */
  preview: PreviewView;
  canManage: boolean;
}

export interface SitesListResponse {
  mine: SiteView[];
  shared: SiteView[];
  allowPublicSites: boolean;
}

interface ReleaseView {
  id: string;
  siteId: string;
  createdAt: string;
  model: string;
  fileCount: number;
  sizeBytes: number;
  note: string;
  kind: 'files';
}


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
  /** The stored failure behind a degraded or failed publication, disclosed only to a manager. */
  lastError: string | null;
  /** Why there is no picture of the page, or why the last one could not be taken: a manager's detail. */
  previewNotice: string | null;
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
interface QueryClient {
  invalidateQueries(input: { queryKey: unknown[] }): Promise<void>;
  setQueryData<T>(queryKey: unknown[], updater: (previous?: T) => T | undefined): void;
}

type PageFilterField =
  | { id: string; label: string; control: ReactNode; hint?: string; active: false }
  | { id: string; label: string; control: ReactNode; hint?: string; active: true; activeLabel: string; onReset(): void };

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
    type?: 'text' | 'password' | 'email' | 'search' | 'number';
    autoComplete?: string;
    'aria-label'?: string;
  }>;
  Toggle: ComponentType<{
    checked: boolean;
    onChange(checked: boolean): void;
    label?: string;
    disabled?: boolean;
  }>;
  RegisterSearch: ComponentType<{
    value: string;
    onChange(value: string): void;
    placeholder?: string;
    label?: string;
    onClear?(): void;
    clearLabel?: string;
    count?: number;
    countLabel?: string;
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
  Modal: ComponentType<{
    title: string;
    onClose(): void;
    children: ReactNode;
    size?: 'lg' | 'xl' | 'md' | 'sm' | 'page';
    icon?: LucideIcon;
    description?: string;
    presentation?: 'auto' | 'center' | 'drawer' | 'sheet' | 'fullscreen';
    closeLabel?: string;
    closeDisabled?: boolean;
    'aria-busy'?: true;
    'data-testid'?: string;
  }>;
  ModalBody: ComponentType<{ children: ReactNode; gap?: 4 | 5 | 6 }>;
  ModalFooter: ComponentType<{ children?: ReactNode; status?: ReactNode }>;
  ConfirmDialog: ComponentType<{
    open: boolean;
    title: string;
    description?: string;
    confirmLabel?: string;
    confirmVariant?: 'default' | 'accent' | 'ghost' | 'danger' | 'ghost-danger' | 'outline' | 'outline-danger';
    pending?: boolean;
    onConfirm(): unknown;
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
  SettingsDocument: ComponentType<{ children: ReactNode; className?: string }>;
  SettingsGroup: ComponentType<{
    title?: string;
    description?: string;
    icon?: LucideIcon;
    actions?: ReactNode;
    tone?: 'default' | 'danger';
    density?: 'comfortable' | 'compact';
    columns?: 1 | 2;
    children?: ReactNode;
    className?: string;
  }>;
  SettingsRow: ComponentType<{
    label: string;
    description?: string;
    hint?: string;
    iconNode?: ReactNode;
    control?: ReactNode;
    status?: ReactNode;
    actions?: ReactNode;
    trailingLayout?: 'inline' | 'stack';
    children?: ReactNode;
    className?: string;
  }>;
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
    toolbar?: { search?: ReactNode; filters?: PageFilterField[]; actions?: ReactNode; children?: ReactNode };
    className?: string;
    children: ReactNode;
  }>;
  WorkspaceMetric: ComponentType<{ label: string; value: ReactNode; icon?: LucideIcon }>;
  /** The app's one detail drawer. Its width is fixed by the host stylesheet, so every drawer on every
   *  surface is the same size — this bundle must never wrap it in anything that resizes it. */
  WorkspaceDetailRail: ComponentType<{ label: string; closeLabel: string; onClose(): void; children: ReactNode }>;
  ControlSurfaceDocument: ComponentType<{ className?: string; children: ReactNode }>;
  ControlSurfaceToolbar: ComponentType<{
    className?: string;
    search?: ReactNode;
    filters?: PageFilterField[];
    actions?: ReactNode;
    children?: ReactNode;
  }>;
  ControlSurfaceRegister: ComponentType<{ className?: string; children: ReactNode }>;
  ControlSurfaceState: ComponentType<{ tone?: 'default' | 'danger'; className?: string; children: ReactNode }>;
  DetailBlock: ComponentType<{ icon: LucideIcon; title: string; hint?: string; children: ReactNode }>;
  MotionPresence: ComponentType<{ mode?: 'sync' | 'wait' | 'popLayout'; children: ReactNode }>;
  MotionLayoutItem: ComponentType<{ layoutId?: string; role?: string; className?: string; children: ReactNode }>;
  LoadingState: ComponentType<{ variant?: 'list' | 'cards' | 'block'; height?: string }>;
  LoadingLine: ComponentType<{ label?: string; layout?: 'inline' | 'block' | 'page' }>;
  ErrorState: ComponentType<{ message: string; onRetry?: () => void }>;
  EmptyState: ComponentType<{ title: string; description?: string; icon?: LucideIcon; action?: ReactNode }>;
}
/** Every key of the interface above has to be a component the host really publishes. The runtime
 *  hands over an object, not a type, so a name invented here compiles and then reaches React as
 *  `undefined` at render time; `AssertPublished` turns that into an error in this repository. */
type PublishedNames = AssertPublished<keyof RuntimeComponents>;

interface SitesRuntime {
  components: Pick<RuntimeComponents, PublishedNames>;
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
    settings?: Record<string, ComponentType<PluginPageProps>>;
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
  settings: Record<string, ComponentType<PluginPageProps>>,
): void {
  (window as HostWindow).__elowenRegisterPluginUi?.('sites', {
    requiresApiVersion: 12,
    pages,
    project,
    settings,
  });
}

export const jsonBody = (method: string, value: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(value),
});

export const SITES_LIST_KEY = ['sites', 'list'];
export const siteDetailKey = (siteId: string): unknown[] => ['sites', 'detail', siteId];
export const siteDomainsKey = (siteId: string): unknown[] => ['sites', 'domains', siteId];

/** The Avatar takes exactly this shape already, so this is an identity — kept as a named function so
 *  every call site goes through one place if the host contract ever widens. */
export const avatarUser = (person: Person): Person => person;

/** Where a Site's stored picture is fetched from.
 *
 *  The version is part of the address on purpose: the endpoint may then be cached for as long as a browser
 *  likes, because a new picture always arrives under a new version and no card ever has to be revalidated.
 *  The path is the app's own same-origin prefix, which is what a plain `<img>` can reach with the session
 *  the browser already holds. */
export const previewImageUrl = (siteId: string, version: number): string =>
  `/api/plugins/sites/api/site/${encodeURIComponent(siteId)}/preview?v=${version}`;

/** How long a register waits before looking again while a picture is being taken. Long enough that a
 *  capture has a chance to land, short enough that nobody watches a monogram for no reason. */
export const PREVIEW_POLL_MS = 4000;

/** Whether anything on this register is waiting for a picture, which is the only reason to look again
 *  without being asked. A register nothing is happening in polls nothing. */
export const awaitingPreview = (sites: readonly SiteView[]): boolean =>
  sites.some((site) => site.preview.state === 'pending');

/** How long the setup dialog waits before checking a custom domain again. Short enough that a record
 *  created a moment ago is picked up while its owner is still looking at the screen, and it has to be
 *  the dialog that asks: the instance's own schedule backs off to hours after a few failed lookups,
 *  which is right for a domain nobody is watching and far too slow for one somebody is. */
export const DOMAIN_CHECK_POLL_MS = 20_000;

/** Whether a custom domain is still on its way to being served, which is the only reason to keep asking
 *  about it. A ready domain has nothing left to reach, and one being removed is on its way out. */
export const awaitingDomain = (domain: SiteDomainView): boolean =>
  domain.status !== 'ready' && domain.removalState === 'active';

/** Relative time localized by the document language the host already selected. */
export function relativeTime(iso: string | null): string {
  if (!iso) return '';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const locale = document.documentElement.lang || navigator.language || 'en';
  const deltaSeconds = Math.round((then - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });
  const absoluteSeconds = Math.abs(deltaSeconds);
  if (absoluteSeconds < 90) return formatter.format(0, 'second');
  const minutes = Math.round(deltaSeconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute');
  const hours = Math.round(deltaSeconds / 3600);
  if (Math.abs(hours) < 36) return formatter.format(hours, 'hour');
  const days = Math.round(deltaSeconds / 86400);
  if (Math.abs(days) < 31) return formatter.format(days, 'day');
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(then));
}

export const formatBytes = (bytes: number): string =>
  bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} kB`;
