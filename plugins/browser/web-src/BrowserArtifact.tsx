import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode, type WheelEvent } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, Expand, Hand, MessageCircleQuestion, MessageSquareText, Power, RotateCw, ShieldCheck, X, type LucideIcon } from 'lucide-react';
import type { BrowserArtifactProps } from './runtime';
import { apiError, jsonRequest, runtime } from './runtime';
import { useBrowserStream } from './useBrowserStream';

interface ArtifactData {
  browserSessionId: string;
  state: 'creating' | 'agent' | 'user' | 'closing' | 'closed' | 'error';
  title: string;
  url: string;
  favicon: string | null;
  lastAction: string | null;
}
interface Lease { leaseId: string; expiresAt: number }

const NARRATION_VISIBLE_MS = 10_000;

const asData = (value: unknown): ArtifactData | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Partial<ArtifactData>;
  if (typeof raw.browserSessionId !== 'string') return null;
  return {
    browserSessionId: raw.browserSessionId,
    state: raw.state ?? 'agent',
    title: typeof raw.title === 'string' ? raw.title : '',
    url: typeof raw.url === 'string' ? raw.url : '',
    favicon: typeof raw.favicon === 'string' && raw.favicon.length <= 40 * 1024 && /^data:image\//i.test(raw.favicon) ? raw.favicon : null,
    lastAction: typeof raw.lastAction === 'string' ? raw.lastAction : null,
  };
};

const inputPath = (sessionId: string, action: string): string => `/plugins/browser/api/${action}?sessionId=${encodeURIComponent(sessionId)}`;

/** The site, not the address. A thumbnail this size has room for "example.com" and nothing after it, and
 *  the full address is the one piece of page context the live image already shows. */
const siteName = (url: string): string => {
  try { return new URL(url).host || url; } catch { return url; }
};

/** One control on the glass. The host `IconButton` is a bordered SQUARE by design — it aligns to the edge
 *  of a table cell or a toolbar rule, which is why it declines a radius — so putting one on a translucent
 *  disc drew two frames around a single control: the square outline inside the disc that the production
 *  screenshot caught. This is the same affordance with one shape: a round ghost icon button that carries
 *  the glass itself when it stands alone on the image, and stays transparent inside the controls pill,
 *  which already is the glass. Keyboard focus is a ring, never the border. */
function GlassButton({ icon: Icon, label, onClick, disabled, tone, className = '' }: {
  icon: LucideIcon; label: string; onClick?: () => void; disabled?: boolean; tone?: 'danger'; className?: string;
}) {
  return (
    <button
      type="button"
      className={`browser-artifact__icon ${className}`.trim()}
      data-tone={tone}
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon size={14} aria-hidden />
    </button>
  );
}

/** The expanded canvas: the live browser raised over the page, with the transcript still visible around
 *  it. The host `Modal` cannot draw this — every presentation frames its content in a titled card whose
 *  header, body and footer are the surface, and here the image IS the surface — so the overlay contract
 *  is rebuilt at its smallest honest size: a portal to <body>, a scrim that dismisses on a press that
 *  BEGAN on it, Escape, a Tab loop inside the surface, and focus returned to the control that opened it.
 *  Marking the rest of the document inert stays with the host's own overlay stack, which no plugin
 *  bundle can reach; the trap and the scrim are what keep this surface modal without it. */
