import type { ChangeEvent, ComponentType } from 'react';
import type { DateRange, DayUsage, ModelUsage, ResetUsageResult, UsageByOriginResult, UsageOriginGroup, UsageSummary } from './types';

interface QueryResult<T> {
  data?: T;
  isLoading: boolean;
  isError: boolean;
  refetch(): unknown;
}

interface MutationResult<TVars, TData> {
  mutate(vars: TVars, callbacks?: { onSuccess?: (data: TData) => void; onError?: (error: unknown) => void }): void;
  isPending: boolean;
}

type AnyComponent = ComponentType<any>;
type InputComponent = ComponentType<Record<string, unknown> & { onChange?(event: ChangeEvent<HTMLInputElement>): void }>;
type SegmentedComponent = ComponentType<Record<string, unknown> & { onChange?(value: string): void }>;
type DateRangeComponent = ComponentType<Record<string, unknown> & { onChange?(range: DateRange): void }>;

interface StatsRuntime {
  components: {
    Button: AnyComponent;
    ControlSurfaceDocument: AnyComponent;
    ControlSurfaceRegister: AnyComponent;
    ControlSurfaceState: AnyComponent;
    ControlSurfaceToolbar: AnyComponent;
    DataTable: AnyComponent;
    DataTableCell: AnyComponent;
    DataTableChevronCell: AnyComponent;
    DataTableRow: AnyComponent;
    DateRangeFilter: DateRangeComponent;
    EmptyState: AnyComponent;
    ErrorState: AnyComponent;
    HelpTip: AnyComponent;
    Input: InputComponent;
    LoadingState: AnyComponent;
    Modal: AnyComponent;
    ModalBody: AnyComponent;
    ModalFooter: AnyComponent;
    ModelIcon: AnyComponent;
    ModuleHeader: AnyComponent;
    /** The one pager of the app. It derives the page count and the range text itself and reads its
     *  labels from the host `pagination` namespace, so this bundle ships none of that copy. */
    Pager: ComponentType<{
      /** Zero-based. */
      page: number;
      pageSize: number;
      total: number;
      onPageChange(page: number): void;
      ariaLabel?: string;
      className?: string;
    }>;
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
    Segmented: SegmentedComponent;
    /** The host's real chart: ticks, cursor tooltip and one axis per unit. Recharts lives in the
     *  app and loads lazily there, so this bundle never carries a charting library. */
    TimeSeriesChart: ComponentType<{
      data: { label: string; [key: string]: string | number | null }[];
      series: { key: string; label: string; colour: string; variant?: 'bar' | 'line'; axis?: 'left' | 'right'; format: (value: number) => string }[];
      height?: number;
      emptyText?: string;
      ariaLabel?: string;
    }>;
    WorkspaceDetailRail: AnyComponent;
    WorkspaceMetric: AnyComponent;
    WorkspaceShell: AnyComponent;
  };
  hooks: {
    useMe(): QueryResult<{ user?: { id: number; username: string; is_admin: boolean } }>;
    useModelUsage(window?: { fromMs: number; toMs: number }): QueryResult<ModelUsage[]>;
    useUsageByDay(days?: number): QueryResult<DayUsage[]>;
    /** ADMIN-ONLY on the server: a non-admin caller gets 403 by design. `enabled` keeps a normal
     *  account from firing a request that is meant to fail; it is not the access control. */
    useUsageByOrigin(
      group?: UsageOriginGroup,
      window?: { fromMs: number; toMs: number },
      opts?: { enabled?: boolean; limit?: number },
    ): QueryResult<UsageByOriginResult>;
    usePersistentState<T extends string>(key: string, initial: T, allowed: readonly T[] | ((raw: string) => boolean)): [T, (value: T) => void];
    usePluginStrings(plugin: string): Record<string, string>;
    useResetUsage(): MutationResult<void, ResetUsageResult>;
    useToast(): { toast(message: string, tone?: 'ok' | 'error'): void };
    useTranslation(): { t: Record<string, any>; locale: string };
  };
  utils: {
    buildUsageSummary(data: ModelUsage[] | undefined): UsageSummary;
    DEFAULT_RANGE: DateRange;
    isStoredRange(raw: string): boolean;
    parseRange(raw: string): DateRange | null;
    rangeBounds(range: DateRange, now: number): { fromMs: number; toMs: number };
    serializeRange(range: DateRange): string;
  };
}

type PluginPage = ComponentType<{ plugin: string; params: Record<string, string>; rest: string[]; surface: 'page' | 'deck' }>;
interface HostWindow {
  ElowenUiRuntime?: unknown;
  __elowenRegisterPluginUi?: (plugin: string, registration: { requiresApiVersion: number; pages: Record<string, PluginPage> }) => void;
}

export function runtime(): StatsRuntime {
  const value = (window as HostWindow).ElowenUiRuntime as StatsRuntime | undefined;
  if (!value) throw new Error('ElowenUiRuntime is not installed');
  return value;
}

export function registerStatsUi(pages: Record<string, PluginPage>): void {
  (window as HostWindow).__elowenRegisterPluginUi?.('stats', { requiresApiVersion: 11, pages });
}
