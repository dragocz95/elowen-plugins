/** Shared appearance contract for storage, the public widget and the administrator preview. */
export const APPEARANCE_SCHEMA_VERSION = 2;
export const APPEARANCE_TEMPLATE_IDS = ['elowen', 'clean', 'mono', 'warm', 'indigo'];
const APPEARANCE_MODES = ['light', 'dark'];
const PANEL_POSITIONS = ['bottom-right', 'bottom-left', 'top-right', 'top-left'];
const SEND_SHAPES = ['circle', 'rounded-square'];
/** One dependency-free icon catalog. Every consumer renders the same 24 px stroked path. */
export const APPEARANCE_ICONS = [
    { id: 'arrow', path: 'M5 12h14 M13 6l6 6-6 6' },
    { id: 'paper-plane', path: 'M22 2 11 13 M22 2l-7 20-4-9-9-4 20-7Z' },
    { id: 'speech-bubble', path: 'M21 15a4 4 0 0 1-4 4H8l-5 3 1.7-5.1A8 8 0 1 1 21 15Z' },
    { id: 'sparkles', path: 'M12 3l1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2L12 3Z M5 14l.8 2.2L8 17l-2.2.8L5 20l-.8-2.2L2 17l2.2-.8L5 14Z M19 13l.8 2.2L22 16l-2.2.8L19 19l-.8-2.2L16 16l2.2-.8L19 13Z' },
    { id: 'question', path: 'M9.1 9a3 3 0 1 1 4.7 2.5c-1.1.7-1.8 1.2-1.8 2.5 M12 18h.01 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z' },
    { id: 'phone', path: 'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.7 2Z' },
    { id: 'calendar', path: 'M6 2v4 M18 2v4 M3 9h18 M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2Z' },
    { id: 'cart', path: 'M3 3h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.6L21 7H6 M10 21h.01 M18 21h.01' },
    { id: 'person', path: 'M20 21a8 8 0 0 0-16 0 M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z' },
    { id: 'envelope', path: 'M3 5h18v14H3V5Z M3 6l9 7 9-7' },
    { id: 'check', path: 'm5 12 4 4L19 6' },
];
export const APPEARANCE_BOUNDS = {
    width: { min: 280, max: 640 },
    height: { min: 320, max: 760 },
    radius: { min: 0, max: 32 },
    launcherSize: { min: 44, max: 72 },
    launcherOffset: { min: 8, max: 40 },
    fontSize: { min: 12, max: 18 },
};
export const APPEARANCE_INTRO_MAX_CHARS = 400;
export const APPEARANCE_AVATAR_URL_MAX_CHARS = 2048;
export const APPEARANCE_SUBTITLE_MAX_CHARS = 80;
export const APPEARANCE_PLACEHOLDER_MAX_CHARS = 80;
export const APPEARANCE_LAUNCHER_LABEL_MAX_CHARS = 24;
export const APPEARANCE_QUICK_BUTTONS_MAX = 6;
export const APPEARANCE_QUICK_BUTTON_MAX_CHARS = 40;
export const APPEARANCE_FONT_STACKS = {
    system: "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    humanist: "Optima, Candara, 'Noto Sans', sans-serif",
    serif: "Georgia, Cambria, 'Times New Roman', serif",
    mono: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
};
export const APPEARANCE_SHADOWS = {
    none: 'none',
    soft: '0 12px 32px rgb(0 0 0 / 0.16)',
    medium: '0 18px 48px rgb(0 0 0 / 0.28)',
    strong: '0 24px 64px rgb(0 0 0 / 0.5)',
    floating: '0 42px 110px rgb(15 23 42 / 0.26), 0 18px 42px rgb(15 23 42 / 0.20)',
};
const template = (appearance) => ({
    schemaVersion: APPEARANCE_SCHEMA_VERSION,
    ...appearance,
});
export const APPEARANCE_TEMPLATES = {
    elowen: template({
        mode: 'dark', position: 'bottom-right', width: 380, height: 560, radius: 16,
        colors: { header: null, panel: '#0f1012', visitorBubble: '#ff6a4d', botBubble: '#24262b', sendButton: '#ff6a4d', sendIcon: '#171311', launcher: '#ff6a4d' },
        intro: null, avatarUrl: '', quickButtons: [],
        send: { icon: 'arrow', shape: 'circle' },
        launcher: { icon: 'speech-bubble', size: 56, offset: 20, label: '' },
        header: { subtitle: '', showAvatar: true, showMessageName: true },
        typography: { fontSize: 14, fontFamily: 'system', shadow: 'medium', placeholder: '' },
    }),
    clean: template({
        mode: 'light', position: 'bottom-right', width: 400, height: 600, radius: 20,
        colors: { header: null, panel: '#ffffff', visitorBubble: '#1d4ed8', botBubble: '#e2e8f0', sendButton: '#1d4ed8', sendIcon: '#ffffff', launcher: '#1d4ed8' },
        intro: null, avatarUrl: '', quickButtons: [],
        send: { icon: 'paper-plane', shape: 'circle' },
        launcher: { icon: 'speech-bubble', size: 56, offset: 20, label: '' },
        header: { subtitle: '', showAvatar: true, showMessageName: false },
        typography: { fontSize: 15, fontFamily: 'system', shadow: 'soft', placeholder: '' },
    }),
    mono: template({
        mode: 'dark', position: 'bottom-right', width: 320, height: 520, radius: 4,
        // A light launcher stays visible on dark host pages even with the monochrome template's shadow disabled.
        colors: { header: null, panel: '#101010', visitorBubble: '#f5f5f5', botBubble: '#2b2b2b', sendButton: '#f5f5f5', sendIcon: '#111111', launcher: '#d4d4d4' },
        intro: null, avatarUrl: '', quickButtons: [],
        send: { icon: 'arrow', shape: 'rounded-square' },
        launcher: { icon: 'speech-bubble', size: 52, offset: 16, label: '' },
        header: { subtitle: '', showAvatar: false, showMessageName: true },
        typography: { fontSize: 14, fontFamily: 'mono', shadow: 'none', placeholder: '' },
    }),
    warm: template({
        mode: 'light', position: 'bottom-right', width: 400, height: 600, radius: 28,
        colors: { header: null, panel: '#fff7ed', visitorBubble: '#b4532d', botBubble: '#f0dac2', sendButton: '#b4532d', sendIcon: '#ffffff', launcher: '#b4532d' },
        intro: null, avatarUrl: '', quickButtons: [],
        send: { icon: 'paper-plane', shape: 'circle' },
        launcher: { icon: 'speech-bubble', size: 60, offset: 24, label: '' },
        header: { subtitle: '', showAvatar: true, showMessageName: false },
        typography: { fontSize: 15, fontFamily: 'humanist', shadow: 'soft', placeholder: '' },
    }),
    indigo: template({
        mode: 'light', position: 'bottom-right', width: 477, height: 711, radius: 22,
        colors: { panel: '#ffffff', header: '#211741', visitorBubble: '#120832', botBubble: '#eceaf1', sendButton: '#211741', sendIcon: '#ffffff', launcher: '#211741' },
        intro: null, avatarUrl: '', quickButtons: [],
        send: { icon: 'paper-plane', shape: 'circle' },
        // The current geometry contract uses one shared edge offset, including the 20 px bottom gap.
        launcher: { icon: 'speech-bubble', size: 56, offset: 20, label: '' },
        header: { subtitle: '', showAvatar: false, showMessageName: false },
        // Use the local sans stack, never download the reference design's Manrope webfont.
        typography: { fontSize: 15, fontFamily: 'system', shadow: 'floating', placeholder: '' },
    }),
};
export const DEFAULT_STORED_APPEARANCE = {
    schemaVersion: APPEARANCE_SCHEMA_VERSION,
    template: 'elowen',
    overrides: {},
};
export const DEFAULT_APPEARANCE = APPEARANCE_TEMPLATES.elowen;
const LIGHT_INK = '#f7f3f0';
const DARK_INK = '#1b1917';
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const channels = (hex) => [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
];
const toHex = (value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
function relativeLuminance(hex) {
    const channel = (value) => {
        const scaled = value / 255;
        return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
    };
    const [r, g, b] = channels(hex);
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
const contrastRatio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
export function appearanceInk(background) {
    const ground = relativeLuminance(background);
    return contrastRatio(ground, relativeLuminance(LIGHT_INK)) >= contrastRatio(ground, relativeLuminance(DARK_INK))
        ? LIGHT_INK
        : DARK_INK;
}
export function appearanceShade(color, direction, amount = 0.12) {
    const target = direction === 'lighter' ? 255 : 0;
    const [r, g, b] = channels(color);
    const mix = (value) => value + (target - value) * amount;
    return `#${toHex(mix(r))}${toHex(mix(g))}${toHex(mix(b))}`;
}
/**
 * Mix the panel toward its contrasting pole in sRGB: raised 6%, field 10%.
 * Cap those steps near mid-tones so normal text still reaches WCAG 4.5:1.
 * Muted text and boundaries use the first 1% step reaching 4.5:1 and 3:1
 * respectively against every chrome surface. All tints retain the panel hue.
 */
export function appearanceRamp(appearance) {
    const panel = appearance.colors.panel;
    const foreground = relativeLuminance(panel) > Math.sqrt(0.05 * 1.05) - 0.05 ? '#000000' : '#ffffff';
    const direction = foreground === '#ffffff' ? 'lighter' : 'darker';
    const contrast = (a, b) => contrastRatio(relativeLuminance(a), relativeLuminance(b));
    const surface = (percent) => {
        for (let step = percent; step > 0; step--) {
            const fill = appearanceShade(panel, direction, step / 100);
            if (contrast(fill, foreground) >= 4.5)
                return fill;
        }
        return panel;
    };
    const raised = surface(6);
    const field = surface(10);
    const surfaces = [panel, raised, field];
    const ink = (minimum) => {
        for (let step = 1; step < 100; step++) {
            const color = appearanceShade(panel, direction, step / 100);
            if (surfaces.every(fill => contrast(fill, color) >= minimum))
                return color;
        }
        return foreground;
    };
    const header = appearance.colors.header ?? raised;
    return {
        header, headerInk: appearanceInk(header),
        launcherBorder: appearanceShade(appearance.colors.launcher, appearanceInk(appearance.colors.launcher) === LIGHT_INK ? 'lighter' : 'darker', .45),
        foreground, muted: ink(4.5), border: ink(3), raised, field,
        ember: appearance.mode === 'dark' ? '#ff9a62' : '#b03a12',
    };
}
export function appearanceIcon(id) {
    return APPEARANCE_ICONS.find((entry) => entry.id === id);
}
export function appearanceIconSvg(id) {
    const icon = appearanceIcon(id);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${icon.path}"/></svg>`;
}
export function appearanceFontStack(family) {
    return APPEARANCE_FONT_STACKS[family];
}
function cloneAppearance(value) {
    return {
        ...value,
        colors: { ...value.colors },
        quickButtons: value.quickButtons.map((button) => ({ ...button })),
        send: { ...value.send },
        launcher: { ...value.launcher },
        header: { ...value.header },
        typography: { ...value.typography },
    };
}
export function resolveAppearance(stored) {
    const base = cloneAppearance(APPEARANCE_TEMPLATES[stored.template]);
    const overrides = stored.overrides;
    return {
        ...base,
        ...overrides,
        schemaVersion: APPEARANCE_SCHEMA_VERSION,
        colors: { ...base.colors, ...overrides.colors },
        quickButtons: overrides.quickButtons?.map((button) => ({ ...button })) ?? base.quickButtons,
        send: { ...base.send, ...overrides.send },
        launcher: { ...base.launcher, ...overrides.launcher },
        header: { ...base.header, ...overrides.header },
        typography: { ...base.typography, ...overrides.typography },
    };
}
export function setAppearanceOverride(stored, path, value) {
    const [group, child] = path.split('.');
    const overrides = { ...stored.overrides };
    if (child === undefined) {
        overrides[group] = value;
    }
    else {
        overrides[group] = {
            ...overrides[group],
            [child]: value,
        };
    }
    return { ...stored, overrides };
}
export function resetAppearanceOverride(stored, path) {
    const [group, child] = path.split('.');
    const overrides = { ...stored.overrides };
    if (child === undefined) {
        delete overrides[group];
    }
    else {
        const nested = { ...overrides[group] };
        delete nested[child];
        if (Object.keys(nested).length === 0)
            delete overrides[group];
        else
            overrides[group] = nested;
    }
    return { ...stored, overrides: overrides };
}
export function isAppearanceOverridden(stored, path) {
    const [group, child] = path.split('.');
    if (child === undefined)
        return Object.prototype.hasOwnProperty.call(stored.overrides, group);
    const nested = stored.overrides[group];
    return typeof nested === 'object' && nested !== null && Object.prototype.hasOwnProperty.call(nested, child);
}
export function selectAppearanceTemplate(templateId) {
    return { schemaVersion: APPEARANCE_SCHEMA_VERSION, template: templateId, overrides: {} };
}
const integerWithin = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= min && value <= max;
function plainObject(input, allowed, where) {
    if (typeof input !== 'object' || input === null || Array.isArray(input))
        return { ok: false, error: `${where} must be a JSON object` };
    const record = input;
    for (const key of Object.keys(record)) {
        if (!allowed.includes(key))
            return { ok: false, error: `${where} has an unknown field "${key}"` };
    }
    return { ok: true, value: record };
}
function requiredKeys(record, keys, where) {
    for (const key of keys)
        if (!(key in record))
            return { ok: false, error: `${where} is missing "${key}"` };
    return { ok: true, value: true };
}
function readEnum(value, values, key) {
    return typeof value === 'string' && values.includes(value)
        ? { ok: true, value: value }
        : { ok: false, error: `"${key}" is not an allowed value` };
}
function readString(value, key, max, nullable = false) {
    if (nullable && value === null)
        return { ok: true, value: null };
    if (typeof value !== 'string')
        return { ok: false, error: `"${key}" must be a string` };
    const trimmed = value.trim();
    if (trimmed.length > max)
        return { ok: false, error: `"${key}" is longer than ${max} characters` };
    return { ok: true, value: nullable && trimmed === '' ? null : trimmed };
}
function readColor(value, key) {
    return typeof value === 'string' && HEX_COLOR.test(value)
        ? { ok: true, value: value.toLowerCase() }
        : { ok: false, error: `"${key}" must be a colour written as #rrggbb` };
}
function readAvatar(value) {
    const text = readString(value, 'avatarUrl', APPEARANCE_AVATAR_URL_MAX_CHARS);
    if (!text.ok)
        return text;
    const trimmed = text.value;
    if (trimmed === '')
        return { ok: true, value: '' };
    if (trimmed.startsWith('data:')) {
        return /^data:image\/[a-z0-9.+-]+[;,]/.test(trimmed)
            ? { ok: true, value: trimmed }
            : { ok: false, error: '"avatarUrl" may carry an image, not another kind of data' };
    }
    try {
        const parsed = new URL(trimmed);
        return parsed.protocol === 'https:' || parsed.protocol === 'http:'
            ? { ok: true, value: trimmed }
            : { ok: false, error: '"avatarUrl" must be an https address or an image' };
    }
    catch {
        return { ok: false, error: '"avatarUrl" must be an https address or an image' };
    }
}
function readQuickButtons(value) {
    if (!Array.isArray(value))
        return { ok: false, error: '"quickButtons" must be an array' };
    if (value.length > APPEARANCE_QUICK_BUTTONS_MAX)
        return { ok: false, error: `at most ${APPEARANCE_QUICK_BUTTONS_MAX} quick buttons` };
    const result = [];
    const seen = new Set();
    for (const entry of value) {
        const object = plainObject(entry, ['text', 'icon'], 'quick button');
        if (!object.ok)
            return object;
        const present = requiredKeys(object.value, ['text', 'icon'], 'quick button');
        if (!present.ok)
            return present;
        const text = readString(object.value.text, 'quick button text', APPEARANCE_QUICK_BUTTON_MAX_CHARS);
        if (!text.ok)
            return text;
        if (text.value === '')
            return { ok: false, error: 'a quick button must not be empty' };
        if (seen.has(text.value))
            return { ok: false, error: 'quick button text must be unique' };
        let icon = null;
        if (object.value.icon !== null) {
            const parsedIcon = readEnum(object.value.icon, APPEARANCE_ICONS.map((item) => item.id), 'quick button icon');
            if (!parsedIcon.ok)
                return parsedIcon;
            icon = parsedIcon.value;
        }
        seen.add(text.value);
        result.push({ text: text.value, icon });
    }
    return { ok: true, value: result };
}
function parseColors(input, partial) {
    const keys = ['panel', 'header', 'visitorBubble', 'botBubble', 'sendButton', 'sendIcon', 'launcher'];
    const object = plainObject(input, keys, 'appearance.colors');
    if (!object.ok)
        return object;
    if (!partial) {
        const present = requiredKeys(object.value, keys, 'appearance.colors');
        if (!present.ok)
            return present;
    }
    const result = {};
    for (const key of keys) {
        if (!(key in object.value))
            continue;
        if (key === 'header' && object.value[key] === null) {
            result.header = null;
            continue;
        }
        const value = readColor(object.value[key], key);
        if (!value.ok)
            return value;
        result[key] = value.value;
    }
    return { ok: true, value: result };
}
function parseSend(input, partial) {
    const keys = ['icon', 'shape'];
    const object = plainObject(input, keys, 'appearance.send');
    if (!object.ok)
        return object;
    if (!partial) {
        const present = requiredKeys(object.value, keys, 'appearance.send');
        if (!present.ok)
            return present;
    }
    const result = {};
    if ('icon' in object.value) {
        const icon = readEnum(object.value.icon, APPEARANCE_ICONS.map((item) => item.id), 'send.icon');
        if (!icon.ok)
            return icon;
        result.icon = icon.value;
    }
    if ('shape' in object.value) {
        const shape = readEnum(object.value.shape, SEND_SHAPES, 'send.shape');
        if (!shape.ok)
            return shape;
        result.shape = shape.value;
    }
    return { ok: true, value: result };
}
function parseLauncher(input, partial) {
    const keys = ['icon', 'size', 'offset', 'label'];
    const object = plainObject(input, keys, 'appearance.launcher');
    if (!object.ok)
        return object;
    if (!partial) {
        const present = requiredKeys(object.value, keys, 'appearance.launcher');
        if (!present.ok)
            return present;
    }
    const result = {};
    if ('icon' in object.value) {
        const icon = readEnum(object.value.icon, APPEARANCE_ICONS.map((item) => item.id), 'launcher.icon');
        if (!icon.ok)
            return icon;
        result.icon = icon.value;
    }
    if ('size' in object.value) {
        if (!integerWithin(object.value.size, APPEARANCE_BOUNDS.launcherSize.min, APPEARANCE_BOUNDS.launcherSize.max))
            return { ok: false, error: '"launcher.size" is outside its bounds' };
        result.size = object.value.size;
    }
    if ('offset' in object.value) {
        if (!integerWithin(object.value.offset, APPEARANCE_BOUNDS.launcherOffset.min, APPEARANCE_BOUNDS.launcherOffset.max))
            return { ok: false, error: '"launcher.offset" is outside its bounds' };
        result.offset = object.value.offset;
    }
    if ('label' in object.value) {
        const label = readString(object.value.label, 'launcher.label', APPEARANCE_LAUNCHER_LABEL_MAX_CHARS);
        if (!label.ok)
            return label;
        result.label = label.value;
    }
    return { ok: true, value: result };
}
function parseHeader(input, partial) {
    const keys = ['subtitle', 'showAvatar', 'showMessageName'];
    const object = plainObject(input, keys, 'appearance.header');
    if (!object.ok)
        return object;
    if (!partial) {
        const present = requiredKeys(object.value, keys, 'appearance.header');
        if (!present.ok)
            return present;
    }
    const result = {};
    if ('subtitle' in object.value) {
        const subtitle = readString(object.value.subtitle, 'header.subtitle', APPEARANCE_SUBTITLE_MAX_CHARS);
        if (!subtitle.ok)
            return subtitle;
        result.subtitle = subtitle.value;
    }
    for (const key of ['showAvatar', 'showMessageName']) {
        if (!(key in object.value))
            continue;
        if (typeof object.value[key] !== 'boolean')
            return { ok: false, error: `"header.${key}" must be a boolean` };
        result[key] = object.value[key];
    }
    return { ok: true, value: result };
}
function parseTypography(input, partial) {
    const keys = ['fontSize', 'fontFamily', 'shadow', 'placeholder'];
    const object = plainObject(input, keys, 'appearance.typography');
    if (!object.ok)
        return object;
    if (!partial) {
        const present = requiredKeys(object.value, keys, 'appearance.typography');
        if (!present.ok)
            return present;
    }
    const result = {};
    if ('fontSize' in object.value) {
        if (!integerWithin(object.value.fontSize, APPEARANCE_BOUNDS.fontSize.min, APPEARANCE_BOUNDS.fontSize.max))
            return { ok: false, error: '"typography.fontSize" is outside its bounds' };
        result.fontSize = object.value.fontSize;
    }
    if ('fontFamily' in object.value) {
        const family = readEnum(object.value.fontFamily, Object.keys(APPEARANCE_FONT_STACKS), 'typography.fontFamily');
        if (!family.ok)
            return family;
        result.fontFamily = family.value;
    }
    if ('shadow' in object.value) {
        const shadow = readEnum(object.value.shadow, Object.keys(APPEARANCE_SHADOWS), 'typography.shadow');
        if (!shadow.ok)
            return shadow;
        result.shadow = shadow.value;
    }
    if ('placeholder' in object.value) {
        const placeholder = readString(object.value.placeholder, 'typography.placeholder', APPEARANCE_PLACEHOLDER_MAX_CHARS);
        if (!placeholder.ok)
            return placeholder;
        result.placeholder = placeholder.value;
    }
    return { ok: true, value: result };
}
const appearanceFields = ['mode', 'position', 'width', 'height', 'radius', 'colors', 'intro', 'avatarUrl', 'quickButtons', 'send', 'launcher', 'header', 'typography'];
export function parseAppearance(input) {
    const object = plainObject(input, ['schemaVersion', ...appearanceFields], 'appearance');
    if (!object.ok)
        return object;
    const { schemaVersion, ...fields } = object.value;
    if (schemaVersion !== APPEARANCE_SCHEMA_VERSION)
        return { ok: false, error: `"schemaVersion" must be ${APPEARANCE_SCHEMA_VERSION}` };
    const parsed = parseOverrides(fields, false);
    if (!parsed.ok)
        return parsed;
    // The full parser requires every field and every nested key before this assertion.
    return { ok: true, value: { schemaVersion, ...parsed.value } };
}
function parseOverrides(input, partial = true) {
    const object = plainObject(input, appearanceFields, 'appearance.overrides');
    if (!object.ok)
        return object;
    if (!partial) {
        const present = requiredKeys(object.value, appearanceFields, 'appearance');
        if (!present.ok)
            return present;
    }
    const result = {};
    if ('mode' in object.value) {
        const value = readEnum(object.value.mode, APPEARANCE_MODES, 'mode');
        if (!value.ok)
            return value;
        result.mode = value.value;
    }
    if ('position' in object.value) {
        const value = readEnum(object.value.position, PANEL_POSITIONS, 'position');
        if (!value.ok)
            return value;
        result.position = value.value;
    }
    for (const [key, bounds] of [['width', APPEARANCE_BOUNDS.width], ['height', APPEARANCE_BOUNDS.height], ['radius', APPEARANCE_BOUNDS.radius]]) {
        if (!(key in object.value))
            continue;
        if (!integerWithin(object.value[key], bounds.min, bounds.max))
            return { ok: false, error: `"${key}" is outside its bounds` };
        result[key] = object.value[key];
    }
    if ('colors' in object.value) {
        const value = parseColors(object.value.colors, partial);
        if (!value.ok)
            return value;
        result.colors = value.value;
    }
    if ('intro' in object.value) {
        const value = readString(object.value.intro, 'intro', APPEARANCE_INTRO_MAX_CHARS, true);
        if (!value.ok)
            return value;
        result.intro = value.value;
    }
    if ('avatarUrl' in object.value) {
        const value = readAvatar(object.value.avatarUrl);
        if (!value.ok)
            return value;
        result.avatarUrl = value.value;
    }
    if ('quickButtons' in object.value) {
        const value = readQuickButtons(object.value.quickButtons);
        if (!value.ok)
            return value;
        result.quickButtons = value.value;
    }
    if ('send' in object.value) {
        const value = parseSend(object.value.send, partial);
        if (!value.ok)
            return value;
        result.send = value.value;
    }
    if ('launcher' in object.value) {
        const value = parseLauncher(object.value.launcher, partial);
        if (!value.ok)
            return value;
        result.launcher = value.value;
    }
    if ('header' in object.value) {
        const value = parseHeader(object.value.header, partial);
        if (!value.ok)
            return value;
        result.header = value.value;
    }
    if ('typography' in object.value) {
        const value = parseTypography(object.value.typography, partial);
        if (!value.ok)
            return value;
        result.typography = value.value;
    }
    return { ok: true, value: result };
}
export function parseAppearanceSelection(input) {
    const object = plainObject(input, ['schemaVersion', 'template', 'overrides'], 'appearance');
    if (!object.ok)
        return object;
    const present = requiredKeys(object.value, ['schemaVersion', 'template', 'overrides'], 'appearance');
    if (!present.ok)
        return present;
    if (object.value.schemaVersion !== APPEARANCE_SCHEMA_VERSION)
        return { ok: false, error: `"schemaVersion" must be ${APPEARANCE_SCHEMA_VERSION}` };
    const templateId = readEnum(object.value.template, APPEARANCE_TEMPLATE_IDS, 'template');
    if (!templateId.ok)
        return templateId;
    const overrides = parseOverrides(object.value.overrides);
    if (!overrides.ok)
        return overrides;
    return { ok: true, value: {
            schemaVersion: APPEARANCE_SCHEMA_VERSION,
            template: templateId.value,
            overrides: overrides.value,
        } };
}
export function parseStoredAppearance(raw) {
    if (raw === null)
        return selectAppearanceTemplate(DEFAULT_STORED_APPEARANCE.template);
    let decoded;
    try {
        decoded = JSON.parse(raw);
    }
    catch {
        throw new Error('chatbot: the stored appearance is not JSON');
    }
    const parsed = parseAppearanceSelection(decoded);
    if (!parsed.ok)
        throw new Error(`chatbot: the stored appearance is invalid: ${parsed.error}`);
    return parsed.value;
}
