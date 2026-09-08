/** Typed access to the host's window.ElowenUiRuntime for the cronjob plugin bundle.
 *
 *  The runtime hands over untyped `components`/`hooks`/`utils` records; this module narrows each
 *  entry to the signature the moved jobs editor was written against in the core app. The narrowing
 *  is a local structural CONTRACT, not a source import — the bundle must not compile against `web/`
 *  (it builds standalone via elowen-plugin-ui-kit).
 */
import type { ComponentType, ReactNode } from 'react';
import type { PluginUiRegistration } from 'elowen-plugin-ui-kit';
import type { ProjectExecutionRef } from 'elowen/dist/shared/projectExecution.js';
import type { AutoSaveStatusProps, UseAutoSaveStatus } from '../../autoSaveContract';

// ---- data shapes (structural mirrors of the daemon's wire types) --------------------------------

interface CronJobOwner {
  id: number;
  username: string;
  name: string;
  avatar: string;
}

/** A conversation as the picker and the saved-job projection name it: enough to recognize and to file
 *  under, never anything that was said in it. The daemon's immutable identity for the row stays on the
 *  daemon and is deliberately absent here. */
export interface CronConversation {
  id: string;
  title: string;
  ownerUserId: number;
  /** The chat platform a conversation belongs to, or null for an own Elowen conversation. */
  platform: string | null;
  direct: boolean;
}

export interface CronConversationOption extends CronConversation {
  updatedAt: string;
}

/** GET /plugins/cronjob/api/conversations. `unavailable` = this core exposes no conversation directory;
 *  it is not the same answer as an empty list. */
export interface CronConversationsResponse {
  status: 'available' | 'unavailable';
  conversations: CronConversationOption[];
}

export interface CronJob {
  id: string; name: string; schedule: string; prompt: string;
  check?: string; hours?: string; notifyChannelId?: string; plain?: boolean;
  model?: { provider: string; model: string };
  /** The account this job belongs to; absent/null = an instance job (admin-created, admin-powered). */
  ownerUserId?: number | null;
  projectRef?: ProjectExecutionRef;
  /** Read-only display projection supplied by GET; never persisted or returned in PUT payloads. */
  owner?: CronJobOwner;
  /** The conversation this recurring job is FILED under, by the conversation's CURRENT id — organization
   *  only, and read by nothing that decides how the job runs. Absent = never filed (a legacy job or a
   *  one-shot). Sending it back unchanged preserves the stored filing; a blank value is refused, and a
   *  new recurring job must carry one. */
  conversationSessionId?: string;
  /** Read-only projection of the filed conversation: `null` when its target is gone, absent when the job
   *  was never filed. Never sent back — the daemon resolves it from its own immutable key. */
  conversation?: CronConversation | null;
  /** True when the daemon could not READ the conversation directory at all, so `conversation: null` means
   *  "not known right now" rather than "deleted". A different answer, and a different thing to say. */
  conversationUnresolved?: boolean;
  /** Read-only projection of WHERE this job's turns run, which is a different fact from the conversation
   *  it is filed under: `dedicated` is the job's own conversation, `channel` its cron channel, `origin`
   *  the conversation it was scheduled from. Derived by the daemon per response and never sent back. */
  runLocation?: { kind: 'origin' | 'dedicated' | 'channel'; sessionId?: string; channelId?: string };
  enabled?: boolean; runAt?: string; createdAt?: string; lastRun?: string; lastResult?: string;
  /** Server revision used as the conditional-write token; never display as editable content. */
  revision?: number;
  expectedRevision?: number;
}
export interface NotificationDestinationOption {
  value: string; id: string; platform: string;
  kind: 'channel' | 'thread' | 'chat' | 'person';
  label: string; group?: string; subtitle?: string;
}
export interface BrainModelOption { provider: string; model: string }

export interface ManageSelectionItem {
  id: string; label: string; group: string; groupLabel?: string;
  icon?: ReactNode; badges?: { text: string; tone?: 'accent' | 'muted' }[];
  /** A row the list SHOWS but cannot select — a saved target that is no longer offered. `disabledHint`
   *  is its hover text. */
  disabled?: boolean; disabledHint?: string;
}

/** The compact on-page summary of a managed selection, and the modal its Manage button opens. Typed
 *  against the host's real props rather than as "any component": these two carry every choice this
 *  editor makes, and a prop the host never had would otherwise ship as silently doing nothing. */
interface SelectionSummaryProps {
  /** The count line; empty renders no line, which is what a single-value summary wants. */
  countText: string;
  samples: { label: string; icon?: ReactNode }[];
  moreCount: number;
  onManage(): void;
  manageLabel: string;
  /** A specific accessible name, for a page carrying several managed selections. */
  manageAriaLabel?: string;
  variant?: 'default' | 'line';
}

