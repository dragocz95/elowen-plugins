// The schedule engine — parser, wall-clock/timezone conversion, DST slot identity, active-hours gate,
// catch-up and due logic. The scheduler and every preview endpoint (calendar, schedule-preview,
// nextOccurrence) call the SAME functions here, so a preview can never disagree with a run. The per-job
// authorization, delivery and run logic live in index.mjs; this module only answers "when would it
// happen", on the wall clock the configured timezone states.
//
// Every schedule here is a statement about the USER's wall clock: "daily 07:30" means 07:30 where THEY
// live, not wherever the server happens to be hosted. None of this may use the process's local time — it
// resolves each instant's fields in the configured zone via Intl (no dependency, same mechanism the
// injected date/time context uses). The host default is the machine's own zone, which reproduces exactly
// the behaviour these schedules had before the setting existed.

/** The machine's own zone — the host default, carried over from the pre-setting scheduler unchanged. */
export const systemZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

// Constructing a DateTimeFormat is FAR more expensive than using one, and the catch-up scan below can ask
// for up to a day of minutes per job per tick. Build one formatter per zone and keep it.
const formatters = new Map();
const formatterFor = (timezone) => {
  let fmt = formatters.get(timezone);
  if (!fmt) {
    const options = {
      hour12: false, weekday: 'short',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    };
    // A timezone the operator typed by hand can be nonsense, and Intl THROWS on an unknown zone. Every
    // schedule flows through here, so letting that escape would take the whole scheduler down over a typo.
    // Fall back to the machine's zone — jobs keep running, an hour or two off, rather than not at all.
    try {
      fmt = new Intl.DateTimeFormat('en-US', { ...options, timeZone: timezone });
    } catch {
      fmt = new Intl.DateTimeFormat('en-US', options);
    }
    formatters.set(timezone, fmt);
  }
  return fmt;
};

/** The wall-clock fields of instant `ms` as seen in `timezone`. */
export function zonedParts(ms, timezone) {
  const parts = formatterFor(timezone)
    .formatToParts(new Date(ms))
    .reduce((acc, p) => ((acc[p.type] = p.value), acc), {});
  return {
    year: Number(parts.year),
    month: Number(parts.month),         // 1-12, like cron
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,      // some ICU builds render midnight as "24"
    minute: Number(parts.minute),
    weekday: WEEKDAYS.indexOf(String(parts.weekday).toLowerCase().slice(0, 3)), // 0 = Sunday
  };
}

/** The instant at which a given wall clock occurs in `timezone`. Guess UTC, measure how far off the zone
 *  renders it, correct — twice, so a guess that lands on the far side of a DST change still converges. */
export function zonedTimeToMs(timezone, year, month, day, hour, minute) {
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let ms = target;
  for (let i = 0; i < 2; i += 1) {
    const p = zonedParts(ms, timezone);
    const rendered = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    ms = target - (rendered - ms);
  }
  return ms;
}

/** The wall-clock MINUTE an instant falls in ("2026-10-25T02:30"), in `timezone`. Two different instants
 *  share one key exactly when they are the same time on the clock — which is what makes it the right
 *  identity for "has this scheduled slot already run". */
