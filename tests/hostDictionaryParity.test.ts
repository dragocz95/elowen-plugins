// @vitest-environment node
/** tests/ui/hostDictionary.ts is a COPY of the daemon's user-facing catalog, and this is what keeps it
 *  honest.
 *
 *  The UI suites render adopted plugin bundles against host stand-ins, and those stand-ins serve
 *  translations out of that copy. The copy's header says it is verbatim, and the reason is in the
 *  header too: if a label here is paraphrased, every assertion that reads it stops testing the view
 *  and starts testing this file. Nothing enforced that, and it drifted exactly once already —
 *  `pluginUi.notGranted` was reworded in the daemon, the copy kept the old wording, and both
 *  repositories stayed green while the suites asserted text no user would ever see.
 *
 *  WHICH SIDE IS THE TRUTH: the installed `elowen` devDependency, never a sibling checkout. CI has the
 *  package and nothing else, so a guard that reached into a working copy of the daemon would pass on a
 *  developer's machine and mean nothing on the runner. That also fixes the version this repo is
 *  actually tested against: a reword landing in the daemon's git is NOT yet product text, and the copy
 *  should follow it only when the release the registry depends on carries it.
 *
 *  WHICH DIRECTION IS ENFORCED: the copy must be a faithful SUBSET. Every key it carries has to exist
 *  in the package and hold byte-identical text — that is the failure that matters. Keys the package has
 *  and the copy does not are fine and deliberate: the copy is narrowed to the sections this repo
 *  renders, and adding one back is a copy-paste (see its header). So a section the daemon grows never
 *  reddens this file; a word it changes underneath a section we DO carry always does.
 *
 *  HOW IT IS READ: the package publishes the web app as a built Next.js bundle, not as the
 *  `web/lib/i18n/dictionaries/*.ts` sources, so there is no module to import. The `dictionaries`
 *  map survives the build as a plain object literal, and it is recovered from the emitted chunks by
 *  brace-matching and evaluating it as data. That is indirect, so the extraction is bounded from below
 *  everywhere: an extraction that silently stops finding anything fails loudly instead of passing
 *  forever while comparing nothing.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

import { en as copiedEn, cs as copiedCs } from './ui/hostDictionary';
import { AHEAD_OF_RELEASE_DICTIONARY } from './ui/hostAheadOfRelease';

const requireFromHere = createRequire(import.meta.url);
const packageRoot = dirname(requireFromHere.resolve('elowen/package.json'));

type Dict = Record<string, unknown>;
type Dictionaries = { en: Dict; cs: Dict; sk: Dict };

/** Walk a minified object literal from its opening brace to the brace that closes it, stepping over
 *  string contents so a `{` inside a translated sentence cannot end the match early. */
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

function looksLikeDictionaries(value: unknown): value is Dictionaries {
  const v = value as Dictionaries | null;
  return (
    !!v &&
    typeof v === 'object' &&
    ['en', 'cs', 'sk'].every((locale) => !!(v as Dict)[locale] && typeof (v as Dict)[locale] === 'object') &&
    typeof (v.en?.nav as Dict | undefined)?.home === 'string'
  );
}

/** Every emitted bundle that carries the locale map, recovered as data. Both the browser chunk and the
 *  server chunk hold one; finding several is useful, because they must agree. */
function extractDictionaries(): { file: string; dictionaries: Dictionaries }[] {
  const found: { file: string; dictionaries: Dictionaries }[] = [];
  const roots = [
    join(packageRoot, 'web-dist', '.next', 'static', 'chunks'),
    join(packageRoot, 'web-dist', '.next', 'server', 'chunks', 'ssr'),
  ];
  for (const dir of roots) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.js')) continue;
      const source = readFileSync(join(dir, name), 'utf8');
      for (let at = source.indexOf('{en:{'); at >= 0; at = source.indexOf('{en:{', at + 1)) {
        const literal = objectLiteralAt(source, at);
        // The real map is tens of kilobytes; anything small is some other `{en:{…}}` in app code.
        if (!literal || literal.length < 10_000) continue;
        let value: unknown;
        try {
          // A build artifact of a pinned devDependency, evaluated as DATA in a context with no globals
          // — it is a nested object of string literals and nothing else can be reached from it.
          value = runInNewContext(`(${literal})`, Object.create(null), { timeout: 5_000 });
        } catch {
          continue;
        }
        if (looksLikeDictionaries(value)) found.push({ file: join(dir, name), dictionaries: value });
        at += literal.length - 1;
      }
    }
  }
  return found;
}

