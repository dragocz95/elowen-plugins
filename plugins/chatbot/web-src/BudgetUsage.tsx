import { knownCost } from '../src/budget';
import type { ChatbotBotView } from './types';
import { formatDay, integer, money } from './format';
import { runtime } from './runtime';

/** A read of the admission rule, not a second decision made in the browser. */
export function BudgetUsage({ bot }: { bot: ChatbotBotView }) {
  const { hooks, components: C } = runtime();
  const s = hooks.usePluginStrings('chatbot');
  const { locale } = hooks.useTranslation();
  const { budget, limits } = bot;
  const { verdict } = budget;
  const cost = knownCost(budget.usage);
  const costLimit = limits.dailyCostMicrousd === null ? null : limits.dailyCostMicrousd / 1_000_000;
  const status = verdict.ok ? s.budgetAvailable
    : verdict.reason === 'limits_missing' ? s.budgetMissing
      : verdict.reason === 'budget_unverifiable' ? s.budgetUnknown
        : verdict.ceiling === 'turns' ? s.budgetTurnsExhausted : s.budgetCostExhausted;
  const entries = [
    { label: s.limit_dailyCostMicrousd, value: cost, limit: costLimit, format: (value: number) => money(value, locale) },
    { label: s.limit_dailyTurnLimit, value: budget.admittedTurns, limit: limits.dailyTurnLimit, format: (value: number) => integer(value, locale) },
  ];
  return (
    <div className="flex min-w-0 flex-col gap-2" aria-label={s.budgetTitle}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">{s.budgetDay.replace('{day}', formatDay(budget.day, locale))}</span>
        <C.Badge tone={verdict.ok ? 'muted' : 'warning'}>{status}</C.Badge>
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        {entries.map(({ label, value, limit, format }) => (
          <div key={label} className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap justify-between gap-x-2 text-xs">
              <span className="text-muted-foreground">{label}</span>
              <span className="font-mono tabular-nums">
                {value === null ? s.budgetValueUnknown : format(value)} / {limit === null ? s.budgetNoCeiling : format(limit)}
              </span>
            </div>
            {value === null || limit === null ? null : (
              <C.Progress aria-label={label} value={Math.min(100, value / limit * 100)}
                aria-valuetext={`${format(value)} / ${format(limit)}`}
                indicatorClassName={value >= limit ? 'bg-destructive' : undefined} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
