/** Typed access to the host's window.ElowenUiRuntime for the cronjob plugin bundle.
 *
 *  The runtime hands over untyped `components`/`hooks`/`utils` records; this module narrows each
 *  entry to the signature the calendar workbench was written against in the core app. The narrowing
 *  is a local structural CONTRACT, not a source import — the bundle must not compile against `web/`
 *  (it builds standalone via elowen-plugin-ui-kit).
 */
import type { ComponentType, ReactNode } from 'react';
import type { PluginUiRegistration, PluginHistoryBranchProps, AssertPublished } from 'elowen-plugin-ui-kit';
export type { PluginHistoryBranchProps };
export interface DashboardMetricProps { now: number; locale: string; monthCostUsd: number | null; monthTokens: number }
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
interface CronNextOccurrence {
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
interface CronOccurrence {
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

/** Why an instant is what it is: on time, deferred by active hours, a replayed miss, due now, or late. */
type CronDisposition = 'onTime' | 'deferredByHours' | 'catchUp' | 'dueNow' | 'late';

/** POST /plugins/cronjob/api/schedule-preview — validity and next occurrences of a DRAFT schedule,
 *  computed by the server so the browser never parses cron itself. */
type CronRunOutcome = 'waiting' | 'running' | 'ok' | 'error' | 'skipped';

export interface CronDayCard {
  jobId: string;
  kind: 'daily' | 'weekly' | 'cron' | 'oneShot';
  localTime: string;
  moreTimes: string[];
  remaining: number;
  enabled: boolean;
  guarded: boolean;
  disposition: CronDisposition;
  state: CronRunOutcome | 'paused';
}

export interface CronWeekDay {
  localDate: string;
  cards: CronDayCard[];
  dayTotal: number;
  runs: { ok: number; error: number; skipped: number; running: number };
}

export interface CronIntervalRow {
  jobId: string;
  schedule: string;
  enabled: boolean;
  nextExpectedAt: string | null;
  /** Calendar day of the next fire, in the scheduler timezone. Active hours can push it past midnight. */
  nextLocalDate: string | null;
  nextLocalTime: string | null;
  remainingToday: number;
  lastOutcome: CronRunOutcome | null;
  lastRunAt: string | null;
}

export interface CronWeekResponse {
  generatedAt: string;
  todayLocalDate: string;
  nowLocalTime: string;
  timezone: string;
  precisionMs: number;
  scheduler: { ready: boolean; runningJobId?: string; runningSince?: string };
  window: { startLocalDate: string; endLocalDateExclusive: string };
  jobs: CronJob[];
  days: CronWeekDay[];
  intervals: CronIntervalRow[];
  truncated: boolean;
}

export interface CronRunRow {
  id: string;
  jobId: string;
  jobName: string;
  ownerUserId: number | null;
  owner?: CronJobOwner;
  lifecycle: 'recurring' | 'oneShot';
  schedule: string | null;
  trigger: 'schedule' | 'catchUp' | 'manual';
  localDate: string;
  localTime: string;
  timezone: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  outcome: CronRunOutcome;
  skipReason?: string;
  errorMessage?: string;
  preview?: string;
  previewTruncated: boolean;
  sessionId?: string;
  messageId?: string;
  delivered: boolean;
  model?: string;
  tokensTotal?: number;
  costUsd?: number;
}

export interface CronRunsResponse {
  runs: CronRunRow[];
  total: number;
  nextCursor?: string;
}

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

/** One picker row as the conversation/channel/model fields narrow it. */
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

/** The host `Modal`, `ModalBody` and `ModalFooter` as the host really declares them. Typed rather
 *  than left as "any component" for one reason: the host Modal is MOUNTED WHEN OPEN — it has no
 *  `open` prop and no `onOpenChange`. A call site that passed one would render a permanently open
 *  dialog while looking perfectly reasonable, which is exactly the failure this narrowing prevents.
 *  Dismissal is blocked with `closeDisabled`, never by withholding `onClose`. */
interface ModalProps {
  title: string;
  onClose(): void;
  children: ReactNode;
  size?: 'lg' | 'xl' | 'md' | 'sm';
  presentation?: 'auto' | 'center' | 'drawer' | 'sheet' | 'fullscreen';
  intent?: 'edit' | 'inspect';
  /** Blocks header, Escape and backdrop dismissal while an owned async submit is in flight. */
  closeDisabled?: boolean;
  closeLabel?: string;
  description?: string;
  'data-testid'?: string;
}
interface ModalBodyProps { children: ReactNode; gap?: 4 | 5 | 6 }
interface ModalFooterProps { children?: ReactNode; status?: ReactNode }

/** The react-day-picker v9 props this bundle drives. The board uses the host Calendar as a DATE
 *  PICKER and nothing more — one `Other day` chooser — so no day cell is ever overridden and the
 *  library's own keyboard model, focus handling and day rendering stay entirely the host's. */
interface CalendarProps {
  mode?: 'single' | 'multiple' | 'range';
  /** A browser-local Date built at LOCAL midnight from a server local-date label — see `parseDate`. */
  selected?: Date;
  onSelect?: (day: Date | undefined) => void;
  month?: Date;
  onMonthChange?: (month: Date) => void;
  showOutsideDays?: boolean;
  className?: string;
  'aria-label'?: string;
}

// ---- hook shapes --------------------------------------------------------------------------------

interface QueryResult<T> { data?: T; error?: unknown; isLoading: boolean; isError: boolean; refetch(): void }
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
  useMutation<TVars>(options: Record<string, unknown>): MutationResult<TVars>;
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
  Badge: AnyComponent; Button: AnyComponent; IconButton: AnyComponent; Input: AnyComponent; Textarea: AnyComponent; Field: AnyComponent; Toggle: AnyComponent;
  HelpTip: AnyComponent;
  ConfirmDialog: AnyComponent; AutoSaveStatus: ComponentType<AutoSaveStatusProps>; LoadingState: AnyComponent; ErrorState: AnyComponent;
  ManageSelectionModal: ComponentType<ManageSelectionModalProps>; SelectionSummary: ComponentType<SelectionSummaryProps>; BrainModelField: AnyComponent;
  EmptyState: AnyComponent; Segmented: AnyComponent; ChoiceField: AnyComponent;
  /** The one filter picker of the app's canonical toolbar: a flat option list, its neutral entry first,
   *  one glyph per option. Typed rather than `AnyComponent` because a filter that forgets its `label`
   *  loses the accessible name the panel's field shell no longer supplies for it. */
  SelectMenu: ComponentType<{
    value: string;
    onChange(value: string): void;
    options: { value: string; label: string; icon?: ReactNode }[];
    label: string;
    variant?: 'default' | 'line';
    className?: string;
  }>;
  EntityList: AnyComponent; EntityRow: AnyComponent;
  /** The register's own chrome: the bordered document the history tab sits on, the padded register that
   *  holds its table, and the state block a load or a failure stands in with. Published as one set
   *  because a table that takes the register without the document around it is the look that made this
   *  page's table read as a bare grid on the page background. */
  ControlSurfaceDocument: AnyComponent; ControlSurfaceRegister: AnyComponent; ControlSurfaceState: AnyComponent;
  DataTable: AnyComponent; DataTableRow: AnyComponent; DataTableCell: AnyComponent; DataTableChevronCell: AnyComponent;
  RegisterSearch: AnyComponent; Pager: AnyComponent; ActionMenu: AnyComponent;
  Modal: ComponentType<ModalProps>; ModalBody: ComponentType<ModalBodyProps>; ModalFooter: ComponentType<ModalFooterProps>;
  PluginSection: AnyComponent;
  ModuleHeader: AnyComponent; WorkspaceShell: AnyComponent; WorkspacePage: AnyComponent; WorkspaceHero: AnyComponent;
  PageToolbar: AnyComponent; PageFilters: AnyComponent;
  Calendar: ComponentType<CalendarProps>;
  WorkspaceDetailRail: AnyComponent;
  SettingsGroup: AnyComponent;
}
/** Every key of the interface above has to be a component the host really publishes. The runtime
 *  hands over an object, not a type, so a name invented here compiles and then reaches React as
 *  `undefined` at render time; `AssertPublished` turns that into an error in this repository. */
type PublishedNames = AssertPublished<keyof CronComponents>;

interface CronRuntime {
  components: Pick<CronComponents, PublishedNames>;
  hooks: CronHooks;
  utils: CronUtils;
  api(path: string, init?: RequestInit): Promise<unknown>;
}

type CronRegistration = Pick<PluginUiRegistration, 'requiresApiVersion' | 'settings' | 'ownsPageFrame'> & {
  dashboardMetrics?: Record<string, ComponentType<DashboardMetricProps>>;
  historyBranches?: Record<string, ComponentType<PluginHistoryBranchProps>>;
};

/** The host runtime, narrowed. The settings deck loads the bundle only after installing the runtime,
 *  so a missing global here is a programming error worth throwing on. */
export function runtime(): CronRuntime {
  const rt = window.ElowenUiRuntime as unknown as CronRuntime | undefined;
  if (!rt) throw new Error('ElowenUiRuntime is not installed');
  return rt;
}

/** The API answers a refusal with a structured body (`error`, `code`, `conflict`, `current`).
 *
 *  WHERE THAT BODY LIVES matters: the host rejects with an `ElowenApiError` whose `code` is the
 *  daemon's HUMAN `error` line (that is what `utils.apiErrorMessage` renders) and whose `details` is
 *  the parsed body. The machine-readable `code`/`conflict`/`current` are therefore inside `details`,
 *  and reading them off the error itself finds the human sentence instead — every branch that
 *  compares against `revision_conflict` or `run_already_queued` would simply never be taken.
 *
 *  The plain-body form is still accepted, because a caller may hand these a decoded body directly. */
const errorBody = (error: unknown): Record<string, unknown> | undefined => {
  if (typeof error !== 'object' || error === null) return undefined;
  const details = (error as { details?: unknown }).details;
  if (details && typeof details === 'object' && !Array.isArray(details)) return details as Record<string, unknown>;
  return error as Record<string, unknown>;
};
export const apiErrorCode = (error: unknown): string | undefined => {
  const code = errorBody(error)?.code;
  return typeof code === 'string' ? code : undefined;
};
export const apiErrorConflict = (error: unknown): boolean => !!errorBody(error)?.conflict;
export const apiErrorCurrent = (error: unknown): CronJob | undefined => {
  const current = errorBody(error)?.current;
  return current && typeof current === 'object' && typeof (current as CronJob).id === 'string' ? current as CronJob : undefined;
};

/** The YYYY-MM-DD label a Date carries, read on the BROWSER's own fields.
 *
 *  Its counterpart is `parseDate` in CalendarPage, which builds the Date at LOCAL midnight. The pair
 *  has to agree on which fields it uses: a Date built at UTC midnight and read back through local
 *  getters lands on the previous day everywhere west of UTC. react-day-picker is local-time too, so
 *  local construction plus local reading is the one consistent pair.
 *
 *  These labels only drive the month grid. Every label that MEANS something — an occurrence's day,
 *  the window a query asks for, the scheduler's own today — is derived by the server in the
 *  scheduler's timezone and travels as a string. */
export const localDateLabel = (day: Date): string =>
  `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;

/** Register this plugin's settings components on the host (no-op outside the plugin-UI host page). */
export function registerCronUi(registration: CronRegistration): void {
  window.__elowenRegisterPluginUi?.('cronjob', registration);
}
