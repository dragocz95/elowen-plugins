/** The live preview: the REAL widget panel, mounted in its own shadow root inside the modal.
 *
 *  It is the same `ChatPanel` a visitor's browser runs — literally the same module the embeddable bundle is
 *  built from, with the same appearance value — so what an administrator sees here is what their visitors
 *  will see, and a control that does not change the preview is a control that does not work. Nothing about
 *  it is a picture or a mock-up, and nothing in it talks to a server: the panel is mounted, opened, and
 *  handed a look.
 *
 *  The panel positions itself `position: fixed` against whatever page it runs on. The stage below is a
 *  transform, which is what makes it the containing block for that — so the panel settles into the CORNER OF
 *  THE STAGE, exactly as it settles into a corner of a real page, and the stage's own size is what the panel
 *  clamps itself to. */

import { useEffect, useRef } from 'react';
import type { ChatbotLook } from '../src/appearanceContract';
import { detectLocale, widgetStrings } from '../embed-src/strings';
import { ChatPanel, appearanceViewportInset } from '../embed-src/chatPanel';

export function AppearancePreview({ look, label }: {
  look: ChatbotLook;
  label: string;
}) {
  const stage = useRef<HTMLDivElement | null>(null);
  const frame = useRef<HTMLDivElement | null>(null);
  const panel = useRef<ChatPanel | null>(null);
  /** The look the panel was mounted with. The mount effect must not re-run on every keystroke — that would
   *  tear the panel down and build it again — so it reads the current value through a ref instead. */
  const initial = useRef(look);

  useEffect(() => {
    const frameElement = frame.current;
    if (!frameElement) return;
    const strings = widgetStrings(detectLocale(document.documentElement.getAttribute('lang'), navigator.language));
    const instance = new ChatPanel({
      strings,
      look: initial.current,
      // The panel draws the visitor's own message itself; there is no conversation here to send it to.
      onVisitorMessage: () => undefined,
      onStop: () => undefined,
    });
    frameElement.appendChild(instance.host);
    instance.open();
    panel.current = instance;
    return () => {
      instance.destroy();
      panel.current = null;
    };
  }, []);

  // Every change redraws the panel. `applyAppearance` carries the conversation over, so the greeting's quick
  // buttons can be tried out and then restyled without the message they sent disappearing.
  useEffect(() => {
    panel.current?.applyAppearance(look);
  }, [look]);

  // The room the panel may take. Its own stylesheet clamps to `--cb-avail-w`/`--cb-avail-h`, whose default is
  // the visitor's viewport; the stage is this panel's viewport, so it states its own size instead.
  useEffect(() => {
    const stageElement = stage.current;
    const frameElement = frame.current;
    if (!stageElement || !frameElement) return;
    const measure = () => {
      const box = stageElement.getBoundingClientRect();
      const inset = appearanceViewportInset(look.appearance);
      panel.current?.host.style.setProperty('--cb-avail-w', `${Math.max(0, Math.round(box.width) - inset.width)}px`);
      panel.current?.host.style.setProperty('--cb-avail-h', `${Math.max(0, Math.round(box.height) - inset.height)}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stageElement);
    return () => observer.disconnect();
  }, [look.appearance]);

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      {/* A page, as far as the panel is concerned: a fixed height and a size the panel is clamped to. Taller
          than the widest panel a customer may configure, so the common case is shown at its real size. */}
      <div ref={stage} className="relative h-[38rem] w-full overflow-hidden rounded-xl border border-border bg-background">
        <div ref={frame} className="absolute inset-0 [transform:translateZ(0)]" />
      </div>
    </div>
  );
}
