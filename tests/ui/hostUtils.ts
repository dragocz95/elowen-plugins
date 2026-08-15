/** The `utils` bag the host installs on `window.ElowenUiRuntime` — formatting helpers and the web-side
 *  schedule validator, shared with plugin bundles so a panel formats a timestamp the way the rest of the
 *  app does. Ported from the host's web/lib/format.ts and web/lib/cron.ts. */
// The plugin is untyped .mjs, so the import is given the one signature this file uses.
const { parseSchedule } = await import('../../plugins/cronjob/index.mjs') as {
  parseSchedule(spec: string): unknown | null;
};

/** Normalize a SQLite ("2026-06-18 10:38:49", UTC) or ISO timestamp to epoch ms. */
export function parseTs(iso?: string | null): number | null {
  if (!iso) return null;
  const norm = iso.includes('T') ? iso : iso.replace(' ', 'T') + (iso.endsWith('Z') ? '' : 'Z');
  const ms = new Date(norm).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** Single-unit elapsed ladder (ms → "12s" / "3m" / "5h" / "2d"). Negatives clamp to "0s". */
export function compactElapsed(ms: number): string {
  const secs = Math.max(0, Math.floor(ms / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** In production this is the host's own copy of the grammar (web/lib/cron.ts), which the panel uses to
 *  mark a schedule field invalid before saving. Here it delegates to the plugin's parser instead of
 *  duplicating a 160-line parser into the test harness.
 *
 *  That substitution cannot hide a host/plugin drift, because nothing here is what catches drift:
 *  cronGrammar.test.ts pins the plugin to the frozen corpus and the package's cronParity.test.ts pins
 *  both web copies to a byte-identical one, each without seeing the other side. What this file feeds is
 *  the PANEL's behaviour — that an invalid schedule blocks the save and a valid one does not. */
export function isValidSchedule(spec: string): boolean {
  return parseSchedule(spec) !== null;
}

/** Copy to the clipboard, reporting whether it worked — the caller toasts either way, so it must not
 *  throw. Ported from the host's clipboard helper; jsdom exposes no clipboard, which is the `false` branch. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Elowen's Monaco themes, installed by the HOST so every editor surface (a plugin's included) shares one
 *  colour table: 'elowen-oled' for the true-black canvas, 'elowen-paper' for a light skin, picked by the
 *  document's resolved color-scheme.
 *
 *  The palettes are deliberately abridged. The app's full tables live in web/lib/monaco/oledTheme.ts and
 *  nothing on this side could keep a copy of them honest. What a panel actually depends on — and what
 *  this reproduces exactly — is the two theme NAMES and the fact that the bundle registers neither
 *  itself. */
type Monaco = { editor: { defineTheme(name: string, theme: unknown): void } };

export function defineEditorThemes(monaco: Monaco): void {
  monaco.editor.defineTheme('elowen-oled', {
    base: 'vs-dark', inherit: true, rules: [{ token: '', foreground: 'f7f3f0' }],
    colors: { 'editor.background': '#000000', 'editor.foreground': '#f7f3f0' },
  });
  monaco.editor.defineTheme('elowen-paper', {
    base: 'vs', inherit: true, rules: [{ token: '', foreground: '0f1c2e' }],
    colors: { 'editor.background': '#ffffff', 'editor.foreground': '#0f1c2e' },
  });
}

export function editorTheme(): 'elowen-oled' | 'elowen-paper' {
  if (typeof document === 'undefined') return 'elowen-oled';
  return getComputedStyle(document.documentElement).colorScheme === 'light' ? 'elowen-paper' : 'elowen-oled';
}
