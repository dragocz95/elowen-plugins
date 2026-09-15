/** The Automation day board, exercised the way a reader drives it: rendered against the REAL host
 *  stand-in runtime, answering the real day/create/run/delete routes through the fetch boundary a
 *  shipped bundle actually talks to.
 *
 *  These are behaviour assertions, not structure ones. What they pin is the thing the redesign exists
 *  to guarantee and that a refactor could silently take away: a day drawn as a DAY — an hour gutter,
 *  a band per hour, a block in the band it runs in and a now line — with every job on it AT MOST
 *  ONCE, a high-frequency poll read as a rate in its own lane instead of as hundreds of runs, an
 *  initial load that asks for no range at all, filters that never re-query, ONE host modal holding
 *  the real calendar, the drawer reached from a block, explicit creation of both lifecycles,
 *  recurring filing that blocks the submit until a conversation is chosen, revision conflicts, pause
 *  rollback, a durable run-now, and a deep link that cannot tell a deleted job from a foreign one.
 */
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import type { PluginUiRegistration } from 'elowen-plugin-ui-kit';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse, listen, resetHandlers, setDefaults, use, close } from './ui/http';
import { ensurePluginUiRuntime } from './ui/hostRuntime';
import { ToastProvider, createWrapper } from './ui/hostHooks';
import { DayBoard } from '../plugins/cronjob/web-src/DayBoard';
import {
  runtime, apiErrorCode, apiErrorConflict, apiErrorCurrent, localDateLabel,
  type CronJob, type CronDayRow,
} from '../plugins/cronjob/web-src/runtime';
import {
  parseActiveHours, parseBuilderSchedule, renderActiveHours, renderBuilderSchedule,
} from '../plugins/cronjob/web-src/scheduleBuilder';
import manifest from '../plugins/cronjob/elowen-plugin.json' with { type: 'json' };

ensurePluginUiRuntime();

const strings = (manifest as { web: { strings: Record<string, string> } }).web.strings;
const manifestApiVersion = (manifest as { web: { requiresApiVersion: number } }).web.requiresApiVersion;
const TZ = 'Europe/Prague';
/** The scheduler's own today and wall clock. The board is TOLD both and derives neither. */
const TODAY = '2026-09-15';
const NOW_LOCAL = '10:20';

// ── fixtures ─────────────────────────────────────────────────────────────────────────────────────

const recurring: CronJob = {
  id: 'job-daily', name: 'Morning digest', schedule: 'daily 07:30', prompt: 'summarize',
  enabled: true, ownerUserId: 7, lifecycle: 'recurring', revision: 3, manualQueued: false,
  conversationSessionId: 'conv-1',
  nextOccurrence: {
    occurrenceId: 'job-daily:slot:2026-09-15T07:30', scheduledAt: '2026-09-15T05:30:00.000Z',
    expectedAt: '2026-09-15T05:30:00.000Z', localDate: TODAY, localTime: '07:30',
    timezone: TZ, disposition: 'onTime', guarded: false,
  },
};
const oneShot: CronJob = {
  id: 'job-once', name: 'Check invoices', schedule: 'one-shot', prompt: 'check',
  enabled: true, ownerUserId: 7, lifecycle: 'oneShot', revision: 1, runAt: '2026-09-15T16:00:00.000Z',
  nextOccurrence: {
    occurrenceId: 'job-once:once', scheduledAt: '2026-09-15T16:00:00.000Z',
    expectedAt: '2026-09-15T16:00:00.000Z', localDate: TODAY, localTime: '18:00',
    timezone: TZ, disposition: 'onTime', guarded: false,
  },
};
/** The job that broke the month view: a two-minute poll is 720 runs a day, and a real instance holds
 *  dozens of them. On this board it is ONE row that names its rate. */
const poll: CronJob = {
  id: 'job-poll', name: 'Inbox poll', schedule: 'every 2m', prompt: 'poll',
  enabled: true, ownerUserId: 7, lifecycle: 'recurring', revision: 1,
};
const paused: CronJob = {
  id: 'job-paused', name: 'Weekly report', schedule: 'weekly mon 09:00', prompt: 'report',
  enabled: false, ownerUserId: 7, lifecycle: 'recurring', revision: 1,
};

