import { describe, expect, it } from 'vitest';
import {
  APPEARANCE_TEMPLATES, APPEARANCE_TEMPLATE_IDS, appearanceRamp, appearanceInk, appearanceShade,
  resolveAppearance, selectAppearanceTemplate, setAppearanceOverride, resetAppearanceOverride,
  parseAppearance, parseAppearanceSelection,
} from '../plugins/chatbot/src/appearanceContract';

// Independent WCAG sRGB calculation: regressions pin readability, never palette hexes.
function luminance(hex: string): number {
  const rgb = [1, 3, 5].map(offset => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  });
  return rgb[0]! * .2126 + rgb[1]! * .7152 + rgb[2]! * .0722;
}
function contrast(a: string, b: string): number {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + .05) / (Math.min(first, second) + .05);
}

describe('appearance contrast floors', () => {
  it.each(APPEARANCE_TEMPLATE_IDS)('%s keeps text and controls legible', id => {
    const appearance = APPEARANCE_TEMPLATES[id];
    const c = appearance.colors;
    const ramp = appearanceRamp(appearance);
    for (const ground of [c.panel, ramp.raised, ramp.field]) {
      expect(contrast(ramp.foreground, ground)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(ramp.muted, ground)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(ramp.border, ground)).toBeGreaterThanOrEqual(3);
    }
    expect(contrast(ramp.headerInk, ramp.header)).toBeGreaterThanOrEqual(4.5);
    for (const bubble of [c.botBubble, c.visitorBubble]) {
      expect(contrast(appearanceInk(bubble), bubble)).toBeGreaterThanOrEqual(4.5);
      // Decorative bubble separation, not a WCAG text contrast requirement.
      expect(contrast(bubble, c.panel)).toBeGreaterThanOrEqual(1.15);
    }
    const hover = appearance.mode === 'dark' ? 'lighter' : 'darker';
    for (const background of [c.sendButton, appearanceShade(c.sendButton, hover)]) {
      expect(contrast(c.sendIcon, background)).toBeGreaterThanOrEqual(4.5);
    }
    for (const background of [c.launcher, appearanceShade(c.launcher, hover)]) {
      expect(contrast(appearanceInk(c.launcher), background)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(ramp.ember, c.panel)).toBeGreaterThanOrEqual(4.5);
    for (const page of ['#ffffff', '#121316']) {
      expect(Math.max(contrast(c.launcher, page), contrast(ramp.launcherBorder, page))).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps the monochrome launcher visible on dark host pages', () => {
    for (const page of ['#000000', '#151515', '#303030']) {
      expect(contrast(APPEARANCE_TEMPLATES.mono.colors.launcher, page)).toBeGreaterThanOrEqual(3);
    }
  });

  it('gives warm one accent family and a speech launcher', () => {
    const warm = APPEARANCE_TEMPLATES.warm;
    expect(warm.colors.visitorBubble).toBe(warm.colors.sendButton);
    expect(warm.colors.launcher).toBe(warm.colors.sendButton);
    expect(warm.launcher.icon).toBe('speech-bubble');
  });

  it.each(['#ffffff', '#000000', '#fff7ed', '#17243b', '#777777', '#747474', '#ff00ff', '#008080'])(
    'derives chrome from the actual panel %s, independently of mode', panel => {
      const appearance = resolveAppearance(setAppearanceOverride(selectAppearanceTemplate('elowen'), 'colors.panel', panel));
      const dark = appearanceRamp({ ...appearance, mode: 'dark' });
      const light = appearanceRamp({ ...appearance, mode: 'light' });
      const { ember: darkEmber, ...darkChrome } = dark;
      const { ember: lightEmber, ...lightChrome } = light;
      expect(darkChrome).toEqual(lightChrome);
      expect(darkEmber).not.toBe(lightEmber);
      for (const surface of [panel, dark.raised, dark.field]) {
        expect(contrast(dark.foreground, surface)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(dark.muted, surface)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(dark.border, surface)).toBeGreaterThanOrEqual(3);
      }
    },
  );

  it('changes derived surfaces when a panel changes within the same mode', () => {
    const base = APPEARANCE_TEMPLATES.clean;
    const changed = appearanceRamp({ ...base, colors: { ...base.colors, panel: '#fff7ed' } });
    const original = appearanceRamp(base);
    for (const key of ['raised', 'field', 'muted', 'border'] as const) expect(changed[key]).not.toBe(original[key]);
  });

  it('pins and resets the independent header, including an explicit derived header', () => {
    let stored = selectAppearanceTemplate('clean');
    const initial = appearanceRamp(resolveAppearance(stored));
    expect(initial.header).toBe(initial.raised);
    stored = setAppearanceOverride(stored, 'colors.header', '#211741');
    stored = setAppearanceOverride(stored, 'colors.panel', '#ffeedd');
    const pinned = appearanceRamp(resolveAppearance(stored));
    expect(pinned.header).toBe('#211741');
    expect(pinned.headerInk).toBe(appearanceInk(pinned.header));
    stored = resetAppearanceOverride(stored, 'colors.header');
    const reset = appearanceRamp(resolveAppearance(stored));
    expect(reset.header).toBe(reset.raised);
    expect(reset.header).not.toBe(initial.header);
    expect(stored.overrides.colors).toEqual({ panel: '#ffeedd' });

    const indigo = selectAppearanceTemplate('indigo');
    const auto = setAppearanceOverride(indigo, 'colors.header', null);
    expect(parseAppearanceSelection(auto).ok).toBe(true);
    const autoRamp = appearanceRamp(resolveAppearance(auto));
    expect(autoRamp.header).toBe(autoRamp.raised);
    expect(resolveAppearance(resetAppearanceOverride(auto, 'colors.header'))).toEqual(APPEARANCE_TEMPLATES.indigo);
  });

  it('validates header colours at stored and public boundaries', () => {
    for (const value of ['red', '#123', '', 42, {}, undefined]) {
      const stored = setAppearanceOverride(selectAppearanceTemplate('clean'), 'colors.header', value);
      expect(parseAppearanceSelection(stored).ok).toBe(false);
      expect(parseAppearance(resolveAppearance(stored)).ok).toBe(false);
    }
    const appearance = resolveAppearance(selectAppearanceTemplate('clean'));
    const { header: _header, ...incompleteColors } = appearance.colors;
    expect(parseAppearance({ ...appearance, colors: incompleteColors }).ok).toBe(false);
  });

  it('keeps Indigo a plain contrasting header without a lobby or downloaded font', () => {
    const indigo = APPEARANCE_TEMPLATES.indigo;
    expect(indigo.header).toEqual({ subtitle: '', showAvatar: false, showMessageName: false });
    expect(indigo.avatarUrl).toBe('');
    expect(indigo.typography.fontFamily).toBe('system');
    expect(indigo.width).toBe(477);
    expect(indigo.height).toBe(711);
    expect(indigo.radius).toBe(22);
    expect(contrast(appearanceRamp(indigo).header, indigo.colors.panel)).toBeGreaterThanOrEqual(7);
  });
});
