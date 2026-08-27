/** tests/ui/hostRuntime.tsx is a hand-maintained COPY of the runtime the daemon installs on
 *  `window.ElowenUiRuntime` (web/lib/pluginUi.tsx), and this is what keeps it honest.
 *
 *  Every UI suite in this repository renders a plugin bundle against that stand-in, so a name the
 *  stand-in exposes and the real host does not is a suite that goes GREEN against a primitive
 *  production cannot supply. That is not hypothetical: the stand-in sat at apiVersion 3 while the host
 *  had moved to 8, and it served `ConstellationScope`, `TerminalModal`, five agent/task components,
 *  ~50 work-and-missions hooks and ~27 task/epic utils that the host had withdrawn or never had.
 *
 *  WHICH SIDE IS THE TRUTH: the installed `elowen` devDependency, never a sibling checkout. Same reason
 *  as tests/hostDictionaryParity.test.ts — CI has the package and nothing else, so a guard that reached
 *  into a working copy of the daemon would pass on a developer's machine and mean nothing on the runner.
 *
 *  WHY NOT THE PUBLISHED TYPES: `elowen-plugin-ui-kit` does declare `ElowenUiRuntime`, but its
 *  `components`, `hooks` and `utils` are `Record<string, ComponentType<never>>` / `Record<string,
 *  unknown>` — deliberately, since a bundle narrows each entry locally. The .d.ts therefore pins the API
 *  version and NOT ONE primitive name, so asserting against it would compare nothing. The names exist
 *  only in the app's compiled bundle, which is what this reads.
 *
 *  HOW IT IS READ: the package publishes the web app as a built Next.js bundle, so `pluginUi.tsx` is not
 *  importable. Its `window.ElowenUiRuntime={…}` assignment survives minification with the property NAMES
 *  intact (they are the plugin contract; only the values are mangled), and the three maps are recovered
 *  from it by brace-matching. Being indirect, the extraction is bounded from below everywhere: one that
 *  silently stops finding anything fails loudly instead of passing forever while comparing nothing.
 *
 *  WHICH DIRECTION IS ENFORCED: the stand-in must be a faithful SUBSET. A name it carries has to exist
 *  in the package — or be listed in tests/ui/hostAheadOfRelease.ts, the explicit set of host additions
 *  this repository is being built against before their release. Names the package has and the stand-in
 *  does not are fine and deliberate: it is narrowed to what these suites render.
 *
 *  RESIDUAL GAP, stated plainly: this compares NAMES, not props. A stand-in whose `DataTableRow` ignores
 *  `openLabel` still passes here. Props are held by the bundles' own suites and by the web-src
 *  typecheck against the kit; nothing in this repository can see the host's real signatures. */
import { describe, it, expect, beforeAll } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';

import { ensurePluginUiRuntime } from './ui/hostRuntime';
import { AHEAD_OF_RELEASE_API_VERSION, AHEAD_OF_RELEASE_RUNTIME } from './ui/hostAheadOfRelease';

const requireFromHere = createRequire(import.meta.url);
const packageRoot = dirname(requireFromHere.resolve('elowen/package.json'));

type Surface = { apiVersion: number; components: string[]; hooks: string[]; utils: string[] };

/** Walk an object literal from its opening brace to the brace that closes it, stepping over string
 *  contents so a `{` inside a literal cannot end the match early. */
