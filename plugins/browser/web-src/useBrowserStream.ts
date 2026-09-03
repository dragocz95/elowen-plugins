import { useEffect, useRef, useState } from 'react';

interface BrowserFrame { data: string; mimeType: string; width: number; height: number; timestamp: number }
interface BrowserCursor { x: number; y: number; moving?: boolean; clicking?: boolean }
interface BrowserControl { state: 'agent' | 'user'; expiresAt?: number; reason?: string; controlRevision: number }
interface BrowserAction { kind: string; target?: string }
export interface BrowserStreamState {
  frame: BrowserFrame | null;
  cursor: BrowserCursor | null;
  favicon: string | null;
  control: BrowserControl;
  action: BrowserAction | null;
  connected: boolean;
  hasControlSnapshot: boolean;
  closed: boolean;
  error: string | null;
}

const initialState: BrowserStreamState = {
  frame: null,
  cursor: null,
  favicon: null,
  control: { state: 'agent', controlRevision: 0 },
  action: null,
  connected: false,
  hasControlSnapshot: false,
  closed: false,
  error: null,
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

export function useBrowserStream(path: string | undefined): BrowserStreamState {
  const [state, setState] = useState(initialState);
  const generation = useRef(0);

  useEffect(() => {
    if (!path) return;
    const current = ++generation.current;
    const controller = new AbortController();
    let retry = 500;
    let terminal = false;

    const apply = (frame: SseFrame): void => {
      let raw: unknown;
      try { raw = JSON.parse(frame.data); } catch { return; }
      const data = object(raw);
      if (!data) return;
      if (frame.event === 'frame' && typeof data.data === 'string') {
        setState((value) => ({
          ...value,
          frame: {
            data: data.data as string,
            mimeType: typeof data.mimeType === 'string' ? data.mimeType : 'image/jpeg',
            width: typeof data.width === 'number' ? data.width : 1280,
            height: typeof data.height === 'number' ? data.height : 800,
            timestamp: typeof data.timestamp === 'number' ? data.timestamp : Date.now(),
          },
          connected: true,
          error: null,
        }));
        return;
      }
      if (frame.event === 'favicon') {
        if (data.favicon === null) setState((value) => ({ ...value, favicon: null }));
        else if (typeof data.favicon === 'string' && data.favicon.length <= 40 * 1024 && /^data:image\//i.test(data.favicon)) {
          setState((value) => ({ ...value, favicon: data.favicon as string }));
        }
        return;
      }
      if (frame.event === 'cursor' && data.cleared === true) {
        // The page the pointer was on is gone (a navigation, another tab): drawing the old point over a
        // new document would put the agent's arrow somewhere it has never been.
        setState((value) => ({ ...value, cursor: null }));
        return;
      }
      if (frame.event === 'cursor' && typeof data.x === 'number' && typeof data.y === 'number') {
        setState((value) => ({ ...value, cursor: { x: data.x as number, y: data.y as number, moving: data.moving === true } }));
        return;
      }
      if (frame.event === 'action') {
        const action = typeof data.action === 'string'
          ? { kind: data.action, ...(typeof data.target === 'string' ? { target: data.target } : {}) }
          : null;
        // An action that reports WHERE it acted is itself a pointer position, and the authoritative one:
        // the `cursor` events before a click are the animated approach, this is where it landed. Reading
        // it means a viewer that missed those frames — because it connected mid-move, or because the
        // stream dropped them — still has a pointer to draw instead of none.
        const at = typeof data.x === 'number' && typeof data.y === 'number' ? { x: data.x, y: data.y } : null;
        setState((value) => ({
          ...value,
          action,
          cursor: at
            ? { ...value.cursor, ...at, moving: false, clicking: data.action === 'click' }
            : value.cursor && data.action === 'click' ? { ...value.cursor, clicking: true } : value.cursor,
        }));
        if (data.action === 'click') setTimeout(() => {
          if (generation.current !== current) return;
          setState((value) => ({ ...value, cursor: value.cursor ? { ...value.cursor, clicking: false } : null }));
        }, 420);
        return;
      }
      if (frame.event === 'control' || frame.event === 'session') {
        const lease = frame.event === 'session' ? object(data.lease) : null;
        const controlState = data.state === 'user' ? 'user' : 'agent';
        const rawExpiresAt = lease?.expiresAt ?? data.expiresAt;
        const rawRevision = data.controlRevision;
        // The opening frame replays where the agent left its pointer, so a viewer that joins between two
        // agent moves starts with one rather than waiting for the next move to reveal it.
        const seeded = object(data.cursor);
        setState((value) => {
          const controlRevision = typeof rawRevision === 'number' ? rawRevision : value.control.controlRevision;
          if (controlRevision < value.control.controlRevision) return value;
          return {
            ...value,
            connected: true,
            hasControlSnapshot: true,
            closed: false,
            error: null,
            cursor: value.cursor ?? (typeof seeded?.x === 'number' && typeof seeded?.y === 'number'
              ? { x: seeded.x, y: seeded.y, moving: false }
              : null),
            favicon: data.favicon === null
              ? null
              : typeof data.favicon === 'string' && data.favicon.length <= 40 * 1024 && /^data:image\//i.test(data.favicon)
                ? data.favicon
                : value.favicon,
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
          setState((value) => ({ ...value, connected: true, error: null }));
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
        await new Promise((resolve) => setTimeout(resolve, retry));
        retry = Math.min(5_000, retry * 2);
      }
    };

    setState(initialState);
    void connect();
    return () => { controller.abort(); if (generation.current === current) generation.current += 1; };
  }, [path]);

  return state;
}
