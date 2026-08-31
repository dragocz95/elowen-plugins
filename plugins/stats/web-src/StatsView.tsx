import { useMemo, useState, type ReactNode } from 'react';
import { BarChart3, Database, DollarSign, Gauge, MapPin, Search, Trash2 } from 'lucide-react';
import { PieChart } from './components/PieChart';
import { UsageTrend } from './components/UsageTrend';
import { ResetUsageModal } from './ResetUsageModal';
import { OriginDrawer } from './OriginDrawer';
import { integer } from './format';
import { runtime, type PageFilterField } from './runtime';
import type { DayUsage, ModelUsage, TokenUsage } from './types';

const PAGE_SIZE = 20;
const DAY_MS = 86_400_000;

const {
  Button, ControlSurfaceDocument, ControlSurfaceRegister, ControlSurfaceState,
  DataTable, DataTableCell, DataTableChevronCell, DataTableRow, DateRangeFilter, EmptyState, ErrorState,
  LoadingState, ModelIcon, ModuleHeader, Pager, RegisterSearch, Segmented, WorkspaceDetailRail,
  WorkspaceMetric, WorkspaceShell,
} = runtime().components;
const { useMe, useModelUsage, usePersistentState, usePluginStrings, useTranslation, useUsageByDay } = runtime().hooks;
const { buildUsageSummary, DEFAULT_RANGE, isStoredRange, parseRange, rangeBounds, serializeRange } = runtime().utils;

type UsageFilter = 'all' | 'costed' | 'cached';

/** The page owns whether an opaque filter control is narrowing results; the host owns its panel and chip. */
const pageFilterField = (
  base: { id: string; label: string; control: ReactNode; hint?: string },
  active: boolean,
  activeLabel: string,
  onReset: () => void,
): PageFilterField => active ? { ...base, active: true, activeLabel, onReset } : { ...base, active: false };

/** The pie's datum id IS the exec string, which is what ModelIcon resolves its brand mark from. */
const renderModelIcon = (datum: { id: string }) => <ModelIcon name={datum.id} size={20} />;

const utcDayStart = (timestamp: number): number => {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
};
const dayKey = (timestamp: number): string => new Date(timestamp).toISOString().slice(0, 10);
const localDayOrdinal = (timestamp: number): number => {
  const date = new Date(timestamp);
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
};

export function trendDaysForWindow(window: { fromMs: number; toMs: number }, now: number): number {
  if (!Number.isFinite(window.fromMs)) return 90;
  const elapsedDays = Math.floor((localDayOrdinal(now) - localDayOrdinal(window.fromMs)) / DAY_MS);
  return Math.max(1, Math.min(90, elapsedDays + 1));
}

export function isTrendWindowUnavailable(window: { fromMs: number; toMs: number }, days: number, now: number): boolean {
  if (!Number.isFinite(window.toMs)) return false;
  const availableFrom = utcDayStart(now) - (days - 1) * DAY_MS;
  return utcDayStart(window.toMs) < availableFrom;
}

export function padDailyUsage(rows: DayUsage[], days: number, window: { fromMs: number; toMs: number }, now: number): DayUsage[] {
  const today = utcDayStart(now);
  const availableFrom = today - (days - 1) * DAY_MS;
  const from = Number.isFinite(window.fromMs) ? Math.max(availableFrom, utcDayStart(window.fromMs)) : availableFrom;
  const to = Number.isFinite(window.toMs) ? Math.min(today, utcDayStart(window.toMs)) : today;
  if (to < from) return [];
  const byDay = new Map(rows.map((row) => [row.day, row]));
  const padded: DayUsage[] = [];
  for (let timestamp = from; timestamp <= to; timestamp += DAY_MS) {
    const day = dayKey(timestamp);
    padded.push(byDay.get(day) ?? { day, tokens: 0, cost: 0 });
  }
  return padded;
}

