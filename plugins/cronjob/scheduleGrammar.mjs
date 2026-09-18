// The ONE declaration of the three human-readable schedule shapes ("every 15m", "daily 07:30",
// "weekly sun 20:00"). `schedule.mjs` is the grammar's authority — frozen, pinned by
// tests/cronGrammar.test.ts against the corpus published in elowen-plugin-shared/cronGrammar — and the
// browser schedule builder (web-src/scheduleBuilder.ts) needs the SAME three patterns to decide whether
// a schedule can be edited with the friendly controls or must fall back to the raw "Advanced" field.
//
// Before this file existed the builder hand-copied these regexes: character-identical today, but with no
// way to notice a future widening of the grammar. Both sides now import this one module instead, so a
// grammar change either updates the builder for free or (for the pure .mjs → typed .mts import) is
// forced through review here.
export const EVERY_PATTERN = /^every\s+(\d+)\s*(m|h)$/i;
export const DAILY_PATTERN = /^daily\s+([01]?\d|2[0-3]):([0-5]\d)$/i;
export const WEEKLY_PATTERN = /^weekly\s+(sun|mon|tue|wed|thu|fri|sat)\s+([01]?\d|2[0-3]):([0-5]\d)$/i;
