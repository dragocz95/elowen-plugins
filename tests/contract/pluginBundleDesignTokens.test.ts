import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
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
interface DeclaredBundle { name: string; entry: string; css?: string }

function declaredBundles(): DeclaredBundle[] {
  return readdirSync(pluginsDir).flatMap((name): DeclaredBundle[] => {
    try {
      const manifest = JSON.parse(readFileSync(resolve(pluginsDir, name, 'elowen-plugin.json'), 'utf8')) as { web?: { entry?: string; css?: string } };
      return typeof manifest.web?.entry === 'string'
        ? [{ name, entry: manifest.web.entry, ...(typeof manifest.web.css === 'string' ? { css: manifest.web.css } : {}) }]
        : [];
    } catch { return []; }
  }).sort((a, b) => a.name.localeCompare(b.name));
}

const pluginsDeclaringABundle = (): string[] => declaredBundles().map(({ name }) => name);

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
const RETIRED_SOURCE_TOKENS = [
  /\b(?:bg|text|border|ring)-(?:bg|surface(?:-2|-muted)?|elevated|overlay|text(?:-muted|-subtle)?|danger)\b/g,
  /\btext-accent(?!-foreground)\b/g,
  /\b(?:bg|border)-accent\/\d+\b/g,
  /\bring-accent\b/g,
  /var\(--color-(?:surface(?:-2|-muted)?|elevated|bg|overlay|text-muted|text-subtle|text|danger)\)/g,
];
const RETIRED_BUILT_TOKENS = /(?:bg-(?:surface(?:-2|-muted)?|elevated|bg|overlay)|text-(?:text-muted|text-subtle|text|danger)|--color-(?:surface(?:-2|-muted)?|elevated|bg|overlay|text-muted|text-subtle|text|danger))(?![a-z-])/g;

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

  it('keeps every plugin on the current semantic token vocabulary in source and shipped assets', () => {
    const offenders: string[] = [];
    for (const file of bundleSources()) {
      const text = readFileSync(file, 'utf8');
      text.split('\n').forEach((line, i) => {
        for (const pattern of RETIRED_SOURCE_TOKENS) {
          for (const hit of line.match(pattern) ?? []) offenders.push(`${relative(registryRoot, file)}:${i + 1} ${hit}`);
        }
      });
    }
    for (const bundle of declaredBundles()) {
      for (const asset of [bundle.entry, bundle.css].filter((path): path is string => path !== undefined)) {
        const file = resolve(pluginsDir, bundle.name, asset);
        expect(existsSync(file), `${bundle.name} declares missing web asset ${asset}`).toBe(true);
        const text = readFileSync(file, 'utf8');
        text.split('\n').forEach((line, i) => {
          for (const hit of line.match(RETIRED_BUILT_TOKENS) ?? []) {
            offenders.push(`${relative(registryRoot, file)}:${i + 1} ${hit}`);
          }
        });
      }
    }
    expect(offenders).toEqual([]);
  });

  it('recognises retired plugin utilities without rejecting current shadcn roles', () => {
    const retired = (line: string) => RETIRED_SOURCE_TOKENS.flatMap((pattern) => line.match(pattern) ?? []);
    expect(retired('bg-surface text-text-muted text-accent bg-accent/10 ring-accent')).toEqual([
      'bg-surface', 'text-text-muted', 'text-accent', 'bg-accent/10', 'ring-accent',
    ]);
    expect(retired('bg-card text-foreground text-muted-foreground bg-accent text-accent-foreground ring-ring')).toEqual([]);
  });
});
