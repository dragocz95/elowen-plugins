import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse, listen, use, setDefaults, resetHandlers, close } from './ui/http';
import { ensurePluginUiRuntime } from './ui/hostRuntime';
import { ToastProvider, createWrapper } from './ui/hostHooks';
import manifest from '../plugins/browser/elowen-plugin.json' with { type: 'json' };
import { BrowserArtifact } from '../plugins/browser/web-src/BrowserArtifact';
import { BrowserAccount } from '../plugins/browser/web-src/BrowserAccount';
import { BrowserSettings } from '../plugins/browser/web-src/BrowserSettings';
import { registerBrowserUi } from '../plugins/browser/web-src/runtime';

ensurePluginUiRuntime();
const strings = manifest.web.strings;
setDefaults(
  http.get('/api/plugins/ui', () => HttpResponse.json([{ name: 'browser', url: '/plugins/browser/web/index.js', cssUrl: '/plugins/browser/web/index.css', apiVersion: 14, nav: [], account: manifest.web.account, settings: manifest.web.settings, strings }])),
  http.get('/api/auth/me', () => HttpResponse.json({ user: { id: 1, username: 'user', is_admin: true } })),
);
beforeAll(() => listen());
afterEach(() => { cleanup(); resetHandlers(); vi.restoreAllMocks(); });
afterAll(() => close());

const artifact = {
  id: 'browser:session-1', plugin: 'browser', sessionId: 'brain-1', toolCallId: 'tool-1', view: 'browser-session',
  fallback: 'Browser session', expiresAt: new Date(Date.now() + 60_000).toISOString(), status: 'open' as const,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  data: { browserSessionId: 'session-1', state: 'agent', title: 'Example', url: 'https://example.com', lastAction: null },
  media: { transport: 'sse' as const, path: '/plugins/browser/api/stream?sessionId=session-1' },
};

function wrapper() {
  const { wrapper: Wrapper } = createWrapper();
  return Wrapper;
}
function mountArtifact(narration?: string) {
  const Wrapper = wrapper();
  const show = (text?: string) => (
    <Wrapper><ToastProvider><BrowserArtifact plugin="browser" artifact={artifact} narration={text} /></ToastProvider></Wrapper>
  );
  const view = render(show(narration));
  return Object.assign(view, { narrate: (text?: string) => view.rerender(show(text)) });
}

const streamBody = [
  `event: session\ndata: ${JSON.stringify({ id: 'session-1', state: 'agent', lease: null })}\n\n`,
  `event: frame\ndata: ${JSON.stringify({ data: 'ZmFrZS1qcGVn', mimeType: 'image/jpeg', width: 1280, height: 800, timestamp: 1 })}\n\n`,
  `event: cursor\ndata: ${JSON.stringify({ x: 640, y: 400, moving: false })}\n\n`,
  `event: action\ndata: ${JSON.stringify({ action: 'click', target: 'Continue', x: 640, y: 400 })}\n\n`,
].join('');
const requestedStreamBody = [
  `event: session\ndata: ${JSON.stringify({ id: 'session-1', state: 'agent', lease: null })}\n\n`,
  `event: control\ndata: ${JSON.stringify({ state: 'agent', reason: 'requested' })}\n\n`,
].join('');
/** The shape production actually delivered: a click reports where it landed, but the six `cursor` frames
 *  of the approach never reached this viewer — it connected mid-move, or they were dropped. */
const actionOnlyStreamBody = [
  `event: session\ndata: ${JSON.stringify({ id: 'session-1', state: 'agent', lease: null, cursor: null })}\n\n`,
  `event: frame\ndata: ${JSON.stringify({ data: 'ZmFrZS1qcGVn', mimeType: 'image/jpeg', width: 1280, height: 800, timestamp: 1 })}\n\n`,
  `event: action\ndata: ${JSON.stringify({ action: 'click', target: 'Continue', x: 320, y: 200 })}\n\n`,
].join('');
/** A viewer that opens the artifact between two agent moves: no live cursor event is coming, so the
 *  opening frame replays where the agent left the pointer. */