const row = (over: Partial<CronDayRow> & { jobId: string }): CronDayRow => ({
  section: 'next',
  kind: 'daily',
  schedule: 'daily 07:30',
  enabled: true,
  remaining: 1,
  next: {
    occurrenceId: `${over.jobId}:slot:1`, scheduledAt: '2026-09-15T05:30:00.000Z',
    expectedAt: '2026-09-15T05:30:00.000Z', localTime: '07:30', disposition: 'onTime', guarded: false,
  },
  moreTimes: [],
  truncated: false,
  ...over,
});

/** A day with all three kinds on it: a fixed-time job that runs three times, a one-shot in the
 *  evening, a two-minute poll and a paused recurrence. */
const DEFAULT_ROWS: CronDayRow[] = [
  row({ jobId: 'job-daily', remaining: 3, moreTimes: ['12:00', '18:30'] }),
  row({
    jobId: 'job-poll', section: 'recurring', kind: 'interval', schedule: 'every 2m', remaining: 720,
    next: { occurrenceId: 'job-poll:instant:1', scheduledAt: '2026-09-15T08:22:00.000Z', expectedAt: '2026-09-15T08:22:00.000Z', localTime: '10:22', disposition: 'onTime', guarded: false },
  }),
  row({
    jobId: 'job-once', section: 'oneShot', kind: 'oneShot', schedule: null,
    next: { occurrenceId: 'job-once:once', scheduledAt: '2026-09-15T16:00:00.000Z', expectedAt: '2026-09-15T16:00:00.000Z', localTime: '18:00', disposition: 'onTime', guarded: false },
  }),
  row({
    jobId: 'job-paused', section: 'recurring', kind: 'weekly', schedule: 'weekly mon 09:00',
    enabled: false, remaining: 0, next: null,
  }),
];

interface DayOptions {
  jobs?: CronJob[];
  rows?: CronDayRow[];
  localDate?: string;
  truncated?: boolean;
}

const dayBody = (opts: DayOptions = {}) => ({
  generatedAt: '2026-09-15T08:20:00.000Z',
  todayLocalDate: TODAY,
  nowLocalTime: NOW_LOCAL,
  localDate: opts.localDate ?? TODAY,
  timezone: TZ,
  precisionMs: 30_000,
  scheduler: { ready: true },
  jobs: opts.jobs ?? [recurring, oneShot, poll, paused],
  rows: opts.rows ?? DEFAULT_ROWS,
  truncated: opts.truncated ?? false,
});

const serveDay = (opts: DayOptions | ((url: URL) => DayOptions) = {}) =>
  http.get('/api/plugins/cronjob/api/day', ({ url }) => {
    const resolved = typeof opts === 'function' ? opts(url) : opts;
    const asked = url.searchParams.get('date');
    return HttpResponse.json(dayBody({ localDate: asked ?? TODAY, ...resolved }));
  });

setDefaults(
  http.get('/api/plugins/ui', () => HttpResponse.json([{ name: 'cronjob', url: '/plugins/cronjob/web/index.js', apiVersion: 17, nav: [], settings: [], strings }])),
  http.get('/api/auth/me', () => HttpResponse.json({ user: { id: 7, username: 'filip', is_admin: true } })),
  http.get('/api/plugins/destinations', () => HttpResponse.json([])),
  http.get('/api/brain/models', () => HttpResponse.json([])),
  http.get('/api/projects', () => HttpResponse.json([])),
  http.get('/api/plugins/cronjob/api/conversations', () => HttpResponse.json({
    status: 'available',
    conversations: [{ id: 'conv-1', title: 'Ops chat', ownerUserId: 7, platform: null, direct: false, updatedAt: '2026-09-01T00:00:00.000Z' }],
  })),
  http.get('/api/plugins/cronjob/jobs', () => HttpResponse.json([recurring, oneShot])),
  serveDay(),
);

beforeAll(() => listen());
beforeEach(() => { window.history.replaceState({}, '', '/p/cronjob'); });
afterEach(() => { cleanup(); resetHandlers(); vi.useRealTimers(); });
afterAll(() => close());

/** The phone/coarse-pointer answer `useMobile` reads. jsdom has no media engine, so this IS the seam. */
function setViewport(mobile: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true, configurable: true,
    value: (query: string) => ({
      matches: mobile && query.includes('max-width'),
      media: query, onchange: null,
      addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    }),
  });
}

