import type { AssertPublished } from 'elowen-plugin-ui-kit';
/** Typed access to the host's window.ElowenUiRuntime for the skills plugin bundle.
 *
 *  The runtime hands over untyped `components`/`hooks` records; this module narrows each entry to
 *  the signature the moved skills editor was written against in the core app. The narrowing is a
 *  local structural CONTRACT, not a source import — the bundle must not compile against `web/`. */
import type { ComponentType, ReactNode } from 'react';
export interface PluginChatPickerProps {
  plugin: string;
  command: string;
  sessionId: string | null;
  argument?: string;
  send(text: string): void;
  close(): void;
}

// ---- data shapes (structural mirrors of the daemon's wire types) --------------------------------

export interface PluginSkill {
  name: string;
  description: string;
  source: string;
  catalogSource: 'personal' | 'instance' | 'bundled' | 'plugin';
  contributorPlugin: string;
  pluginKey: string | null;
  /** The account this skill belongs to; null for bundled and instance-wide ones. */
  owner: number | null;
  canDelete: boolean;
  disableModelInvocation: boolean;
  enabledForAccount: boolean;
  effective: boolean;
  unavailableReason: 'plugin-unavailable' | 'disabled-for-account' | 'shadowed' | null;
  location?: string;
  version: number | null;
  revision?: number;
  content?: string;
  scope?: string;
  active?: boolean;
}

export interface SkillAccount { id: number; username: string; name?: string }

/** Which set a write addresses: an account id, the shared instance set, or the caller's own. */
export type SkillOwner = number | 'instance' | null;

/** One entry of the page's single condensed filter control — the host's `PageFilterField`
 *  (web/components/ui/PageFilters.tsx), mirrored structurally because a bundle never compiles against
 *  `web/`. `control` is an opaque node the host renders and never reads: whether the page is narrowed is
 *  answered by the page's own `active` flag, and an active field must also say what it filters
 *  (`activeLabel`) and how to undo it (`onReset`) — which is why the two are inseparable here too.
 *  `MarkdownAssetEditor`'s `extraFilters` prop takes these. */
export type SkillFilterField =
  | { id: string; label: string; hint?: string; control: ReactNode; active: true; activeLabel: string; onReset: () => void }
  | { id: string; label: string; hint?: string; control: ReactNode; active: false };

// ---- hook shapes --------------------------------------------------------------------------------

interface QueryResult<T> { data?: T; isLoading: boolean; isError: boolean; refetch(): void }
interface MutationResult<TVars> {
  mutate(vars: TVars, cb?: { onSuccess?: () => void; onError?: (e: unknown) => void }): void;
  mutateAsync(vars: TVars): Promise<unknown>;
  isPending: boolean;
  variables?: TVars;
}

/** The host dictionary, narrowed to what this bundle reads (nested string maps). */
type Dict = Record<string, Record<string, string>>;

interface SkillsHooks {
  useTranslation(): { t: Dict; locale: string };
  useToast(): { toast: (msg: string, tone?: 'ok' | 'error') => void };
  usePluginSkills(): QueryResult<PluginSkill[]>;
  useCreatePluginSkill(): MutationResult<{ name: string; description: string; content: string; disableModelInvocation?: boolean; owner?: SkillOwner }>;
  useUpdatePluginSkill(): MutationResult<{ name: string; owner?: SkillOwner; patch: { description?: string; content?: string; disableModelInvocation?: boolean } }>;
  useDeletePluginSkill(): MutationResult<{ name: string; owner?: SkillOwner }>;
  useMe(): QueryResult<{ user?: { id: number; is_admin: boolean; username: string } }>;
  usePluginStrings(plugin: string): Record<string, string>;
}

// The host components are runtime records; `any` props keep the JSX call sites identical to the
// core original without duplicating every core prop type here (this lean lint set permits it).
type AnyComponent = ComponentType<any>;

interface SkillsComponents {
  Badge: AnyComponent; Toggle: AnyComponent; SettingsGroup: AnyComponent; PluginSection: AnyComponent;
  MarkdownAssetEditor: AnyComponent; Button: AnyComponent; Field: AnyComponent; Segmented: AnyComponent; SelectMenu: AnyComponent;
  ControlSurfaceDocument: AnyComponent; Modal: AnyComponent; ModalBody: AnyComponent; ConfirmDialog: AnyComponent;
  Input: AnyComponent; IconButton: AnyComponent; LoadingState: AnyComponent; ErrorState: AnyComponent; EmptyState: AnyComponent;
  WorkspaceShell: AnyComponent; WorkspaceMetric: AnyComponent;
}
/** Every key of the interface above has to be a component the host really publishes. The runtime
 *  hands over an object, not a type, so a name invented here compiles and then reaches React as
 *  `undefined` at render time; `AssertPublished` turns that into an error in this repository. */
type PublishedNames = AssertPublished<keyof SkillsComponents>;

interface SkillsRuntime {
  components: Pick<SkillsComponents, PublishedNames>;
  hooks: SkillsHooks;
  utils: { apiErrorMessage(e: unknown): string };
  api(path: string, init?: RequestInit): Promise<unknown>;
}

type PluginPageComponent = ComponentType<{ plugin: string; params: Record<string, string>; rest: string[]; surface: 'page' | 'deck' }>;
interface SkillsRegistration {
  requiresApiVersion: number;
  pages?: Record<string, PluginPageComponent>;
  settings?: Record<string, PluginPageComponent>;
  chatPickers?: Record<string, ComponentType<PluginChatPickerProps>>;
  /** Settings sections that draw their OWN page frame. The host wraps a section in its page column and
   *  module header by default, which nests two frames around one that already brings its own. */
  ownsPageFrame?: string[];
}
interface HostWindow {
  ElowenUiRuntime?: unknown;
  __elowenRegisterPluginUi?: (plugin: string, registration: SkillsRegistration) => void;
}

/** The host runtime, narrowed. The settings deck loads the bundle only after installing the runtime,
 *  so a missing global here is a programming error worth throwing on. */
export function runtime(): SkillsRuntime {
  const rt = (window as HostWindow).ElowenUiRuntime as SkillsRuntime | undefined;
  if (!rt) throw new Error('ElowenUiRuntime is not installed');
  return rt;
}

/** Register this plugin's settings components on the host (no-op outside the plugin-UI host page). */
export function registerSkillsUi(registration: SkillsRegistration): void {
  (window as HostWindow).__elowenRegisterPluginUi?.('skills', registration);
}
