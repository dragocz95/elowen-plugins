import { describe, expect, it } from 'vitest';
import {
  APPEARANCE_BOUNDS, APPEARANCE_TEMPLATES, APPEARANCE_TEMPLATE_IDS, APPEARANCE_TEASER_MAX_CHARS,
  parseAppearance, parseAppearanceSelection, resolveAppearance, selectAppearanceTemplate, setAppearanceOverride,
} from '../plugins/chatbot/src/appearanceContract';
import { effectsCss, chatEffectsCss, buttonStyles } from '../plugins/chatbot/embed-src/effects';

describe('lively appearance contract', () => {
  const stored = () => selectAppearanceTemplate('elowen');
  it.each(APPEARANCE_TEMPLATE_IDS)('resolves all new defaults for %s', template => {
    const look = resolveAppearance(selectAppearanceTemplate(template));
    expect(look).toEqual(APPEARANCE_TEMPLATES[template]);
    expect(look.schemaVersion).toBe(2);
    expect(look.launcher.teaser).toBe('');
    expect(look.launcher.unreadBadge).toBe(true);
    expect(parseAppearance(look).ok).toBe(true);
  });

  it.each([
    ['effects.glassBlur', 'glassBlur'], ['effects.glassOpacity', 'glassOpacity'],
    ['effects.buttonIntensity', 'buttonIntensity'], ['launcher.teaserDelay', 'teaserDelay'],
    ['launcher.nudgeDelay', 'nudgeDelay'], ['sound.volume', 'soundVolume'],
  ] as const)('validates %s at both bounds', (path, key) => {
    const { min, max } = APPEARANCE_BOUNDS[key];
    for (const value of [min, max]) expect(parseAppearanceSelection(setAppearanceOverride(stored(), path, value)).ok).toBe(true);
    for (const value of [min - 1, max + 1, .5, null, '20']) {
      expect(parseAppearanceSelection(setAppearanceOverride(stored(), path, value)).ok).toBe(false);
    }
  });

  it.each([
    ['effects.buttonHover', ['lift', 'fill', 'shine', 'glow']],
    ['effects.messageEntrance', ['none', 'fade', 'slide']],
    ['sound.tone', ['none', 'drop', 'chime', 'pop', 'bell']],
    ['launcher.nudge', ['none', 'bounce', 'wiggle']],
  ] as const)('accepts only valid %s', (path, choices) => {
    for (const value of choices) expect(parseAppearanceSelection(setAppearanceOverride(stored(), path, value)).ok).toBe(true);
    expect(parseAppearanceSelection(setAppearanceOverride(stored(), path, 'unknown')).ok).toBe(false);
  });

  it('bounds teaser text, validates nullable gradient ends and booleans', () => {
    expect(parseAppearanceSelection(setAppearanceOverride(stored(), 'launcher.teaser', 'x'.repeat(APPEARANCE_TEASER_MAX_CHARS))).ok).toBe(true);
    expect(parseAppearanceSelection(setAppearanceOverride(stored(), 'launcher.teaser', 'x'.repeat(APPEARANCE_TEASER_MAX_CHARS + 1))).ok).toBe(false);
    for (const key of ['visitorBubbleEnd', 'headerEnd', 'launcherEnd'] as const) {
      expect(parseAppearanceSelection(setAppearanceOverride(stored(), `colors.${key}`, null)).ok).toBe(true);
      expect(parseAppearanceSelection(setAppearanceOverride(stored(), `colors.${key}`, '#123456')).ok).toBe(true);
      expect(parseAppearanceSelection(setAppearanceOverride(stored(), `colors.${key}`, 'red')).ok).toBe(false);
    }
    for (const key of ['effects.glass', 'launcher.ring', 'launcher.unreadBadge'] as const) {
      expect(parseAppearanceSelection(setAppearanceOverride(stored(), key, 'true')).ok).toBe(false);
    }
  });

  it('filters unknown fields for a cached widget and still parses v2 partial selections', () => {
    const look = resolveAppearance(stored());
    expect(parseAppearance({
      ...look, futureGroup: { novelty: true },
      effects: { ...look.effects, future: 'ignored' },
      sound: { ...look.sound, future: 42 },
    })).toEqual({ ok: true, value: look });
    expect(parseAppearanceSelection({ schemaVersion: 2, template: 'mono', overrides: { colors: { panel: '#141414' } } }).ok).toBe(true);
  });

  it('uses deep-chat state styles and disables CSS motion when reduced motion is requested', () => {
    const look = APPEARANCE_TEMPLATES.indigo;
    expect(buttonStyles(look).hover.filter).toContain('brightness');
    expect(buttonStyles(look).click.transform).toContain('scale');
    expect(chatEffectsCss(look)).toContain('@media (prefers-reduced-motion: reduce)');
    expect(chatEffectsCss(look)).toContain('.message-bubble { animation: none');
    expect(chatEffectsCss(look)).toContain('.name.start-item-position { display: none');
    expect(effectsCss(look)).toContain('.launcher-ring, .launcher-nudge-bounce, .launcher-nudge-wiggle { animation: none');
  });
});
