import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Coins } from 'lucide-react';
import { apiJson, chatbotApi, runtime } from './runtime';
import { BotPicker } from './BotPicker';
import { useChatbots } from './useChatbots';
import { formatDay, integer, money } from './format';
import type { ChatbotStatsAnswer, ChatbotStatsDayView } from './types';

/** THE STATISTICS SECTION: what one chatbot actually did over a window of days — the chatbot, the window,
 *  the chart, the spend. Nothing else.
 *
 *  It used to be a chart plus thirteen counters in three cards, and the counters were the problem: turns,
 *  answered and failed are what the chart already draws, day by day; "waiting now" and "running now" are
 *  instantaneous facts about a queue, which a window of days cannot report and which belong to a
 *  monitoring surface rather than to a configuration one; and the six extra spend rows restated one
 *  number six ways. What is left is the two things a reader opens this for — how much traffic there was,
 *  and what it cost.
 *
 *  The two numbers here are deliberately NOT the same counter: the chart is the plugin's own admission
 *  count, read from its own rows; the spend is the ACCOUNT's, read from core's `usage_by_origin` rollup,
 *  which is the only source of origin-attributed spend in this codebase. Nothing here counts tokens or
 *  cost by scanning messages, and the rollup only starts on the day it began tracking — which the row
 *  states rather than hides. */

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

export function StatsSection() {
  const { components: C, hooks, utils } = runtime();
  const s = hooks.usePluginStrings('chatbot');
  const { locale } = hooks.useTranslation();
  const register = useChatbots();
  const bots = register.bots;
  // The section's own heading, worn by whichever card its state renders: the reader is told what this is
  // before being told what is missing or what it counted.
  const heading = { title: s.sectionStatistics, description: s.sectionStatisticsHint, icon: Activity };
  const [selected, setSelected] = useState<number | null>(null);
  const [days, setDays] = useState<string>('30');
  const [answer, setAnswer] = useState<ChatbotStatsAnswer | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const window = useMemo(() => statsWindow(Number(days), new Date()), [days]);
  // The first chatbot until the reader picks another, and back to a real one if the picked chatbot left
  // the register.
  const bot = bots.find((candidate) => candidate.chatbotUserId === selected) ?? bots[0] ?? null;
  const chatbotUserId = bot?.chatbotUserId ?? null;

  useEffect(() => {
    setAnswer(null);
    setLoadError(null);
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

  const usage = hooks.useUsageByOrigin('pair', { fromMs: window.fromMs, toMs: window.toMs }, { limit: USAGE_ROW_LIMIT, enabled: chatbotUserId !== null });
  const spend = chatbotUserId === null ? null : (usage.data?.rows ?? []).find((row) => row.userId === chatbotUserId) ?? null;

  const points = answer === null ? [] : chartPoints(answer.days, answer.from, answer.to);
  const series = [
    { key: 'turns', label: s.chartTurns, colour: SERIES_COLOURS.turns, variant: 'bar' as const, axis: 'left' as const, format: (value: number) => integer(value, locale) },
    { key: 'errors', label: s.chartErrors, colour: SERIES_COLOURS.errors, variant: 'line' as const, axis: 'left' as const, format: (value: number) => integer(value, locale) },
  ];

  // The register is this section's own precondition: there is nothing to count until it arrives, and
  // "no chatbot yet" is a different answer from "not read yet" and from "could not be read".
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
      {/* Which chatbot, and over how many days. Three windows, all of them visible: a dropdown would make
          the reader open a list to discover what the other two are. `nowrap` keeps that promise where the
          row is too narrow for all three: the track scrolls with the host's own fade instead of the last
          window being clipped on a phone. */}
      <C.SettingsGroup
        {...heading}
        actions={(
          <>
            <BotPicker bots={bots} value={bot.chatbotUserId} onChange={setSelected} label={s.pickerLabel} />
            <C.Segmented
              size="sm"
              nowrap
              aria-label={s.statsWindowLabel}
              value={days}
              onChange={setDays}
              options={WINDOW_DAYS.map((value) => ({ value: String(value), label: s.statsWindowDays.replace('{count}', String(value)) }))}
            />
          </>
        )}
      >
        {loadError !== null ? <C.ErrorState message={`${s.statsLoadError} — ${loadError}`} onRetry={load} />
          : answer === null ? <C.LoadingState variant="block" />
            : answer.totals.turns === 0 ? <C.EmptyState title={s.statsEmptyTitle} description={s.statsEmptyDescription} icon={Activity} />
              : <C.TimeSeriesChart data={points} series={series} height={240} ariaLabel={s.chartTitle} emptyText={s.chartEmpty} />}
      </C.SettingsGroup>

      <C.SettingsGroup density="compact">
        <C.SettingsRow
          label={s.spendTitle}
          icon={Coins}
          description={s.spendHint}
          hint={usage.data?.trackingSince == null ? undefined : s.spendTrackingSince.replace('{day}', formatDay(usage.data.trackingSince, locale))}
          status={usage.isLoading ? <C.LoadingLine layout="inline" />
            : usage.isError ? <span className="text-xs text-destructive">{s.spendLoadError}</span>
              : spend === null ? <span className="text-xs text-muted-foreground">{s.spendEmptyTitle}</span>
                : (
                  <span className="font-mono text-xs tabular-nums">
                    {s.spendLine
                      .replace('{turns}', integer(spend.turns, locale))
                      .replace('{tokens}', integer(spend.tokens, locale))
                      .replace('{cost}', money(spend.cost, locale))}
                  </span>
                )}
        />
      </C.SettingsGroup>
    </div>
  );
}
