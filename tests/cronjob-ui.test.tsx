import type { PluginUiRegistration } from 'elowen-plugin-ui-kit';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AutomationPage } from '../plugins/cronjob/web-src/AutomationPage';
import {
  apiErrorCode, apiErrorConflict, apiErrorCurrent, localDateLabel, runtime,
  type CronJob, type CronRunRow, type CronWeekDay, type CronWeekResponse,
} from '../plugins/cronjob/web-src/runtime';
import {
  parseActiveHours, parseBuilderSchedule, renderActiveHours, renderBuilderSchedule,
} from '../plugins/cronjob/web-src/scheduleBuilder';
import manifest from '../plugins/cronjob/elowen-plugin.json' with { type: 'json' };
import { HttpResponse, close, http, listen, resetHandlers, setDefaults, use } from './ui/http';
import { createWrapper, ToastProvider } from './ui/hostHooks';
import { ensurePluginUiRuntime } from './ui/hostRuntime';

ensurePluginUiRuntime();

const strings = (manifest as { web: { strings: Record<string, string> } }).web.strings;
const TODAY = '2026-09-15';
const TZ = 'Europe/Prague';

const recurring: CronJob = {
  id: 'job-daily', name: 'Morning digest', schedule: 'daily 07:30', prompt: 'summarize',
  enabled: true, ownerUserId: 7, lifecycle: 'recurring', revision: 3, manualQueued: false,
  conversationSessionId: 'conv-1', owner: { id: 7, username: 'filip', name: 'Filip', avatar: '' },
  nextOccurrence: {
    occurrenceId: 'job-daily:slot:2026-09-15T07:30', scheduledAt: '2026-09-15T05:30:00.000Z',
    expectedAt: '2026-09-15T05:30:00.000Z', localDate: TODAY, localTime: '07:30',
    timezone: TZ, disposition: 'onTime', guarded: false,
  },
};
const oneShot: CronJob = {
  id: 'job-once', name: 'Check invoices', schedule: 'one-shot', prompt: 'check',
  enabled: true, ownerUserId: 7, lifecycle: 'oneShot', revision: 1,
  runAt: '2026-09-15T16:00:00.000Z', owner: { id: 7, username: 'filip', name: 'Filip', avatar: '' },
};
const poll: CronJob = {
  id: 'job-poll', name: 'Inbox poll', schedule: 'every 2m', prompt: 'poll',
  enabled: true, ownerUserId: 7, lifecycle: 'recurring', revision: 1,
  owner: { id: 7, username: 'filip', name: 'Filip', avatar: '' },
};

const dates = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20'];
const day = (localDate: string): CronWeekDay => ({
  localDate,
  cards: localDate === TODAY ? [
    { jobId: recurring.id, kind: 'daily', localTime: '07:30', remaining: 1, moreTimes: [], enabled: true, state: 'ok', guarded: false, disposition: 'onTime' },
    { jobId: oneShot.id, kind: 'oneShot', localTime: '18:00', remaining: 1, moreTimes: [], enabled: true, state: 'waiting', guarded: false, disposition: 'onTime' },
  ] : [],
  dayTotal: localDate === TODAY ? 2 : 0,
  runs: { ok: localDate === TODAY ? 1 : 0, error: 0, skipped: 0, running: 0 },
});
const weekBody = (): CronWeekResponse => ({
  generatedAt: '2026-09-15T08:20:00.000Z',
  timezone: TZ,
  todayLocalDate: TODAY,
  nowLocalTime: '10:20',
  precisionMs: 30_000,
  scheduler: { ready: true },
  window: { startLocalDate: dates[0]!, endLocalDateExclusive: '2026-09-21' },
  jobs: [recurring, oneShot, poll],
  days: dates.map(day),
  intervals: [{ jobId: poll.id, schedule: 'every 2m', intervalLabel: 'every 2m', enabled: true, nextExpectedAt: '2026-09-15T08:22:00.000Z', nextLocalDate: TODAY, nextLocalTime: '10:22', remainingToday: 720, lastOutcome: null, lastRunAt: null }],
  truncated: false,
});

