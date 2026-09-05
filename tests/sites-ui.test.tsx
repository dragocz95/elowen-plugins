import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import { http, HttpResponse, listen, use, setDefaults, resetHandlers, close } from './ui/http';
import { ensurePluginUiRuntime } from './ui/hostRuntime';
import { SitesPage } from '../plugins/sites/web-src/SitesPage';
import { SiteDetail } from '../plugins/sites/web-src/SiteDetail';
import { EnvironmentsSetup } from '../plugins/sites/web-src/EnvironmentsSetup';
import manifest from '../plugins/sites/elowen-plugin.json' with { type: 'json' };
import { ToastProvider, createWrapper } from './ui/hostHooks';

/** The Sites workspace is the app's register-plus-drawer pattern, and the three things it was rebuilt
 *  for are all silent when they break: a person rendered as an account id, a value typed by hand where
 *  a dropdown belongs, and a drawer that changes shape depending on what you clicked. None of them
 *  fails a typecheck, so they are asserted here against the real host runtime contract. */

// The panel resolves everything through window.ElowenUiRuntime — install the real stand-in, so this
// exercises the same boundary the built bundle runs on.
ensurePluginUiRuntime();

// View copy is served per-plugin by /plugins/ui; serving the REAL manifest fallback keeps these
// assertions in lockstep with what a user sees.
const strings = (manifest as { web: { strings: Record<string, string> } }).web.strings;

// A person carries the picture too, so the register and the drawer draw the same face the rest of the
// application does. OWNER has one uploaded; the other two do not and fall back to the monogram.
const OWNER = { id: 7, username: 'filip', name: 'Filip Džudža', avatar: '7.png' };
const GUEST = { id: 9, username: 'patricie', name: 'Patricie Nováková', avatar: '' };
const OUTSIDER = { id: 11, username: 'lucie', name: 'Lucie Marková', avatar: '' };

const site = {
  id: 'site-1',
  slug: 'dashboard-abc123',
  title: 'Provozní přehled',
  summary: 'Denní čísla pro tým.',
  visibility: 'private',
  status: 'live',
  url: 'https://dashboard-abc123.sites.example.com/',
  basePath: '/',
  projectId: 3,
  projectSlug: 'kolin',
  ownerUserId: OWNER.id,
  owner: OWNER,
  createdAt: '2026-08-01T10:00:00.000Z',
  createdModel: 'anthropic/claude',
  lastPublishAt: '2026-08-20T10:00:00.000Z',
  lastPublishModel: 'anthropic/claude',
  spa: false,
  runtime: 'command',
  canManage: true,
};

const detail = {
  site,
  members: [GUEST],
  releases: [{ id: 'rel-2', siteId: site.id, createdAt: '2026-08-20T10:00:00.000Z', model: 'anthropic/claude', fileCount: 12, sizeBytes: 220_000, note: 'August numbers', kind: 'files' }],
  hits: [{ day: '2026-08-20', count: 41 }],
  sourceDir: '/var/www/kolin/reports',
  runtime: {
    running: true,
    startCommand: 'node server.js',
    bind: 'socket',
    port: null,
    network: 'shared',
    allowLoopbackPorts: true,
    logTail: 'listening on socket',
    lastError: null,
  },
  environment: null,
};

setDefaults(
  http.get('/api/plugins/ui', () => HttpResponse.json([
    { name: 'sites', url: '/plugins/sites/web/index.js', apiVersion: 7, nav: [], settings: [], strings },
  ])),
  http.get('/api/plugins/sites/api/sites', () => HttpResponse.json({
    mine: [site], shared: [], allowPublicSites: true,
  })),
  http.get('/api/plugins/sites/api/site/:id', () => HttpResponse.json(detail)),
  http.get('/api/plugins/sites/api/directory', () => HttpResponse.json({ accounts: [OWNER, GUEST, OUTSIDER] })),
);

beforeAll(() => listen());
afterEach(() => { cleanup(); resetHandlers(); localStorage.clear(); });
afterAll(() => close());

const mount = () => {
  const { wrapper: Wrapper } = createWrapper();
  render(<Wrapper><ToastProvider><SitesPage /></ToastProvider></Wrapper>);
};

/** The register row opens the drawer through its own control; its accessible name is the site's title
 *  followed by the address the API reported. */
