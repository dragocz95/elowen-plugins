import { describe, it, expect, vi } from 'vitest';
import type { ComponentType } from 'react';
import { ensurePluginUiRuntime } from './ui/hostRuntime';
import manifest from '../plugins/work/elowen-plugin.json' with { type: 'json' };

ensurePluginUiRuntime();
const registered = vi.fn();
(window as { __elowenRegisterPluginUi?: unknown }).__elowenRegisterPluginUi = registered;
await import('../plugins/work/web-src/index');

describe('work UI registration', () => {
  it('offers only the task-domain routes declared by its manifest', () => {
    expect(registered).toHaveBeenCalledWith('work', expect.anything());
    const registration = registered.mock.calls[0]![1] as {
      requiresApiVersion: number;
      pages: Record<string, ComponentType<unknown>>;
    };
    const routes = (manifest as { web: { nav: { route: string }[] } }).web.nav.map((entry) => entry.route);
    expect(routes).toEqual(['tasks', 'kanban', 'timeline']);
    expect(Object.keys(registration.pages).sort()).toEqual(['', 'kanban', 'tasks', 'timeline']);
    for (const route of routes) expect(typeof registration.pages[route]).toBe('function');
    expect(registration.pages.stats).toBeUndefined();
    expect(registration.requiresApiVersion).toBe((manifest as { web: { requiresApiVersion: number } }).web.requiresApiVersion);
  });
});