export function slotKey(ms, timezone) {
  const p = zonedParts(ms, timezone);
  const pad = (n) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// How far back a cron schedule may catch up after downtime. The human-readable "daily 07:30" form already
// fires late (isDue only checks that today's slot has passed), and a cron job must not be the one form that
// silently skips its run because the daemon happened to be restarting at 09:00. A day means a long outage
// replays at most one daily occurrence, never a backlog; an operator who wants a week-long outage caught up
// raises it (cfg: cronLookbackMs).
export const DEFAULT_CRON_LOOKBACK_MS = 24 * 3_600_000;

/** Parse ONE cron field into the set of values it matches: a wildcard, a single value, a range, any of
 *  those with a step suffix (e.g. a wildcard every 15), and comma-separated lists of them. `names`
 *  (weekday/month abbreviations) are folded to their numbers. Returns null on anything malformed — the
 *  caller then rejects the whole expression rather than silently matching a field it did not understand. */
export function parseCronField(spec, min, max, names, wrapValue) {
  const text = String(spec ?? '').trim().toLowerCase();
  if (!text) return null;
  const values = new Set();
  // One extra accepted value above `max` that folds back to `min` — cron's Sunday, which is both 0 and 7.
  const ceiling = wrapValue === undefined ? max : wrapValue;
  const wrap = (v) => (v === wrapValue ? min : v);
  // `names` is indexed FROM the field's own minimum: weekdays start at sun=0 (min 0), months at jan=1
  // (min 1). Using the raw array index would put every month one too low — "feb" would fire in January and
  // "jan" would be rejected outright for falling below the minimum.
  const num = (token) => {
    const named = names ? names.indexOf(token) : -1;
    const n = named >= 0 ? named + min : (/^\d+$/.test(token) ? Number(token) : NaN);
    return Number.isInteger(n) ? n : NaN;
  };
  for (const part of text.split(',')) {
    const slices = part.split('/');
    if (slices.length > 2) return null; // "1-5/2/3" is not a thing
    const [range, stepText] = slices;
    if (stepText !== undefined && !/^\d+$/.test(stepText)) return null;
    const step = stepText === undefined ? 1 : Number(stepText);
    if (step < 1) return null;
    let lo;
    let hi;
    if (range === '*') {
      lo = min; hi = max;
    } else if (range.includes('-')) {
      const bounds = range.split('-');
      if (bounds.length !== 2) return null; // "1-3-5" is malformed, not silently "1-3"
      const [a, b] = bounds;
      lo = num(a); hi = num(b);
    } else {
      lo = num(range);
      // A bare value with a step means "from here to the end" (`5/15` = 5,20,35,50) — standard cron.
      hi = stepText === undefined ? lo : max;
    }
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo > hi) return null;
    if (lo < min || hi > ceiling) return null;
    for (let v = lo; v <= hi; v += step) values.add(wrap(v));
  }
  return values.size ? values : null;
}

/** Parse a standard 5-field cron expression (minute hour day-of-month month day-of-week, e.g. "0 9 * * 1-5"
 *  or "0 0 1 * *"). Null when it is not five fields or any field is malformed — so the caller can fall
 *  through to the human-readable forms. */
export function parseCron(spec) {
  const fields = String(spec ?? '').trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const minute = parseCronField(fields[0], 0, 59);
  const hour = parseCronField(fields[1], 0, 23);
  const dayOfMonth = parseCronField(fields[2], 1, 31);
  const month = parseCronField(fields[3], 1, 12, MONTHS);
  const dayOfWeek = parseCronField(fields[4], 0, 6, WEEKDAYS, 7); // 7 is cron's other name for Sunday
  if (!minute || !hour || !dayOfMonth || !month || !dayOfWeek) return null;
  return {
    kind: 'cron', minute, hour, dayOfMonth, month, dayOfWeek,
    // Cron's one famous quirk: when BOTH day-of-month and day-of-week are restricted, a date matches if
    // EITHER does (not both). A field is "restricted" only when it does not START with a wildcard — Vixie
    // counts `*/2` as unrestricted too, so pairing it with a weekday must AND, not OR (an OR there would
    // fire the job on days it was never asked for).
    domRestricted: !fields[2].trim().startsWith('*'),
    dowRestricted: !fields[4].trim().startsWith('*'),
  };
}

/** Whether a cron schedule fires in the minute instant `ms` falls in, read on the USER's wall clock. */
export function cronMatches(sched, ms, timezone = systemZone()) {
  const at = zonedParts(ms, timezone);
  if (!sched.minute.has(at.minute)) return false;
  if (!sched.hour.has(at.hour)) return false;
  if (!sched.month.has(at.month)) return false;
  const dom = sched.dayOfMonth.has(at.day);
  const dow = sched.dayOfWeek.has(at.weekday);
  // Both restricted → OR (the cron quirk). Otherwise the restricted one alone decides; an unrestricted
  // field always matches, so a plain AND is correct there.
  if (sched.domRestricted && sched.dowRestricted) return dom || dow;
  return dom && dow;
}

/** The most recent minute at or before `now` at which `sched` fired, provided it is strictly newer than
 *  `after` (the job's last run). Null when the job already ran its latest occurrence — i.e. not due. The
 *  scan walks back one REAL minute at a time and reads each one on the user's wall clock, so a DST shift
 *  simply moves which instants carry which clock time — no arithmetic to get wrong. It stops at `after` or
 *  the lookback bound, so it costs at most one day of minutes and gives a cron job the same
 *  catch-up-after-downtime behavior the daily form has. */
