/** Typed access to the host's window.ElowenUiRuntime for the cronjob plugin bundle.
 *
 *  The runtime hands over untyped `components`/`hooks`/`utils` records; this module narrows each
 *  entry to the signature the moved jobs editor was written against in the core app. The narrowing
 *  is a local structural CONTRACT, not a source import — the bundle must not compile against `web/`
 *  (it builds standalone via elowen-plugin-ui-kit).
 */
import type { ComponentType, ReactNode } from 'react';
import type { PluginUiRegistration } from 'elowen-plugin-ui-kit';
import type { AutoSaveStatusProps, UseAutoSaveStatus } from '../../autoSaveContract';

// ---- data shapes (structural mirrors of the daemon's wire types) --------------------------------

interface CronJobOwner {
  id: number;
  username: string;
  name: string;
  avatar: string;
}

export interface CronJob {
  id: string; name: string; schedule: string; prompt: string;
  check?: string; hours?: string; notifyChannelId?: string; plain?: boolean;
  model?: { provider: string; model: string };
  /** The account this job belongs to; absent/null = an instance job (admin-created, admin-powered). */
  ownerUserId?: number | null;
  /** Read-only display projection supplied by GET; never persisted or returned in PUT payloads. */
  owner?: CronJobOwner;
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
  icon?: ReactNode; badges?: { text: string }[];
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
  ManageSelectionModal: AnyComponent; SelectionSummary: AnyComponent; BrainModelField: AnyComponent;
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