function renderPage() {
  const { wrapper: Wrapper, client } = createWrapper();
  return { ...render(<Wrapper><ToastProvider><DayBoard /></ToastProvider></Wrapper>), client };
}

/** The control a reader clicks to open a job. Each job has exactly one on the board — that is the
 *  invariant, so `findByRole` (which throws on a second match) is itself part of the assertion. */
const occurrenceCard = async (name: string): Promise<HTMLElement> =>
  await screen.findByRole('button', { name: strings.openJob.replace('{name}', name) });

/** The page has painted when the first day landed. */
const awaitPainted = () => screen.findByTestId('cron-day-board');

// ── the day, drawn as a day ──────────────────────────────────────────────────────────────────────

describe('the day rail', () => {
  beforeEach(() => setViewport(false));

  it('draws an hour gutter with a band per hour and each job in the band it runs in', async () => {
    renderPage();
    await awaitPainted();
    const rail = await screen.findByTestId('cron-day-rail');

    // An hour gutter that reads as a day: a labelled band for every hour the day spans, including the
    // empty ones between its appointments. A list with headings has none of this.
    const bands = Array.from(rail.children);
    expect(bands.length).toBe(12); // 07:00 through 18:00 inclusive, nothing skipped
    const gutter = bands.map((band) => band.firstElementChild?.textContent);
    expect(gutter[0]).toBe('07:00');
    expect(gutter).toContain('10:00');   // an hour with nothing scheduled still holds its band
    expect(gutter.at(-1)).toBe('18:00');

    // Each job sits INSIDE its own hour, not in a flat column under a heading.
    const sevenBand = screen.getByTestId('cron-hour-07');
    expect(within(sevenBand).getByTestId('cron-row-job-daily')).toBeInTheDocument();
    const eighteenBand = screen.getByTestId('cron-hour-18');
    expect(within(eighteenBand).getByTestId('cron-row-job-once')).toBeInTheDocument();
  });

  it('marks the current moment on the rail, and only on today', async () => {
    renderPage();
    await awaitPainted();
    // 10:20 lands a third of the way down the 10:00 band.
    const now = await screen.findByTestId('cron-now-line');
    expect(screen.getByTestId('cron-hour-10').contains(now)).toBe(true);
    expect(now.style.top).toBe(`${(20 / 60) * 100}%`);

    cleanup();
    use(serveDay({ localDate: '2026-09-18' }));
    renderPage();
    await awaitPainted();
    // Another day has no "now" on it: a now line on a future date would be a lie about the clock.
    await waitFor(() => expect(screen.queryByTestId('cron-now-line')).toBeNull());
  });

  it('draws a two-minute poll ONCE, as a rate in its own lane, never as a run per occurrence', async () => {
    renderPage();
    await awaitPainted();

    // THE invariant. 720 runs a day is exactly what buried the old month view.
    const all = screen.getAllByTestId(/^cron-row-/);
    expect(all).toHaveLength(DEFAULT_ROWS.length);
    expect(new Set(all.map((el) => el.getAttribute('data-testid'))).size).toBe(all.length);

    const lane = await screen.findByTestId('cron-recurring-lane');
    const pollRow = within(lane).getByTestId('cron-row-job-poll');
    // The rate and the count, in words: the poll is described rather than enumerated.
    expect(within(pollRow).getByText('every 2m')).toBeInTheDocument();
    expect(within(pollRow).getByText(strings.boardRemaining.replace('{n}', '720'))).toBeInTheDocument();
    // And it is NOT on the timed rail, where it would bury every real appointment.
    expect(within(screen.getByTestId('cron-day-rail')).queryByTestId('cron-row-job-poll')).toBeNull();
  });

  it('names a job several further times inside its own block instead of drawing it again', async () => {
    renderPage();
    await awaitPainted();
    const block = screen.getByTestId('cron-row-job-daily');
    expect(within(block).getByTestId('cron-times-job-daily').textContent)
      .toBe(strings.boardAlsoAt.replace('{times}', '12:00 · 18:30'));
    // Three runs today, one block. The other two are named, not re-drawn.
    expect(screen.getAllByTestId('cron-row-job-daily')).toHaveLength(1);
  });

  it('keeps a paused job on today board with its state in words', async () => {
    renderPage();
    await awaitPainted();
    const lane = await screen.findByTestId('cron-recurring-lane');
    const pausedRow = within(lane).getByTestId('cron-row-job-paused');
    expect(within(pausedRow).getByText(strings.paused)).toBeInTheDocument();
    expect(within(pausedRow).getByText('weekly mon 09:00')).toBeInTheDocument();
    // Paused says everything: the row carries no next time and claims no runs left.
    expect(within(pausedRow).getByText('—')).toBeInTheDocument();
    expect(within(pausedRow).queryByText(strings.boardRemaining.replace('{n}', '0'))).toBeNull();
  });
});

