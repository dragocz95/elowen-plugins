import { useMemo, useState, type KeyboardEvent } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, MapPin } from 'lucide-react';
import { runtime } from './runtime';
import { integer, money, shortDateTime } from './format';
import type { UsageByOriginResult, UsageOriginGroup, UsageOriginRow } from './types';

const {
  Button, EmptyState, ErrorState, HelpTip, LoadingState, Segmented, WorkspaceDetailRail,
} = runtime().components;
const { useUsageByOrigin } = runtime().hooks;

type SortKey = 'tokens' | 'cost';

/** Rank by tokens or by money, never by one dressed as the other: a cheap model can burn an order of
 *  magnitude more tokens than an expensive one, so the two orderings genuinely disagree and the operator
 *  has to say which question they are asking. */
function sortRows(rows: readonly UsageOriginRow[], sort: SortKey): UsageOriginRow[] {
  const copy = [...rows];
  copy.sort((a, b) => (sort === 'cost' ? (b.cost ?? -1) - (a.cost ?? -1) : b.tokens - a.tokens));
  return copy;
}

/** Human label for a row. A missing username is shown as the raw account id rather than invented; an
 *  origin keeps its own value, which already spells out `internal` / `platform:<name>` / `redacted`. */
function rowLabel(row: UsageOriginRow, group: UsageOriginGroup, strings: Record<string, string>): string {
  const user = row.username ?? (row.userId != null ? `#${row.userId}` : '—');
  const origin = originLabel(row, strings);
  if (group === 'user') return user;
  if (group === 'origin') return origin;
  return `${user} · ${origin}`;
}

function originLabel(row: UsageOriginRow, strings: Record<string, string>): string {
  if (row.origin == null) return '—';
  if (row.originKind === 'internal') return strings.originInternal;
  if (row.originKind === 'local') return strings.originLocal;
  if (row.originKind === 'redacted') return strings.originRedacted;
  if (row.originKind === 'platform') return `${strings.originPlatform}: ${row.origin.slice('platform:'.length)}`;
  return row.origin;
}

/** A share bar as a plain div at a percentage width — the plugin draws its charts by hand (PieChart)
 *  rather than pulling in a charting library for one horizontal rectangle. */
