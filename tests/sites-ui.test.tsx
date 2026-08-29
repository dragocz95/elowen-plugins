import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import { http, HttpResponse, listen, use, setDefaults, resetHandlers, close } from './ui/http';
import { ensurePluginUiRuntime } from './ui/hostRuntime';
import { SitesPage } from '../plugins/sites/web-src/SitesPage';
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
  basePath: '/hooks/sites/s/dashboard-abc123/',
  projectId: 3,
  projectSlug: 'kolin',
  ownerUserId: OWNER.id,
  owner: OWNER,
  createdAt: '2026-08-01T10:00:00.000Z',
  createdModel: 'anthropic/claude',
  lastPublishAt: '2026-08-20T10:00:00.000Z',
  lastPublishModel: 'anthropic/claude',
  spa: false,
  canManage: true,
};

const detail = {
  site,
  members: [GUEST],
  releases: [{ id: 'rel-2', siteId: site.id, createdAt: '2026-08-20T10:00:00.000Z', model: 'anthropic/claude', fileCount: 12, sizeBytes: 220_000, note: 'August numbers' }],
  hits: [{ day: '2026-08-20', count: 41 }],
  sourceDir: '/var/www/kolin/reports',
  runtime: { running: true, startCommand: 'node server.js', logTail: 'listening on :43000', lastError: null },
};

setDefaults(
  http.get('/api/plugins/ui', () => HttpResponse.json([
    { name: 'sites', url: '/plugins/sites/web/index.js', apiVersion: 7, nav: [], settings: [], strings },
  ])),
  http.get('/api/plugins/sites/api/sites', () => HttpResponse.json({
    mine: [site], shared: [], allowPublicSites: true, dedicatedHost: true,
  })),
  http.get('/api/plugins/sites/api/site/:id', () => HttpResponse.json(detail)),
  http.get('/api/plugins/sites/api/directory', () => HttpResponse.json({ accounts: [OWNER, GUEST, OUTSIDER] })),
);

beforeAll(() => listen());
afterEach(() => { cleanup(); resetHandlers(); });
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
  it('uses the host register search as the leftmost toolbar control', async () => {
    mount();
    const search = await screen.findByRole('searchbox', { name: strings.searchPlaceholder });
    const registerSearch = search.closest('.register-search');
    expect(registerSearch).not.toBeNull();
    expect(registerSearch?.parentElement?.firstElementChild).toBe(registerSearch);
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

  it('adds a guest through the people picker, writing only the difference', async () => {
    const added: unknown[] = [];
    const removed: string[] = [];
    use(
      http.post('/api/plugins/sites/api/site/:id/members', async ({ request }) => {
        added.push(await request.json());
        return HttpResponse.json({ ok: true });
      }),
      http.delete('/api/plugins/sites/api/site/:id/members/:userId', ({ params }) => {
        removed.push(params.userId!);
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

    // The already-named guest is left alone: only the one account that changed is written.
    await waitFor(() => expect(added).toEqual([{ userId: OUTSIDER.id }]));
    expect(removed).toEqual([]);
  });
});