// ── what the board asks the server for ───────────────────────────────────────────────────────────

describe('the board network contract', () => {
  beforeEach(() => setViewport(false));

  it('asks for NO range on the initial load, and for exactly one date after that', async () => {
    const asked: string[] = [];
    use(http.get('/api/plugins/cronjob/api/day', ({ url }) => {
      asked.push(url.search);
      return HttpResponse.json(dayBody({ localDate: url.searchParams.get('date') ?? TODAY }));
    }));
    renderPage();
    await awaitPainted();

    // The first request carries nothing at all: no start, no days, no detail, no cursor. A month or a
    // week cannot be asked for by accident, because there is no range in the contract to ask with.
    await waitFor(() => expect(asked.length).toBeGreaterThan(0));
    expect(asked[0]).toBe('');
    for (const search of asked) {
      const params = new URLSearchParams(search);
      expect([...params.keys()].filter((k) => k !== 'date')).toEqual([]);
    }
  });

  it('reads one other day through ONE host modal holding the real calendar, and comes back', async () => {
    const asked: string[] = [];
    use(http.get('/api/plugins/cronjob/api/day', ({ url }) => {
      asked.push(url.searchParams.get('date') ?? '');
      return HttpResponse.json(dayBody({ localDate: url.searchParams.get('date') ?? TODAY }));
    }));
    renderPage();
    await awaitPainted();
    // The host Modal has no `open` prop: not-open MUST mean not mounted.
    expect(screen.queryByTestId('calendar-grid')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: strings.boardOtherDay }));
    const grid = await screen.findByTestId('calendar-grid');
    expect(screen.getAllByTestId('calendar-grid')).toHaveLength(1);
    // Nothing else nests inside the date chooser — a creation form here would be a second surface.
    expect(screen.queryByTestId('cron-create-form')).toBeNull();

    // A real day cell, not the month chevrons beside the grid: choosing a date is what closes it.
    const cell = within(grid).getAllByRole('gridcell')[10]!;
    const chosen = cell.getAttribute('data-day')!;
    fireEvent.click(within(cell).getByRole('button'));
    await waitFor(() => expect(screen.queryByTestId('calendar-grid')).toBeNull());
    // Exactly ONE day was fetched, for exactly the date chosen — never a window around it.
    await waitFor(() => expect(asked.filter((d) => d !== '')).toEqual([chosen]));

    fireEvent.click(await screen.findByRole('button', { name: strings.calToday }));
    await waitFor(() => expect(screen.getByTestId('cron-day-heading').textContent)
      .toBe(new Intl.DateTimeFormat('en', { weekday: 'long', day: 'numeric', month: 'long' })
        .format(new Date(2026, 8, 15))));
  });

  it('narrows already-loaded rows without asking the server again', async () => {
    let calls = 0;
    use(http.get('/api/plugins/cronjob/api/day', ({ url }) => {
      calls += 1;
      return HttpResponse.json(dayBody({ localDate: url.searchParams.get('date') ?? TODAY }));
    }));
    renderPage();
    await awaitPainted();
    await waitFor(() => expect(calls).toBeGreaterThan(0));
    const before = calls;

    fireEvent.change(screen.getByPlaceholderText(strings.searchPlaceholder), { target: { value: 'inbox' } });
    await waitFor(() => expect(screen.queryByTestId('cron-row-job-daily')).toBeNull());
    expect(screen.getByTestId('cron-row-job-poll')).toBeInTheDocument();
    // The board is one bounded row per job, so a filter has nothing left to fetch.
    expect(calls).toBe(before);
  });
});

// ── the phone ────────────────────────────────────────────────────────────────────────────────────

