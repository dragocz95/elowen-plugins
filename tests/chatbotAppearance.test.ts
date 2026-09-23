import { beforeEach, describe, expect, it } from 'vitest';
import type { PluginApiAuth } from 'elowen/plugin-api';
import {
  APPEARANCE_BOUNDS,
  APPEARANCE_ICONS,
  APPEARANCE_TEMPLATES,
  APPEARANCE_TEMPLATE_IDS,
  APPEARANCE_SCHEMA_VERSION,
  APPEARANCE_QUICK_BUTTON_MAX_CHARS,
  DEFAULT_STORED_APPEARANCE,
  parseAppearanceSelection,
  resolveAppearance,
  appearanceIconSvg,
  selectAppearanceTemplate,
  setAppearanceOverride,
  resetAppearanceOverride,
  isAppearanceOverridden,
  type StoredAppearance,
  type AppearanceOverrides,
  APPEARANCE_QUICK_BUTTONS_MAX,
  DEFAULT_APPEARANCE,
  appearanceInk,
  appearanceShade,
  parseAppearance,
  parseStoredAppearance,
  type ChatbotAppearance,
} from '../plugins/chatbot/src/appearanceContract.js';
import { createAdminApi } from '../plugins/chatbot/src/adminApi.js';
import { CHATBOT_SITE, createChatbotHost, postRequest, publicRequest, registerBot, type ChatbotHost } from './helpers/chatbotHost.js';

/** The look a chatbot is configured with: the ONE shape the server stores, the widget draws and the
 *  administrator previews, plus the two routes that carry it.
 *
 *  The point of these tests is the boundary: an appearance is written by an authenticated administrator and
 *  read by an anonymous visitor's widget, so the same value has to survive both directions intact and a
 *  malformed one has to be refused in the direction it arrives from. */

const admin: PluginApiAuth = { userId: 1, admin: true, tokenScope: 'user', accessibleProjects: null };
const visitor: PluginApiAuth = { userId: 2, admin: false, tokenScope: 'user', accessibleProjects: [] };

/** The administrator's clock. A write stamps `updated_at` from it, so a test that makes two writes advance
 *  it — which is exactly what makes the second one stale. */
let clockMs = Date.parse('2026-09-21T12:00:00.000Z');
const adminApi = (host: ChatbotHost): ReturnType<typeof createAdminApi> => createAdminApi({
  store: host.store,
  stores: host.stores,
  publicBaseUrl: () => 'https://elowen.example.com',
  now: () => new Date(clockMs),
});

let host: ChatbotHost;
let api: ReturnType<typeof createAdminApi>;
beforeEach(() => {
  clockMs = Date.parse('2026-09-21T12:00:00.000Z');
  host = createChatbotHost();
  api = adminApi(host);
});

const storedOf = (overrides: AppearanceOverrides = {}): StoredAppearance => ({
  ...selectAppearanceTemplate('elowen'), overrides,
});

