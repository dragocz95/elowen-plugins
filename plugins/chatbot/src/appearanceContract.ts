/** What a chatbot's panel LOOKS like: the one home of that shape, its defaults and its bounds.
 *
 *  This module is DELIBERATELY dependency-free, like `publicContract.ts` beside it, because the same bytes
 *  of truth are compiled into three very different places: the daemon-side public route that serves the
 *  configuration, the widget bundle that runs on a customer's website, and the administrator's own bundle
 *  that previews a change before it is saved. A value that meant one thing on the server and another in the
 *  preview would be a customer configuring a look nobody ever sees.
 *
 *  What is configurable is the AGREED set and nothing more: four colours, the corner radius, the panel's
 *  width and height, the greeting, the avatar, the quick buttons, the light/dark mode and the corner the
 *  panel sits in. There is deliberately no theme language here — no CSS, no selector, no arbitrary property.
 *  Everything the widget paints that a customer does NOT set (the header ground, borders, muted text, the
 *  error accent) is derived from `mode`, so the panel stays one design rather than a bag of overrides. */

/** Bumped only when the STORED shape changes incompatibly. A row written by another version is refused
 *  rather than reinterpreted — see `parseStoredAppearance`. */
const APPEARANCE_SCHEMA_VERSION = 1;

/** The two modes, and the list the parser accepts. Internal: what a caller needs is the TYPE, and a caller
 *  that iterated the modes would be a second place that decides what a mode is. */
const APPEARANCE_MODES = ['light', 'dark'] as const;
export type AppearanceMode = (typeof APPEARANCE_MODES)[number];

/** The four corners a panel may hang in. Internal for the same reason: the parser is the only thing that has
 *  to enumerate them. */
const PANEL_POSITIONS = ['bottom-right', 'bottom-left', 'top-right', 'top-left'] as const;
type PanelPosition = (typeof PANEL_POSITIONS)[number];

/** The four colours a customer sets. Everything else in the panel is derived from these and from the mode. */
export interface AppearanceColors {
  /** The panel's own ground, and the ground of the conversation area. */
  panel: string;
  /** A message the VISITOR wrote. */
  visitorBubble: string;
  /** A message the CHATBOT answered with, and the greeting. */
  botBubble: string;
  /** The send button, and the launcher that opens the panel. */
  sendButton: string;
}

export interface ChatbotAppearance {
  schemaVersion: number;
  mode: AppearanceMode;
  position: PanelPosition;
  /** Panel width and height in CSS pixels. Both are ALSO clamped to the visitor's viewport by the widget,
   *  so a wide panel on a phone narrows instead of overflowing. */
  width: number;
  height: number;
  /** Corner radius of the panel, its bubbles and its launcher, in CSS pixels. */
  radius: number;
  colors: AppearanceColors;
  /** The greeting. `null` means "the widget's own greeting", which is written in the visitor's language —
   *  something a configuration stored on the server cannot know. */
  intro: string | null;
  /** An avatar or logo beside the chatbot's own messages. Empty means none. */
  avatarUrl: string;
  /** Buttons under the greeting. Clicking one sends its text as the visitor's own message. */
  quickButtons: string[];
}

/** The bounds the server enforces, and the ranges the administrator's sliders offer. One place, so a slider
 *  cannot be dragged somewhere the server would refuse. */
export const APPEARANCE_BOUNDS = {
  width: { min: 280, max: 640 },
  height: { min: 320, max: 760 },
  radius: { min: 0, max: 28 },
} as const;

export const APPEARANCE_INTRO_MAX_CHARS = 400;
export const APPEARANCE_AVATAR_URL_MAX_CHARS = 2048;
export const APPEARANCE_QUICK_BUTTONS_MAX = 6;
export const APPEARANCE_QUICK_BUTTON_MAX_CHARS = 40;

/** The colour set a customer starts from, and the set the mode control puts back. A light panel on a dark
 *  page and a dark panel on a light one are both ordinary, which is why these are two presets of the same
 *  shape rather than two stylesheets. The dark set is the widget's own shipped look. */
export const APPEARANCE_PRESETS: Record<AppearanceMode, AppearanceColors> = {
  dark: { panel: '#070707', visitorBubble: '#ff5236', botBubble: '#151515', sendButton: '#ff5236' },
  light: { panel: '#ffffff', visitorBubble: '#ff5236', botBubble: '#f3efec', sendButton: '#ff5236' },
};