const percent = (value: number | null) => value == null ? '—' : `${value.toFixed(1)}%`;
const cacheTokens = (usage: TokenUsage) => usage.cacheRead + usage.cacheWrite;

function ModelDetail({ model, locale, strings }: { model: ModelUsage; locale: string; strings: Record<string, string> }) {
  const usage = model.usage;
  const cacheBase = usage.input + usage.cacheRead;
  const cacheRate = cacheBase > 0 ? (usage.cacheRead / cacheBase) * 100 : null;
  const costSource = usage.costSource === 'provider_reported'
    ? strings.detailCostProviderReported
    : usage.costSource === 'calculated'
      ? strings.detailCostCalculated
      : strings.detailCostUnavailable;
  const rows = [
    [strings.detailInput, integer(usage.input, locale)],
    [strings.detailOutput, integer(usage.output, locale)],
    [strings.detailCacheRead, integer(usage.cacheRead, locale)],
    [strings.detailCacheWrite, integer(usage.cacheWrite, locale)],
    [strings.detailCacheRate, percent(cacheRate)],
    [strings.detailCostSource, costSource],
  ];
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex min-w-0 items-center gap-3">
        <ModelIcon name={model.exec} size={24} />
        <h2 className="truncate font-mono text-sm text-foreground" title={model.exec}>{model.exec}</h2>
      </div>
      <dl className="flex flex-col divide-y divide-border/70">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-4 py-3 text-sm">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="truncate font-mono tabular-nums text-foreground" title={value}>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function StatsView() {
  const s = usePluginStrings('stats');
  const { t, locale } = useTranslation();
  const [rangeRaw, setRangeRaw] = usePersistentState('elowen.stats.range', serializeRange(DEFAULT_RANGE), isStoredRange);
  const { range, now } = useMemo(() => ({
    range: parseRange(rangeRaw) ?? DEFAULT_RANGE,
    now: Date.now(),
  }), [rangeRaw]);
  const window = useMemo(() => rangeBounds(range, now), [range, now]);
  const trendDays = useMemo(() => trendDaysForWindow(window, now), [window, now]);
  const usage = useModelUsage(window);
  const daily = useUsageByDay(trendDays);
  const me = useMe();
  const summary = buildUsageSummary(usage.data);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<UsageFilter>('all');
  const [page, setPage] = useState(0);
  const [selectedExec, setSelectedExec] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [originOpen, setOriginOpen] = useState(false);

  const hasError = usage.isError || daily.isError;
  const isLoading = usage.isLoading || daily.isLoading || !usage.data || !daily.data;
  const modelByExec = useMemo(() => new Map((usage.data ?? []).map((model) => [model.exec, model])), [usage.data]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return summary.rows.filter((row) => {
      const model = modelByExec.get(row.exec);
      if (needle && !row.exec.toLocaleLowerCase().includes(needle)) return false;
      if (filter === 'costed' && row.costUsd == null) return false;
      if (filter === 'cached' && (!model || cacheTokens(model.usage) === 0)) return false;
      return true;
    });
  }, [filter, modelByExec, query, summary.rows]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const clampedPage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(clampedPage * PAGE_SIZE, (clampedPage + 1) * PAGE_SIZE);
  const selected = selectedExec ? modelByExec.get(selectedExec) ?? null : null;
  const trendUnavailable = isTrendWindowUnavailable(window, trendDays, now);
  // The window the whole page is already filtered by, rendered once for the origin drawer's framing —
  // an open-ended preset has no start, and saying so beats printing an invalid date.
  const rangeSummary = useMemo(() => {
    const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    const from = Number.isFinite(window.fromMs) ? day(window.fromMs) : s.originRangeOpen;
    const to = Number.isFinite(window.toMs) ? day(window.toMs) : s.originRangeNow;
    return `${from} – ${to}`;
  }, [window, s.originRangeOpen, s.originRangeNow]);
  const trend = useMemo(() => padDailyUsage(daily.data ?? [], trendDays, window, now), [daily.data, now, trendDays, window]);
  const rowByExec = useMemo(() => new Map(summary.rows.map((row) => [row.exec, row])), [summary.rows]);
  const pieTokens = (usage.data ?? []).map((model) => ({
    id: model.exec,
    label: model.exec,
    value: model.usage.total,
    valueLabel: rowByExec.get(model.exec)?.tokensLabel ?? integer(model.usage.total, locale),
  }));
  const pieCosts = (usage.data ?? []).filter((model) => model.usage.costUsd != null).map((model) => ({
    id: model.exec,
    label: model.exec,
    value: model.usage.costUsd ?? 0,
    valueLabel: rowByExec.get(model.exec)?.costLabel ?? '—',
  }));

  const resetPage = () => setPage(0);
  const changeRange = (next: typeof range) => { setRangeRaw(serializeRange(next)); resetPage(); };
  const changeUsageFilter = (next: UsageFilter) => { setFilter(next); resetPage(); };
  const usageLabels: Record<UsageFilter, string> = {
    all: s.filterAll,
    costed: s.filterCosted,
    cached: s.filterCached,
  };
  const rangeLabels: Record<string, string> = {
    today: t.common.rangeToday,
    '7d': t.common.rangeLast7,
    '30d': t.common.rangeLast30,
    '90d': t.common.rangeLast90,
    all: t.common.rangeAll,
    custom: t.common.rangeCustom,
  };
  const rangeLabel = range.preset === 'custom'
    ? `${range.from ?? '…'} – ${range.to ?? '…'}`
    : rangeLabels[range.preset] ?? range.preset;
  const filterFields: PageFilterField[] = [
    pageFilterField(
      { id: 'range', label: t.common.rangeLabel, control: <DateRangeFilter value={range} onChange={changeRange} /> },
      serializeRange(range) !== serializeRange(DEFAULT_RANGE),
      `${t.common.rangeLabel}: ${rangeLabel}`,
      () => changeRange(DEFAULT_RANGE),
    ),
    pageFilterField(
      {
        id: 'usage',
        label: s.filterLabel,
        control: (
          <Segmented
            aria-label={s.filterLabel}
            value={filter}
            onChange={(value: string) => changeUsageFilter(value as UsageFilter)}
            options={[
              { value: 'all', label: s.filterAll },
              { value: 'costed', label: s.filterCosted },
              { value: 'cached', label: s.filterCached },
            ]}
          />
        ),
      },
      filter !== 'all',
      `${s.filterLabel}: ${usageLabels[filter]}`,
      () => changeUsageFilter('all'),
    ),
  ];
  const retry = () => { usage.refetch(); daily.refetch(); };

  return (
    <>
      <ModuleHeader title={s.title} count={summary.modelsUsed} icon={BarChart3} />
      <WorkspaceShell variant="register" hero={{
        eyebrow: s.workspaceEyebrow,
        title: s.title,
        count: summary.modelsUsed,
        description: s.workspaceIntro,
        mascot: hasError ? 'error' : isLoading ? 'saving' : 'idle',
        status: !hasError && !isLoading ? <span className="workspace-status">{s.workspaceReady}</span> : undefined,
        // Admin-only affordances. The origin view's real gate is the daemon route (403 for anyone
        // else); hiding the button is presentation, not access control.
        action: me.data?.user?.is_admin
          ? <>
              <Button variant="ghost" icon={MapPin} onClick={() => setOriginOpen(true)}>{s.originAction}</Button>
              {summary.hasAnyUsage
                ? <Button variant="ghost-danger" icon={Trash2} onClick={() => setResetOpen(true)}>{s.reset}</Button>
                : null}
            </>
          : undefined,
        metrics: <>
          <WorkspaceMetric label={s.metricTokens} value={summary.totalTokensLabel} icon={BarChart3} />
          <WorkspaceMetric label={s.metricCost} value={summary.totalCostLabel} icon={DollarSign} />
          <WorkspaceMetric label={s.metricCache} value={summary.totalCacheLabel} icon={Database} />
          <WorkspaceMetric label={s.metricSpeed} value={summary.avgSpeedLabel} icon={Gauge} />
        </>,
      }} toolbar={{
        search: (
          <RegisterSearch
            value={query}
            onChange={(value: string) => { setQuery(value); resetPage(); }}
            placeholder={s.searchPlaceholder}
            label={s.searchPlaceholder}
            onClear={() => { setQuery(''); resetPage(); }}
            clearLabel={s.searchClear}
            count={hasError || isLoading ? undefined : filtered.length}
            countLabel={hasError || isLoading ? undefined : s.searchCount.replace('{count}', String(filtered.length))}
          />
        ),
        filters: filterFields,
      }}>
        <ControlSurfaceDocument>
          {hasError ? (
            <ControlSurfaceState tone="danger"><ErrorState message={t.common.daemonUnreachable} onRetry={retry} /></ControlSurfaceState>
          ) : isLoading ? (
            <ControlSurfaceState><LoadingState variant="cards" /></ControlSurfaceState>
          ) : (
            <div className="workspace-master-detail" data-detail={originOpen || selected != null}>
              <div className="flex min-w-0 flex-col gap-4">
                <ControlSurfaceRegister className="flex flex-col gap-5">
                  {!summary.hasAnyUsage ? (
                    <EmptyState title={s.emptyTitle} description={s.emptyDescription} icon={BarChart3} />
                  ) : (
                    <>
                      <div className="grid gap-4 xl:grid-cols-2">
                        <section className="rounded-lg border border-border bg-card p-4 text-card-foreground">
                          <h2 className="text-sm font-semibold text-foreground">{s.tokensByModel}</h2>
                          <p className="mb-4 text-xs text-muted-foreground">{s.tokensByModelHint}</p>
                          <PieChart title={s.tokensByModel} data={pieTokens} emptyText={s.noChartData} renderIcon={renderModelIcon} />
                        </section>
                        <section className="rounded-lg border border-border bg-card p-4 text-card-foreground">
                          <h2 className="text-sm font-semibold text-foreground">{s.costByModel}</h2>
                          <p className="mb-4 text-xs text-muted-foreground">{s.costByModelHint}</p>
                          <PieChart title={s.costByModel} data={pieCosts} emptyText={s.noChartData} renderIcon={renderModelIcon} />
                        </section>
                      </div>

                      <section className="rounded-lg border border-border bg-card p-4 text-card-foreground">
                        <h2 className="text-sm font-semibold text-foreground">{s.trendTitle}</h2>
                        <p className="mb-4 text-xs text-muted-foreground">{s.trendHint}</p>
                        <UsageTrend data={trend} locale={locale} tokenLabel={s.trendTokens} costLabel={s.trendCost} emptyText={trendUnavailable ? s.trendUnavailable : s.noChartData} />
                      </section>

                      <div className="flex min-w-0 flex-col gap-3">
                        <h2 className="text-sm font-semibold text-foreground">{s.tableTitle}</h2>
                        {filtered.length === 0 ? (
                          <EmptyState title={s.emptySearch} icon={Search} />
                        ) : (
                          /* The compact template keeps three tracks: the model name, the cost and the
                             chevron. The provider glyph and the wide 7rem cost track are both dropped,
                             because at 320px the row has ~194px to spend and the previous four-track
                             compact template asked for 200px of fixed tracks and gaps — the `1fr` name
                             column resolved to 0px and the row lost the value that identifies it. Cost
                             keeps a narrower compact track and still truncates with the full value on
                             `title`. */
                          <DataTable ariaLabel={s.tableTitle} columns="2rem minmax(0,1fr) 8rem 8rem 7rem 7rem 1.25rem" compactColumns="minmax(0,1fr) 4.5rem 1.25rem">
                            <DataTableRow header>
                              <DataTableCell header lines={1} priority="wide" role="presentation" aria-hidden>{null}</DataTableCell>
                              <DataTableCell header lines={1}>{s.columnModel}</DataTableCell>
                              <DataTableCell header lines={1} priority="wide" className="text-right">{s.columnTokens}</DataTableCell>
                              <DataTableCell header lines={1} className="text-right">{s.columnCost}</DataTableCell>
                              <DataTableCell header lines={1} priority="wide" className="text-right">{s.columnCache}</DataTableCell>
                              <DataTableCell header lines={1} priority="wide" className="text-right">{s.columnSpeed}</DataTableCell>
                              <DataTableCell header lines={1} role="presentation" aria-hidden>{null}</DataTableCell>
                            </DataTableRow>
                            <div role="rowgroup">
                              {pageRows.map((row) => (
                                <DataTableRow
                                  key={row.exec}
                                  data-testid="model-usage-row"
                                  selected={selectedExec === row.exec}
                                  onOpen={() => setSelectedExec(row.exec)}
                                  openLabel={`${s.detailTitle}: ${row.exec}`}
                                >
                                  {/* The provider glyph restates the model name in the very next cell, so
                                      it is decoration — and its header is presentational for that reason.
                                      Both halves have to be hidden together: an exposed body cell under a
                                      presentational header left every row one column longer than the
                                      header row, which is what makes a screen reader read the remaining
                                      columns against the wrong names. Being decoration is also why it is
                                      `wide`: at 320px its 2rem track was width the model name needed. */}
                                  <DataTableCell lines="auto" priority="wide" aria-hidden className="flex items-center gap-1.5 text-muted-foreground"><ModelIcon name={row.exec} size={12} /></DataTableCell>
                                  <DataTableCell lines={1} className="font-mono text-xs text-foreground">{row.exec}</DataTableCell>
                                  <DataTableCell lines={1} priority="wide" className="text-right font-mono text-xs tabular-nums text-muted-foreground">{row.tokensLabel}</DataTableCell>
                                  <DataTableCell lines={1} className="text-right font-mono text-xs tabular-nums text-foreground">{row.costLabel}</DataTableCell>
                                  <DataTableCell lines={1} priority="wide" className="text-right font-mono text-xs tabular-nums text-muted-foreground">{percent(row.cacheHitPct)}</DataTableCell>
                                  <DataTableCell lines={1} priority="wide" className="text-right font-mono text-xs tabular-nums text-muted-foreground">{row.speedLabel}</DataTableCell>
                                  <DataTableChevronCell />
                                </DataTableRow>
                              ))}
                            </div>
                          </DataTable>
                        )}

                        {filtered.length > 0 ? (
                          <Pager page={clampedPage} pageSize={PAGE_SIZE} total={filtered.length} onPageChange={setPage} ariaLabel={s.tableTitle} />
                        ) : null}
                      </div>
                    </>
                  )}
                </ControlSurfaceRegister>
              </div>
              {/* One rail at a time: the origin view answers a different question and takes precedence
                  while it is open, rather than fighting the model detail for the same slot. */}
              {originOpen ? (
                <OriginDrawer
                  isAdmin={me.data?.user?.is_admin === true}
                  window={window}
                  rangeLabel={s.originRange.replace('{range}', rangeSummary)}
                  locale={locale}
                  strings={s}
                  closeLabel={t.common.close}
                  unreachableLabel={t.common.daemonUnreachable}
                  onClose={() => setOriginOpen(false)}
                />
              ) : selected ? (
                <WorkspaceDetailRail label={`${s.detailTitle}: ${selected.exec}`} closeLabel={t.common.close} onClose={() => setSelectedExec(null)}>
                  <ModelDetail model={selected} locale={locale} strings={s} />
                </WorkspaceDetailRail>
              ) : null}
            </div>
          )}
        </ControlSurfaceDocument>
      </WorkspaceShell>
      {resetOpen ? <ResetUsageModal onClose={() => setResetOpen(false)} /> : null}
    </>
  );
}