export function lastCronOccurrence(sched, now, after, timezone = systemZone(), lookbackMs = DEFAULT_CRON_LOOKBACK_MS) {
  const floor = Math.max(after, now - lookbackMs);
  let cursor = now - (now % 60_000); // truncate to the minute
  while (cursor > floor) {
    if (cronMatches(sched, cursor, timezone)) return cursor;
    cursor -= 60_000;
  }
  return null;
}

/** Parse "every 15m" / "every 2h" / "daily 07:30" / "weekly sun 20:00", or a standard 5-field cron
 *  expression, into a matcher. Null = invalid.
 *
 *  The two formats are told apart structurally, not by a flag: every human-readable form starts with a
 *  keyword and none of them has five whitespace-separated fields, so a 5-field spec can only be cron. That
 *  keeps auto-detection unambiguous and means an existing job's schedule string still parses exactly as
 *  it did before. */
export function parseSchedule(spec) {
  const text = typeof spec === 'string' ? spec.trim() : '';
  let m = /^every\s+(\d+)\s*(m|h)$/i.exec(text);
  if (m) {
    const ms = Number(m[1]) * (m[2].toLowerCase() === 'h' ? 3_600_000 : 60_000);
    if (ms < 60_000) return null;
    return { kind: 'interval', ms };
  }
  m = /^daily\s+([01]?\d|2[0-3]):([0-5]\d)$/i.exec(text);
  if (m) return { kind: 'daily', hour: Number(m[1]), minute: Number(m[2]) };
  m = /^weekly\s+(sun|mon|tue|wed|thu|fri|sat)\s+([01]?\d|2[0-3]):([0-5]\d)$/i.exec(text);
  if (m) return { kind: 'weekly', day: WEEKDAYS.indexOf(m[1].toLowerCase()), hour: Number(m[2]), minute: Number(m[3]) };
  return parseCron(text);
}

/** Whether `now` falls inside a job's optional "H-H" active-hours window (e.g. '5-21') — on the user's
 *  clock, so "quiet outside 5-21" means quiet outside THEIR evening, not the server's. */
export function inHours(hours, now, timezone = systemZone()) {
  if (!hours) return true;
  const m = /^([01]?\d|2[0-3])\s*-\s*([01]?\d|2[0-3])$/.exec(String(hours).trim());
  if (!m) return true; // malformed guard never blocks the job
  const h = zonedParts(now, timezone).hour;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a <= b ? h >= a && h <= b : h >= a || h <= b; // supports overnight windows like 22-5
}

/** Whether `hours` is a well-formed whole-hour window (or simply absent). Malformed LEGACY hours stay
 *  fail-open in the scheduler exactly as before; this predicate exists so a preview can WARN about a
 *  window it cannot trust without changing the stored value. */
export function hoursAreValid(hours) {
  if (!hours) return true;
  const m = /^([01]?\d|2[0-3])\s*-\s*([01]?\d|2[0-3])$/.exec(String(hours).trim());
  return m !== null;
}

/** The scheduled SLOT this job is due for at `now`, or null when it is not due. The slot is a wall-clock
 *  minute key ("2026-10-25T02:30"); the tick records it, and a job never runs the same slot twice.
 *
 *  That identity is what makes the autumn DST change behave: the hour that repeats produces two different
 *  INSTANTS carrying the same clock time, so comparing instants alone would fire "daily 02:30" twice that
 *  night. Comparing the slot fires it once, which is what the user asked for. (In spring that clock time
 *  does not exist at all and the job is skipped for the day — standard cron behaviour.) */
