import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** cronjob and skills each ship ONE settings section and no nav, which is exactly the shape the host
 *  serves at the bare `/p/<plugin>` route (`sole` in web/app/p/[plugin]/[[...rest]]/page.tsx). These
 *  bundles used to register a duplicate root page for that address and no longer do.
 *
 *  What replaces it is `ownsPageFrame`, and a mistake there is SILENT. The host matches the declared ids
 *  against `web.settings[].id` FROM THE MANIFEST, so an id that does not appear there just leaves the
 *  page frame double-wrapped: no error, only a section rendered narrower than every sibling register.
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
  nav?: unknown;
  settings?: { id: string }[];
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

function expectSoleFramedSection(plugin: string, sectionId: string): void {
  const call = register.mock.calls.find(([name]) => name === plugin);
  expect(call, `${plugin}'s bundle registered no plugin UI`).toBeDefined();
  const registration = call![1] as Registration;
  const web = manifestWeb(plugin);

  // The host only serves the bare route from a settings section when there is exactly one and no nav.
  expect(web.nav).toBeUndefined();
  expect(web.settings?.map((section) => section.id)).toEqual([sectionId]);
  // No root page of its own: `/p/<plugin>` resolving to the sole section is the host's job now.
  expect(Object.keys(registration.pages ?? {})).toEqual([]);
  expect(Object.keys(registration.settings ?? {})).toEqual([sectionId]);
  // The id the host compares against the manifest. An id that matches nothing fails no check at runtime.
  expect(registration.ownsPageFrame).toEqual([sectionId]);
  expect(registration.requiresApiVersion).toBe(web.requiresApiVersion);
  expect(registration.requiresApiVersion).toBeGreaterThanOrEqual(MINIMUM_API_VERSION);
}

describe('single-surface plugin workspace registration', () => {
  it('registers Automation as the sole page-framing Settings section', async () => {
    await import('../plugins/cronjob/web-src/index');
    expectSoleFramedSection('cronjob', 'jobs');
  });

  it('registers Skills as the sole page-framing Settings section', async () => {
    await import('../plugins/skills/web-src/index');
    expectSoleFramedSection('skills', 'skills');
  });
});
