import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Coins, Gauge } from 'lucide-react';
import { apiJson, chatbotApi, runtime } from './runtime';
import { formatDateTime, formatDay, integer, money, seconds } from './format';
import type { ChatbotBotView, ChatbotStatsAnswer, ChatbotStatsDayView } from './types';

/** What this chatbot actually did, over a window of days.
 *
 *  Two counters meet on this screen and they are deliberately NOT the same one:
 *
 *  - the plugin's own admission counters, which answer "how many turns did this chatbot admit, per day,
 *    and how long did they wait" — read from the plugin's own rows through its own admin route;
 *  - the account's spend, read from core's `usage_by_origin` rollup through the host's admin usage route.
 *    That rollup is the ONLY source of origin-attributed spend in this codebase, and nothing here counts
 *    tokens or cost by scanning messages.
 *
 *  They are labelled separately because they are separate counters, and the rollup only starts at the day
 *  it began tracking — which the view states rather than hides. */

const WINDOW_DAYS = [7, 30, 90] as const;
/** How far into the instance's spend rows to look for this account's. The route orders by tokens, so a
 *  chatbot that spent nothing simply is not in the answer — which the view says instead of showing zeros. */
const USAGE_ROW_LIMIT = 500;

/** Public chart tokens every compatible host emits and a skin overrides as one palette. */
const SERIES_COLOURS = { turns: 'var(--color-chart-1)', errors: 'var(--color-chart-2)' } as const;

/** The window a selection of days means, as both the route and the usage read want it: inclusive UTC days
 *  plus the millisecond bounds of that same range. One definition, so the two requests cannot describe
 *  different windows. */
export function statsWindow(days: number, now: Date): { from: string; to: string; fromMs: number; toMs: number } {
  const to = now.toISOString().slice(0, 10);
  const toMs = Date.parse(`${to}T00:00:00.000Z`);
  const fromMs = toMs - (days - 1) * 86_400_000;
  return {
    from: new Date(fromMs).toISOString().slice(0, 10),
    to,
    fromMs,
    toMs: toMs + 86_399_999,
  };
}

/** The chart's points: EVERY day of the window, with the days nobody wrote on drawn as zero.
 *
 *  A chart of only the days that saw traffic is a chart that hides the quiet ones, which is exactly what a
 *  reader looks at it for. The range is bounded by the route's own window, so this cannot grow unbounded. */
export function chartPoints(days: readonly ChatbotStatsDayView[], from: string, to: string): { label: string; turns: number; errors: number }[] {
  const byDay = new Map(days.map((day) => [day.day, day]));
  const points: { label: string; turns: number; errors: number }[] = [];
  const end = Date.parse(`${to}T00:00:00.000Z`);
  for (let at = Date.parse(`${from}T00:00:00.000Z`); at <= end; at += 86_400_000) {
    const day = new Date(at).toISOString().slice(0, 10);
    const row = byDay.get(day);
    points.push({ label: day, turns: row?.turns ?? 0, errors: row?.errors ?? 0 });
  }
  return points;
}