export function dueSlot(job, now, timezone = systemZone(), lookbackMs = DEFAULT_CRON_LOOKBACK_MS) {
  if (job.enabled === false) return null;
  // One-shots are consumed by deletion, not by a slot — they fire exactly once, at an absolute instant.
  if (job.runAt) return (!job.lastRun && now >= Date.parse(job.runAt)) ? slotKey(now, timezone) : null;
  if (!inHours(job.hours, now, timezone)) return null;
  const sched = parseSchedule(job.schedule);
  if (!sched) return null;
  const last = job.lastRun ? Date.parse(job.lastRun) : 0;

  // An interval is a duration, not a wall-clock time — "every 15m" means every 15 minutes, through a DST
  // change and everywhere on earth. It is deliberately the one kind that ignores the calendar entirely.
  if (sched.kind === 'interval') return now - last >= sched.ms ? slotKey(now, timezone) : null;

  const fire = (at) => {
    const slot = slotKey(at, timezone);
    return job.lastSlot === slot ? null : slot;
  };

  if (sched.kind === 'cron') {
    const at = lastCronOccurrence(sched, now, last, timezone, lookbackMs);
    return at === null ? null : fire(at);
  }

  // daily / weekly: today's HH:MM on the user's clock. `lastSlot` is absent on jobs created before it
  // existed, so the instant comparison stays as the fallback — an upgrade must not re-fire today's slot.
  const today = zonedParts(now, timezone);
  if (sched.kind === 'weekly' && today.weekday !== sched.day) return null;
  const at = zonedTimeToMs(timezone, today.year, today.month, today.day, sched.hour, sched.minute);
  if (now < at) return null;
  if (job.lastSlot === undefined && last >= at) return null;
  return fire(at);
}

/** Whether a job is due at `now`. See {@link dueSlot} — this is the boolean view of it. */
export function isDue(job, now, timezone = systemZone()) {
  return dueSlot(job, now, timezone) !== null;
}

/** Resolve a one-shot spec — "in 20s", "in 20m", "in 2h", "at 18:30" (today, or tomorrow when past) —
 *  to an absolute run time in ms, relative to `now`. "at HH:MM" is the USER's wall clock, so it resolves in
 *  their timezone. Returns null when the spec isn't a one-shot. */
export function parseOneShot(spec, now, timezone = systemZone()) {
  let m = /^in\s+(\d+)\s*(s|m|h)$/i.exec(spec.trim());
  if (m) {
    const unit = m[2].toLowerCase();
    const ms = Number(m[1]) * (unit === 'h' ? 3_600_000 : unit === 'm' ? 60_000 : 1_000);
    // Seconds are allowed from 5 s (the 30 s tick quantizes anyway); minutes/hours keep the 1 min floor.
    return ms >= (unit === 's' ? 5_000 : 60_000) ? now + ms : null;
  }
  m = /^at\s+([01]?\d|2[0-3]):([0-5]\d)$/i.exec(spec.trim());
  if (m) {
    const today = zonedParts(now, timezone);
    let at = zonedTimeToMs(timezone, today.year, today.month, today.day, Number(m[1]), Number(m[2]));
    // "at 20:31" asked at 20:31:02 means NOW, not tomorrow — a time up to 5 min in the past fires ASAP
    // (the model often echoes the current wall-clock minute, which has just slipped past).
    if (at <= now && now - at <= 300_000) return now + 1_000;
    // Further past today → the same wall-clock time tomorrow. Stepping the DATE (not adding 24h) is what
    // keeps "at 07:30" at 07:30 across a DST change, instead of drifting to 06:30 or 08:30.
    if (at <= now) {
      const tomorrow = zonedParts(now + 86_400_000, timezone);
      at = zonedTimeToMs(timezone, tomorrow.year, tomorrow.month, tomorrow.day, Number(m[1]), Number(m[2]));
    }
    return at;
  }
  return null;
}


// ── Forward projection (calendar, agenda, schedule-preview) ─────────────────
// The scheduler above answers "is this job due RIGHT NOW". A calendar needs the forward-looking view of
// the SAME parser, timezone rules, DST identity and active-hours gate — one representation for the
// scheduler and the preview, never a second approximation that could quietly disagree with a run.
// IMPORTANT: calRequests an agenda must be able to paginate IN PLACE while jobs run. This module is
// the only representation; the scheduler keeps its semantics unchanged.
export const CALENDAR_MAX_SAMPLES_PER_DAY = 3;
export const CALENDAR_LIMIT_AGENDA_DEFAULT = 100;
export const CALENDAR_AGENDA_MAX_OCCURRENCES = 250;
export const CALENDAR_CANDIDATE_BUDGET = 100_000;

/** Resolve a LOCAL wall clock (YYYY-MM-DD + HH:mm) in `timezone` DST-truthfully:
 *  - a time that does not exist (the spring gap) is REJECTED, never coerced;
 *  - a time that happens twice (the fall-back repeated hour) resolves to the EARLIER instant,
 *    or to `later` when the caller asks explicitly.
 *  Returns { ms, ambiguous } on success, or { error: 'nonexistent' | 'invalid' }. */
