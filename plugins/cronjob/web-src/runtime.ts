/** Typed access to the host's window.ElowenUiRuntime for the cronjob plugin bundle.
 *
 *  The runtime hands over untyped `components`/`hooks`/`utils` records; this module narrows each
 *  entry to the signature the calendar workbench was written against in the core app. The narrowing
 *  is a local structural CONTRACT, not a source import — the bundle must not compile against `web/`
 *  (it builds standalone via elowen-plugin-ui-kit).
 */
import type { ComponentType, CSSProperties, ReactNode } from 'react';
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

/** The server-derived next run of a job: wall-clock identity, expected instant, and WHY the expected
 *  instant may differ from the scheduled one. All times instant-ISO; local fields carry the SCHEDULER's
 *  timezone, never the browser's. */
export interface CronNextOccurrence {
  occurrenceId: string;
  scheduledAt: string;
  expectedAt: string;
  localDate: string;
  localTime: string;
  timezone: string;
  disposition: 'onTime' | 'deferredByHours' | 'catchUp' | 'dueNow' | 'late';
  precisionMs?: number;
  guarded: boolean;
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
  /** A drag-local edit of a one-shot, carried on the wire so the SERVER resolves the instant. Never
   *  persisted on read; the drawer uses it only around a save. */
  localRunAt?: { date: string; time: string };
  /** Server revision used as the conditional-write token; never display as editable content. */
  revision?: number;
  expectedRevision?: number;
  /** Server-derived read-only projection: `lifecycle` agrees with `runAt` by construction; the next
   *  occurrence describes the run the scheduler is heading for (never a finished one). */
  lifecycle?: 'recurring' | 'oneShot';
  nextOccurrence?: CronNextOccurrence | null;
  /** A durable run-now request is queued on the daemon; the next tick claims it. */
  manualQueued?: boolean;
}

export interface NotificationDestinationOption {
  value: string; id: string; platform: string;
  kind: 'channel' | 'thread' | 'chat' | 'person';
  label: string; group?: string; subtitle?: string;
}
export interface BrainModelOption { provider: string; model: string }

/** One planned occurrence inside a calendar/agenda window, expanded by the server from the same
 *  engine the scheduler ticks with. `localDate`/`localTime` belong to the response's timezone. */
export interface CronOccurrence {
  id: string;
  jobId: string;
  lifecycle: 'recurring' | 'oneShot';
  scheduledAt: string;
  expectedAt: string;
  localDate: string;
  localTime: string;
  timezone: string;
  disposition: 'onTime' | 'deferredByHours' | 'catchUp' | 'dueNow' | 'late';
  guarded: boolean;
}

export interface CronCalendarDay {
  date: string;
  total: number;
  samples: CronOccurrence[];
  overflow: number;
  omittedByHours: number;
}

/** GET /plugins/cronjob/api/calendar. `snapshot` hashes every visible scheduling/runtime field plus the
 *  engine inputs; the agenda's cursor rides on it and a changed snapshot conflicts out (409). */
export interface CronCalendarResponse {
  generatedAt: string;
  timezone: string;
  precisionMs: number;
  snapshot: string;
  window: {
    startLocalDate: string;
    endLocalDateExclusive: string;
    startAt: string;
    endAt: string;
  };
  scheduler: { ready: boolean; runningJobId?: string; runningSince?: string };
  jobs: CronJob[];
  days?: CronCalendarDay[];
  occurrences?: CronOccurrence[];
  nextCursor?: string;
  truncated: boolean;
}

/** POST /plugins/cronjob/api/schedule-preview — validity and next occurrences of a DRAFT schedule,
 *  computed by the server so the browser never parses cron itself. */
export interface CronSchedulePreview {
  valid: boolean;
  kind?: 'interval' | 'daily' | 'weekly' | 'cron';
  timezone: string;
  hoursValid: boolean;
  occurrences: CronOccurrence[];
  error?: string;
  code?: string;
}

/** POST /plugins/cronjob/jobs — ONE explicit creation request. `requestId` makes a retried request
 *  replay the same job, never a second one. */
export interface CronJobCreateBody {
  requestId: string;
  lifecycle: 'recurring' | 'oneShot';
  scope: 'personal' | 'instance';
  name: string;
  prompt: string;
  /** Recurring only. Required: the conversation the job is FILED under. */
  schedule?: string;
  conversationSessionId?: string;
  hours?: string;
  check?: string;
  plain?: boolean;
  model?: { provider: string; model: string };
  notifyChannelId?: string;
  projectRef?: ProjectExecutionRef;
  /** One-shot only, in the scheduler timezone; the browser never computes the instant. */
  localRunAt?: { date: string; time: string; disambiguation?: 'earlier' | 'later' };
}

