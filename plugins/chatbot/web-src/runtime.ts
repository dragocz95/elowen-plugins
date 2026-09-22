import type { ComponentProps, ComponentType, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { AssertPublished } from 'elowen-plugin-ui-kit';

/** The host runtime, narrowed to what this bundle mounts. React itself, the HTTP helper and every UI
 *  component come from `window.ElowenUiRuntime` at run time: the bundle imports no UI package and never
 *  reaches into the host application, so `react` here is a TYPE only. */

/** One row of the instance's origin-attributed spend, as the host's admin usage route answers it. This is
 *  core's `usage_by_origin` rollup, the ONLY source of origin-attributed spend in this codebase: the
 *  chatbot page reads the chatbot ACCOUNT's own row for a window and never counts tokens or cost by
 *  scanning messages. `cost` null means no turn in the bucket reported a price — "unknown", never zero.
 *  Private to this file: it is the shape of one row of {@link UsageByOriginAnswer}. */
interface UsageOriginRow {
  userId: number | null;
  username: string | null;
  origin: string | null;
  originKind: 'ip' | 'local' | 'internal' | 'platform' | 'redacted' | null;
  trusted: boolean;
  origins: number;
  turns: number;
  tokens: number;
  cost: number | null;
  costedTurns: number;
  firstAt: number;
  lastAt: number;
}

/** `GET /usage/by-origin`. `trackingSince` is the first day the rollup holds: everything spent before it
 *  has no recorded origin and never will, so a view that starts at deployment must say so. Private to this
 *  file: it is the return shape this runtime declares for `useUsageByOrigin`. */
interface UsageByOriginAnswer {
  rows: UsageOriginRow[];
  group: 'user' | 'origin' | 'pair';
  trackingSince: string | null;
}

/** One tool of an account, as the host's own users panel derives it: what the account can actually reach
 *  right now, which plugin owns it, and whether an administrator may change it at all. */
export interface AccountToolRow {
  name: string;
  label: string;
  icon: string | null;
  plugin: string | null;
  group: string;
  state: 'allowed' | 'inherited' | 'unavailable' | 'disabled';
  toggleable: boolean;
}

/** The core translation catalog, narrowed the way every bundle that mounts a host affordance narrows it.
 *  Only host-generic sections are read here: `managePicker.manage` is the word on the button that opens a
 *  managed selection, and it belongs to the host that draws that button rather than to this plugin's copy. */
type HostDictionary = Record<string, Record<string, string>>;

/** One field of a plugin's own instance configuration, as the manifest declares it and the host's
 *  config form renders it. Only the shape this bundle passes through is named here: the form reads the
 *  whole record itself. */
export interface PluginConfigField {
  key: string;
  label: string;
  type: string;
  hint?: string;
  required?: boolean;
  min?: number;
  max?: number;
  step?: number;
  default?: unknown;
  options?: { value: string; label: string }[];
  risk?: 'low' | 'medium' | 'high';
}

/** The host's own plugin detail, narrowed to what the config form reads. `i18n` carries the manifest's
 *  own translations (`i18n/<lang>.json` `fields`), which is where this plugin's config labels are
 *  localized: they are NOT page copy and must not be restated as bundle strings. */
interface PluginDetail {
  name: string;
  config: Record<string, unknown>;
  configSchema: PluginConfigField[];
  secretsSet: string[];
  revision?: number;
  i18n?: Record<string, { fields?: Record<string, { label?: string; hint?: string; options?: Record<string, string> }> }>;
}

/** The draft the host's config form writes through: it owns the debounce, the save and the status, so
 *  this bundle never writes plugin config itself. */
interface PluginConfigDraft {
  values: Record<string, unknown>;
  setValue(key: string, value: unknown): void;
  status: unknown;
  retry?: () => void;
  ready: boolean;
}

interface QueryResult<T> {
  data?: T;
  isLoading: boolean;
  isError: boolean;
  refetch(): unknown;
}

interface ChatbotHooks {
  /** This plugin's own page copy: its manifest's English fallback, with the active locale's overrides. */
  usePluginStrings(plugin: string): Record<string, string>;
  /** This plugin's own instance configuration, read through the host's admin route. The shared-settings
   *  section edits exactly this and nothing else: a second editor for the same record is a second thing
   *  that can disagree with it. */
  usePluginDetail(plugin: string): QueryResult<PluginDetail>;
  usePluginConfigDraft(plugin: string, detail: Pick<PluginDetail, 'config' | 'configSchema'>): PluginConfigDraft;
  /** The app's own locale and dictionary. `locale` is what formats every number, price and timestamp on
   *  this surface in the reader's own locale; `t` supplies the host's words for the host's own controls. */
  useTranslation(): { locale: string; t: HostDictionary };
  useToast(): { toast(message: string, tone?: 'ok' | 'error'): void };
  /** The host's react-query, reached through the runtime so this bundle shares the HOST's one client and
   *  its cache. That is what lets four independently mounted sections read ONE register: a bundle that
   *  imported the library itself would get a second client over an empty cache, and each section would
   *  fetch and hold an answer of its own. */
  useQuery<T>(options: {
    queryKey: readonly unknown[];
    queryFn(): Promise<T>;
  }): { data?: T; isLoading: boolean; isError: boolean; error: unknown; refetch(): unknown };
  useQueryClient(): {
    setQueryData<T>(queryKey: readonly unknown[], updater: (current: T | undefined) => T | undefined): void;
  };
  /** ADMIN-ONLY on the server: a non-admin caller is refused by design. `enabled` only keeps a request
   *  that is meant to fail from being fired; it is not the access control. */
  useUsageByOrigin(
    group?: 'user' | 'origin' | 'pair',
    window?: { fromMs: number; toMs: number },
    opts?: { enabled?: boolean; limit?: number },
  ): { data?: UsageByOriginAnswer; isLoading: boolean; isError: boolean };
}

type AnyComponent = ComponentType<any>;

/** Every component this bundle mounts, with the props it actually passes. The names are checked against
 *  the host's published set below, so a rename in core fails THIS build instead of reaching React as
 *  `undefined` on somebody's screen. */
interface ChatbotComponents {
  Badge: ComponentType<{ tone?: 'default' | 'accent' | 'muted' | 'danger' | 'success' | 'warning'; children?: ReactNode }>;
  Button: ComponentType<{
    variant?: 'default' | 'accent' | 'ghost' | 'danger' | 'ghost-danger' | 'outline' | 'outline-danger';
    size?: string;
    icon?: LucideIcon;
    disabled?: boolean;
    className?: string;
    children?: ReactNode;
  } & Omit<ComponentProps<'button'>, 'children'>>;
  ConfirmDialog: AnyComponent;
  /** The register table. `columns` IS the template, so the row cells and the header row share one
   *  definition of the grid instead of each stating it. */
  DataTable: ComponentType<{ ariaLabel: string; columns: string; compactColumns?: string; mobileColumns?: string; children?: ReactNode; className?: string }>;
  DataTableCell: ComponentType<{ children?: ReactNode; header?: boolean; priority?: 'always' | 'mobile' | 'wide'; lines?: 1 | 'auto'; labelHidden?: boolean; title?: string; className?: string }>;
  DataTableChevronCell: ComponentType<{ className?: string }>;
  DataTableRow: ComponentType<{
    children?: ReactNode;
    header?: boolean;
    selected?: boolean;
    interactive?: boolean;
    height?: 'standard' | 'tall';
    onOpen?: () => void;
    openLabel?: string;
    className?: string;
  }>;
  EmptyState: ComponentType<{ title: string; description?: string; icon?: LucideIcon; action?: ReactNode }>;
  ErrorState: ComponentType<{ message: string; onRetry?: () => void }>;
  Field: ComponentType<{ label: string; htmlFor?: string; hint?: string; description?: string; error?: string; required?: boolean; children?: ReactNode }>;
  /** Long-form guidance for one heading, kept behind the host's own help affordance. */
  HelpTip: ComponentType<{ align?: 'left' | 'right'; children?: ReactNode }>;
  /** The host's icon-only action: one glyph carrying its own accessible name. What a list row's remove
   *  affordance is everywhere else in the app. */
  IconButton: ComponentType<{
    icon: LucideIcon;
    label: string;
    variant?: 'default' | 'danger';
    disabled?: boolean;
    onClick?: () => void;
  }>;
  Input: ComponentType<ComponentProps<'input'>>;
  LoadingLine: ComponentType<{ label?: string; layout?: 'inline' | 'block' | 'page'; spinner?: boolean }>;
  LoadingState: ComponentType<{ variant?: 'list' | 'cards' | 'kanban' | 'block'; height?: string }>;
  Modal: ComponentType<{
    title: string;
    onClose: () => void;
    children?: ReactNode;
    /** The room a centered window takes. `lg` is the app's data window — the widest one there is — and the
     *  one the appearance editor needs: the controls and the live preview have to be visible at once. */
    size?: 'default' | 'lg' | 'xl' | 'md' | 'sm';
    /** `center` is what makes this a window rather than the right-hand drawer the host opens by default for
     *  the first click out of a page. */
    presentation?: 'auto' | 'center' | 'drawer' | 'sheet' | 'fullscreen';
    intent?: 'edit' | 'inspect';
    description?: string;
    icon?: LucideIcon;
    'aria-busy'?: true;
    closeLabel?: string;
    closeDisabled?: boolean;
  }>;
  ModalBody: ComponentType<{ children?: ReactNode; className?: string }>;
  ModalFooter: ComponentType<{ children?: ReactNode; className?: string }>;
  /** The one pager of the app: it derives the page count and the range text itself, so this bundle ships
   *  none of that copy. */
  Pager: ComponentType<{
    /** Zero-based. */
    page: number;
    pageSize: number;
    total: number;
    onPageChange(page: number): void;
    onPageSizeChange?(pageSize: number): void;
    pageSizeOptions?: readonly number[];
    ariaLabel?: string;
    className?: string;
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
    className?: string;
  }>;
  /** The page name, for the app masthead and the browser tab. It draws nothing of its own. */
  ModuleHeader: ComponentType<{ title: string; icon?: LucideIcon; children?: ReactNode }>;
  /** The canonical page shell. `deck` is the variant for a page whose sections are ADDRESSES read one at
   *  a time, which is exactly what this page is.
   *
   *  `navigation` is the prop that will draw those sections as the secondary column beside the content and
   *  as the phone's one scrollable line. It is declared here in the shape the host is being changed to
   *  accept, and `SectionDeck.tsx` is the one place that mounts it — see that file for what this bundle
   *  draws in the meantime. */
  WorkspaceShell: ComponentType<{
    variant?: 'register' | 'deck' | 'single';
    hero?: {
      eyebrow?: string;
      title: string;
      description?: string;
      icon?: LucideIcon;
      action?: ReactNode;
      mascot?: boolean | 'idle' | 'error';
    };
    navigation?: {
      sections: { id: string; label: string; icon: LucideIcon; description?: string; count?: number }[];
      value: string;
      onChange(id: string): void;
      ariaLabel: string;
    };
    embedded?: boolean;
    children?: ReactNode;
    className?: string;
  }>;
  /** The document surface a set of settings cards sits on. */
  SettingsDocument: ComponentType<{ children?: ReactNode; className?: string }>;
  /** The host's own editor for a plugin's instance configuration: one row per manifest field, a slider
   *  beside the box for every bounded number, and the host's debounce and save behind it. The shared
   *  settings of this plugin ARE that record, so they are edited by this and never by a second form. */
  PluginConfigEditor: ComponentType<{
    name: string;
    detail: Pick<PluginDetail, 'name' | 'configSchema' | 'secretsSet'>;
    draft: PluginConfigDraft;
    mode?: 'setup' | 'behavior' | 'advanced' | 'all';
    fieldLabel(field: PluginConfigField): string;
    fieldHint(field: PluginConfigField): string | undefined;
    fieldOptions(field: PluginConfigField): { value: string; label: string }[];
    riskText(risk: 'low' | 'medium' | 'high'): string;
  }>;
  /** The master/detail rail: a surface opened to READ one record. One conversation's transcript is
   *  exactly that, so it is not a second window built out of raw markup. */
  WorkspaceDetailRail: ComponentType<{
    label: string;
    description?: string;
    closeLabel: string;
    onClose(): void;
    scrim?: 'default' | 'soft';
    children?: ReactNode;
  }>;
  /** The compact stand-in for a long list: a count line, a few sample chips and one button that opens the
   *  list. It is how the app states a managed selection everywhere — the account tool set on the Users
   *  screen, a job's destination in cronjob — so the lists here are this row plus one window. */
  SelectionSummary: ComponentType<{
    countText: string;
    samples: { id?: string; label: string; icon?: ReactNode }[];
    moreCount: number;
    onManage: () => void;
    manageLabel: string;
    manageAriaLabel?: string;
    variant?: 'default' | 'line';
  }>;
  /** A records card: an accent-marked heading above a body of rows. The admin sections below are exactly
   *  that shape, which is why they are not rebuilt out of raw markup. */
  SettingsGroup: ComponentType<{
    title?: string;
    description?: string;
    icon?: LucideIcon;
    actions?: ReactNode;
    tone?: 'default' | 'danger';
    density?: 'comfortable' | 'compact';
    columns?: 1 | 2;
    /** Fold the body under the header. `storageKey` is the host's ONE mechanism for remembering that
     *  choice, so this bundle keeps no fold state of its own. */
    collapsible?: boolean;
    defaultOpen?: boolean;
    storageKey?: string;
    children?: ReactNode;
    className?: string;
  }>;
  SettingsRow: ComponentType<{
    label: string;
    description?: string;
    hint?: string;
    icon?: LucideIcon;
    control?: ReactNode;
    status?: ReactNode;
    actions?: ReactNode;
    trailingLayout?: 'inline' | 'stack';
    children?: ReactNode;
    className?: string;
  }>;
  SelectMenu: ComponentType<{
    value: string;
    onChange(value: string): void;
    options: { value: string; label: string; icon?: ReactNode }[];
    label: string;
    variant?: 'default' | 'line';
    disabled?: boolean;
    className?: string;
  }>;
  /** The host's real chart: ticks, cursor tooltip and one axis per unit. Recharts lives in the app and
   *  loads lazily there, so this bundle never carries a charting library. */
  TimeSeriesChart: ComponentType<{
    data: { label: string; [key: string]: string | number | null }[];
    series: { key: string; label: string; colour: string; variant?: 'bar' | 'line'; axis?: 'left' | 'right'; format: (value: number) => string }[];
    height?: number;
    emptyText?: string;
    ariaLabel?: string;
  }>;
  Toggle: ComponentType<{ checked: boolean; onChange(checked: boolean): void; label?: string; disabled?: boolean }>;
  /** The host's scalar slider. Every bounded number on this surface is set with one — the panel's size and
   *  its corner radius, and every rate and ceiling a chatbot serves under — because a number typed into a
   *  box says nothing about where it sits between its two bounds. */
  Slider: ComponentType<{
    value: number;
    onChange(value: number): void;
    min?: number;
    max?: number;
    step?: number;
    disabled?: boolean;
    'aria-label'?: string;
    'aria-valuetext'?: string;
    className?: string;
  }>;
  /** The host's small-set switch: light or dark, and the statistics window. A dropdown for two or three
   *  choices makes the reader open a list to discover what the other choices are. */
  Segmented: ComponentType<{
    options: { value: string; label: string }[];
    value: string;
    onChange(value: string): void;
    size?: 'sm' | 'md';
    className?: string;
    'aria-label'?: string;
  }>;
}

/** `AssertPublished` fails THIS build when a key above is not a component the host publishes. */
type PublishedNames = AssertPublished<keyof ChatbotComponents>;

export interface ChatbotRuntime {
  components: Pick<ChatbotComponents, PublishedNames>;
  hooks: ChatbotHooks;
  utils: { apiErrorMessage(error: unknown): string };
  api(path: string, init?: RequestInit): Promise<unknown>;
  navigate(href: string): void;
}

/** One settings section of this plugin, with the props the host mounts it with. Reached inside
 *  Settings → Plugins → Chatbots, so `surface` is `deck` and the panel around it is the host's. */
export type ChatbotSettingsSection = ComponentType<{
  plugin: string;
  params: Record<string, string>;
  rest: string[];
  surface: 'page' | 'deck';
}>;

/** The two globals a plugin bundle meets the host through. Declared here rather than taken from the kit's
 *  `declare global`, because this bundle states its OWN registration shape (its settings sections plus the
 *  API version it targets) and the compiler is what checks that the two agree. */
interface HostWindow {
  ElowenUiRuntime?: unknown;
  __elowenRegisterPluginUi?(plugin: string, registration: {
    requiresApiVersion: number;
    settings: Record<string, ChatbotSettingsSection>;
  }): void;
}

export function runtime(): ChatbotRuntime {
  const value = (window as HostWindow).ElowenUiRuntime as ChatbotRuntime | undefined;
  if (!value) throw new Error('ElowenUiRuntime is not installed');
  return value;
}

/** The chatbot admin surface is FOUR settings sections and no page at all.
 *
 *  Every section is declared in the manifest with `placement: "pluginDetail"`, so the host offers them
 *  inside Settings → Plugins → Chatbots and draws the section navigation, the panel and the settings
 *  document around each one. The ids here must be the manifest's ids: the host looks a section's
 *  component up by the id the listing advertised, and an id that matches nothing renders the
 *  "section unavailable" notice instead.
 *
 *  `ownsPageFrame` is deliberately absent. It names sections that draw their OWN page frame, and these
 *  draw none: the frame is the host's, which is what makes them read as Settings.
 *
 *  The version must equal the manifest's `web.requiresApiVersion`; the host gates the load on the
 *  manifest's copy and the mount on this one. */
export function registerChatbotUi(settings: Record<string, ChatbotSettingsSection>): void {
  (window as HostWindow).__elowenRegisterPluginUi?.('chatbot', { requiresApiVersion: 12, settings });
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  return await runtime().api(path, init) as T;
}

/** Every write the page makes is an explicit submit, so the method is stated once here rather than
 *  spelled out at each call site. */
export function jsonRequest(method: 'POST' | 'PUT' | 'PATCH', body: unknown): RequestInit {
  return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

/** The admin routes this bundle calls, built in ONE place. A query string a view spells for itself is a
 *  second definition of what the route accepts, and the server validates these names strictly. */
export const chatbotApi = {
  bots: (): string => '/plugins/chatbot/api/bots',
  conversations: (input: { chatbotUserId: number; limit: number; offset: number }): string =>
    `/plugins/chatbot/api/conversations?chatbotUserId=${input.chatbotUserId}&limit=${input.limit}&offset=${input.offset}`,
  conversation: (input: { chatbotUserId: number; visitorId: string }): string =>
    `/plugins/chatbot/api/conversation?chatbotUserId=${input.chatbotUserId}&visitorId=${encodeURIComponent(input.visitorId)}`,
  stats: (input: { chatbotUserId: number; from: string; to: string }): string =>
    `/plugins/chatbot/api/stats?chatbotUserId=${input.chatbotUserId}&from=${input.from}&to=${input.to}`,
  /** The account's effective tool access, read from the host's own users panel route: the plugin reports
   *  what the account can reach rather than keeping an opinion of its own about it. */
  accountTools: (userId: number): string => `/users/${userId}/tools`,
} as const;
