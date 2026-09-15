/** Typed access to the host's window.ElowenUiRuntime for the cronjob plugin bundle.
 *
 *  The runtime hands over untyped `components`/`hooks`/`utils` records; this module narrows each
 *  entry to the signature the calendar workbench was written against in the core app. The narrowing
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

/** ONE job's whole day, as the board draws it — never one entry per run.
 *
 *  `remaining` is the server's exact count of runs the job still has on this date, so a row can say
 *  "720 runs left today" without anything having built 720 of anything. `moreTimes` names the few
 *  further wall clocks of a job with several fixed times; `truncated` means the server's per-job slot
 *  cap stopped the walk, so `remaining` is a floor rather than the total. */
export interface CronDayRow {
  jobId: string;
  /** Where the row is read: `next` = a fixed time still ahead today, `recurring` = a rate or a status
   *  (paused, or nothing left today), `oneShot` = a single pending wake-up. */
  section: 'next' | 'recurring' | 'oneShot';
  kind: 'interval' | 'daily' | 'weekly' | 'cron' | 'oneShot' | null;
  /** The stored schedule string; null for a one-shot, which has no recurrence to name. */
  schedule: string | null;
  enabled: boolean;
  remaining: number;
  next: CronDayNext | null;
  moreTimes: string[];
  truncated: boolean;
}

/** Why an instant is what it is: on time, deferred by active hours, a replayed miss, due now, or late. */
export type CronDisposition = 'onTime' | 'deferredByHours' | 'catchUp' | 'dueNow' | 'late';

interface CronDayNext {
  occurrenceId: string;
  scheduledAt: string;
  expectedAt: string;
  /** The wall clock in the SCHEDULER's timezone, never the browser's. */
  localTime: string;
  disposition: CronDisposition;
  guarded: boolean;
}

/** GET /plugins/cronjob/api/day — one local date, one row per visible job, bounded by construction. */
export interface CronDayResponse {
  generatedAt: string;
  /** The scheduler's own today, in its own timezone — the browser never derives it. */
  todayLocalDate: string;
  /** The scheduler's own wall clock right now (`HH:mm`), so the day rail can place its "now" line
   *  without the browser re-deriving the time in a timezone that is not its own. */
  nowLocalTime: string;
  /** The date this board describes; equal to `todayLocalDate` on the initial, parameterless load. */
  localDate: string;
  timezone: string;
  precisionMs: number;
  scheduler: { ready: boolean; runningJobId?: string; runningSince?: string };
  jobs: CronJob[];
  rows: CronDayRow[];
  /** Some row's per-job slot cap was reached; its count is a floor. */
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
  Badge: AnyComponent; Button: AnyComponent; Input: AnyComponent; Field: AnyComponent; Toggle: AnyComponent;
  HelpTip: AnyComponent;
  ConfirmDialog: AnyComponent; AutoSaveStatus: ComponentType<AutoSaveStatusProps>; LoadingState: AnyComponent; ErrorState: AnyComponent;
  ManageSelectionModal: ComponentType<ManageSelectionModalProps>; SelectionSummary: ComponentType<SelectionSummaryProps>; BrainModelField: AnyComponent;
  EmptyState: AnyComponent; Segmented: AnyComponent; ChoiceField: AnyComponent;
  /** The host's own grouped-row surface — its rounded, divided container and one row inside it. The
   *  Recurring lane is built from these rather than from a hand-rolled card, because the host
   *  publishes no Card primitive and a bundle drawing its own would stop matching every other list. */
  EntityList: AnyComponent; EntityRow: AnyComponent;
  Modal: ComponentType<ModalProps>; ModalBody: ComponentType<ModalBodyProps>; ModalFooter: ComponentType<ModalFooterProps>;
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
