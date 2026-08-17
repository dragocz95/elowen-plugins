import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentType } from 'react';
import { http, HttpResponse, onUnhandledRequest, setupServer } from './ui/http';
import { createWrapper, ToastProvider } from './ui/hostHooks';
import { ensurePluginUiRuntime } from './ui/hostRuntime';
import manifest from '../plugins/stats/elowen-plugin.json' with { type: 'json' };

ensurePluginUiRuntime();
const registered = vi.fn();
(window as { __elowenRegisterPluginUi?: unknown }).__elowenRegisterPluginUi = registered;
const { StatsView, isTrendWindowUnavailable, padDailyUsage, trendDaysForWindow } = await import('../plugins/stats/web-src/StatsView');
await import('../plugins/stats/web-src/index');

const strings = (manifest as { web: { strings: Record<string, string> } }).web.strings;
let modelSearch = '';
let daySearch = '';
let resetCalls = 0;
const models = [
  { exec: 'token-heavy', usage: { input: 700, output: 300, cacheRead: 0, cacheWrite: 0, total: 1000, costUsd: 1, outputTps: 20, measuredOutput: 300, costSource: 'calculated' } },
  { exec: 'cost-heavy', usage: { input: 60, output: 40, cacheRead: 100, cacheWrite: 0, total: 200, costUsd: 9, outputTps: 10, measuredOutput: 40, costSource: 'provider_reported' } },
];
const days = [
  { day: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10), tokens: 300, cost: 2 },
  { day: new Date().toISOString().slice(0, 10), tokens: 900, cost: 8 },
];

const server = setupServer(
  http.get('*/api/plugins/ui', () => HttpResponse.json([{ name: 'stats', url: '/plugins/stats/web/index.js', apiVersion: 1, nav: [], settings: [], strings }])),
  http.get('*/api/usage/by-model', ({ request }) => { modelSearch = new URL(request.url).search; return HttpResponse.json(models); }),
  http.get('*/api/usage/by-day', ({ request }) => { daySearch = new URL(request.url).search; return HttpResponse.json(days); }),
  http.post('*/api/usage/reset', () => { resetCalls++; return HttpResponse.json({ ok: true, cleared: 2, chatCleared: 1 }); }),
  http.get('*/api/auth/me', () => HttpResponse.json({ user: { id: 1, username: 'admin', is_admin: true } })),
);
beforeAll(() => server.listen({ onUnhandledRequest }));
afterEach(() => { cleanup(); server.resetHandlers(); modelSearch = ''; daySearch = ''; resetCalls = 0; localStorage.clear(); });
afterAll(() => server.close());

const renderStats = () => {
  const { wrapper: Wrapper } = createWrapper();
  return render(<Wrapper><StatsView /></Wrapper>);
};

describe('daily usage window', () => {
  it('pads missing UTC days and counts calendar days without DST drift', () => {
    const now = Date.parse('2026-08-16T12:00:00Z');
    const window = { fromMs: Date.parse('2026-08-14T00:00:00Z'), toMs: Infinity };
    expect(trendDaysForWindow(window, now)).toBe(3);
    expect(padDailyUsage([
      { day: '2026-08-14', tokens: 10, cost: 1 },
      { day: '2026-08-16', tokens: 30, cost: 3 },
    ], 3, window, now)).toEqual([
      { day: '2026-08-14', tokens: 10, cost: 1 },
      { day: '2026-08-15', tokens: 0, cost: 0 },
      { day: '2026-08-16', tokens: 30, cost: 3 },
    ]);
    expect(isTrendWindowUnavailable({
      fromMs: Date.parse('2026-04-01T00:00:00Z'),
      toMs: Date.parse('2026-04-30T23:59:59Z'),
    }, 90, now)).toBe(true);
    expect(isTrendWindowUnavailable(window, 3, now)).toBe(false);
  });
});