const run: CronRunRow = {
  id: 'run-1',
  jobId: recurring.id,
  jobName: recurring.name,
  schedule: recurring.schedule,
  ownerUserId: 7,
  owner: recurring.owner,
  lifecycle: 'recurring',
  trigger: 'schedule',
  localDate: TODAY,
  localTime: '07:30',
  timezone: TZ,
  outcome: 'ok',
  startedAt: '2026-09-15T05:30:01.000Z',
  finishedAt: '2026-09-15T05:30:03.500Z',
  durationMs: 2500,
  sessionId: 'session-1',
  messageId: 'message-exact',
  model: 'openai/gpt-test',
  tokensTotal: 42,
  costUsd: 0.01,
  delivered: true,
  preview: 'Short retained preview',
  previewTruncated: false,
};

setDefaults(
  http.get('/api/plugins/ui', () => HttpResponse.json([{ name: 'cronjob', url: '/plugins/cronjob/web/index.js', apiVersion: 17, nav: [], settings: [], strings }])),
  http.get('/api/auth/me', () => HttpResponse.json({ user: { id: 7, username: 'filip', is_admin: true } })),
  http.get('/api/plugins/destinations', () => HttpResponse.json([])),
  http.get('/api/brain/models', () => HttpResponse.json([])),
  http.get('/api/projects', () => HttpResponse.json([])),
  http.get('/api/plugins/cronjob/api/conversations', () => HttpResponse.json({ status: 'available', conversations: [] })),
  http.get('/api/plugins/cronjob/api/week', () => HttpResponse.json(weekBody())),
  http.get('/api/plugins/cronjob/api/runs', ({ url }) => HttpResponse.json({
    runs: [run],
    nextCursor: null,
    total: 1,
    limit: Number(url.searchParams.get('limit') ?? 20),
  })),
  http.get('/api/plugins/cronjob/api/runs/:id', () => HttpResponse.json(run)),
  http.get('/api/brain/messages/:id', ({ params, url }) =>
    params.id === 'message-exact' && url.searchParams.get('session') === 'session-1'
      ? HttpResponse.json({ id: 'message-exact', role: 'assistant', content: 'Exact durable assistant result' })
      : HttpResponse.json({ error: 'unknown message' }, { status: 404 })),
);

beforeAll(() => listen());
beforeEach(() => {
  window.history.replaceState({}, '', '/p/cronjob');
  setViewport(false);
});
afterEach(() => { cleanup(); resetHandlers(); });
afterAll(() => close());

