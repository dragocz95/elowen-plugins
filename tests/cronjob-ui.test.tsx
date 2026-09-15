import type { PluginUiRegistration } from 'elowen-plugin-ui-kit';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
import { HttpResponse, close, http, listen, resetHandlers, setDefaults } from './ui/http';
import { createWrapper, ToastProvider } from './ui/hostHooks';
import { ensurePluginUiRuntime } from './ui/hostRuntime';

ensurePluginUiRuntime();

const strings = (manifest as { web: { strings: Record<string, string> } }).web.strings;
const TODAY = '2026-09-15';
const TZ = 'Europe/Prague';

const recurring: CronJob = {
  id: 'job-daily', name: 'Morning digest', schedule: 'daily 07:30', prompt: 'summarize',
  enabled: true, ownerUserId: 7, lifecycle: 'recurring', revision: 3, manualQueued: false,
  conversationSessionId: 'conv-1', owner: { id: 7, username: 'filip', name: 'Filip' },
  nextOccurrence: {
    occurrenceId: 'job-daily:slot:2026-09-15T07:30', scheduledAt: '2026-09-15T05:30:00.000Z',
    expectedAt: '2026-09-15T05:30:00.000Z', localDate: TODAY, localTime: '07:30',
    timezone: TZ, disposition: 'onTime', guarded: false,
  },
};
const oneShot: CronJob = {
  id: 'job-once', name: 'Check invoices', schedule: 'one-shot', prompt: 'check',
  enabled: true, ownerUserId: 7, lifecycle: 'oneShot', revision: 1,
  runAt: '2026-09-15T16:00:00.000Z', owner: { id: 7, username: 'filip', name: 'Filip' },
};
const poll: CronJob = {
  id: 'job-poll', name: 'Inbox poll', schedule: 'every 2m', prompt: 'poll',
  enabled: true, ownerUserId: 7, lifecycle: 'recurring', revision: 1,
  owner: { id: 7, username: 'filip', name: 'Filip' },
};

const dates = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20'];
const day = (localDate: string): CronWeekDay => ({
  localDate,
  cards: localDate === TODAY ? [
    { jobId: recurring.id, localTime: '07:30', remaining: 1, moreTimes: [], state: 'ok', runId: 'run-1', guarded: false, disposition: 'onTime' },
    { jobId: oneShot.id, localTime: '18:00', remaining: 1, moreTimes: [], state: 'waiting', guarded: false, disposition: 'onTime' },
  ] : [],
  dayTotal: localDate === TODAY ? 2 : 0,
  moreCount: 0,
  truncated: false,
});
const weekBody = (): CronWeekResponse => ({
  generatedAt: '2026-09-15T08:20:00.000Z',
  timezone: TZ,
  todayLocalDate: TODAY,
  nowLocalTime: '10:20',
  precisionMs: 30_000,
  scheduler: { ready: true },
  window: { startLocalDate: dates[0]!, endLocalDateExclusive: '2026-09-21', dayCount: 7, maxDayCount: 7 },
  jobs: [recurring, oneShot, poll],
  days: dates.map(day),
  intervals: [{ jobId: poll.id, schedule: 'every 2m', intervalLabel: 'every 2m', enabled: true, remaining: 720, nextLocalDate: TODAY, nextLocalTime: '10:22', guarded: false }],
  truncated: false,
});

const run: CronRunRow = {
  id: 'run-1',
  jobId: recurring.id,
  jobName: recurring.name,
  schedule: recurring.schedule,
  ownerUserId: 7,
  owner: recurring.owner,
  trigger: 'scheduled',
  occurrenceId: 'job-daily:slot:1',
  scheduledAt: '2026-09-15T05:30:00.000Z',
  localDate: TODAY,
  localTime: '07:30',
  timezone: TZ,
  state: 'finished',
  outcome: 'ok',
  startedAt: '2026-09-15T05:30:01.000Z',
  finishedAt: '2026-09-15T05:30:03.500Z',
  durationMs: 2500,
  sessionId: 'session-1',
  messageId: 'message-exact',
  model: 'openai/gpt-test',
  tokensTotal: 42,
  costUsd: 0.01,
  deliveryState: 'delivered',
  preview: 'Short retained preview',
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
  http.get('/api/brain/messages', () => HttpResponse.json({
    messages: [
      { id: 'message-other', role: 'assistant', content: 'Wrong assistant message' },
      { id: 'message-exact', role: 'assistant', content: 'Exact durable assistant result' },
    ],
  })),
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
    expect(within(grid).getAllByRole('columnheader')).toHaveLength(7);
    expect(screen.getByText(strings.tabCalendar)).toBeInTheDocument();
    expect(screen.getByText(strings.tabHistory)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: strings.calToday })).toBeInTheDocument();
    expect(screen.getByText(strings.viewWeek)).toBeInTheDocument();
    expect(screen.queryByText(strings.calMonthLabel)).toBeNull();
  });

  it('renders each job once per day card and keeps a 720-fire poll as one interval row', async () => {
    renderPage();
    await screen.findByTestId('cron-week-grid');
    expect(screen.getAllByTestId('cron-card-job-daily')).toHaveLength(1);
    expect(screen.getAllByTestId('cron-card-job-once')).toHaveLength(1);
    expect(screen.getAllByText('Inbox poll')).toHaveLength(1);
    expect(screen.getAllByText('every 2m')).toHaveLength(1);
  });

  it('opens the selected day panel with durable run receipts', async () => {
    renderPage();
    const panel = await screen.findByTestId('cron-day-panel');
    await within(panel).findByTestId('cron-run-run-1');
    expect(within(panel).getByText(/Morning digest/)).toBeInTheDocument();
    expect(within(panel).getByText(strings.runOk)).toBeInTheDocument();
    expect(within(panel).getByText(/Check invoices/)).toBeInTheDocument();
  });

  it('opens a run result and fetches the exact durable assistant message id', async () => {
    renderPage();
    const panel = await screen.findByTestId('cron-day-panel');
    fireEvent.click(await within(panel).findByTestId('cron-run-run-1'));
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

  it('offers one New task menu with both lifecycle choices', async () => {
    renderPage();
    await screen.findByTestId('cron-week-grid');
    fireEvent.click(screen.getByText(strings.newTask));
    expect(await screen.findByText(strings.createRecurring)).toBeInTheDocument();
    expect(screen.getByText(strings.createOneShot)).toBeInTheDocument();
  });

  it('uses a horizontal day strip and one-day view on a phone', async () => {
    setViewport(true);
    renderPage();
    expect(await screen.findByTestId('cron-day-strip')).toBeInTheDocument();
    expect(screen.queryByTestId('cron-week-grid')).toBeNull();
    expect(screen.getByTestId('cron-day-panel')).toBeInTheDocument();
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
      'intervalsTitle', 'historyEmpty', 'colDuration', 'colModel',
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