describe('StatsView', () => {
  it('renders distinct token and cost distributions plus the daily trend from the shared endpoints', async () => {
    renderStats();
    const tokenFigure = await screen.findByRole('figure', { name: strings.tokensByModel });
    expect(screen.getByRole('textbox', { name: strings.searchPlaceholder })).toBeVisible();
    const costFigure = screen.getByRole('figure', { name: strings.costByModel });
    const tokenLegend = within(tokenFigure).getAllByRole('listitem');
    const costLegend = within(costFigure).getAllByRole('listitem');
    expect(tokenLegend[0]).toHaveTextContent('token-heavy');
    expect(tokenLegend[0]).toHaveTextContent('83.3%');
    expect(costLegend[0]).toHaveTextContent('cost-heavy');
    expect(costLegend[0]).toHaveTextContent('90.0%');
    expect(screen.getByText(new RegExp(`${days[0]!.day}:`)).closest('ul')).toHaveClass('sr-only');
    await waitFor(() => expect(modelSearch).toContain('from='));
    expect(modelSearch).not.toContain('to=');
    expect(new URLSearchParams(daySearch).get('days')).toBe('7');
  });

  it('persists a changed range and sends both bounds for Today', async () => {
    renderStats();
    await screen.findByRole('figure', { name: strings.tokensByModel });
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    await waitFor(() => {
      const params = new URLSearchParams(modelSearch);
      expect(params.has('from')).toBe(true);
      expect(params.has('to')).toBe(true);
      expect(localStorage.getItem('elowen.stats.range')).toBe('today||');
    });
  });

  it('shows the retry state when one query fails while the other is still loading', async () => {
    server.use(
      http.get('*/api/usage/by-model', () => HttpResponse.json({ error: 'broken' }, { status: 500 })),
      http.get('*/api/usage/by-day', () => new Promise<Response>(() => {})),
    );
    renderStats();
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.queryByLabelText('Loading')).toBeNull();
  });

  it('opens a model detail rail from the keyboard and exposes cache figures', async () => {
    renderStats();
    const rows = await screen.findAllByTestId('model-usage-row');
    expect(rows[1]).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(rows[1]!, { key: 'Enter' });
    const dialog = await screen.findByRole('dialog', { name: `${strings.detailTitle}: cost-heavy` });
    expect(within(dialog).getByText(strings.detailCacheRead)).toBeTruthy();
    expect(within(dialog).getByText('100')).toBeTruthy();
    expect(within(dialog).getByText('62.5%')).toBeTruthy();
  });

  it('hides reset from non-admin users', async () => {
    server.use(http.get('*/api/auth/me', () => HttpResponse.json({ user: { id: 2, username: 'reader', is_admin: false } })));
    renderStats();
    await screen.findByRole('figure', { name: strings.tokensByModel });
    expect(screen.queryByRole('button', { name: strings.reset })).toBeNull();
  });

  it('requires the sentinel and sends the admin reset through the host mutation', async () => {
    const { wrapper: Wrapper } = createWrapper();
    render(<Wrapper><ToastProvider><StatsView /></ToastProvider></Wrapper>);
    const resetButton = await screen.findByRole('button', { name: strings.reset });
    fireEvent.click(resetButton);
    const dialog = await screen.findByRole('dialog', { name: strings.resetTitle });
    const input = within(dialog).getByLabelText(strings.resetConfirmHint.replace('{word}', strings.resetConfirmWord));
    const confirm = within(dialog).getByRole('button', { name: strings.resetConfirm });
    expect(confirm).toBeDisabled();
    fireEvent.change(input, { target: { value: strings.resetConfirmWord } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(resetCalls).toBe(1));
    expect(await screen.findByText(strings.resetDone)).toBeTruthy();
  });
});

describe('stats UI registration', () => {
  it('registers the bare plugin route declared by the manifest', () => {
    expect(registered).toHaveBeenCalledWith('stats', expect.anything());
    const registration = registered.mock.calls[0]![1] as { requiresApiVersion: number; pages: Record<string, ComponentType<unknown>> };
    expect((manifest as { web: { nav: { route: string }[] } }).web.nav.map((entry) => entry.route)).toEqual(['']);
    expect(Object.keys(registration.pages)).toEqual(['']);
    expect(registration.pages['']).toBe(StatsView);
    expect(registration.requiresApiVersion).toBe(1);
  });
});

