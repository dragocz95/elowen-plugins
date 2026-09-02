import { useEffect, useRef, useState } from 'react';

interface BrowserFrame { data: string; mimeType: string; width: number; height: number; timestamp: number }
interface BrowserCursor { x: number; y: number; moving?: boolean; clicking?: boolean }
interface BrowserControl { state: 'agent' | 'user'; leaseId?: string; expiresAt?: number; reason?: string }
interface BrowserAction { kind: string; target?: string }
export interface BrowserStreamState {
  frame: BrowserFrame | null;
  cursor: BrowserCursor | null;
  control: BrowserControl;
  action: BrowserAction | null;
  connected: boolean;
  closed: boolean;
  error: string | null;
}

const initialState: BrowserStreamState = {
  frame: null,
  cursor: null,
  control: { state: 'agent' },
  action: null,
  connected: false,
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
      if (frame.event === 'cursor' && typeof data.x === 'number' && typeof data.y === 'number') {
        setState((value) => ({ ...value, cursor: { x: data.x as number, y: data.y as number, moving: data.moving === true } }));
        return;
      }
      if (frame.event === 'action') {
        const action = typeof data.action === 'string'
          ? { kind: data.action, ...(typeof data.target === 'string' ? { target: data.target } : {}) }
          : null;
        setState((value) => ({
          ...value,
          action,
          cursor: value.cursor && data.action === 'click' ? { ...value.cursor, clicking: true } : value.cursor,
        }));
        if (data.action === 'click') setTimeout(() => setState((value) => ({ ...value, cursor: value.cursor ? { ...value.cursor, clicking: false } : null })), 420);
        return;
      }
      if (frame.event === 'control' || frame.event === 'session') {
        const lease = frame.event === 'session' ? object(data.lease) : null;
        const controlState = data.state === 'user' ? 'user' : 'agent';
        const rawExpiresAt = lease?.expiresAt ?? data.expiresAt;
        setState((value) => ({
          ...value,
          connected: true,
          closed: false,
          error: null,
          control: {
            state: controlState,
            expiresAt: typeof rawExpiresAt === 'number' ? rawExpiresAt : undefined,
            reason: typeof data.reason === 'string' ? data.reason : undefined,
          },
        }));
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
