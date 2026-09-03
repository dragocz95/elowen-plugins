import { elementCenter, requireDomNode } from './accessibility.js';
const inputObject = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Browser input event must be an object.');
    return value;
};
const finite = (value, name) => {
    if (typeof value !== 'number' || !Number.isFinite(value))
        throw new Error(`Browser input ${name} is invalid.`);
    return value;
};
const ALLOWED_MODIFIERS = new Set(['Alt', 'Control', 'Meta', 'Shift']);
const modifiersValue = (value) => {
    if (value === undefined)
        return undefined;
    if (!Array.isArray(value) || value.length > 4 || value.some((item) => typeof item !== 'string' || !ALLOWED_MODIFIERS.has(item))) {
        throw new Error('Browser input modifiers are invalid.');
    }
    return value;
};
export function parseUserInputEvents(value) {
    if (!Array.isArray(value) || value.length === 0 || value.length > 50)
        throw new Error('Browser input batches must contain 1 to 50 events.');
    return value.map((raw) => {
        const event = inputObject(raw);
        if (event.type === 'paste') {
            if (typeof event.text !== 'string' || event.text.length > 20_000)
                throw new Error('Browser paste value is invalid.');
            return { type: 'paste', text: event.text };
        }
        if (event.type === 'key') {
            if ((event.action !== 'down' && event.action !== 'up') || typeof event.key !== 'string' || event.key.length > 32)
                throw new Error('Browser key event is invalid.');
            if (event.code !== undefined && (typeof event.code !== 'string' || event.code.length > 64))
                throw new Error('Browser key code is invalid.');
            return { type: 'key', action: event.action, key: event.key, code: event.code, modifiers: modifiersValue(event.modifiers) };
        }
        if (event.type === 'pointer') {
            if (event.action !== 'move' && event.action !== 'down' && event.action !== 'up')
                throw new Error('Browser pointer action is invalid.');
            if (event.button !== undefined && event.button !== 'left' && event.button !== 'middle' && event.button !== 'right')
                throw new Error('Browser pointer button is invalid.');
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
const MODIFIERS = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };
const BUTTONS = new Set(['left', 'middle', 'right']);
const SAFE_NAMED_KEYS = new Set([
    'Enter', 'Tab', 'Escape', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'Home', 'End', 'PageUp', 'PageDown', 'Space', 'Alt', 'Control', 'Meta', 'Shift', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
]);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
function modifierMask(modifiers) {
    if (!modifiers)
        return 0;
    return modifiers.reduce((mask, modifier) => {
        const bit = MODIFIERS[modifier];
        if (bit === undefined)
            throw new Error(`Unsupported modifier: ${modifier}`);
        return mask | bit;
    }, 0);
}
function validateKey(key) {
    if (key.length === 1 || SAFE_NAMED_KEYS.has(key))
        return key === 'Space' ? ' ' : key;
    throw new Error(`Unsupported key: ${key}`);
}
const MODIFIER_CODES = { Alt: 'AltLeft', Control: 'ControlLeft', Meta: 'MetaLeft', Shift: 'ShiftLeft' };
const inferredCode = (key) => {
    if (/^[a-z]$/i.test(key))
        return `Key${key.toUpperCase()}`;
    if (/^[0-9]$/.test(key))
        return `Digit${key}`;
    if (MODIFIER_CODES[key])
        return MODIFIER_CODES[key];
    if (SAFE_NAMED_KEYS.has(key))
        return key;
    return undefined;
};
const NAMED_VIRTUAL_KEYS = {
    Backspace: 8, Tab: 9, Enter: 13, Shift: 16, Control: 17, Alt: 18, Escape: 27, Space: 32, PageUp: 33, PageDown: 34,
    End: 35, Home: 36, Meta: 91, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Delete: 46,
    F1: 112, F2: 113, F3: 114, F4: 115, F5: 116, F6: 117,
    F7: 118, F8: 119, F9: 120, F10: 121, F11: 122, F12: 123,
};
const virtualKeyCode = (key, normalized) => {
    if (/^[a-z]$/i.test(key))
        return key.toUpperCase().charCodeAt(0);
    if (/^[0-9]$/.test(key))
        return key.charCodeAt(0);
    return NAMED_VIRTUAL_KEYS[key] ?? (normalized === ' ' ? 32 : undefined);
};
function keyDownParams(key, normalized, modifiers, code) {
    const mask = modifierMask(modifiers);
    const virtual = virtualKeyCode(key, normalized);
    const commandKey = modifiers?.some((modifier) => modifier === 'Control' || modifier === 'Meta') === true;
    const insertsText = normalized.length === 1 && !modifiers?.some((modifier) => modifier === 'Alt' || modifier === 'Control' || modifier === 'Meta');
    return {
        type: 'keyDown', key: normalized, modifiers: mask,
        ...(code || inferredCode(key) ? { code: code || inferredCode(key) } : {}),
        ...(virtual !== undefined ? { windowsVirtualKeyCode: virtual, nativeVirtualKeyCode: virtual } : {}),
        ...(insertsText ? { text: normalized } : {}),
        ...(commandKey && normalized.toLowerCase() === 'a' ? { commands: ['selectAll'] } : {}),
    };
}
function keyUpParams(key, normalized, modifiers, code) {
    const virtual = virtualKeyCode(key, normalized);
    return {
        type: 'keyUp', key: normalized, modifiers: modifierMask(modifiers),
        ...(code || inferredCode(key) ? { code: code || inferredCode(key) } : {}),
        ...(virtual !== undefined ? { windowsVirtualKeyCode: virtual, nativeVirtualKeyCode: virtual } : {}),
    };
}
export class InputRateLimiter {
    limitPerSecond;
    now;
    windowStartedAt = 0;
    count = 0;
    constructor(limitPerSecond, now = () => Date.now()) {
        this.limitPerSecond = limitPerSecond;
        this.now = now;
    }
    consume(count = 1) {
        const now = this.now();
        if (now - this.windowStartedAt >= 1000) {
            this.windowStartedAt = now;
            this.count = 0;
        }
        if (this.count + count > this.limitPerSecond())
            throw new Error('Browser input rate limit exceeded.');
        this.count += count;
    }
}
export class InputController {
    cdp;
    viewport;
    emit;
    limiter;
    cursor = { x: 0, y: 0 };
    constructor(cdp, viewport, emit, limiter) {
        this.cdp = cdp;
        this.viewport = viewport;
        this.emit = emit;
        this.limiter = limiter;
    }
    replaceCdp(cdp) { this.cdp = cdp; }
    async click(element) {
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
    async fill(element, value) {
        if (!['textbox', 'searchbox', 'combobox', 'spinbutton'].includes(element.role)) {
            throw new Error(`Element ${element.ref} is not fillable.`);
        }
        if (value.length > 20_000)
            throw new Error('Browser fill value is too large.');
        await this.cdp.send('DOM.focus', { backendNodeId: requireDomNode(element) });
        await this.cdp.send('Input.dispatchKeyEvent', keyDownParams('a', 'a', ['Control'], 'KeyA'));
        await this.cdp.send('Input.dispatchKeyEvent', keyUpParams('a', 'a', ['Control'], 'KeyA'));
        if (value)
            await this.cdp.send('Input.insertText', { text: value });
        else {
            await this.cdp.send('Input.dispatchKeyEvent', keyDownParams('Backspace', 'Backspace', undefined, 'Backspace'));
            await this.cdp.send('Input.dispatchKeyEvent', keyUpParams('Backspace', 'Backspace', undefined, 'Backspace'));
        }
        this.emit({ kind: 'action', data: { action: 'fill', target: element.name || element.role } });
    }
    async pressKey(key, modifiers) {
        const normalized = validateKey(key);
        const code = inferredCode(key);
        await this.cdp.send('Input.dispatchKeyEvent', keyDownParams(key, normalized, modifiers, code));
        await this.cdp.send('Input.dispatchKeyEvent', keyUpParams(key, normalized, modifiers, code));
        this.emit({ kind: 'action', data: { action: 'key', key: normalized, modifiers: modifiers ?? [] } });
    }
    async scroll(deltaX, deltaY) {
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
    /** `stillValid` is checked before EVERY event, not just once. A batch whose first event is stuck on an
     *  unacknowledged CDP command can be abandoned by its caller's deadline while still running here;
     *  without this the remaining events would land later — after a release, a navigation or a close —
     *  in a page or a control state that no longer belongs to whoever sent them. */
    async dispatchUserBatch(events, stillValid = () => { }) {
        if (events.length === 0 || events.length > 50)
            throw new Error('Browser input batches must contain 1 to 50 events.');
        this.limiter.consume(events.length);
        for (const event of events) {
            stillValid();
            await this.dispatchUserEvent(event);
        }
    }
    async dispatchUserEvent(event) {
        if (event.type === 'paste') {
            if (event.text.length > 20_000)
                throw new Error('Browser paste value is too large.');
            await this.cdp.send('Input.insertText', { text: event.text });
            this.emit({ kind: 'action', data: { action: 'paste' } });
            return;
        }
        if (event.type === 'key') {
            const key = validateKey(event.key);
            const code = event.code || inferredCode(event.key);
            await this.cdp.send('Input.dispatchKeyEvent', event.action === 'down'
                ? keyDownParams(event.key, key, event.modifiers, code)
                : keyUpParams(event.key, key, event.modifiers, code));
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
        if (!BUTTONS.has(button))
            throw new Error('Unsupported pointer button.');
        const type = event.action === 'move' ? 'mouseMoved' : event.action === 'down' ? 'mousePressed' : 'mouseReleased';
        await this.cdp.send('Input.dispatchMouseEvent', { type, x, y, button, modifiers: modifierMask(event.modifiers), clickCount: 1 });
        this.cursor = { x, y };
    }
}
