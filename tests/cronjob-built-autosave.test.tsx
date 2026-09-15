import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import type { PluginUiRegistration } from 'elowen-plugin-ui-kit';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse, listen, resetHandlers, setDefaults, use, close } from './ui/http';
import { ensurePluginUiRuntime } from './ui/hostRuntime';
import { ToastProvider, createWrapper } from './ui/hostHooks';
import type { CronJob } from '../plugins/cronjob/web-src/runtime';
import manifest from '../plugins/cronjob/elowen-plugin.json' with { type: 'json' };

ensurePluginUiRuntime();

type BundleRegistration = Pick<PluginUiRegistration, 'requiresApiVersion' | 'settings' | 'ownsPageFrame'>;
const strings = (manifest as { web: { strings: Record<string, string> } }).web.strings;
const bundlePath = resolve(new URL('../plugins/cronjob/web/index.js', import.meta.url).pathname);
const job: CronJob = {
  id: 'built-1', name: 'digest', schedule: 'daily 06:00', prompt: 'do it', enabled: true,
  lifecycle: 'recurring', revision: 0,
  nextOccurrence: {
    occurrenceId: 'built-1:slot:2026-09-15T06:00',
    scheduledAt: '2026-09-15T05:00:00.000Z', expectedAt: '2026-09-15T05:00:00.000Z',
    localDate: '2026-09-15', localTime: '06:00', timezone: 'Europe/Prague',
    disposition: 'onTime', guarded: false,
  },
};
const calendarBody = {
  generatedAt: '2026-09-15T05:00:00.000Z',
  timezone: 'Europe/Prague',
  precisionMs: 30_000,
  snapshot: 'built-snap-v1',
  window: { startLocalDate: '2026-09-15', endLocalDateExclusive: '2026-09-16', startAt: '2026-09-14T22:00:00.000Z', endAt: '2026-09-15T22:00:00.000Z' },
  scheduler: { ready: true },
  jobs: [job],
  days: [{ date: '2026-09-15', total: 1, samples: [{ id: 'built-1:slot:2026-09-15T06:00', jobId: 'built-1', lifecycle: 'recurring', scheduledAt: '2026-09-15T05:00:00.000Z', expectedAt: '2026-09-15T05:00:00.000Z', localDate: '2026-09-15', localTime: '06:00', timezone: 'Europe/Prague', disposition: 'onTime', guarded: false }], overflow: 0, omittedByHours: 0 }],
  occurrences: [],
  truncated: false,
};

setDefaults(
  http.get('/api/plugins/ui', () => HttpResponse.json([{ name: 'cronjob', url: '/plugins/cronjob/web/index.js', apiVersion: 17, nav: [], settings: [], strings }])),
  http.get('/api/auth/me', () => HttpResponse.json({ user: { id: 7, username: 'filip', is_admin: true } })),
  http.get('/api/plugins/destinations', () => HttpResponse.json([])),
  http.get('/api/brain/models', () => HttpResponse.json([])),
  http.get('/api/projects', () => HttpResponse.json([])),
);
beforeAll(() => listen());
afterEach(() => { cleanup(); resetHandlers(); });
afterAll(() => close());

async function loadBuiltRegistration(): Promise<BundleRegistration> {
  let captured: BundleRegistration | undefined;
  window.__elowenRegisterPluginUi = (_plugin, registration) => { captured = registration; };
  await import(`${pathToFileURL(bundlePath).href}?autosave-smoke=${Date.now()}`);
  if (!captured) throw new Error('the built cronjob bundle registered no UI');
  return captured;
}

describe('committed cronjob bundle autosave', () => {
  it('registers the built entry and persists an edit through the host runtime', async () => {
    const writes: unknown[] = [];
    use(
      http.get('/api/plugins/cronjob/api/calendar', () => HttpResponse.json(calendarBody)),
      http.get('/api/plugins/cronjob/api/conversations', () => HttpResponse.json({ status: 'available', conversations: [] })),
      http.get('/api/plugins/cronjob/jobs', () => HttpResponse.json([job])),
      http.put('/api/plugins/cronjob/jobs/:id', async ({ request }) => {
        writes.push(await request.json());
        return HttpResponse.json({ ok: true });
      }),
    );
    const registration = await loadBuiltRegistration();
    const Jobs = registration.settings?.jobs;
    if (!Jobs) throw new Error('the built cronjob registration has no jobs section');
    const { wrapper: Wrapper } = createWrapper();
    render(<Wrapper><ToastProvider><Jobs plugin="cronjob" params={{}} rest={[]} surface="deck" /></ToastProvider></Wrapper>);

    await screen.findByText('digest');
    fireEvent.click(await screen.findByRole('button', { name: strings.openJob.replace('{name}', 'digest') }));
    const input = await screen.findByPlaceholderText('morning-digest');
    fireEvent.change(input, { target: { value: 'built-edit' } });
    await waitFor(() => expect(writes).toHaveLength(1), { timeout: 3000 });
    expect(writes[0]).toMatchObject({ id: 'built-1', name: 'built-edit', prompt: 'do it' });
  });
});
