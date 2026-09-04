import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

// The live view's RFB client, aliased to a double for the whole runner (vitest.config.ts). The card
// dials it, sets `viewOnly` from the lease and waits for its 'connect' event, and this is where a test
// gets hold of the instance to drive those.
import { rfbClients, resetRfbClients } from './ui/novncDouble';
import { http, HttpResponse, listen, use, setDefaults, resetHandlers, close } from './ui/http';
import { ensurePluginUiRuntime } from './ui/hostRuntime';
import { ToastProvider, createWrapper } from './ui/hostHooks';
import manifest from '../plugins/browser/elowen-plugin.json' with { type: 'json' };
import csTranslations from '../plugins/browser/i18n/cs.json' with { type: 'json' };
import { BrowserArtifact } from '../plugins/browser/web-src/BrowserArtifact';
import { BrowserAccount } from '../plugins/browser/web-src/BrowserAccount';
import { BrowserSettings } from '../plugins/browser/web-src/BrowserSettings';
import { registerBrowserUi } from '../plugins/browser/web-src/runtime';

ensurePluginUiRuntime();
const strings = manifest.web.strings;
const csStrings = csTranslations.web.strings;
setDefaults(
  http.get('/api/plugins/ui', () => HttpResponse.json([{ name: 'browser', url: '/plugins/browser/web/index.js', cssUrl: '/plugins/browser/web/index.css', apiVersion: 15, nav: [], account: manifest.web.account, settings: manifest.web.settings, strings }])),
  http.get('/api/auth/me', () => HttpResponse.json({ user: { id: 1, username: 'user', is_admin: true } })),
  // Every card asks for one of these before it can show anything, so it is a default rather than
  // something each test has to remember.
  http.post('/api/plugins/browser/api/vnc-ticket', () => HttpResponse.json({ url: '/ws/plugins/browser/vnc?ticket=t1', expiresAt: Date.now() + 15_000, width: 1280, height: 800 })),
);
beforeAll(() => listen());
afterEach(() => { cleanup(); resetHandlers(); vi.useRealTimers(); vi.restoreAllMocks(); window.sessionStorage.clear(); resetRfbClients(); });
afterAll(() => close());

/** Wait for the card to dial, then let the handshake complete — which is when the picture appears. */
async function paint(): Promise<any> {
  await waitFor(() => expect(rfbClients.length).toBeGreaterThan(0));
  const client = rfbClients.at(-1)!;
  await act(async () => { client.emit('connect'); });
  return client;
}

const artifact = {
  id: 'browser:session-1', plugin: 'browser', sessionId: 'brain-1', toolCallId: 'tool-1', view: 'browser-session',
  fallback: 'Browser session', expiresAt: new Date(Date.now() + 60_000).toISOString(), status: 'open' as const,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  data: { browserSessionId: 'session-1', state: 'agent', title: 'Example', url: 'https://example.com', favicon: 'data:image/png;base64,aGVsbG8=', lastAction: null },
  media: { transport: 'sse' as const, path: '/plugins/browser/api/stream?sessionId=session-1' },
};

function wrapper() {
  const { wrapper: Wrapper } = createWrapper();
  return Wrapper;
}
type Pending = { label: string; reveal: () => void } | null;
function mountArtifact(narration?: string, pendingInput?: Pending) {
  const Wrapper = wrapper();
  const show = (text?: string, pending?: Pending) => (
    <Wrapper><ToastProvider>
      <BrowserArtifact plugin="browser" artifact={artifact} narration={text} pendingInput={pending} />
    </ToastProvider></Wrapper>
  );
  const view = render(show(narration, pendingInput));
  return Object.assign(view, {
    narrate: (text?: string) => view.rerender(show(text, pendingInput)),
    ask: (pending: Pending) => view.rerender(show(narration, pending)),
  });
}

/** The session's state. No pixels: those arrive on the live view socket, which the fake client above
 *  stands in for. */
const streamBody = [
  `event: session\ndata: ${JSON.stringify({ id: 'session-1', state: 'agent', lease: null, controlRevision: 0, favicon: 'data:image/png;base64,aGVsbG8=' })}\n\n`,
  `event: action\ndata: ${JSON.stringify({ action: 'click', target: 'Continue' })}\n\n`,
].join('');
/** An event stream a test pushes to one frame at a time, so a control change can arrive AFTER the card
 *  has reacted to the one before it. A handoff is a sequence — the agent asks, the card claims, the
 *  server confirms — and a body delivered in one piece cannot tell those steps apart. */