export type CronApiErrorCode =
  | 'invalid_request' | 'invalid_schedule' | 'invalid_local_time' | 'nonexistent_local_time'
  | 'forbidden' | 'not_found' | 'revision_conflict' | 'idempotency_conflict'
  | 'preview_too_large' | 'snapshot_changed' | 'scheduler_unavailable' | 'run_already_queued'
  | 'one_shot_manual_run' | 'jobs_unreadable';

/** One the daemon's routes may answer. `error` stays the lone human line API 12 bundles see; `code` is
 *  the machine field the calendar flows branch on. */
export interface CronApiError extends Error {
  error: string;
  code?: CronApiErrorCode;
  field?: string;
  conflict?: boolean;
  current?: CronJob | null;
  snapshotChanged?: boolean;
}

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

/** react-day-picker v9 props the calendar flows use, named structurally. The host Calendar IS a
 *  DayPicker — the shapes below mirror the v9 surface this bundle drives, nothing narrower. */
interface CalendarProps {
  mode?: 'single' | 'multiple' | 'range';
  /** RFC3339 Date objects only: the month grid is a browser-local VIEW of server-provided local dates. */
  selected?: Date;
  onSelect?: (day: Date | undefined) => void;
  month?: Date;
  onMonthChange?: (month: Date) => void;
  showOutsideDays?: boolean;
  className?: string;
  classNames?: Record<string, string>;
  'aria-label'?: string;
  /** Custom day rendering: the ledger inside each day cell. */
  components?: Record<string, unknown>;
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
  /** The host's own React Query hooks, against the HOST's one QueryClient — importing the library here
   *  would open a second cache. Used for this plugin's own routes, which have no dedicated host hook. */
  useQuery<T>(options: Record<string, unknown>): QueryResult<T>;
  useMutation<TData, TVars>(options: Record<string, unknown>): MutationResult<TVars>;
  useQueryClient(): { invalidateQueries(options: Record<string, unknown>): Promise<void> };
  useMobile(): boolean;
}

interface CronUtils {
  compactElapsed(ms: number): string;
  parseTs(ts: string | undefined): number | null;
  apiErrorMessage(error: unknown): string;
}

// The host components are runtime records; `any` props keep the JSX call sites identical to the
// core original without duplicating every core prop type here (this lean lint set permits it).
type AnyComponent = ComponentType<any>;

interface CronComponents {
  Avatar: AnyComponent;
  Badge: AnyComponent; Button: AnyComponent; Input: AnyComponent; Field: AnyComponent; Toggle: AnyComponent;
  HelpTip: AnyComponent;
  ConfirmDialog: AnyComponent; AutoSaveStatus: ComponentType<AutoSaveStatusProps>; LoadingState: AnyComponent; ErrorState: AnyComponent;
  ManageSelectionModal: ComponentType<ManageSelectionModalProps>; SelectionSummary: ComponentType<SelectionSummaryProps>; BrainModelField: AnyComponent;
  EmptyState: AnyComponent; Segmented: AnyComponent; ChoiceField: AnyComponent;
  Modal: AnyComponent; ModalBody: AnyComponent; ModalFooter: AnyComponent;
  PluginSection: AnyComponent;
  /** The canonical page anatomy and toolbar (API 17's Calendar is the first REQUIRED one). */
  ModuleHeader: AnyComponent; WorkspacePage: AnyComponent; WorkspaceHero: AnyComponent;
  PageToolbar: AnyComponent; PageFilters: AnyComponent;
  /** The canonical month/date grid — the host's real shadcn Calendar on react-day-picker. */
  Calendar: ComponentType<CalendarProps>;
  WorkspaceDetailRail: AnyComponent;
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

/** The API may answer a mutation with a structured error body (`error`, `code`, `conflict`, `current`).
 *  The host's apiErrorMessage renders the human part; these readers pull the machine parts. */
export const apiErrorCode = (error: unknown): string | undefined => {
  if (typeof error !== 'object' || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
};
export const apiErrorConflict = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && !!(error as { conflict?: unknown }).conflict;
export const apiErrorCurrent = (error: unknown): CronJob | undefined => {
  if (typeof error !== 'object' || error === null) return undefined;
  const current = (error as { current?: unknown }).current;
  return current && typeof current === 'object' && typeof (current as CronJob).id === 'string' ? current as CronJob : undefined;
};

/** The YYYY-MM-DD label a local Date carries — the calendar month grid works on BROWSER dates, while
 *  occurrences carry the server's timezone labels. This is for the grid, never for a stored field. */
export const localDateLabel = (day: Date): string =>
  `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;

/** Register this plugin's settings components on the host (no-op outside the plugin-UI host page). */
export function registerCronUi(registration: CronRegistration): void {
  window.__elowenRegisterPluginUi?.('cronjob', registration);
}