export function StatsView({ bot }: { bot: ChatbotBotView }) {
  const { components: C, hooks, utils } = runtime();
  const s = hooks.usePluginStrings('chatbot');
  const { locale } = hooks.useTranslation();
  const [days, setDays] = useState<string>('30');
  const [answer, setAnswer] = useState<ChatbotStatsAnswer | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const window = useMemo(() => statsWindow(Number(days), new Date()), [days]);

  useEffect(() => {
    setAnswer(null);
    setLoadError(null);
  }, [bot.chatbotUserId, window.from, window.to]);

  const load = useCallback(() => {
    setLoadError(null);
    void apiJson<ChatbotStatsAnswer>(chatbotApi.stats({
      chatbotUserId: bot.chatbotUserId,
      from: window.from,
      to: window.to,
    }))
      .then(setAnswer)
      .catch((error) => setLoadError(utils.apiErrorMessage(error) || s.statsLoadError));
  }, [bot.chatbotUserId, s.statsLoadError, utils, window.from, window.to]);

  useEffect(() => { load(); }, [load]);

  const usage = hooks.useUsageByOrigin('pair', { fromMs: window.fromMs, toMs: window.toMs }, { limit: USAGE_ROW_LIMIT });
  const spend = (usage.data?.rows ?? []).find((row) => row.userId === bot.chatbotUserId) ?? null;

  const points = answer === null ? [] : chartPoints(answer.days, answer.from, answer.to);
  const series = [
    { key: 'turns', label: s.chartTurns, colour: SERIES_COLOURS.turns, variant: 'bar' as const, axis: 'left' as const, format: (value: number) => integer(value, locale) },
    { key: 'errors', label: s.chartErrors, colour: SERIES_COLOURS.errors, variant: 'line' as const, axis: 'left' as const, format: (value: number) => integer(value, locale) },
  ];

  const picker = (
    <div className="min-w-[12rem] max-w-xs">
      <C.SelectMenu
        value={days}
        onChange={setDays}
        options={WINDOW_DAYS.map((value) => ({ value: String(value), label: s.statsWindowDays.replace('{count}', String(value)) }))}
        label={s.statsWindowLabel}
        variant="line"
      />
    </div>
  );

  if (loadError !== null) {
    return (
      <div className="flex flex-col gap-4">
        {picker}
        <C.ErrorState message={`${s.statsLoadError} — ${loadError}`} onRetry={load} />
      </div>
    );
  }
  if (answer === null) {
    return (
      <div className="flex flex-col gap-4">
        {picker}
        <C.LoadingState variant="block" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {picker}

      <C.SettingsGroup title={s.chartTitle} description={s.chartHint} icon={Activity}>
        {answer.totals.turns === 0 ? (
          <C.EmptyState title={s.statsEmptyTitle} description={s.statsEmptyDescription} icon={Activity} />
        ) : (
          <C.TimeSeriesChart data={points} series={series} height={240} ariaLabel={s.chartTitle} emptyText={s.chartEmpty} />
        )}
      </C.SettingsGroup>

      <C.SettingsGroup title={s.totalsTitle} description={s.totalsHint} icon={Gauge}>
        <C.SettingsRow label={s.totalTurns} status={integer(answer.totals.turns, locale)} />
        <C.SettingsRow label={s.totalDone} status={integer(answer.totals.done, locale)} />
        <C.SettingsRow label={s.totalErrors} status={integer(answer.totals.errors, locale)} />
        <C.SettingsRow label={s.totalQueued} description={s.totalQueuedHint} status={integer(answer.totals.queued, locale)} />
        <C.SettingsRow label={s.totalRunning} status={integer(answer.totals.running, locale)} />
        <C.SettingsRow
          label={s.queueWait}
          description={s.queueWaitHint}
          hint={s.queueWaitHelp}
          status={answer.queueWait.samples === 0
            ? '—'
            : `${s.queueWaitP50}: ${seconds(answer.queueWait.p50Seconds, locale)} · ${s.queueWaitP95}: ${seconds(answer.queueWait.p95Seconds, locale)}`}
        />
      </C.SettingsGroup>

      <C.SettingsGroup title={s.spendTitle} description={s.spendHint} icon={Coins}>
        {usage.isLoading ? <C.LoadingLine layout="block" />
          : usage.isError ? <C.ErrorState message={s.spendLoadError} />
            : spend === null ? <C.EmptyState title={s.spendEmptyTitle} description={s.spendEmptyDescription} icon={Coins} />
              : (
                <>
                  <C.SettingsRow label={s.spendTurns} status={integer(spend.turns, locale)} />
                  <C.SettingsRow label={s.spendTokens} status={integer(spend.tokens, locale)} />
                  <C.SettingsRow
                    label={s.spendCost}
                    description={s.spendCostHint}
                    status={money(spend.cost, locale)}
                  />
                  <C.SettingsRow label={s.spendPricedTurns} description={s.spendPricedTurnsHint} status={`${integer(spend.costedTurns, locale)} / ${integer(spend.turns, locale)}`} />
                  <C.SettingsRow label={s.spendOrigins} description={s.spendOriginsHint} status={integer(spend.origins, locale)} />
                  <C.SettingsRow label={s.spendFirst} status={formatDateTime(new Date(spend.firstAt).toISOString(), locale)} />
                  <C.SettingsRow label={s.spendLast} status={formatDateTime(new Date(spend.lastAt).toISOString(), locale)} />
                </>
              )}
        {usage.data?.trackingSince == null ? null : (
          <p className="mt-3 text-xs text-muted-foreground">{s.spendTrackingSince.replace('{day}', formatDay(usage.data.trackingSince, locale))}</p>
        )}
      </C.SettingsGroup>
    </div>
  );
}
