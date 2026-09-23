/** Number formatting shared by the model table and the origin drawer, so the two never disagree about
 *  what a token count or an unknown price looks like. */

export const integer = (value: number, locale: string): string => new Intl.NumberFormat(locale).format(value);

/** A price, or an em dash when the bucket carried none. Deliberately NOT "$0.00": a turn whose provider
 *  reported no cost is unpriced, and showing it as free is a claim the data does not support. */
export const money = (value: number | null, locale: string): string =>
  value == null ? '—' : new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(value);

export const percentage = (value: number | null, locale: string): string =>
  value == null ? '—' : `${new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)}%`;

/** Short absolute timestamp for "first seen / last seen". */
export const shortDateTime = (ms: number, locale: string): string =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(ms));
