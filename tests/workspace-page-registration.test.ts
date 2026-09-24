import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHATBOT_SECTIONS } from '../plugins/chatbot/web-src/sections';

/** cronjob and skills each ship ONE settings section and no nav, which is exactly the shape the
 *  host serves at the bare `/p/<plugin>` route (`sole` in web/app/p/[plugin]/[[...rest]]/page.tsx). These
 *  bundles used to register a duplicate root page for that address and no longer do.
 *
 *  What replaces it is `ownsPageFrame`, and a mistake there is SILENT. The host matches the declared ids
 *  against `web.settings[].id` FROM THE MANIFEST, so an id that does not appear there just leaves the
 *  page frame double-wrapped: no error, only a section rendered narrower than every sibling register.
 *  Declaring nothing is a deliberate choice rather than an omission — a section that does NOT claim the
 *  frame is drawn by the host's own masthead and settings document, which is what makes it look like a
 *  page of Settings rather than a page beside it — so which of the two a bundle means is asserted, not
 *  left open.
 *
 *  `requiresApiVersion` has the same split — the host gates on the manifest's copy while the bundle
 *  carries its own — so a manifest that asks for less than the bundle needs admits a host that cannot
 *  render it. Both are therefore checked ACROSS the two files rather than against a literal in one. */

const registryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** API 8 first published the shell primitives and `ownsPageFrame`; later sections may legitimately require
 * newer host components, so the bundle and manifest must agree while both stay at or above that floor. */
const MINIMUM_API_VERSION = 8;

interface Registration {
  requiresApiVersion?: number;
  pages?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  ownsPageFrame?: string[];
}

interface ManifestWeb {
  requiresApiVersion?: number;
  nav?: { label: string; icon?: string; route?: string }[];
  adminOnly?: boolean;
  presentation?: 'page' | 'overlay';
  settings?: { id: string; placement?: 'page' | 'pluginDetail' }[];
}

const register = vi.fn();
beforeEach(() => {
  register.mockClear();
  (window as unknown as { __elowenRegisterPluginUi?: typeof register }).__elowenRegisterPluginUi = register;
});

function manifestWeb(plugin: string): ManifestWeb {
  const path = join(registryRoot, 'plugins', plugin, 'elowen-plugin.json');
  return (JSON.parse(readFileSync(path, 'utf-8')) as { web: ManifestWeb }).web;
}

function expectSoleSection(plugin: string, sectionId: string, frame: 'plugin' | 'host'): void {
  const call = register.mock.calls.find(([name]) => name === plugin);
  expect(call, `${plugin}'s bundle registered no plugin UI`).toBeDefined();
  const registration = call![1] as Registration;
  const web = manifestWeb(plugin);

  // The host only serves the bare route from a settings section when there is exactly one and no nav.
  expect(web.nav).toBeUndefined();
  expect(web.settings?.map((section) => section.id)).toEqual([sectionId]);
  // Where the section is OFFERED. Absent means 'page' — the bare `/p/<plugin>` route this whole helper is
  // about. 'pluginDetail' would take the section out of the main navigation and serve it inside
  // Settings → Plugins instead, which is a different surface with a different frame.
  expect(web.settings?.[0]?.placement).toBeUndefined();
  // No root page of its own: `/p/<plugin>` resolving to the sole section is the host's job now.
  expect(Object.keys(registration.pages ?? {})).toEqual([]);
  expect(Object.keys(registration.settings ?? {})).toEqual([sectionId]);
  // The id the host compares against the manifest. An id that matches nothing fails no check at runtime.
  expect(registration.ownsPageFrame).toEqual(frame === 'plugin' ? [sectionId] : undefined);
  expect(registration.requiresApiVersion).toBe(web.requiresApiVersion);
  expect(registration.requiresApiVersion).toBeGreaterThanOrEqual(MINIMUM_API_VERSION);
}

describe('single-surface plugin workspace registration', () => {
  it('registers Automation as the sole page-framing Settings section', async () => {
    await import('../plugins/cronjob/web-src/index');
    expectSoleSection('cronjob', 'jobs', 'plugin');
  });

  it('registers Skills as the sole page-framing Settings section', async () => {
    await import('../plugins/skills/web-src/index');
    expectSoleSection('skills', 'skills', 'plugin');
  });

  /** Chatbots is the other shape a plugin can take: ONE entry in the primary navigation, presented in the
   *  host's shared reading modal, with peer sections switching inside it.
   *
   *  Three declarations have to agree for that to work, and none of them fails loudly when it does not.
   *  `web.presentation: "overlay"` is what makes `/p/chatbot` open in the modal at all — without it the
   *  same bundle renders as an ordinary page and the deck it composes is simply the wrong furniture for
   *  that surface. The routes the bundle registers are the addresses the deck's own navigation sends the
   *  reader to, so a section in the column with no page behind it lands on "page missing". And the two
   *  `requiresApiVersion` numbers gate different things — the manifest's gates the LOAD, the
   *  registration's gates the MOUNT — so a manifest asking for less than the bundle needs admits a host
   *  that cannot render it. */
  it('registers Chatbots as one overlay navigation entry with a page per section', async () => {
    await import('../plugins/chatbot/web-src/index');
    const call = register.mock.calls.find(([name]) => name === 'chatbot');
    expect(call, 'chatbot\'s bundle registered no plugin UI').toBeDefined();
    const registration = call![1] as Registration;
    const web = manifestWeb('chatbot');

    // One entry in the main navigation, at the plugin's own bare address, and nothing in Settings.
    expect(web.nav?.map((entry) => entry.route ?? '')).toEqual(['']);
    expect(web.settings).toBeUndefined();
    expect(Object.keys(registration.settings ?? {})).toEqual([]);
    // …presented in the host's modal rather than as a page of its own.
    expect(web.presentation).toBe('overlay');

    // Every section the deck offers is a route of its own, and the register keeps the bare address the
    // navigation entry opens.
    expect(Object.keys(registration.pages ?? {})).toEqual(CHATBOT_SECTIONS.map((section) => section.route));
    expect(CHATBOT_SECTIONS[0]!.route).toBe('');
    // All four addresses resolve to the SAME component: that is what keeps the deck — its column, its
    // strip, its scroll position — mounted while only the content pane changes.
    const mounted = new Set(Object.values(registration.pages ?? {}));
    expect(mounted.size).toBe(1);

    // `ownsPageFrame` names SETTINGS sections that draw their own page frame. There are no settings
    // sections here, so naming anything would name an id that matches nothing.
    expect(registration.ownsPageFrame).toBeUndefined();
    // API 22 publishes the shared Textarea used by this bundle, and both gates must ask for it.
    expect(web.requiresApiVersion).toBe(22);
    expect(registration.requiresApiVersion).toBe(web.requiresApiVersion);
    expect(registration.requiresApiVersion).toBeGreaterThanOrEqual(MINIMUM_API_VERSION);
    // It stays admin-only, and that flag is enforced by the SERVER rather than by the surface it is
    // offered on: `/plugins/ui` omits the entry for a non-admin and `/plugins/:name/web/:file` answers
    // 403 for the bundle and the stylesheet (src/api/routes/pluginUi.ts).
    expect(web.adminOnly).toBe(true);
  });
});
