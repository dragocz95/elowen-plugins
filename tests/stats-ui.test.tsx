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