const lateViewerStreamBody = [
  `event: session\ndata: ${JSON.stringify({ id: 'session-1', state: 'agent', lease: null, cursor: { x: 960, y: 600 } })}\n\n`,
  `event: frame\ndata: ${JSON.stringify({ data: 'ZmFrZS1qcGVn', mimeType: 'image/jpeg', width: 1280, height: 800, timestamp: 1 })}\n\n`,
].join('');

describe('browser plugin UI', () => {
  it('registers the chat artifact, settings and account surfaces on API 14', () => {
    let registration: any;
    const original = window.__elowenRegisterPluginUi;
    window.__elowenRegisterPluginUi = (name, value) => { registration = { name, value }; };
    registerBrowserUi(BrowserArtifact, BrowserSettings, BrowserAccount);
    window.__elowenRegisterPluginUi = original;
    expect(registration.name).toBe('browser');
    expect(registration.value.requiresApiVersion).toBe(14);
    expect(registration.value.chatArtifacts['browser-session']).toBe(BrowserArtifact);
    expect(registration.value.settings.runtime).toBe(BrowserSettings);
    expect(registration.value.account.profile).toBe(BrowserAccount);
  });

  it('renders the live session as one compact tile with no card chrome around it', async () => {
    use(http.get('/api/plugins/browser/api/stream', () => new HttpResponse(streamBody, { headers: { 'content-type': 'text/event-stream' } })));
    mountArtifact();
    await waitFor(() => expect(document.querySelector('img[src="data:image/jpeg;base64,ZmFrZS1qcGVn"]')).not.toBeNull());
    // The image IS the card: one control (the thumbnail itself) opens the canvas, and the only text
    // beside it is the site and the current action.
    expect(screen.getAllByRole('button', { name: strings.enlarge })).toHaveLength(1);
    expect(screen.getByText('example.com')).toBeInTheDocument();
    expect(screen.queryByText('https://example.com')).toBeNull();
    expect(screen.queryByRole('heading')).toBeNull();
    // No running commentary on the thumbnail: the state is a dot, and its label is for assistive tech.
    expect(screen.queryByText('Clicking · Continue')).toBeNull();
    expect(document.querySelector('.browser-artifact__activity.has-action')).toBeNull();
    expect(document.querySelector('.browser-artifact__dot')).toHaveAttribute('data-tone');
    expect(document.querySelector('.browser-artifact__activity .sr-only')?.textContent).toBeTruthy();
    // The agent's pointer is feedback for the surface you are working on, not for a 300px thumbnail.
    expect(document.querySelector('.browser-artifact__cursor')).toBeNull();
  });

  it('expands into a borderless canvas that closes on Escape', async () => {
    use(http.get('/api/plugins/browser/api/stream', () => new HttpResponse(streamBody, { headers: { 'content-type': 'text/event-stream' } })));
    mountArtifact();
    fireEvent.click(await screen.findByRole('button', { name: strings.enlarge }));
    const canvas = await screen.findByRole('dialog', { name: 'Example' });
    expect(canvas).toHaveAttribute('aria-modal', 'true');
    // No dialog header, body or footer: the raised surface carries the image and floating controls only.
    expect(within(canvas).queryByRole('heading')).toBeNull();
    expect(within(canvas).getByRole('button', { name: strings.closeView })).toBeInTheDocument();
    expect(within(canvas).getByRole('button', { name: strings.closeSession })).toBeInTheDocument();
    // The surface you work on is the one that gets the action copy and the agent's pointer.
    expect(await within(canvas).findByText('Clicking · Continue')).toBeInTheDocument();
    await waitFor(() => expect(document.querySelectorAll('.browser-artifact__cursor').length).toBeGreaterThan(0));
    fireEvent.keyDown(canvas, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('draws the close control as one glass button, not a bordered square inside a disc', async () => {
    use(http.get('/api/plugins/browser/api/stream', () => new HttpResponse(streamBody, { headers: { 'content-type': 'text/event-stream' } })));
    mountArtifact();
    fireEvent.click(await screen.findByRole('button', { name: strings.enlarge }));
    const close = await screen.findByRole('button', { name: strings.closeView });
    // ONE element is the control AND its glass: no wrapper holding a second framed button inside it.
    expect(close).toHaveClass('browser-artifact__icon', 'browser-artifact__dismiss');
    expect(close.querySelector('button')).toBeNull();
    expect(close.closest('.browser-artifact__dismiss')).toBe(close);
    // Every control on the canvas is that same round ghost button — nothing draws its own square edge.
    for (const label of [strings.closeSession, strings.closeView]) {
      expect(screen.getByRole('button', { name: label })).toHaveClass('browser-artifact__icon');
    }
  });

  it('keeps an agent-requested handoff claimable by the user', async () => {
    use(http.get('/api/plugins/browser/api/stream', () => new HttpResponse(requestedStreamBody, { headers: { 'content-type': 'text/event-stream' } })));
    mountArtifact();
    // A requested handoff is a state, so it reaches the thumbnail as the dot's tone and its sr-only label.
    expect(await screen.findByText(strings.waitingForUser)).toHaveClass('sr-only');
    await waitFor(() => expect(document.querySelector('.browser-artifact__dot')).toHaveAttribute('data-tone', 'warning'));
    expect(document.querySelector('.browser-artifact__waiting .spinner')).not.toBeNull();
    expect(screen.getAllByRole('button', { name: strings.takeControl }).at(-1)).toBeEnabled();
    expect(screen.queryByText(strings.controlledElsewhere)).toBeNull();
  });

  it('keeps takeover tokens local, sends user input and releases control', async () => {
    const calls: { path: string; body: any }[] = [];
    use(
      http.get('/api/plugins/browser/api/stream', () => new HttpResponse(streamBody, { headers: { 'content-type': 'text/event-stream' } })),
      http.post('/api/plugins/browser/api/takeover', () => HttpResponse.json({ leaseId: 'lease-new', expiresAt: Date.now() + 120_000 })),
      http.post('/api/plugins/browser/api/input', async ({ request }) => { calls.push({ path: 'input', body: await request.json() }); return HttpResponse.json({ accepted: 1 }); }),
      http.post('/api/plugins/browser/api/release', async ({ request }) => { calls.push({ path: 'release', body: await request.json() }); return HttpResponse.json({ released: true }); }),
      http.post('/api/plugins/browser/api/heartbeat', () => HttpResponse.json({ expiresAt: Date.now() + 120_000 })),
    );
    mountArtifact();
    fireEvent.click(await screen.findByRole('button', { name: strings.enlarge }));
    // Page navigation belongs to whoever is driving: nothing to show while the agent holds the session.
    expect(screen.queryByRole('button', { name: strings.reload })).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: strings.takeControl }).at(-1)!);
    expect((await screen.findAllByText(strings.youControl)).length).toBeGreaterThan(0);
    for (const label of [strings.back, strings.forward, strings.reload]) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    const viewport = screen.getAllByLabelText(strings.browserViewport).at(-1)!;
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 640, bottom: 400, width: 640, height: 400, toJSON: () => ({}) });
    fireEvent.pointerDown(viewport, { clientX: 320, clientY: 200, button: 0, pointerId: 1 });
    await waitFor(() => expect(calls.some((call) => call.path === 'input' && call.body.leaseId === 'lease-new')).toBe(true));
    fireEvent.click(screen.getAllByRole('button', { name: strings.returnToAgent }).at(-1)!);
    await waitFor(() => expect(calls.some((call) => call.path === 'release' && call.body.leaseId === 'lease-new')).toBe(true));
  });

  it('leaves the user one pointer while they drive the session', async () => {
    use(
      http.get('/api/plugins/browser/api/stream', () => new HttpResponse(streamBody, { headers: { 'content-type': 'text/event-stream' } })),
      http.post('/api/plugins/browser/api/takeover', () => HttpResponse.json({ leaseId: 'lease-1', expiresAt: Date.now() + 120_000 })),
      http.post('/api/plugins/browser/api/heartbeat', () => HttpResponse.json({ expiresAt: Date.now() + 120_000 })),
    );
    mountArtifact();
    fireEvent.click(await screen.findByRole('button', { name: strings.enlarge }));
    // The agent is driving: its arrow is the pointer on the canvas.
    await waitFor(() => expect(document.querySelector('.browser-artifact__cursor')).not.toBeNull());

    fireEvent.click(screen.getAllByRole('button', { name: strings.takeControl }).at(-1)!);
    expect((await screen.findAllByText(strings.youControl)).length).toBeGreaterThan(0);
    // Now YOU are: the streamed cursor reports where the agent points and stops moving, so it is
    // withdrawn rather than left beside your own system pointer.
    await waitFor(() => expect(document.querySelector('.browser-artifact__cursor')).toBeNull());
    expect(screen.getAllByLabelText(strings.browserViewport).at(-1)).toHaveAttribute('data-interactive', 'true');
  });

  it('shows what the agent is saying inside the expanded canvas only, and clears with it', async () => {
    use(http.get('/api/plugins/browser/api/stream', () => new HttpResponse(streamBody, { headers: { 'content-type': 'text/event-stream' } })));
    const view = mountArtifact('Opening the booking portal.');
    await screen.findByRole('button', { name: strings.enlarge });
    // The transcript is right there under the thumbnail; repeating it in the tile would say it twice.
    expect(screen.queryByText('Opening the booking portal.')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: strings.enlarge }));
    const canvas = await screen.findByRole('dialog', { name: 'Example' });
    const bubble = within(canvas).getByText('Opening the booking portal.').closest('.browser-artifact__narration');
    expect(bubble).not.toBeNull();
    // A mark, not a caption: the icon says whose words these are without spending a line on saying it.
    const icon = bubble!.querySelector('.browser-artifact__narration-icon');
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(bubble).toHaveAttribute('aria-live', 'polite');
    expect(bubble).toHaveAttribute('role', 'status');
    expect(within(canvas).getByRole('button', { name: strings.closeSession })).toBeInTheDocument();

    // Streaming replaces the line in place…
    view.narrate('Opening the booking portal. The first free slot is Thursday.');
    expect(within(canvas).getByText('Opening the booking portal. The first free slot is Thursday.')).toBeInTheDocument();

    // …and an empty narration (a new user turn, or a host older than API 14) leaves no empty bubble.
    view.narrate('   ');
    expect(canvas.querySelector('.browser-artifact__narration')).toBeNull();
    view.narrate(undefined);
    expect(canvas.querySelector('.browser-artifact__narration')).toBeNull();
    // The browser's own action status is a separate, shorter thing and stays.
    expect(await within(canvas).findByText('Clicking · Continue')).toBeInTheDocument();
  });

  it('places the agent pointer from the action itself when the cursor frames never arrive', async () => {
    use(http.get('/api/plugins/browser/api/stream', () => new HttpResponse(actionOnlyStreamBody, { headers: { 'content-type': 'text/event-stream' } })));
    mountArtifact();
    fireEvent.click(await screen.findByRole('button', { name: strings.enlarge }));
    const cursor = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('.browser-artifact__cursor');
      expect(found).not.toBeNull();
      return found!;
    });
    // The action's own coordinates are the authoritative landing point, read as a fraction of the frame.
    expect(cursor.style.left).toBe('25%');
    expect(cursor.style.top).toBe('25%');
  });

  it('starts a late viewer from the pointer the agent left behind', async () => {
    use(http.get('/api/plugins/browser/api/stream', () => new HttpResponse(lateViewerStreamBody, { headers: { 'content-type': 'text/event-stream' } })));
    mountArtifact();
    fireEvent.click(await screen.findByRole('button', { name: strings.enlarge }));
    const cursor = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('.browser-artifact__cursor');
      expect(found).not.toBeNull();
      return found!;
    });
    expect(cursor.style.left).toBe('75%');
    expect(cursor.style.top).toBe('75%');
  });

  it('withdraws the agent pointer while anyone holds the session, not just this window', async () => {
    // `control: user` with no lease of our own is the OTHER window driving. The streamed cursor still
    // reports where the agent last pointed, and drawing it beside that person's pointer is the same
    // two-pointer bug as a local takeover.
    const foreignTakeover = [
      `event: session\ndata: ${JSON.stringify({ id: 'session-1', state: 'agent', lease: null, cursor: { x: 640, y: 400 } })}\n\n`,
      `event: frame\ndata: ${JSON.stringify({ data: 'ZmFrZS1qcGVn', mimeType: 'image/jpeg', width: 1280, height: 800, timestamp: 1 })}\n\n`,
      `event: control\ndata: ${JSON.stringify({ state: 'user' })}\n\n`,
    ].join('');
    use(http.get('/api/plugins/browser/api/stream', () => new HttpResponse(foreignTakeover, { headers: { 'content-type': 'text/event-stream' } })));
    mountArtifact();
    fireEvent.click(await screen.findByRole('button', { name: strings.enlarge }));
    await waitFor(() => expect(screen.getAllByRole('button', { name: strings.controlledElsewhere }).length).toBeGreaterThan(0));
    expect(document.querySelector('.browser-artifact__cursor')).toBeNull();
  });

  it('drops the agent pointer when the page it was on goes away', async () => {
    const navigated = [
      `event: session\ndata: ${JSON.stringify({ id: 'session-1', state: 'agent', lease: null, cursor: { x: 640, y: 400 } })}\n\n`,
      `event: frame\ndata: ${JSON.stringify({ data: 'ZmFrZS1qcGVn', mimeType: 'image/jpeg', width: 1280, height: 800, timestamp: 1 })}\n\n`,
      `event: cursor\ndata: ${JSON.stringify({ cleared: true })}\n\n`,
    ].join('');
    use(http.get('/api/plugins/browser/api/stream', () => new HttpResponse(navigated, { headers: { 'content-type': 'text/event-stream' } })));
    mountArtifact();
    fireEvent.click(await screen.findByRole('button', { name: strings.enlarge }));
    await waitFor(() => expect(document.querySelector('img[src^="data:image/jpeg"]')).not.toBeNull());
    expect(document.querySelector('.browser-artifact__cursor')).toBeNull();
  });

  it('shows account profile state and runtime capacity without exposing page content', async () => {
    use(
      http.get('/api/plugins/browser/api/profile', () => HttpResponse.json({ profileBytes: 2048, activeSessions: 1 })),
      http.get('/api/plugins/browser/api/sessions', () => HttpResponse.json({ live: [{ id: 'secret-session-id', state: 'agent', lease: null }], history: [] })),
      http.get('/api/plugins/browser/api/admin-status', () => HttpResponse.json({ activeUsers: 1, activeSessions: 1, maxActiveUsers: 4, maxSessionsPerUser: 2, artifactsAvailable: true })),
    );
    const Wrapper = wrapper();
    const view = render(<Wrapper><ToastProvider><BrowserAccount plugin="browser" params={{}} rest={[]} surface="deck" /></ToastProvider></Wrapper>);
    expect(await screen.findByText('2.0 KiB')).toBeInTheDocument();
    expect(screen.getByText('secret-sessi…')).toBeInTheDocument();
    view.unmount();
    render(<Wrapper><ToastProvider><BrowserSettings plugin="browser" params={{}} rest={[]} surface="deck" /></ToastProvider></Wrapper>);
    expect(await screen.findByText(`1 / 4 ${strings.activeAccounts}`)).toBeInTheDocument();
    expect(screen.queryByText('https://example.com')).toBeNull();
  });
});
