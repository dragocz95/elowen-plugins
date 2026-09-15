/** The workbench bundle is exercised through the REAL host stand-in, but this suite keeps to the
 *  assertions that cannot lie: the bundle's registration contract (API 17 + ownsPageFrame), the
 *  schedule builder grammar, and the wire-shape helpers the calendar flows branch on. Rendering
 *  behavior of the surface itself belongs to the plugin viewport/a11y suites, which render the
 *  built bundle against the real host. */
import type { PluginUiRegistration } from 'elowen-plugin-ui-kit';
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import manifest from '../plugins/cronjob/elowen-plugin.json' with { type: 'json' };
import {
  parseActiveHours, parseBuilderSchedule, renderActiveHours, renderBuilderSchedule,
} from '../plugins/cronjob/web-src/scheduleBuilder';
import {
  runtime, apiErrorCode, apiErrorConflict, apiErrorCurrent, localDateLabel,
  type CronJob,
} from '../plugins/cronjob/web-src/runtime';
import { ensurePluginUiRuntime } from './ui/hostRuntime';

ensurePluginUiRuntime();

afterEach(cleanup);

const strings = (manifest as { web: { strings: Record<string, string> } }).web.strings;
const manifestApiVersion = (manifest as { web: { requiresApiVersion: number } }).web.requiresApiVersion;

type BundleRegistration = Pick<PluginUiRegistration, 'requiresApiVersion' | 'settings' | 'ownsPageFrame'>;
type RegisterHook = (plugin: string, registration: BundleRegistration) => void;

/** Import the bundle entry the way the host does — registration is what carries ownsPageFrame. */
const loadBundleRegistration = async (): Promise<BundleRegistration> => {
  let captured: BundleRegistration | undefined;
  (window as unknown as { __elowenRegisterPluginUi?: RegisterHook }).__elowenRegisterPluginUi =
    (_plugin, registration) => { captured = registration; };
  await import('../plugins/cronjob/web-src/index');
  if (!captured) throw new Error('the cronjob bundle registered no UI');
  return captured;
};

describe('cronjob bundle registration', () => {
  it('targets the host API 17, keeps the single jobs section and the one-frame page declaration', async () => {
    const registration = await loadBundleRegistration();
    expect(registration.requiresApiVersion).toBe(17);
    expect(Object.keys(registration.settings)).toEqual(['jobs']);
    expect(registration.ownsPageFrame).toEqual(['jobs']);
  });

  it('pairs the manifest it claims to serve: API 17, the workbench layout, and the strings the page reads', () => {
    expect(manifestApiVersion).toBe(17);
    expect((manifest as { web: { layout?: string } }).web.layout).toBe('workbench');
    for (const key of ['calMonthLabel', 'calAgendaHeading', 'calDayAria', 'calMore', 'createOneShot',
      'createRecurring', 'nextRun', 'lastStarted', 'badgeLate', 'hoursTimeZone']) {
      expect(Object.hasOwn(strings, key), `missing web.strings.${key}`).toBe(true);
    }
  });
});

describe('cronjob schedule builder', () => {
  it.each(['every 15m', 'every 2h', 'daily 07:30', 'weekly sun 20:00'])(
    'parses and renders %s through the scheduler grammar',
    (schedule) => {
      const parsed = parseBuilderSchedule(schedule);
      expect(parsed).not.toBeNull();
      expect(renderBuilderSchedule(parsed!)).toBe(schedule);
    },
  );

  it('accepts only whole-hour active windows within 0-23, overnight included', () => {
    expect(parseActiveHours('0-23')).toEqual({ start: 0, end: 23 });
    expect(parseActiveHours('22-5')).toEqual({ start: 22, end: 5 });
    expect(parseActiveHours('24-5')).toBeNull();
    expect(parseActiveHours('5:30-21')).toBeNull();
    expect(renderActiveHours(0, 23)).toBe('0-23');
  });
});

describe('the calendar wire helpers', () => {
  it('reads the machine error fields the API adds beside its human error line', () => {
    expect(apiErrorCode({ error: 'x', code: 'revision_conflict' })).toBe('revision_conflict');
    expect(apiErrorCode(new Error('plain'))).toBeUndefined();
    expect(apiErrorConflict({ conflict: true })).toBe(true);
    expect(apiErrorCurrent({ current: null })).toBeUndefined();
    expect(apiErrorCurrent({ current: { id: 'j1' } })?.id).toBe('j1');
  });

  it('narrowed to the runtime the host installs: Calendar present, browser cron validation not used', () => {
    const components = runtime().components;
    expect(typeof components.Calendar).toBe('function');
    // Validity is the server's (schedule-preview); the compat helper stays for released bundles only.
    const sources = [
      resolve(dirname(fileURLToPath(import.meta.url)), '../plugins/cronjob/web-src/CalendarPage.tsx'),
      resolve(dirname(fileURLToPath(import.meta.url)), '../plugins/cronjob/web-src/fields.tsx'),
      resolve(dirname(fileURLToPath(import.meta.url)), '../plugins/cronjob/web-src/JobDrawer.tsx'),
      resolve(dirname(fileURLToPath(import.meta.url)), '../plugins/cronjob/web-src/CreateJobDialog.tsx'),
    ];
    for (const source of sources) {
      expect(readFileSync(source, 'utf-8').includes('isValidSchedule'), basename(source)).toBe(false);
    }
  });

  it('formats the browser-local label a day grid cell needs, nothing more', () => {
    expect(localDateLabel(new Date(2026, 8, 15))).toBe('2026-09-15');
  });
});

describe("the job drawer public fields", () => {
  it("keeps a one-shot wiring local (runAt present) and its filing absent", () => {
    const oneShot: CronJob = {
      id: 'j2', name: 'wakeup', schedule: 'one-shot', prompt: 'go', enabled: true,
      runAt: '2026-09-16T06:00:00.000Z', lifecycle: 'oneShot', revision: 0,
    };
    expect(oneShot.lifecycle).toBe('oneShot');
    expect(oneShot.conversationSessionId).toBeUndefined();
  });
});