export function resolveLocalDateTime(timezone, date, time, disambiguation = 'earlier') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date ?? '')) || !/^([01]?\d|2[0-3])[:.]([0-5]\d)$/.test(String(time ?? ''))) {
    return { error: 'invalid' };
  }
  const [y, mo, d] = String(date).split('-').map(Number);
  const [h, mi] = String(time).replace(':', '.').split('.').map(Number);
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  // Real zone offsets stay within about ±26h of naive UTC and shift in quarter-hour steps at most;
  // scanning that span in 15-minute steps collects every instant whose wall clock reads exactly the
  // requested time: one on an ordinary day, two inside the repeated fall hour, none in the spring gap.
  const matches = [];
  for (let offset = -26 * 3_600_000; offset <= 26 * 3_600_000; offset += 900_000) {
    const candidate = naive - offset;
    const p = zonedParts(candidate, timezone);
    if (p.year === y && p.month === mo && p.day === d && p.hour === h && p.minute === mi) {
      if (matches.length === 0 || matches[matches.length - 1] !== candidate) matches.push(candidate);
    }
  }
  if (matches.length === 0) return { error: 'nonexistent' };
  if (matches.length === 1) return { ms: matches[0], ambiguous: false };
  // The scan walks offsets low-to-high, so it collected instants later-to-earlier; the SAME wall
  // clock can happen twice across a fall-back, and the default resolution is the earliest instant.
  matches.sort((a, b) => a - b);
  const ms = disambiguation === 'later' ? matches[matches.length - 1] : matches[0];
  return { ms, ambiguous: true };
}

/** A job's optional cheap guard: a guarded occurrence runs the check first and may SKIP the AI turn.
 *  The calendar must say only that the turn MAY be skipped, never promise a run. */
const hasGuard = (job) => typeof job?.check === 'string' && !!job.check.trim();

/** Iterate LOCAL dates [fromMs, untilMs] in `timezone`, inclusive, in order. Each step yields the
 *  date's wall-clock fields (year, month, day, weekday). UTC date arithmetic on the triple, read on
 *  the zone's formatter — never 24h arithmetic, which a DST boundary would shift. */
function localDates(fromMs, untilMs, timezone) {
  const from = zonedParts(fromMs, timezone);
  const to = zonedParts(untilMs, timezone);
  const dates = [];
  let y = from.year; let mo = from.month; let d = from.day;
  for (;;) {
    // A slot built at noon local reads the date's own weekday without second-guessing DST edges.
    const weekday = zonedParts(zonedTimeToMs(timezone, y, mo, d, 12, 0), timezone).weekday;
    dates.push({ year: y, month: mo, day: d, weekday });
    if (y === to.year && mo === to.month && d === to.day) return dates;
    d += 1;
    if (d > new Date(Date.UTC(y, mo, 0)).getUTCDate()) { d = 1; mo += 1; if (mo > 12) { mo = 1; y += 1; } }
  }
}

/** The earliest minute at or after `slot` when the job may run (its own minute when already inside
 *  active hours, otherwise the first later minute whose wall hour qualifies), or null when the hours
 *  gate would never open again inside the same span. */
function expectedInstant(slotMs, hours, timezone) {
  if (inHours(hours, slotMs, timezone)) return slotMs;
  let cursor = slotMs + 60_000;
  const far = slotMs + 24 * 3_600_000;
  while (cursor <= far) {
    if (inHours(hours, cursor, timezone)) return cursor;
    cursor += 60_000;
  }
  return null;
}

// The wall-clock labels occurrences carry: the local date ("2026-10-25") and local time ("02:30")
// as the configured zone renders them.
const pad2 = (n) => String(n).padStart(2, '0');
export const localDateLabel = (ms, timezone) => {
  const p = zonedParts(ms, timezone);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
};
const localTimeLabel = (ms, timezone) => {
  const p = zonedParts(ms, timezone);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
};
// The scheduler's own default tick, in ms: the precision the projection declares.
export const DEFAULT_TICK_MS = 30_000;
/** One wall-clock minute on ONE local date, resolved DST-truthfully: the instant whose fields
 *  render exactly that wall clock, narrowed to the EARLIER instant when the repeated fall-back hour
 *  carries it twice. Null when the wall clock does not exist that day (the spring gap) — the
 *  scheduler's own dueSlot skips it too, so the projection must. */
