import type { ComponentProps, ComponentType, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { AssertPublished } from 'elowen-plugin-ui-kit';
import type { AutoSaveStatusProps, UseAutoSaveStatus } from '../../autoSaveContract';

/** The host runtime, narrowed to what this bundle mounts. React itself, the HTTP helper and every UI
 *  component come from `window.ElowenUiRuntime` at run time: the bundle imports no UI package and never
 *  reaches into the host application, so `react` here is a TYPE only. */

/** The core translation catalog, narrowed the way every bundle that mounts a host affordance narrows it.
 *  Only host-generic sections are read here: `managePicker.manage` is the word on the button that opens a
 *  managed selection, and it belongs to the host that draws that button rather than to this plugin's copy. */
type HostDictionary = Record<string, Record<string, string>>;

/** The published deck vocabulary (API 19). One record of the section navigation, the group it sits in,
 *  and which of the two shapes the navigation is being asked for. */
type DeckNavigationLayout = 'sidebar' | 'tabs';

/** One record a query matched, offered as its own way in under the record it belongs to. */
interface DeckNavMatch {
  id: string;
  label: string;
  onActivate(): void;
}

export interface DeckNavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  current?: boolean;
  onActivate(): void;
  /** The matches this record's own search found, each addressable on its own. */
  matches?: DeckNavMatch[];
}

export interface DeckNavGroup {
  id: string;
  caption?: string;
  items: DeckNavItem[];
}

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
export interface PluginDetail {
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
  useAutoSaveStatus: UseAutoSaveStatus;
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
    refetchInterval?: number;
  }): { data?: T; isLoading: boolean; isError: boolean; error: unknown; refetch(): unknown };
  useQueryClient(): {
    setQueryData<T>(queryKey: readonly unknown[], updater: (current: T | undefined) => T | undefined): void;
  };
  usePersistentState<T extends string>(
    key: string,
    initial: T,
    allowed: readonly T[] | ((raw: string) => boolean),
  ): [T, (value: T) => void];

}

type AnyComponent = ComponentType<any>;

export interface DateRange {
  preset: 'today' | '7d' | '30d' | '90d' | 'all' | 'custom';
  from?: string;
  to?: string;
}

export type PageFilterField =
  | { id: string; label: string; control: ReactNode; hint?: string; active: false }
  | { id: string; label: string; control: ReactNode; hint?: string; active: true; activeLabel: string; onReset(): void };


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
    /** The host row forwards native div attributes; this plugin uses the tooltip only. */
    title?: string;
    className?: string;
  }>;
  DateRangeFilter: ComponentType<{ value: DateRange; onChange(range: DateRange): void; compact?: boolean }>;
  EntityList: ComponentType<{ children?: ReactNode; className?: string }>;
  EntityRow: ComponentType<{ children?: ReactNode; className?: string; selected?: boolean; busy?: boolean; interactive?: boolean }>;
  EmptyState: ComponentType<{ title: string; description?: string; icon?: LucideIcon; action?: ReactNode }>;
  ErrorState: ComponentType<{ message: string; onRetry?: () => void }>;
  Field: ComponentType<{ label: string; htmlFor?: string; hint?: string; description?: string; error?: string; required?: boolean; children?: ReactNode }>;
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
  Textarea: ComponentType<ComponentProps<'textarea'>>;
  LoadingLine: ComponentType<{ label?: string; layout?: 'inline' | 'block' | 'page' }>;
  LoadingState: ComponentType<{ variant?: 'list' | 'cards' | 'block'; height?: string }>;
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
  PageFilters: ComponentType<{ fields: PageFilterField[] }>;
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
  /** THE DECK'S FRAME, published by the host at API 19: the secondary column beside the content where
   *  there is width for one, the phone's single line of tabs above it, and the one content pane that
   *  scrolls. It is the same frame Settings and Account wear, which is the whole point of taking it from
   *  the host instead of drawing a second one here.
   *
   *  It fills the height the host's modal body gives it, so nothing around it may add another scroller or
   *  refuse to shrink. */
  SectionDeck: ComponentType<{
    testId: string;
    contentLabel: string;
    navigation(layout: DeckNavigationLayout, className?: string): ReactNode;
    children?: ReactNode;
  }>;
  /** The deck's section navigation, in the two shapes the two viewports have room for. `SectionDeck`
   *  asks for it twice — once per layout — and hides the one the viewport has no room for. The column's
   *  `search` is the HOST's own filter over the records it was handed; the strip carries none, so a phone
   *  moves between sections without a field. */
  DeckNavigation: ComponentType<{
    label: string;
    groups: DeckNavGroup[];
    layout: DeckNavigationLayout;
    testId: string;
    search?: { value: string; onChange(value: string): void; label: string };
    emptyLabel: string;
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
    /** The heading's one plain line, read on the surface. */
    description?: string;
    /** Long-form guidance for the heading, kept behind the host's own help affordance — the same one a
     *  row's own help mark wears. */
    hint?: string;
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
  /** The host's canonical single-choice field. With `picker="always"` it is a row trigger opening the shared
   *  searchable picker, which is what the conversations register narrows by visitor with: a visitor is
   *  found by typing part of their address or id, never by typing a whole id into a box. */
  ChoiceField: ComponentType<{
    title: string;
    options: { value: string; label: string; icon?: ReactNode }[];
    value: string;
    onChange(value: string): void;
    picker?: 'auto' | 'always';
    manageAriaLabel?: string;
  }>;
  /** The host's real chart: ticks, cursor tooltip and one axis per unit. Recharts lives in the app and
   *  loads lazily there, so this bundle never carries a charting library. */
  Progress: ComponentType<{ value: number; indicatorClassName?: string; 'aria-label': string; 'aria-valuetext'?: string }>;
  TimeSeriesChart: ComponentType<{
    data: { label: string; [key: string]: string | number | null }[];
    series: { key: string; label: string; colour: string; variant?: 'bar' | 'line'; axis?: 'left' | 'right'; format: (value: number) => string }[];
    height?: number;
    emptyText?: string;
    ariaLabel?: string;
  }>;
  Toggle: ComponentType<{ checked: boolean; onChange(checked: boolean): void; label?: string; disabled?: boolean }>;
  AutoSaveStatus: ComponentType<AutoSaveStatusProps>;
  /** The host's "?" mark, for a row this bundle lays out itself instead of handing to `SettingsRow` — the
   *  limits window, where every row is a slider — so an explanation always sits in the same affordance. */
  HelpTip: ComponentType<{ children: ReactNode; align?: 'left' | 'right' }>;
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
    /** Keep the track on one line, scrolling it sideways when it runs out of room and holding the selected
     *  option in view. The host's answer for a control with more options than the row has width for: a
     *  three-option switch in a narrow header clips its last option without this. */
    nowrap?: boolean;
    'aria-label'?: string;
  }>;
}

