import type { ComponentType } from 'react';
import type { QueryClient } from '@tanstack/react-query';

type AnyComponent = ComponentType<any>;
type QueryResult<T> = { data?: T; isLoading: boolean; isError: boolean; refetch(): void };
type MutationResult<T> = {
  mutate(vars: T, callbacks?: { onSuccess?: () => void; onError?: (error: unknown) => void }): void;
  mutateAsync(vars: T): Promise<unknown>;
  isPending: boolean;
};

/** `executionKind` and `guestRoot` come straight from the host's project projection. The editor reads
 *  them for one decision each: whether this project has a second root to offer at all, and which guest
 *  directory to NAME in the interface. The path itself is never derived here — the daemon resolves every
 *  request from the project row, and a client that re-derived the mount rule would drift from it. */
interface Project { id: number; slug: string; path: string; notes: string; icon?: string; pr_enabled: boolean | null; executionKind?: 'host' | 'managed'; guestRoot?: string }
export interface FileNode { path: string; type: 'file' | 'dir'; size?: number }
type Dict = Record<string, Record<string, string>>;
/** Only what the editor asks of the signed-in account: whether it may reach the system root. */
interface Me { user: { id: number; username: string; is_admin: boolean } }

/** The host publishes its components as an untyped record, so this list is what stops the bundle from
 *  reaching for a primitive the runtime does not carry — a name that is not here is a build error
 *  rather than an `undefined` component at first render. `any` props keep the JSX call sites identical
 *  to the core originals without restating every core prop type. */
interface EditorComponents {
  Button: AnyComponent; ContextMenu: AnyComponent; EmptyState: AnyComponent;
  Field: AnyComponent; Input: AnyComponent; LoadingState: AnyComponent;
  Modal: AnyComponent; ModalBody: AnyComponent; ModalFooter: AnyComponent;
  ModuleHeader: AnyComponent; MotionLayoutItem: AnyComponent; MotionPresence: AnyComponent;
  PatchView: AnyComponent; ProjectFilterPills: AnyComponent; ProjectIcon: AnyComponent;
  SelectMenu: AnyComponent; ControlSurfaceDocument: AnyComponent;
  WorkspacePage: AnyComponent; WorkspaceHero: AnyComponent; WorkspaceTakeover: AnyComponent;
}

interface EditorRuntime {
  components: EditorComponents;
  hooks: {
    useQueryClient(): Pick<QueryClient, 'setQueryData' | 'invalidateQueries'>;
    useTranslation(): { t: Dict };
    usePluginStrings(plugin: string): Record<string, string>;
    useToast(): { toast(message: string, tone?: 'ok' | 'error'): void };
    /** The signed-in account. The editor reads it for one decision: only an admin is offered the
     *  system root, and the daemon refuses the reserved id for everyone else regardless. */
    useMe(): QueryResult<Me>;
    useProjects(): QueryResult<Project[]>;
    /** Git reads describe the project checkout and are asked for only under the project root. */
    useProjectFileAtHead(id: number | null, path: string | null, enabled: boolean): QueryResult<{ content: string }>;
    useProjectCommit(id: number | null, hash: string | null): QueryResult<{ diff: string; files: string[] }>;
    useProjectCommitFileDiff(id: number | null, hash: string | null, path: string | null): QueryResult<{ diff: string }>;
    useProjectChanged(id: number | null): QueryResult<{ changed: string[] }>;
    useProjectChanges(id: number | null, enabled: boolean): QueryResult<{ diff: string }>;
    /** Raw React Query against the host's single QueryClient. The editor's file reads and tree mutations
     *  are keyed by project AND root, which the host's project-file hooks cannot express, so they are
     *  built here instead of borrowed — on the same cache, through the same invalidation path. */
    useQuery<T>(options: Record<string, unknown>): QueryResult<T>;
    useMutation<_TData, _TError, TVars>(options: Record<string, unknown>): MutationResult<TVars>;
    useMobile(): boolean;
    /** The persisted project filter the built-in workspaces share, keyed by storage key. */
    useProjectFilter(storageKey: string): { selectedProject: number | 'all'; setProject(value: number | 'all'): void };
    /** A localStorage-backed choice, validated on restore because the slot is user-writable. */
    usePersistentState<T extends string>(key: string, fallback: T, allowed: readonly T[] | ((value: string) => boolean)): [T, (value: T) => void];
    /** Height that makes the surface reach the bottom of the window; undefined until measured. */
    useFillHeight(ref: { current: HTMLElement | null }, minPx?: number): number | undefined;
  };
  utils: {
    apiErrorMessage(error: unknown): string;
    baseName(path: string): string;
    copyText(text: string): Promise<boolean>;
    /** The host's single Monaco colour table — see the note on the host side for why it is shared. */
    defineEditorThemes(monaco: { editor: { defineTheme(name: string, theme: unknown): void } }): void;
    /** Which of those tables matches the app's current design — a skin may run the UI light. */
    editorTheme(): string;
  };
  /** Same-origin JSON call against the daemon through the BFF. Every editor file request goes through
   *  it, because each one names the root it operates on and the host's project-file client does not. */
  api(path: string, init?: RequestInit): Promise<unknown>;
  navigate(href: string): void;
}

type PluginPage = ComponentType<{ plugin: string; params: Record<string, string>; rest: string[] }>;
interface Registration { requiresApiVersion: number; pages: Record<string, PluginPage> }
interface HostWindow { ElowenUiRuntime?: unknown; __elowenRegisterPluginUi?: (name: string, registration: Registration) => void }

export function runtime(): EditorRuntime {
  const value = (window as HostWindow).ElowenUiRuntime as EditorRuntime | undefined;
  if (!value) throw new Error('ElowenUiRuntime is not installed');
  return value;
}

export function registerEditorUi(registration: Registration): void {
  (window as HostWindow).__elowenRegisterPluginUi?.('editor', registration);
}