const openSite = async () => {
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(site.title) }));
  const drawer = await screen.findByRole('dialog', { name: strings.detailTitle });
  // The drawer resolves the site by id on open, so wait for the loaded document rather than the frame.
  await within(drawer).findByText(strings.address);
  return drawer;
};

describe('the Sites workspace', () => {
  it('uses the host search and condensed filters pattern instead of a hand-laid toolbar', async () => {
    const { wrapper: Wrapper } = createWrapper();
    const { container } = render(<Wrapper><ToastProvider><SitesPage /></ToastProvider></Wrapper>);
    const search = await screen.findByRole('searchbox', { name: strings.searchPlaceholder });
    const toolbar = search.closest('.page-toolbar');
    expect(toolbar).not.toBeNull();
    expect(within(toolbar!).getByTestId('page-filters-trigger')).toBeVisible();
    expect(container.querySelector('.control-surface-toolbar')).toBeNull();

    fireEvent.click(within(toolbar!).getByTestId('page-filters-trigger'));
    const filters = screen.getByRole('dialog', { name: 'Filters' });
    expect(within(filters).getByRole('combobox', { name: strings.filterVisibility })).toBeVisible();
    expect(within(filters).getByRole('combobox', { name: strings.filterStatus })).toBeVisible();
    fireEvent.change(within(filters).getByRole('combobox', { name: strings.filterStatus }), { target: { value: 'failed' } });
    expect(screen.getByTestId('page-filter-chips')).toHaveTextContent(`${strings.filterStatus}: ${strings.statusFailed}`);
  });

  it('shows each site\'s owner as an avatar and a name, never as an account id', async () => {
    mount();
    expect(await screen.findByText(site.title)).toBeInTheDocument();
    // The host Avatar carries the person's name; the raw account id must appear nowhere.
    expect(screen.getAllByLabelText(OWNER.name).length).toBeGreaterThan(0);
    expect(screen.queryByText(`#${OWNER.id}`)).not.toBeInTheDocument();
  });

  it('opens one detail drawer holding every part of the site at once', async () => {
    mount();
    const drawer = within(await openSite());
    // No tab strip: address, access, guests, releases, runtime and deletion are all present together,
    // which is what keeps the drawer one size on every surface.
    expect(drawer.getByText(strings.address)).toBeInTheDocument();
    expect(drawer.getAllByText(strings.whoCanOpen).length).toBeGreaterThan(0);
    expect(drawer.getByText(strings.guests)).toBeInTheDocument();
    expect(drawer.getAllByText(strings.releases).length).toBeGreaterThan(0);
    expect(drawer.getByText(strings.runtime)).toBeInTheDocument();
    expect(drawer.getByText(strings.deleteTitle)).toBeInTheDocument();
    // A named guest is a face and a name here too.
    expect(drawer.getByText(GUEST.name)).toBeInTheDocument();
    expect(drawer.getAllByLabelText(GUEST.name).length).toBeGreaterThan(0);
  });

  it('edits the command runtime without opening another surface', async () => {
    const patched: unknown[] = [];
    use(http.patch('/api/plugins/sites/api/site/:id', async ({ request }) => {
      patched.push(await request.json());
      return HttpResponse.json({ site });
    }));
    mount();
    const drawer = within(await openSite());
    expect(drawer.getByText(strings.runtimeNetworkShared)).toBeVisible();
    fireEvent.change(drawer.getByRole('textbox', { name: strings.runtimeCommand }), { target: { value: 'node new-server.js' } });
    fireEvent.change(drawer.getByRole('combobox', { name: strings.runtimeBind }), { target: { value: 'port' } });
    fireEvent.click(drawer.getByRole('button', { name: strings.saveRuntime }));
    await waitFor(() => expect(patched).toEqual([{ startCommand: 'node new-server.js', bind: 'port' }]));
  });

  it('changes visibility through a dropdown', async () => {
    const patched: unknown[] = [];
    use(http.patch('/api/plugins/sites/api/site/:id', async ({ request }) => {
      patched.push(await request.json());
      return HttpResponse.json({ site });
    }));
    mount();
    const drawer = within(await openSite());
    // A dropdown, not a text field: the control the user reaches for is a listbox of the four values.
    const picker = drawer.getByRole('combobox', { name: strings.whoCanOpen });
    fireEvent.change(picker, { target: { value: 'authenticated' } });
    await waitFor(() => expect(patched).toEqual([{ visibility: 'authenticated' }]));
  });

  it('submits only one visibility change while the first request is pending', async () => {
    const patched: unknown[] = [];
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    use(http.patch('/api/plugins/sites/api/site/:id', async ({ request }) => {
      patched.push(await request.json());
      await pending;
      return HttpResponse.json({ site });
    }));
    mount();
    const drawer = within(await openSite());
    const picker = drawer.getByRole('combobox', { name: strings.whoCanOpen }) as HTMLSelectElement;
    act(() => {
      picker.value = 'authenticated';
      picker.dispatchEvent(new Event('change', { bubbles: true }));
      picker.value = 'private';
      picker.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await waitFor(() => expect(patched).toEqual([{ visibility: 'authenticated' }]));
    release();
  });

  it('never publishes to the world without a confirmation', async () => {
    const patched: unknown[] = [];
    use(http.patch('/api/plugins/sites/api/site/:id', async ({ request }) => {
      patched.push(await request.json());
      return HttpResponse.json({ site });
    }));
    mount();
    const drawer = within(await openSite());
    fireEvent.change(drawer.getByRole('combobox', { name: strings.whoCanOpen }), { target: { value: 'public' } });

    // Picking "public" asks; it does not write.
    const confirm = await screen.findByRole('dialog', { name: strings.publicConfirm });
    expect(patched).toEqual([]);
    fireEvent.click(within(confirm).getByRole('button', { name: strings.publicConfirm }));
    await waitFor(() => expect(patched).toEqual([{ visibility: 'public' }]));
  });

  it('replaces the guest list through one atomic request', async () => {
    const replaced: unknown[] = [];
    use(
      http.post('/api/plugins/sites/api/site/:id/members/replace', async ({ request }) => {
        replaced.push(await request.json());
        return HttpResponse.json({ ok: true });
      }),
    );
    mount();
    const drawer = within(await openSite());
    fireEvent.click(drawer.getByRole('button', { name: strings.manageGuests }));

    const picker = await screen.findByRole('dialog', { name: strings.guestsPickerTitle });
    // The owner already holds the site, so they are not offered as a guest of it.
    expect(within(picker).queryByRole('button', { name: new RegExp(OWNER.name) })).not.toBeInTheDocument();
    // Each candidate carries an avatar in the picker's icon slot.
    expect(picker.querySelectorAll('[data-avatar]').length).toBeGreaterThan(0);

    fireEvent.click(within(picker).getByRole('button', { name: new RegExp(OUTSIDER.name) }));
    fireEvent.click(within(picker).getByRole('button', { name: 'Save changes' }));

    // The server receives the complete intended set and applies it in one transaction.
    await waitFor(() => expect(replaced).toEqual([{ userIds: [GUEST.id, OUTSIDER.id] }]));
  });
});

const environmentSite = {
  ...site,
  id: 'environment-1',
  slug: 'environment-abc123',
  title: 'Persistent service',
  runtime: 'environment',
  currentReleaseId: 'snapshot-active',
};

const environmentDetail = {
  site: environmentSite,
  members: [],
  releases: [
    { id: 'snapshot-active', siteId: environmentSite.id, createdAt: '2026-08-20T10:00:00.000Z', model: 'test/model', fileCount: 0, sizeBytes: 0, note: 'Known good', kind: 'environment-snapshot', includesData: true },
    { id: 'snapshot-older', siteId: environmentSite.id, createdAt: '2026-08-19T10:00:00.000Z', model: 'test/model', fileCount: 0, sizeBytes: 0, note: 'Before update', kind: 'environment-snapshot', includesData: true },
  ],
  hits: [],
  sourceDir: '/var/www/project/service',
  runtime: null,
  environment: {
    state: 'running',
    desiredState: 'running',
    limits: { cpus: 1, memoryMb: 1024, pidsLimit: 512, diskSoftMb: 4096 },
    limitOverrides: { cpus: null, memoryMb: 2048, pidsLimit: null, diskSoftMb: null },
    lastError: null,
    action: null,
    canControl: true,
    canReadLogs: true,
    canSetLimits: true,
    transport: { buffered: true, requestBodyLimitBytes: 1024 * 1024 },
  },
};

const mountEnvironment = (response = environmentDetail, onDetail?: () => void) => {
  use(
    http.get('/api/plugins/sites/api/site/:id', () => { onDetail?.(); return HttpResponse.json(response); }),
    http.get('/api/plugins/sites/api/site/:id/logs', () => HttpResponse.json({ lifecycle: 'started container', journal: 'service ready', lines: 200 })),
  );
  const { wrapper: Wrapper } = createWrapper();
  const rendered = render(
    <Wrapper><ToastProvider><SiteDetail siteId={environmentSite.id} allowPublicSites onDeleted={() => {}} /></ToastProvider></Wrapper>,
  );
  return rendered;
};

describe('environment setup settings', () => {
  it('is registered in the host plugin detail settings navigation', () => {
    expect((manifest.web as { settings?: unknown[] }).settings).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'environment-setup', placement: 'pluginDetail' }),
    ]));
  });

  it.each([
    ['ready', strings.environmentStatusReady],
    ['missing', strings.environmentStatusMissing],
  ] as const)('renders the authoritative %s DNS state', async (status, label) => {
    use(
      http.get('/api/plugins/sites/api/gateway/readiness', () => HttpResponse.json({
        ready: status === 'ready',
        status,
        detail: status === 'ready' ? 'sites.example.com' : '*.sites.example.com does not resolve.',
        expectedRecord: status === 'ready' ? null : { type: 'CNAME', name: '*.sites.example.com', value: 'app.example.com.' },
        observedTargets: [],
      })),
      http.get('/api/plugins/sites/api/environments/readiness', () => HttpResponse.json({ ready: true, canProvision: false, items: [] })),
    );
    const { wrapper: Wrapper } = createWrapper();
    render(<Wrapper><ToastProvider><EnvironmentsSetup plugin="sites" params={{}} rest={[]} surface="deck" /></ToastProvider></Wrapper>);
    await waitFor(() => expect(screen.getAllByText(label).length).toBeGreaterThan(0));
  });

  it('renders the exact configured A record returned by readiness', async () => {
    use(
      http.get('/api/plugins/sites/api/gateway/readiness', () => HttpResponse.json({
        ready: false,
        status: 'missing',
        detail: '*.sites.example.com does not resolve.',
        expectedRecord: { type: 'A', name: '*.sites.example.com', value: '198.51.100.77' },
        observedTargets: [],
      })),
      http.get('/api/plugins/sites/api/environments/readiness', () => HttpResponse.json({ ready: true, canProvision: false, items: [] })),
    );
    const { wrapper: Wrapper } = createWrapper();
    render(<Wrapper><ToastProvider><EnvironmentsSetup plugin="sites" params={{}} rest={[]} surface="deck" /></ToastProvider></Wrapper>);

    expect(await screen.findByText('198.51.100.77')).toBeVisible();
    expect(screen.getByText('A')).toBeVisible();
    expect(screen.getByText('*.sites.example.com')).toBeVisible();
  });

  it('shows authoritative DNS states and provisions only after one confirmed request', async () => {
    let ready = false;
    const posts: unknown[] = [];
    use(
      http.get('/api/plugins/sites/api/gateway/readiness', () => HttpResponse.json({
        ready: false,
        status: 'misdirected',
        detail: '*.sites.example.com resolves, but not to app.example.com.',
        expectedRecord: { type: 'CNAME', name: '*.sites.example.com', value: 'app.example.com.' },
        observedTargets: ['203.0.113.8'],
      })),
      http.get('/api/plugins/sites/api/environments/readiness', () => HttpResponse.json({
        ready,
        canProvision: true,
        items: [
          { id: 'podman', label: 'Podman', ok: ready, detail: ready ? 'Rootless Podman is available.' : 'Podman is missing.' },
          { id: 'base-image', label: 'Deterministic Sites base image', ok: ready },
        ],
      })),
      http.post('/api/plugins/sites/api/environments/provision', async ({ request }) => {
        posts.push(await request.text());
        ready = true;
        return HttpResponse.json({ ready: true, canProvision: true, items: [] });
      }),
    );
    const { wrapper: Wrapper } = createWrapper();
    render(<Wrapper><ToastProvider><EnvironmentsSetup plugin="sites" params={{}} rest={[]} surface="deck" /></ToastProvider></Wrapper>);

    expect(await screen.findByText(strings.environmentGatewayTitle)).toBeVisible();
    expect(screen.getAllByText(strings.environmentStatusMisdirected).length).toBeGreaterThan(0);
    expect(screen.getByText('*.sites.example.com')).toBeVisible();
    expect(screen.getByText('203.0.113.8', { exact: false })).toBeVisible();
    const install = screen.getByRole('button', { name: strings.environmentProvision });
    fireEvent.click(install);
    expect(posts).toHaveLength(0);
    const dialog = await screen.findByRole('dialog', { name: strings.environmentProvisionConfirmTitle });
    for (const expected of ['Podman', 'crun', 'uidmap', 'dbus-user-session', 'passt', 'slirp4netns', 'fuse-overlayfs', 'subordinate IDs', 'linger', 'cgroup delegation']) {
      expect(dialog).toHaveTextContent(expected);
    }
    expect(dialog).toHaveTextContent('does not restart Elowen, web or nginx');
    const confirm = within(dialog).getByRole('button', { name: strings.environmentProvision });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(posts).toHaveLength(1));
    await waitFor(() => expect(screen.getAllByText(strings.pass).length).toBeGreaterThan(0));
    expect(screen.getByRole('button', { name: strings.environmentProvision })).toBeDisabled();
  });

  it('handles failed provisioning without an unhandled rejection and remeasures once', async () => {
    let readinessRequests = 0;
    use(
      http.get('/api/plugins/sites/api/gateway/readiness', () => HttpResponse.json({ ready: true, status: 'ready', detail: 'sites.example.com', expectedRecord: null, observedTargets: [] })),
      http.get('/api/plugins/sites/api/environments/readiness', () => {
        readinessRequests += 1;
        return HttpResponse.json({ ready: false, canProvision: true, items: [{ id: 'podman', label: 'Podman', ok: false }] });
      }),
      http.post('/api/plugins/sites/api/environments/provision', () => HttpResponse.json({ error: 'package installation failed' }, { status: 502 })),
    );
    const { wrapper: Wrapper } = createWrapper();
    render(<Wrapper><ToastProvider><EnvironmentsSetup plugin="sites" params={{}} rest={[]} surface="deck" /></ToastProvider></Wrapper>);
    fireEvent.click(await screen.findByRole('button', { name: strings.environmentProvision }));
    const dialog = await screen.findByRole('dialog', { name: strings.environmentProvisionConfirmTitle });
    fireEvent.click(within(dialog).getByRole('button', { name: strings.environmentProvision }));
    expect(await screen.findByRole('alert')).toHaveTextContent('package installation failed');
    await waitFor(() => expect(readinessRequests).toBe(2));
  });

  it('never renders the provisioning action without admin capability', async () => {
    use(
      http.get('/api/plugins/sites/api/gateway/readiness', () => HttpResponse.json({ ready: true, status: 'ready', detail: 'sites.example.com', expectedRecord: null, observedTargets: [] })),
      http.get('/api/plugins/sites/api/environments/readiness', () => HttpResponse.json({ ready: false, canProvision: false, items: [{ id: 'podman', label: 'Podman', ok: false }] })),
    );
    const { wrapper: Wrapper } = createWrapper();
    render(<Wrapper><ToastProvider><EnvironmentsSetup plugin="sites" params={{}} rest={[]} surface="deck" /></ToastProvider></Wrapper>);
    expect(await screen.findByText('Podman')).toBeVisible();
    expect(screen.queryByRole('button', { name: strings.environmentProvision })).not.toBeInTheDocument();
  });
});

