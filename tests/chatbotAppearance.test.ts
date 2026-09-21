import { beforeEach, describe, expect, it } from 'vitest';
import type { PluginApiAuth } from 'elowen/plugin-api';
import {
  APPEARANCE_BOUNDS,
  APPEARANCE_PRESETS,
  APPEARANCE_QUICK_BUTTONS_MAX,
  DEFAULT_APPEARANCE,
  appearanceInk,
  appearanceShade,
  parseAppearance,
  parseStoredAppearance,
  presetAppearance,
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

const appearanceOf = (overrides: Partial<ChatbotAppearance> = {}): ChatbotAppearance => ({
  ...DEFAULT_APPEARANCE,
  ...overrides,
});

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

describe('the appearance a customer configures', () => {
  it('parses a complete document and keeps every value it was given', () => {
    const configured = appearanceOf({
      mode: 'light',
      position: 'top-left',
      width: 480,
      height: 700,
      radius: 4,
      colors: { panel: '#ffffff', visitorBubble: '#112233', botBubble: '#f3efec', sendButton: '#ff5236' },
      intro: '  Dobrý den.  ',
      avatarUrl: 'https://www.example.cz/logo.svg',
      quickButtons: ['Chci vyplnit formulář', 'Kde je podatelna?'],
    });
    const parsed = parseAppearance(configured);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // The greeting is trimmed and the colours are normalised, so two documents that mean the same thing are
    // the same document.
    expect(parsed.value.intro).toBe('Dobrý den.');
    expect(parsed.value.colors.panel).toBe('#ffffff');
    expect(parsed.value.quickButtons).toEqual(['Chci vyplnit formulář', 'Kde je podatelna?']);
  });

  it('refuses an unknown field rather than ignoring it', () => {
    const parsed = parseAppearance({ ...appearanceOf(), theme: 'midnight' });
    expect(parsed).toEqual({ ok: false, error: 'appearance has an unknown field "theme"' });
  });

  it('refuses an unknown colour key, a colour that is not #rrggbb and a size outside its bounds', () => {
    const colourKey = parseAppearance({ ...appearanceOf(), colors: { ...APPEARANCE_PRESETS.dark, link: '#ffffff' } });
    expect(colourKey.ok).toBe(false);
    const notAColour = parseAppearance({ ...appearanceOf(), colors: { ...APPEARANCE_PRESETS.dark, panel: 'black' } });
    expect(notAColour).toEqual({ ok: false, error: '"panel" must be a colour written as #rrggbb' });
    const tooWide = parseAppearance({ ...appearanceOf(), width: APPEARANCE_BOUNDS.width.max + 1 });
    expect(tooWide.ok).toBe(false);
    const notWhole = parseAppearance({ ...appearanceOf(), radius: 8.5 });
    expect(notWhole.ok).toBe(false);
  });

  it('refuses a version it does not know instead of reading it as its own', () => {
    expect(parseAppearance({ ...appearanceOf(), schemaVersion: 2 })).toEqual({ ok: false, error: '"schemaVersion" must be 1' });
  });

  it('refuses an avatar that is not an image, and any address that is not http, https or an image', () => {
    expect(parseAppearance({ ...appearanceOf(), avatarUrl: 'javascript:alert(1)' }).ok).toBe(false);
    expect(parseAppearance({ ...appearanceOf(), avatarUrl: '/logo.svg' }).ok).toBe(false);
    expect(parseAppearance({ ...appearanceOf(), avatarUrl: 'data:text/html,<b>x</b>' }).ok).toBe(false);
    expect(parseAppearance({ ...appearanceOf(), avatarUrl: 'data:image/png;base64,AAA' }).ok).toBe(true);
    expect(parseAppearance({ ...appearanceOf(), avatarUrl: 'https://www.example.cz/logo.svg' }).ok).toBe(true);
  });

  it('treats an empty greeting as "the widget\'s own" rather than as an empty message', () => {
    const parsed = parseAppearance({ ...appearanceOf(), intro: '   ' });
    expect(parsed.ok && parsed.value.intro).toBeNull();
  });

  it('bounds the quick buttons and collapses a repeated one', () => {
    const many = Array.from({ length: APPEARANCE_QUICK_BUTTONS_MAX + 1 }, (_, index) => `Tlačítko ${index}`);
    expect(parseAppearance({ ...appearanceOf(), quickButtons: many }).ok).toBe(false);
    const repeated = parseAppearance({ ...appearanceOf(), quickButtons: ['Dotaz', 'Dotaz'] });
    expect(repeated.ok && repeated.value.quickButtons).toEqual(['Dotaz']);
    // A button a visitor could not read or press is refused: it is the text of a message they send.
    expect(parseAppearance({ ...appearanceOf(), quickButtons: ['   '] }).ok).toBe(false);
    expect(parseAppearance({ ...appearanceOf(), quickButtons: ['x'.repeat(41)] }).ok).toBe(false);
  });

  it('answers a chatbot nobody has configured with the built-in look, and an unreadable row with a failure', () => {
    expect(parseStoredAppearance(null)).toEqual(DEFAULT_APPEARANCE);
    expect(parseStoredAppearance(JSON.stringify(appearanceOf({ mode: 'light' }))).mode).toBe('light');
    // A row this plugin wrote and can no longer read is CORRUPT, and saying so beats drawing a look nobody
    // chose — the public route refuses and the widget keeps its own panel.
    expect(() => parseStoredAppearance('{not json')).toThrow(/not JSON/);
    expect(() => parseStoredAppearance(JSON.stringify({ schemaVersion: 1, mode: 'dusk' }))).toThrow(/invalid/);
  });

  it('picks the ink that reads on the colour the customer chose, and shades only within their colour', () => {
    expect(appearanceInk('#ffffff')).toBe('#1b1917');
    expect(appearanceInk('#070707')).toBe('#f7f3f0');
    expect(appearanceInk('#ff5236')).toBe('#1b1917');
    expect(appearanceShade('#000000', 'lighter', 0.5)).toBe('#808080');
    expect(appearanceShade('#ffffff', 'darker', 0.5)).toBe('#808080');
    expect(appearanceShade('#070707', 'lighter', 0.12)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('offers each mode its own colour set, and leaves the rest of the look alone', () => {
    const light = presetAppearance('light');
    expect(light.mode).toBe('light');
    expect(light.colors).toEqual(APPEARANCE_PRESETS.light);
    expect(light.width).toBe(DEFAULT_APPEARANCE.width);
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
      appearance: appearanceOf({ intro: 'Dobrý den.', quickButtons: ['Chci vyplnit formulář'] }),
    });

    expect(answer.status).toBe(200);
    const view = (answer.body as { bot: { displayName: string; appearance: ChatbotAppearance } }).bot;
    expect(view.displayName).toBe('Městský úřad Kolín');
    expect(view.appearance.intro).toBe('Dobrý den.');
    expect(view.appearance.quickButtons).toEqual(['Chci vyplnit formulář']);
    // The row really moved: the same read the page makes before it opens the editor answers the saved look.
    const stored = host.store.listBots()[0]!;
    expect(stored.display_name).toBe('Městský úřad Kolín');
    expect(parseStoredAppearance(stored.appearance).intro).toBe('Dobrý den.');
  });

  it('refuses a malformed appearance with the reason, and writes nothing', async () => {
    registerBot(host);
    const before = host.store.listBots()[0]!;
    const answer = await api.updateAppearance(admin, {
      chatbotUserId: before.chatbot_user_id,
      expectedUpdatedAt: before.updated_at,
      displayName: before.display_name,
      appearance: { ...appearanceOf(), colors: { panel: '#ffffff' } },
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
      appearance: appearanceOf({ radius: 2 }),
    });
    expect(first.status).toBe(200);
    // A second administrator, holding the row they read before the first one saved.
    clockMs += 1000;

    const second = await api.updateAppearance(admin, {
      chatbotUserId: before.chatbot_user_id,
      expectedUpdatedAt: before.updated_at,
      displayName: before.display_name,
      appearance: appearanceOf({ radius: 20 }),
    });
    expect(second.status).toBe(409);
    expect(parseStoredAppearance(host.store.listBots()[0]!.appearance).radius).toBe(2);
  });

  it('is an administrator\'s surface only, and reports an unknown chatbot', async () => {
    registerBot(host);
    expect((await api.updateAppearance(visitor, {})).status).toBe(403);
    const missing = await api.updateAppearance(admin, {
      chatbotUserId: 999,
      expectedUpdatedAt: '2026-01-01T00:00:00.000Z',
      displayName: 'Nikdo',
      appearance: appearanceOf(),
    });
    expect(missing.status).toBe(404);
  });

  it('carries the parsed look in every list read, so the editor never starts from its own guess', async () => {
    registerBot(host);
    const listed = await api.list(admin);
    const bots = (listed.body as { bots: { appearance: ChatbotAppearance }[] }).bots;
    expect(bots[0]!.appearance).toEqual(DEFAULT_APPEARANCE);
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
      body: { schemaVersion: 1, bot: host.store.listBots()[0]!.public_id },
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
      appearance: JSON.stringify(appearanceOf({ mode: 'light', quickButtons: ['Kde je podatelna?'] })),
      now: '2026-09-21T12:00:00.000Z',
    });

    const answer = await host.handler(withToken((await liveVisitor()).token));
    expect(answer.status).toBe(200);
    const body = answer.body as { schemaVersion: number; name: string; appearance: ChatbotAppearance };
    expect(body.schemaVersion).toBe(1);
    expect(body.name).toBe('Městský úřad');
    expect(body.appearance.mode).toBe('light');
    expect(body.appearance.quickButtons).toEqual(['Kde je podatelna?']);
    // It is a read of state on a visitor's behalf, so nothing between the two ends may keep a copy.
    expect(answer.headers?.['cache-control']).toBe('no-store');
    expect(answer.headers?.['access-control-allow-origin']).toBe(CHATBOT_SITE);
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
    // A row only this plugin writes, corrupted. The visitor keeps the widget's built-in panel and the
    // refusal is logged; nothing draws a look the customer never chose.
    host.db.prepare('UPDATE p_chatbot_bots SET appearance = ? WHERE chatbot_user_id = ?').run('{"schemaVersion":9}', bot.chatbot_user_id);
    const answer = await host.handler(withToken(token));
    expect(answer.status).toBe(503);
    expect((answer.body as { error: string }).error).toBe('appearance_invalid');
    // The grant travels with the refusal: without it a browser reports a CORS failure on the customer's own
    // page instead of the refusal, which is a console error nobody can act on.
    expect(answer.headers?.['access-control-allow-origin']).toBe(CHATBOT_SITE);
    expect(host.warnings.some((warning) => warning.includes('unreadable appearance'))).toBe(true);
  });
});
