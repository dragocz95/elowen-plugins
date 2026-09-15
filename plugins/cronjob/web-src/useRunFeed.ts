import { useEffect, useState } from 'react';
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
  const [rows, setRows] = useState<CronRunRow[]>([]);
  useEffect(() => { setCursor(null); setRows([]); }, [date]);
  const query = hooks.useQuery<CronRunsResponse>({
    queryKey: ['cron-runs-day', date, cursor],
    queryFn: () => runtime().api(runsUrl({
      date: date ?? undefined,
      limit: 50,
      cursor: cursor ?? undefined,
    })) as Promise<CronRunsResponse>,
    enabled: date !== null,
    staleTime: 5_000,
    refetchInterval: cursor === null ? 30_000 : false,
  });
  useEffect(() => {
    if (!query.data) return;
    setRows((current) => {
      if (cursor === null) return query.data!.runs;
      const ids = new Set(current.map((row) => row.id));
      return [...current, ...query.data!.runs.filter((row) => !ids.has(row.id))];
    });
  }, [cursor, query.data]);
  return {
    ...query,
    rows,
    total: query.data?.total ?? rows.length,
    hasMore: Boolean(query.data?.nextCursor),
    loadMore: () => {
      const next = query.data?.nextCursor;
      if (next) setCursor(next);
    },
  };
}