describe('consumption origin drawer', () => {
  const originRows = [
    { userId: 2, username: 'patulka', origin: null, originKind: null, trusted: true, origins: 3, turns: 214, tokens: 5_902_110, cost: 8.12, costSource: 'provider_reported', costedTurns: 214, firstAt: Date.parse('2026-08-03T09:12:00Z'), lastAt: Date.parse('2026-08-17T10:42:00Z') },
    { userId: 1, username: 'admin', origin: null, originKind: null, trusted: false, origins: 1, turns: 40, tokens: 1_830_400, cost: null, costSource: 'unavailable', costedTurns: 0, firstAt: Date.parse('2026-08-10T09:12:00Z'), lastAt: Date.parse('2026-08-17T11:31:00Z') },
  ];
  const pairRows = [
    { userId: 2, username: 'patulka', origin: '203.0.113.7', originKind: 'ip', trusted: true, origins: 1, turns: 140, tokens: 4_210_003, cost: 6.01, costSource: 'provider_reported', costedTurns: 140, firstAt: Date.parse('2026-08-03T09:12:00Z'), lastAt: Date.parse('2026-08-17T10:42:00Z') },
    { userId: 2, username: 'patulka', origin: 'platform:discord', originKind: 'platform', trusted: true, origins: 1, turns: 13, tokens: 390_000, cost: null, costSource: 'unavailable', costedTurns: 0, firstAt: Date.parse('2026-08-05T09:12:00Z'), lastAt: Date.parse('2026-08-16T10:42:00Z') },
    { userId: 1, username: 'admin', origin: '198.51.100.44', originKind: 'ip', trusted: false, origins: 1, turns: 40, tokens: 1_830_400, cost: null, costSource: 'unavailable', costedTurns: 0, firstAt: Date.parse('2026-08-10T09:12:00Z'), lastAt: Date.parse('2026-08-17T11:31:00Z') },
  ];
  let originSearches: string[] = [];
  const serveOrigins = () => server.use(http.get('*/api/usage/by-origin', ({ request }) => {
    const url = new URL(request.url);
    originSearches.push(url.search);
    const group = url.searchParams.get('group');
    return HttpResponse.json({
      group, trackingSince: '2026-08-01',
      rows: group === 'pair' ? pairRows : originRows,
    });
  }));
  afterEach(() => { originSearches = []; });

  const openDrawer = async () => {
    renderStats();
    fireEvent.click(await screen.findByRole('button', { name: strings.originAction }));
  };

  it('ranks accounts, states the tracking window and marks an unverified source', async () => {
    serveOrigins();
    await openDrawer();

    // The framing comes before the ranking: without the tracking start the numbers read as the whole
    // history of the instance, and everything spent before the rollup existed has no origin at all.
    expect(await screen.findByText(strings.originTrackedSince.replace('{day}', '2026-08-01'))).toBeVisible();
    const rows = await screen.findAllByTestId('origin-row');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('patulka')).toBeVisible();
    expect(within(rows[0]).getByText(/8[.,]12/)).toBeVisible();
    // An uncosted bucket shows an em dash, never $0 — the price is unknown, not zero.
    expect(within(rows[1]).getByText('—')).toBeVisible();
    expect(within(rows[1]).getByLabelText(strings.originUnverified)).toBeVisible();
    expect(screen.getByText(strings.originUntrustedWarning.replace('{count}', '1'))).toBeVisible();
    // The default axis is the account, and the window travels with the query.
    expect(originSearches.some((s) => s.includes('group=user'))).toBe(true);
  });

  it('re-ranks by cost, which is a different order than by tokens', async () => {
    serveOrigins();
    await openDrawer();
    await screen.findAllByTestId('origin-row');

    fireEvent.click(screen.getByRole('radio', { name: strings.originSortCost }));
    const rows = await screen.findAllByTestId('origin-row');
    // admin has no reported cost at all, so a cost ranking must not leave them where the token ranking
    // put them — presenting one ordering as the other is the failure this switch exists to prevent.
    expect(within(rows[0]).getByText('patulka')).toBeVisible();
  });

  it('drills into one account and names non-address origins in words', async () => {
    serveOrigins();
    await openDrawer();
    const rows = await screen.findAllByTestId('origin-row');

    fireEvent.click(rows[0]);
    await waitFor(() => expect(screen.getByText(strings.originBack)).toBeVisible());
    const drill = await screen.findAllByTestId('origin-row');
    expect(within(drill[0]).getByText('203.0.113.7')).toBeVisible();
    // A chat bridge is not an address and must never be rendered as one.
    expect(within(drill[1]).getByText(`${strings.originPlatform}: discord`)).toBeVisible();
    expect(originSearches.some((s) => s.includes('group=pair'))).toBe(true);
  });

  it('is not offered to a non-admin, and never fires the request', async () => {
    serveOrigins();
    server.use(http.get('*/api/auth/me', () => HttpResponse.json({ user: { id: 2, username: 'patulka', is_admin: false } })));
    renderStats();
    await screen.findAllByTestId('model-usage-row');
    // The daemon refuses this route for a non-admin regardless; not offering it keeps a normal account
    // from firing a request that is designed to fail.
    expect(screen.queryByRole('button', { name: strings.originAction })).toBeNull();
    expect(originSearches).toEqual([]);
  });
});
