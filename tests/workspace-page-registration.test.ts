import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  nav?: { route: string }[];
  adminOnly?: boolean;
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

  /** Chatbots is the other shape: a plugin whose surface IS its product, so it keeps an entry in the main
   *  navigation and one page behind it. The page carries its own sections, which makes the pair below the
   *  whole contract — a nav route with no page registered for it is a menu entry that opens nothing, and a
   *  page registered at a route the manifest does not advertise is a page nothing leads to. */
  it('registers Chatbots as one navigation page and no settings section', async () => {
    await import('../plugins/chatbot/web-src/index');
    const call = register.mock.calls.find(([name]) => name === 'chatbot');
    expect(call, 'chatbot\'s bundle registered no plugin UI').toBeDefined();
    const registration = call![1] as Registration;
    const web = manifestWeb('chatbot');

    expect(web.nav?.map((entry) => entry.route)).toEqual(['']);
    expect(web.settings).toBeUndefined();
    // The page is registered at the manifest's own route, and the bundle contributes nothing to Settings.
    expect(Object.keys(registration.pages ?? {})).toEqual(['']);
    expect(Object.keys(registration.settings ?? {})).toEqual([]);
    // `ownsPageFrame` names SETTINGS sections that draw their own page frame. A page always owns its
    // frame, so declaring anything here would name an id that matches nothing.
    expect(registration.ownsPageFrame).toBeUndefined();
    expect(registration.requiresApiVersion).toBe(web.requiresApiVersion);
    expect(registration.requiresApiVersion).toBeGreaterThanOrEqual(MINIMUM_API_VERSION);
    // It stays admin-only, and that flag is enforced by the SERVER rather than by the surface it is
    // offered on: `/plugins/ui` omits the entry for a non-admin and `/plugins/:name/web/:file` answers
    // 403 for the bundle and the stylesheet (src/api/routes/pluginUi.ts).
    expect(web.adminOnly).toBe(true);
  });
});