/** The part of the panel a customer does not set: the header ground, its borders, its muted text, the field
 *  a message is typed into, and the colour a failure is said in. Two fixed ramps, one per mode, so the
 *  chrome and the customer's own colours cannot drift into a palette nobody chose. */
export interface AppearanceRamp {
  foreground: string;
  muted: string;
  border: string;
  /** The header, the greeting's ground and the confirmation box. */
  raised: string;
  /** The input field's ground. */
  field: string;
  /** Anything the visitor should read as a failure. */
  ember: string;
}

export const APPEARANCE_RAMPS: Record<AppearanceMode, AppearanceRamp> = {
  dark: {
    foreground: '#f7f3f0',
    muted: '#9d948e',
    border: '#242424',
    raised: '#151515',
    field: '#151515',
    ember: '#ff9a62',
  },
  light: {
    foreground: '#1b1917',
    muted: '#6f6862',
    border: '#e2ddd8',
    raised: '#f7f4f1',
    field: '#f7f4f1',
    ember: '#b03a12',
  },
};

/** Ink that can be read on the given ground, and the two inks it is chosen from. A bubble's colour is the
 *  customer's, so its TEXT colour cannot be: it is picked by contrast, which is why a white bubble and a
 *  black one are both readable without a second control for it. */
const LIGHT_INK = '#f7f3f0';
const DARK_INK = '#1b1917';

export const DEFAULT_APPEARANCE: ChatbotAppearance = {
  schemaVersion: APPEARANCE_SCHEMA_VERSION,
  mode: 'dark',
  position: 'bottom-right',
  width: 380,
  height: 560,
  radius: 16,
  colors: APPEARANCE_PRESETS.dark,
  intro: null,
  avatarUrl: '',
  quickButtons: [],
};

/** The default look in one of the two modes: what the mode control puts in the colour pickers. */
export function presetAppearance(mode: AppearanceMode): ChatbotAppearance {
  return { ...DEFAULT_APPEARANCE, mode, colors: { ...APPEARANCE_PRESETS[mode] } };
}

/** The chatbot's own name together with how its panel looks: exactly what `GET v1/appearance` answers, and
 *  the one value both the widget and the administrator's preview draw a panel from.
 *
 *  The name is NOT part of the appearance document. It is the chatbot's `display_name` — the same column the
 *  register shows and the same one an administrator edits — so the panel cannot end up titled with a second
 *  name nobody else can see. */
export interface ChatbotLook {
  name: string;
  appearance: ChatbotAppearance;
}

// ── colour arithmetic the widget and the preview both need ──────────────────────────────────────────

/** `#rrggbb` and nothing else. Short hex, `rgb()`, a named colour or a colour function is refused rather
 *  than guessed at: what a customer picks is written straight into a style, and one parser is the only way
 *  two sides can agree on what a stored value means. */
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function isAppearanceColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR.test(value);
}

const channels = (hex: string): [number, number, number] => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
];

const toHex = (value: number): string =>
  Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');

/** WCAG relative luminance. Used only to CHOOSE between two inks, never to describe a colour. */
function relativeLuminance(hex: string): number {
  const channel = (value: number): number => {
    const scaled = value / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = channels(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

const contrastRatio = (a: number, b: number): number => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/** The text colour a bubble of this fill should use: whichever of the two inks reads better on it. */
export function appearanceInk(background: string): string {
  const ground = relativeLuminance(background);
  return contrastRatio(ground, relativeLuminance(LIGHT_INK)) >= contrastRatio(ground, relativeLuminance(DARK_INK))
    ? LIGHT_INK
    : DARK_INK;
}

/** The same colour, moved a little toward white or black. Used for the hover of a button the customer
 *  coloured, so a hover can never be a colour the customer did not choose. */
export function appearanceShade(color: string, direction: 'lighter' | 'darker', amount = 0.12): string {
  const target = direction === 'lighter' ? 255 : 0;
  const [r, g, b] = channels(color);
  const mix = (value: number): number => value + (target - value) * amount;
  return `#${toHex(mix(r))}${toHex(mix(g))}${toHex(mix(b))}`;
}

// ── reading untrusted values ────────────────────────────────────────────────────────────────────────

export type AppearanceParse = { ok: true; value: ChatbotAppearance } | { ok: false; error: string };

const integerWithin = (value: unknown, min: number, max: number): boolean =>
  typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= min && value <= max;

/** A plain object with exactly the given keys. An array, `null`, an extra field or a prototype trick is a
 *  refusal that names the offending key, like every other payload this plugin accepts. */
function plainObject(input: unknown, allowed: readonly string[], where: string): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return { ok: false, error: `${where} must be a JSON object` };
  const record = input as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) return { ok: false, error: `${where} has an unknown field "${key}"` };
  }
  return { ok: true, value: record };
}

