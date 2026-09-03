import type { AxElementRef, BrowserActionEvent, CDPSessionLike } from './types.js';
import { elementCenter, requireDomNode } from './accessibility.js';

export type UserInputEvent =
  | { type: 'pointer'; action: 'move' | 'down' | 'up'; x: number; y: number; surfaceWidth: number; surfaceHeight: number; button?: 'left' | 'middle' | 'right'; modifiers?: string[] }
  | { type: 'wheel'; x: number; y: number; surfaceWidth: number; surfaceHeight: number; deltaX: number; deltaY: number; modifiers?: string[] }
  | { type: 'key'; action: 'down' | 'up'; key: string; code?: string; modifiers?: string[] }
  | { type: 'paste'; text: string };

const inputObject = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Browser input event must be an object.');
  return value as Record<string, unknown>;
};
const finite = (value: unknown, name: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Browser input ${name} is invalid.`);
  return value;
};
const ALLOWED_MODIFIERS = new Set(['Alt', 'Control', 'Meta', 'Shift']);
const modifiersValue = (value: unknown): string[] | undefined => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 4 || value.some((item) => typeof item !== 'string' || !ALLOWED_MODIFIERS.has(item))) {
    throw new Error('Browser input modifiers are invalid.');
  }
  return value as string[];
};

export function parseUserInputEvents(value: unknown): UserInputEvent[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 50) throw new Error('Browser input batches must contain 1 to 50 events.');
  return value.map((raw) => {
    const event = inputObject(raw);
    if (event.type === 'paste') {
      if (typeof event.text !== 'string' || event.text.length > 20_000) throw new Error('Browser paste value is invalid.');
      return { type: 'paste', text: event.text };
    }
    if (event.type === 'key') {
      if ((event.action !== 'down' && event.action !== 'up') || typeof event.key !== 'string' || event.key.length > 32) throw new Error('Browser key event is invalid.');
      if (event.code !== undefined && (typeof event.code !== 'string' || event.code.length > 64)) throw new Error('Browser key code is invalid.');
      return { type: 'key', action: event.action, key: event.key, code: event.code, modifiers: modifiersValue(event.modifiers) };
    }
    if (event.type === 'pointer') {
      if (event.action !== 'move' && event.action !== 'down' && event.action !== 'up') throw new Error('Browser pointer action is invalid.');
      if (event.button !== undefined && event.button !== 'left' && event.button !== 'middle' && event.button !== 'right') throw new Error('Browser pointer button is invalid.');
      return {
        type: 'pointer', action: event.action, x: finite(event.x, 'x'), y: finite(event.y, 'y'),
        surfaceWidth: finite(event.surfaceWidth, 'surfaceWidth'), surfaceHeight: finite(event.surfaceHeight, 'surfaceHeight'),
        button: event.button, modifiers: modifiersValue(event.modifiers),
      };
    }
    if (event.type === 'wheel') {
      return {
        type: 'wheel', x: finite(event.x, 'x'), y: finite(event.y, 'y'),
        surfaceWidth: finite(event.surfaceWidth, 'surfaceWidth'), surfaceHeight: finite(event.surfaceHeight, 'surfaceHeight'),
        deltaX: finite(event.deltaX, 'deltaX'), deltaY: finite(event.deltaY, 'deltaY'), modifiers: modifiersValue(event.modifiers),
      };
    }
    throw new Error('Browser input event type is invalid.');
  });
}

const MODIFIERS: Record<string, number> = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };
const BUTTONS = new Set(['left', 'middle', 'right']);
const SAFE_NAMED_KEYS = new Set([
  'Enter', 'Tab', 'Escape', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Home', 'End', 'PageUp', 'PageDown', 'Space', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
]);

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

function modifierMask(modifiers: readonly string[] | undefined): number {
  if (!modifiers) return 0;
  return modifiers.reduce((mask, modifier) => {
    const bit = MODIFIERS[modifier];
    if (bit === undefined) throw new Error(`Unsupported modifier: ${modifier}`);
    return mask | bit;
  }, 0);
}

function validateKey(key: string): string {
  if (key.length === 1 || SAFE_NAMED_KEYS.has(key)) return key === 'Space' ? ' ' : key;
  throw new Error(`Unsupported key: ${key}`);
}

const inferredCode = (key: string): string | undefined => {
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  if (SAFE_NAMED_KEYS.has(key)) return key;
  return undefined;
};

function keyDownParams(key: string, normalized: string, modifiers: readonly string[] | undefined, code?: string): Record<string, unknown> {
  const mask = modifierMask(modifiers);
  const commandKey = modifiers?.some((modifier) => modifier === 'Control' || modifier === 'Meta') === true;
  const insertsText = normalized.length === 1 && !modifiers?.some((modifier) => modifier === 'Alt' || modifier === 'Control' || modifier === 'Meta');
  return {
    type: 'keyDown', key: normalized, modifiers: mask,
    ...(code || inferredCode(key) ? { code: code || inferredCode(key) } : {}),
    ...(insertsText ? { text: normalized } : {}),
    ...(commandKey && normalized.toLowerCase() === 'a' ? { commands: ['selectAll'] } : {}),
  };
}

export class InputRateLimiter {
  private windowStartedAt = 0;
  private count = 0;

  constructor(private readonly limitPerSecond: () => number, private readonly now: () => number = () => Date.now()) {}

  consume(count = 1): void {
    const now = this.now();
    if (now - this.windowStartedAt >= 1000) {
      this.windowStartedAt = now;
      this.count = 0;
    }
    if (this.count + count > this.limitPerSecond()) throw new Error('Browser input rate limit exceeded.');
    this.count += count;
  }
}

export class InputController {
  private cursor = { x: 0, y: 0 };

  constructor(
    private cdp: CDPSessionLike,
    private readonly viewport: () => { width: number; height: number },
    private readonly emit: (event: BrowserActionEvent) => void,
    private readonly limiter: InputRateLimiter,
  ) {}

  replaceCdp(cdp: CDPSessionLike): void { this.cdp = cdp; }

  async click(element: AxElementRef): Promise<void> {
    const point = await elementCenter(this.cdp, element);
    const steps = 6;
    for (let step = 1; step <= steps; step += 1) {
      const x = this.cursor.x + ((point.x - this.cursor.x) * step) / steps;
      const y = this.cursor.y + ((point.y - this.cursor.y) * step) / steps;
      await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
      this.emit({ kind: 'cursor', data: { x, y, moving: step < steps } });
    }
    await this.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    this.cursor = point;
    this.emit({ kind: 'action', data: { action: 'click', target: element.name || element.role, x: point.x, y: point.y } });
  }

  async fill(element: AxElementRef, value: string): Promise<void> {
    if (!['textbox', 'searchbox', 'combobox', 'spinbutton'].includes(element.role)) {
      throw new Error(`Element ${element.ref} is not fillable.`);
    }
    if (value.length > 20_000) throw new Error('Browser fill value is too large.');
    await this.cdp.send('DOM.focus', { backendNodeId: requireDomNode(element) });
    await this.cdp.send('Input.dispatchKeyEvent', keyDownParams('a', 'a', ['Control'], 'KeyA'));
    await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2 });
    await this.cdp.send('Input.insertText', { text: value });
    this.emit({ kind: 'action', data: { action: 'fill', target: element.name || element.role } });
  }

  async pressKey(key: string, modifiers?: string[]): Promise<void> {
    const normalized = validateKey(key);
    const mask = modifierMask(modifiers);
    const code = inferredCode(key);
    await this.cdp.send('Input.dispatchKeyEvent', keyDownParams(key, normalized, modifiers, code));
    await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: normalized, modifiers: mask, ...(code ? { code } : {}) });
    this.emit({ kind: 'action', data: { action: 'key', key: normalized, modifiers: modifiers ?? [] } });
  }

  async scroll(deltaX: number, deltaY: number): Promise<void> {
    const viewport = this.viewport();
    const safeX = clamp(deltaX, -viewport.width * 4, viewport.width * 4);
    const safeY = clamp(deltaY, -viewport.height * 4, viewport.height * 4);
    const x = viewport.width / 2;
    const y = viewport.height / 2;
    await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: safeX, deltaY: safeY });
    this.cursor = { x, y };
    // The wheel IS dispatched at the middle of the viewport, so the action reports the point it acted on
    // exactly as a click does. Without it a scroll was the one agent action a viewer could not place.
    this.emit({ kind: 'action', data: { action: 'scroll', deltaX: safeX, deltaY: safeY, x, y } });
  }

  async dispatchUserBatch(events: readonly UserInputEvent[]): Promise<void> {
    if (events.length === 0 || events.length > 50) throw new Error('Browser input batches must contain 1 to 50 events.');
    this.limiter.consume(events.length);
    for (const event of events) await this.dispatchUserEvent(event);
  }

  private async dispatchUserEvent(event: UserInputEvent): Promise<void> {
    if (event.type === 'paste') {
      if (event.text.length > 20_000) throw new Error('Browser paste value is too large.');
      await this.cdp.send('Input.insertText', { text: event.text });
      this.emit({ kind: 'action', data: { action: 'paste' } });
      return;
    }
    if (event.type === 'key') {
      const key = validateKey(event.key);
      const code = event.code || inferredCode(event.key);
      await this.cdp.send('Input.dispatchKeyEvent', event.action === 'down'
        ? keyDownParams(event.key, key, event.modifiers, code)
        : { type: 'keyUp', key, ...(code ? { code } : {}), modifiers: modifierMask(event.modifiers) });
      return;
    }
    const viewport = this.viewport();
    if (!Number.isFinite(event.surfaceWidth) || !Number.isFinite(event.surfaceHeight) || event.surfaceWidth <= 0 || event.surfaceHeight <= 0) {
      throw new Error('Browser input surface dimensions are invalid.');
    }
    const x = clamp((event.x / event.surfaceWidth) * viewport.width, 0, viewport.width);
    const y = clamp((event.y / event.surfaceHeight) * viewport.height, 0, viewport.height);
    if (event.type === 'wheel') {
      await this.cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseWheel', x, y, deltaX: clamp(event.deltaX, -4000, 4000), deltaY: clamp(event.deltaY, -4000, 4000),
        modifiers: modifierMask(event.modifiers),
      });
      return;
    }
    const button = event.button ?? 'left';
    if (!BUTTONS.has(button)) throw new Error('Unsupported pointer button.');
    const type = event.action === 'move' ? 'mouseMoved' : event.action === 'down' ? 'mousePressed' : 'mouseReleased';
    await this.cdp.send('Input.dispatchMouseEvent', { type, x, y, button, modifiers: modifierMask(event.modifiers), clickCount: 1 });
    this.cursor = { x, y };
  }
}
