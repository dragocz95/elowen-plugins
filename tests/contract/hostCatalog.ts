/** The HOST's English translation catalog, read out of the installed `elowen` package.
 *
 *  A plugin bundle renders shared copy through the runtime's `useTranslation()` (`t.<namespace>.<key>`),
 *  and that catalog belongs to the daemon's web app, not to this repository. Inside the daemon it is
 *  `web/lib/i18n/dictionaries/en.ts` and type-checked; here a bundle declares a structural `Dict` of its
 *  own and loses every key guarantee, so `pluginBundleI18nKeys` restores it mechanically — which needs
 *  the real catalog, from the same place CI has it: `node_modules/elowen`.
 *
 *  WHAT THE PACKAGE PUBLISHES. `elowen`'s `files` are dist/, web-dist/, prompts/, plugins/ and docs —
 *  the web app's SOURCE is not among them, so there is no `elowen/web/lib/i18n/...` to import and no
 *  exports entry for the catalog. What IS published is `web-dist/`, the built Next.js app, and the
 *  dictionaries survive that build verbatim as one object literal (`{en:{nav:{worlds:"Spaces",…}},cs:…}`)
 *  inside a chunk. So the catalog is genuinely reachable through the dependency — it just has to be read
 *  out of the build rather than imported. That is what this file does: find the literal, parse it with a
 *  strict mini-parser, and hand back `en`.
 *
 *  WHAT IT COSTS. The shape of that build output is the daemon's private business: a different bundler,
 *  a chunk format that drops object literals, or a per-locale split would all break the lookup. It
 *  therefore fails LOUDLY — `loadHostCatalog` throws with what it looked at, and its caller asserts a
 *  floor on namespaces and keys — because the one outcome worth ruling out is a catalog that quietly
 *  resolves to `{}` and turns the whole i18n contract into an idle green.
 *
 *  The alternative was a checked-in snapshot, which is what `tests/ui/hostDictionary.ts` already is for
 *  RENDERING. As the contract's source of truth a snapshot is strictly worse: it cannot tell a key the
 *  host dropped from a key the snapshot never had, so it would pass on exactly the breakage this test
 *  exists to catch. Reading the dependency means the check moves when the host moves.
 *
 *  Note this is the catalog the INSTALLED version ships (`elowen` 0.28.1 today), not whatever the
 *  daemon's working copy holds. That is the point: it is the host these bundles actually run in. */
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

type CatalogGroup = Record<string, unknown>;
export type Catalog = Record<string, CatalogGroup>;

/** A minified object literal is not JSON: keys are bare identifiers and strings may be single-quoted.
 *  Rather than `eval`-ing a slice of a dependency's build output, this parses the small subset a
 *  dictionary can be made of and throws on anything else — a function, a template literal, an
 *  identifier reference — so an unexpected shape is a failure, never a half-read object. */
function parseObjectLiteral(source: string, start: number): Record<string, unknown> {
  let i = start;
  const fail = (what: string): never => {
    throw new Error(`${what} at offset ${i}: ${JSON.stringify(source.slice(Math.max(0, i - 40), i + 40))}`);
  };
  const skipSpace = (): void => { while (i < source.length && /\s/.test(source[i]!)) i++; };

  const readString = (): string => {
    const quote = source[i++]!;
    let out = '';
    for (;;) {
      if (i >= source.length) fail('unterminated string');
      const ch = source[i++]!;
      if (ch === quote) return out;
      if (ch !== '\\') { out += ch; continue; }
      const esc = source[i++]!;
      if (esc === 'n') out += '\n';
      else if (esc === 't') out += '\t';
      else if (esc === 'r') out += '\r';
      else if (esc === 'b') out += '\b';
      else if (esc === 'f') out += '\f';
      else if (esc === 'v') out += '\v';
      else if (esc === '0') out += '\0';
      else if (esc === 'x') { out += String.fromCharCode(parseInt(source.slice(i, i + 2), 16)); i += 2; }
      else if (esc === 'u') {
        if (source[i] === '{') { const end = source.indexOf('}', i); out += String.fromCodePoint(parseInt(source.slice(i + 1, end), 16)); i = end + 1; }
        else { out += String.fromCharCode(parseInt(source.slice(i, i + 4), 16)); i += 4; }
      } else if (esc === '\n') { /* line continuation */ }
      else out += esc;
    }
  };

  const readValue = (): unknown => {
    skipSpace();
    const ch = source[i];
    if (ch === '{') return readObject();
    if (ch === '"' || ch === "'") return readString();
    if (source.startsWith('true', i)) { i += 4; return true; }
    if (source.startsWith('false', i)) { i += 5; return false; }
    if (source.startsWith('null', i)) { i += 4; return null; }
    const num = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(source.slice(i));
    if (num) { i += num[0].length; return Number(num[0]); }
    return fail('unsupported value');
  };

  const readObject = (): Record<string, unknown> => {
    if (source[i] !== '{') fail('expected {');
    i++;
    const out: Record<string, unknown> = {};
    skipSpace();
    if (source[i] === '}') { i++; return out; }
    for (;;) {
      skipSpace();
      let key: string;
      if (source[i] === '"' || source[i] === "'") key = readString();
      else {
        const ident = /^[A-Za-z_$][\w$]*/.exec(source.slice(i));
        if (!ident) fail('expected a key');
        key = ident![0];
        i += key.length;
      }
      skipSpace();
      if (source[i] !== ':') fail('expected :');
      i++;
      out[key] = readValue();
      skipSpace();
      if (source[i] === ',') { i++; skipSpace(); if (source[i] === '}') { i++; return out; } continue; }
      if (source[i] === '}') { i++; return out; }
      return fail('expected , or }');
    }
  };

  return readObject();
}