function readColor(record: Record<string, unknown>, key: string): { ok: true; value: string } | { ok: false; error: string } {
  const value = record[key];
  if (!isAppearanceColor(value)) return { ok: false, error: `"${key}" must be a colour written as #rrggbb` };
  return { ok: true, value: value.toLowerCase() };
}

/** `''` means no avatar, `http(s)` is an ordinary image wherever it is hosted, and a `data:image/…` URL is
 *  an uploaded one. Anything else — `javascript:`, a `file:`, a bare path — is refused: the value is handed
 *  to an `<img src>`, and the one place that decides what may go there is this function. */
function readAvatarUrl(record: Record<string, unknown>): { ok: true; value: string } | { ok: false; error: string } {
  const value = record.avatarUrl;
  if (value === undefined || value === '') return { ok: true, value: '' };
  if (typeof value !== 'string') return { ok: false, error: '"avatarUrl" must be a string' };
  const trimmed = value.trim();
  if (trimmed === '') return { ok: true, value: '' };
  if (trimmed.length > APPEARANCE_AVATAR_URL_MAX_CHARS) return { ok: false, error: '"avatarUrl" is too long' };
  if (trimmed.startsWith('data:')) {
    return /^data:image\/[a-z0-9.+-]+[;,]/.test(trimmed)
      ? { ok: true, value: trimmed }
      : { ok: false, error: '"avatarUrl" may carry an image, not another kind of data' };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: '"avatarUrl" must be an https address or an image' };
  }
  return parsed.protocol === 'https:' || parsed.protocol === 'http:'
    ? { ok: true, value: trimmed }
    : { ok: false, error: '"avatarUrl" must be an https address or an image' };
}

/** The greeting, or `null` for the widget's own. Empty text IS `null`: a customer who clears the field means
 *  "say the usual thing", and storing an empty string would make the greeting disappear at random depending
 *  on which language the visitor's page is in. */
function readIntro(record: Record<string, unknown>): { ok: true; value: string | null } | { ok: false; error: string } {
  const value = record.intro;
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false, error: '"intro" must be a string' };
  const trimmed = value.trim();
  if (trimmed === '') return { ok: true, value: null };
  if (trimmed.length > APPEARANCE_INTRO_MAX_CHARS) return { ok: false, error: `"intro" is longer than ${APPEARANCE_INTRO_MAX_CHARS} characters` };
  return { ok: true, value: trimmed };
}

/** The quick buttons: short, few, and each one distinct. A repeated button is one a visitor can only be
 *  confused by, so the duplicates collapse the way the allowed-domain list already does. */
function readQuickButtons(record: Record<string, unknown>): { ok: true; value: string[] } | { ok: false; error: string } {
  const value = record.quickButtons;
  if (value === undefined || value === null) return { ok: true, value: [] };
  if (!Array.isArray(value)) return { ok: false, error: '"quickButtons" must be an array' };
  if (value.length > APPEARANCE_QUICK_BUTTONS_MAX) return { ok: false, error: `at most ${APPEARANCE_QUICK_BUTTONS_MAX} quick buttons` };
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string') return { ok: false, error: 'every quick button must be a string' };
    const trimmed = entry.trim();
    if (trimmed === '') return { ok: false, error: 'a quick button must not be empty' };
    if (trimmed.length > APPEARANCE_QUICK_BUTTON_MAX_CHARS) {
      return { ok: false, error: `a quick button is longer than ${APPEARANCE_QUICK_BUTTON_MAX_CHARS} characters` };
    }
    seen.add(trimmed);
  }
  return { ok: true, value: [...seen] };
}

/** Parse one appearance, strictly. Every key is required except the ones that have an obvious empty value
 *  (`intro`, `avatarUrl`, `quickButtons`), and the result is always a COMPLETE appearance: a partial object
 *  is refused rather than filled in, so a caller can never believe it stored something it did not. */