function objectLiteralAt(source: string, start: number): string | null {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

/** The property names at depth 1 of an object literal — an identifier (or quoted string) that is
 *  immediately followed by `:`. Nested objects, calls and arrays are skipped by the depth counter. */
function propertyNames(literal: string): string[] {
  const names: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < literal.length; i++) {
    const ch = literal[i]!;
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{' || ch === '(' || ch === '[') { depth++; continue; }
    if (ch === '}' || ch === ')' || ch === ']') { depth--; continue; }
    if (depth !== 1) continue;
    const match = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(literal.slice(i));
    if (!match) continue;
    let after = i + match[0].length;
    while (after < literal.length && /\s/.test(literal[after]!)) after++;
    if (literal[after] === ':') names.push(match[0]);
    // Jump past the token either way: its value is walked by the loop, its name is not rescanned.
    i = after - 1;
  }
  return names;
}

/** The map assigned to `<key>:{…}` at depth 1 of the runtime literal. */
function nestedMap(literal: string, key: string): string[] {
  const at = literal.indexOf(`${key}:{`);
  if (at < 0) return [];
  const nested = objectLiteralAt(literal, literal.indexOf('{', at));
  return nested ? propertyNames(nested) : [];
}

/** Every emitted chunk that installs the runtime. Only the browser build carries it — the module is
 *  `'use client'` and the assignment is guarded on `window`. */
function extractSurfaces(): { file: string; surface: Surface }[] {
  const found: { file: string; surface: Surface }[] = [];
  const roots = [
    join(packageRoot, 'web-dist', '.next', 'static', 'chunks'),
    join(packageRoot, 'web-dist', '.next', 'server', 'chunks', 'ssr'),
  ];
  for (const dir of roots) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.js')) continue;
      const source = readFileSync(join(dir, name), 'utf8');
      const at = source.indexOf('window.ElowenUiRuntime={');
      if (at < 0) continue;
      const literal = objectLiteralAt(source, source.indexOf('{', at));
      if (!literal) continue;
      const version = /apiVersion:(\d+)/.exec(literal);
      found.push({
        file: join(dir, name),
        surface: {
          apiVersion: version ? Number(version[1]) : NaN,
          components: nestedMap(literal, 'components'),
          hooks: nestedMap(literal, 'hooks'),
          utils: nestedMap(literal, 'utils'),
        },
      });
    }
  }
  return found;
}

const extracted = extractSurfaces();
const packaged = extracted[0]?.surface;

/** The stand-in's own maps, read the way a bundle reads them: off the installed window global. */
function standIn(): Surface {
  ensurePluginUiRuntime();
  const runtime = (window as Window & { ElowenUiRuntime?: {
    apiVersion: number;
    components: Record<string, unknown>;
    hooks: Record<string, unknown>;
    utils: Record<string, unknown>;
  } }).ElowenUiRuntime;
  if (!runtime) throw new Error('ensurePluginUiRuntime installed nothing');
  return {
    apiVersion: runtime.apiVersion,
    components: Object.keys(runtime.components),
    hooks: Object.keys(runtime.hooks),
    utils: Object.keys(runtime.utils),
  };
}

let copied: Surface;
beforeAll(() => { copied = standIn(); });

describe('the stand-in host runtime the UI suites render against', () => {
  it('recovered a real runtime surface from the installed package', () => {
    // Floors, not counts: the surface legitimately grows and shrinks. Their job is to fail when the
    // extraction stops finding anything, which would otherwise leave every check below comparing
    // against empty arrays and passing forever. Today: 1 chunk, 76 components, 52 hooks, 25 utils.
    expect(extracted.length).toBeGreaterThanOrEqual(1);
    expect(packaged).toBeDefined();
    expect(packaged!.apiVersion).toBeGreaterThanOrEqual(1);
    expect(packaged!.components.length).toBeGreaterThanOrEqual(50);
    expect(packaged!.hooks.length).toBeGreaterThanOrEqual(30);
    expect(packaged!.utils.length).toBeGreaterThanOrEqual(15);
    // Names, not mangled values: if minification ever renamed the keys the lists would be gibberish.
    expect(packaged!.components).toContain('DataTableRow');
    expect(packaged!.hooks).toContain('useTranslation');
    expect(packaged!.utils).toContain('apiErrorMessage');
  });

  it('recovered the same surface from every chunk that installs one', () => {
    for (const { file, surface } of extracted.slice(1)) {
      expect(surface, `${file} disagrees with ${extracted[0]!.file}`).toEqual(extracted[0]!.surface);
    }
  });

  it('is large enough to be worth guarding', () => {
    // A stand-in that quietly shrank to a handful would satisfy every subset check below while
    // covering almost none of the surface the suites render through.
    expect(copied.components.length).toBeGreaterThanOrEqual(50);
    expect(copied.hooks.length).toBeGreaterThanOrEqual(30);
    expect(copied.utils.length).toBeGreaterThanOrEqual(15);
  });

  const maps: ('components' | 'hooks' | 'utils')[] = ['components', 'hooks', 'utils'];

  it.each(maps)('exposes no %s name the host does not have', (map) => {
    // The stand-in may be a subset, never a superset: a name the host does not install is a primitive
    // no bundle can reach in production, so any suite rendering it is testing this fixture alone.
    const host = new Set([...packaged![map], ...AHEAD_OF_RELEASE_RUNTIME[map]]);
    expect(copied[map].filter((name) => !host.has(name))).toEqual([]);
  });

  it.each(maps)('claims nothing as unreleased that the pinned package already ships (%s)', (map) => {
    // The forcing function on tests/ui/hostAheadOfRelease.ts: once the devDependency is bumped to a
    // release carrying these, the exemption has to be deleted rather than left to rot into a hole.
    const shipped = new Set(packaged![map]);
    expect(AHEAD_OF_RELEASE_RUNTIME[map].filter((name) => shipped.has(name))).toEqual([]);
  });

  it('announces the API version the host it targets declares', () => {
    // The version is a compatibility CEILING (`entry.apiVersion <= host`), so a stand-in claiming a
    // version ABOVE the host would load bundles the real host would refuse. It is allowed to run ahead
    // of the pinned package only by the amount hostAheadOfRelease.ts declares and explains.
    expect(copied.apiVersion).toBe(AHEAD_OF_RELEASE_API_VERSION);
    expect(AHEAD_OF_RELEASE_API_VERSION).toBeGreaterThanOrEqual(packaged!.apiVersion);
  });
});