/** `en:` opening an object, not preceded by an identifier character or a dot (`.en:` is something else).
 *  Every candidate in every chunk is tried; the dictionary is the one that parses into the right SHAPE,
 *  so a build that reorders, renames or re-hashes chunks changes nothing here. */
const CANDIDATE = /(?:^|[^\w$.])en:(?=\{)/g;

/** A dictionary is namespaces of flat string groups. Demanding that shape (rather than "an object with
 *  an `en` key") is what stops some unrelated `{en:…}` in the build — a locale label map, a flag table —
 *  from being adopted as the catalog. */
function looksLikeCatalog(value: Record<string, unknown>): boolean {
  const groups = Object.entries(value);
  if (groups.length < 20) return false;
  if (!('nav' in value) || !('common' in value)) return false;
  return groups.every(([, group]) =>
    group !== null && typeof group === 'object' && !Array.isArray(group)
    && Object.values(group as Record<string, unknown>).every((leaf) => typeof leaf === 'string' || (leaf !== null && typeof leaf === 'object')));
}

function jsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    let entries: string[];
    try { entries = readdirSync(current); } catch { return; }
    for (const entry of entries.sort()) {
      const path = join(current, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (entry.endsWith('.js')) out.push(path);
    }
  };
  walk(dir);
  return out;
}

let cached: { en: Catalog; source: string } | undefined;

/** The host's English catalog plus the built file it came from (reported on failure, and asserted on by
 *  the suite's own self-check). Cached: the scan reads a few megabytes of build output. */
export function loadHostCatalog(): { en: Catalog; source: string } {
  if (cached) return cached;
  const require = createRequire(import.meta.url);
  const packageRoot = dirname(require.resolve('elowen/package.json'));
  const webDist = join(packageRoot, 'web-dist', '.next');
  // Server chunks first: same content as the browser ones, and a smaller haystack.
  const files = [...jsFilesUnder(join(webDist, 'server')), ...jsFilesUnder(join(webDist, 'static'))];
  if (files.length === 0) throw new Error(`no built web app in the installed elowen package (looked under ${webDist})`);

  for (const file of files) {
    const source = readFileSync(file, 'utf-8');
    CANDIDATE.lastIndex = 0;
    for (let match = CANDIDATE.exec(source); match; match = CANDIDATE.exec(source)) {
      let parsed: Record<string, unknown>;
      try { parsed = parseObjectLiteral(source, match.index + match[0].length); } catch { continue; }
      if (!looksLikeCatalog(parsed)) continue;
      cached = { en: parsed as Catalog, source: file.slice(packageRoot.length + 1) };
      return cached;
    }
  }
  throw new Error(
    `the host translation catalog was not found in the installed elowen package (${files.length} built files under ${webDist}). `
    + 'The daemon publishes it inside web-dist/; if that build output changed shape, this loader has to be taught the new one — '
    + 'do not drop the check.',
  );
}

/** Namespace and leaf-key totals, for the floor the i18n test asserts: a catalog that parsed into a stub
 *  must not be able to pass the contract by knowing nothing. */
export function catalogSize(en: Catalog): { namespaces: number; keys: number } {
  let keys = 0;
  for (const group of Object.values(en)) keys += Object.keys(group).length;
  return { namespaces: Object.keys(en).length, keys };
}
