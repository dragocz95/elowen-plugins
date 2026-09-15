import { useEffect, useMemo, useState } from 'react';
import { runtime, type CronRunRow, type CronRunsResponse } from './runtime';

export const runsUrl = (params: Record<string, string | number | undefined>): string => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined) query.set(key, String(value));
  const suffix = query.toString();
  return `/plugins/cronjob/api/runs${suffix ? `?${suffix}` : ''}`;
};

export function useRunFeed(date: string | null) {
  const { hooks } = runtime();
  const [cursor, setCursor] = useState<string | null>(null);
  const [olderRows, setOlderRows] = useState<CronRunRow[]>([]);
  useEffect(() => { setCursor(null); setOlderRows([]); }, [date]);

  // The newest page stays live even after the reader loads older pages. Using the pagination cursor as
  // the only query key stopped polling as soon as "Load older" was pressed, so fresh run receipts never
  // appeared until the whole page was reloaded.
  const latest = hooks.useQuery<CronRunsResponse>({
    queryKey: ['cron-runs-day-latest', date],
    queryFn: () => runtime().api(runsUrl({ date: date ?? undefined, limit: 50 })) as Promise<CronRunsResponse>,
    enabled: date !== null,
    staleTime: 5_000,
    refetchInterval: 30_000,
  });
  const older = hooks.useQuery<CronRunsResponse>({
    queryKey: ['cron-runs-day-older', date, cursor],
    queryFn: () => runtime().api(runsUrl({ date: date ?? undefined, limit: 50, cursor: cursor ?? undefined })) as Promise<CronRunsResponse>,
    enabled: date !== null && cursor !== null,
    staleTime: Infinity,
  });
  useEffect(() => {
    if (!older.data || cursor === null) return;
    setOlderRows((current) => {
      const ids = new Set(current.map((row) => row.id));
      return [...current, ...older.data!.runs.filter((row) => !ids.has(row.id))];
    });
  }, [cursor, older.data]);

  const rows = useMemo(() => {
    const newest = latest.data?.runs ?? [];
    const ids = new Set(newest.map((row) => row.id));
    return [...newest, ...olderRows.filter((row) => !ids.has(row.id))];
  }, [latest.data, olderRows]);
  const nextCursor = cursor === null ? latest.data?.nextCursor : older.data?.nextCursor;

  return {
    ...latest,
    rows,
    total: latest.data?.total ?? rows.length,
    isLoading: latest.isLoading || (cursor !== null && older.isLoading),
    isError: latest.isError || older.isError,
    hasMore: Boolean(nextCursor),
    loadMore: () => { if (nextCursor) setCursor(nextCursor); },
  };
}
