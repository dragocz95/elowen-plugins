import { useEffect, useRef, useState } from 'react';
import { runtime } from './runtime';

/** The docked card's picture, on the screens where the live view is not one. Below the width at which
 *  the card floats above the composer it sits inline in the transcript at the column's full width, and a
 *  live VNC connection there is whole-framebuffer video for a picture a few hundred pixels wide — measured
 *  at 5.7 to 15 Mbit/s while the remote page moves, which is what made the transcript stutter on a phone.
 *  It is also what took pinch-zoom away from the page: noVNC attaches its own gesture handlers to its
 *  canvas the moment it connects and calls `preventDefault()` on touch, whichever surface the canvas is
 *  parked in.
 *
 *  So a narrow screen draws the still this plugin already serves its account panel, and the live view is
 *  something the reader opens.
 *
 *  TWO numbers, and both are the server's, because the questions they answer are different: `refreshMs`
 *  is how often to ask (the still route's own cache window) and `liveForMs` is how long the answer in hand
 *  stays good — a capture takes time and cannot be cancelled, so a picture that is merely slow must not be
 *  called a dead one, and one that has stopped must not keep reading as the session. The bundle carries
 *  neither: it asks when the server said to, and it stops showing the picture when the server's own bound
 *  has passed.
 *
 *  Three things stop the timer, because every ask costs the session's Chrome a rasterization: the card
 *  leaving the narrow layout, the session ending, and the card no longer being what the reader is looking
 *  at — covered by the raised canvas, or sitting in a hidden document. */

/** The still route's answer. Nothing here is trusted: the picture is shape-checked below, and a number is
 *  used only when it is one a timer can take. */
interface StillResponse {
  dataUrl?: unknown;
  width?: unknown;
  height?: unknown;
  refreshMs?: unknown;
  liveForMs?: unknown;
}

export interface StillPreview {
  /** The picture that arrived, or null when there is none to draw. */
  dataUrl: string | null;
  /** The still's own shape, so the card's box takes the picture's instead of a guessed one. */
  aspect: number | null;
  /** `loading` until a picture has arrived, `ready` while one is being renewed, `stalled` when the card
   *  has no picture it can stand behind — an ask that failed, a capture the server could not take, or an
   *  answer that went past the bound the server named. */
  state: 'loading' | 'ready' | 'stalled';
}

/** What is on the glass. The session it belongs to travels with it, so a card reused for another session
 *  cannot show the first one's screen, and `receivedAt` is what the server's bound is measured against. */
interface HeldStill extends StillPreview {
  sessionId: string;
  receivedAt: number;
}

const NOTHING_YET: HeldStill = { sessionId: '', dataUrl: null, aspect: null, state: 'loading', receivedAt: 0 };

/** The picture has to be an inline image, exactly like the session's favicon: this is the one thing the
 *  route hands over that came off a page, and it reaches an `src`. */
const asImage = (value: unknown): string | null => (typeof value === 'string' && /^data:image\//i.test(value) ? value : null);
const asNumber = (value: unknown): number => (typeof value === 'number' && value > 0 ? value : 0);

/** Whether this document is on screen. The panel asks the same question of its own poll; here it is kept
 *  with the timer that has to stop, rather than inherited from a query client a host is free to configure
 *  the other way. */
function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
  useEffect(() => {
    const onChange = (): void => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  return visible;
}

export function useStillPreview(sessionId: string, active: boolean): StillPreview {
  const [held, setHeld] = useState<HeldStill>(NOTHING_YET);
  const visible = useDocumentVisible();
  /** The bound the server named, kept OUTSIDE the effect: it outlives every pause, so a picture that sat
   *  on the glass while the card was covered or the tab was hidden is judged by the same bound when the
   *  reader comes back to it rather than being shown as freshly taken. */
  const liveForMs = useRef(0);

  useEffect(() => {
    if (!active || !sessionId || !visible) return;
    let disposed = false;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    /** The window the server named, and zero until it has said so. A FIRST ask that fails before then
     *  leaves the card on its "no picture yet" placeholder rather than on a cadence of this bundle's own
     *  invention, and the next activation — the reader returns to the tab, or opens the card — asks again. */
    let windowMs = 0;

    /** A picture the server would no longer stand behind stops being shown, whatever brought the reader
     *  back to the card and whether or not the ask that was supposed to replace it ever came back. */
    const expire = (): void => {
      setHeld((current) => {
        if (!current.dataUrl || nowWithin(current.receivedAt, liveForMs.current)) return current;
        return { ...current, dataUrl: null, aspect: null, state: 'stalled' };
      });
    };

    const ask = async (): Promise<void> => {
      inFlight = true;
      try {
        const response = await runtime().api(
          `/plugins/browser/api/thumbnail?sessionId=${encodeURIComponent(sessionId)}`,
        ) as StillResponse | null;
        if (disposed) return;
        if (asNumber(response?.refreshMs)) windowMs = asNumber(response?.refreshMs);
        if (asNumber(response?.liveForMs)) liveForMs.current = asNumber(response?.liveForMs);
        const image = asImage(response?.dataUrl);
        const width = typeof response?.width === 'number' ? response.width : 0;
        const height = typeof response?.height === 'number' ? response.height : 0;
        if (image) {
          setHeld({ sessionId, dataUrl: image, aspect: width > 0 && height > 0 ? width / height : null, state: 'ready', receivedAt: Date.now() });
        } else {
          // A completed answer with no picture. Before the first one that is the card's own "no picture
          // yet" — the route says the same for a page mid-navigation and a capture that has not landed.
          // Once a picture HAS been arriving it is the server saying it cannot photograph this page, and
          // the still goes rather than staying on the glass as the session's screen.
          setHeld((current) => (current.sessionId === sessionId && current.dataUrl
            ? { ...current, dataUrl: null, aspect: null, state: 'stalled' }
            : { sessionId, dataUrl: null, aspect: null, state: 'loading', receivedAt: Date.now() }));
        }
      } catch {
        // The ask itself failed: there is no picture this card can stand behind any more, and saying so
        // beats leaving the last one up as if the session were still being watched.
        if (disposed) return;
        setHeld({ sessionId, dataUrl: null, aspect: null, state: 'stalled', receivedAt: Date.now() });
      } finally {
        inFlight = false;
      }
    };

    /** The cadence, scheduled from HERE rather than from the answer: a request that never settles must not
     *  be able to stop the preview from asking again, which is exactly how a still goes quietly stale. An
     *  ask already in flight is not stacked on top of. */
    const beat = (): void => {
      if (disposed) return;
      expire();
      if (!inFlight) void ask();
      timer = setTimeout(beat, windowMs);
    };

    void (async () => {
      await ask();
      if (disposed || windowMs <= 0) return;
      timer = setTimeout(beat, windowMs);
    })();

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  }, [active, sessionId, visible]);

  const shown = held.sessionId === sessionId ? held : NOTHING_YET;
  // Judged here as well as on the beat: the card may be coming back from a pause that no timer survived,
  // and the one thing that must never happen is a picture of the past reading as the session's screen.
  if (shown.dataUrl && !nowWithin(shown.receivedAt, liveForMs.current)) {
    return { dataUrl: null, aspect: null, state: 'stalled' };
  }
  return { dataUrl: shown.dataUrl, aspect: shown.aspect, state: shown.state };
}

/** Within the bound the server named. A bound of zero means it has not named one yet, which is the case
 *  only before any answer has arrived — and then there is no picture to judge. */
function nowWithin(receivedAt: number, liveForMs: number): boolean {
  return liveForMs <= 0 || Date.now() - receivedAt <= liveForMs;
}
