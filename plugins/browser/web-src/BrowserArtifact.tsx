import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, Expand, Hand, MessageCircleQuestion, MessageSquareText, Power, RotateCw, ShieldCheck, X, type LucideIcon } from 'lucide-react';
import type { BrowserArtifactProps } from './runtime';
import { apiError, jsonRequest, runtime } from './runtime';
import { useBrowserStream } from './useBrowserStream';
import { useVncSurface, type VncTicketResult } from './VncSurface';

interface ArtifactData {
  browserSessionId: string;
  state: 'creating' | 'agent' | 'user' | 'closing' | 'closed' | 'error';
  title: string;
  url: string;
  favicon: string | null;
  lastAction: string | null;
}
interface Lease { leaseId: string; expiresAt: number; controlRevision: number }

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

/** The takeover lease belongs to this TAB, not to one mount of the card. The card is remounted whenever
 *  the transcript re-renders it — a plugin listing refresh, a reload — and a lease held only in component
 *  state died with the mount while the server kept honouring it: the same person was then told the
 *  session was controlled "in another window" until the orphaned lease expired. sessionStorage is
 *  per-tab, so a second tab still cannot adopt it — which is the guarantee the opaque token exists for. */
const leaseStorageKey = (sessionId: string): string => `elowen.browser.lease.${sessionId}`;
const rememberedLease = (sessionId: string): Lease | null => {
  try {
    const raw = window.sessionStorage.getItem(leaseStorageKey(sessionId));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<Lease>;
    if (typeof value.leaseId !== 'string' || typeof value.expiresAt !== 'number' || typeof value.controlRevision !== 'number') return null;
    return value.expiresAt > Date.now() ? { leaseId: value.leaseId, expiresAt: value.expiresAt, controlRevision: value.controlRevision } : null;
  } catch { return null; }
};
const rememberLease = (sessionId: string, lease: Lease | null): void => {
  try {
    if (lease) window.sessionStorage.setItem(leaseStorageKey(sessionId), JSON.stringify(lease));
    else window.sessionStorage.removeItem(leaseStorageKey(sessionId));
  } catch { /* storage denied: the lease then lives only as long as this mount, as before */ }
};

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
  const initialSessionId = data?.browserSessionId ?? '';
  const [lease, setLease] = useState<Lease | null>(() => (initialSessionId ? rememberedLease(initialSessionId) : null));
  /** A lease this mount adopted rather than claimed: it is checked with the server at once, below. */
  const adoptedLease = useRef<string | null>(lease?.leaseId ?? null);
  /** The control revision this card already answered with an automatic takeover, so a hand-off is claimed
   *  once and a refusal is never retried. */
  const autoClaimed = useRef<number | null>(null);
  const [speechHidden, setSpeechHidden] = useState(false);
  /** Where the one live canvas is parked: the thumbnail while the card is collapsed, the raised surface
   *  while it is open. The canvas node itself is never rebuilt, only reparented. */
  const [thumbSlot, setThumbSlot] = useState<HTMLElement | null>(null);
  const [overlaySlot, setOverlaySlot] = useState<HTMLElement | null>(null);
  const speechTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The transcript anchor. On a wide screen this element is lifted out of the flow and docked above the
   *  composer, which is why the surface has to be told how much room it takes. */
  const anchor = useRef<HTMLElement>(null);
  /** A host `reveal` waiting for this canvas to actually get out of the way — see the effect below. */
  const pendingReveal = useRef<(() => void) | null>(null);
  const sessionId = data?.browserSessionId ?? '';
  const title = data?.title || strings.sessionTitle || 'Browser session';
  const url = data?.url || '';
  const site = url ? siteName(url) : '';
  const favicon = stream.hasControlSnapshot ? stream.favicon : data?.favicon;
  const state = stream.closed ? 'closed' : lease ? 'user' : stream.hasControlSnapshot ? stream.control.state : data?.state ?? 'agent';
  const takeoverRequested = stream.control.state === 'agent' && stream.control.reason === 'requested';
  /** The agent handed this session over and is parked until it is handed back. The server keeps saying so
   *  through the claim — `handed_over` rather than a cleared reason — which is what separates "the agent
   *  is waiting on you" from a takeover a person started for their own reasons. */
  const agentAwaitingReturn = stream.control.state === 'user' && stream.control.reason === 'handed_over' && !!lease;
  /** What the agent is SAYING while you watch it browse (host API 14). The canvas covers the transcript,
   *  so without this the reply streams on underneath it. The host already bounds and clears the string —
   *  the plugin only decides whether there is anything to show. */
  const speech = (narration ?? '').trim();
  const visibleSpeech = speechHidden ? '' : speech;
  /** The app is waiting on an answer and this canvas is covering the card that takes it (host API 15).
   *  Nothing about the question crosses the boundary — a line to show and a way back. */
  const waiting = pendingInput ?? null;
  // A parked agent is a STATE, and it outranks whatever action it happened to finish before handing over:
  // that stale line would otherwise sit there reading as though the agent were still working.
  const action = agentAwaitingReturn
    ? strings.agentWaiting || 'The agent is waiting for you to return control'
    : stream.action
      ? `${strings[`action_${stream.action.kind}`] || stream.action.kind}${stream.action.target ? ` · ${stream.action.target}` : ''}`
      : takeoverRequested ? strings.waitingForUser || 'Waiting for user input' : data?.lastAction;

  useEffect(() => () => {
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
  useEffect(() => { if (sessionId) rememberLease(sessionId, lease); }, [lease, sessionId]);
  useEffect(() => {
    if (!lease) return;
    const beat = (adopted: boolean): void => {
      void runtime().api(inputPath(sessionId, 'heartbeat'), jsonRequest('POST', { leaseId: lease.leaseId }))
        .then((value) => {
          const next = value as { expiresAt?: number };
          if (typeof next.expiresAt === 'number') setLease((current) => current?.leaseId === lease.leaseId ? { ...current, expiresAt: next.expiresAt! } : current);
        })
        .catch(() => {
          // A transient failure must not drop a live takeover — but a remembered lease the server no
          // longer recognises is exactly that: no longer ours.
          if (adopted) setLease((current) => current?.leaseId === lease.leaseId ? null : current);
        });
    };
    if (adoptedLease.current === lease.leaseId) {
      adoptedLease.current = null;
      beat(true);
    }
    const interval = setInterval(() => beat(false), 20_000);
    return () => clearInterval(interval);
  }, [lease, sessionId]);
  useEffect(() => {
    if (!lease) return;
    const controlRevision = stream.control.controlRevision;
    if (controlRevision > lease.controlRevision || (controlRevision === lease.controlRevision && stream.control.state === 'agent')) {
      setLease((current) => current?.leaseId === lease.leaseId ? null : current);
    }
  }, [lease, stream.control.controlRevision, stream.control.state]);
  useEffect(() => {
    // The agent asking for control IS the hand-off. Making the person press "Take control" first only to
    // press "Return to agent" next asks them to accept something that was already given to them, so the
    // card claims the lease itself and offers the one control that is actually theirs to press.
    //
    // Once per control revision, and never retried: a refusal here means another window of this account
    // claimed the same hand-off first, and that window is the one driving. This card then shows what the
    // server reports — "Controlled in another window" — rather than fighting it for the lease.
    if (!sessionId || lease || stream.closed || !takeoverRequested) return;
    const revision = stream.control.controlRevision;
    if (autoClaimed.current === revision) return;
    autoClaimed.current = revision;
    let cancelled = false;
    void (async () => {
      try {
        const claimed = await runtime().api(inputPath(sessionId, 'takeover'), jsonRequest('POST')) as Lease | null;
        if (cancelled || !claimed || typeof claimed.leaseId !== 'string') return;
        setLease(claimed);
      } catch {
        // Deliberately silent. This claim is the card's own initiative, not something the reader asked
        // for, so a lost race must not raise an error toast at them.
      }
    })();
    return () => { cancelled = true; };
  }, [lease, sessionId, stream.closed, stream.control.controlRevision, takeoverRequested]);
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
    // Docked, this card floats over the end of the transcript, so the last turns ran underneath it and
    // their text was simply hidden. Publishing the measured height lets the transcript reserve exactly
    // that much at its end — measured rather than assumed, because the tile takes the live stream's
    // aspect ratio and a guess would be wrong on the first page with an unusual shape.
    const node = anchor.current;
    const surface = node?.closest<HTMLElement>('.chat-surface-full');
    if (!node || !surface) return;
    const docked = window.matchMedia('(min-width: 768px)');
    const publish = (): void => {
      // Expanded, the canvas is portalled to <body> and this anchor is hidden: it occupies nothing.
      if (!docked.matches || expanded) surface.style.removeProperty('--chat-dock-height');
      else surface.style.setProperty('--chat-dock-height', `${Math.ceil(node.getBoundingClientRect().height)}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(node);
    docked.addEventListener('change', publish);
    return () => {
      observer.disconnect();
      docked.removeEventListener('change', publish);
      surface.style.removeProperty('--chat-dock-height');
    };
  }, [expanded]);
  /** One connection for both surfaces. The canvas node is moved between the thumbnail and the expanded
   *  view rather than duplicated: a second view-only RFB connection was measured at +207 kB/s while
   *  scrolling, because the VNC server encodes the full framebuffer per client and cannot scale it down
   *  for a thumbnail a third of the width.
   *
   *  The ticket carries only who is asking. The owner may always reach into their own browser through
   *  the raised canvas; the takeover lease is the AGENT's signal to wait, not a gate on the human, and
   *  gating clicks on it once left a connection opened before the takeover dead until it happened to
   *  reconnect. */
  const mintTicket = useCallback(async (): Promise<VncTicketResult> => {
    if (!sessionId) return { kind: 'refused', reason: 'unavailable' };
    try {
      const issued = await runtime().api(
        inputPath(sessionId, 'vnc-ticket'),
        jsonRequest('POST'),
      ) as { url?: string; width?: number; height?: number } | null;
      if (typeof issued?.url !== 'string') return { kind: 'refused', reason: 'unavailable' };
      return { kind: 'ticket', url: issued.url, width: issued.width, height: issued.height };
    } catch (error) {
      // The host's API client carries the status through; 429 is the full room, and every other refusal
      // — no display yet, a host that cannot carry a socket, a session that closed — is one state as far
      // as the reader is concerned: there is no picture right now.
      const status = (error as { status?: number } | null)?.status;
      return { kind: 'refused', reason: status === 429 ? 'viewer_limit' : 'unavailable' };
    }
  }, [sessionId]);

  const vnc = useVncSurface({
    slot: expanded ? overlaySlot : thumbSlot,
    ticket: mintTicket,
    // The raised canvas is the working surface and always takes input; the thumbnail is a picture and
    // a button, so a stray wheel or key over the transcript never reaches the remote page.
    interactive: expanded,
    enabled: !!sessionId && !stream.closed,
  });
  const aspectStyle = vnc.aspect ? { '--browser-aspect': String(vnc.aspect) } as CSSProperties : undefined;
  /** Until the RFB handshake finishes there is nothing on the glass, so the card says so rather than
   *  showing an empty box that looks like a session which failed to start. */
  const painting = vnc.state === 'connected';

  /** What the glass says while it is not painting. The room being full is a state that resolves itself
   *  when a viewer leaves, so it reads as a condition rather than as a failure. */
  const connectingLabel = vnc.state === 'viewer_limit'
    ? strings.viewerLimit || 'Too many viewers'
    : vnc.state === 'failed'
      ? strings.disconnected || 'Disconnected'
      : vnc.state === 'unavailable'
        ? strings.liveViewUnavailable || 'The live view is unavailable'
        : strings.connectingImage || 'Connecting to the browser image…';

  const status = useMemo(() => {
    if (stream.closed || state === 'closed') return { tone: 'muted' as const, label: strings.closed || 'Closed' };
    // The viewer limit is a property of the FRAMEBUFFER connections now, so it is the live view that
    // reports it rather than the event stream.
    if (vnc.state === 'viewer_limit') return { tone: 'warning' as const, label: strings.viewerLimit || 'Too many viewers' };
    if (stream.error || vnc.state === 'failed') return { tone: 'danger' as const, label: strings.disconnected || 'Disconnected' };
    if (state === 'user') return { tone: 'accent' as const, label: lease ? strings.youControl || 'You control' : strings.userControl || 'User control' };
    // A handoff the agent asked for is a STATE, not a passing action: the thumbnail carries no action
    // copy, so this is what turns its dot amber and tells a screen reader why the button is waiting.
    if (takeoverRequested) return { tone: 'warning' as const, label: strings.waitingForUser || 'Waiting for user input' };
    return { tone: stream.connected ? 'success' as const : 'warning' as const, label: stream.connected ? strings.agentControl || 'Agent control' : strings.connecting || 'Connecting' };
  }, [lease, state, stream.closed, stream.connected, stream.error, strings, takeoverRequested, vnc.state]);

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
  const navigate = (action: 'back' | 'forward' | 'reload'): void => {
    if (!lease) return;
    void run('navigation', () => runtime().api(inputPath(sessionId, 'navigation'), jsonRequest('POST', { leaseId: lease.leaseId, action })));
  };

  /** The live picture and the one mark that belongs on it: what the session is doing right now.
   *
   *  There are no input handlers here any more. noVNC binds the pointer and the keyboard to its OWN
   *  canvas inside this box and encodes them as RFB, which is the whole point — a native key reaches
   *  Chrome as a key rather than as something the renderer was told to pretend it saw. Attaching
   *  handlers here as well would send every gesture twice.
   *
   *  The agent's pointer is gone with them. It was drawn from the CDP events the agent's own clicks
   *  emitted, and the page now paints its real cursor into the framebuffer, so there is one pointer
   *  again instead of a synthetic arrow beside a real one. */
  const canvas = (interactive: boolean) => (
    <div
      className="browser-artifact__canvas"
      data-interactive={interactive ? 'true' : undefined}
      aria-label={strings.browserViewport || 'Live browser view'}
    >
      {/* Where the one noVNC canvas is parked while this surface is the visible one. Always rendered,
          because the client needs somewhere to mount before it can connect. */}
      <div className="browser-artifact__vnc-slot" ref={interactive ? setOverlaySlot : setThumbSlot} />
      {painting ? null : (
        <div className="browser-artifact__waiting" role="status" aria-live="polite">
          <Spinner size="lg" />
          <span>{connectingLabel}</span>
        </div>
      )}
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
    ? (
      <Button
        variant="accent"
        icon={ShieldCheck}
        // The pulse marks a session that is WAITING on this button, and only that. A takeover a person
        // started for their own reasons gets the same control without the animation.
        className={agentAwaitingReturn ? 'browser-artifact__return--waiting' : undefined}
        onClick={() => { void releaseControl(); }}
        disabled={pending !== null}
      >
        {strings.returnToAgent || 'Return to agent'}
      </Button>
    )
    : state === 'user'
      ? <Button variant="ghost" icon={Hand} disabled>{strings.controlledElsewhere || 'Controlled in another window'}</Button>
      : <Button variant="ghost" icon={Hand} onClick={() => { void takeControl(); }} disabled={pending !== null || stream.closed}>{strings.takeControl || 'Take control'}</Button>;
  const siteLabel = (className = ''): ReactNode => (
    <span className={`browser-artifact__site ${className}`.trim()}>
      {favicon ? <img className="browser-artifact__site-icon" src={favicon} alt="" /> : null}
      <span className="browser-artifact__site-text">{site || strings.noAddress || 'No address yet'}</span>
    </span>
  );

  if (!data) return <div className="browser-artifact__fallback">{artifact.fallback}</div>;

  return (
    <section
      ref={anchor}
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
        <CanvasOverlay label={title} aspect={vnc.aspect} onClose={() => setExpanded(false)}>
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
                  <GlassButton icon={ArrowLeft} label={strings.back || 'Back'} onClick={() => navigate('back')} disabled={pending !== null} />
                  <GlassButton icon={ArrowRight} label={strings.forward || 'Forward'} onClick={() => navigate('forward')} disabled={pending !== null} />
                  <GlassButton icon={RotateCw} label={strings.reload || 'Reload'} onClick={() => navigate('reload')} disabled={pending !== null} />
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