interface ManageSelectionModalProps {
  title: string;
  subtitle?: string;
  open: boolean;
  onClose(): void;
  items: ManageSelectionItem[];
  selected: Set<string>;
  onSave(next: Set<string>): void | Promise<void>;
  /** Single-select: a row click REPLACES the selection and the footer names the chosen item. */
  single?: boolean;
  countLabel?(count: number): string;
  emptySelectionHint?: string;
  saving?: boolean;
}

// ---- hook shapes --------------------------------------------------------------------------------

interface QueryResult<T> { data?: T; isLoading: boolean; isError: boolean; refetch(): void }
interface MutationResult<TVars> {
  mutate(vars: TVars, cb?: { onSuccess?: () => void; onError?: (e: unknown) => void }): void;
  mutateAsync(vars: TVars): Promise<unknown>;
  isPending: boolean;
}

/** The core translation catalog — the editor reads only host-generic sections (managePicker, common). */
type Dict = Record<string, Record<string, string>>;

interface CronHooks {
  useTranslation(): { t: Dict; locale: string };
  useToast(): { toast: (msg: string, tone?: 'ok' | 'error') => void };
  useCronJobs(enabled?: boolean): QueryResult<CronJob[]>;
  useMe(): QueryResult<{ user?: { id: number; is_admin: boolean; username: string } }>;
  useNotificationDestinations(): QueryResult<NotificationDestinationOption[]>;
  useBrainModels(): QueryResult<BrainModelOption[]>;
  useSaveCronJob(): MutationResult<CronJob>;
  useDeleteCronJob(): MutationResult<string>;
  useAutoSaveStatus: UseAutoSaveStatus;
  usePluginStrings(plugin: string): Record<string, string>;
  /** The host's own React Query hook, against the HOST's one QueryClient — importing the library here
   *  would open a second cache. Used for this plugin's own routes, which have no dedicated host hook. */
  useQuery<T>(options: Record<string, unknown>): QueryResult<T>;
}

interface CronUtils {
  compactElapsed(ms: number): string;
  parseTs(ts: string | undefined): number | null;
  isValidSchedule(spec: string): boolean;
  apiErrorMessage(error: unknown): string;
}

// The host components are runtime records; `any` props keep the JSX call sites identical to the
// core original without duplicating every core prop type here (this lean lint set permits it).
type AnyComponent = ComponentType<any>;

interface CronComponents {
  Avatar: AnyComponent;
  Badge: AnyComponent; Button: AnyComponent; Input: AnyComponent; Field: AnyComponent; Toggle: AnyComponent;
  ConfirmDialog: AnyComponent; AutoSaveStatus: ComponentType<AutoSaveStatusProps>; LoadingState: AnyComponent; ErrorState: AnyComponent;
  ManageSelectionModal: ComponentType<ManageSelectionModalProps>; SelectionSummary: ComponentType<SelectionSummaryProps>; BrainModelField: AnyComponent;
  EmptyState: AnyComponent; Segmented: AnyComponent; ChoiceField: AnyComponent; Pager: AnyComponent; RegisterSearch: AnyComponent;
  DataTable: AnyComponent; DataTableRow: AnyComponent; DataTableCell: AnyComponent; DataTableChevronCell: AnyComponent;
  ControlSurfaceDocument: AnyComponent; ControlSurfaceToolbar: AnyComponent;
  ControlSurfaceRegister: AnyComponent; ControlSurfaceState: AnyComponent;
  PluginSection: AnyComponent;
  WorkspaceShell: AnyComponent; WorkspaceMetric: AnyComponent; WorkspaceDetailRail: AnyComponent;
  SettingsGroup: AnyComponent;
}

interface CronRuntime {
  components: CronComponents;
  hooks: CronHooks;
  utils: CronUtils;
  api(path: string, init?: RequestInit): Promise<unknown>;
}

type CronRegistration = Pick<PluginUiRegistration, 'requiresApiVersion' | 'settings' | 'ownsPageFrame'>;

/** The host runtime, narrowed. The settings deck loads the bundle only after installing the runtime,
 *  so a missing global here is a programming error worth throwing on. */
export function runtime(): CronRuntime {
  const rt = window.ElowenUiRuntime as unknown as CronRuntime | undefined;
  if (!rt) throw new Error('ElowenUiRuntime is not installed');
  return rt;
}

/** Register this plugin's settings components on the host (no-op outside the plugin-UI host page). */
export function registerCronUi(registration: CronRegistration): void {
  window.__elowenRegisterPluginUi?.('cronjob', registration);
}