export function parseAppearance(input: unknown): AppearanceParse {
  const outer = plainObject(input, ['schemaVersion', 'mode', 'position', 'width', 'height', 'radius', 'colors', 'intro', 'avatarUrl', 'quickButtons'], 'appearance');
  if (!outer.ok) return outer;
  const record = outer.value;

  if (record.schemaVersion !== APPEARANCE_SCHEMA_VERSION) {
    return { ok: false, error: `"schemaVersion" must be ${APPEARANCE_SCHEMA_VERSION}` };
  }
  if (typeof record.mode !== 'string' || !(APPEARANCE_MODES as readonly string[]).includes(record.mode)) {
    return { ok: false, error: '"mode" must be light or dark' };
  }
  if (typeof record.position !== 'string' || !(PANEL_POSITIONS as readonly string[]).includes(record.position)) {
    return { ok: false, error: `"position" must be one of ${PANEL_POSITIONS.join(', ')}` };
  }

  const colors = plainObject(record.colors, ['panel', 'visitorBubble', 'botBubble', 'sendButton'], 'appearance.colors');
  if (!colors.ok) return colors;
  const panel = readColor(colors.value, 'panel');
  if (!panel.ok) return panel;
  const visitorBubble = readColor(colors.value, 'visitorBubble');
  if (!visitorBubble.ok) return visitorBubble;
  const botBubble = readColor(colors.value, 'botBubble');
  if (!botBubble.ok) return botBubble;
  const sendButton = readColor(colors.value, 'sendButton');
  if (!sendButton.ok) return sendButton;

  if (!integerWithin(record.width, APPEARANCE_BOUNDS.width.min, APPEARANCE_BOUNDS.width.max)) {
    return { ok: false, error: `"width" must be a whole number of pixels between ${APPEARANCE_BOUNDS.width.min} and ${APPEARANCE_BOUNDS.width.max}` };
  }
  if (!integerWithin(record.height, APPEARANCE_BOUNDS.height.min, APPEARANCE_BOUNDS.height.max)) {
    return { ok: false, error: `"height" must be a whole number of pixels between ${APPEARANCE_BOUNDS.height.min} and ${APPEARANCE_BOUNDS.height.max}` };
  }
  if (!integerWithin(record.radius, APPEARANCE_BOUNDS.radius.min, APPEARANCE_BOUNDS.radius.max)) {
    return { ok: false, error: `"radius" must be a whole number of pixels between ${APPEARANCE_BOUNDS.radius.min} and ${APPEARANCE_BOUNDS.radius.max}` };
  }

  const intro = readIntro(record);
  if (!intro.ok) return intro;
  const avatarUrl = readAvatarUrl(record);
  if (!avatarUrl.ok) return avatarUrl;
  const quickButtons = readQuickButtons(record);
  if (!quickButtons.ok) return quickButtons;

  return {
    ok: true,
    value: {
      schemaVersion: APPEARANCE_SCHEMA_VERSION,
      mode: record.mode as AppearanceMode,
      position: record.position as PanelPosition,
      width: record.width as number,
      height: record.height as number,
      radius: record.radius as number,
      colors: {
        panel: panel.value,
        visitorBubble: visitorBubble.value,
        botBubble: botBubble.value,
        sendButton: sendButton.value,
      },
      intro: intro.value,
      avatarUrl: avatarUrl.value,
      quickButtons: quickButtons.value,
    },
  };
}

/** The appearance of a stored row. `null` is a chatbot nobody has configured yet and is answered with the
 *  default look; anything else must be an appearance this version wrote.
 *
 *  A stored value that does NOT parse is CORRUPT rather than hostile — this plugin is the only writer — and
 *  it is reported as a failure of the row instead of being quietly replaced by something the customer never
 *  chose. The admin surface shows it; the public route refuses with `appearance_invalid` and the widget
 *  keeps its built-in look, so a visitor is never shown a panel nobody configured. */
export function parseStoredAppearance(raw: string | null): ChatbotAppearance {
  if (raw === null || raw === '') return DEFAULT_APPEARANCE;
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    throw new Error('chatbot: the stored appearance is not JSON');
  }
  const parsed = parseAppearance(decoded);
  if (!parsed.ok) throw new Error(`chatbot: the stored appearance is invalid: ${parsed.error}`);
  return parsed.value;
}