describe('the phone surface', () => {
  beforeEach(() => setViewport(true));

  it('is the same vertical day planner, with no week strip and no second date control', async () => {
    renderPage();
    await awaitPainted();
    // One day planner, with its real hour bands — not a stripped-down list and not a 7-day swipe.
    expect(await screen.findByTestId('cron-day-rail')).toBeInTheDocument();
    expect(screen.getByTestId('cron-hour-07')).toBeInTheDocument();
    expect(screen.queryByTestId('cron-day-strip')).toBeNull();
    // ONE way to reach another day, the same one the desktop has.
    expect(screen.getAllByRole('button', { name: strings.boardOtherDay })).toHaveLength(1);
  });
});

// ── the drawer, reached from an occurrence ───────────────────────────────────────────────────────

describe('the job drawer', () => {
  beforeEach(() => setViewport(false));

  const openDrawer = async (name = recurring.name) => {
    const rendered = renderPage();
    await awaitPainted();
    fireEvent.click(await occurrenceCard(name));
    await screen.findByText(strings.nextRun);
    return rendered;
  };

  it('opens the job an agenda occurrence names and puts it in the address', async () => {
    await openDrawer();
    expect(window.location.search).toBe('?job=job-daily');
    // The next occurrence is the SERVER's projection, in the scheduler timezone.
    expect(screen.getByTestId('cron-next-run').textContent).toContain(`${TODAY} 07:30 · ${TZ}`);
    expect(screen.getByText(strings.lastStarted)).toBeInTheDocument();
  });

  it('keeps the edit and offers a retry when the server refuses the revision', async () => {
    use(http.put('/api/plugins/cronjob/jobs/:id', () => HttpResponse.json({
      error: 'job changed on the server; reload it before saving',
      conflict: true, code: 'revision_conflict', current: { ...recurring, revision: 9 },
    }, { status: 409 })));
    await openDrawer();
    const nameInput = await screen.findByPlaceholderText('morning-digest');
    fireEvent.change(nameInput, { target: { value: 'renamed digest' } });
    // The refusal is announced and the user's text is still there to retry with.
    await screen.findByText(new RegExp(strings.saveError, 'i'), {}, { timeout: 3000 });
    expect(nameInput).toHaveValue('renamed digest');
  });

  it('rolls a pause back to its previous state when the write is refused', async () => {
    use(http.put('/api/plugins/cronjob/jobs/:id', () => HttpResponse.json(
      { error: 'forbidden', code: 'forbidden' }, { status: 403 })));
    await openDrawer();
    const toggle = await screen.findByRole('switch', { name: `${recurring.name}: ${strings.enabled}` });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('button', { name: strings.pauseLabel }));
    await screen.findByText(new RegExp(strings.saveError, 'i'), {}, { timeout: 3000 });
    // The optimistic pause is undone: the drawer must not claim a state the server rejected.
    await waitFor(() => expect(screen.getByRole('switch', { name: `${recurring.name}: ${strings.enabled}` }))
      .toHaveAttribute('aria-checked', 'true'));
  });

  it('sends a durable run-now with a request id and a revision, then watches the queue closely', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const runs: Record<string, unknown>[] = [];
    let queued = false;
    let summaryCalls = 0;
    use(
      http.get('/api/plugins/cronjob/api/day', () => {
        summaryCalls += 1;
        return HttpResponse.json(dayBody({ jobs: [{ ...recurring, manualQueued: queued }, oneShot, poll, paused] }));
      }),
      http.post('/api/plugins/cronjob/jobs/:id/run', async ({ request }) => {
        runs.push(await request.json() as Record<string, unknown>);
        queued = true;
        return HttpResponse.json({ ok: true }, { status: 202 });
      }),
    );
    await openDrawer();
    fireEvent.click(await screen.findByRole('button', { name: strings.runNow }));
    await waitFor(() => expect(runs).toHaveLength(1));
    expect(typeof runs[0]!.requestId).toBe('string');
    expect(runs[0]!.expectedRevision).toBe(3);

    // While the request is queued the page reads the day at the fast cadence, not the 30s one.
    const before = summaryCalls;
    await vi.advanceTimersByTimeAsync(6_500);
    expect(summaryCalls).toBeGreaterThan(before + 1);

    // Once the tick claims it, the fast cadence stops on its own.
    queued = false;
    await vi.advanceTimersByTimeAsync(4_000);
    const settled = summaryCalls;
    await vi.advanceTimersByTimeAsync(6_500);
    expect(summaryCalls).toBe(settled);
  });

  it('never offers run-now for a pending one-shot', async () => {
    await openDrawer(oneShot.name);
    expect(screen.queryByRole('button', { name: strings.runNow })).toBeNull();
  });

  it('closes the drawer, clears the address and leaves the opener standing after a delete', async () => {
    const deleted: string[] = [];
    use(http.delete('/api/plugins/cronjob/jobs/:id', ({ params }) => {
      deleted.push(params.id!);
      return HttpResponse.json({ ok: true });
    }));
    renderPage();
    await awaitPainted();
    const opener = await occurrenceCard(recurring.name);
    fireEvent.click(opener);
    await screen.findByText(strings.nextRun);
    fireEvent.click(screen.getByRole('button', { name: strings.removeJob }));
    // The confirmation is the host's own dialog; the second control by that name is its confirm.
    const confirms = await screen.findAllByRole('button', { name: strings.removeJob });
    fireEvent.click(confirms.at(-1)!);

    await waitFor(() => expect(screen.queryByText(strings.nextRun)).toBeNull());
    await waitFor(() => expect(deleted).toEqual([recurring.id]));
    // The deep-link parameter goes with it, and the control the drawer was raised from is still there
    // to receive focus back. Restoring that focus is the HOST Modal's contract, exercised for real in
    // the Playwright keyboard journey rather than against a stand-in that does not implement it.
    expect(window.location.search).toBe('');
    expect(await occurrenceCard(recurring.name)).toBeInTheDocument();
  });
});