function ShareBar({ share }: { share: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-border/60" aria-hidden>
      <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(1, Math.round(share * 100))}%` }} />
    </div>
  );
}

function OriginRows({
  rows, group, sort, locale, strings, onSelect,
}: {
  rows: UsageOriginRow[];
  group: UsageOriginGroup;
  sort: SortKey;
  locale: string;
  strings: Record<string, string>;
  onSelect?: (row: UsageOriginRow) => void;
}) {
  const sorted = useMemo(() => sortRows(rows, sort), [rows, sort]);
  const peak = sorted.reduce((max, row) => Math.max(max, sort === 'cost' ? row.cost ?? 0 : row.tokens), 0);
  return (
    <ol className="flex flex-col gap-3">
      {sorted.map((row, index) => {
        const value = sort === 'cost' ? row.cost ?? 0 : row.tokens;
        const key = `${row.userId ?? 'x'}:${row.origin ?? 'x'}`;
        const selectable = onSelect != null;
        return (
          <li
            key={key}
            className={selectable ? 'group cursor-pointer rounded-md p-2 hover:bg-muted' : 'rounded-md p-2'}
            {...(selectable ? {
              role: 'button',
              tabIndex: 0,
              'data-testid': 'origin-row',
              onClick: () => onSelect(row),
              onKeyDown: (event: KeyboardEvent) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                onSelect(row);
              },
            } : { 'data-testid': 'origin-row' })}
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground">{index + 1}.</span>
              <span className="min-w-0 flex-1 truncate text-sm text-foreground" title={rowLabel(row, group, strings)}>
                {rowLabel(row, group, strings)}
              </span>
              {!row.trusted ? (
                <AlertTriangle size={13} aria-label={strings.originUnverified} className="shrink-0 text-warning" />
              ) : null}
              {selectable ? <ChevronRight size={13} aria-hidden className="shrink-0 text-muted-foreground" /> : null}
            </div>
            <div className="mt-1.5 flex items-center gap-3">
              <ShareBar share={peak > 0 ? value / peak : 0} />
              <span className="shrink-0 font-mono text-xs tabular-nums text-foreground">{integer(row.tokens, locale)}</span>
              <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{money(row.cost, locale)}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {group === 'user'
                ? strings.rowOrigins.replace('{count}', String(row.origins))
                : strings.rowTurns.replace('{count}', String(row.turns))}
              {' · '}
              {strings.rowLastSeen.replace('{when}', shortDateTime(row.lastAt, locale))}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

/** The admin answer to "who is burning the tokens, and from where".
 *
 *  The server gates this route (403 for a non-admin) — `isAdmin` here only keeps a normal account from
 *  firing a request that is meant to fail, and the trigger from appearing. It is not the access control. */
export function OriginDrawer({
  isAdmin, window: usageWindow, rangeLabel, locale, strings, closeLabel, unreachableLabel, onClose,
}: {
  isAdmin: boolean;
  window: { fromMs: number; toMs: number };
  rangeLabel: string;
  locale: string;
  strings: Record<string, string>;
  closeLabel: string;
  unreachableLabel: string;
  onClose(): void;
}) {
  const [group, setGroup] = useState<UsageOriginGroup>('user');
  const [sort, setSort] = useState<SortKey>('tokens');
  const [drillUserId, setDrillUserId] = useState<number | null>(null);

  // Two queries, both server-aggregated: the grouped ranking, and the raw pairs the drill-down filters.
  // The drill-down FILTERS those pairs rather than re-summing anything client-side — the GROUP BY lives
  // in one place (usage_by_origin), and a second copy here would drift from it.
  const grouped = useUsageByOrigin(group, usageWindow, { enabled: isAdmin });
  const pairs = useUsageByOrigin('pair', usageWindow, { enabled: isAdmin && drillUserId != null, limit: 200 });

  const result: UsageByOriginResult | undefined = grouped.data;
  const drillRows = useMemo(
    () => (pairs.data?.rows ?? []).filter((row) => row.userId === drillUserId),
    [pairs.data, drillUserId],
  );
  const drillLabel = drillRows[0]?.username ?? (drillUserId != null ? `#${drillUserId}` : '');
  const untrusted = (result?.rows ?? []).filter((row) => !row.trusted).length;

  const body = () => {
    if (grouped.isError) return <ErrorState message={unreachableLabel} onRetry={() => grouped.refetch()} />;
    if (grouped.isLoading || !result) return <LoadingState variant="cards" />;
    if (result.rows.length === 0) return <EmptyState title={strings.originEmptyTitle} description={strings.originEmptyBody} icon={MapPin} />;
    if (drillUserId != null) {
      return (
        <div className="flex flex-col gap-4">
          <Button variant="ghost" icon={ChevronLeft} onClick={() => setDrillUserId(null)}>{strings.originBack}</Button>
          <h3 className="text-sm font-semibold text-foreground">{drillLabel}</h3>
          {pairs.isLoading ? <LoadingState variant="cards" /> : (
            <OriginRows rows={drillRows} group="origin" sort={sort} locale={locale} strings={strings} />
          )}
        </div>
      );
    }
    return (
      <OriginRows
        rows={result.rows}
        group={group}
        sort={sort}
        locale={locale}
        strings={strings}
        {...(group === 'user' ? { onSelect: (row: UsageOriginRow) => { if (row.userId != null) setDrillUserId(row.userId); } } : {})}
      />
    );
  };

  return (
    <WorkspaceDetailRail label={strings.originTitle} closeLabel={closeLabel} onClose={onClose}>
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold text-foreground">{strings.originTitle}</h2>
          {/* The window and the tracking start come FIRST: without them the ranking reads as the
              instance's whole history, and everything spent before the rollup existed has no origin. */}
          <p className="text-xs text-muted-foreground">{rangeLabel}</p>
          <p className="text-xs text-muted-foreground">
            {result?.trackingSince
              ? strings.originTrackedSince.replace('{day}', result.trackingSince)
              : strings.originTrackedNever}
          </p>
        </div>

        {untrusted > 0 ? (
          <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-2.5">
            <AlertTriangle size={14} aria-hidden className="mt-0.5 shrink-0 text-warning" />
            <p className="min-w-0 text-xs text-foreground">
              {strings.originUntrustedWarning.replace('{count}', String(untrusted))}
            </p>
            <HelpTip>{strings.originUntrustedHelp}</HelpTip>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            nowrap
            aria-label={strings.originGroupLabel}
            value={group}
            onChange={(value: string) => { setGroup(value as UsageOriginGroup); setDrillUserId(null); }}
            options={[
              { value: 'user', label: strings.originGroupUsers },
              { value: 'origin', label: strings.originGroupOrigins },
              { value: 'pair', label: strings.originGroupPairs },
            ]}
          />
          <Segmented
            nowrap
            aria-label={strings.originSortLabel}
            value={sort}
            onChange={(value: string) => setSort(value as SortKey)}
            options={[
              { value: 'tokens', label: strings.originSortTokens },
              { value: 'cost', label: strings.originSortCost },
            ]}
          />
        </div>

        {body()}

        <p className="border-t border-border/70 pt-3 text-xs text-muted-foreground">{strings.originFootnote}</p>
      </div>
    </WorkspaceDetailRail>
  );
}