function liveStream() {
  let source!: ReadableStreamDefaultController<Uint8Array>;
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({ start: (controller) => { source = controller; } });
  return {
    response: () => new HttpResponse(body, { headers: { 'content-type': 'text/event-stream' } }),
    push: async (event: string, data: unknown) => {
      await act(async () => {
        source.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    },
  };
}

describe('browser plugin UI', () => {
  it('registers the chat artifact, settings and account surfaces on API 15', () => {
    let registration: any;
    const original = window.__elowenRegisterPluginUi;
    window.__elowenRegisterPluginUi = (name, value) => { registration = { name, value }; };
    registerBrowserUi(BrowserArtifact, BrowserSettings, BrowserAccount);
    window.__elowenRegisterPluginUi = original;
    expect(registration.name).toBe('browser');
    expect(registration.value.requiresApiVersion).toBe(15);
    expect(registration.value.chatArtifacts['browser-session']).toBe(BrowserArtifact);
    expect(registration.value.settings.runtime).toBe(BrowserSettings);
    expect(registration.value.account.profile).toBe(BrowserAccount);
  });

  it('renders the live session as one compact tile with no card chrome around it', async () => {
    use(http.get('/api/plugins/browser/api/stream', () => new HttpResponse(streamBody, { headers: { 'content-type': 'text/event-stream' } })));
    mountArtifact();
    const client = await paint();
    // The live canvas is mounted into the thumbnail's slot, and it is the ONE connection: the expanded
    // view moves this same node rather than opening a second stream of the whole framebuffer.
    expect(client.target.closest('.browser-artifact__vnc-slot')).not.toBeNull();
    expect(rfbClients).toHaveLength(1);
    // The picture IS the card: one control (the thumbnail itself) opens the canvas, and the only text
    // beside it is the site and the current action.
    expect(screen.getAllByRole('button', { name: strings.enlarge })).toHaveLength(1);
    expect(screen.getByText('example.com')).toBeInTheDocument();
    expect(document.querySelector('.browser-artifact__site-icon')).toHaveAttribute('src', 'data:image/png;base64,aGVsbG8=');
    expect(screen.queryByText('https://example.com')).toBeNull();
    expect(screen.queryByRole('heading')).toBeNull();
    // No running commentary on the thumbnail: the state is a dot, and its label is for assistive tech.
    expect(screen.queryByText('Clicking · Continue')).toBeNull();
    expect(document.querySelector('.browser-artifact__activity.has-action')).toBeNull();
    expect(document.querySelector('.browser-artifact__dot')).toHaveAttribute('data-tone');
    expect(document.querySelector('.browser-artifact__activity .sr-only')?.textContent).toBeTruthy();
    // Once it is painting the connecting notice goes, and nothing draws a second pointer over the page:
    // the framebuffer carries the real one.
    expect(screen.queryByText(strings.connectingImage)).toBeNull();
    expect(document.querySelector('.browser-artifact__cursor')).toBeNull();
  });

  it('says it is connecting until the picture actually arrives', async () => {
    use(http.get('/api/plugins/browser/api/stream', () => new HttpResponse(streamBody, { headers: { 'content-type': 'text/event-stream' } })));
    mountArtifact();
    // An empty box looks like a session that failed to start. Until the RFB handshake lands the card
    // says what it is doing instead.
    expect(await screen.findByText(strings.connectingImage)).toBeInTheDocument();
    await waitFor(() => expect(rfbClients.length).toBeGreaterThan(0));
    const client = rfbClients.at(-1)!;
    // It dialled the URL the ticket named, upgraded to a WebSocket scheme, and asked for the measured
    // quality and compression rather than noVNC's defaults.
    expect(client.url).toMatch(/^wss?:\/\/[^/]+\/ws\/plugins\/browser\/vnc\?ticket=t1$/);
    expect(client.scaleViewport).toBe(true);
    expect({ quality: client.qualityLevel, compression: client.compressionLevel }).toEqual({ quality: 8, compression: 6 });
    // Collapsed, the canvas is a thumbnail and a button: a stray wheel or key over the transcript must
    // not reach the remote page, so the client is told to stay out of the way until it is raised.
    expect(client.viewOnly).toBe(true);
    await act(async () => { client.emit('connect'); });
    expect(screen.queryByText(strings.connectingImage)).toBeNull();
  });

  it('reserves transcript room for the docked live view instead of covering the text', async () => {
    // Docked above the composer the card is out of the flow, so the newest turns ran underneath it and
    // their text was hidden rather than wrapped. The surface is told how tall the card is.
    use(http.get('/api/plugins/browser/api/stream', () => new HttpResponse(streamBody, { headers: { 'content-type': 'text/event-stream' } })));
    const listeners: (() => void)[] = [];
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true, media: query,
      addEventListener: (_: string, fn: () => void) => { listeners.push(fn); },
      removeEventListener: () => {},
    }));
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    const surface = document.createElement('div');
    surface.className = 'chat-surface-full';
    document.body.appendChild(surface);
    const Wrapper = wrapper();
    const view = render(
      <Wrapper><ToastProvider><BrowserArtifact plugin="browser" artifact={artifact} /></ToastProvider></Wrapper>,
      { container: surface },
    );

    await waitFor(() => expect(surface.style.getPropertyValue('--chat-dock-height')).not.toBe(''));
    // Unmounting must hand the space back, or a closed session would leave a permanent gap.
    view.unmount();
    expect(surface.style.getPropertyValue('--chat-dock-height')).toBe('');
    surface.remove();
    vi.unstubAllGlobals();
  });

  it('clears a stale artifact favicon when the live session has none', async () => {
    const noFaviconBody = `event: session\ndata: ${JSON.stringify({ id: 'session-1', state: 'agent', lease: null, controlRevision: 0, favicon: null })}\n\n`;
    use(http.get('/api/plugins/browser/api/stream', () => new HttpResponse(noFaviconBody, { headers: { 'content-type': 'text/event-stream' } })));
    mountArtifact();
    await waitFor(() => expect(document.querySelector('.browser-artifact__site-icon')).toBeNull());
  });

  it('uses the favicon delivered by the live stream when artifact data cannot carry it', async () => {
    const favicon = 'data:image/png;base64,c3RyZWFtZWQ=';
    const body = [
      `event: session\ndata: ${JSON.stringify({ id: 'session-1', state: 'agent', lease: null, controlRevision: 0, favicon: null })}\n\n`,
      `event: favicon\ndata: ${JSON.stringify({ favicon })}\n\n`,
      `event: frame\ndata: ${JSON.stringify({ data: 'ZmFrZS1qcGVn', mimeType: 'image/jpeg', width: 1280, height: 800, timestamp: 1 })}\n\n`,
    ].join('');
    use(http.get('/api/plugins/browser/api/stream', () => new HttpResponse(body, { headers: { 'content-type': 'text/event-stream' } })));
    const noFavicon = { ...artifact, data: { ...artifact.data, favicon: null } };
    const Wrapper = wrapper();
    render(<Wrapper><ToastProvider><BrowserArtifact plugin="browser" artifact={noFavicon} /></ToastProvider></Wrapper>);
    await waitFor(() => expect(document.querySelector(`img[src="${favicon}"]`)).not.toBeNull());
  });

  it('expands into a borderless canvas that closes on Escape', async () => {
    use(http.get('/api/plugins/browser/api/stream', () => new HttpResponse(streamBody, { headers: { 'content-type': 'text/event-stream' } })));
    mountArtifact();
    const compact = document.querySelector('.browser-artifact');
    fireEvent.click(await screen.findByRole('button', { name: strings.enlarge }));
    const canvas = await screen.findByRole('dialog', { name: 'Example' });
    expect(compact).toHaveAttribute('data-expanded', 'true');
    expect(compact).toHaveAttribute('aria-hidden', 'true');
    expect(canvas).toHaveAttribute('aria-modal', 'true');
    // No dialog header, body or footer: the raised surface carries the image and floating controls only.
    expect(within(canvas).queryByRole('heading')).toBeNull();
    expect(within(canvas).getByRole('button', { name: strings.closeView })).toBeInTheDocument();
    expect(within(canvas).getByRole('button', { name: strings.closeSession })).toBeInTheDocument();
    // The surface you work on is the one that gets the action copy.
    expect(await within(canvas).findByText('Clicking · Continue')).toBeInTheDocument();
    // The SAME connection moved into the raised surface. A second one would cost the whole framebuffer
    // again, which is the measurement that decided this design.
    await waitFor(() => expect(rfbClients).toHaveLength(1));
    expect(rfbClients[0]!.target.closest('.browser-artifact__surface')).not.toBeNull();
    expect(rfbClients[0]!.disconnected).toBe(false);
    fireEvent.keyDown(canvas, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(compact).not.toHaveAttribute('data-expanded');
    expect(compact).not.toHaveAttribute('aria-hidden');
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

  it('takes an agent-requested handoff itself, leaving only the control that gives it back', async () => {
    // Production report: the agent handed control over and the reader still had to press "Take control"
    // before "Return to agent" appeared — being asked to accept something already given to them. The
    // request IS the handoff, so the card claims the lease and offers the one control that is theirs.
    let claims = 0;
    const stream = liveStream();
    use(
      http.get('/api/plugins/browser/api/stream', () => stream.response()),
      // Claiming advances the revision, exactly as `claimTakeover` does on the server.
      http.post('/api/plugins/browser/api/takeover', () => {
        claims += 1;
        return HttpResponse.json({ leaseId: 'lease-handoff', expiresAt: Date.now() + 120_000, controlRevision: 2 });
      }),
      http.post('/api/plugins/browser/api/heartbeat', () => HttpResponse.json({ expiresAt: Date.now() + 120_000, controlRevision: 2 })),
    );
    mountArtifact();
    await stream.push('session', { id: 'session-1', state: 'agent', lease: null, controlRevision: 0 });
    await stream.push('control', { state: 'agent', reason: 'requested', controlRevision: 1 });

    await waitFor(() => expect(claims).toBe(1));
    expect((await screen.findAllByRole('button', { name: strings.returnToAgent })).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: strings.takeControl })).toBeNull();

    // The server keeps saying the agent is parked — `handed_over` rather than a cleared reason — so the
    // button pulses and the activity line names who is waiting on it.
    await stream.push('control', { state: 'user', reason: 'handed_over', controlRevision: 2, expiresAt: Date.now() + 120_000 });
    await waitFor(() => expect(document.querySelector('.browser-artifact__return--waiting')).not.toBeNull());
    fireEvent.click(await screen.findByRole('button', { name: strings.enlarge }));
    expect((await screen.findAllByText(strings.agentWaiting)).length).toBeGreaterThan(0);

    // One claim per control revision, however many frames repeat it.
    await stream.push('control', { state: 'user', reason: 'handed_over', controlRevision: 2, expiresAt: Date.now() + 120_000 });
    expect(claims).toBe(1);
  });

  it('does not fight another window for a handoff it lost, and never asks twice', async () => {
    let attempts = 0;
    const stream = liveStream();
    use(
      http.get('/api/plugins/browser/api/stream', () => stream.response()),
      http.post('/api/plugins/browser/api/takeover', () => {
        attempts += 1;
        return HttpResponse.json({ error: 'Browser is already under user control.' }, { status: 409 });
      }),
    );
    mountArtifact();
    await stream.push('session', { id: 'session-1', state: 'agent', lease: null, controlRevision: 0 });
    await stream.push('control', { state: 'agent', reason: 'requested', controlRevision: 1 });
    await waitFor(() => expect(attempts).toBe(1));

    // A refusal is an answer, not a transient failure. The card must not sit in a retry loop against a
    // handoff another window already holds, and must not toast: the reader never asked for this claim.
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(attempts).toBe(1);
    expect(screen.queryByText(/already under user control/i)).toBeNull();

    // Another window of this account claimed the same handoff first, and that window is the one driving.
    await stream.push('control', { state: 'user', reason: 'handed_over', controlRevision: 2, expiresAt: Date.now() + 120_000 });
    expect((await screen.findAllByRole('button', { name: strings.controlledElsewhere })).length).toBeGreaterThan(0);
    expect(document.querySelector('.browser-artifact__return--waiting')).toBeNull();
    expect(attempts).toBe(1);
  });

  it('leaves a takeover the reader started for their own reasons without the waiting pulse', async () => {
    use(
      http.get('/api/plugins/browser/api/stream', () => new HttpResponse(streamBody, { headers: { 'content-type': 'text/event-stream' } })),
      http.post('/api/plugins/browser/api/takeover', () => HttpResponse.json({ leaseId: 'lease-plain', expiresAt: Date.now() + 120_000, controlRevision: 1 })),
      http.post('/api/plugins/browser/api/heartbeat', () => HttpResponse.json({ expiresAt: Date.now() + 120_000, controlRevision: 1 })),
    );
    mountArtifact();
    await paint();
    fireEvent.click((await screen.findAllByRole('button', { name: strings.takeControl })).at(-1)!);
    expect((await screen.findAllByRole('button', { name: strings.returnToAgent })).length).toBeGreaterThan(0);
    // No agent is parked, so nothing here should be asking to be pressed.
    expect(document.querySelector('.browser-artifact__return--waiting')).toBeNull();
    expect(screen.queryByText(strings.agentWaiting)).toBeNull();
  });

  it('keeps takeover tokens local, hands the lease to the live view and releases control', async () => {
    const calls: { path: string; body: any }[] = [];
    use(
      http.get('/api/plugins/browser/api/stream', () => new HttpResponse(streamBody, { headers: { 'content-type': 'text/event-stream' } })),
      http.post('/api/plugins/browser/api/takeover', () => HttpResponse.json({ leaseId: 'lease-new', expiresAt: Date.now() + 120_000, controlRevision: 1 })),
      http.post('/api/plugins/browser/api/vnc-ticket', async ({ request }) => {
        calls.push({ path: 'vnc-ticket', body: await request.text() });
        return HttpResponse.json({ url: '/ws/plugins/browser/vnc?ticket=t2', expiresAt: Date.now() + 15_000, width: 1280, height: 800 });
      }),
      http.post('/api/plugins/browser/api/release', async ({ request }) => { calls.push({ path: 'release', body: await request.json() }); return HttpResponse.json({ released: true }); }),
      http.post('/api/plugins/browser/api/navigation', async ({ request }) => { calls.push({ path: 'navigation', body: await request.json() }); return HttpResponse.json({ navigated: 'back' }); }),
      http.post('/api/plugins/browser/api/heartbeat', () => HttpResponse.json({ expiresAt: Date.now() + 120_000 })),
    );
    mountArtifact();
    const client = await paint();
    // Collapsed: a thumbnail, so the client stays out of the way.
    expect(client.viewOnly).toBe(true);
    fireEvent.click(await screen.findByRole('button', { name: strings.enlarge }));
    // Raised, the SAME connection drives at once — before any takeover. The owner may always reach into
    // their own browser; "Take control" is what tells the agent to wait, not what unlocks the mouse.
    // Production regression: input used to be gated on a lease sealed into the ticket at mint time, so a
    // connection opened before the takeover stayed dead until it happened to reconnect.
    await waitFor(() => expect(client.viewOnly).toBe(false));
    expect(client.focused).toBe(true);
    expect(rfbClients).toHaveLength(1);
    // Page navigation belongs to whoever is driving: nothing to show while the agent holds the session.
    expect(screen.queryByRole('button', { name: strings.reload })).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: strings.takeControl }).at(-1)!);
    expect((await screen.findAllByText(strings.youControl)).length).toBeGreaterThan(0);
    for (const label of [strings.back, strings.forward, strings.reload]) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    expect(client.viewOnly).toBe(false);
    expect(rfbClients).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: strings.back }));
    await waitFor(() => expect(calls.some((call) => call.path === 'navigation' && call.body.action === 'back' && call.body.leaseId === 'lease-new')).toBe(true));
    fireEvent.click(screen.getAllByRole('button', { name: strings.returnToAgent }).at(-1)!);
    await waitFor(() => expect(calls.some((call) => call.path === 'release' && call.body.leaseId === 'lease-new')).toBe(true));
    // Handing it back does not take the mouse away: the raised canvas keeps driving.
    await waitFor(() => expect(screen.queryByRole('button', { name: strings.back })).toBeNull());
    expect(client.viewOnly).toBe(false);
    // Collapsing it does.
    fireEvent.click(screen.getByRole('button', { name: strings.closeView }));
    await waitFor(() => expect(client.viewOnly).toBe(true));
  });

  it('mints a ticket that names nothing but the session, before and after a takeover', async () => {
    const tickets: any[] = [];
    use(
      http.get('/api/plugins/browser/api/stream', () => new HttpResponse(streamBody, { headers: { 'content-type': 'text/event-stream' } })),
      http.post('/api/plugins/browser/api/takeover', () => HttpResponse.json({ leaseId: 'lease-drive', expiresAt: Date.now() + 120_000, controlRevision: 1 })),
      http.post('/api/plugins/browser/api/heartbeat', () => HttpResponse.json({ expiresAt: Date.now() + 120_000 })),
      http.post('/api/plugins/browser/api/vnc-ticket', async ({ request }) => {
        tickets.push(await request.text());
        return HttpResponse.json({ url: '/ws/plugins/browser/vnc?ticket=t3', expiresAt: Date.now() + 15_000, width: 1280, height: 800 });
      }),
    );
    mountArtifact();
    const client = await paint();
    expect(tickets.at(-1)).toBe('');
    fireEvent.click(await screen.findByRole('button', { name: strings.takeControl }));
    expect((await screen.findAllByText(strings.youControl)).length).toBeGreaterThan(0);
    // The lease never travels with the ticket: the server does not weigh it, so a reconnect after the
    // takeover asks for exactly what it asked for before.
    await act(async () => { client.emit('disconnect'); });
    await waitFor(() => expect(tickets).toHaveLength(2));
    expect(tickets.at(-1)).toBe('');
  });

  it('says the live view is unavailable rather than showing an empty box', async () => {
    // A host too old to carry a plugin WebSocket has no live view at all — there is no screencast to
    // fall back on any more. The card says so plainly and stays usable: the session is still running,
    // the agent is still working, and the controls that do not need pixels still do their job.
    let tickets = 0;
    use(
      http.get('/api/plugins/browser/api/stream', () => new HttpResponse(streamBody, { headers: { 'content-type': 'text/event-stream' } })),
      http.post('/api/plugins/browser/api/vnc-ticket', () => {
        tickets += 1;
        return HttpResponse.json({ error: 'This host cannot carry a browser live view connection.' }, { status: 501 });
      }),
    );
    mountArtifact();
    await waitFor(() => expect(tickets).toBeGreaterThan(0));
    // Said on the glass, not thrown as a toast: a missing picture is a state of the card.
    expect(await screen.findByText(strings.liveViewUnavailable)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    // And noVNC was never loaded, because there was nothing to connect to.
    expect(rfbClients).toHaveLength(0);
    // The rest of the card is untouched: the site, the state and the takeover control are all there.
    expect(screen.getByText('example.com')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: strings.takeControl }).length).toBeGreaterThan(0);
  });

  it('keeps your takeover through a remount of the card, and lets it go once the server has', async () => {
    // Production: a person took control, the transcript re-rendered the card (a plugin listing refresh,
    // a reload), and the same person was told the session was "controlled in another window" — for the
    // two minutes it took the orphaned lease to expire. The lease belongs to the TAB, not to one mount.
    const userStreamBody = [
      `event: session\ndata: ${JSON.stringify({ id: 'session-1', state: 'user', lease: { expiresAt: Date.now() + 120_000 }, controlRevision: 1 })}\n\n`,
      `event: frame\ndata: ${JSON.stringify({ data: 'ZmFrZS1qcGVn', mimeType: 'image/jpeg', width: 1280, height: 800, timestamp: 1 })}\n\n`,
    ].join('');
    let heartbeats = 0;
    let serverHoldsLease = false;
    const released: string[] = [];
    use(
      http.get('/api/plugins/browser/api/stream', () => new HttpResponse(serverHoldsLease ? userStreamBody : streamBody, { headers: { 'content-type': 'text/event-stream' } })),
      http.post('/api/plugins/browser/api/takeover', () => { serverHoldsLease = true; return HttpResponse.json({ leaseId: 'lease-tab', expiresAt: Date.now() + 120_000, controlRevision: 1 }); }),
      http.post('/api/plugins/browser/api/heartbeat', () => { heartbeats += 1; return serverHoldsLease ? HttpResponse.json({ expiresAt: Date.now() + 120_000, controlRevision: 1 }) : HttpResponse.json({ error: 'Browser control lease is stale or invalid.' }, { status: 400 }); }),
      http.post('/api/plugins/browser/api/release', async ({ request }) => { released.push(((await request.json()) as { leaseId: string }).leaseId); serverHoldsLease = false; return HttpResponse.json({ released: true }); }),
    );
    const first = mountArtifact();
    fireEvent.click(await screen.findByRole('button', { name: strings.takeControl }));
    expect((await screen.findAllByText(strings.youControl)).length).toBeGreaterThan(0);
    first.unmount();

    // A fresh mount of the same session, exactly as the transcript would do it.
    const second = mountArtifact();
    expect((await screen.findAllByText(strings.youControl)).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: strings.controlledElsewhere })).toBeNull();
    // Adopting a remembered lease checks it with the server at once, not twenty seconds later.
    await waitFor(() => expect(heartbeats).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: strings.returnToAgent }));
    await waitFor(() => expect(released).toEqual(['lease-tab']));
    second.unmount();

    // Released means forgotten: a third mount must not resurrect it.
    mountArtifact();
    expect(await screen.findByRole('button', { name: strings.takeControl })).toBeInTheDocument();
    expect(screen.queryByText(strings.youControl)).toBeNull();
  });

  it('binds no input handler of its own to the canvas', async () => {
    // noVNC binds the pointer and the keyboard to its own canvas inside this box. A handler here as well
    // would send every gesture twice — once natively, once as something synthesized — and the second
    // copy would land at coordinates measured against a different box.
    use(
      http.get('/api/plugins/browser/api/stream', () => new HttpResponse(streamBody, { headers: { 'content-type': 'text/event-stream' } })),
      http.post('/api/plugins/browser/api/takeover', () => HttpResponse.json({ leaseId: 'lease-new', expiresAt: Date.now() + 120_000, controlRevision: 1 })),
      http.post('/api/plugins/browser/api/heartbeat', () => HttpResponse.json({ expiresAt: Date.now() + 120_000 })),
    );
    mountArtifact();
    await paint();
    fireEvent.click(await screen.findByRole('button', { name: strings.enlarge }));
    fireEvent.click(screen.getAllByRole('button', { name: strings.takeControl }).at(-1)!);
    expect((await screen.findAllByText(strings.youControl)).length).toBeGreaterThan(0);
    const viewport = screen.getAllByLabelText(strings.browserViewport).at(-1)!;
    // Driving, and still nothing here claims the keyboard: the canvas is not a focus target of its own,
    // because the element noVNC owns inside it is.
    expect(viewport).toHaveAttribute('data-interactive', 'true');
    expect(viewport).not.toHaveAttribute('tabindex');
    expect(viewport).not.toHaveAttribute('role', 'application');
  });

  it('keeps a local takeover through a transient heartbeat failure', async () => {
    let heartbeatCalls = 0;
    vi.spyOn(globalThis, 'setInterval').mockImplementation(((handler: TimerHandler) => {
      queueMicrotask(() => { if (typeof handler === 'function') handler(); });
      return 1 as unknown as ReturnType<typeof setInterval>;
    }) as typeof setInterval);
    use(
      http.get('/api/plugins/browser/api/stream', () => new HttpResponse(streamBody, { headers: { 'content-type': 'text/event-stream' } })),
      http.post('/api/plugins/browser/api/takeover', () => HttpResponse.json({ leaseId: 'lease-heartbeat', expiresAt: Date.now() + 120_000, controlRevision: 1 })),
      http.post('/api/plugins/browser/api/heartbeat', () => { heartbeatCalls += 1; return HttpResponse.json({ error: 'temporary' }, { status: 503 }); }),
    );
    mountArtifact();
    fireEvent.click(await screen.findByRole('button', { name: strings.enlarge }));
    fireEvent.click(screen.getAllByRole('button', { name: strings.takeControl }).at(-1)!);
    expect((await screen.findAllByText(strings.youControl)).length).toBeGreaterThan(0);
    await waitFor(() => expect(heartbeatCalls).toBe(1));
    expect(screen.getAllByText(strings.youControl).length).toBeGreaterThan(0);
    expect(screen.queryByText(strings.controlledElsewhere)).toBeNull();
  });

  it('uses the connected stream instead of stale artifact control state', async () => {
    use(http.get('/api/plugins/browser/api/stream', () => new HttpResponse(streamBody, { headers: { 'content-type': 'text/event-stream' } })));
    const staleArtifact = { ...artifact, data: { ...artifact.data, state: 'user' as const } };
    const Wrapper = wrapper();
    render(<Wrapper><ToastProvider><BrowserArtifact plugin="browser" artifact={staleArtifact} /></ToastProvider></Wrapper>);
    expect((await screen.findAllByRole('button', { name: strings.takeControl })).length).toBeGreaterThan(0);
    expect(screen.queryByText(strings.controlledElsewhere)).toBeNull();
  });

  it('says the room is full instead of pretending to be connected when the stream is refused', async () => {
    // What production did: the opening snapshot arrived, the stream ended, and the card read
    // "Agent control" with an image that never came — while the viewer reconnected every half second.
    //
    // The limit is on the FRAMEBUFFER connections now, so it is the ticket that refuses: noVNC surfaces
    // no close code, and a refusal that only happened at the upgrade would reach the reader as an
    // anonymous disconnect.
    let attempts = 0;
    use(
      http.get('/api/plugins/browser/api/stream', () => new HttpResponse(streamBody, { headers: { 'content-type': 'text/event-stream' } })),
      http.post('/api/plugins/browser/api/vnc-ticket', () => {
        attempts += 1;
        return HttpResponse.json({ error: 'This browser session already has as many viewers as it allows.' }, { status: 429 });
      }),
    );
    mountArtifact();
    expect((await screen.findAllByText(strings.viewerLimit)).length).toBeGreaterThan(0);
    expect(screen.queryByText(strings.agentControl)).toBeNull();
    // Gentle retry: a full room does not change in half a second.
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    expect(attempts).toBe(1);
  });

  it('backs off when the server hangs up right after the handshake instead of blinking every half second', async () => {
    // Production: the daemon closed each connection on the first message after the handshake. The
    // handshake itself had succeeded, so every attempt reset the backoff to its minimum and the card
    // flashed placeholder → canvas → placeholder at 1 Hz. A connection counts as healthy only once it
    // has LIVED, not once it has opened.
    let tickets = 0;
    use(
      http.get('/api/plugins/browser/api/stream', () => new HttpResponse(streamBody, { headers: { 'content-type': 'text/event-stream' } })),
      http.post('/api/plugins/browser/api/vnc-ticket', () => {
        tickets += 1;
        return HttpResponse.json({ url: `/ws/plugins/browser/vnc?ticket=t${tickets}`, expiresAt: Date.now() + 15_000, width: 1280, height: 800 });
      }),
    );
    mountArtifact();
    const started = Date.now();
    while (Date.now() - started < 2_400) {
      const client = rfbClients[rfbClients.length - 1];
      if (client && !client.disconnected) {
        act(() => { client.emit('connect'); client.emit('disconnect', { clean: false }); });
        client.disconnected = true;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    // Doubling from 500 ms: attempts at 0, 0.5 s and 1.5 s fit in the window; the fourth waits until 3.5 s.
    // The bug retried at 0.5 s flat and made five.
    expect(tickets).toBeGreaterThanOrEqual(2);
    expect(tickets).toBeLessThanOrEqual(3);
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

  it('dismisses narration until the next agent message and expires it after ten seconds', async () => {
    use(http.get('/api/plugins/browser/api/stream', () => new HttpResponse(streamBody, { headers: { 'content-type': 'text/event-stream' } })));
    const view = mountArtifact();
    fireEvent.click(await screen.findByRole('button', { name: strings.enlarge }));
    const canvas = await screen.findByRole('dialog', { name: 'Example' });
    vi.useFakeTimers();

    view.narrate('Working on the first step.');
    expect(within(canvas).getByText('Working on the first step.')).toBeInTheDocument();
    fireEvent.click(within(canvas).getByRole('button', { name: 'Dismiss agent message' }));
    expect(within(canvas).queryByText('Working on the first step.')).toBeNull();

    // More streamed text belongs to the same message and stays dismissed.
    view.narrate('Working on the first step. Still processing.');
    expect(within(canvas).queryByText('Still processing.')).toBeNull();

    // The empty host narration marks the next user turn; the following agent message is new and reappears.
    view.narrate('');
    view.narrate('Starting the next step.');
    expect(within(canvas).getByText('Starting the next step.')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(9_999); });
    expect(within(canvas).getByText('Starting the next step.')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1); });
    expect(within(canvas).queryByText('Starting the next step.')).toBeNull();
    vi.useRealTimers();
  });

  it('says a question is waiting only on the expanded canvas, and gets out of the way when pressed', async () => {
    use(http.get('/api/plugins/browser/api/stream', () => new HttpResponse(streamBody, { headers: { 'content-type': 'text/event-stream' } })));
    const reveal = vi.fn();
    const waiting = { label: 'The assistant is waiting for your choice', reveal };
    const view = mountArtifact(undefined, waiting);
    await screen.findByRole('button', { name: strings.enlarge });
    // The thumbnail sits in the transcript, where the real question card is already visible below it.
    expect(screen.queryByRole('button', { name: waiting.label })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: strings.enlarge }));
    const canvas = await screen.findByRole('dialog', { name: 'Example' });
    const alert = within(canvas).getByRole('button', { name: waiting.label });
    expect(alert).toHaveClass('browser-artifact__question');
    // Announced without a second copy of the words: one live region, the button's own label.
    expect(canvas.querySelector('.sr-only[role="status"]')).toHaveTextContent(waiting.label);

    // Pressing it does exactly two things: uncover the card, and put the reader in front of it.
    fireEvent.click(alert);
    expect(reveal).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // Answered or withdrawn: nothing is left asking.
    fireEvent.click(screen.getByRole('button', { name: strings.enlarge }));
    view.ask(null);
    const reopened = await screen.findByRole('dialog', { name: 'Example' });
    expect(reopened.querySelector('.browser-artifact__question')).toBeNull();
    expect(reopened.querySelector('.sr-only[role="status"]')).toHaveTextContent('');
  });

  it('lets the canvas get out of the way before the host reveals the question', async () => {
    // The overlay restores focus to whatever opened it when it unmounts. Revealing the card in the same
    // breath as closing therefore focused the question and then had it yanked back to the thumbnail —
    // the reader ended up staring at the tile they had just left. The reveal has to be LAST.
    use(http.get('/api/plugins/browser/api/stream', () => new HttpResponse(streamBody, { headers: { 'content-type': 'text/event-stream' } })));
    const card = document.createElement('button');
    card.textContent = 'the real question card';
    document.body.appendChild(card);

    // What the host sees at the moment it is asked to reveal — the whole ordering contract in one record.
    const observed: { dialogStillUp: boolean; activeAtCall: Element | null }[] = [];
    const reveal = vi.fn(() => {
      observed.push({
        dialogStillUp: document.querySelector('[role="dialog"]') !== null,
        activeAtCall: document.activeElement,
      });
      card.focus();
    });
    mountArtifact(undefined, { label: 'The assistant is waiting for your choice', reveal });

    const tile = await screen.findByRole('button', { name: strings.enlarge });
    fireEvent.click(tile);
    const canvas = await screen.findByRole('dialog', { name: 'Example' });
    fireEvent.click(within(canvas).getByRole('button', { name: 'The assistant is waiting for your choice' }));

    await waitFor(() => expect(reveal).toHaveBeenCalledTimes(1));
    // By the time the host was asked to reveal, the canvas had already gone AND its own focus restore had
    // already run, so nothing is left afterwards to take focus off the question. (The restore lands on
    // whatever was focused when the overlay opened; under jsdom a click does not focus the button it hits,
    // so that is the body here — what matters is that it is not the card, and that it has already run.)
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(observed).toHaveLength(1);
    expect(observed[0]!.dialogStillUp).toBe(false);
    expect(observed[0]!.activeAtCall).not.toBe(card);
    expect(tile.isConnected).toBe(true);

    // A frame later — the earliest anything else could have interfered — the question still has it.
    await new Promise((resolve) => { requestAnimationFrame(() => resolve(null)); });
    expect(document.activeElement).toBe(card);

    card.remove();
  });

  const dependencyStatus = (dependencies: unknown) => http.get(
    '/api/plugins/browser/api/admin-status',
    () => HttpResponse.json({ activeUsers: 0, activeSessions: 0, maxActiveUsers: 4, maxSessionsPerUser: 2, artifactsAvailable: true, dependencies }),
  );
  const settings = () => {
    const Wrapper = wrapper();
    return render(<Wrapper><ToastProvider><BrowserSettings plugin="browser" params={{}} rest={[]} surface="page" /></ToastProvider></Wrapper>);
  };

  const readinessRows = (container: HTMLElement) =>
    [...container.querySelectorAll<HTMLElement>('[data-settings-group]')][0]!.querySelectorAll<HTMLElement>('.settings-row');

  it('answers the readiness question at a glance, and stays quiet when everything is ready', async () => {
    use(dependencyStatus({
      status: 'ready',
      ready: 2,
      total: 2,
      checks: [
        { id: 'chrome', status: 'ready', label: 'Chrome or Chromium', code: 'chrome.detected', detail: 'Found a supported executable on this host.', value: 'chromium' },
        { id: 'network-proxy', status: 'ready', label: 'Enforcing network proxy', code: 'proxy.ready', detail: 'proxy-chain is loadable and pins DNS per request.' },
      ],
    }));
    const view = settings();

    // The verdict is a word, not only a colour, and the count says how far it got. It rides in the
    // section header's own actions slot, as a live region so a refresh announces a change.
    const summary = (await screen.findByText(`2 / 2 ${strings.depsCounted}`)).parentElement!;
    expect(summary).toHaveAttribute('role', 'status');
    expect(within(summary).getByText(strings.depReady)).toBeInTheDocument();
    expect(summary.closest('.settings-group__actions')).not.toBeNull();

    // A ready dependency says nothing beyond its badge, and stays on the record's single trailing line.
    const rows = readinessRows(view.container);
    expect(rows).toHaveLength(2);
    expect(screen.getByText(strings.dep_label_chrome)).toBeInTheDocument();
    expect(rows[0]).toHaveAttribute('data-trailing', 'inline');
    expect(screen.queryByText('proxy-chain is loadable and pins DNS per request.')).toBeNull();
    // …except the browser's name, which is a fact worth seeing and is never its path.
    expect(within(rows[0]!).getByText('chromium')).toBeInTheDocument();
  });

  it('names the blocked dependency and the exact fix, in the reader\'s language', async () => {
    use(dependencyStatus({
      status: 'blocked',
      ready: 1,
      total: 3,
      checks: [
        { id: 'chrome', status: 'blocked', label: 'Chrome or Chromium', code: 'chrome.missing', detail: 'No supported Chrome or Chromium executable was found on this host.', remediation: 'Install Google Chrome or Chromium, or set the executable in this plugin\u2019s settings.' },
        { id: 'chat-artifacts', status: 'warning', label: 'Live view in chat', code: 'artifacts.missing', detail: 'This host has no inline chat artifact bridge, so sessions run without a live card in chat.', remediation: 'Update Elowen to a release that publishes inline chat artifacts.' },
        { id: 'profile-storage', status: 'ready', label: 'Profile storage', code: 'storage.ready', detail: 'The profile directory is private and writable.' },
      ],
    }));
    const view = settings();

    // The worst outcome is the verdict — a warning must not be reported as ready.
    const summary = (await screen.findByText(`1 / 3 ${strings.depsCounted}`)).parentElement!;
    expect(within(summary).getByText(strings.depBlocked)).toBeInTheDocument();

    const rows = readinessRows(view.container);
    expect(within(rows[0]!).getByText(strings.depBlocked)).toBeInTheDocument();
    // Detail and remediation are READ on the row, not hidden behind a tooltip, and the record takes the
    // stacked trailing side so neither collapses into a phone's value column.
    expect(rows[0]).toHaveAttribute('data-trailing', 'stack');
    expect(within(rows[0]!).getByText(strings.dep_chrome_missing)).toBeInTheDocument();
    expect(within(rows[0]!).getByText(strings.dep_chrome_missing_fix)).toBeInTheDocument();
    expect(within(rows[0]!).queryByRole('button', { name: 'Help' })).toBeNull();
    // A warning is its own outcome: the session still runs, so it neither blocks nor passes silently.
    expect(within(rows[1]!).getByText(strings.depAttention)).toBeInTheDocument();
    expect(within(rows[1]!).getByText(strings.dep_artifacts_missing_fix)).toBeInTheDocument();
    expect(within(rows[2]!).getByText(strings.depReady)).toBeInTheDocument();
    expect(rows[2]).toHaveAttribute('data-trailing', 'inline');
  });

  it('claims no sandbox verdict it cannot stand behind', async () => {
    use(dependencyStatus({
      status: 'ready', ready: 1, total: 1,
      checks: [{ id: 'chrome', status: 'ready', label: 'Chrome or Chromium', code: 'chrome.detected', detail: 'Found a supported executable on this host.', value: 'chromium' }],
    }));
    const view = settings();
    await screen.findByText(`1 / 1 ${strings.depsCounted}`);

    // A host policy can still refuse the launch, so there is no sandbox row wearing a green badge —
    // the section says in words where the sandbox is actually settled.
    expect(readinessRows(view.container)).toHaveLength(1);
    expect(screen.getByText(strings.depsHint)).toBeInTheDocument();
    expect(strings.depsHint).toContain('first managed launch');
    expect(view.container.textContent).not.toContain('no-sandbox');
  });

  it('renders nothing about dependencies against a host that does not report them', async () => {
    // The panel is additive: an older daemon answers the same route without the report, and the page
    // keeps working instead of rendering an empty or half-built block.
    use(dependencyStatus(undefined));
    const view = settings();
    // The capacity, isolation and limits groups still render, so the page is intact without the report.
    expect(await screen.findByText(strings.liveCapacity)).toBeInTheDocument();
    expect(screen.queryByText(strings.depsTitle)).toBeNull();
    expect(view.container.querySelectorAll('[data-settings-group]')).toHaveLength(3);
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
    // Capacity is a settings record too: the label names the figure, the badge carries it.
    expect(await screen.findByText(strings.activeAccounts)).toBeInTheDocument();
    expect(screen.getByText('1 / 4')).toBeInTheDocument();
    expect(screen.queryByText('https://example.com')).toBeNull();
  });

  // The account panel sits in the Account deck between Models, Memory and Terminal. Those are the host's
  // settings groups and rows; this one used to be a pair of hand-built tiles in a grid of its own, which
  // read as a different application wearing the same colours. Assert the host's anatomy rather than a
  // resemblance somebody has to maintain by eye.
  it('builds the account panel from the host settings groups and rows, with no layout of its own', async () => {
    use(
      http.get('/api/plugins/browser/api/profile', () => HttpResponse.json({ profileBytes: 2048, activeSessions: 1 })),
      http.get('/api/plugins/browser/api/sessions', () => HttpResponse.json({ live: [{ id: 'secret-session-id', state: 'agent', lease: null }], history: [] })),
    );
    const Wrapper = wrapper();
    const view = render(<Wrapper><ToastProvider><BrowserAccount plugin="browser" params={{}} rest={[]} surface="deck" /></ToastProvider></Wrapper>);

    await screen.findByText('2.0 KiB');
    expect(view.container.querySelectorAll('[data-settings-document]')).toHaveLength(1);
    // Two groups: the stored profile, and the sessions running against it.
    const groups = view.container.querySelectorAll('[data-settings-group]');
    expect(groups).toHaveLength(2);
    expect(within(groups[0] as HTMLElement).getByText(strings.profileStorage)).toBeInTheDocument();
    expect(within(groups[1] as HTMLElement).getByText(strings.liveSessions)).toBeInTheDocument();
    // The storage figure and the running session are settings ROWS, not tiles.
    expect(view.container.querySelectorAll('.settings-row')).toHaveLength(2);
    // Both destructive actions are the host's square icon control, named for a screen reader rather than
    // spelled out in a wide labelled button that would set the row height.
    expect(screen.getByRole('button', { name: strings.clearProfile })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: strings.closeSession })).toBeInTheDocument();
  });

  // Clearing the profile under a running Chrome would corrupt it, so the control waits — and a disabled
  // destructive action that never says why is a dead end.
  it('blocks clearing while a session runs and states the reason, then allows it once none are left', async () => {
    let live: unknown[] = [{ id: 'secret-session-id', state: 'agent', lease: null }];
    use(
      http.get('/api/plugins/browser/api/profile', () => HttpResponse.json({ profileBytes: 2048, activeSessions: live.length })),
      http.get('/api/plugins/browser/api/sessions', () => HttpResponse.json({ live, history: [] })),
    );
    const Wrapper = wrapper();
    const view = render(<Wrapper><ToastProvider><BrowserAccount plugin="browser" params={{}} rest={[]} surface="deck" /></ToastProvider></Wrapper>);

    await screen.findByText('2.0 KiB');
    expect(screen.getByRole('button', { name: strings.clearProfile })).toBeDisabled();
    expect(screen.getByText(strings.clearBlocked)).toBeInTheDocument();

    live = [];
    view.unmount();
    render(<Wrapper><ToastProvider><BrowserAccount plugin="browser" params={{}} rest={[]} surface="deck" /></ToastProvider></Wrapper>);
    await waitFor(() => expect(screen.getByRole('button', { name: strings.clearProfile })).toBeEnabled());
    // With nothing running, the sessions group says so in the host's empty state rather than an empty box.
    expect(screen.getByText(strings.noSessions)).toBeInTheDocument();
    expect(screen.queryByText(strings.clearBlocked)).toBeNull();
  });

  it('closes the session the reader picked, named by who is holding it', async () => {
    const closed: string[] = [];
    use(
      http.get('/api/plugins/browser/api/profile', () => HttpResponse.json({ profileBytes: 2048, activeSessions: 1 })),
      http.get('/api/plugins/browser/api/sessions', () => HttpResponse.json({ live: [{ id: 'secret-session-id', state: 'user', lease: null }], history: [] })),
      http.post('/api/plugins/browser/api/close', ({ request }) => {
        closed.push(new URL(request.url).searchParams.get('sessionId') ?? '');
        return HttpResponse.json({ ok: true });
      }),
    );
    const Wrapper = wrapper();
    render(<Wrapper><ToastProvider><BrowserAccount plugin="browser" params={{}} rest={[]} surface="deck" /></ToastProvider></Wrapper>);

    await screen.findByText('2.0 KiB');
    // Who holds the session stays visible on the row — it must not regress into a tooltip.
    expect(screen.getByText(strings.userControl)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: strings.closeSession }));
    await waitFor(() => expect(closed).toEqual(['secret-session-id']));
  });

  it('destroys the profile only behind the confirmation, never on the icon action alone', async () => {
    let cleared = 0;
    use(
      http.get('/api/plugins/browser/api/profile', () => HttpResponse.json({ profileBytes: 2048, activeSessions: 0 })),
      http.get('/api/plugins/browser/api/sessions', () => HttpResponse.json({ live: [], history: [] })),
      http.delete('/api/plugins/browser/api/profile', () => { cleared += 1; return HttpResponse.json({ ok: true }); }),
    );
    const Wrapper = wrapper();
    render(<Wrapper><ToastProvider><BrowserAccount plugin="browser" params={{}} rest={[]} surface="deck" /></ToastProvider></Wrapper>);

    await screen.findByText('2.0 KiB');
    fireEvent.click(screen.getByRole('button', { name: strings.clearProfile }));
    expect(await screen.findByText(strings.clearConfirmTitle)).toBeInTheDocument();
    expect(cleared).toBe(0);

    // The dialog's own confirm, not the row's icon action — they share a name on purpose.
    const dialog = screen.getByText(strings.clearConfirmTitle).closest('.modal, [role="dialog"]') as HTMLElement;
    fireEvent.click(within(dialog).getByRole('button', { name: strings.clearProfile }));
    await waitFor(() => expect(cleared).toBe(1));
  });

  it('keeps the account panel on the host error state when the profile cannot be read', async () => {
    use(
      http.get('/api/plugins/browser/api/profile', () => HttpResponse.json({ error: 'boom' }, { status: 500 })),
      http.get('/api/plugins/browser/api/sessions', () => HttpResponse.json({ live: [], history: [] })),
    );
    const Wrapper = wrapper();
    const view = render(<Wrapper><ToastProvider><BrowserAccount plugin="browser" params={{}} rest={[]} surface="deck" /></ToastProvider></Wrapper>);

    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
    // Nothing of the surface is drawn over a failed read, so no figure is shown as if it were real.
    expect(view.container.querySelectorAll('[data-settings-group]')).toHaveLength(0);
  });

  // Czech is a fully translated locale for this plugin, so the panel must be Czech throughout — no English
  // sentence surviving in a rail entry or a row because a string was only ever written in the manifest.
  it('says every account-panel string in the reader\'s language', async () => {
    use(
      http.get('/api/plugins/ui', () => HttpResponse.json([{
        name: 'browser', url: '/plugins/browser/web/index.js', cssUrl: '/plugins/browser/web/index.css',
        apiVersion: 15, nav: [], account: manifest.web.account, settings: manifest.web.settings,
        strings: { ...strings, ...csStrings },
      }])),
      http.get('/api/plugins/browser/api/profile', () => HttpResponse.json({ profileBytes: 2048, activeSessions: 1 })),
      http.get('/api/plugins/browser/api/sessions', () => HttpResponse.json({ live: [{ id: 'secret-session-id', state: 'agent', lease: null }], history: [] })),
    );
    const Wrapper = wrapper();
    const view = render(<Wrapper><ToastProvider><BrowserAccount plugin="browser" params={{}} rest={[]} surface="deck" /></ToastProvider></Wrapper>);

    expect(await screen.findByText(csStrings.profileStorage)).toBeInTheDocument();
    expect(screen.getByText(csStrings.storageUsed)).toBeInTheDocument();
    expect(screen.getByText(csStrings.liveSessions)).toBeInTheDocument();
    expect(screen.getByText(csStrings.agentControl)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: csStrings.clearProfile })).toBeInTheDocument();
    // The English originals are gone, not merely covered up.
    for (const english of [strings.profileStorage, strings.storageUsed, strings.liveSessions, strings.agentControl]) {
      expect(within(view.container).queryByText(english)).toBeNull();
    }
  });
});