// ── creation ─────────────────────────────────────────────────────────────────────────────────────

describe('creating work', () => {
  beforeEach(() => setViewport(false));

  it('submits a one-shot as a LOCAL date and time, with no conversation filing at all', async () => {
    const posts: Record<string, unknown>[] = [];
    use(http.post('/api/plugins/cronjob/jobs', async ({ request }) => {
      const body = await request.json() as Record<string, unknown>;
      posts.push(body);
      return HttpResponse.json({ ok: true, job: { ...oneShot, id: 'created-1' }, revision: 1 }, { status: 201 });
    }));
    renderPage();
    await awaitPainted();
    fireEvent.click(screen.getByRole('button', { name: strings.createOneShot }));
    await screen.findByTestId('cron-create-form');

    // Filing is a RECURRING concept; a one-shot form must not even offer it.
    expect(screen.queryByLabelText(strings.conversationManage)).toBeNull();
    const submit = screen.getByRole('button', { name: strings.createOneShotSubmit });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('verify-deploy'), { target: { value: 'verify deploy' } });
    fireEvent.change(screen.getAllByRole('textbox').at(-1)!, { target: { value: 'check the release' } });
    fireEvent.change(screen.getByLabelText(strings.date), { target: { value: '2026-09-16' } });
    fireEvent.change(screen.getByLabelText(strings.time), { target: { value: '11:15' } });
    await waitFor(() => expect(screen.getByRole('button', { name: strings.createOneShotSubmit })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: strings.createOneShotSubmit }));

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({
      lifecycle: 'oneShot', scope: 'personal',
      localRunAt: { date: '2026-09-16', time: '11:15' },
    });
    // The browser computed no instant, and burned exactly one request id.
    expect(posts[0]!.runAt).toBeUndefined();
    expect(typeof posts[0]!.requestId).toBe('string');
    expect(posts[0]!.conversationSessionId).toBeUndefined();
  });

  it('blocks a recurring submit until a conversation is chosen in the shared picker', async () => {
    const posts: Record<string, unknown>[] = [];
    use(http.post('/api/plugins/cronjob/jobs', async ({ request }) => {
      posts.push(await request.json() as Record<string, unknown>);
      return HttpResponse.json({ ok: true, job: { ...recurring, id: 'created-2' }, revision: 1 }, { status: 201 });
    }));
    renderPage();
    await awaitPainted();
    fireEvent.click(screen.getByRole('button', { name: strings.createRecurring }));
    await screen.findByTestId('cron-create-form');

    fireEvent.change(screen.getByPlaceholderText('morning-digest'), { target: { value: 'nightly sweep' } });
    fireEvent.change(screen.getAllByRole('textbox').at(-1)!, { target: { value: 'sweep the queue' } });
    // Everything but the filing is answered — the submit is still refused, and says why.
    expect(screen.getByRole('button', { name: strings.createRecurringSubmit })).toBeDisabled();
    expect(screen.getByText(strings.conversationRequired)).toBeInTheDocument();

    // ONE centered picker — the host's shared ManageSelectionModal, not a second chooser.
    fireEvent.click(screen.getByLabelText(strings.conversationManage));
    const picker = (await screen.findByText('Ops chat')).closest('[role="dialog"]')!;
    fireEvent.click(await screen.findByText('Ops chat'));
    fireEvent.click(within(picker as HTMLElement).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(screen.getByRole('button', { name: strings.createRecurringSubmit })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: strings.createRecurringSubmit }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ lifecycle: 'recurring', conversationSessionId: 'conv-1' });
  });

  it('opens the created job rather than leaving the reader on an unchanged page', async () => {
    use(http.post('/api/plugins/cronjob/jobs', () => HttpResponse.json(
      { ok: true, job: recurring, revision: 1 }, { status: 201 })));
    renderPage();
    await awaitPainted();
    fireEvent.click(screen.getByRole('button', { name: strings.createOneShot }));
    await screen.findByTestId('cron-create-form');
    fireEvent.change(screen.getByPlaceholderText('verify-deploy'), { target: { value: 'x' } });
    fireEvent.change(screen.getAllByRole('textbox').at(-1)!, { target: { value: 'y' } });
    fireEvent.change(screen.getByLabelText(strings.date), { target: { value: '2026-09-16' } });
    fireEvent.change(screen.getByLabelText(strings.time), { target: { value: '11:15' } });
    fireEvent.click(await screen.findByRole('button', { name: strings.createOneShotSubmit }));
    await screen.findByText(strings.nextRun);
    expect(window.location.search).toBe('?job=job-daily');
  });
});