function localSlotInstant(timezone, date, hour, minute) {
  const slot = zonedTimeToMs(timezone, date.year, date.month, date.day, hour, minute);
  const p = zonedParts(slot, timezone);
  if (p.year !== date.year || p.month !== date.month || p.day !== date.day
    || p.hour !== hour || p.minute !== minute) return null;
  // The repeated fall hour: the same wall clock one real hour earlier is another instant with the
  // SAME slot key, so the occurrence identity is unchanged either way; the earlier instant wins.
  const before = zonedParts(slot - 3_600_000, timezone);
  if (before.year === date.year && before.month === date.month && before.day === date.day
    && before.hour === hour && before.minute === minute) return slot - 3_600_000;
  return slot;
}

/** THE one bounded forward expansion. The scheduler answers "is this job due RIGHT NOW"; the
 *  calendar needs the forward view of the SAME parser, timezone rules, DST identity and
 *  active-hours gate, so this is the only occurrence representation. */
function slotOccurrence(job, timezone, kind, slotMs, expectedMs, disposition) {
  return {
    id: kind === 'oneShot' ? `${job.id}:once`
      : kind === 'interval' ? `${job.id}:instant:${slotMs}`
      : `${job.id}:slot:${slotKey(slotMs, timezone)}`,
    jobId: job.id,
    lifecycle: kind === 'oneShot' ? 'oneShot' : 'recurring',
    scheduledAt: new Date(slotMs).toISOString(),
    expectedAt: new Date(expectedMs).toISOString(),
    localDate: localDateLabel(slotMs, timezone),
    localTime: localTimeLabel(slotMs, timezone),
    timezone,
    disposition,
    guarded: hasGuard(job),
  };
}

/** Expand ONE stored job into its future occurrences between [opts.fromMs, opts.untilMs], inclusive.
 *
 *  Dispositions (the plan's vocabulary):
 *   - 'onTime'          the future occurrence fires as scheduled;
 *   - 'deferredByHours' active hours defer the run to a later instant inside the same window;
 *   - 'catchUp'         a slot or interval the scheduler would claim on its next tick — at most ONE
 *                       such occurrence (the latest-only lookback replay), never a backlog;
 *   - 'dueNow'          an interval whose duration elapsed NOW, or a one-shot whose time has come;
 *   - 'late'            a pending one-shot still stored well past its runAt.
 *
 *  `scheduledAt` never moves: it keeps the recurrence's own wall clock. `expectedAt` is the earliest
 *  instant the scheduler could claim it; `tickMs` is declared once as the precision interval. Slots a
 *  scheduler already claimed (lastSlot) do not appear — this is forward-looking, not run history.
 *  `opts.maxOccurrences` stops the walk after that many occurrences (a next-occurrence query asks
 *  for one; the calendar asks for a whole window), and `opts.budgetCap` bounds the candidate WORK
 *  (dates walked plus minutes searched) — past it, `truncated` is TRUE and the rest is not built.
 *  Returns { occurrences, truncated, omittedByHours, candidates }. */