describe('linked appearance templates', () => {
  it.each(APPEARANCE_TEMPLATE_IDS)('resolves every complete template: %s', template => {
    const stored = selectAppearanceTemplate(template);
    expect(stored).toEqual({ schemaVersion: 2, template, overrides: {} });
    expect(parseAppearanceSelection(stored)).toEqual({ ok: true, value: stored });
    const resolved = resolveAppearance(stored);
    expect(resolved).toEqual(APPEARANCE_TEMPLATES[template]);
    expect(parseAppearance(resolved)).toEqual({ ok: true, value: resolved });
    expect(resolved).not.toHaveProperty('template');
    expect(resolved).not.toHaveProperty('overrides');
  });

  it('inherits improvements only where no explicit override exists, even when values match', () => {
    let stored = storedOf();
    stored = setAppearanceOverride(stored, 'colors.panel', DEFAULT_APPEARANCE.colors.panel);
    expect(isAppearanceOverridden(stored, 'colors.panel')).toBe(true);
    expect(parseAppearanceSelection(stored)).toEqual({ ok: true, value: stored });
    const original = APPEARANCE_TEMPLATES.elowen.colors;
    try {
      APPEARANCE_TEMPLATES.elowen.colors = { ...original, panel: '#111111', launcher: '#222222' };
      const appearance = resolveAppearance(stored);
      expect(appearance.colors.panel).toBe(original.panel);
      expect(appearance.colors.launcher).toBe('#222222');
      stored = resetAppearanceOverride(stored, 'colors.panel');
      expect(isAppearanceOverridden(stored, 'colors.panel')).toBe(false);
      expect(resolveAppearance(stored).colors.panel).toBe('#111111');
      expect(stored.overrides).toEqual({});
    } finally { APPEARANCE_TEMPLATES.elowen.colors = original; }
  });

  it('switches templates by discarding all overrides and does not mutate a template', () => {
    const previous = setAppearanceOverride(storedOf(), 'launcher.label', 'Ask us');
    const next = selectAppearanceTemplate('warm');
    expect(next.overrides).toEqual({});
    expect(resolveAppearance(next)).toEqual(APPEARANCE_TEMPLATES.warm);
    expect(resolveAppearance(previous).launcher.label).toBe('Ask us');
    const resolved = resolveAppearance(previous);
    resolved.colors.panel = '#ffffff';
    resolved.launcher.label = 'Changed';
    expect(APPEARANCE_TEMPLATES.elowen.launcher.label).toBe('');
    expect(previous.overrides.launcher?.label).toBe('Ask us');
  });

  it('refuses unknown versions, templates, keys and icon ids on both boundaries', () => {
    expect(parseAppearanceSelection({ ...storedOf(), schemaVersion: 1 }).ok).toBe(false);
    expect(parseAppearanceSelection({ ...storedOf(), template: 'missing' }).ok).toBe(false);
    expect(parseAppearanceSelection({ ...storedOf(), css: 'body{}' }).ok).toBe(false);
    expect(parseAppearanceSelection({ ...storedOf(), overrides: { header: { unknown: true } } }).ok).toBe(false);
    for (const overrides of [{ send: { icon: 'missing' } }, { launcher: { icon: 'missing' } }, { quickButtons: [{ text: 'Ask', icon: 'missing' }] }]) {
      expect(parseAppearanceSelection({ ...storedOf(), overrides }).ok).toBe(false);
      expect(parseAppearance({ ...DEFAULT_APPEARANCE, ...overrides }).ok).toBe(false);
    }
    expect(parseAppearance({ ...DEFAULT_APPEARANCE, schemaVersion: APPEARANCE_SCHEMA_VERSION + 1 }).ok).toBe(false);
    expect(parseAppearance({ ...DEFAULT_APPEARANCE, colors: { ...DEFAULT_APPEARANCE.colors, panel: 'black' } }).ok).toBe(false);
    const futureFields = parseAppearance({ ...DEFAULT_APPEARANCE, colors: { ...DEFAULT_APPEARANCE.colors, futureColor: '#ffffff' } });
    expect(futureFields.ok).toBe(true);
    if (futureFields.ok) expect(futureFields.value.colors).toEqual(DEFAULT_APPEARANCE.colors);
  });

  it('stores quick buttons as text and nullable curated icons, without silently dropping entries', () => {
    const quickButtons = [{ text: 'Ask', icon: null }, { text: 'Book', icon: 'calendar' as const }];
    expect(parseAppearanceSelection(storedOf({ quickButtons }))).toEqual({ ok: true, value: storedOf({ quickButtons }) });
    const invalid = [
      ['Ask'], [{ text: 'Ask' }], [{ text: '', icon: null }],
      [{ text: 'Ask', icon: null }, { text: 'Ask', icon: 'phone' }],
      [{ text: 'x'.repeat(APPEARANCE_QUICK_BUTTON_MAX_CHARS + 1), icon: null }],
      Array.from({ length: APPEARANCE_QUICK_BUTTONS_MAX + 1 }, (_, i) => ({ text: String(i), icon: null })),
    ];
    for (const buttons of invalid) {
      expect(parseAppearanceSelection({ ...storedOf(), overrides: { quickButtons: buttons } }).ok).toBe(false);
      expect(parseAppearance({ ...DEFAULT_APPEARANCE, quickButtons: buttons }).ok).toBe(false);
    }
  });

  it.each([
    ['width', 'width'], ['height', 'height'], ['radius', 'radius'],
    ['launcher.size', 'launcherSize'], ['launcher.offset', 'launcherOffset'], ['typography.fontSize', 'fontSize'],
  ] as const)('enforces both endpoints and integer bounds for %s', (path, key) => {
    const bounds = APPEARANCE_BOUNDS[key];
    for (const value of [bounds.min, bounds.max]) {
      const stored = setAppearanceOverride(storedOf(), path, value);
      expect(parseAppearanceSelection(stored).ok).toBe(true);
      expect(parseAppearance(resolveAppearance(stored)).ok).toBe(true);
    }
    for (const value of [bounds.min - 1, bounds.max + 1, bounds.min + .5, NaN, Infinity, '14', null]) {
      const stored = setAppearanceOverride(storedOf(), path, value);
      expect(parseAppearanceSelection(stored).ok).toBe(false);
      expect(parseAppearance(resolveAppearance(stored)).ok).toBe(false);
    }
  });

  it('keeps the presence dot off until an owner asks for it, and refuses any other value', () => {
    // Off in every template, with one sensible colour standing by: a dot is decoration the owner opts into,
    // not something an existing chatbot's page suddenly grows.
    for (const template of APPEARANCE_TEMPLATE_IDS) {
      expect(APPEARANCE_TEMPLATES[template].launcher.presenceDot).toBe(false);
      expect(APPEARANCE_TEMPLATES[template].launcher.presenceDotColor).toMatch(/^#[0-9a-f]{6}$/);
    }
    const on = setAppearanceOverride(storedOf(), 'launcher.presenceDot', true);
    const coloured = setAppearanceOverride(on, 'launcher.presenceDotColor', '#3FB950');
    const parsed = parseAppearanceSelection(coloured);
    if (!parsed.ok) throw new Error(`a dot override must parse: ${parsed.error}`);
    expect(parsed.value).toEqual(storedOf({ launcher: { presenceDot: true, presenceDotColor: '#3fb950' } }));
    expect(resolveAppearance(parsed.value).launcher).toEqual({ ...APPEARANCE_TEMPLATES.elowen.launcher, presenceDot: true, presenceDotColor: '#3fb950' });

    // A value that is nothing of the sort is a rejection on both boundaries, never a quiet default.
    for (const value of ['true', 'yes', 1, null]) {
      expect(parseAppearanceSelection(setAppearanceOverride(storedOf(), 'launcher.presenceDot', value)).ok).toBe(false);
    }
    for (const value of ['green', '#123', '#1234567', 'rgb(0 255 0)', 42, null, true]) {
      expect(parseAppearanceSelection(setAppearanceOverride(storedOf(), 'launcher.presenceDotColor', value)).ok).toBe(false);
    }
    expect(parseAppearanceSelection({ ...storedOf(), overrides: { launcher: { presence: true } } }).ok).toBe(false);
    expect(parseAppearanceSelection({ ...storedOf(), overrides: { launcher: { presenceDot: true, presence: '#22c55e' } } }).ok).toBe(false);

    // The public look is COMPLETE: a widget reading it can never find the field missing and guess.
    const resolved = resolveAppearance(coloured);
    expect(parseAppearance(resolved).ok).toBe(true);
    const { presenceDot: _dot, ...withoutDot } = resolved.launcher;
    const { presenceDotColor: _colour, ...withoutColour } = resolved.launcher;
    expect(parseAppearance({ ...resolved, launcher: withoutDot }).ok).toBe(false);
    expect(parseAppearance({ ...resolved, launcher: withoutColour }).ok).toBe(false);
  });

  it('reads a row written before the dot existed through the same partial-over-template merge', () => {
    // What the previous version stored: the same shape it stores now, holding only what the owner pinned. The
    // stored format did not change, so nothing is migrated and no "old shape" branch exists — the field the
    // row does not carry comes from the template, exactly as every other unset field does.
    const legacy = JSON.stringify({ schemaVersion: 2, template: 'mono', overrides: { launcher: { size: 64, label: 'Napište nám' } } });
    const stored = parseStoredAppearance(legacy);
    expect(stored).toEqual({ ...selectAppearanceTemplate('mono'), overrides: { launcher: { size: 64, label: 'Napište nám' } } });
    expect(stored.overrides.launcher).toEqual({ size: 64, label: 'Napište nám' });
    const appearance = resolveAppearance(stored);
    expect(appearance.launcher).toEqual({ ...APPEARANCE_TEMPLATES.mono.launcher, size: 64, label: 'Napište nám' });
    expect(appearance.launcher.presenceDot).toBe(false);
    expect(parseAppearance(appearance).ok).toBe(true);
  });

  it('offers every launcher icon to quick buttons too', () => {
    // One catalog feeds both pickers, so an icon added for the launcher is a quick-button icon by
    // construction: the parser accepts it and the shape of the entry is the same single path.
    for (const icon of APPEARANCE_ICONS) {
      expect(icon.path).not.toBe('');
      const stored = storedOf({ launcher: { icon: icon.id }, quickButtons: [{ text: `Ask ${icon.id}`, icon: icon.id }] });
      expect(parseAppearanceSelection(stored)).toEqual({ ok: true, value: stored });
      expect(parseAppearance(resolveAppearance(stored)).ok).toBe(true);
      expect(appearanceIconSvg(icon.id)).toContain(icon.path);
    }
    // A friendly face sits alongside the speech bubble, so a launcher can read as a person.
    expect(APPEARANCE_ICONS.map((icon) => icon.id)).toEqual(expect.arrayContaining(['speech-bubble', 'smile', 'heart', 'thumb-up']));
  });

  it('validates text, avatar URLs, booleans, font families, shapes and shadows', () => {
    for (const avatarUrl of ['javascript:alert(1)', '/logo.svg', 'data:text/html,<b>x</b>']) {
      expect(parseAppearanceSelection(storedOf({ avatarUrl })).ok).toBe(false);
    }
    for (const avatarUrl of ['', 'https://example.com/a.png', 'data:image/png;base64,AAA']) {
      expect(parseAppearanceSelection(storedOf({ avatarUrl })).ok).toBe(true);
    }
    for (const [path, value] of [
      ['header.subtitle', 'x'.repeat(81)], ['launcher.label', 'x'.repeat(25)],
      ['typography.placeholder', 'x'.repeat(81)], ['header.showAvatar', 'true'],
      ['typography.fontFamily', 'remote'], ['typography.shadow', 'huge'], ['send.shape', 'triangle'],
    ] as const) expect(parseAppearanceSelection(setAppearanceOverride(storedOf(), path, value)).ok).toBe(false);
    const parsed = parseAppearanceSelection(storedOf({ intro: '  Hello  ', colors: { panel: '#AABBCC' } }));
    expect(parsed.ok && parsed.value.overrides).toEqual({ intro: 'Hello', colors: { panel: '#aabbcc' } });
  });

  it('defaults only an unconfigured NULL row and refuses corrupted storage', () => {
    expect(parseStoredAppearance(null)).toEqual(DEFAULT_STORED_APPEARANCE);
    for (const raw of ['', '{bad json', '{"schemaVersion":1}', '{"schemaVersion":9}']) {
      expect(() => parseStoredAppearance(raw)).toThrow();
    }
    expect(parseStoredAppearance(JSON.stringify(storedOf({ intro: 'Hi' })))).toEqual(storedOf({ intro: 'Hi' }));
  });

  it('chooses contrasting bubble ink and shades within the configured colour', () => {
    expect(appearanceInk('#ffffff')).toBe('#1b1917');
    expect(appearanceInk('#070707')).toBe('#f7f3f0');
    expect(appearanceShade('#000000', 'lighter', .5)).toBe('#808080');
    expect(appearanceShade('#ffffff', 'darker', .5)).toBe('#808080');
  });
});

describe('the appearance an administrator saves', () => {
  it('stores the look and the name together, and reports both back', async () => {
    registerBot(host);
    const before = host.store.listBots()[0]!;
    const answer = await api.updateAppearance(admin, {
      chatbotUserId: before.chatbot_user_id,
      expectedUpdatedAt: before.updated_at,
      displayName: 'Městský úřad Kolín',
      appearance: storedOf({ intro: 'Dobrý den.', quickButtons: [{ text: 'Chci vyplnit formulář', icon: null }] }),
    });

    expect(answer.status).toBe(200);
    const view = (answer.body as { bot: { displayName: string; appearance: StoredAppearance } }).bot;
    expect(view.displayName).toBe('Městský úřad Kolín');
    expect(view.appearance.overrides.intro).toBe('Dobrý den.');
    expect(view.appearance.overrides.quickButtons).toEqual([{ text: 'Chci vyplnit formulář', icon: null }]);
    // The row really moved: the same read the page makes before it opens the editor answers the saved look.
    const stored = host.store.listBots()[0]!;
    expect(stored.display_name).toBe('Městský úřad Kolín');
    expect(parseStoredAppearance(stored.appearance).overrides.intro).toBe('Dobrý den.');
  });

  it('refuses a malformed appearance with the reason, and writes nothing', async () => {
    registerBot(host);
    const before = host.store.listBots()[0]!;
    const answer = await api.updateAppearance(admin, {
      chatbotUserId: before.chatbot_user_id,
      expectedUpdatedAt: before.updated_at,
      displayName: before.display_name,
      appearance: { ...storedOf(), overrides: { send: { icon: 'unknown-icon' } } },
    });
    expect(answer.status).toBe(400);
    expect((answer.body as { error: string }).error).toBe('invalid_request');
    expect(host.store.listBots()[0]!.appearance).toBeNull();
  });

  it('refuses a stale write rather than replacing another administrator\'s', async () => {
    registerBot(host);
    const before = host.store.listBots()[0]!;
    const first = await api.updateAppearance(admin, {
      chatbotUserId: before.chatbot_user_id,
      expectedUpdatedAt: before.updated_at,
      displayName: before.display_name,
      appearance: storedOf({ radius: 2 }),
    });
    expect(first.status).toBe(200);
    // A second administrator, holding the row they read before the first one saved.
    clockMs += 1000;

    const second = await api.updateAppearance(admin, {
      chatbotUserId: before.chatbot_user_id,
      expectedUpdatedAt: before.updated_at,
      displayName: before.display_name,
      appearance: storedOf({ radius: 20 }),
    });
    expect(second.status).toBe(409);
    expect(parseStoredAppearance(host.store.listBots()[0]!.appearance).overrides.radius).toBe(2);
  });

  it('is an administrator\'s surface only, and reports an unknown chatbot', async () => {
    registerBot(host);
    expect((await api.updateAppearance(visitor, {})).status).toBe(403);
    const missing = await api.updateAppearance(admin, {
      chatbotUserId: 999,
      expectedUpdatedAt: '2026-01-01T00:00:00.000Z',
      displayName: 'Nikdo',
      appearance: storedOf(),
    });
    expect(missing.status).toBe(404);
  });

  it('carries the parsed look in every list read, so the editor never starts from its own guess', async () => {
    registerBot(host);
    const listed = await api.list(admin);
    const bots = (listed.body as { bots: { appearance: StoredAppearance }[] }).bots;
    expect(bots[0]!.appearance).toEqual(DEFAULT_STORED_APPEARANCE);
  });
});

describe('the appearance a visitor\'s widget reads', () => {
  /** One live visitor, exactly as the widget gets one: the adapter has to be connected and the bot enabled
   *  before the hook will issue a token at all, so a test that skips either would be testing a refusal. */
  const liveVisitor = async (): Promise<{ token: string; visitorId: string }> => {
    await host.adapter.connect();
    const answer = await host.handler(postRequest({
      path: 'visitors',
      headers: { origin: CHATBOT_SITE },
      body: { schemaVersion: 2, bot: host.store.listBots()[0]!.public_id },
    }));
    expect(answer.status).toBe(200);
    const body = answer.body as { token: string; visitorId: string };
    return { token: body.token, visitorId: body.visitorId };
  };

  const withToken = (token: string) => publicRequest({
    method: 'GET',
    path: 'appearance',
    headers: { origin: CHATBOT_SITE, authorization: `ChatbotVisitor ${token}` },
  });

  it('hands the configured look and the chatbot\'s own name to the widget', async () => {
    registerBot(host);
    const bot = host.store.listBots()[0]!;
    host.store.updateAppearance({
      chatbotUserId: bot.chatbot_user_id,
      expectedUpdatedAt: bot.updated_at,
      displayName: 'Městský úřad',
      appearance: JSON.stringify(storedOf({ mode: 'light', quickButtons: [{ text: 'Kde je podatelna?', icon: 'question' }] })),
      now: '2026-09-21T12:00:00.000Z',
    });

    await host.adapter.connect();
    const bootstrap = await host.handler(postRequest({
      path: 'bootstrap',
      headers: { origin: CHATBOT_SITE },
      body: { schemaVersion: 2, bot: bot.public_id },
    }));
    expect(bootstrap).toMatchObject({ status: 200, body: {
      name: 'Městský úřad',
      appearance: resolveAppearance(storedOf({ mode: 'light', quickButtons: [{ text: 'Kde je podatelna?', icon: 'question' }] })),
    } });
    const issued = await liveVisitor();
    const answer = await host.handler(withToken(issued.token));
    expect(answer.status).toBe(200);
    const body = answer.body as { schemaVersion: number; name: string; appearance: ChatbotAppearance };
    expect(body.schemaVersion).toBe(2);
    expect(body.name).toBe('Městský úřad');
    expect(body.appearance.mode).toBe('light');
    expect(body.appearance).not.toHaveProperty('template');
    expect(body.appearance).not.toHaveProperty('overrides');
    expect(body.appearance.quickButtons).toEqual([{ text: 'Kde je podatelna?', icon: 'question' }]);
    // It is a read of state on a visitor's behalf, so nothing between the two ends may keep a copy.
    expect(answer.headers?.['cache-control']).toBe('no-store');
    expect(answer.headers?.['access-control-allow-origin']).toBe(CHATBOT_SITE);
  });

  it('reads the look with token issuance gates and creates no visitor or token rows', async () => {
    registerBot(host);
    await host.adapter.connect();
    const bot = host.store.listBots()[0]!;
    const counts = () => ({
      visitors: (host.db.prepare('SELECT COUNT(*) AS count FROM p_chatbot_visitors').get() as { count: number }).count,
      tokens: (host.db.prepare('SELECT COUNT(*) AS count FROM p_chatbot_tokens').get() as { count: number }).count,
    });
    expect(counts()).toEqual({ visitors: 0, tokens: 0 });

    const answer = await host.handler(postRequest({
      path: 'bootstrap',
      headers: { origin: CHATBOT_SITE },
      body: { schemaVersion: 2, bot: bot.public_id },
    }));
    expect(answer.status).toBe(200);
    expect((answer.body as { appearance: ChatbotAppearance }).appearance).toEqual(DEFAULT_APPEARANCE);
    expect(counts()).toEqual({ visitors: 0, tokens: 0 });

    const wrongOrigin = await host.handler(postRequest({
      path: 'bootstrap',
      headers: { origin: 'https://evil.example' },
      body: { schemaVersion: 2, bot: bot.public_id },
    }));
    expect(wrongOrigin.status).toBe(403);
    expect((await host.handler(postRequest({
      path: 'bootstrap',
      headers: { origin: CHATBOT_SITE },
      body: { schemaVersion: 2, bot: `cbt_${'b'.repeat(24)}` },
    }))).status).toBe(404);
    expect(counts()).toEqual({ visitors: 0, tokens: 0 });
  });

  it('serves the presence dot an owner turned on, and nothing where nobody turned one on', async () => {
    registerBot(host);
    const bot = host.store.listBots()[0]!;
    host.store.updateAppearance({
      chatbotUserId: bot.chatbot_user_id,
      expectedUpdatedAt: bot.updated_at,
      displayName: 'Městský úřad',
      appearance: JSON.stringify(storedOf({ launcher: { presenceDot: true, presenceDotColor: '#123456' } })),
      now: '2026-09-21T12:00:00.000Z',
    });
    const answer = await host.handler(withToken((await liveVisitor()).token));
    expect(answer.status).toBe(200);
    // The dot the visitor's widget draws is the one the owner saved, ringed in that launcher's own colour.
    expect((answer.body as { appearance: ChatbotAppearance }).appearance.launcher)
      .toEqual({ ...APPEARANCE_TEMPLATES.elowen.launcher, presenceDot: true, presenceDotColor: '#123456' });
  });

  it('answers the widget\'s own built-in look for a chatbot nobody has configured yet', async () => {
    registerBot(host);
    const answer = await host.handler(withToken((await liveVisitor()).token));
    expect(answer.status).toBe(200);
    expect((answer.body as { appearance: ChatbotAppearance }).appearance).toEqual(DEFAULT_APPEARANCE);
  });

  it('refuses a chatbot that is no longer enabled, or whose account has lost its Project', async () => {
    const projects = [{ id: 4, slug: 'ured', path: '/ured', executionKind: 'managed' as const, lifecycle: 'active' as const }];
    host = createChatbotHost({ projects });
    api = adminApi(host);
    registerBot(host);
    const { token } = await liveVisitor();
    expect((await host.handler(withToken(token))).status).toBe(200);

    // Disabled while its visitor still holds a live token: the same refusal a message would meet.
    host.store.setBotStatus({ chatbotUserId: 12, status: 'disabled', now: '2026-09-21T12:00:00.000Z' });
    expect((await host.handler(withToken(token))).status).toBe(404);
    host.store.setBotStatus({ chatbotUserId: 12, status: 'enabled', now: '2026-09-21T12:00:01.000Z' });

    // The account invariant is re-checked on every read, exactly as it is before every admitted message.
    projects.length = 0;
    expect((await host.handler(withToken(token))).status).toBe(503);
  });

  it('refuses a caller with no token, and one whose token the server no longer honours', async () => {
    registerBot(host);
    const { token, visitorId } = await liveVisitor();
    expect((await host.handler(publicRequest({
      method: 'GET',
      path: 'appearance',
      headers: { origin: CHATBOT_SITE },
    }))).status).toBe(401);
    expect((await host.handler(withToken('not-a-token'))).status).toBe(401);

    // A rotation revokes the token it replaced, so a widget holding the old one is refused immediately.
    host.store.issueToken({
      jti: 'a-fresh-token',
      chatbotUserId: 12,
      visitorId,
      tokenHash: 'a-hash-that-will-not-match',
      issuedAt: '2026-09-21T12:00:00.000Z',
      expiresAt: '2026-09-21T13:00:00.000Z',
      rotate: true,
    });
    expect((await host.handler(withToken(token))).status).toBe(401);
  });

  it('refuses a site the chatbot does not answer on', async () => {
    registerBot(host);
    const { token } = await liveVisitor();
    const elsewhere = publicRequest({
      method: 'GET',
      path: 'appearance',
      headers: { origin: 'https://www.nekdo-jiny.cz', authorization: `ChatbotVisitor ${token}` },
    });
    expect((await host.handler(elsewhere)).status).toBe(403);
  });

  it('refuses rather than inventing a look when its own row can no longer be read', async () => {
    registerBot(host);
    const bot = host.store.listBots()[0]!;
    const { token } = await liveVisitor();
    // A row only this plugin writes, corrupted. The bootstrap refuses it; nothing draws a look the customer never chose.
    host.db.prepare('UPDATE p_chatbot_bots SET appearance = ? WHERE chatbot_user_id = ?').run('{"schemaVersion":9}', bot.chatbot_user_id);
    const answer = await host.handler(withToken(token));
    expect(answer.status).toBe(503);
    expect((answer.body as { error: string }).error).toBe('appearance_invalid');
    const bootstrap = await host.handler(postRequest({
      path: 'bootstrap',
      headers: { origin: CHATBOT_SITE },
      body: { schemaVersion: 2, bot: bot.public_id },
    }));
    expect(bootstrap).toMatchObject({ status: 503, body: { error: 'appearance_invalid' } });
    expect(bootstrap.headers?.['access-control-allow-origin']).toBe(CHATBOT_SITE);
    // The grant travels with the refusal: without it a browser reports a CORS failure on the customer's own
    // page instead of the refusal, which is a console error nobody can act on.
    expect(answer.headers?.['access-control-allow-origin']).toBe(CHATBOT_SITE);
    expect(host.warnings.some((warning) => warning.includes('unreadable appearance'))).toBe(true);
  });
});
