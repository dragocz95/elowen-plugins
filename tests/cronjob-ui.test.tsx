/** The Automation workbench, exercised the way a reader drives it: rendered against the REAL host
 *  stand-in runtime, answering the real calendar/create/run/delete routes through the fetch boundary a
 *  shipped bundle actually talks to.
 *
 *  These are behaviour assertions, not structure ones. What they pin is what the plan promised and
 *  what a refactor can silently take away: the day ledger and its `+N more`, ONE date modal that is
 *  mounted only while open, an agenda-first phone with a working day strip, an Agenda view that
 *  REPLACES the month grid, the drawer reached from an occurrence, explicit creation of both
 *  lifecycles, recurring filing that blocks the submit until a conversation is chosen, revision
 *  conflicts, pause rollback, a durable run-now, focus returning after a delete, and a deep link that
 *  cannot tell a deleted job from a foreign one.
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
import { CalendarPage } from '../plugins/cronjob/web-src/CalendarPage';
import {
  runtime, apiErrorCode, apiErrorConflict, apiErrorCurrent, localDateLabel,
  type CronJob, type CronOccurrence,
} from '../plugins/cronjob/web-src/runtime';
import {
  parseActiveHours, parseBuilderSchedule, renderActiveHours, renderBuilderSchedule,
} from '../plugins/cronjob/web-src/scheduleBuilder';
import manifest from '../plugins/cronjob/elowen-plugin.json' with { type: 'json' };

ensurePluginUiRuntime();

const strings = (manifest as { web: { strings: Record<string, string> } }).web.strings;
const manifestApiVersion = (manifest as { web: { requiresApiVersion: number } }).web.requiresApiVersion;
const TZ = 'Europe/Prague';
/** The scheduler's own today. The page adopts it from the summary and never derives one. */
const TODAY = '2026-09-15';
const MONTH_START = '2026-09-01';

// ── fixtures ─────────────────────────────────────────────────────────────────────────────────────

const occurrence = (jobId: string, date: string, time: string, over: Partial<CronOccurrence> = {}): CronOccurrence => ({
  id: `${jobId}:slot:${date}T${time}`,
  jobId,
  lifecycle: 'recurring',
  scheduledAt: `${date}T${time}:00.000Z`,
  expectedAt: `${date}T${time}:00.000Z`,
  localDate: date,
  localTime: time,
  timezone: TZ,
  disposition: 'onTime',
  guarded: false,
  ...over,
});

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

/** A day denser than the three samples a month cell shows: the `+N more` affordance has to be real. */
const denseSamples = [
  occurrence('job-daily', TODAY, '07:30'),
  occurrence('job-once', TODAY, '18:00', { lifecycle: 'oneShot', id: 'job-once:once' }),
  occurrence('job-daily', TODAY, '20:00'),
];

interface CalendarOptions {
  jobs?: CronJob[];
  occurrences?: CronOccurrence[];
  nextCursor?: string;
  truncated?: boolean;
  snapshot?: string;
}

const calendarBody = (detail: 'summary' | 'agenda', start: string, opts: CalendarOptions = {}) => {
  const jobs = opts.jobs ?? [recurring, oneShot];
  const common = {
    generatedAt: '2026-09-15T10:00:00.000Z',
    todayLocalDate: TODAY,
    timezone: TZ,
    precisionMs: 30_000,
    snapshot: opts.snapshot ?? 'snap-1',
    window: {
      startLocalDate: start, endLocalDateExclusive: '2026-10-01',
      startAt: '2026-08-31T22:00:00.000Z', endAt: '2026-09-30T22:00:00.000Z',
    },
    scheduler: { ready: true },
    jobs,
    truncated: opts.truncated ?? false,
  };
  if (detail === 'agenda') {
    return {
      ...common,
      occurrences: opts.occurrences ?? denseSamples,
      ...(opts.nextCursor ? { nextCursor: opts.nextCursor } : {}),
    };
  }
  return {
    ...common,
    days: [{
      date: TODAY, total: 5, samples: denseSamples, overflow: 2, omittedByHours: 0,
      truncated: opts.truncated ?? false,
    }],
  };
};

