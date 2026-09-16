import type { ComponentType } from 'react';
export interface BrainCard {
  id: string;
  title?: string;
  items?: readonly { text: string; status?: 'pending' | 'in_progress' | 'completed'; startedAt?: number; id?: string; label?: string; owner?: string; blockedBy?: string[] }[];
  body?: string;
  pinned?: boolean;
}
export interface PluginChatPickerProps {
  plugin: string;
  command: string;
  sessionId: string | null;
  argument?: string;
  send(text: string): void;
  close(): void;
}
export interface PluginChatCardProps {
  card: BrainCard;
  sessionId: string | null;
  live: boolean;
  open(command?: string): void;
}

export interface SessionTask {
  id: string;
  subject: string;
  description: string;
  activeForm?: string;
  status: 'pending' | 'in_progress' | 'completed';
  startedAt?: number;
  owner?: string;
  blockedBy: string[];
  blocks: string[];
}
interface Query<T> { data?: T; isLoading: boolean; isError: boolean; refetch(): void }
interface Mutation<T> { mutate(vars: T, cb?: { onSuccess?: (value: any) => void; onError?: (error: unknown) => void }): void; isPending: boolean }
interface Components {
  Modal: ComponentType<any>; ModalBody: ComponentType<any>; ModalFooter: ComponentType<any>; ConfirmDialog: ComponentType<any>;
  Input: ComponentType<any>; Button: ComponentType<any>; Badge: ComponentType<any>; Checkbox: ComponentType<any>;
  ActionMenu: ComponentType<any>; Progress: ComponentType<any>; LoadingState: ComponentType<any>; ErrorState: ComponentType<any>; EmptyState: ComponentType<any>; Spinner: ComponentType<any>;
}
interface Hooks {
  useTranslation(): { t: Record<string, any> };
  usePluginStrings(plugin: string): Record<string, string>;
  useToast(): { toast(message: string, tone?: 'ok' | 'error'): void };
  useSessionTasks(sessionId: string | null): Query<{ tasks: SessionTask[] }>;
  useUpdateSessionTask(): Mutation<{ sessionId: string; taskId: string; status?: SessionTask['status']; subject?: string }>;
  useDeleteSessionTask(): Mutation<{ sessionId: string; taskId: string }>;
  useClearSessionTasks(): Mutation<{ sessionId: string; scope: 'completed' | 'all' }>;
}
export interface TodoRuntime { components: Components; hooks: Hooks; utils: { formatDuration(value: number): string; apiErrorMessage(error: unknown): string } }
interface HostWindow { ElowenUiRuntime?: { components: Components; hooks: Hooks; utils: TodoRuntime['utils'] }; __elowenRegisterPluginUi?: (plugin: string, registration: TodoRegistration) => void }
export interface PluginChatRailSectionProps { variant: 'expanded' | 'compact'; sessionId: string | null; data: unknown; open: (target: string) => void; closeMobile?: () => void }
export interface TodoRegistration {
  requiresApiVersion: number;
  chatPickers?: Record<string, ComponentType<PluginChatPickerProps>>;
  chatCards?: Record<string, ComponentType<PluginChatCardProps>>;
  chatRailSections?: Record<string, ComponentType<PluginChatRailSectionProps>>;
}
export function runtime(): TodoRuntime {
  const value = (window as HostWindow).ElowenUiRuntime;
  if (!value) throw new Error('ElowenUiRuntime is not installed');
  return value;
}
export function registerTodoUi(registration: TodoRegistration): void {
  (window as HostWindow).__elowenRegisterPluginUi?.('todo', registration);
}
