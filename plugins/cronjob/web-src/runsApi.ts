export const runsUrl = (params: Record<string, string | number | undefined>): string => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined) query.set(key, String(value));
  const suffix = query.toString();
  return `/plugins/cronjob/api/runs${suffix ? `?${suffix}` : ''}`;
};
