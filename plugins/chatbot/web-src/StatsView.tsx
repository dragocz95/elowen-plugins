import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { knownCost } from '../src/budget';
import { Activity, Coins } from 'lucide-react';
import { apiJson, chatbotApi, runtime, type DateRange, type PageFilterField } from './runtime';
import { BotPicker } from './BotPicker';
import { useChatbots } from './useChatbots';
import { formatDay, integer, money } from './format';
import type { ChatbotStatsAnswer, ChatbotStatsDayView } from './types';

const STATS_MAX_DAYS = 366;
const PAGE_SIZE = 20;
const DAY_MS = 86_400_000;
const SERIES_COLOURS = { turns: 'var(--color-chart-1)', cost: 'var(--color-chart-3)' } as const;

const dayStart = (timestamp: number): number => {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
};
const dayKey = (timestamp: number): string => new Date(timestamp).toISOString().slice(0, 10);

export function statsWindow(range: DateRange, now: number, bounds: { fromMs: number; toMs: number }): {
  from: string;
  to: string;
  fromMs: number;
  toMs: number;
} {
  const today = dayStart(now);
  const toMs = Math.min(Number.isFinite(bounds.toMs) ? dayStart(bounds.toMs) : today, today);
  const earliest = toMs - (STATS_MAX_DAYS - 1) * DAY_MS;
  const requestedFrom = Number.isFinite(bounds.fromMs) ? dayStart(bounds.fromMs) : earliest;
  const fromMs = Math.min(toMs, Math.max(requestedFrom, earliest));
  return { from: dayKey(fromMs), to: dayKey(toMs), fromMs, toMs: toMs + DAY_MS - 1 };
}

export function chartPoints(days: readonly ChatbotStatsDayView[], spend: ChatbotStatsAnswer['spend'], from: string, to: string): {
  label: string;
  turns: number;
  done: number;
  errors: number;
  cost: number | null;
}[] {
  const byDay = new Map(days.map((day) => [day.day, day]));
  const costs = new Map(spend.map(({ day, usage }) => [day, knownCost(usage)]));
  const points: { label: string; turns: number; done: number; errors: number; cost: number | null }[] = [];
  const end = Date.parse(`${to}T00:00:00.000Z`);
  for (let at = Date.parse(`${from}T00:00:00.000Z`); at <= end; at += DAY_MS) {
    const day = dayKey(at);
    const row = byDay.get(day);
    points.push({ label: day, turns: row?.turns ?? 0, done: row?.done ?? 0, errors: row?.errors ?? 0, cost: costs.get(day) ?? null });
  }
  return points;
}

const pageFilterField = (
  base: { id: string; label: string; control: ReactNode; hint?: string },
  active: boolean,
  activeLabel: string,
  onReset: () => void,
): PageFilterField => active ? { ...base, active: true, activeLabel, onReset } : { ...base, active: false };

