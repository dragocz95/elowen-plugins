import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const pluginRoot = join(import.meta.dirname, '..', 'plugins', 'agents', 'web-src');

describe('agents workspace frame', () => {
  it.each([
    'sessions/SessionsView.tsx',
    'escalations/EscalationsView.tsx',
  ])('%s lets SpatialWorkspaceLayout own the page top edge', (relativePath) => {
    const source = readFileSync(join(pluginRoot, relativePath), 'utf8');
    expect(source).toContain('<C.SpatialWorkspaceLayout');
    expect(source).not.toContain('<C.ModuleHeader');
  });
});
