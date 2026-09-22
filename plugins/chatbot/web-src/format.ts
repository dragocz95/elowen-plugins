/** How this admin surface writes a number, a price and a moment.
 *
 *  One place, because the register, the transcript and the statistics tiles all show the same kinds of
 *  value and two of them disagreeing about what "no price reported" looks like is a reader's bug to find.
 *  Every helper takes the locale the host reports, so a page rendered in Czech formats in Czech. */

/** A moment as the administrator reads it: absolute, short, in their own zone. */
export const formatDateTime = (value: string, locale: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(date);
};

/** A UTC day key (`YYYY-MM-DD`) as a short local date. The day itself is UTC — that is the basis every
 *  counter here is keyed by — so it is parsed as a UTC midnight rather than as a local one. */
export const formatDay = (day: string, locale: string): string => {
  const date = new Date(`${day}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? day : new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
};

export const integer = (value: number, locale: string): string => new Intl.NumberFormat(locale).format(value);

/** A price, or an em dash when the rollup carried none. Deliberately NOT "$0.00": a bucket whose turns
 *  reported no price is unpriced, and printing it as free is a claim the data does not support. */
export const money = (value: number | null, locale: string): string =>
  value == null ? '—' : new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(value);