/** `AssertPublished` fails THIS build when a key above is not a component the host publishes. */
type PublishedNames = AssertPublished<keyof ChatbotComponents>;

export interface ChatbotRuntime {
  components: Pick<ChatbotComponents, PublishedNames>;
  hooks: ChatbotHooks;
  utils: {
    apiErrorMessage(error: unknown): string;
    DEFAULT_RANGE: DateRange;
    isStoredRange(raw: string): boolean;
    parseRange(raw: string): DateRange | null;
    rangeBounds(range: DateRange, now: number): { fromMs: number; toMs: number };
    serializeRange(range: DateRange): string;
    openBrainSessionWindow(sessionId: string): void;
  };
  api(path: string, init?: RequestInit): Promise<unknown>;
  navigate(href: string): void;
}

/** One page of this plugin, with the props the host mounts it with. The manifest presents this plugin in
 *  the host's reading modal, so `surface` is `deck` and `rest` is the address INSIDE that modal. */
export type ChatbotPageComponent = ComponentType<{
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
    pages: Record<string, ChatbotPageComponent>;
  }): void;
}

export function runtime(): ChatbotRuntime {
  const value = (window as HostWindow).ElowenUiRuntime as ChatbotRuntime | undefined;
  if (!value) throw new Error('ElowenUiRuntime is not installed');
  return value;
}

/** The chatbot admin surface is ONE entry in the primary navigation, presented in the host's own reading
 *  modal, with four sections switching inside it.
 *
 *  The manifest asks for that with `web.presentation: "overlay"`. The host then keeps the page underneath
 *  mounted, opens `/p/chatbot` in the shared modal frame Settings and Account use, owns the outer title,
 *  and mounts the page with `surface="deck"`. Every section is a route of its own inside that address, so
 *  a section is deep-linkable and the modal's own history step is the way back.
 *
 *  All four routes resolve to the SAME component on purpose: React then keeps the deck — its column, its
 *  strip and its scroll position — mounted across a section change, and only the content pane is
 *  replaced. Four distinct page components would rebuild the frame on every click.
 *
 *  API 19 is what publishes `SectionDeck` and `DeckNavigation`; the manifest's `web.requiresApiVersion`
 *  and the number below must agree, because the host gates the load on the manifest's copy and the mount
 *  on this one. API 20 adds the host-owned window opener for stored chat sessions; API 22 publishes Textarea. */
export function registerChatbotUi(pages: Record<string, ChatbotPageComponent>): void {
  (window as HostWindow).__elowenRegisterPluginUi?.('chatbot', { requiresApiVersion: 22, pages });
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
  /** One page of the register, of every visitor or of the one visitor picked. */
  conversations: (input: { chatbotUserId: number; limit: number; offset: number; visitorId: string | null }): string => {
    const query = new URLSearchParams({
      chatbotUserId: String(input.chatbotUserId),
      limit: String(input.limit),
      offset: String(input.offset),
    });
    if (input.visitorId !== null) query.set('visitor', input.visitorId);
    return `/plugins/chatbot/api/conversations?${query}`;
  },
  visitors: (chatbotUserId: number): string => `/plugins/chatbot/api/visitors?chatbotUserId=${chatbotUserId}`,
  eraseConversations: (chatbotUserId: number): string =>
    `/plugins/chatbot/api/conversations?chatbotUserId=${chatbotUserId}`,
  stats: (input: { chatbotUserId: number; from: string; to: string }): string =>
    `/plugins/chatbot/api/stats?chatbotUserId=${input.chatbotUserId}&from=${input.from}&to=${input.to}`,
  /** The account's effective tool access, read from the host's own users panel route: the plugin reports
   *  what the account can reach rather than keeping an opinion of its own about it. */
  accountTools: (userId: number): string => `/users/${userId}/tools`,
  /** The host's own switch-to-account route: the flow an administrator already uses on the Users screen,
   *  and the only way to a setting that belongs to the account rather than to the chatbot. */
  impersonate: (): string => '/auth/impersonate',
} as const;