describe('persistent environment detail', () => {
  it('shows states, transport, snapshots and bounded plain-text logs without the command editor', async () => {
    const { container } = mountEnvironment();
    expect(await screen.findByText(strings.environmentState)).toBeVisible();
    expect(screen.getByText(strings.environmentTransportLimit)).toBeVisible();
    expect(screen.getAllByText(strings.environmentSnapshots).length).toBeGreaterThan(0);
    expect(screen.getByText('service ready', { exact: false })).toBeVisible();
    expect(screen.queryByRole('textbox', { name: strings.runtimeCommand })).not.toBeInTheDocument();
    expect(container.querySelector('.grid-cols-1.sm\\:grid-cols-2')).not.toBeNull();
  });

  it('submits one lifecycle mutation while the first request is pending', async () => {
    const controls: unknown[] = [];
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    use(http.post('/api/plugins/sites/api/site/:id/control', async ({ request }) => {
      controls.push(await request.json());
      await pending;
      return HttpResponse.json({ ok: true, scheduled: true });
    }));
    mountEnvironment();
    const restart = await screen.findByRole('button', { name: strings.environmentRestart });
    fireEvent.click(restart);
    fireEvent.click(restart);
    await waitFor(() => expect(controls).toEqual([{ action: 'restart' }]));
    release();
  });

  it('keeps snapshot data and restore data as explicit separate choices', async () => {
    const snapshots: unknown[] = [];
    const restores: unknown[] = [];
    use(
      http.post('/api/plugins/sites/api/site/:id/snapshot', async ({ request }) => {
        snapshots.push(await request.json());
        return HttpResponse.json({ ok: true, scheduled: true });
      }),
      http.post('/api/plugins/sites/api/site/:id/rollback', async ({ request }) => {
        restores.push(await request.json());
        return HttpResponse.json({ ok: true, scheduled: true });
      }),
    );
    mountEnvironment();
    const note = await screen.findByRole('textbox', { name: strings.environmentSnapshotNote });
    fireEvent.change(note, { target: { value: 'Before migration' } });
    const includeData = screen.getByRole('switch', { name: strings.environmentIncludeData });
    expect(includeData).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(includeData);
    expect(includeData).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(screen.getByRole('button', { name: strings.environmentSnapshot }));
    await waitFor(() => expect(snapshots).toEqual([{ includeData: false, note: 'Before migration' }]));

    fireEvent.click(screen.getByRole('button', { name: strings.environmentRestoreData }));
    const dialog = await screen.findByRole('dialog', { name: strings.environmentRestoreConfirmTitle });
    expect(within(dialog).getByText(strings.environmentRestoreWithDataWarning)).toBeVisible();
    fireEvent.click(within(dialog).getByRole('button', { name: strings.environmentRestore }));
    await waitFor(() => expect(restores).toEqual([{ releaseId: 'snapshot-older', restoreData: true }]));
  });

  it('shows a durable pending action and disables further environment mutations', async () => {
    mountEnvironment({
      ...environmentDetail,
      environment: {
        ...environmentDetail.environment,
        action: { kind: 'snapshot', snapshotId: 'pending-snapshot', lastError: null },
      },
    });
    expect(await screen.findByText(strings.environmentActionPending)).toBeVisible();
    expect(screen.getByRole('button', { name: strings.environmentRestart })).toBeDisabled();
    expect(screen.getByRole('button', { name: strings.environmentSnapshot })).toBeDisabled();
  });

  it('shows a durable error, hides admin limits and stops polling the terminal action', async () => {
    let detailRequests = 0;
    mountEnvironment({
      ...environmentDetail,
      environment: {
        ...environmentDetail.environment,
        canSetLimits: false,
        action: { kind: 'snapshot', snapshotId: 'pending-snapshot', lastError: 'snapshot export failed' },
      },
    }, () => { detailRequests += 1; });
    expect(await screen.findByText(strings.environmentActionError)).toBeVisible();
    expect(screen.getByText('snapshot export failed')).toBeVisible();
    expect(screen.queryByRole('button', { name: strings.environmentSaveLimits })).not.toBeInTheDocument();
    const settledRequests = detailRequests;
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 2_100)); });
    expect(detailRequests).toBe(settledRequests);
  });

  it('saves admin-only limit overrides through the existing site patch', async () => {
    const patches: unknown[] = [];
    use(http.patch('/api/plugins/sites/api/site/:id', async ({ request }) => {
      patches.push(await request.json());
      return HttpResponse.json({ site: environmentSite });
    }));
    mountEnvironment();
    const memory = await screen.findByRole('spinbutton', { name: strings.environmentLimitMemory });
    fireEvent.change(memory, { target: { value: '3072' } });
    fireEvent.click(screen.getByRole('button', { name: strings.environmentSaveLimits }));
    await waitFor(() => expect(patches).toEqual([{
      environmentCpus: null,
      environmentMemoryMb: 3072,
      environmentPidsLimit: null,
      environmentDiskSoftMb: null,
    }]));
  });
});
