import { useEffect, useRef, useState } from 'react';

/** The session's STATE, over Server-Sent Events. Not its picture.
 *
 *  Pixels arrive on the live view socket as RFB, decoded by noVNC onto a canvas this never touches. What
 *  is left here is everything the card has to know that is not in the framebuffer: who holds control,
 *  what the agent just did, the site's favicon, and the end of the session. */

interface BrowserControl { state: 'agent' | 'user'; expiresAt?: number; reason?: string; controlRevision: number }
interface BrowserAction { kind: string; target?: string }

export interface BrowserStreamState {
  favicon: string | null;
  control: BrowserControl;
  action: BrowserAction | null;
  connected: boolean;
  hasControlSnapshot: boolean;
  closed: boolean;
  error: string | null;
  /** The server named why it would not carry this session's events. Kept as a state rather than a broken
   *  connection so the reconnect below can back off instead of hammering a failure every half second. */
  rejected: 'stream_failed' | null;
}

const initialState: BrowserStreamState = {
  favicon: null,
  control: { state: 'agent', controlRevision: 0 },
  action: null,
  connected: false,
  hasControlSnapshot: false,
  closed: false,
  error: null,
  rejected: null,
};

interface SseFrame { event: string; data: string }
function parseSse(buffer: string): { frames: SseFrame[]; rest: string } {
  const frames: SseFrame[] = [];
  let index: number;
  while ((index = buffer.indexOf('\n\n')) >= 0) {
    const block = buffer.slice(0, index);
    buffer = buffer.slice(index + 2);
    let event = 'message';
    let data = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data += `${data ? '\n' : ''}${line.slice(5).replace(/^ /, '')}`;
    }
    if (data) frames.push({ event, data });
  }
  return { frames, rest: buffer };
}

const object = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown>
  : null;

/** A favicon is a data URL the server read off the page, so it is bounded and shape-checked before it is
 *  ever put in an `src`. */
const asFavicon = (value: unknown): string | null =>
  typeof value === 'string' && value.length <= 40 * 1024 && /^data:image\//i.test(value) ? value : null;

export function useBrowserStream(path: string | undefined): BrowserStreamState {
  const [state, setState] = useState(initialState);
  const generation = useRef(0);

  useEffect(() => {
    if (!path) return;
    const current = ++generation.current;
    const controller = new AbortController();
    let retry = 500;
    let terminal = false;
    let rejected: BrowserStreamState['rejected'] = null;

    const apply = (frame: SseFrame): void => {
      let raw: unknown;
      try { raw = JSON.parse(frame.data); } catch { return; }
      const data = object(raw);
      if (!data) return;
      if (frame.event === 'favicon') {
        setState((value) => ({ ...value, favicon: data.favicon === null ? null : asFavicon(data.favicon) ?? value.favicon }));
        return;
      }
      if (frame.event === 'action') {
        const action = typeof data.action === 'string'
          ? { kind: data.action, ...(typeof data.target === 'string' ? { target: data.target } : {}) }
          : null;
        setState((value) => ({ ...value, action }));
        return;
      }
      if (frame.event === 'control' || frame.event === 'session') {
        const lease = frame.event === 'session' ? object(data.lease) : null;
        const controlState = data.state === 'user' ? 'user' : 'agent';
        const rawExpiresAt = lease?.expiresAt ?? data.expiresAt;
        const rawRevision = data.controlRevision;
        setState((value) => {
          const controlRevision = typeof rawRevision === 'number' ? rawRevision : value.control.controlRevision;
          // An older snapshot cannot undo a newer control change: the opening frame of a reconnect races
          // with whatever happened while the stream was down, and the revision is what orders them.
          if (controlRevision < value.control.controlRevision) return value;
          return {
            ...value,
            connected: true,
            hasControlSnapshot: true,
            closed: false,
            error: null,
            favicon: data.favicon === null ? null : asFavicon(data.favicon) ?? value.favicon,
            control: {
              state: controlState,
              expiresAt: typeof rawExpiresAt === 'number' ? rawExpiresAt : undefined,
              reason: typeof data.reason === 'string' ? data.reason : undefined,
              controlRevision,
            },
          };
        });
        return;
      }
      if (frame.event === 'rejected') {
        rejected = 'stream_failed';
        setState((value) => ({ ...value, connected: false, rejected, error: typeof data.message === 'string' ? data.message : null }));
        return;
      }
      if (frame.event === 'closed') {
        terminal = true;
        setState((value) => ({ ...value, connected: false, closed: true }));
      }
    };

    const connect = async (): Promise<void> => {
      while (!controller.signal.aborted && !terminal) {
        try {
          const response = await fetch(`/api${path}`, { credentials: 'same-origin', signal: controller.signal });
          if (!response.ok || !response.body) throw new Error(`Browser stream returned ${response.status}`);
          retry = 500;
          rejected = null;
          setState((value) => ({ ...value, connected: true, error: null, rejected: null }));
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          while (!controller.signal.aborted && !terminal) {
            const chunk = await reader.read();
            if (chunk.done) break;
            buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, '\n');
            const parsed = parseSse(buffer);
            buffer = parsed.rest;
            for (const frame of parsed.frames) apply(frame);
          }
          if (controller.signal.aborted || terminal) return;
          setState((value) => value.closed ? value : { ...value, connected: false });
        } catch (error) {
          if (controller.signal.aborted) return;
          setState((value) => ({ ...value, connected: false, error: error instanceof Error ? error.message : String(error) }));
        }
        if (rejected) retry = Math.max(retry, 10_000);
        await new Promise((resolve) => setTimeout(resolve, retry));
        retry = Math.min(rejected ? 30_000 : 5_000, retry * 2);
      }
    };

    setState(initialState);
    void connect();
    return () => { controller.abort(); if (generation.current === current) generation.current += 1; };
  }, [path]);

  return state;
}