export function planOccurrences(job, opts = {}) {
  const timezone = opts.timezone ?? systemZone();
  const nowMs = opts.nowMs ?? Date.now();
  const tickMs = opts.tickMs ?? DEFAULT_TICK_MS;
  const lookbackMs = opts.lookbackMs ?? DEFAULT_CRON_LOOKBACK_MS;
  const maxOccurrences = opts.maxOccurrences ?? Infinity;
  const cap = opts.budgetCap ?? Infinity;
  const occurrences = [];
  const omittedByHours = new Map(); // localDate -> count of slots the active hours can never open for
  let candidates = 0;
  let truncated = false;
  const spend = () => { candidates += 1; if (candidates > cap) truncated = true; };
  const omit = (slotMs) => {
    const key = localDateLabel(slotMs, timezone);
    omittedByHours.set(key, (omittedByHours.get(key) ?? 0) + 1);
  };
  const done = () => ({ occurrences, truncated, omittedByHours: [...omittedByHours], candidates });

  if (typeof job?.id !== 'string' || job.id === '') return { occurrences, truncated: false, omittedByHours: [], candidates: 0 };

  // ── One-shot: runAt is the whole story; presence on disk IS "pending" (a claimed one-shot deletes
  //    itself before the long turn, so a stored row past runAt is a real late wake-up — not history). ──
  if (typeof job.runAt === 'string') {
    const at = Date.parse(job.runAt);
    if (!Number.isNaN(at)) {
      occurrences.push(slotOccurrence(job, timezone, 'oneShot', at, Math.max(at, nowMs), at >= nowMs ? 'onTime'
        : (nowMs - at) <= tickMs ? 'dueNow' : 'late'));
    }
    return done();
  }

  const sched = parseSchedule(job.schedule);
  if (!sched) return done();

  // The catch-up floor: a PAST slot is catchable only while strictly newer than the last run AND
  // inside the lookback window — the replays the scheduler's own due logic would still perform.
  let anchor = typeof job.lastRun === 'string' && !Number.isNaN(Date.parse(job.lastRun))
    ? Date.parse(job.lastRun) : 0;
  const floor = Math.max(anchor, nowMs - lookbackMs);
  // The window's own start. A caller that names none plans from NOW, which is what every
  // next-occurrence query wants.
  const fromMs = opts.fromMs ?? nowMs;

  if (sched.kind === 'interval') {
    // An interval is a duration, not a wall clock, and `dueSlot` claims it when `now - lastRun >= ms`.
    // This branch is that same rule read forwards: AT MOST ONE already-elapsed claim (never a
    // backlog), then the duration stepping forward through the window.
    //
    // A row with no `lastRun` is what the scheduler reads as `last = 0`, i.e. due at the very next
    // tick. Anchoring it one whole duration back says exactly that, and keeps every later instant on
    // the same grid the claim will establish.
    if (anchor <= 0) anchor = nowMs - sched.ms;
    const elapsed = nowMs - anchor >= sched.ms;
    if (elapsed && fromMs <= nowMs && nowMs <= opts.untilMs) {
      spend();
      // The claim's own slot is the LATEST elapsed instant; an older one is superseded, exactly as the
      // scheduler supersedes it by claiming only once.
      const instant = anchor + Math.floor((nowMs - anchor) / sched.ms) * sched.ms;
      const open = inHours(job.hours, nowMs, timezone);
      const expected = open ? nowMs : expectedInstant(nowMs, job.hours, timezone);
      if (expected === null) omit(instant);
      else occurrences.push(slotOccurrence(job, timezone, 'interval', instant, expected, open ? 'catchUp' : 'deferredByHours'));
    }
    // Forward: every instant strictly after now that the window contains. `ceil` puts the first one at
    // or after the window start, so a window opening next month never reports an instant before it.
    let k = Math.max(1, Math.ceil((Math.max(fromMs, nowMs + 1) - anchor) / sched.ms));
    while (!truncated && occurrences.length < maxOccurrences) {
      spend();
      const instant = anchor + k * sched.ms;
      if (instant > opts.untilMs) break;
      const expected = inHours(job.hours, instant, timezone) ? instant : expectedInstant(instant, job.hours, timezone);
      if (expected === null) omit(instant);
      else occurrences.push(slotOccurrence(job, timezone, 'interval', instant, expected, expected === instant ? 'onTime' : 'deferredByHours'));
      k += 1;
    }
    return done();
  }

  // ── Slot schedules (daily / weekly / cron): walk LOCAL dates. The repeated fall-back hour stays
  //    ONE wall-clock slot (the earlier instant); a nonexistent spring-gap time simply never happens.
  const minuteValues = [...(sched.kind === 'cron' ? sched.minute : [sched.minute])].sort((a, b) => a - b);
  const hourValues = [...(sched.kind === 'cron' ? sched.hour : [sched.hour])].sort((a, b) => a - b);
  let lastPast = null; // the LATEST unclaimed past slot; earlier ones are superseded and never shown
  for (const date of localDates(fromMs, opts.untilMs, timezone)) {
    if (truncated || occurrences.length >= maxOccurrences) break;
    if (sched.kind === 'weekly' && date.weekday !== sched.day) { spend(); continue; }
    for (const hour of hourValues) {
      for (const minute of minuteValues) {
        if (truncated) break;
        const slot = localSlotInstant(timezone, date, hour, minute);
        spend();
        if (slot === null) continue;                     // a spring-gap time simply never happens
        if (job.lastSlot !== undefined && job.lastSlot === slotKey(slot, timezone)) continue; // already claimed: history
        if (slot < floor) continue;                      // already-run history, never returned
        if (slot < nowMs) { lastPast = slot; continue; } // remember the latest unclaimed past slot
        const when = inHours(job.hours, slot, timezone) ? slot : expectedInstant(slot, job.hours, timezone);
        if (when === null) { omit(slot); continue; }
        occurrences.push(slotOccurrence(job, timezone, 'slot', slot, when, when === slot ? 'onTime' : 'deferredByHours'));
        if (occurrences.length >= maxOccurrences) break;
      }
      if (occurrences.length >= maxOccurrences) break;
    }
  }
  if (lastPast !== null && !truncated && occurrences.length < maxOccurrences) {
    const when = inHours(job.hours, nowMs, timezone) ? nowMs : expectedInstant(nowMs, job.hours, timezone);
    if (when === null) omit(lastPast);
    else occurrences.push(slotOccurrence(job, timezone, 'slot', lastPast, Math.max(when, nowMs), 'catchUp'));
  }
  return done();
}

