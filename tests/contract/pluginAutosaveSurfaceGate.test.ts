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
  { path: 'plugins/browser/web-src/BrowserAccount.tsx', mode: 'explicit-save', reason: 'session lifecycle and confirmed destructive profile cleanup actions' },
  // Chatbot's two write-bearing surfaces are listed even though the write-signal scan cannot see them:
  // both go through `jsonRequest` in the bundle's own runtime.ts, which the scan deliberately skips as
  // shared plumbing, so they would be absent from the inventory exactly because they are tidy. Saving a
  // chatbot is ONE deliberate submit — the row's `updatedAt` is the concurrency token the server compares,
  // so a debounced autosave would race another administrator for nothing — and enabling it is a separate
  // confirmed action that must never be a keystroke's side effect. Creating a chatbot spans three owners
  // (core account, core Project assignment, plugin row) and its retry has to resume at the step that
  // failed, which no debounce can express.
  { path: 'plugins/chatbot/web-src/BotDetail.tsx', mode: 'explicit-save', reason: 'whole-row compare-and-set save, plus a separately confirmed enable/disable' },
  { path: 'plugins/chatbot/web-src/CreateBotDialog.tsx', mode: 'explicit-save', reason: 'creation is ONE explicit multi-owner submit whose retry resumes at the failed step' },
  { path: 'plugins/cronjob/web-src/JobDrawer.tsx', mode: 'canonical' },
  { path: 'plugins/cronjob/web-src/AutomationPage.tsx', mode: 'explicit-save', reason: 'run-now and pause are immediate operational actions; JobDrawer owns canonical field autosave' },
  { path: 'plugins/cronjob/web-src/CreateJobDialog.tsx', mode: 'explicit-save', reason: 'creation is ONE explicit submit: an idempotent requestId guards the retry, not a debounced autosave' },
  { path: 'plugins/cronjob/web-src/fields.tsx', mode: 'explicit-save', reason: 'the schedule-preview POST is a bounded read of a draft, never a persistence write' },
  { path: 'plugins/msteams/web-src/TeamsWorkspace.tsx', mode: 'canonical' },
  { path: 'plugins/editor/web-src/editor/ProjectEditor.tsx', mode: 'explicit-save', reason: 'source-file checkpoints and uploads' },
  { path: 'plugins/editor/web-src/editor/fileData.ts', mode: 'explicit-save', reason: 'root-scoped file and tree writes: a create, rename, copy or delete of a source file is a deliberate action, and a debounced one would act on a path the user is still typing' },
  { path: 'plugins/editor/web-src/editor/upload.ts', mode: 'explicit-save', reason: 'explicit file upload transfer' },
  { path: 'plugins/github/web-src/GitHubConnectionPanel.tsx', mode: 'explicit-save', reason: 'OAuth/device flow and external account actions' },
  { path: 'plugins/github/web-src/GitHubProjectPanel.tsx', mode: 'explicit-save', reason: 'external publish/review/merge actions and mapping form' },
  { path: 'plugins/onedrive/web-src/OneDriveProjectPanel.tsx', mode: 'explicit-save', reason: 'external connection, sync and conflict actions' },
  { path: 'plugins/sites/web-src/SiteDetail.tsx', mode: 'explicit-save', reason: 'publication, guest replacement and destructive site actions' },
  { path: 'plugins/stats/web-src/ResetUsageModal.tsx', mode: 'explicit-save', reason: 'destructive usage-data reset' },
  { path: 'plugins/skills/web-src/SkillsSettings.tsx', mode: 'explicit-save', reason: 'skill file writes and ownership moves are atomic filesystem actions' },
  { path: 'plugins/editor/web-src/ProjectIconPicker.tsx', mode: 'explicit-save', reason: 'project icon selection is an explicit project mutation' },
  { path: 'plugins/skills/web-src/SkillsPicker.tsx', mode: 'explicit-save', reason: 'skill selection changes project or account state explicitly' },
  { path: 'plugins/todo/web-src/TasksPicker.tsx', mode: 'explicit-save', reason: 'task selection changes session task state explicitly' },
  { path: 'plugins/todo/web-src/TasksRail.tsx', mode: 'explicit-save', reason: 'task rail actions are explicit session task mutations' },
  { path: 'plugins/todo/web-src/TodoCard.tsx', mode: 'explicit-save', reason: 'task card actions are explicit session task mutations' },
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
  'plugins/cronjob/web-src/JobDrawer.tsx',
  'plugins/msteams/web-src/TeamsWorkspace.tsx',
]);

describe('server-backed plugin edit persistence gate', () => {
  it('keeps the inventory tied to real source files', () => {
    expect(SURFACES.every(({ path }) => existsSync(join(root, path)))).toBe(true);
  });

  it('requires every write-bearing surface to be declared', () => {
    expect(discoveredWrites.filter((path) => !declared.includes(path))).toEqual([]);
    expect(discoveredWrites).toEqual(expect.arrayContaining([
      'plugins/cronjob/web-src/JobDrawer.tsx',
      'plugins/editor/web-src/editor/ProjectEditor.tsx',
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