// ── deep links ───────────────────────────────────────────────────────────────────────────────────

describe('deep links', () => {
  beforeEach(() => setViewport(false));

  it('opens the job a link names', async () => {
    window.history.replaceState({}, '', '/p/cronjob?job=job-daily');
    renderPage();
    await screen.findByText(strings.nextRun);
  });

  it('gives a deleted and a foreign id the SAME unavailable answer, never a drawer', async () => {
    window.history.replaceState({}, '', '/p/cronjob?job=someone-elses');
    renderPage();
    await awaitPainted();
    expect(await screen.findByText(strings.linkUnavailable)).toBeInTheDocument();
    expect(screen.queryByText(strings.nextRun)).toBeNull();
  });

  it('falls back to the same unavailable state when an open job disappears under the reader', async () => {
    let present = true;
    use(http.get('/api/plugins/cronjob/api/day', () => HttpResponse.json(dayBody({
      jobs: present ? [recurring, oneShot] : [oneShot],
      rows: present ? DEFAULT_ROWS : DEFAULT_ROWS.filter((r) => r.jobId !== 'job-daily'),
    }))));
    window.history.replaceState({}, '', '/p/cronjob?job=job-daily');
    const { client } = renderPage();
    await screen.findByText(strings.nextRun);
    present = false;
    // The next day read no longer carries the row; the drawer must not render over `undefined`.
    await client.invalidateQueries({ queryKey: ['cron-day'] });
    await waitFor(() => expect(screen.queryByText(strings.nextRun)).toBeNull(), { timeout: 4000 });
    expect(await screen.findByText(strings.linkUnavailable)).toBeInTheDocument();
  });
});

// ── contracts that need no rendering ─────────────────────────────────────────────────────────────