/** Stable occurrence sort: expectedAt first (the instant the agenda is ordered by), then the
 *  recurrence's own slot, then the job, then the occurrence identity - identical inputs sort
 *  identically forever, so a cursor position can never drift between pages. */
const sortKeyOf = (occ) => JSON.stringify([occ.expectedAt, occ.scheduledAt, occ.jobId, occ.id]);

export function sortOccurrences(list) {
  const field = (o) => [o.expectedAt, o.scheduledAt, o.jobId, o.id];
  return [...list].sort((a, b) => {
    const ka = field(a);
    const kb = field(b);
    for (let i = 0; i < ka.length; i += 1) {
      if (ka[i] === kb[i]) continue;
      return ka[i] < kb[i] ? -1 : 1;
    }
    return 0;
  });
}

/** paginateAgenda: one stable page of a sorted occurrence list, cut after `limit` items and, when
 *  `afterKey` (the last key of the previous page) is present, strictly AFTER that key. Truncated is
 *  truthful about the SAME list: another page exists NOW against this very snapshot. */
export function paginateAgenda(sorted, { limit, afterKey } = {}) {
  let started = afterKey === undefined;
  const page = [];
  for (const occ of sorted) {
    if (!started) {
      if (sortKeyOf(occ) === afterKey) started = true;
      continue;
    }
    page.push(occ);
    if (page.length >= limit) break;
  }
  const last = page.at(-1);
  const nextKey = last === undefined ? undefined : sortKeyOf(last);
  const truncated = page.length === limit && sorted.indexOf(last) + 1 < sorted.length;
  return { occurrences: page, nextKey, truncated };
}

const tomorrowLocal = (date) => {
  // Walk the DATE triple with UTC arithmetic on a normalized noon stamp: never 24h instants, which a
  // DST boundary would shift.
  const [y, mo, d] = date.split('-').map(Number);
  const utc = Date.UTC(y, mo - 1, d) + 86_400_000;
  const p = zonedParts(utc, 'UTC');
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
};

/** Day summaries for a month/agenda window: one row per local date from `startLocal` for `days`
 *  dates, each with a truthful total, up to `samples` sorted occurrences, the overflow count and the
 *  per-day count of slots the active hours could never open for.
 *
 *  `truncated` on a row means ONE thing: the expansion budget ran out while building this window, so
 *  the row's own `total` may be short of what the schedule really holds. It is NOT the "this day has
 *  more than it shows" signal — that is `overflow`, which is exact. A row therefore carries the
 *  window's budget verdict, because an exhausted budget stops the walk for the whole window and no
 *  single date can claim to have escaped it. */
export function summarizeDays(occurrences, { startLocal, days, samples = CALENDAR_MAX_SAMPLES_PER_DAY, omittedByHours = [], truncated = false }) {
  const detected = new Map();
  for (const { date, count } of omittedByHours) detected.set(date, (detected.get(date) ?? 0) + count);
  const groups = new Map();
  for (const occ of occurrences) {
    const date = occ.localDate;
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date).push(occ);
  }
  const rows = [];
  let cursor = startLocal;
  for (let i = 0; i < days; i += 1) {
    const day = groups.get(cursor) ?? [];
    rows.push({
      date: cursor,
      total: day.length,
      samples: day.slice(0, samples),
      overflow: Math.max(day.length - samples, 0),
      omittedByHours: detected.get(cursor) ?? 0,
      truncated,
    });
    cursor = tomorrowLocal(cursor);
  }
  return rows;
}