function setViewport(mobile: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: mobile && query.includes('max-width'),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

function renderPage() {
  const { wrapper: Wrapper, client } = createWrapper();
  return {
    ...render(<Wrapper><ToastProvider><AutomationPage /></ToastProvider></Wrapper>),
    client,
  };
}

describe('automation week calendar', () => {
  it('uses the canonical workbench with a bounded seven-day grid and no month control', async () => {
    renderPage();
    const grid = await screen.findByTestId('cron-week-grid');
    // Seven labelled day regions, not a `role="grid"`: the columns hold a variable number of entries and
    // none of them is a cell of a shared row.
    expect(within(grid).getAllByRole('region')).toHaveLength(7);
    expect(within(grid).queryAllByRole('grid')).toHaveLength(0);
    expect(screen.getByText(strings.tabCalendar)).toBeInTheDocument();
    expect(screen.getByText(strings.tabHistory)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: strings.calToday })).toBeInTheDocument();
    expect(screen.getByText(strings.viewWeek)).toBeInTheDocument();
    expect(screen.queryByText(strings.calMonthLabel)).toBeNull();
  });

  it('renders each job once per day card and keeps a 720-fire poll out of the timeline', async () => {
    renderPage();
    await screen.findByTestId('cron-week-grid');
    expect(screen.getAllByTestId('cron-card-job-daily')).toHaveLength(1);
    expect(screen.getAllByTestId('cron-card-job-once')).toHaveLength(1);
    const card = screen.getByTestId('cron-card-job-daily');
    fireEvent.click(within(card).getByRole('button', { name: strings.actions }));
    expect(screen.queryByText(strings.deleteTitle)).toBeNull();

    // The interval job is named ONCE on the whole page, in the strip under the calendar — never as a
    // register table and never as a card in a day column, where it would fire on all seven days.
    expect(screen.getAllByText('Inbox poll')).toHaveLength(1);
    const strip = screen.getByTestId('cron-intervals-strip');
    expect(within(strip).getByText('every 2m')).toBeInTheDocument();
    // Today: the next fire is this day's, so it IS shown. The companion test below proves it disappears
    // on another day — without this half, dropping the time entirely would keep both tests green.
    expect(within(strip).getByText('10:22')).toBeInTheDocument();
    expect(screen.getByTestId('cron-week-grid')).not.toContainElement(strip);
  });

  it('keeps interval jobs listed on a day whose next fire is elsewhere, without its time', async () => {
    renderPage();
    const grid = await screen.findByTestId('cron-week-grid');
    fireEvent.click(within(within(grid).getAllByRole('region')[3]!).getAllByRole('button')[0]!);
    const strip = await screen.findByTestId('cron-intervals-strip');
    expect(within(strip).getByText('Inbox poll')).toBeInTheDocument();
    expect(within(strip).queryByText('10:22')).toBeNull();
  });

  it('never says a day is empty while a recurring job is listed under it', async () => {
    setViewport(true);
    use(http.get('/api/plugins/cronjob/api/week', () => HttpResponse.json({
      ...weekBody(),
      days: weekBody().days.map((entry) => ({ ...entry, cards: [], dayTotal: 0 })),
    })));
    renderPage();
    const tab = await screen.findByTestId('cron-calendar-tab');
    expect(await within(tab).findByTestId('cron-intervals-strip')).toBeInTheDocument();
    expect(within(tab).queryByText(strings.dayNothing)).toBeNull();
  });

  it('opens a run result and fetches the exact durable assistant message id', async () => {
    renderPage();
    const card = await screen.findByTestId('cron-card-job-daily');
    fireEvent.click(within(card).getByRole('button', { name: strings.actions }));
    fireEvent.click(await screen.findByText(strings.showResult));
    expect(await screen.findByText('Short retained preview')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: strings.runFullResult }));
    expect(await screen.findByText('Exact durable assistant result')).toBeInTheDocument();
    expect(screen.queryByText('Wrong assistant message')).toBeNull();
  });

  it('switches to a paginated history register', async () => {
    renderPage();
    await screen.findByTestId('cron-week-grid');
    fireEvent.click(screen.getByText(strings.tabHistory));
    expect(await screen.findByText('openai/gpt-test')).toBeInTheDocument();
    expect(screen.getByText('2.5 s')).toBeInTheDocument();
    expect(screen.getByText(strings.runOk)).toBeInTheDocument();
  });

  it('resets history to page one when a filter changes', async () => {
    const historyOffsets: number[] = [];
    use(http.get('/api/plugins/cronjob/api/runs', ({ url }) => {
      if (url.searchParams.has('date')) return HttpResponse.json({ runs: [run], nextCursor: null, total: 1, limit: 50 });
      const offset = Number(url.searchParams.get('offset') ?? 0);
      historyOffsets.push(offset);
      const q = url.searchParams.get('q');
      return HttpResponse.json({
        runs: [{ ...run, id: `history-${offset}-${q ?? 'all'}`, jobName: q ? 'Filtered receipt' : `History offset ${offset}` }],
        nextCursor: null, total: 60, limit: 25,
      });
    }));
    renderPage();
    await screen.findByTestId('cron-week-grid');
    fireEvent.click(screen.getByText(strings.tabHistory));
    expect(await screen.findByText('History offset 0')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /next page/i }));
    expect(await screen.findByText('History offset 25')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'filtered' } });
    expect(await screen.findByText('Filtered receipt')).toBeInTheDocument();
    await waitFor(() => expect(historyOffsets.at(-1)).toBe(0));
  });

  /** Every axis is one picker with a glyph on each option and its neutral value first, and its chip
   *  prints the option's WORD rather than the value behind it — the kind, outcome and period chips used
   *  to read `oneShot`, `skipped` and `30`. */
  it('narrows the calendar and the history through one picker per axis', async () => {
    const { container } = renderPage();
    await screen.findByTestId('cron-week-grid');
    // At the defaults nothing narrows, so no chip row appears at all.
    expect(screen.queryByTestId('page-filter-chips')).toBeNull();

    fireEvent.click(screen.getByTestId('page-filters-trigger'));
    const filters = screen.getByRole('dialog', { name: 'Filters' });
    const owner = within(filters).getByRole('combobox', { name: strings.filterOwner });
    const state = within(filters).getByRole('combobox', { name: strings.filterState });
    const kind = within(filters).getByRole('combobox', { name: strings.filterKind });
    expect(within(owner).getAllByRole('option').map((option) => option.value)).toEqual(['all', 'mine', 'instance']);
    expect(within(state).getAllByRole('option').map((option) => option.value)).toEqual(['all', 'active', 'paused']);
    expect(within(kind).getAllByRole('option').map((option) => option.value)).toEqual(['all', 'fixed', 'interval', 'oneShot']);
    // A glyph on every option of every axis, the neutral included.
    for (const value of ['all', 'mine', 'instance', 'active', 'paused', 'fixed', 'interval', 'oneShot']) {
      expect(container.querySelector(`[data-select-option-icon="${value}"] svg`)).not.toBeNull();
    }

    fireEvent.change(kind, { target: { value: 'oneShot' } });
    expect(screen.getByTestId('page-filter-chips')).toHaveTextContent(`${strings.filterKind}: ${strings.badgeOneShot}`);
    fireEvent.change(state, { target: { value: 'paused' } });
    const chips = screen.getByTestId('page-filter-chips');
    expect(chips).toHaveTextContent(`${strings.filterState}: ${strings.paused}`);
    expect(chips).not.toHaveTextContent('Type: oneShot');

    // Two narrowing filters, so the row also offers the one reset that clears both.
    fireEvent.click(within(chips).getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(screen.queryByTestId('page-filter-chips')).toBeNull());
    expect(within(screen.getByRole('dialog', { name: 'Filters' })).getByRole('combobox', { name: strings.filterKind })).toHaveValue('all');
    expect(within(screen.getByRole('dialog', { name: 'Filters' })).getByRole('combobox', { name: strings.filterState })).toHaveValue('all');

    // History brings its own two axes, and the period axis still defaults to the 7 days it queried with.
    fireEvent.click(screen.getByText(strings.tabHistory));
    const history = screen.getByRole('dialog', { name: 'Filters' });
    const outcome = within(history).getByRole('combobox', { name: strings.filterOutcome });
    const range = within(history).getByRole('combobox', { name: strings.filterRange });
    expect(range).toHaveValue('7');
    expect(within(outcome).getAllByRole('option').map((option) => option.value)).toEqual(['all', 'ok', 'error', 'skipped']);
    expect(within(range).getAllByRole('option').map((option) => option.value)).toEqual(['7', 'today', '30']);
    for (const value of ['ok', 'error', 'skipped', 'today', '30']) {
      expect(container.querySelector(`[data-select-option-icon="${value}"] svg`)).not.toBeNull();
    }

    fireEvent.change(outcome, { target: { value: 'skipped' } });
    fireEvent.change(range, { target: { value: '30' } });
    const historyChips = screen.getByTestId('page-filter-chips');
    expect(historyChips).toHaveTextContent(`${strings.filterOutcome}: ${strings.runSkipped}`);
    expect(historyChips).toHaveTextContent(`${strings.filterRange}: ${strings.range30}`);
    // The period chip's own X puts the register back on the default window and leaves the other one on.
    fireEvent.click(within(historyChips).getByRole('button', { name: new RegExp(`${strings.filterRange}: ${strings.range30}`) }));
    await waitFor(() => expect(range).toHaveValue('7'));
    expect(screen.getByTestId('page-filter-chips')).toHaveTextContent(`${strings.filterOutcome}: ${strings.runSkipped}`);
  });

  it('offers one New task menu with both lifecycle choices', async () => {
    renderPage();
    await screen.findByTestId('cron-week-grid');
    fireEvent.click(screen.getByText(strings.newTask));
    expect(await screen.findByText(strings.createRecurring)).toBeInTheDocument();
    expect(screen.getByText(strings.createOneShot)).toBeInTheDocument();
  });

  it('shows every occurrence of a day in its column, with no expander to unfold', async () => {
    const many = (): CronWeekResponse => {
      const body = weekBody();
      // One card per job per day, which is what the server can emit: reusing a job id across cards made
      // React reuse one row's element for another's and printed duplicate-key warnings.
      const extras = ['08:00', '09:00', '10:00', '11:00', '12:00'].map((localTime, index) => ({
        jobId: `job-extra-${index}`,
        kind: 'daily' as const, localTime, remaining: 1, moreTimes: [],
        enabled: true, state: 'ok' as const, guarded: false, disposition: 'onTime' as const,
      }));
      return {
        ...body,
        jobs: [...body.jobs, ...extras.map((card) => ({ ...recurring, id: card.jobId, name: `Extra ${card.localTime}` }))],
        days: body.days.map((entry) => entry.localDate === TODAY
          ? { ...entry, cards: extras, dayTotal: extras.length }
          : entry),
      };
    };
    use(http.get('/api/plugins/cronjob/api/week', () => HttpResponse.json(many())));
    renderPage();
    const grid = await screen.findByTestId('cron-week-grid');
    // All five, straight away: the column used to stop at three and hide the rest behind "+N more".
    for (const time of ['08:00', '09:00', '10:00', '11:00', '12:00']) {
      expect(within(grid).getAllByText(time)).toHaveLength(1);
    }
    expect(within(grid).queryByTestId(`cron-day-more-${TODAY}`)).toBeNull();
  });

  it('opens the receipt of the occurrence the menu belongs to, not the selected day or the newest run', async () => {
    const OTHER = '2026-09-16';
    // A card on a day that is NOT the selected one, for a job that fires twice that day. Both halves matter:
    // with the selected day the request would carry TODAY, and with `limit: 1` the 20:00 receipt would win.
    const twoFires = (): CronWeekResponse => {
      const body = weekBody();
      return {
        ...body,
        days: body.days.map((entry) => entry.localDate === TODAY
          ? { ...entry, cards: [], dayTotal: 0 }
          : entry.localDate === OTHER
          ? {
            ...entry,
            cards: [{ jobId: recurring.id, kind: 'daily' as const, localTime: '07:30', remaining: 2, moreTimes: ['20:00'], enabled: true, state: 'ok' as const, guarded: false, disposition: 'onTime' as const }],
            dayTotal: 1,
          }
          : entry),
      };
    };
    const morning = { ...run, id: 'run-morning', localDate: OTHER, localTime: '07:30', preview: 'Morning receipt' };
    const evening = { ...run, id: 'run-evening', localDate: OTHER, localTime: '20:00', preview: 'Evening receipt' };
    const asked: { date: string | null; jobId: string | null }[] = [];
    use(
      http.get('/api/plugins/cronjob/api/week', () => HttpResponse.json(twoFires())),
      http.get('/api/plugins/cronjob/api/runs', ({ url }) => {
        if (url.searchParams.has('jobId')) {
          asked.push({ date: url.searchParams.get('date'), jobId: url.searchParams.get('jobId') });
          return HttpResponse.json({ runs: [evening, morning], nextCursor: null, total: 2, limit: 50 });
        }
        return HttpResponse.json({ runs: [run], nextCursor: null, total: 1, limit: 50 });
      }),
      http.get('/api/plugins/cronjob/api/runs/:id', ({ params }) =>
        HttpResponse.json(params.id === 'run-morning' ? morning : evening)),
    );
    renderPage();
    const card = await screen.findByTestId('cron-card-job-daily');
    fireEvent.click(within(card).getByRole('button', { name: strings.actions }));
    fireEvent.click(await screen.findByText(strings.showResult));
    expect(await screen.findByText('Morning receipt')).toBeInTheDocument();
    expect(screen.queryByText('Evening receipt')).toBeNull();
    expect(asked).toEqual([{ date: OTHER, jobId: recurring.id }]);
  });

  it('fades a paused row without trapping its menu in a stacking context', async () => {
    setViewport(true);
    use(http.get('/api/plugins/cronjob/api/week', () => {
      const body = weekBody();
      return HttpResponse.json({
        ...body,
        jobs: body.jobs.map((job) => (job.id === recurring.id ? { ...job, enabled: false } : job)),
        days: body.days.map((entry) => entry.localDate === TODAY
          ? { ...entry, cards: entry.cards.map((card) => (card.jobId === recurring.id ? { ...card, state: 'paused' as const, enabled: false } : card)) }
          : entry),
      });
    }));
    renderPage();
    const card = await screen.findByTestId('cron-card-job-daily');
    // The wash belongs to the row. On the CARD it makes an element below full opacity, which is a
    // stacking context: the open menu was then painted under the following rows and faded with them.
    expect(card.className).not.toMatch(/opacity-/);
    expect(within(card).getAllByRole('button')[0]!.className).toMatch(/opacity-/);
    expect(card.className).not.toMatch(/translate-/);
  });

  it('creates from the calendar: a free cell opens a one-shot already dated to that day', async () => {
    renderPage();
    const grid = await screen.findByTestId('cron-week-grid');
    fireEvent.click(within(grid).getByTestId('cron-day-add-2026-09-17'));
    expect(await screen.findByTestId('cron-create-form')).toBeInTheDocument();
    expect(screen.getByLabelText(strings.date)).toHaveValue('2026-09-17');

    fireEvent.click(screen.getByText(strings.presetDigest));
    expect(screen.getByPlaceholderText('verify-deploy')).toHaveValue(strings.presetDigestName);
    expect(screen.getByDisplayValue(strings.presetDigestPrompt)).toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId('cron-create-quick-times')).getByText('18:00'));
    expect(screen.getByLabelText(strings.time)).toHaveValue('18:00');
    expect(screen.getByRole('button', { name: strings.createOneShotSubmit })).toBeEnabled();
  });

  it('uses a horizontal day strip and one-day view on a phone', async () => {
    setViewport(true);
    renderPage();
    expect(await screen.findByTestId('cron-day-strip')).toBeInTheDocument();
    expect(screen.queryByTestId('cron-week-grid')).toBeNull();
    expect(screen.getByTestId('cron-day-cards')).toBeInTheDocument();
  });

  it('keeps job deep links and uses one indistinguishable unavailable state', async () => {
    window.history.replaceState({}, '', '/p/cronjob?job=missing');
    renderPage();
    expect(await screen.findByText(strings.linkUnavailableHint)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('cronjob bundle contracts', () => {
  it('registers one page-owning jobs section on API 17', async () => {
    let captured: Pick<PluginUiRegistration, 'requiresApiVersion' | 'settings' | 'ownsPageFrame'> | undefined;
    (window as unknown as { __elowenRegisterPluginUi?: (p: string, r: typeof captured) => void })
      .__elowenRegisterPluginUi = (_plugin, registration) => { captured = registration; };
    await import('../plugins/cronjob/web-src/index');
    expect(captured?.requiresApiVersion).toBe(17);
    expect(Object.keys(captured?.settings ?? {})).toEqual(['jobs']);
    expect(captured?.ownsPageFrame).toEqual(['jobs']);
  });

  it('ships every new calendar and history string', () => {
    for (const key of [
      'tabCalendar', 'tabHistory', 'viewDay', 'viewWeek', 'newTask', 'filterOwner',
      'filterState', 'filterKind', 'filterOutcome', 'filterRange', 'runWaiting',
      'runRunning', 'runOk', 'runErrorState', 'runSkipped', 'runFullResult',
      'intervalsTitle', 'historyEmpty', 'colDuration', 'colModel', 'ownerSystem',
    ]) expect(Object.hasOwn(strings, key), `missing web.strings.${key}`).toBe(true);
  });
});

describe('cronjob schedule and wire helpers', () => {
  it.each(['every 15m', 'every 2h', 'daily 07:30', 'weekly sun 20:00'])(
    'round-trips %s through the scheduler grammar',
    (schedule) => {
      const parsed = parseBuilderSchedule(schedule);
      expect(parsed).not.toBeNull();
      expect(renderBuilderSchedule(parsed!)).toBe(schedule);
    },
  );

  it('validates bounded whole-hour active windows', () => {
    expect(parseActiveHours('0-23')).toEqual({ start: 0, end: 23 });
    expect(parseActiveHours('22-5')).toEqual({ start: 22, end: 5 });
    expect(parseActiveHours('24-5')).toBeNull();
    expect(parseActiveHours('5:30-21')).toBeNull();
    expect(renderActiveHours(0, 23)).toBe('0-23');
  });

  it('reads machine errors from host error details', () => {
    const hostError = Object.assign(new Error('api 409'), {
      details: { code: 'revision_conflict', conflict: true, current: { id: 'j1' } },
    });
    expect(apiErrorCode(hostError)).toBe('revision_conflict');
    expect(apiErrorConflict(hostError)).toBe(true);
    expect(apiErrorCurrent(hostError)?.id).toBe('j1');
  });

  it('formats the browser local date label', () => {
    expect(localDateLabel(new Date(2026, 8, 15))).toBe(TODAY);
    expect(typeof runtime().components.DataTable).toBe('function');
  });
});
