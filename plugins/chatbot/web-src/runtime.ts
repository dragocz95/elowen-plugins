import type { ComponentProps, ComponentType, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { AssertPublished } from 'elowen-plugin-ui-kit';

/** The host runtime, narrowed to what this bundle mounts. React itself, the HTTP helper and every UI
 *  component come from `window.ElowenUiRuntime` at run time: the bundle imports no UI package and never
 *  reaches into the host application, so `react` here is a TYPE only. */

interface ChatbotAccountView {
  username: string;
  type: 'human' | 'chatbot' | null;
  isAdmin: boolean;
}

export interface ChatbotBotView {
  chatbotUserId: number;
  publicId: string;
  displayName: string;
  prompt: string;
  status: 'draft' | 'enabled' | 'disabled';
  origins: string[];
  embedSnippet: string | null;
  updatedAt: string;
  account: ChatbotAccountView | null;
  projects: { id: number; slug: string }[];
  /** The same account invariants the plugin's server enforces, reported so an administrator sees WHY a
   *  chatbot cannot run instead of a chatbot that silently answers nobody. */
  blockers: string[];
  insecureOrigins: string[];
}

export interface ChatbotAccountOption {
  id: number;
  username: string;
  type: 'human' | 'chatbot' | null;
}

export interface ChatbotProjectOption {
  id: number;
  slug: string;
}

export interface ChatbotsResponse {
  bots: ChatbotBotView[];
  candidates: ChatbotAccountOption[];
  projects: ChatbotProjectOption[];
}

type PageFilterField =
  | { id: string; label: string; control: ReactNode; hint?: string; active: false }
  | { id: string; label: string; control: ReactNode; hint?: string; active: true; activeLabel: string; onReset(): void };

interface ChatbotHooks {
  /** This plugin's own page copy: its manifest's English fallback, with the active locale's overrides. */
  usePluginStrings(plugin: string): Record<string, string>;
  useToast(): { toast(message: string, tone?: 'ok' | 'error'): void };
}

type AnyComponent = ComponentType<any>;

/** Every component this bundle mounts, with the props it actually passes. The names are checked against
 *  the host's published set below, so a rename in core fails THIS build instead of reaching React as
 *  `undefined` on somebody's screen. */
interface ChatbotComponents {
  Badge: AnyComponent;
  Button: ComponentType<{
    variant?: 'default' | 'accent' | 'ghost' | 'danger' | 'ghost-danger' | 'outline' | 'outline-danger';
    size?: string;
    icon?: LucideIcon;
    className?: string;
    children?: ReactNode;
  } & ComponentProps<'button'>>;
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
  Input: ComponentType<ComponentProps<'input'>>;
  LoadingState: ComponentType<{ variant?: 'list' | 'cards' | 'kanban' | 'block'; height?: string }>;
  Modal: ComponentType<{
    title: string;
    onClose: () => void;
    children?: ReactNode;
    size?: 'default' | 'lg';
    description?: string;
    icon?: LucideIcon;
    'aria-busy'?: true;
    closeLabel?: string;
    closeDisabled?: boolean;
  }>;
  ModalBody: ComponentType<{ children?: ReactNode; className?: string }>;
  ModalFooter: ComponentType<{ children?: ReactNode; className?: string }>;
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
  SelectMenu: ComponentType<{
    value: string;
    onChange(value: string): void;
    options: { value: string; label: string; icon?: ReactNode }[];
    label: string;
    variant?: 'default' | 'line';
    disabled?: boolean;
    className?: string;
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
export function jsonRequest(method: 'POST' | 'PATCH', body: unknown): RequestInit {
  return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}
