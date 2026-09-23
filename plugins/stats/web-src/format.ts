/** Number formatting shared by the model table and the origin drawer, so the two never disagree about
 *  what a token count or an unknown price looks like. */

export const integer = (value: number, locale: string): string => new Intl.NumberFormat(locale).format(value);

/** A price, or an em dash when the bucket carried none. Deliberately NOT "$0.00": a turn whose provider
 *  reported no cost is unpriced, and showing it as free is a claim the data does not support. */
export const money = (value: number | null, locale: string): string =>
  value == null ? '—' : new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(value);

/** Compact model-usage number in the viewer's selected language. */
export const compact = (value: number, locale: string): string =>
  new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(value);

export const cost = (value: number | null, locale: string): string =>
  value == null ? '—' : new Intl.NumberFormat(locale, {
    style: 'currency', currency: 'USD', minimumFractionDigits: 4, maximumFractionDigits: 4,
  }).format(value);

export const percentage = (value: number | null, locale: string): string =>
  value == null ? '—' : `${new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)}%`;

export const speed = (value: number | null | undefined, locale: string): string =>
  value == null || !Number.isFinite(value) || value <= 0 ? '—'
    : value < 0.1 ? `<${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(0.1)} tok/s`
      : `${new Intl.NumberFormat(locale, { maximumFractionDigits: value < 1 ? 1 : 0 }).format(value)} tok/s`;

/** Short absolute timestamp for "first seen / last seen". */
export const shortDateTime = (ms: number, locale: string): string =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(ms));
