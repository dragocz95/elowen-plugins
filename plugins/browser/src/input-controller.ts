import type { AxElementRef, BrowserActionEvent, CDPSessionLike } from './types.js';
import { elementCenter, requireDomNode } from './accessibility.js';

/** How the AGENT acts on a page: typed actions against an accessibility node, over CDP.
 *
 *  A person driving the same page does not come through here at all any more. Their keyboard and mouse
 *  reach Chrome as native X input through the VNC server, which is the whole reason that path exists —
 *  a synthesized CDP key can never produce the shortcuts the browser itself owns, the secondary button,
 *  or a real drag. What remains here is the agent's vocabulary, which is deliberately NOT raw input:
 *  it names an element from the snapshot and lets the browser work out where that is. */

const MODIFIERS: Record<string, number> = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };
const SAFE_NAMED_KEYS = new Set([
  'Enter', 'Tab', 'Escape', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Home', 'End', 'PageUp', 'PageDown', 'Space', 'Alt', 'Control', 'Meta', 'Shift', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
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

const MODIFIER_CODES: Record<string, string> = { Alt: 'AltLeft', Control: 'ControlLeft', Meta: 'MetaLeft', Shift: 'ShiftLeft' };
const inferredCode = (key: string): string | undefined => {
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  if (MODIFIER_CODES[key]) return MODIFIER_CODES[key];
  if (SAFE_NAMED_KEYS.has(key)) return key;
  return undefined;
};

const NAMED_VIRTUAL_KEYS: Record<string, number> = {
  Backspace: 8, Tab: 9, Enter: 13, Shift: 16, Control: 17, Alt: 18, Escape: 27, Space: 32, PageUp: 33, PageDown: 34,
  End: 35, Home: 36, Meta: 91, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Delete: 46,
  F1: 112, F2: 113, F3: 114, F4: 115, F5: 116, F6: 117,
  F7: 118, F8: 119, F9: 120, F10: 121, F11: 122, F12: 123,
};
const virtualKeyCode = (key: string, normalized: string): number | undefined => {
  if (/^[a-z]$/i.test(key)) return key.toUpperCase().charCodeAt(0);
  if (/^[0-9]$/.test(key)) return key.charCodeAt(0);
  return NAMED_VIRTUAL_KEYS[key] ?? (normalized === ' ' ? 32 : undefined);
};

function keyDownParams(key: string, normalized: string, modifiers: readonly string[] | undefined, code?: string): Record<string, unknown> {
  const mask = modifierMask(modifiers);
  const virtual = virtualKeyCode(key, normalized);
  const commandKey = modifiers?.some((modifier) => modifier === 'Control' || modifier === 'Meta') === true;
  const insertsText = normalized.length === 1 && !modifiers?.some((modifier) => modifier === 'Alt' || modifier === 'Control' || modifier === 'Meta');
  return {
    type: 'keyDown', key: normalized, modifiers: mask,
    ...(code || inferredCode(key) ? { code: code || inferredCode(key) } : {}),
    ...(virtual !== undefined ? { windowsVirtualKeyCode: virtual, nativeVirtualKeyCode: virtual } : {}),
    ...(insertsText ? { text: normalized } : {}),
    // Chrome routes a SYNTHESIZED key through the renderer, so the editing command a real Ctrl+A would
    // trigger never fires. The agent still needs "select all" before replacing a field's value, so it is
    // asked for by name. A person pressing Ctrl+A gets the browser's own handling over VNC instead.
    ...(commandKey && normalized.toLowerCase() === 'a' ? { commands: ['selectAll'] } : {}),
  };
}

function keyUpParams(key: string, normalized: string, modifiers: readonly string[] | undefined, code?: string): Record<string, unknown> {
  const virtual = virtualKeyCode(key, normalized);
  return {
    type: 'keyUp', key: normalized, modifiers: modifierMask(modifiers),
    ...(code || inferredCode(key) ? { code: code || inferredCode(key) } : {}),
    ...(virtual !== undefined ? { windowsVirtualKeyCode: virtual, nativeVirtualKeyCode: virtual } : {}),
  };
}

export class InputController {
  private cursor = { x: 0, y: 0 };

  constructor(
    private cdp: CDPSessionLike,
    private readonly viewport: () => { width: number; height: number },
    private readonly emit: (event: BrowserActionEvent) => void,
  ) {}

  replaceCdp(cdp: CDPSessionLike): void { this.cdp = cdp; }

  async click(element: AxElementRef): Promise<void> {
    const point = await elementCenter(this.cdp, element);
    // The approach is walked rather than jumped, because a page may only reveal what a click is FOR once
    // the pointer is over it: hover menus, tooltips and delegated mouseover handlers all need the moves.
    const steps = 6;
    for (let step = 1; step <= steps; step += 1) {
      const x = this.cursor.x + ((point.x - this.cursor.x) * step) / steps;
      const y = this.cursor.y + ((point.y - this.cursor.y) * step) / steps;
      await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
    }
    await this.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    this.cursor = point;
    this.emit({ kind: 'action', data: { action: 'click', target: element.name || element.role } });
  }

  async fill(element: AxElementRef, value: string): Promise<void> {
    if (!['textbox', 'searchbox', 'combobox', 'spinbutton'].includes(element.role)) {
      throw new Error(`Element ${element.ref} is not fillable.`);
    }
    if (value.length > 20_000) throw new Error('Browser fill value is too large.');
    await this.cdp.send('DOM.focus', { backendNodeId: requireDomNode(element) });
    await this.cdp.send('Input.dispatchKeyEvent', keyDownParams('a', 'a', ['Control'], 'KeyA'));
    await this.cdp.send('Input.dispatchKeyEvent', keyUpParams('a', 'a', ['Control'], 'KeyA'));
    if (value) await this.cdp.send('Input.insertText', { text: value });
    else {
      await this.cdp.send('Input.dispatchKeyEvent', keyDownParams('Backspace', 'Backspace', undefined, 'Backspace'));
      await this.cdp.send('Input.dispatchKeyEvent', keyUpParams('Backspace', 'Backspace', undefined, 'Backspace'));
    }
    this.emit({ kind: 'action', data: { action: 'fill', target: element.name || element.role } });
  }

  async pressKey(key: string, modifiers?: string[]): Promise<void> {
    const normalized = validateKey(key);
    const code = inferredCode(key);
    await this.cdp.send('Input.dispatchKeyEvent', keyDownParams(key, normalized, modifiers, code));
    await this.cdp.send('Input.dispatchKeyEvent', keyUpParams(key, normalized, modifiers, code));
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
    this.emit({ kind: 'action', data: { action: 'scroll', deltaX: safeX, deltaY: safeY } });
  }
}
