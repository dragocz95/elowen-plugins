import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import { http, HttpResponse, listen, use, setDefaults, resetHandlers, close } from './ui/http';
import { ensurePluginUiRuntime } from './ui/hostRuntime';
import { SitesPage } from '../plugins/sites/web-src/SitesPage';
import { PREVIEW_POLL_MS, awaitingPreview, previewImageUrl } from '../plugins/sites/web-src/runtime';
import { monogram } from '../plugins/sites/web-src/meta';
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
  kind: 'static',
  target: '',
  // A picture of the page, already taken: the card's plate shows it rather than a monogram.
  preview: { state: 'ready', version: 3, capturedAt: '2026-08-20T10:00:00.000Z', width: 1280, height: 800 },
  degraded: false,
  canManage: true,
};

const detail = {
  site,
  members: [GUEST],
  releases: [{ id: 'rel-2', siteId: site.id, createdAt: '2026-08-20T10:00:00.000Z', model: 'anthropic/claude', fileCount: 12, sizeBytes: 220_000, note: 'August numbers', kind: 'files' }],
  hits: [{ day: '2026-08-20', count: 41 }],
  sourceDir: '/var/www/kolin/reports',
  lastError: null,
  previewNotice: null,
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

/** The register card opens the drawer through its own control; its accessible name carries the site's
 *  title, which is what makes one card's open control distinguishable from the next one's. */
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

  it('filters by the derived degraded publication state', async () => {
    const degradedSite = { ...site, id: 'site-degraded', title: 'Degraded proxy', degraded: true };
    use(http.get('/api/plugins/sites/api/sites', () => HttpResponse.json({
      mine: [site, degradedSite], shared: [], allowPublicSites: true,
    })));
    mount();

    const search = await screen.findByRole('searchbox', { name: strings.searchPlaceholder });
    const toolbar = search.closest('.page-toolbar');
    fireEvent.click(within(toolbar!).getByTestId('page-filters-trigger'));
    const filters = screen.getByRole('dialog', { name: 'Filters' });
    fireEvent.change(within(filters).getByRole('combobox', { name: strings.filterStatus }), { target: { value: 'degraded' } });

    expect(await screen.findByText(degradedSite.title)).toBeVisible();
    expect(screen.queryByText(site.title)).not.toBeInTheDocument();
    expect(screen.getByTestId('page-filter-chips')).toHaveTextContent(`${strings.filterStatus}: ${strings.statusDegraded}`);
  });

  /** The register is a GRID OF CARDS, not a table. Three things have to hold for that to be true rather
   *  than a restyle: the container is a list whose column count comes from its own width, the card is not
   *  a control wrapping controls, and the Publication column is gone — its fact now stated once, as a
   *  badge, instead of in a column of its own. */
  it('lists sites as responsive cards instead of a table with a Publication column', async () => {
    mount();
    const register = await screen.findByTestId('sites-register');
    expect(register).toHaveAttribute('role', 'list');
    // One card per site, each its own list item, and the column count is the CONTAINER's: this register
    // also renders inside a Project panel, where three across would not fit.
    expect(within(register).getAllByRole('listitem')).toHaveLength(1);
    expect(register.className).toContain('grid-cols-1');
    expect(register.className).toContain('@min-[38rem]:grid-cols-2');
    expect(register.className).toContain('@min-[58rem]:grid-cols-3');
    // The query container has to be the WRAPPER. A container query resolves against an ancestor
    // container and never against the element that declares itself one, so `@container` on the grid
    // leaves the column variants resolving against whatever shell happens to be above it — one column
    // wherever no shell declares itself a container, which a browser confirmed is what happens.
    expect(register.parentElement?.className).toContain('@container');
    expect(register.className).not.toContain('@container');
    // The standalone Publication column is withdrawn; the publication shape is a badge on the card.
    expect(screen.queryByRole('columnheader')).not.toBeInTheDocument();
    expect(screen.getByText(strings.kindStatic)).toBeVisible();
  });

  /** The plate is the card's signature band. It must carry the address — the fact a reader recognises a
   *  published page by — and it must never be a control of its own inside a card that is already
   *  clickable. */
  it('puts the published address on the card plate', async () => {
    mount();
    const card = await screen.findByTestId('sites-register');
    const plate = card.querySelector('[data-site-plate]');
    expect(plate).not.toBeNull();
    expect(within(plate as HTMLElement).getByText('dashboard-abc123.sites.example.com')).toBeVisible();
    expect(within(plate as HTMLElement).queryByRole('button')).not.toBeInTheDocument();
    expect(within(plate as HTMLElement).queryByRole('link')).not.toBeInTheDocument();
  });

  /** Copying an address is not asking for the drawer. Both card actions sit inside a surface whose click
   *  opens the detail, so each one has to stop the event — otherwise every copy opens a rail nobody
   *  asked for. */
  it('keeps the card actions separate from opening the detail', async () => {
    mount();
    await screen.findByText(site.title);
    fireEvent.click(screen.getByRole('button', { name: strings.copyLink }));
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole('dialog', { name: strings.detailTitle })).not.toBeInTheDocument();
  });

  /** A published address whose application stopped answering says so on the card. The stored failure is
   *  a manager's detail and is deliberately not in the list response, so the card states the derived
   *  condition and points at the drawer rather than inventing a reason. */
  it('states the derived degraded condition on the card', async () => {
    use(http.get('/api/plugins/sites/api/sites', () => HttpResponse.json({
      mine: [{ ...site, degraded: true }], shared: [], allowPublicSites: true,
    })));
    mount();
    expect(await screen.findByText(strings.stateHintDegraded)).toBeVisible();
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
    // No tab strip: address, access, guests, releases and deletion are all present together,
    // which is what keeps the drawer one size on every surface.
    expect(drawer.getByText(strings.address)).toBeInTheDocument();
    expect(drawer.getAllByText(strings.whoCanOpen).length).toBeGreaterThan(0);
    expect(drawer.getByText(strings.guests)).toBeInTheDocument();
    expect(drawer.getAllByText(strings.releases).length).toBeGreaterThan(0);
    expect(drawer.getByText(strings.deleteTitle)).toBeInTheDocument();
    // A named guest is a face and a name here too.
    expect(drawer.getByText(GUEST.name)).toBeInTheDocument();
    expect(drawer.getAllByLabelText(GUEST.name).length).toBeGreaterThan(0);
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

  it('closes a deleted site without refetching its removed detail id', async () => {
    let detailRequests = 0;
    use(
      http.get('/api/plugins/sites/api/site/:id', () => {
        detailRequests += 1;
        return detailRequests === 1 ? HttpResponse.json(detail) : HttpResponse.json({ error: 'not found' }, { status: 404 });
      }),
      http.delete('/api/plugins/sites/api/site/:id', () => HttpResponse.json({ ok: true })),
    );
    mount();
    const drawer = within(await openSite());
    fireEvent.click(drawer.getByRole('button', { name: strings.delete }));
    const confirm = await screen.findByRole('dialog', { name: strings.deleteTitle });
    fireEvent.click(within(confirm).getByRole('button', { name: strings.delete }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: strings.detailTitle })).not.toBeInTheDocument());
    await act(async () => { await Promise.resolve(); });
    expect(detailRequests).toBe(1);
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

  /** The plate is where the picture of the page belongs. It is the site's own, stored by the instance
   *  through the site's published address, and the card must show it under the version it was stored as —
   *  which is what lets a long cache be correct. */
  it('puts the stored picture of the page on the card, under the version it was taken as', async () => {
    mount();
    const card = await screen.findByTestId('sites-register');
    const picture = card.querySelector('[data-site-picture]');
    expect(picture).not.toBeNull();
    expect(picture).toHaveAttribute('src', previewImageUrl(site.id, 3));
    expect(picture).toHaveAttribute('src', '/api/plugins/sites/api/site/site-1/preview?v=3');
    // Decoration with an origin: the title is the card's heading, so the picture announces nothing.
    expect(picture).toHaveAttribute('alt', '');
    expect(card.querySelector('[data-site-plate]')?.getAttribute('data-site-preview')).toBe('ready');
  });

  it('falls back to the monogram when there is no picture to show', async () => {
    use(http.get('/api/plugins/sites/api/sites', () => HttpResponse.json({
      mine: [{ ...site, preview: { state: 'none', version: 0, capturedAt: null, width: null, height: null } }],
      shared: [], allowPublicSites: true,
    })));
    mount();
    const card = await screen.findByTestId('sites-register');
    expect(card.querySelector('[data-site-picture]')).toBeNull();
    expect(card.querySelector('[data-site-plate]')?.getAttribute('data-site-preview')).toBe('none');
    // The card is still a card: the address and the title are what it is made of either way.
    expect(within(card).getByText(site.title)).toBeVisible();
    expect(within(card).getByText('dashboard-abc123.sites.example.com')).toBeVisible();
  });

  /** jsdom never fetches an image, so the browser's own failure is dispatched rather than awaited. What is
   *  under test is the plate's reaction to it, and that reaction has to be asserted on BOTH sides: "no
   *  `<img>` in the DOM" is equally true of a plate that rendered nothing at all, so the monogram taking
   *  the picture's place is the part that makes this a fallback rather than a blank band. */
  it('drops back to the monogram when the stored picture will not load', async () => {
    mount();
    const card = await screen.findByTestId('sites-register');
    const plate = card.querySelector('[data-site-plate]') as HTMLElement;
    expect(plate.textContent).not.toContain(monogram(site.title));
    fireEvent.error(card.querySelector('[data-site-picture]') as HTMLImageElement);
    await waitFor(() => expect(card.querySelector('[data-site-picture]')).toBeNull());
    expect(plate.textContent).toContain(monogram(site.title));
    expect(within(card).getByText(site.title)).toBeVisible();
  });

  /** A picture that is merely out of date keeps its place. Falling back to a monogram on every failed
   *  refresh would make a register flicker over a page the picture still describes perfectly well. */
  it('keeps a stale or failed picture on the card and states the caveat', async () => {
    for (const [state, label] of [['stale', strings.previewStale], ['failed', strings.previewFailed]] as const) {
      use(http.get('/api/plugins/sites/api/sites', () => HttpResponse.json({
        mine: [{
          ...site,
          preview: { state, version: 4, capturedAt: '2026-08-20T10:00:00.000Z', width: 1280, height: 800 },
        }],
        shared: [], allowPublicSites: true,
      })));
      mount();
      const card = await screen.findByTestId('sites-register');
      expect(card.querySelector('[data-site-picture]')).not.toBeNull();
      expect(within(card).getByText(label)).toBeVisible();
      expect(card.querySelector(`[data-site-picture-state="${state}"]`)).not.toBeNull();
      cleanup();
      resetHandlers();
    }
  });

  it('says a first picture is being taken rather than showing nothing', async () => {
    use(http.get('/api/plugins/sites/api/sites', () => HttpResponse.json({
      mine: [{ ...site, preview: { state: 'pending', version: 0, capturedAt: null, width: null, height: null } }],
      shared: [], allowPublicSites: true,
    })));
    mount();
    const card = await screen.findByTestId('sites-register');
    expect(card.querySelector('[data-site-preview="pending"]')).not.toBeNull();
    expect(card.querySelector('[data-site-picture]')).toBeNull();
  });

  /** The register asks for nothing on its own except the pictures it is waiting for. A register nobody is
   *  publishing into has to be silent, so the polling is a function of the data rather than a heartbeat. */
  it('looks again on its own only while a picture is being taken', async () => {
    expect(awaitingPreview([site])).toBe(false);
    expect(awaitingPreview([{ ...site, preview: { state: 'ready', version: 1, capturedAt: null, width: null, height: null } }])).toBe(false);
    expect(awaitingPreview([{ ...site, preview: { state: 'pending', version: 0, capturedAt: null, width: null, height: null } }])).toBe(true);

    let lists = 0;
    use(http.get('/api/plugins/sites/api/sites', () => {
      lists += 1;
      return HttpResponse.json({
        mine: [{ ...site, preview: { state: 'pending', version: 0, capturedAt: null, width: null, height: null } }],
        shared: [], allowPublicSites: true,
      });
    }));
    mount();
    await screen.findByTestId('sites-register');
    const first = lists;
    await waitFor(() => expect(lists).toBeGreaterThan(first), { timeout: PREVIEW_POLL_MS + 3000 });
  }, 12_000);

  it('shows the picture, when it was taken and the control that takes a new one', async () => {
    const refreshed: string[] = [];
    use(http.post('/api/plugins/sites/api/site/:id/preview/refresh', ({ request }) => {
      refreshed.push(new URL(request.url).pathname);
      return HttpResponse.json({ queued: true }, { status: 202 });
    }));
    mount();
    const drawer = within(await openSite());

    expect(drawer.getByText(strings.previewTitle)).toBeVisible();
    expect(drawer.getByText(new RegExp(strings.previewCapturedAt.split('{time}')[0].trim()))).toBeVisible();
    // The drawer shows the same stored picture the card does, and it is decoration there too.
    const picture = document.querySelector(`[data-site-picture="${site.id}"]`);
    expect(picture).not.toBeNull();
    expect(picture).toHaveAttribute('alt', '');

    fireEvent.click(drawer.getByRole('button', { name: strings.previewRefresh }));
    await waitFor(() => expect(refreshed).toEqual(['/api/plugins/sites/api/site/site-1/preview/refresh']));
  });

  it('reports a refused refresh as itself rather than swallowing it', async () => {
    use(http.post('/api/plugins/sites/api/site/:id/preview/refresh', () => HttpResponse.json(
      { error: 'a picture of this site was taken a moment ago' }, { status: 429 },
    )));
    mount();
    const drawer = within(await openSite());
    fireEvent.click(drawer.getByRole('button', { name: strings.previewRefresh }));

    // Shown as itself, in the drawer's own error state and as a toast: a refusal the daemon explained is
    // never swallowed into a silent no-op.
    const refusals = await screen.findAllByText(/a picture of this site was taken a moment ago/);
    expect(refusals[0]).toBeVisible();
    expect(screen.getByRole('button', { name: /retry/i })).toBeVisible();
  });

  it('explains why there is no picture, to the manager who could fix it', async () => {
    use(http.get('/api/plugins/sites/api/site/:id', () => HttpResponse.json({
      ...detail,
      site: { ...site, preview: { state: 'none', version: 0, capturedAt: null, width: null, height: null } },
      previewNotice: 'this instance has no browser to render pages with',
    })));
    mount();
    const drawer = within(await openSite());
    expect(drawer.getByText(strings.previewNone)).toBeVisible();
    expect(drawer.getByText(/this instance has no browser to render pages with/)).toBeVisible();
  });

  it('offers no refresh control to somebody who does not manage the site', async () => {
    use(http.get('/api/plugins/sites/api/site/:id', () => HttpResponse.json({
      ...detail, site: { ...site, canManage: false },
    })));
    mount();
    const drawer = within(await openSite());
    expect(drawer.getByText(strings.previewTitle)).toBeVisible();
    expect(drawer.queryByRole('button', { name: strings.previewRefresh })).not.toBeInTheDocument();
  });
});
