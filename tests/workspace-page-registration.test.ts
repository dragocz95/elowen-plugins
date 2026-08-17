import { beforeEach, describe, expect, it, vi } from 'vitest';

const register = vi.fn();
beforeEach(() => {
  register.mockClear();
  (window as unknown as { __elowenRegisterPluginUi?: typeof register }).__elowenRegisterPluginUi = register;
});

describe('single-surface plugin workspace registration', () => {
  it('registers Automation as both a root page and a Settings section', async () => {
    await import('../plugins/cronjob/web-src/index');
    const registration = register.mock.calls.find(([plugin]) => plugin === 'cronjob')?.[1] as {
      pages?: Record<string, unknown>;
      settings?: Record<string, unknown>;
    };
    expect(Object.keys(registration.pages ?? {})).toEqual(['']);
    expect(Object.keys(registration.settings ?? {})).toEqual(['jobs']);
  });

  it('registers Skills as both a root page and a Settings section', async () => {
    await import('../plugins/skills/web-src/index');
    const registration = register.mock.calls.find(([plugin]) => plugin === 'skills')?.[1] as {
      pages?: Record<string, unknown>;
      settings?: Record<string, unknown>;
    };
    expect(Object.keys(registration.pages ?? {})).toEqual(['']);
    expect(Object.keys(registration.settings ?? {})).toEqual(['skills']);
  });
});