function CanvasOverlay({ label, aspect, onClose, children }: { label: string; aspect: number | null; onClose: () => void; children: ReactNode }) {
  const surface = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  /** Whether the press that is about to produce a click started on the scrim itself. */
  const pressedScrim = useRef(false);

  useEffect(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    surface.current?.focus();
    const { body } = document;
    const overflow = body.style.overflow;
    body.style.overflow = 'hidden';
    return () => {
      body.style.overflow = overflow;
      opener.current?.focus();
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    // While the user drives the session the canvas has already claimed every key for the remote page —
    // Escape included, which is a key a web page may legitimately need. The way out is then the labelled
    // close control or the scrim, exactly as it is in a remote desktop that has grabbed the keyboard.
    if (event.defaultPrevented) return;
    if (event.key === 'Escape') { event.stopPropagation(); onClose(); return; }
    if (event.key !== 'Tab' || !surface.current) return;
    const stops = Array.from(surface.current.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex]:not([tabindex="-1"])'));
    if (stops.length === 0) return;
    const first = stops[0];
    const last = stops[stops.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === surface.current)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
  };

  return createPortal(
    <div
      className="browser-artifact__overlay"
      onPointerDown={(event) => { pressedScrim.current = event.target === event.currentTarget; }}
      onClick={(event) => {
        if (event.target !== event.currentTarget || !pressedScrim.current) return;
        pressedScrim.current = false;
        onClose();
      }}
    >
      <div
        ref={surface}
        className="browser-artifact__surface"
        // The surface takes the shape of the stream, so the image never sits in its own letterbox.
        style={aspect ? { '--browser-aspect': String(aspect) } as CSSProperties : undefined}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function BrowserArtifact({ artifact, narration, pendingInput }: BrowserArtifactProps) {
  const host = runtime();
  const { Button, ConfirmDialog, Spinner } = host.components;
  const strings = host.hooks.usePluginStrings('browser');
  const toast = host.hooks.useToast();
  const data = asData(artifact.data);
  const stream = useBrowserStream(artifact.media?.path);
  const [expanded, setExpanded] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [lease, setLease] = useState<Lease | null>(null);
  const [speechHidden, setSpeechHidden] = useState(false);
  const pointerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speechTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingMove = useRef<Record<string, unknown> | null>(null);
  /** A host `reveal` waiting for this canvas to actually get out of the way — see the effect below. */
  const pendingReveal = useRef<(() => void) | null>(null);
  const sessionId = data?.browserSessionId ?? '';
  const title = data?.title || strings.sessionTitle || 'Browser session';
  const url = data?.url || '';
  const site = url ? siteName(url) : '';
  const state = stream.closed ? 'closed' : lease || stream.control.state === 'user' || data?.state === 'user' ? 'user' : data?.state ?? 'agent';
  const takeoverRequested = stream.control.state === 'agent' && stream.control.reason === 'requested';
  /** What the agent is SAYING while you watch it browse (host API 14). The canvas covers the transcript,
   *  so without this the reply streams on underneath it. The host already bounds and clears the string —
   *  the plugin only decides whether there is anything to show. */
  const speech = (narration ?? '').trim();
  const visibleSpeech = speechHidden ? '' : speech;
  /** The app is waiting on an answer and this canvas is covering the card that takes it (host API 15).
   *  Nothing about the question crosses the boundary — a line to show and a way back. */
  const waiting = pendingInput ?? null;
  const frame = stream.frame;
  /** Both surfaces take the SHAPE of the live stream, so the canvas box and the image coincide — which is
   *  also what keeps the pointer mapping honest, since a click is sent as a fraction of the canvas. */
  const frameAspect = frame && frame.height > 0 ? frame.width / frame.height : null;
  const aspectStyle = frameAspect ? { '--browser-aspect': String(frameAspect) } as CSSProperties : undefined;
  const action = stream.action
    ? `${strings[`action_${stream.action.kind}`] || stream.action.kind}${stream.action.target ? ` · ${stream.action.target}` : ''}`
    : takeoverRequested ? strings.waitingForUser || 'Waiting for user input' : data?.lastAction;

  useEffect(() => () => {
    if (pointerTimer.current) clearTimeout(pointerTimer.current);
    if (speechTimer.current) clearTimeout(speechTimer.current);
  }, []);
  useEffect(() => {
    if (speechTimer.current) { clearTimeout(speechTimer.current); speechTimer.current = null; }
    // The host clears narration on the next user turn. That empty edge is the message boundary: a manually
    // dismissed or expired line stays hidden while the same reply streams, then the next reply may show.
    if (!speech) { setSpeechHidden(false); return; }
    if (speechHidden) return;
    speechTimer.current = setTimeout(() => {
      speechTimer.current = null;
      setSpeechHidden(true);
    }, NARRATION_VISIBLE_MS);
    return () => {
      if (speechTimer.current) { clearTimeout(speechTimer.current); speechTimer.current = null; }
    };
  }, [speech, speechHidden]);
  useEffect(() => {
    if (!lease) return;
    const interval = setInterval(() => {
      void runtime().api(inputPath(sessionId, 'heartbeat'), jsonRequest('POST', { leaseId: lease.leaseId }))
        .then((value) => {
          const next = value as { expiresAt?: number };
          if (typeof next.expiresAt === 'number') setLease((current) => current?.leaseId === lease.leaseId ? { ...current, expiresAt: next.expiresAt! } : current);
        })
        .catch(() => setLease((current) => current?.leaseId === lease.leaseId ? null : current));
    }, 20_000);
    return () => clearInterval(interval);
  }, [lease, sessionId]);
  useEffect(() => {
    if (stream.control.state === 'agent') setLease(null);
  }, [stream.control.state]);
  useEffect(() => {
    // Handing the reader back to the question card is TWO moves in a fixed order, and running them in one
    // go got the order wrong: `reveal` focused the card, and then the closing overlay's own cleanup —
    // which restores focus to whatever opened it — pulled focus straight back to the thumbnail. So the
    // canvas closes first and the reveal waits here: an effect keyed on `expanded` runs after React has
    // flushed the unmounting overlay's cleanup, so the last thing to touch focus is the question.
    if (expanded) return;
    const reveal = pendingReveal.current;
    if (!reveal) return;
    pendingReveal.current = null;
    reveal();
  }, [expanded]);
  useEffect(() => {
    // A pointer move is batched for 50ms. Releasing (or losing) control inside that window would otherwise
    // fire it afterwards against a lease that no longer exists — a rejected request and a toast for a
    // gesture the user already finished.
    if (lease) return;
    if (pointerTimer.current) { clearTimeout(pointerTimer.current); pointerTimer.current = null; }
    pendingMove.current = null;
  }, [lease]);

  const status = useMemo(() => {
    if (stream.closed || state === 'closed') return { tone: 'muted' as const, label: strings.closed || 'Closed' };
    if (stream.error) return { tone: 'danger' as const, label: strings.disconnected || 'Disconnected' };
    if (state === 'user') return { tone: 'accent' as const, label: lease ? strings.youControl || 'You control' : strings.userControl || 'User control' };
    // A handoff the agent asked for is a STATE, not a passing action: the thumbnail carries no action
    // copy, so this is what turns its dot amber and tells a screen reader why the button is waiting.
    if (takeoverRequested) return { tone: 'warning' as const, label: strings.waitingForUser || 'Waiting for user input' };
    return { tone: stream.connected ? 'success' as const : 'warning' as const, label: stream.connected ? strings.agentControl || 'Agent control' : strings.connecting || 'Connecting' };
  }, [lease, state, stream.closed, stream.connected, stream.error, strings, takeoverRequested]);

  const run = async <T,>(name: string, operation: () => Promise<T>): Promise<T | undefined> => {
    setPending(name);
    try { return await operation(); }
    catch (error) { toast.toast(apiError(error), 'error'); return undefined; }
    finally { setPending(null); }
  };

  const takeControl = async (): Promise<void> => {
    const result = await run('takeover', () => runtime().api(inputPath(sessionId, 'takeover'), jsonRequest('POST')) as Promise<Lease>);
    if (result) setLease(result);
  };
  const releaseControl = async (): Promise<void> => {
    if (!lease) return;
    const released = await run('release', () => runtime().api(inputPath(sessionId, 'release'), jsonRequest('POST', { leaseId: lease.leaseId })));
    if (released !== undefined) setLease(null);
  };
  const closeSession = async (): Promise<void> => {
    const closed = await run('close', () => runtime().api(inputPath(sessionId, 'close'), jsonRequest('POST')));
    if (closed !== undefined) { setConfirmClose(false); setExpanded(false); }
  };
  const command = async (events: Record<string, unknown>[]): Promise<void> => {
    if (!lease || events.length === 0) return;
    await runtime().api(inputPath(sessionId, 'input'), jsonRequest('POST', { leaseId: lease.leaseId, events }));
  };
  const shortcut = (key: string, code: string, modifiers: string[] = []): void => {
    void command([
      { type: 'key', action: 'down', key, code, modifiers },
      { type: 'key', action: 'up', key, code, modifiers },
    ]).catch((error) => toast.toast(apiError(error), 'error'));
  };

  const pointerEvent = (event: PointerEvent<HTMLDivElement>, actionName: 'move' | 'down' | 'up'): Record<string, unknown> => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      type: 'pointer', action: actionName,
      x: event.clientX - rect.left, y: event.clientY - rect.top,
      surfaceWidth: rect.width, surfaceHeight: rect.height,
      button: event.button === 1 ? 'middle' : event.button === 2 ? 'right' : 'left',
      modifiers: [event.altKey ? 'Alt' : '', event.ctrlKey ? 'Control' : '', event.metaKey ? 'Meta' : '', event.shiftKey ? 'Shift' : ''].filter(Boolean),
    };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (!lease) return;
    pendingMove.current = pointerEvent(event, 'move');
    if (pointerTimer.current) return;
    pointerTimer.current = setTimeout(() => {
      pointerTimer.current = null;
      const next = pendingMove.current;
      pendingMove.current = null;
      if (next) void command([next]).catch((error) => toast.toast(apiError(error), 'error'));
    }, 50);
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (!lease) return;
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    void command([pointerEvent(event, 'down')]).catch((error) => toast.toast(apiError(error), 'error'));
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>): void => {
    if (!lease) return;
    void command([pointerEvent(event, 'up')]).catch((error) => toast.toast(apiError(error), 'error'));
  };
  const onWheel = (event: WheelEvent<HTMLDivElement>): void => {
    if (!lease) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    void command([{
      type: 'wheel', x: event.clientX - rect.left, y: event.clientY - rect.top,
      surfaceWidth: rect.width, surfaceHeight: rect.height,
      deltaX: event.deltaX, deltaY: event.deltaY,
      modifiers: [event.altKey ? 'Alt' : '', event.ctrlKey ? 'Control' : '', event.metaKey ? 'Meta' : '', event.shiftKey ? 'Shift' : ''].filter(Boolean),
    }]).catch((error) => toast.toast(apiError(error), 'error'));
  };
  const onKey = (event: KeyboardEvent<HTMLDivElement>, actionName: 'down' | 'up'): void => {
    if (!lease) return;
    if (actionName === 'down') event.preventDefault();
    void command([{
      type: 'key', action: actionName, key: event.key, code: event.code,
      modifiers: [event.altKey ? 'Alt' : '', event.ctrlKey ? 'Control' : '', event.metaKey ? 'Meta' : '', event.shiftKey ? 'Shift' : ''].filter(Boolean),
    }]).catch((error) => toast.toast(apiError(error), 'error'));
  };
  const onPaste = (event: ClipboardEvent<HTMLDivElement>): void => {
    if (!lease) return;
    const text = event.clipboardData.getData('text');
    if (!text) return;
    event.preventDefault();
    void command([{ type: 'paste', text }]).catch((error) => toast.toast(apiError(error), 'error'));
  };

  /** The live image and the two marks that belong ON it: what the session is doing right now, and — on
   *  the expanded canvas only — the agent's pointer. The thumbnail leaves the pointer out: at a third of
   *  the width it is a 28px arrow over a 300px page, which reads as damage rather than as feedback.
   *
   *  The agent's pointer is withdrawn whenever the session is under USER control — this window's takeover
   *  or another one's. The stream only reports where the AGENT is pointing, so while a person is driving
   *  it is a stale arrow sitting wherever the agent left it, beside the pointer that now matters. One
   *  session, one pointer, whoever is holding it. */
  const canvas = (interactive: boolean) => (
    <div
      className="browser-artifact__canvas"
      data-interactive={interactive && lease ? 'true' : undefined}
      role={interactive && lease ? 'application' : undefined}
      tabIndex={interactive && lease ? 0 : -1}
      onPointerMove={interactive ? onPointerMove : undefined}
      onPointerDown={interactive ? onPointerDown : undefined}
      onPointerUp={interactive ? onPointerUp : undefined}
      onWheel={interactive ? onWheel : undefined}
      onKeyDown={interactive ? (event) => onKey(event, 'down') : undefined}
      onKeyUp={interactive ? (event) => onKey(event, 'up') : undefined}
      onPaste={interactive ? onPaste : undefined}
      onContextMenu={interactive && lease ? (event) => event.preventDefault() : undefined}
      aria-label={strings.browserViewport || 'Live browser view'}
    >
      {frame ? <img src={`data:${frame.mimeType};base64,${frame.data}`} alt="" draggable={false} /> : (
        <div className="browser-artifact__waiting" role="status" aria-live="polite">
          <Spinner size="lg" />
          <span>{stream.error || strings.waitingFrame || 'Waiting for the browser image…'}</span>
        </div>
      )}
      {interactive && state !== 'user' && stream.cursor && frame ? (
        <span
          className={`browser-artifact__cursor ${stream.cursor.clicking ? 'is-clicking' : ''}`}
          style={{ left: `${(stream.cursor.x / frame.width) * 100}%`, top: `${(stream.cursor.y / frame.height) * 100}%` }}
          aria-hidden
        ><svg width="28" height="34" viewBox="0 0 28 34"><path d="M2 2l19 15-9 2 5 10-5 2-5-10-5 6z" /></svg></span>
      ) : null}
      <div className={`browser-artifact__activity ${interactive && action ? 'has-action' : ''}`}>
        <span className="browser-artifact__dot" data-tone={status.tone} aria-hidden />
        <span className="sr-only">{status.label}</span>
        {/* Only the surface you are actually working on gets the running commentary. On the thumbnail a
            line of action copy is the loudest thing in the transcript, and it says less than the dot. */}
        {interactive && action ? <span className="truncate">{action}</span> : null}
      </div>
    </div>
  );

  /** One control for who is driving, in the same shape on both surfaces. */
  const controlAction = (): ReactNode => state === 'user' && lease
    ? <Button variant="accent" icon={ShieldCheck} onClick={() => { void releaseControl(); }} disabled={pending !== null}>{strings.returnToAgent || 'Return to agent'}</Button>
    : state === 'user'
      ? <Button variant="ghost" icon={Hand} disabled>{strings.controlledElsewhere || 'Controlled in another window'}</Button>
      : <Button variant="ghost" icon={Hand} onClick={() => { void takeControl(); }} disabled={pending !== null || stream.closed}>{strings.takeControl || 'Take control'}</Button>;
  const siteLabel = (className = ''): ReactNode => (
    <span className={`browser-artifact__site ${className}`.trim()}>
      {data?.favicon ? <img className="browser-artifact__site-icon" src={data.favicon} alt="" /> : null}
      <span className="browser-artifact__site-text">{site || strings.noAddress || 'No address yet'}</span>
    </span>
  );

  if (!data) return <div className="browser-artifact__fallback">{artifact.fallback}</div>;

  return (
    <section
      className="browser-artifact"
      style={aspectStyle}
      data-expanded={expanded ? 'true' : undefined}
      aria-hidden={expanded ? true : undefined}
      aria-label={strings.sessionTitle || 'Browser session'}
    >
      {/* The thumbnail is the control that opens the canvas: one target, no chrome around it. */}
      <button type="button" className="browser-artifact__tile" onClick={() => setExpanded(true)} aria-label={strings.enlarge || 'Enlarge browser'}>
        {canvas(false)}
        <span className="browser-artifact__expand" aria-hidden><Expand size={13} /></span>
      </button>
      <div className="mt-1.5 flex items-center gap-2 text-caption text-muted-foreground">
        <span className="min-w-0 flex-1">{siteLabel('browser-artifact__site--compact')}</span>
        {controlAction()}
      </div>

      {expanded ? (
        <CanvasOverlay label={title} aspect={frameAspect} onClose={() => setExpanded(false)}>
          {canvas(true)}
          <GlassButton icon={X} label={strings.closeView || 'Close view'} onClick={() => setExpanded(false)} className="browser-artifact__dismiss" />
          {/* One bottom column, so the narration and the controls stack without either one being placed
              against a guessed offset of the other — which is what breaks first when the pill wraps on a
              phone. The column itself lets the pointer through; only the controls take it back. */}
          <div className="browser-artifact__dock">
            {/* One persistent region, so a question that arrives while the canvas is already open is
                announced rather than appearing silently behind it. */}
            <span className="sr-only" role="status" aria-live="polite">{waiting ? waiting.label : ''}</span>
            {visibleSpeech ? (
              <p className="browser-artifact__narration" role="status" aria-live="polite" aria-atomic="true">
                {/* Whose words these are, in one mark rather than a line of copy explaining it. */}
                <MessageSquareText className="browser-artifact__narration-icon" size={13} aria-hidden />
                {/* The clamp lives on the inner box: a padded element clips its overflow at the PADDING
                    edge, so a third line paints into the bottom padding and is cut in half instead of
                    hidden. Padding out here, clamp in there. */}
                <span className="browser-artifact__narration-text">{visibleSpeech}</span>
                <button
                  type="button"
                  className="browser-artifact__narration-dismiss"
                  onClick={() => setSpeechHidden(true)}
                  aria-label={strings.dismissNarration || 'Dismiss agent message'}
                  title={strings.dismissNarration || 'Dismiss agent message'}
                >
                  <X size={12} aria-hidden />
                </button>
              </p>
            ) : null}
            {waiting ? (
              <button
                type="button"
                className="browser-artifact__question"
                onClick={() => { pendingReveal.current = waiting.reveal; setExpanded(false); }}
              >
                <MessageCircleQuestion size={15} aria-hidden />
                <span className="truncate">{waiting.label}</span>
              </button>
            ) : null}
            <div className="browser-artifact__controls">
              {lease ? (
                <>
                  <GlassButton icon={ArrowLeft} label={strings.back || 'Back'} onClick={() => shortcut('ArrowLeft', 'ArrowLeft', ['Alt'])} />
                  <GlassButton icon={ArrowRight} label={strings.forward || 'Forward'} onClick={() => shortcut('ArrowRight', 'ArrowRight', ['Alt'])} />
                  <GlassButton icon={RotateCw} label={strings.reload || 'Reload'} onClick={() => shortcut('r', 'KeyR', ['Control'])} />
                </>
              ) : null}
              {siteLabel()}
              {controlAction()}
              <GlassButton icon={Power} label={strings.closeSession || 'Close session'} tone="danger" onClick={() => setConfirmClose(true)} disabled={pending !== null || stream.closed} />
            </div>
          </div>
        </CanvasOverlay>
      ) : null}

      <ConfirmDialog
        open={confirmClose}
        title={strings.closeConfirmTitle || 'Close browser session?'}
        description={strings.closeConfirmDescription || 'The live view and tab will close. Your browser profile and sign-in data remain stored.'}
        confirmLabel={strings.closeSession || 'Close session'}
        confirmVariant="danger"
        pending={pending === 'close'}
        onConfirm={() => { void closeSession(); }}
        onClose={() => setConfirmClose(false)}
      />
    </section>
  );
}