export function StatsSection() {
  const { components: C, hooks, utils } = runtime();
  const s = hooks.usePluginStrings('chatbot');
  const { locale, t } = hooks.useTranslation();
  const register = useChatbots();
  const bots = register.bots;
  const [selected, setSelected] = useState<number | null>(null);
  const [rangeRaw, setRangeRaw] = hooks.usePersistentState(
    'elowen.chatbot.stats.range',
    utils.serializeRange(utils.DEFAULT_RANGE),
    utils.isStoredRange,
  );
  const { range, now } = useMemo(() => ({
    range: utils.parseRange(rangeRaw) ?? utils.DEFAULT_RANGE,
    now: Date.now(),
  }), [rangeRaw, utils]);
  const hostBounds = useMemo(() => utils.rangeBounds(range, now), [now, range, utils]);
  const window = useMemo(() => statsWindow(range, now, hostBounds), [hostBounds, now, range]);
  const [answer, setAnswer] = useState<ChatbotStatsAnswer | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  const bot = bots.find((candidate) => candidate.chatbotUserId === selected) ?? bots[0] ?? null;
  const chatbotUserId = bot?.chatbotUserId ?? null;

  useEffect(() => {
    setAnswer(null);
    setLoadError(null);
    setPage(0);
  }, [chatbotUserId, window.from, window.to]);

  const load = useCallback(() => {
    if (chatbotUserId === null) return;
    setLoadError(null);
    void apiJson<ChatbotStatsAnswer>(chatbotApi.stats({
      chatbotUserId,
      from: window.from,
      to: window.to,
    }))
      .then(setAnswer)
      .catch((error) => setLoadError(utils.apiErrorMessage(error) || s.statsLoadError));
  }, [chatbotUserId, s.statsLoadError, utils, window.from, window.to]);

  useEffect(() => { load(); }, [load]);

  const spend = answer === null ? null : answer.spend.reduce<{ turns: number; tokens: number | null; cost: number | null }>((sum, { usage }) => {
    const cost = knownCost(usage);
    return {
      turns: sum.turns + (usage?.turns ?? 0),
      tokens: sum.tokens === null || usage?.tokens == null ? null : sum.tokens + usage.tokens,
      cost: sum.cost === null || cost === null ? null : sum.cost + cost,
    };
  }, { turns: 0, tokens: 0, cost: 0 });
  const points = answer === null ? [] : chartPoints(answer.days, answer.spend, answer.from, answer.to);
  const unknownCost = points.some((point) => point.cost === null);
  const pageCount = Math.max(1, Math.ceil(points.length / PAGE_SIZE));
  const clampedPage = Math.min(page, pageCount - 1);
  const rows = points.slice(clampedPage * PAGE_SIZE, (clampedPage + 1) * PAGE_SIZE);
  const series = [
    { key: 'turns', label: s.chartTurns, colour: SERIES_COLOURS.turns, variant: 'line' as const, axis: 'left' as const, format: (value: number) => integer(value, locale) },
    { key: 'cost', label: s.spendTitle, colour: SERIES_COLOURS.cost, variant: 'line' as const, axis: 'right' as const, format: (value: number) => money(value, locale) },
  ];

  const rangeLabels: Record<DateRange['preset'], string> = {
    today: t.common.rangeToday,
    '7d': t.common.rangeLast7,
    '30d': t.common.rangeLast30,
    '90d': t.common.rangeLast90,
    all: t.common.rangeAll,
    custom: t.common.rangeCustom,
  };
  const rangeLabel = range.preset === 'custom'
    ? `${range.from ?? '…'} – ${range.to ?? '…'}`
    : rangeLabels[range.preset];
  const changeRange = (next: DateRange) => setRangeRaw(utils.serializeRange(next));
  const filters: PageFilterField[] = [
    pageFilterField(
      { id: 'range', label: t.common.rangeLabel, control: <C.DateRangeFilter value={range} onChange={changeRange} /> },
      utils.serializeRange(range) !== utils.serializeRange(utils.DEFAULT_RANGE),
      `${t.common.rangeLabel}: ${rangeLabel}`,
      () => changeRange(utils.DEFAULT_RANGE),
    ),
  ];
  const heading = { title: s.sectionStatistics, description: s.sectionStatisticsHint, icon: Activity };

  if (register.loadError !== null) {
    return <C.SettingsGroup {...heading}><C.ErrorState message={`${s.botsLoadError} — ${register.loadError}`} onRetry={register.reload} /></C.SettingsGroup>;
  }
  if (bot === null) {
    return (
      <C.SettingsGroup {...heading}>
        {register.isLoading
          ? <C.LoadingState variant="block" />
          : <C.EmptyState title={s.pickerNoBots} description={s.pickerNoBotsDescription} icon={Activity} />}
      </C.SettingsGroup>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <C.SettingsGroup
        {...heading}
        actions={<BotPicker bots={bots} value={bot.chatbotUserId} onChange={setSelected} label={s.pickerLabel} />}
      >
        <div className="settings-group__panel flex min-w-0 flex-col gap-3">
        <C.PageFilters fields={filters} />
        {loadError !== null ? <C.ErrorState message={`${s.statsLoadError} — ${loadError}`} onRetry={load} />
          : answer === null ? <C.LoadingState variant="block" />
            : (
              <>
                <C.TimeSeriesChart data={points} series={series} height={240} ariaLabel={s.chartTitle} emptyText={s.chartEmpty} />
                {unknownCost ? <p className="text-xs text-muted-foreground">{s.costUnknownHint}</p> : null}
                <div className="mt-4 flex flex-col gap-3">
                  <h3 className="text-sm font-semibold">{s.statsTableTitle}</h3>
                  <C.DataTable ariaLabel={s.statsTableTitle} columns="minmax(8rem,1fr) 7rem 7rem 7rem" compactColumns="minmax(0,1fr) 5rem 5rem" mobileColumns="minmax(0,1fr) 3rem 3.5rem">
                    <C.DataTableRow header>
                      <C.DataTableCell header>{s.statsColumnDay}</C.DataTableCell>
                      <C.DataTableCell header className="text-right">{s.chartTurns}</C.DataTableCell>
                      <C.DataTableCell header priority="wide" className="text-right">{s.statsColumnDone}</C.DataTableCell>
                      <C.DataTableCell header className="text-right">{s.chartErrors}</C.DataTableCell>
                    </C.DataTableRow>
                    <div role="rowgroup">
                      {rows.map((row) => (
                        <C.DataTableRow key={row.label} interactive={false}>
                          <C.DataTableCell>{formatDay(row.label, locale)}</C.DataTableCell>
                          <C.DataTableCell className="text-right font-mono tabular-nums">{integer(row.turns, locale)}</C.DataTableCell>
                          <C.DataTableCell priority="wide" className="text-right font-mono tabular-nums">{integer(row.done, locale)}</C.DataTableCell>
                          <C.DataTableCell className="text-right font-mono tabular-nums">{integer(row.errors, locale)}</C.DataTableCell>
                        </C.DataTableRow>
                      ))}
                    </div>
                  </C.DataTable>
                  <C.Pager
                    page={clampedPage}
                    pageSize={PAGE_SIZE}
                    total={points.length}
                    onPageChange={setPage}
                    ariaLabel={s.statsTableTitle}
                  />
                </div>
              </>
            )}
        </div>
      </C.SettingsGroup>

      <C.SettingsGroup density="compact">
        <C.SettingsRow
          label={s.spendTitle}
          icon={Coins}
          description={s.spendHint}
          status={loadError !== null ? <span className="text-xs text-destructive">{s.spendLoadError}</span>
            : spend === null ? <C.LoadingLine layout="inline" />
              : spend.turns === 0 && spend.cost === 0 ? <span className="text-xs text-muted-foreground">{s.spendEmptyTitle}</span>
                : (
                  <span className="font-mono text-xs tabular-nums">
                    {s.spendLine
                      .replace('{turns}', integer(spend.turns, locale))
                      .replace('{tokens}', spend.tokens === null ? s.budgetValueUnknown : integer(spend.tokens, locale))
                      .replace('{cost}', spend.cost === null ? s.budgetValueUnknown : money(spend.cost, locale))}
                  </span>
                )}
        />
      </C.SettingsGroup>
    </div>
  );
}
