// @vitest-environment node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

type SurfaceContract = {
  path: string;
  mode: 'canonical' | 'explicit-save';
  reason?: string;
};

/** Every server-backed editable surface has to make its persistence choice explicit. This is deliberately
 * a small inventory rather than a heuristic that guesses whether a button is safe to debounce: operational
 * actions, credentials, uploads, source files and atomic multi-step forms remain explicit by design. */
const SURFACES: readonly SurfaceContract[] = [
  { path: 'plugins/cronjob/web-src/JobsSettings.tsx', mode: 'canonical' },
  { path: 'plugins/msteams/web-src/TeamsWorkspace.tsx', mode: 'canonical' },
  { path: 'plugins/editor/web-src/editor/ProjectEditor.tsx', mode: 'explicit-save', reason: 'source-file checkpoints and uploads' },
  { path: 'plugins/editor/web-src/editor/upload.ts', mode: 'explicit-save', reason: 'explicit file upload transfer' },
  { path: 'plugins/github/web-src/GitHubConnectionPanel.tsx', mode: 'explicit-save', reason: 'OAuth/device flow and external account actions' },
  { path: 'plugins/github/web-src/GitHubProjectPanel.tsx', mode: 'explicit-save', reason: 'external publish/review/merge actions and mapping form' },
  { path: 'plugins/mcp/web-src/McpServersPage.tsx', mode: 'explicit-save', reason: 'credentials, process lifecycle and multi-field atomic configuration' },
  { path: 'plugins/onedrive/web-src/OneDriveProjectPanel.tsx', mode: 'explicit-save', reason: 'external connection, sync and conflict actions' },
  { path: 'plugins/sites/web-src/SiteDetail.tsx', mode: 'explicit-save', reason: 'publication, guest replacement and destructive site actions' },
  { path: 'plugins/stats/web-src/ResetUsageModal.tsx', mode: 'explicit-save', reason: 'destructive usage-data reset' },
  { path: 'plugins/skills/web-src/SkillsSettings.tsx', mode: 'explicit-save', reason: 'skill file writes and ownership moves are atomic filesystem actions' },
  { path: 'plugins/whatsapp/web-src/PairingSettings.tsx', mode: 'explicit-save', reason: 'pairing and unpairing are lifecycle actions' },
];

const root = resolve(new URL('../..', import.meta.url).pathname);
const pluginsDir = join(root, 'plugins');
const writePattern = /(?:\.mutate(?:Async)?\s*\(|\bmutationFn\s*:|method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"])/;

function walkWebSource(dir: string, paths: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkWebSource(full, paths);
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) paths.push(full);
  }
  return paths;
}

const discoveredWrites = readdirSync(pluginsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(pluginsDir, entry.name, 'web-src'))
  .filter((dir) => existsSync(dir))
  .flatMap((dir) => walkWebSource(dir))
  .filter((path) => !path.endsWith('/runtime.ts') && writePattern.test(readFileSync(path, 'utf8')))
  .map((path) => path.slice(root.length + 1))
  .sort();
const declared = SURFACES.map(({ path }) => path).sort();

// The canonical Teams config hook is a host hook call rather than a local mutationFn, so it is intentionally
// included in the inventory even though the write-signal scan below cannot discover it from implementation text.
const expectedCanonical = new Set([
  'plugins/cronjob/web-src/JobsSettings.tsx',
  'plugins/msteams/web-src/TeamsWorkspace.tsx',
]);

describe('server-backed plugin edit persistence gate', () => {
  it('keeps the inventory tied to real source files', () => {
    expect(SURFACES.every(({ path }) => existsSync(join(root, path)))).toBe(true);
  });

  it('requires every write-bearing surface to be declared', () => {
    expect(discoveredWrites.filter((path) => !declared.includes(path))).toEqual([]);
    expect(discoveredWrites).toEqual(expect.arrayContaining([
      'plugins/cronjob/web-src/JobsSettings.tsx',
      'plugins/editor/web-src/editor/ProjectEditor.tsx',
      'plugins/mcp/web-src/McpServersPage.tsx',
    ]));
  });

  it('requires canonical surfaces to use the host contract', () => {
    for (const surface of SURFACES.filter(({ mode }) => mode === 'canonical')) {
      const source = readFileSync(join(root, surface.path), 'utf8');
      expect(source, surface.path).toMatch(/useAutoSaveStatus|usePluginConfigDraft/);
      expect(expectedCanonical.has(surface.path)).toBe(true);
    }
  });

  it('requires every explicit-save exception to document its boundary', () => {
    for (const surface of SURFACES.filter(({ mode }) => mode === 'explicit-save')) {
      expect(surface.reason, `${surface.path} needs a justified explicit-save reason`).toBeTruthy();
    }
  });
});
