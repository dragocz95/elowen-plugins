import type { ComponentType } from 'react';
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import { http, HttpResponse, listen, use, setDefaults, resetHandlers, close } from './ui/http';
import { ensurePluginUiRuntime } from './ui/hostRuntime';
import { ToastProvider, createWrapper } from './ui/hostHooks';
import { SkillsSettings } from '../plugins/skills/web-src/SkillsSettings';
import manifest from '../plugins/skills/elowen-plugin.json' with { type: 'json' };

// The editor resolves everything through window.ElowenUiRuntime — install the runtime, so this
// exercises the production contract the bundle runs against.
ensurePluginUiRuntime();

// View copy is served per-plugin by /plugins/ui; serving the REAL manifest en fallback keeps the
// assertions in lockstep with what production users see.
const strings = (manifest as { web: { strings: Record<string, string> } }).web.strings;
const manifestApiVersion = (manifest as { web: { requiresApiVersion: number } }).web.requiresApiVersion;

type PluginSectionComponent = ComponentType<{ plugin: string; params: Record<string, string>; rest: string[]; surface: 'page' | 'deck' }>;
interface BundleRegistration {
  requiresApiVersion: number;
  settings?: Record<string, PluginSectionComponent>;
  ownsPageFrame?: string[];
}

/** Load the bundle entry the way the host does — it registers itself on import — and hand back what it
 *  registered. The entry is what carries `ownsPageFrame`, so nothing short of importing it proves the
 *  declaration is really there. */
const loadBundleRegistration = async (): Promise<BundleRegistration> => {
  let captured: BundleRegistration | undefined;
  (window as unknown as { __elowenRegisterPluginUi?: (plugin: string, registration: BundleRegistration) => void })
    .__elowenRegisterPluginUi = (_plugin, registration) => { captured = registration; };
  await import('../plugins/skills/web-src/index');
  if (!captured) throw new Error('the skills bundle registered no UI');
  return captured;
};

setDefaults(
  http.get('/api/plugins/ui', () => HttpResponse.json([{ name: 'skills', url: '/plugins/skills/web/index.js', apiVersion: 1, nav: [], settings: [], strings }])),
  // The register labels the owner column against the signed-in account, so the page reads /auth/me.
  http.get('/api/auth/me', () => HttpResponse.json({ user: { id: 7, username: 'filip', is_admin: true } })),
);
beforeAll(() => listen()); afterEach(() => { cleanup(); resetHandlers(); }); afterAll(() => close());

const skillRow = (name: string, disableModelInvocation: boolean, owner: number | null = null, canDelete = true) =>
  ({ name, description: `${name} desc`, source: 'user', owner, canDelete, disableModelInvocation, version: null, content: `Body ${name}.` });
const list = [skillRow('alpha', false), skillRow('beta', false)];
const toggles = () => screen.getAllByRole('switch', { name: strings.disableModelInvocation });

const mount = (surface: 'page' | 'deck' = 'deck') => {
  const { wrapper: Wrapper } = createWrapper();
  return render(<Wrapper><ToastProvider><SkillsSettings surface={surface} /></ToastProvider></Wrapper>);
};