const serveCalendar = (opts: CalendarOptions | ((detail: string, url: URL) => CalendarOptions) = {}) =>
  http.get('/api/plugins/cronjob/api/calendar', ({ url }) => {
    const detail = url.searchParams.get('detail') === 'agenda' ? 'agenda' : 'summary';
    const start = url.searchParams.get('start') ?? MONTH_START;
    const resolved = typeof opts === 'function' ? opts(detail, url) : opts;
    return HttpResponse.json(calendarBody(detail, start, resolved));
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
  serveCalendar(),
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
  return { ...render(<Wrapper><ToastProvider><CalendarPage /></ToastProvider></Wrapper>), client };
}

/** The agenda card for a job. A recurring job legitimately has SEVERAL occurrences in one window and
 *  each card is independently operable, so the first one is the one a reader clicks. */
const occurrenceCard = async (name: string): Promise<HTMLElement> =>
  (await screen.findAllByRole('button', { name: strings.openJob.replace('{name}', name) }))[0]!;

/** The page has painted when the first summary landed and the toolbar exists. */
const awaitPainted = () => screen.findByTestId('cron-calendar-body');

// ── the month surface ────────────────────────────────────────────────────────────────────────────

describe('the month surface', () => {
  beforeEach(() => setViewport(false));

  it('renders the day as a schedule ledger: three ordered times, a +N more, and a counted name', async () => {
    renderPage();
    await awaitPainted();
    const cell = await screen.findByTestId(`cron-day-${TODAY}`);
    // The ledger itself: at most three ordered local time labels, then the overflow count.
    expect(within(cell).getByText('07:30')).toBeInTheDocument();
    expect(within(cell).getByText('18:00')).toBeInTheDocument();
    expect(within(cell).getByText('20:00')).toBeInTheDocument();
    expect(within(cell).getByText(strings.calMore.replace('{n}', '2'))).toBeInTheDocument();
    // The count reaches a screen reader through the day button's own accessible name, and the
    // library's localized full-date name is kept rather than replaced by the raw label.
    expect(cell.getAttribute('aria-label')).toBe(
      strings.calDayAria.replace('{date}', '15 September 2026').replace('{count}', '5'),
    );
  });

  it('keeps every button prop the calendar computed on the ledger button — nothing is a plain span', async () => {
    renderPage();
    await awaitPainted();
    const cell = await screen.findByTestId(`cron-day-${TODAY}`);
    // The override IS the day button: the type, the roving tabIndex and the click handler all survive.
    expect(cell.tagName).toBe('BUTTON');
    expect(cell).toHaveAttribute('type', 'button');
    expect(cell).toHaveAttribute('tabindex');
    // Nothing inside the ledger is separately focusable — one tab stop per day, by design.
    expect(within(cell).queryAllByRole('button')).toHaveLength(0);
  });

  it('selecting a day moves the side agenda to it and asks the server for that ONE local date', async () => {
    const asked: string[] = [];
    use(http.get('/api/plugins/cronjob/api/calendar', ({ url }) => {
      const detail = url.searchParams.get('detail') === 'agenda' ? 'agenda' : 'summary';
      if (detail === 'agenda') asked.push(`${url.searchParams.get('start')}/${url.searchParams.get('days')}`);
      return HttpResponse.json(calendarBody(detail, url.searchParams.get('start') ?? MONTH_START));
    }));
    renderPage();
    await awaitPainted();
    await waitFor(() => expect(asked).toContain(`${TODAY}/1`));
    fireEvent.click(await screen.findByTestId('cron-day-2026-09-17'));
    // The month panel reads exactly one day; the window start follows the selection.
    await waitFor(() => expect(asked).toContain('2026-09-17/1'));
  });

  it('adopts the SCHEDULER\'s today rather than the browser\'s, once', async () => {
    // The browser clock is deliberately a different day; the server states 2026-09-15.
    vi.setSystemTime(new Date('2026-11-02T23:30:00Z'));
    const starts: string[] = [];
    use(http.get('/api/plugins/cronjob/api/calendar', ({ url }) => {
      const detail = url.searchParams.get('detail') === 'agenda' ? 'agenda' : 'summary';
      if (detail === 'summary') starts.push(url.searchParams.get('start') ?? '');
      return HttpResponse.json(calendarBody(detail, url.searchParams.get('start') ?? MONTH_START));
    }));
    renderPage();
    await awaitPainted();
    await waitFor(() => expect(starts).toContain(MONTH_START));
    vi.useRealTimers();
  });
});

// ── the Agenda view REPLACES the month grid ──────────────────────────────────────────────────────

describe('the agenda view', () => {
  beforeEach(() => setViewport(false));

  it('replaces the month grid with one seven-day chronological list under its own range heading', async () => {
    const windows: string[] = [];
    use(http.get('/api/plugins/cronjob/api/calendar', ({ url }) => {
      const detail = url.searchParams.get('detail') === 'agenda' ? 'agenda' : 'summary';
      if (detail === 'agenda') windows.push(`${url.searchParams.get('start')}/${url.searchParams.get('days')}`);
      return HttpResponse.json(calendarBody(detail, url.searchParams.get('start') ?? MONTH_START));
    }));
    renderPage();
    await awaitPainted();
    expect(screen.getByTestId('cron-month-grid')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: strings.calAgendaHeading }));

    // The grid is GONE — an Agenda view that only changed the query would leave it standing.
    await waitFor(() => expect(screen.queryByTestId('cron-month-grid')).toBeNull());
    expect(screen.getByTestId('cron-agenda-view')).toBeInTheDocument();
    // Its own heading names the whole range, not a single day.
    const heading = screen.getByTestId('cron-agenda-range');
    expect(heading.textContent).toContain('September');
    expect(heading.textContent).toContain('21');
    await waitFor(() => expect(windows).toContain(`${TODAY}/7`));
  });

  it('pages a truncated agenda through the server cursor instead of hiding what does not fit', async () => {
    const cursors: (string | null)[] = [];
    use(http.get('/api/plugins/cronjob/api/calendar', ({ url }) => {
      const detail = url.searchParams.get('detail') === 'agenda' ? 'agenda' : 'summary';
      if (detail !== 'agenda') return HttpResponse.json(calendarBody('summary', MONTH_START));
      const cursor = url.searchParams.get('cursor');
      cursors.push(cursor);
      if (cursor === null) {
        return HttpResponse.json(calendarBody('agenda', TODAY, {
          occurrences: [occurrence('job-daily', TODAY, '07:30')], nextCursor: 'cursor-page-2',
        }));
      }
      return HttpResponse.json(calendarBody('agenda', TODAY, {
        occurrences: [occurrence('job-daily', TODAY, '23:45')],
      }));
    }));
    renderPage();
    await awaitPainted();
    await screen.findByTestId('cron-agenda-more');
    // The window says outright that more follows — never a silent cut.
    expect(screen.getByText(strings.calAgendaTruncated)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: strings.calAgendaMore }));

    // Scoped to the agenda: the month cell's own ledger shows the same times, and it is the LIST that
    // has to grow.
    const list = await screen.findByTestId('cron-agenda');
    await waitFor(() => expect(within(list).getByText('23:45')).toBeInTheDocument());
    // The first page stays: pages append in order, they do not replace each other.
    expect(within(list).getByText('07:30')).toBeInTheDocument();
    // The cursor travelled with the snapshot it was cut against.
    const second = cursors.filter((c) => c !== null);
    expect(second).toContain('cursor-page-2');
    // And the affordance is gone once the server stops handing out a cursor.
    await waitFor(() => expect(screen.queryByTestId('cron-agenda-more')).toBeNull());
  });
});

