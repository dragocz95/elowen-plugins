/** Number formatting shared by the model table and the origin drawer. */

export const integer = (value: number, locale: string): string => new Intl.NumberFormat(locale).format(value);

export const percentage = (value: number | null, locale: string): string =>
  value == null ? '—' : `${new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)}%`;

/** Short absolute timestamp for "first seen / last seen". */
export const shortDateTime = (ms: number, locale: string): string =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(ms));
