import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { knownCost, utcDay } from '../src/budget';
import { DAY_MS, STATS_MAX_DAYS } from '../src/adminContract';
import { Activity } from 'lucide-react';
import { apiJson, chatbotApi, runtime, type DateRange, type PageFilterField } from './runtime';
import { BotPicker } from './BotPicker';
import { useChatbots } from './useChatbots';
import { formatDay, integer, money } from './format';
import type { ChatbotStatsAnswer, ChatbotStatsDayView } from './types';

const SERIES_COLOURS = {
  turns: 'var(--color-chart-1)',
  done: 'var(--color-chart-2)',
  errors: 'var(--color-chart-4)',
  cost: 'var(--color-chart-3)',
} as const;

const dayStart = (timestamp: number): number => {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
};

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
  return { from: utcDay(fromMs), to: utcDay(toMs), fromMs, toMs: toMs + DAY_MS - 1 };
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
    const day = utcDay(at);
    const row = byDay.get(day);
    points.push({ label: day, turns: row?.turns ?? 0, done: row?.done ?? 0, errors: row?.errors ?? 0, cost: costs.get(day) ?? null });
  }
  return points;
}

const pageFilterField = (
  base: { id: string; label: string; control: ReactNode },
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
  // Reads overlap when the reader switches chatbot or window while one is in flight. Only the newest
  // read may paint: an older answer resolving last belongs to a chatbot or window no longer on screen.
  const requestSequence = useRef(0);

  const bot = bots.find((candidate) => candidate.chatbotUserId === selected) ?? bots[0] ?? null;
  const chatbotUserId = bot?.chatbotUserId ?? null;

  useEffect(() => {
    requestSequence.current += 1;
    setAnswer(null);
    setLoadError(null);
  }, [chatbotUserId, window.from, window.to]);

  const load = useCallback(() => {
    const request = ++requestSequence.current;
    if (chatbotUserId === null) return;
    setLoadError(null);
    void apiJson<ChatbotStatsAnswer>(chatbotApi.stats({
      chatbotUserId,
      from: window.from,
      to: window.to,
    }))
      .then((result) => { if (request === requestSequence.current) setAnswer(result); })
      .catch((error) => {
        if (request === requestSequence.current) setLoadError(utils.apiErrorMessage(error) || s.statsLoadError);
      });
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
  const chartData = points.map((point) => ({ ...point, label: formatDay(point.label, locale) }));
  const unknownCost = points.some((point) => point.cost === null);
  // Answered equals turns on every day without a failure, and the spend tracks the turns on its own axis,
  // so as three lines they share one path and only the last one painted shows. Turns and answered are
  // therefore paired bars, which sit side by side at equal heights, and they state each day's count
  // exactly instead of a curve between days.
  const series = [
    { key: 'turns', label: s.chartTurns, colour: SERIES_COLOURS.turns, variant: 'bar' as const, axis: 'left' as const, format: (value: number) => integer(value, locale) },
    { key: 'done', label: s.statsColumnDone, colour: SERIES_COLOURS.done, variant: 'bar' as const, axis: 'left' as const, format: (value: number) => integer(value, locale) },
    { key: 'errors', label: s.chartErrors, colour: SERIES_COLOURS.errors, variant: 'line' as const, axis: 'left' as const, format: (value: number) => integer(value, locale) },
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
        <div className="flex min-w-0 flex-col gap-3">
        <C.PageFilters fields={filters} />
        {loadError !== null ? <C.ErrorState message={`${s.statsLoadError} — ${loadError}`} onRetry={load} />
          : answer === null ? <C.LoadingState variant="block" />
            : (
              <>
                <C.TimeSeriesChart data={chartData} series={series} height={240} ariaLabel={s.chartTitle} emptyText={s.chartEmpty} />
                {unknownCost ? <p className="text-xs text-muted-foreground">{s.costUnknownHint}</p> : null}
              </>
            )}
        </div>
      </C.SettingsGroup>

      <C.SettingsGroup density="compact">
        <C.SettingsRow
          label={s.spendTitle}
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
