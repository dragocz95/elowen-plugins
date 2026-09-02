import type { ComponentType, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { PluginPageProps } from 'elowen-plugin-ui-kit';

export interface BrowserArtifactProps {
  plugin: string;
  artifact: {
    id: string;
    plugin: string;
    sessionId: string;
    toolCallId: string;
    view: string;
    fallback: string;
    data?: unknown;
    media?: { transport: 'sse'; path: string };
    expiresAt: string;
    status: 'open';
    createdAt: string;
    updatedAt: string;
  };
  /** Host API 14: the assistant prose the transcript is rendering right now, already bounded and cleared
   *  by the host. The expanded canvas covers the transcript, so this is the only way the reply reaches a
   *  reader who is watching the browser. Optional because an older host sends nothing. */
  narration?: string;
  /** Host API 15: set while the app is waiting on an answer. It carries no part of the question — the
   *  host's own translated line and the way back to the card that owns answering — which is exactly what
   *  the canvas needs: say a prompt is waiting, then get out of the way. */
  pendingInput?: { label: string; reveal: () => void } | null;
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
  // No `IconButton`: it is a bordered square that aligns to a table row or a toolbar rule, and the marks
  // on the live canvas are round glass discs. The artifact draws that one itself (BrowserArtifact.GlassButton).
  Badge: ComponentType<{ tone?: 'default' | 'accent' | 'muted' | 'danger' | 'success' | 'warning'; children: ReactNode }>;
  // No `Modal`: the artifact's expanded view is a borderless canvas, and every Modal presentation frames
  // its content in a titled card. The plugin draws that surface itself (BrowserArtifact.CanvasOverlay).
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
  Spinner: ComponentType<{ size?: 'xs' | 'sm' | 'md' | 'lg'; label?: string }>;
  LoadingState: ComponentType<{ variant?: 'list' | 'cards' | 'kanban' | 'block'; height?: string }>;
  ErrorState: ComponentType<{ message: string; onRetry?: () => void }>;
  EmptyState: ComponentType<{ title: string; description?: string; icon?: LucideIcon; action?: ReactNode }>;
  DetailBlock: ComponentType<{ icon: LucideIcon; title: string; hint?: string; children: ReactNode }>;
  // The host's own list primitives: they carry the list/listitem semantics and the row rhythm every other
  // register in the app uses, which is why the readiness panel is a list of host rows rather than a
  // hand-drawn table.
  EntityList: ComponentType<{ className?: string; children: ReactNode }>;
  EntityRow: ComponentType<{ interactive?: boolean; selected?: boolean; busy?: boolean; className?: string; children: ReactNode }>;
  PluginPageHeader: ComponentType<{ title: string; description?: string; icon?: LucideIcon; action?: ReactNode }>;
}

export interface BrowserRuntime {
  components: RuntimeComponents;
  hooks: RuntimeHooks;
  utils: { apiErrorMessage(error: unknown): string };
  api(path: string, init?: RequestInit): Promise<unknown>;
}

interface HostWindow {
  ElowenUiRuntime?: unknown;
  __elowenRegisterPluginUi?: (plugin: string, registration: {
    requiresApiVersion: number;
    chatArtifacts?: Record<string, ComponentType<BrowserArtifactProps>>;
    settings?: Record<string, ComponentType<PluginPageProps>>;
    account?: Record<string, ComponentType<PluginPageProps>>;
  }) => void;
}

export function runtime(): BrowserRuntime {
  const value = (window as HostWindow).ElowenUiRuntime as BrowserRuntime | undefined;
  if (!value) throw new Error('ElowenUiRuntime is not installed');
  return value;
}

export function registerBrowserUi(
  artifact: ComponentType<BrowserArtifactProps>,
  settings: ComponentType<PluginPageProps>,
  account: ComponentType<PluginPageProps>,
): void {
  (window as HostWindow).__elowenRegisterPluginUi?.('browser', {
    requiresApiVersion: 15,
    chatArtifacts: { 'browser-session': artifact },
    settings: { runtime: settings },
    account: { profile: account },
  });
}

export function jsonRequest(method: string, value?: unknown): RequestInit {
  return {
    method,
    headers: value === undefined ? undefined : { 'content-type': 'application/json' },
    body: value === undefined ? undefined : JSON.stringify(value),
  };
}

export const apiError = (error: unknown): string => runtime().utils.apiErrorMessage(error) || 'Browser operation failed.';