describe('cronjob bundle registration', () => {
  it('targets the host API 17, keeps the single jobs section and the one-frame page declaration', async () => {
    let captured: Pick<PluginUiRegistration, 'requiresApiVersion' | 'settings' | 'ownsPageFrame'> | undefined;
    (window as unknown as { __elowenRegisterPluginUi?: (p: string, r: typeof captured) => void })
      .__elowenRegisterPluginUi = (_plugin, registration) => { captured = registration; };
    await import('../plugins/cronjob/web-src/index');
    if (!captured) throw new Error('the cronjob bundle registered no UI');
    expect(captured.requiresApiVersion).toBe(17);
    expect(Object.keys(captured.settings)).toEqual(['jobs']);
    expect(captured.ownsPageFrame).toEqual(['jobs']);
  });

  it('pairs the manifest it claims to serve: API 17, the workbench layout, and the strings the page reads', () => {
    expect(manifestApiVersion).toBe(17);
    expect((manifest as { web: { layout?: string } }).web.layout).toBe('workbench');
    for (const key of ['calMonthLabel', 'calToday', 'calMore', 'createOneShot',
      'createRecurring', 'nextRun', 'lastStarted', 'badgeLate', 'hoursTimeZone',
      'sectionDay', 'sectionRecurring', 'boardOtherDay', 'boardRemaining', 'boardAlsoAt',
      'boardNothingLeft', 'boardAtLeast', 'boardNoTimed', 'calDayPast']) {
      expect(Object.hasOwn(strings, key), `missing web.strings.${key}`).toBe(true);
    }
    // The month and agenda copy went with the views that used it: a string nothing reads is a string
    // three locales keep translating for nobody.
    for (const gone of ['calAgendaHeading', 'calDayAria', 'calAgendaRange', 'calAgendaMore',
      'calAgendaTruncated', 'calPrevWeek', 'calNextWeek', 'calViewTitle', 'calDatePicker']) {
      expect(Object.hasOwn(strings, gone), `orphaned web.strings.${gone}`).toBe(false);
    }
  });
});

describe('cronjob schedule builder', () => {
  it.each(['every 15m', 'every 2h', 'daily 07:30', 'weekly sun 20:00'])(
    'parses and renders %s through the scheduler grammar',
    (schedule) => {
      const parsed = parseBuilderSchedule(schedule);
      expect(parsed).not.toBeNull();
      expect(renderBuilderSchedule(parsed!)).toBe(schedule);
    },
  );

  it('accepts only whole-hour active windows within 0-23, overnight included', () => {
    expect(parseActiveHours('0-23')).toEqual({ start: 0, end: 23 });
    expect(parseActiveHours('22-5')).toEqual({ start: 22, end: 5 });
    expect(parseActiveHours('24-5')).toBeNull();
    expect(parseActiveHours('5:30-21')).toBeNull();
    expect(renderActiveHours(0, 23)).toBe('0-23');
  });
});

describe('the calendar wire helpers', () => {
  it('reads the machine error fields out of the host error, which carries them in `details`', () => {
    // The host rejects with an ElowenApiError whose `code` is the HUMAN line and whose `details` is the
    // parsed body. Reading the machine code off the error itself would find the sentence instead.
    const hostError = Object.assign(new Error('api 409 on /x'), {
      status: 409, code: 'job changed on the server; reload it before saving',
      details: { error: 'job changed', code: 'revision_conflict', conflict: true, current: { id: 'j1' } },
    });
    expect(apiErrorCode(hostError)).toBe('revision_conflict');
    expect(apiErrorConflict(hostError)).toBe(true);
    expect(apiErrorCurrent(hostError)?.id).toBe('j1');
    // A decoded body handed in directly still reads the same.
    expect(apiErrorCode({ error: 'x', code: 'revision_conflict' })).toBe('revision_conflict');
    expect(apiErrorCode(new Error('plain'))).toBeUndefined();
    expect(apiErrorCurrent({ current: null })).toBeUndefined();
  });

  it('narrowed to the runtime the host installs: Calendar present, browser cron validation not used', () => {
    expect(typeof runtime().components.Calendar).toBe('function');
    // Validity is the server's (schedule-preview); the compat helper stays for released bundles only.
    const here = dirname(fileURLToPath(import.meta.url));
    for (const file of ['DayBoard.tsx', 'fields.tsx', 'JobDrawer.tsx', 'CreateJobDialog.tsx']) {
      const source = resolve(here, '../plugins/cronjob/web-src/', file);
      expect(readFileSync(source, 'utf-8').includes('isValidSchedule'), basename(source)).toBe(false);
    }
  });

  it('formats the browser-local label a day grid cell needs, nothing more', () => {
    expect(localDateLabel(new Date(2026, 8, 15))).toBe('2026-09-15');
  });
});
