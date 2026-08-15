/** The work bundle's stats view, and the bundle's own registration against its manifest.
 *
 *  The panels read the host runtime at module scope, so it is installed before they are imported.
 *
 *  The core copy of the StatsView suite wrapped the view in `EffectsProvider` (the app's ambient
 *  visual-effects context). No assertion here depends on it and the view renders identically without
 *  one, so the wrapper is dropped rather than reimplemented — everything the assertions read comes from
 *  the host runtime's own components.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import type { ComponentType } from 'react';
import { http, HttpResponse, setupServer, onUnhandledRequest } from './ui/http';
import { createWrapper } from './ui/hostHooks';
import { ensurePluginUiRuntime } from './ui/hostRuntime';
import manifest from '../plugins/work/elowen-plugin.json' with { type: 'json' };

// The bundle registers itself on import, so capture the registration the way the host would: install
// the real runtime first (the views read it at module scope), then take over the registration hook.
ensurePluginUiRuntime();
const registered = vi.fn();
(window as { __elowenRegisterPluginUi?: unknown }).__elowenRegisterPluginUi = registered;
const { StatsView } = await import('../plugins/work/web-src/stats/StatsView');
await import('../plugins/work/web-src/index');

let seenSearch = '';
const server = setupServer(
  http.get('*/api/usage/by-model', ({ request }) => {
    seenSearch = new URL(request.url).search;
    return HttpResponse.json([{ exec: 'sonnet', usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, total: 150, costUsd: 1.5 } }]);
  }),
  http.get('*/api/auth/me', () => HttpResponse.json({ user: { id: 1, username: 'admin', is_admin: true } })),
);
beforeAll(() => server.listen({ onUnhandledRequest }));
afterEach(() => { cleanup(); server.resetHandlers(); seenSearch = ''; localStorage.clear(); });
afterAll(() => server.close());

const renderStats = () => {
  const { wrapper: Wrapper } = createWrapper();
  return render(<Wrapper><StatsView /></Wrapper>);
};

describe('StatsView', () => {
  it('renders the date filter and the usage instrument from the default window', async () => {
    const { container } = renderStats();
    expect(await screen.findByText('sonnet')).toBeTruthy();
    expect(screen.getByTestId('spatial-workspace-layout')).toBeTruthy();
    expect(screen.queryByTestId('usage-flame')).toBeNull();
    expect(screen.getAllByRole('img', { name: 'Elowen' })).toHaveLength(1);
    expect(screen.queryByTestId('page-mascot')).toBeNull();
    expect(container.querySelectorAll('[data-control-surface]')).toHaveLength(1);
    // Default preset is '7d' — a finite from-bound is sent, no 'to' (open-ended).
    await waitFor(() => expect(seenSearch).toContain('from='));
    expect(seenSearch).not.toContain('to=');
  });

  it('changing the preset re-requests usage with a narrower window', async () => {
    renderStats();
    await screen.findByText('sonnet');
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    await waitFor(() => {
      const params = new URLSearchParams(seenSearch);
      expect(params.has('from')).toBe(true);
      expect(params.has('to')).toBe(true); // 'today' has both a start and end bound
    });
  });

  it('uses the shared compact data register while keeping both figures accessible', async () => {
    renderStats();

    const row = await screen.findByTestId('model-usage-row');
    const table = screen.getByRole('table', { name: 'Cost by model' });
    expect(table).toHaveClass('@container');
    expect(table.style.getPropertyValue('--data-table-compact-columns')).toBe('2rem minmax(0,1fr) auto');
    expect(row).toHaveClass('data-table-grid');
    expect(row).toHaveClass('interactive-row');
    expect(table.closest('.control-surface-register')).toBeInTheDocument();
    expect(row.className).not.toContain('rounded-xl');
    expect(screen.getByLabelText('Total tokens: 150')).toBeTruthy();
    expect(screen.getByLabelText('Tracked cost: $1.5000')).toBeTruthy();
  });
});

describe('work UI registration', () => {
  it('registers a page for every route the manifest puts in the sidebar', () => {
    expect(registered).toHaveBeenCalledWith('work', expect.anything());
    const registration = registered.mock.calls[0]![1] as {
      requiresApiVersion: number;
      pages: Record<string, ComponentType<unknown>>;
    };
    // Every nav entry must resolve to a page: the sidebar links straight at /p/work/<route>, and a
    // route with no registered page renders the host's "page missing" placeholder instead — a dead
    // menu item that nothing else in the build would notice.
    const routes = (manifest as { web: { nav: { route: string }[] } }).web.nav.map((entry) => entry.route);
    expect(routes).toEqual(['tasks', 'kanban', 'timeline', 'stats']);
    for (const route of routes) expect(typeof registration.pages[route]).toBe('function');
    // …plus the bare /p/work, which forwards to the register rather than showing nothing.
    expect(typeof registration.pages['']).toBe('function');
    expect(registration.requiresApiVersion).toBe((manifest as { web: { requiresApiVersion: number } }).web.requiresApiVersion);
  });
});
