import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// A plugin bundle paints inside the host's skin. Every colour it uses has to come from the design tokens
// the host ships (web/app/styles/tokens.css in the daemon, reached as `var(--color-…)`), because those
// are the single dial a repaint turns: a literal #ffd09a in a chart survives a rebrand and leaves one
// orange streak in an otherwise recoloured app. This was not hypothetical — the stats chart carried
// three of them, and the editor a fourth that was simply --color-document written out by hand. Both of
// those bundles now live in THIS repository, where nothing was checking any more.
//
// The check is deliberately mechanical rather than tasteful: it looks for hex literals in bundle
// sources, so the day a plugin needs a shade that no token carries, the answer is to add the token
// (which a theme can then move) instead of hard-coding the shade where no theme can reach it.
const registryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const pluginsDir = resolve(registryRoot, 'plugins');

/** Plugins whose manifest declares a browser bundle. The scan below has to reach every one of them, and
 *  deriving that from the manifests is the only self-check that stays honest as the set changes: a file
 *  count would be a magic number the day a plugin lands, while this fails the day a DECLARED bundle stops
 *  being scanned — a renamed folder, a broken walk, a plugin whose sources moved. */
function pluginsDeclaringABundle(): string[] {
  return readdirSync(pluginsDir).filter((name) => {
    try {
      const manifest = JSON.parse(readFileSync(resolve(pluginsDir, name, 'elowen-plugin.json'), 'utf8')) as { web?: { entry?: string } };
      return typeof manifest.web?.entry === 'string';
    } catch { return false; }
  }).sort();
}

/** Every `plugins/<name>/web-src/**` source, minus tests — a new plugin is covered the day it lands. */
function bundleSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    for (const entry of entries) {
      const full = resolve(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue;
      out.push(full);
    }
  };
  for (const name of readdirSync(pluginsDir)) {
    const webSrc = resolve(pluginsDir, name, 'web-src');
    try { if (!statSync(webSrc).isDirectory()) continue; } catch { continue; }
    walk(webSrc);
  }
  return out.sort();
}

const HEX = /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/g;
const RETIRED_STATS_TOKENS = [
  /\bbg-(?:surface-muted|surface|elevated|bg)\b/g,
  /\btext-(?:text-muted|text|danger)\b/g,
  /var\(--color-(?:surface-muted|surface|elevated|bg|text-muted|text|danger|accent)\)/g,
];

describe('plugin bundles paint from the host tokens, not from literals', () => {
  it('finds the bundle sources at all', () => {
    // A guard that silently matches nothing is worse than no guard: `has no hard-coded colour` below
    // passes over an empty file list forever. So every plugin that declares a bundle must contribute at
    // least one scanned source, and the total must stay in the range this registry has — 68 sources
    // across six bundled plugins today.
    const declaring = pluginsDeclaringABundle();
    expect(declaring.length).toBeGreaterThan(0);
    const files = bundleSources();
    const unscanned = declaring.filter((name) => !files.some((f) => f.startsWith(resolve(pluginsDir, name, 'web-src') + '/')));
    expect(unscanned).toEqual([]);
    expect(files.length).toBeGreaterThanOrEqual(39);
  });

  it('has no hard-coded colour in any plugin bundle source', () => {
    const offenders: string[] = [];
    for (const file of bundleSources()) {
      const text = readFileSync(file, 'utf8');
      text.split('\n').forEach((line, i) => {
        for (const hit of line.match(HEX) ?? []) {
          offenders.push(`${relative(registryRoot, file)}:${i + 1} ${hit}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it('still recognises a hard-coded colour when it sees one', () => {
    // The assertion above reads an empty list, and an empty list is only worth as much as the pattern
    // that produced it. This is the pattern, run over the literals it exists to catch and the things it
    // must not mistake for one.
    const found = (line: string): string[] => line.match(HEX) ?? [];
    expect(found('const bar = { fill: "#ffd09a" };')).toEqual(['#ffd09a']);
    expect(found('<stop stopColor="#FFF" />')).toEqual(['#FFF']);
    expect(found('style={{ color: "var(--color-document)" }}')).toEqual([]);
    expect(found('const anchor = "#section-two";')).toEqual([]);
  });

  it('keeps Stats on the current semantic token vocabulary', () => {
    const offenders: string[] = [];
    const statsRoot = resolve(pluginsDir, 'stats', 'web-src');
    for (const file of bundleSources().filter((source) => source.startsWith(`${statsRoot}/`))) {
      const text = readFileSync(file, 'utf8');
      text.split('\n').forEach((line, i) => {
        for (const pattern of RETIRED_STATS_TOKENS) {
          for (const hit of line.match(pattern) ?? []) offenders.push(`${relative(registryRoot, file)}:${i + 1} ${hit}`);
        }
      });
    }
    expect(offenders).toEqual([]);

    const builtJs = readFileSync(resolve(pluginsDir, 'stats', 'web', 'index.js'), 'utf8');
    const builtCss = readFileSync(resolve(pluginsDir, 'stats', 'web', 'index.css'), 'utf8');
    expect(`${builtJs}\n${builtCss}`).not.toMatch(/(?:bg-(?:surface-muted|surface|elevated|bg)|text-(?:text-muted|text|danger)|--color-(?:surface-muted|surface|elevated|bg|text-muted|text|danger))(?![a-z-])/);
    expect(builtCss).toContain('.bg-card');
    expect(builtCss).toContain('.text-foreground');
    expect(builtCss).toContain('.text-muted-foreground');
  });
});
