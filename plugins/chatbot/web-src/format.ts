/** How this admin surface writes a number and a moment.
 *
 *  Every helper takes the locale the host reports, so a page rendered in Czech formats in Czech. */

import type { ChatbotBotView, ChatbotFeedbackAnswer } from './types';

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
  return Number.isNaN(date.getTime()) ? day : new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(date);
};

export const integer = (value: number, locale: string): string => new Intl.NumberFormat(locale).format(value);

/** A chatbot's name as the reader sees it: its own display name, or the fallback when the owner gave it
 *  none. One place, because the register, the pickers, the drawer and the confirmations all name one. */
export const botLabel = (bot: Pick<ChatbotBotView, 'displayName'>, s: Record<string, string>): string =>
  bot.displayName || s.botFallback;

/** A feedback row's chatbot name, which is a stored copy on the row rather than the register's live value,
 *  so it takes the row and not a bot — with the same fallback when the copy is empty. */
type FeedbackRow = ChatbotFeedbackAnswer['rows'][number];
export const feedbackBotLabel = (row: Pick<FeedbackRow, 'chatbotName'>, s: Record<string, string>): string =>
  row.chatbotName || s.botFallback;