// ── the phone ────────────────────────────────────────────────────────────────────────────────────

describe('the phone surface', () => {
  beforeEach(() => setViewport(true));

  it('is agenda-first: a seven-day strip drives the agenda and no month grid is squeezed in', async () => {
    const windows: string[] = [];
    use(http.get('/api/plugins/cronjob/api/calendar', ({ url }) => {
      const detail = url.searchParams.get('detail') === 'agenda' ? 'agenda' : 'summary';
      if (detail === 'agenda') windows.push(`${url.searchParams.get('start')}/${url.searchParams.get('days')}`);
      return HttpResponse.json(calendarBody(detail, url.searchParams.get('start') ?? MONTH_START));
    }));
    renderPage();
    await awaitPainted();

    expect(screen.queryByTestId('cron-month-grid')).toBeNull();
    const strip = await screen.findByTestId('cron-day-strip');
    // Seven dates from the selected day, each an addressable 44px target naming its own count.
    const days = within(strip).getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') !== null);
    expect(days).toHaveLength(7);
    expect(days[0]).toHaveAttribute('aria-pressed', 'true');
    expect(days[0]).toHaveAttribute('aria-label', strings.calDayAria.replace('{date}', TODAY).replace('{count}', '5'));
    await waitFor(() => expect(windows).toContain(`${TODAY}/7`));

    // Picking a later date in the strip moves the agenda window to it.
    fireEvent.click(days[3]!);
    await waitFor(() => expect(windows).toContain('2026-09-18/7'));
  });

  it('steps the strip by WEEKS, under its own week labels — never the month ones', async () => {
    renderPage();
    await awaitPainted();
    const strip = await screen.findByTestId('cron-day-strip');
    expect(within(strip).getByRole('button', { name: strings.calPrevWeek })).toBeInTheDocument();
    expect(within(strip).getByRole('button', { name: strings.calNextWeek })).toBeInTheDocument();
    expect(within(strip).queryByRole('button', { name: strings.calPrevMonth })).toBeNull();

    fireEvent.click(within(strip).getByRole('button', { name: strings.calNextWeek }));
    await waitFor(() => {
      const days = within(screen.getByTestId('cron-day-strip')).getAllByRole('button')
        .filter((b) => b.getAttribute('aria-pressed') !== null);
      expect(days[0]).toHaveAttribute('aria-label', expect.stringContaining('2026-09-22'));
    });
  });

  it('opens the month picker in ONE host modal, mounted only while it is open', async () => {
    renderPage();
    await awaitPainted();
    // The host Modal has no `open` prop: not-open MUST mean not mounted.
    expect(screen.queryByTestId('calendar-grid')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: strings.calDatePicker }));
    const grid = await screen.findByTestId('calendar-grid');
    expect(screen.getAllByTestId('calendar-grid')).toHaveLength(1);
    // Nothing else nests inside the date chooser — a creation form here would be a second surface.
    expect(screen.queryByTestId('cron-create-form')).toBeNull();

    fireEvent.click(within(grid.closest('[role="dialog"]') ?? grid).getAllByRole('button')[0]!);
    await waitFor(() => expect(screen.queryByTestId('calendar-grid')).toBeNull());
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
      http.get('/api/plugins/cronjob/api/calendar', ({ url }) => {
        const detail = url.searchParams.get('detail') === 'agenda' ? 'agenda' : 'summary';
        if (detail === 'summary') summaryCalls += 1;
        return HttpResponse.json(calendarBody(detail, url.searchParams.get('start') ?? MONTH_START, {
          jobs: [{ ...recurring, manualQueued: queued }, oneShot],
        }));
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

    // While the request is queued the page reads the calendar at the fast cadence, not the 30s one.
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
    use(http.get('/api/plugins/cronjob/api/calendar', ({ url }) => {
      const detail = url.searchParams.get('detail') === 'agenda' ? 'agenda' : 'summary';
      return HttpResponse.json(calendarBody(detail, url.searchParams.get('start') ?? MONTH_START, {
        jobs: present ? [recurring, oneShot] : [oneShot],
      }));
    }));
    window.history.replaceState({}, '', '/p/cronjob?job=job-daily');
    const { client } = renderPage();
    await screen.findByText(strings.nextRun);
    present = false;
    // The next window read no longer carries the row; the drawer must not render over `undefined`.
    await client.invalidateQueries({ queryKey: ['cron-calendar'] });
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
    for (const key of ['calMonthLabel', 'calAgendaHeading', 'calDayAria', 'calMore', 'createOneShot',
      'createRecurring', 'nextRun', 'lastStarted', 'badgeLate', 'hoursTimeZone',
      'calPrevWeek', 'calNextWeek', 'calAgendaRange', 'calAgendaMore', 'calAgendaTruncated']) {
      expect(Object.hasOwn(strings, key), `missing web.strings.${key}`).toBe(true);
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
    for (const file of ['CalendarPage.tsx', 'fields.tsx', 'JobDrawer.tsx', 'CreateJobDialog.tsx']) {
      const source = resolve(here, '../plugins/cronjob/web-src/', file);
      expect(readFileSync(source, 'utf-8').includes('isValidSchedule'), basename(source)).toBe(false);
    }
  });

  it('formats the browser-local label a day grid cell needs, nothing more', () => {
    expect(localDateLabel(new Date(2026, 8, 15))).toBe('2026-09-15');
  });
});
