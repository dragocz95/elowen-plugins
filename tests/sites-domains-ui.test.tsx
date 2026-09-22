import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { act, render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import { http, HttpResponse, listen, use, setDefaults, resetHandlers, close } from './ui/http';
import { ensurePluginUiRuntime } from './ui/hostRuntime';
import { ToastProvider, createWrapper } from './ui/hostHooks';
import { SiteDetail } from '../plugins/sites/web-src/SiteDetail';
import { DOMAIN_CHECK_POLL_MS } from '../plugins/sites/web-src/runtime';
import manifest from '../plugins/sites/elowen-plugin.json' with { type: 'json' };

ensurePluginUiRuntime();

const strings = (manifest as { web: { strings: Record<string, string> } }).web.strings;
const owner = { id: 7, username: 'filip', name: 'Filip', avatar: '' };
const site = {
  id: 'site-1',
  slug: 'demo-abc123',
  title: 'Demo',
  summary: '',
  visibility: 'private',
  status: 'live',
  degraded: false,
  url: 'https://demo-abc123.sites.example.com/',
  basePath: '/',
  projectId: 3,
  projectSlug: 'demo',
  ownerUserId: owner.id,
  owner,
  currentReleaseId: null,
  createdAt: '2026-09-22T06:00:00.000Z',
  createdModel: 'test/model',
  lastPublishAt: null,
  lastPublishModel: null,
  kind: 'proxy',
  target: '3000',
  preview: { state: 'none', version: 0, capturedAt: null, width: null, height: null },
  canManage: true,
};
const detail = {
  site,
  members: [],
  releases: [],
  hits: [],
  sourceDir: null,
  lastError: null,
  previewNotice: null,
};

const domain = (status: string, code: string, overrides: Record<string, unknown> = {}) => ({
  id: 'domain-' + status,
  hostname: status + '.customer.example',
  displayHostname: status + '.customer.example',
  url: 'https://' + status + '.customer.example/',
  kind: 'subdomain',
  delegatedRootWarning: true,
  status,
  statusCode: code,
  statusParams: code === 'dns_misdirected'
    ? { hostname: status + '.customer.example', observed: '203.0.113.9' }
    : code === 'authority_refused' ? { detail: 'CAA refused issuance' }
      : code === 'rate_limited' ? { time: '2026-09-22T07:00:00.000Z' }
        : code === 'renewal_dns_misdirected'
          ? { hostname: status + '.customer.example', observed: '203.0.113.9', date: '2026-10-22T06:00:00.000Z' }
          : code === 'certificate_expired' ? { date: '2026-09-21T06:00:00.000Z' }
            : code === 'dns_missing' ? { hostname: status + '.customer.example' } : {},
  isPrimary: status === 'ready',
  canOpen: status === 'ready' || status === 'renewal_blocked',
  removalState: status === 'removing' ? 'removing' : 'active',
  ownership: {
    state: status === 'awaiting_ownership' ? 'missing' : 'ready',
    code: status === 'awaiting_ownership' ? 'ownership_missing' : 'ownership_ready',
    params: {},
    record: {
      type: 'TXT',
      name: '_elowen-site.' + status + '.customer.example',
      value: 'elowen-site-verification=' + status,
    },
    checkedAt: '2026-09-22T06:05:00.000Z',
    expiresAt: status === 'awaiting_ownership' ? '2026-09-23T06:00:00.000Z' : null,
  },
  routing: {
    state: status === 'misdirected' || status === 'renewal_blocked' ? 'misdirected'
      : status === 'awaiting_routing' ? 'missing' : 'ready',
    code: status === 'misdirected' ? 'dns_misdirected'
      : status === 'renewal_blocked' ? 'dns_misdirected'
        : status === 'awaiting_routing' ? 'dns_missing' : 'dns_ready',
    params: {},
    hint: 'routingHintSubdomain',
    recommended: [{ type: 'CNAME', name: status + '.customer.example', value: 'edge.example.' }],
    alternatives: [{ type: 'A', name: status + '.customer.example', value: '192.0.2.44' }],
    observed: status === 'misdirected' ? ['203.0.113.9'] : [],
    checkedAt: '2026-09-22T06:05:00.000Z',
    nextCheckAt: '2026-09-22T06:20:00.000Z',
    planState: 'ready',
  },
  certificate: {
    state: status === 'ready' ? 'ready'
      : status === 'issuing' ? 'issuing'
        : status === 'authority_refused' ? 'authority_refused'
          : status === 'rate_limited' ? 'rate_limited'
            : status === 'renewal_blocked' ? 'renewal_blocked'
              : status === 'expired' ? 'expired' : 'none',
    code,
    params: {},
    requestedAt: status === 'issuing' ? '2026-09-22T06:05:00.000Z' : null,
    retryAt: status === 'rate_limited' ? '2026-09-22T07:00:00.000Z' : null,
    notAfter: ['ready', 'renewal_blocked', 'expired'].includes(status) ? '2026-10-22T06:00:00.000Z' : null,
  },
  ...overrides,
});

const generated = {
  id: 'site-1:generated',
  hostname: 'demo-abc123.sites.example.com',
  displayHostname: 'demo-abc123.sites.example.com',
  url: 'https://demo-abc123.sites.example.com/',
  effective: true,
};

const domainResponse = (domains: unknown[] = []) => ({
  siteId: site.id,
  effectiveUrl: generated.url,
  generated,
  primaryHostnameId: null,
  domains,
});

setDefaults(
  http.get('/api/plugins/ui', () => HttpResponse.json([
    { name: 'sites', url: '/plugins/sites/web/index.js', apiVersion: 12, nav: [], settings: [], strings },
  ])),
  http.get('/api/plugins/sites/api/site/:id', () => HttpResponse.json(detail)),
  http.get('/api/plugins/sites/api/site/:id/domains', () => HttpResponse.json(domainResponse())),
  http.get('/api/plugins/sites/api/directory', () => HttpResponse.json({ accounts: [owner] })),
);

beforeAll(() => listen());
afterEach(() => { cleanup(); resetHandlers(); localStorage.clear(); });
afterAll(() => close());

const mount = (
  siteOverride = site,
  domains = domainResponse(),
  domainReply = () => HttpResponse.json(domains),
) => {
  const { wrapper: Wrapper } = createWrapper();
  use(
    http.get('/api/plugins/sites/api/site/:id/domains', domainReply),
    http.get('/api/plugins/sites/api/site/:id', () => HttpResponse.json({
      ...detail,
      site: siteOverride,
    })),
  );
  render(
    <Wrapper>
      <ToastProvider>
        <SiteDetail siteId={site.id} allowPublicSites onDeleted={() => {}} />
      </ToastProvider>
    </Wrapper>,
  );
};

describe('custom domains in Site detail', () => {
  it('treats API record plans and classification as data instead of deriving them in the browser', () => {
    const source = readFileSync('plugins/sites/web-src/SiteDomains.tsx', 'utf8');
    expect(source).not.toMatch(/tldts|domainToASCII|parseSiteHostname|registrableDomain/);
    expect(source).not.toMatch(/type\s*===\s*['\"](?:A|AAAA|CNAME|ALIAS\/ANAME)['\"]/);
    expect(source).toContain('domain.routing.recommended');
    expect(source).toContain('domain.routing.hint');
  });

  it('shows generated fallback, empty state and manager-only Add domain control', async () => {
    mount();
    expect(await screen.findByText(generated.displayHostname)).toBeVisible();
    expect(screen.getByText('Addresses')).toBeVisible();
    expect(screen.getByText('This address stays available as a fallback and does not redirect.')).toBeVisible();
    expect(screen.getByText('No custom domain has been added.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add domain' })).toBeVisible();
  });

  it('uses shared loading and error states for the domain register', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    mount(site, domainResponse(), async () => {
      await pending;
      return HttpResponse.json(domainResponse());
    });
    await screen.findByText('Addresses');
    expect(document.querySelector('.loading-state')).not.toBeNull();
    release();
    expect(await screen.findByText(generated.displayHostname)).toBeVisible();
    cleanup();

    mount(site, domainResponse(), () => HttpResponse.json({ error: 'failed' }, { status: 500 }));
    expect(await screen.findByText('The domain addresses could not be loaded.')).toBeVisible();
    expect(screen.getByRole('button', { name: /retry/i })).toBeVisible();
  });

  it('does not fetch or disclose manager domain data to a non-manager', async () => {
    let requests = 0;
    use(http.get('/api/plugins/sites/api/site/:id/domains', () => {
      requests += 1;
      return HttpResponse.json(domainResponse([domain('ready', 'certificate_ready')]));
    }));
    mount({ ...site, canManage: false });
    expect(await screen.findByText(site.url)).toBeVisible();
    await act(async () => { await Promise.resolve(); });
    expect(requests).toBe(0);
    expect(screen.queryByText('Custom domains')).not.toBeInTheDocument();
  });

  it('renders every server-decided state and never derives DNS values in the browser', async () => {
    const domains = [
      domain('awaiting_ownership', 'ownership_missing'),
      domain('awaiting_routing', 'dns_missing'),
      domain('misdirected', 'dns_misdirected'),
      domain('issuing', 'certificate_issuing'),
      domain('ready', 'certificate_ready'),
      domain('authority_refused', 'authority_refused'),
      domain('rate_limited', 'rate_limited'),
      domain('renewal_blocked', 'renewal_dns_misdirected'),
      domain('expired', 'certificate_expired'),
      domain('removing', 'certificate_waiting'),
    ];
    mount(site, domainResponse(domains));

    expect(await screen.findByText('Waiting for the TXT record to appear.')).toBeVisible();
    expect(screen.getByText(/Waiting for awaiting_routing\.customer\.example to resolve/)).toBeVisible();
    expect(screen.getByText(/resolves elsewhere.*203\.0\.113\.9/)).toBeVisible();
    expect(screen.getByText('Requesting the certificate. This may take a few minutes.')).toBeVisible();
    expect(screen.getByText(/HTTPS is ready/)).toBeVisible();
    expect(screen.getByText(/CAA refused issuance/)).toBeVisible();
    expect(screen.getByText(/temporarily rate-limited/)).toBeVisible();
    expect(screen.getByText(/Renewal is paused.*203\.0\.113\.9/)).toBeVisible();
    expect(screen.getByText(/certificate expired/i)).toBeVisible();
    expect(screen.getAllByText('Removing').length).toBeGreaterThan(0);

    for (const item of domains) {
      expect(screen.queryByText(item.routing.recommended[0].value)).not.toBeInTheDocument();
      expect(screen.queryByText(item.routing.alternatives[0].value)).not.toBeInTheDocument();
    }
  });

  it('uses the shared modal, submits only hostname and localizes a claimed-domain refusal', async () => {
    const submitted: unknown[] = [];
    use(http.post('/api/plugins/sites/api/site/:id/domains', async ({ request }) => {
      submitted.push(await request.json());
      return HttpResponse.json({ error: { code: 'domain_claimed', params: {} } }, { status: 409 });
    }));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Add domain' }));

    const dialog = await screen.findByRole('dialog', { name: 'Add domain' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Domain name' }), {
      target: { value: 'WWW.Customer.Example.' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add domain' }));

    await waitFor(() => expect(submitted).toEqual([{ hostname: 'WWW.Customer.Example.' }]));
    expect(await within(dialog).findByText('This domain is already connected to another Site on this Elowen instance.')).toBeVisible();
  });

  it('keeps prior status cards visible while one bounded Check again request runs', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const pendingDomain = domain('awaiting_ownership', 'ownership_missing');
    use(
      http.post('/api/plugins/sites/api/site/:id/domains/:domain/check', async () => {
        await pending;
        return HttpResponse.json({ domain: pendingDomain });
      }),
    );
    mount(site, domainResponse([pendingDomain]));
    expect((await screen.findAllByText(pendingDomain.hostname, {}, { timeout: 2000 })).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Continue setup' }));

    const dialog = await screen.findByRole('dialog', { name: 'Connect ' + pendingDomain.hostname });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Check again' }));
    expect(await within(dialog).findByRole('button', { name: 'Checking…' })).toBeDisabled();
    expect(within(dialog).getByText('Ownership')).toBeVisible();
    expect(within(dialog).getByText('edge.example.')).toBeVisible();
    release();
  });

  it('reports a refused Check again as a sentence, not as the transport error', async () => {
    const refused = domain('awaiting_ownership', 'ownership_missing');
    use(http.post('/api/plugins/sites/api/site/:id/domains/:domain/check', () =>
      HttpResponse.json({ error: { code: 'claim_expired', params: {} } }, { status: 404 })));
    mount(site, domainResponse([refused]));

    fireEvent.click(await screen.findByRole('button', { name: 'Continue setup' }));
    const dialog = await screen.findByRole('dialog', { name: 'Connect ' + refused.hostname });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Check again' }));

    expect(await within(dialog).findByText(strings.claim_expired)).toBeVisible();
    // The host's message for a failed request is the technical string that used to stand here: it names
    // the request and its status, never the reason the server gave.
    expect(within(dialog).queryByText(/on \/plugins\/sites\/api\//)).not.toBeInTheDocument();
  });

  it('falls back to the host message for a refusal the server did not name', async () => {
    const waiting = domain('awaiting_ownership', 'ownership_missing');
    use(http.post('/api/plugins/sites/api/site/:id/domains/:domain/check', () =>
      HttpResponse.json({ error: 'forbidden' }, { status: 403 })));
    mount(site, domainResponse([waiting]));

    fireEvent.click(await screen.findByRole('button', { name: 'Continue setup' }));
    const dialog = await screen.findByRole('dialog', { name: 'Connect ' + waiting.hostname });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Check again' }));

    // A failure with no code on it is still reported, through the host's own message for it.
    expect(await within(dialog).findByText('forbidden')).toBeVisible();
  });

  it('reports a refused Make primary as the same sentence, and never reports a failure two ways', async () => {
    const ready = domain('ready', 'certificate_ready', { isPrimary: false });
    use(http.post('/api/plugins/sites/api/site/:id/domains/:domain/primary', () =>
      HttpResponse.json({ error: { code: 'claim_expired', params: {} } }, { status: 404 })));

    mount(site, domainResponse([ready]));
    fireEvent.click(await screen.findByRole('button', { name: 'Make primary' }));

    expect(await screen.findByText(strings.claim_expired)).toBeVisible();
    // Add read a refusal in the reader's words and the other three read it as the host's raw message.
    // Exactly one call may reach for that raw message — the shared one every action goes through — so a
    // second way of reporting the same failure cannot reappear at a call site.
    const source = readFileSync('plugins/sites/web-src/SiteDomains.tsx', 'utf8');
    expect(source.match(/apiErrorMessage/g) ?? []).toHaveLength(1);
  });

  it('refreshes the register from the server after an automatic check fails', async () => {
    const pending = domain('awaiting_ownership', 'ownership_missing');
    let lists = 0;
    let checks = 0;
    use(http.post('/api/plugins/sites/api/site/:id/domains/:domain/check', () => {
      checks += 1;
      return HttpResponse.json({ error: { code: 'claim_expired', params: {} } }, { status: 404 });
    }));
    // The domain the reader has just removed: the register drops it the moment the server stops listing it.
    mount(site, domainResponse([pending]), () => {
      lists += 1;
      return HttpResponse.json(domainResponse(lists === 1 ? [pending] : []));
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Continue setup' }));
    await screen.findByRole('dialog', { name: 'Connect ' + pending.hostname });
    expect(lists).toBe(1);

    // The dialog's own schedule is what fires an automatic check. Only Date is faked, so the countdown
    // keeps ticking on real timers and the next tick lands past the slot the schedule had set.
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.now() + DOMAIN_CHECK_POLL_MS + 5_000);
      await waitFor(() => expect(checks).toBe(1), { timeout: 3_000 });
      await waitFor(() => expect(lists).toBe(2), { timeout: 3_000 });
      await waitFor(() => expect(screen.queryByText(pending.hostname)).not.toBeInTheDocument(), { timeout: 3_000 });

      // Nothing is left to watch, so the schedule has nothing more to ask about.
      vi.setSystemTime(Date.now() + DOMAIN_CHECK_POLL_MS + 5_000);
      await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 1_200); }); });
      expect(checks).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  }, 20_000);
});