describe('skills SkillsSettings (optimistic disclosure toggle)', () => {
  it('flips the clicked row immediately and disables only that row while the PATCH is in flight', async () => {
    let alphaDisabled = false;
    let resolvePatch!: () => void;
    const patchDone = new Promise<void>((r) => { resolvePatch = r; });
    use(
      http.get('/api/plugins/skills/list', () => HttpResponse.json([skillRow('alpha', alphaDisabled), skillRow('beta', false)])),
      http.patch('/api/plugins/skills/alpha', async () => { await patchDone; alphaDisabled = true; return HttpResponse.json({ ok: true }); }),
    );
    mount();

    await waitFor(() => expect(toggles()).toHaveLength(2));
    const [alpha, beta] = toggles();
    expect(alpha).toBeChecked();
    expect(beta).toBeChecked();

    fireEvent.click(alpha!);
    // Optimistic: alpha turns automatic use off before the PATCH resolves, and only alpha is greyed out.
    await waitFor(() => expect(alpha).not.toBeChecked());
    expect(alpha).toBeDisabled();
    expect(beta).not.toBeDisabled();
    expect(beta).toBeChecked();

    // Once the server confirms (and the refetch lands the updated list), alpha stays off and re-enables.
    resolvePatch();
    await waitFor(() => expect(alpha).toBeEnabled());
    expect(alpha).not.toBeChecked();
  });

  it('rolls the toggle back when the PATCH fails', async () => {
    let rejectPatch!: () => void;
    const patchFail = new Promise<void>((r) => { rejectPatch = r; });
    use(
      http.get('/api/plugins/skills/list', () => HttpResponse.json(list)),
      http.patch('/api/plugins/skills/alpha', async () => { await patchFail; return HttpResponse.json({ error: 'boom' }, { status: 500 }); }),
    );
    mount();

    await waitFor(() => expect(toggles()).toHaveLength(2));
    const [alpha] = toggles();
    expect(alpha).toBeChecked();
    fireEvent.click(alpha!);
    await waitFor(() => expect(alpha).not.toBeChecked()); // optimistic flip, held while the PATCH is pending
    rejectPatch();
    await waitFor(() => expect(alpha).toBeChecked()); // rolled back on error
  });

  it('creates a skill through the editor form (list → add → save)', async () => {
    let created: unknown;
    let createdOwner: string | null = null;
    use(
      http.get('/api/plugins/skills/list', () => HttpResponse.json([])),
      http.post('/api/plugins/skills', async ({ request, url }) => {
        created = await request.json();
        createdOwner = url.searchParams.get('owner');
        return HttpResponse.json({ ok: true }, { status: 201 });
      }),
    );
    mount();
    fireEvent.click((await screen.findAllByRole('button', { name: strings.add }))[0]!);
    // The form lives in the workspace detail drawer; the page behind it has a search box of its own.
    const form = within(await screen.findByRole('dialog'));
    expect(form.getByRole('switch', { name: strings.disableModelInvocation })).toBeChecked();
    fireEvent.change(form.getByPlaceholderText('deploy-checklist'), { target: { value: 'my-skill' } });
    const inputs = form.getAllByRole('textbox');
    fireEvent.change(inputs[1]!, { target: { value: 'When to use it.' } });
    fireEvent.change(inputs[2]!, { target: { value: 'Do the thing.' } });
    fireEvent.click(form.getByRole('button', { name: strings.save }));
    await waitFor(() => expect(created).toBeTruthy());
    // `owner` is a query param selecting the target set, never part of the written skill.
    expect(created).toEqual({ name: 'my-skill', description: 'When to use it.', content: 'Do the thing.', disableModelInvocation: false });
    // And "mine" travels as the explicit `me`, never as an absent param: the daemon reads an absent one
    // as the pre-ownership default (instance-wide for an admin), which is not what this form means.
    expect(createdOwner).toBe('me');
  });

  // Per-user skills make the NAME ambiguous: an account's own skill and an instance-wide one may both
  // be called "alpha". The register keys rows by name AND owner — keying on the name alone made one row
  // highlight (and offer to delete) the other.
  it('separates same-named skills by owner and filters by scope', async () => {
    use(http.get('/api/plugins/skills/list', () => HttpResponse.json([
      skillRow('alpha', false, null), // instance-wide
      skillRow('alpha', false, 7),    // mine
      skillRow('gamma', false, 9),    // someone else's (admin sees it)
    ])));
    const mounted = mount();

    await waitFor(() => expect(screen.getAllByText('alpha')).toHaveLength(2));
    expect(screen.getAllByText(strings.ownerInstance).length).toBeGreaterThan(0);
    expect(screen.getAllByText(strings.ownerMine).length).toBeGreaterThan(0);
    expect(screen.getByText('#9')).toBeInTheDocument();

    // Opening MY alpha must select exactly one row, not both.
    fireEvent.click(screen.getByRole('radio', { name: strings.scopeMine }));
    await waitFor(() => expect(screen.getAllByText('alpha')).toHaveLength(1));
    expect(screen.queryByText('gamma')).toBeNull();

    // Back to everything, then open MY alpha: exactly one row may light up, not both namesakes.
    // ONE "all" radio: an asset type with ownership scopes shows only that filter, because the coarse
    // source filter beside it would answer the same question twice (and offer "Built-in" in both).
    // The "all" option of the scope filter is the CORE label (the register owns that option, not the
    // plugin), which is why the plugin ships no string for it.
    fireEvent.click(screen.getByRole('radio', { name: 'All' }));
    await waitFor(() => expect(screen.getAllByText('alpha')).toHaveLength(2));
    fireEvent.click(screen.getAllByText('alpha')[1]!);
    await screen.findByRole('dialog');
    expect(mounted.container.querySelectorAll('[aria-selected="true"]')).toHaveLength(1);
  });

  // Moving a skill between sets is a filesystem move on the daemon, so the editor must call the transfer
  // route rather than folding the new owner into the PATCH that saves the edit.
  it('moves a skill to the other set before saving the edit', async () => {
    const calls: string[] = [];
    let moveBody: unknown;
    use(
      http.get('/api/plugins/skills/list', () => HttpResponse.json([skillRow('alpha', false, 7)])),
      http.post('/api/plugins/skills/alpha/owner', async ({ request, url }) => {
        calls.push(`move:${url.searchParams.get('owner')}`);
        moveBody = await request.json();
        return HttpResponse.json({ ok: true, owner: null });
      }),
      http.patch('/api/plugins/skills/alpha', ({ url }) => {
        calls.push(`patch:${url.searchParams.get('owner')}`);
        return HttpResponse.json({ ok: true });
      }),
    );
    mount();

    fireEvent.click(await screen.findByRole('button', { name: 'alpha' }));
    const form = within(await screen.findByRole('dialog'));
    fireEvent.click(form.getByRole('radio', { name: strings.scopeFieldInstance }));
    fireEvent.click(form.getByRole('button', { name: strings.save }));

    await waitFor(() => expect(calls).toHaveLength(2));
    // The move runs FIRST — a refused move must leave the skill as it was, not half-edited — and it says
    // where the skill is NOW; the edit then addresses it in the set it just landed in.
    expect(calls).toEqual(['move:7', 'patch:instance']);
    expect(moveBody).toEqual({ owner: 'instance' });
  });

  // Somebody else's personal skill stays editable by an admin but must not offer the scope switch: its
  // "Only me" option would read as a label and act as a transfer of her skill to him.
  it('offers the scope switch on an own skill but not on another account\'s', async () => {
    use(http.get('/api/plugins/skills/list', () => HttpResponse.json([skillRow('mine', false, 7), skillRow('hers', false, 9)])));
    mount();

    fireEvent.click(await screen.findByRole('button', { name: 'mine' }));
    expect(within(await screen.findByRole('dialog')).getByRole('radio', { name: strings.scopeFieldInstance })).toBeInTheDocument();
    cleanup();

    use(http.get('/api/plugins/skills/list', () => HttpResponse.json([skillRow('hers', false, 9)])));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'hers' }));
    const foreign = within(await screen.findByRole('dialog'));
    expect(foreign.queryByRole('radio', { name: strings.scopeFieldInstance })).toBeNull();
  });

  // The daemon decides who may write which skill; a row this caller cannot write must not offer controls
  // whose request would come back 403 — but it is still a CUSTOM skill, not a built-in one.
  it('shows a skill the caller may not write as read-only, without calling it built-in', async () => {
    use(http.get('/api/plugins/skills/list', () => HttpResponse.json([
      skillRow('shared-one', false, null, false), // instance-wide, seen by a non-admin
      skillRow('mine', false, 7, true),
    ])));
    const mounted = mount();

    await screen.findByText('shared-one');
    // One delete button and one editable name button: the read-only row offers neither.
    expect(screen.getAllByRole('button', { name: strings.remove })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'mine' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'shared-one' })).toBeNull();
    // Provenance is not editability: both rows are user-defined skills.
    expect(mounted.container.textContent).not.toContain(strings.badgeBundled);
  });

  // The same component serves the Settings deck and its own page. On a page it wears the SAME spatial
  // workspace the built-in pages wear — hero, metrics, control surface — while in the deck the panel
  // around it already names the section, so a hero there would be noise. Getting this wrong is what
  // made the plugin pages read as fragments pasted onto an empty screen.
  it('wears the spatial workspace on a page and stays bare inside the Settings deck', async () => {
    use(http.get('/api/plugins/skills/list', () => HttpResponse.json(list)));

    const page = mount('page');
    await waitFor(() => expect(page.container.querySelector('.workspace-hero h1')?.textContent).toBe(strings.title));
    expect(page.container.querySelector('.workspace-hero__eyebrow')?.textContent).toBeTruthy();
    expect(page.container.querySelector('.workspace-hero__metrics')?.textContent).toBeTruthy();
    // The register is the same control surface the built-in workspaces use.
    expect(page.container.querySelector('[data-control-surface]')).not.toBeNull();
    page.unmount();

    const deck = mount('deck');
    await waitFor(() => expect(deck.container.querySelector('[data-control-surface]')).not.toBeNull());
    expect(deck.container.querySelector('.workspace-hero')).toBeNull();
  });

  // The host wraps a settings section in its own page column and module header. This section brings a
  // whole workspace shell of its own, so that wrapper nested two page frames: the gutter and the bottom
  // padding were spent twice and the page came out narrower than every sibling register. The bundle
  // declares the section id it frames itself, and the page it renders holds exactly one frame.
  it('claims the page frame for the section that draws its own', async () => {
    use(http.get('/api/plugins/skills/list', () => HttpResponse.json(list)));
    const registration = await loadBundleRegistration();

    expect(registration.ownsPageFrame).toContain('skills');
    // The two places the ceiling is written must agree, or the host loads a bundle built against a
    // contract it does not serve — or refuses one it does.
    expect(registration.requiresApiVersion).toBe(manifestApiVersion);
    // Every id it claims must be a section it actually registers, or the host drops a frame nobody draws.
    const sections = registration.settings ?? {};
    for (const id of registration.ownsPageFrame ?? []) expect(Object.keys(sections)).toContain(id);

    const Section = sections.skills;
    if (!Section) throw new Error('the bundle registered no skills section');
    const { wrapper: Wrapper } = createWrapper();
    const page = render(
      <Wrapper><ToastProvider><Section plugin="skills" params={{ id: 'skills' }} rest={[]} surface="page" /></ToastProvider></Wrapper>,
    );
    await waitFor(() => expect(page.container.querySelector('[data-control-surface]')).not.toBeNull());
    expect(page.container.querySelectorAll('.workspace-page, .workspace-shell')).toHaveLength(1);
  });
});