const extracted = extractDictionaries();
const packaged = extracted[0]?.dictionaries;

/** `{ 'nav.home': 'Home', … }` — leaf paths, so a comparison names the exact key that moved. */
function flatten(value: Dict, prefix = '', out = new Map<string, unknown>()): Map<string, unknown> {
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object') flatten(child as Dict, path, out);
    else out.set(path, child);
  }
  return out;
}

describe('the copy of the daemon dictionary that the UI suites assert against', () => {
  it('recovered a real catalog from the installed package', () => {
    // The floors are the counts as they stand: 2 bundles carry the map, each with 43 sections and
    // 1801 leaves per locale. Without them a bundler change that defeats the extraction would leave
    // every comparison below iterating an empty map and passing forever.
    expect(extracted.length).toBeGreaterThanOrEqual(2);
    expect(packaged).toBeDefined();
    expect(Object.keys(packaged!.en).length).toBeGreaterThanOrEqual(40);
    // A floor, not a count. Its job is to fail when the extraction stops finding anything, not to pin
    // the dictionary's size: the daemon's catalog legitimately SHRINKS when a screen is retired, and
    // 0.28.17 dropped ~130 keys with the settings redesign. Kept well below the real figure so a
    // genuine truncation (which yields zero or a handful) still reddens this.
    expect(flatten(packaged!.en).size).toBeGreaterThanOrEqual(1_500);
    expect(flatten(packaged!.cs).size).toBeGreaterThanOrEqual(1_500);
  });

  it('recovered the same catalog from every bundle that carries one', () => {
    // The browser chunk and the server chunk are built from one source. If they ever disagree the
    // extraction is picking up something that is not the dictionary.
    for (const { file, dictionaries } of extracted.slice(1)) {
      expect(dictionaries, `${file} disagrees with ${extracted[0].file}`).toEqual(extracted[0].dictionaries);
    }
  });

  it('is large enough to be worth guarding', () => {
    // 495 leaves per locale today, down from 778: the daemon's catalog lost its `tasks` and `missions`
    // sections when the work and agents plugins moved into this repository and took their own i18n with
    // them, so the copy narrowed to match. A copy that quietly shrank to a handful would otherwise
    // satisfy every assertion below while covering almost none of the text the suites read.
    expect(flatten(copiedEn as unknown as Dict).size).toBeGreaterThanOrEqual(450);
    expect(flatten(copiedCs as unknown as Dict).size).toBeGreaterThanOrEqual(450);
  });

  const locales: [string, Dict][] = [
    ['en', copiedEn as unknown as Dict],
    ['cs', copiedCs as unknown as Dict],
  ];

  it.each(locales)('carries no %s key the package does not have', (locale, copied) => {
    // The copy is allowed to be a subset, never a superset: a key the package has dropped or never had
    // is text the product cannot render, so any suite asserting it is testing this file alone.
    //
    // The one exception is a section the daemon's main branch has already added and the pinned release
    // does not carry yet — the copy has to lead it for the suites that render the component reading it.
    // Each such key is named in tests/ui/hostAheadOfRelease.ts and checked below, so the exemption is a
    // list that can only shrink, not a hole in this guard.
    const packagedLeaves = flatten(packaged![locale as 'en' | 'cs']);
    const ahead = new Set(AHEAD_OF_RELEASE_DICTIONARY);
    const unknownKeys = [...flatten(copied).keys()].filter((key) => !packagedLeaves.has(key) && !ahead.has(key));
    expect(unknownKeys).toEqual([]);
  });

  it.each(locales)('claims no %s key as unreleased that the package already ships', (locale) => {
    // The forcing function: bumping the elowen devDependency to a release carrying these keys fails
    // here until the entry is deleted and the copy is resynced against the package like every other key.
    const packagedLeaves = flatten(packaged![locale as 'en' | 'cs']);
    expect(AHEAD_OF_RELEASE_DICTIONARY.filter((key) => packagedLeaves.has(key))).toEqual([]);
  });

  it.each(locales)('reproduces every %s string it carries verbatim', (locale, copied) => {
    const packagedLeaves = flatten(packaged![locale as 'en' | 'cs']);
    const drifted = [...flatten(copied).entries()]
      .filter(([key, text]) => packagedLeaves.has(key) && packagedLeaves.get(key) !== text)
      .map(([key, text]) => ({ key, copy: text, package: packagedLeaves.get(key) }));
    // Reported as a list rather than key by key so a resync sees everything that moved in one run.
    expect(drifted).toEqual([]);
  });
});
