import { cleanup, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CronNextRunMetric } from '../plugins/cronjob/web-src/index';
import { http, HttpResponse, listen, resetHandlers, setupServer, setDefaults, close } from './ui/http';
import { createWrapper } from './ui/hostHooks';
import { ensurePluginUiRuntime } from './ui/hostRuntime';

ensurePluginUiRuntime();

const jobs = {
  nearest: { id: 'daily-check', name: 'Daily check', schedule: 'daily 11:00', prompt: 'Check it', enabled: true,
    nextOccurrence: { expectedAt: '2026-08-30T11:00:00.000Z' } },
  paused: { id: 'paused', name: 'Paused job', schedule: 'daily 07:00', prompt: 'Skip', enabled: false, nextOccurrence: null },
};

const server = setupServer();

setDefaults(
  http.get('/api/plugins/ui', () => HttpResponse.json([{ name: 'cronjob', url: '/plugins/cronjob/web/index.js', apiVersion: 17, nav: [], account: [], user: [], project: [], settings: [], strings: { nextRun: 'Next run', nextRunUnknown: 'No scheduled jobs' } }])),
  http.get('/api/auth/me', () => HttpResponse.json({ user: { id: 1, username: 'admin', is_admin: true } })),
  http.get('/api/plugins/cronjob/jobs', () => HttpResponse.json(Object.values(jobs))),
);
beforeAll(() => listen());
afterEach(() => { cleanup(); resetHandlers(); });
afterAll(() => close());

function mount() {
  const { wrapper: Wrapper } = createWrapper();
  render(<Wrapper><CronNextRunMetric now={Date.UTC(2026, 7, 30, 10)} locale="en-US" monthCostUsd={null} monthTokens={0} /></Wrapper>);
}

describe('cronjob dashboard metric', () => {
  it('renders the nearest server-projected run from the real producer', async () => {
    mount();
    expect(await screen.findByText('Next run')).toBeInTheDocument();
    expect(await screen.findByText('Daily check')).toBeInTheDocument();
  });

  it('does not invent a run when the server has no projection', async () => {
    server.use(http.get('/api/plugins/cronjob/jobs', () => HttpResponse.json([
      { ...jobs.paused },
      { id: 'legacy', name: 'Legacy job', schedule: 'every 15m', prompt: 'b', enabled: true },
      { id: 'broken', name: 'Broken job', schedule: 'daily 09:00', prompt: 'b', enabled: true, nextOccurrence: { expectedAt: 'not-a-date' } },
    ])));
    mount();
    expect(await screen.findByText('No scheduled jobs')).toBeInTheDocument();
    expect(screen.queryByText('Legacy job')).toBeNull();
    expect(screen.queryByText('Broken job')).toBeNull();
  });
});
