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

type PageFilterField =
  | { id: string; label: string; control: ReactNode; hint?: string; active: false }
  | { id: string; label: string; control: ReactNode; hint?: string; active: true; activeLabel: string; onReset(): void };

interface ChatbotHooks {
  /** This plugin's own page copy: its manifest's English fallback, with the active locale's overrides. */
  usePluginStrings(plugin: string): Record<string, string>;
  /** The app's own locale and dictionary. Only `locale` is read here: every number, price and timestamp on
   *  this surface is formatted in the reader's own locale rather than in a fixed one. */
  useTranslation(): { locale: string };
  useToast(): { toast(message: string, tone?: 'ok' | 'error'): void };
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
  ControlSurfaceDocument: ComponentType<{ children?: ReactNode; className?: string }>;
  ControlSurfaceRegister: ComponentType<{ children?: ReactNode; className?: string }>;
  ControlSurfaceState: ComponentType<{ children?: ReactNode; tone?: 'default' | 'danger'; className?: string }>;
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
  /** The host's scalar slider, which is how the panel's size and its corner radius are set. A number typed
   *  into a box cannot show a customer what they are about to get; a slider that drives a live preview
   *  can. */
  Slider: ComponentType<{
    value: number;
    onChange(value: number): void;
    min?: number;
    max?: number;
    step?: number;
    'aria-label'?: string;
    className?: string;
  }>;
  /** The host's two-option switch, for light and dark. A dropdown for two choices makes the customer open a
   *  list to discover what the other choice is. */
  Segmented: ComponentType<{
    options: { value: string; label: string }[];
    value: string;
    onChange(value: string): void;
    className?: string;
    'aria-label'?: string;
  }>;
  WorkspaceMetric: ComponentType<{ label: string; value: ReactNode; icon?: LucideIcon }>;
  WorkspaceShell: ComponentType<{
    variant?: 'register' | 'deck' | 'single';
    hero: Record<string, unknown>;
    navigation?: { sections: { id: string; label: string; icon?: LucideIcon }[]; value: string; onChange: (id: string) => void; ariaLabel: string };
    toolbar?: { search?: ReactNode; filters?: PageFilterField[]; actions?: ReactNode; children?: ReactNode };
    embedded?: boolean;
    children?: ReactNode;
    className?: string;
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

type PluginPage = ComponentType<{ plugin: string; params: Record<string, string>; rest: string[]; surface: 'page' | 'deck' }>;

/** The two globals a plugin bundle meets the host through. Declared here rather than taken from the kit's
 *  `declare global`, because this bundle states its OWN registration shape (`pages` plus the API version it
 *  targets) and the compiler is what checks that the two agree. */
interface HostWindow {
  ElowenUiRuntime?: unknown;
  __elowenRegisterPluginUi?(plugin: string, registration: { requiresApiVersion: number; pages: Record<string, PluginPage> }): void;
}

export function runtime(): ChatbotRuntime {
  const value = (window as HostWindow).ElowenUiRuntime as ChatbotRuntime | undefined;
  if (!value) throw new Error('ElowenUiRuntime is not installed');
  return value;
}

export function registerChatbotUi(pages: Record<string, PluginPage>): void {
  (window as HostWindow).__elowenRegisterPluginUi?.('chatbot', { requiresApiVersion: 12, pages });
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
