import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Copy that ONLY a plugin's own views render lives in that plugin's manifest `web.strings`, and the
 *  bundle reads it through the runtime's `usePluginStrings(<plugin>)`. That record is untyped by
 *  construction — the host cannot know a plugin's keys, and a bundle may not import the web app — and the
 *  host's implementation (web/lib/pluginUi.tsx in the daemon) hands back a Proxy that answers a key it
 *  does not carry with the EMPTY STRING, deliberately: the record is empty for the paint or two before
 *  the /plugins/ui listing resolves, and a view formatting its copy there (`s.someKey.replace(…)`) would
 *  take the page down over a string one round-trip away.
 *
 *  The price of that choice is that a typo renders a blank label and nothing anywhere goes red. The
 *  comment on `usePluginStrings` names the static test that pays it — and that test scans the DAEMON's
 *  plugins/ directory, which is not where these four plugins live any more. This is that test, on this
 *  side of the move: every key a bundle here reads must exist in its own manifest.
 *
 *  Its sibling `pluginBundleI18nKeys` checks the other source a bundle reads from (the host's shared
 *  catalog). Both are needed — a bundle legitimately reads from both. */

const registryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PLUGINS = join(registryRoot, 'plugins');

/** Computed reads (`s[expr]`) cannot be resolved statically. Rather than silently falling outside the
 *  check, each one is listed here with the keys it can produce — so the read is still verified, a site
 *  that disappears fails as a stale entry, and a new computed read fails until it is declared. */
const COMPUTED_READS: { file: string; keys: string[] }[] = [
  {
    file: 'browser/web-src/BrowserArtifact.tsx',
    keys: ['action_navigate', 'action_click', 'action_fill', 'action_key', 'action_scroll', 'action_paste'],
  },
  {
    file: 'browser/web-src/BrowserSettings.tsx',
    keys: [
      'dep_label_chrome', 'dep_label_browser_control', 'dep_label_network_proxy',
      'dep_label_profile_storage', 'dep_label_chat_artifacts',
      'dep_chrome_missing', 'dep_chrome_missing_fix', 'dep_chrome_unusable', 'dep_chrome_unusable_fix',
      'dep_control_missing', 'dep_control_missing_fix',
      'dep_proxy_missing', 'dep_proxy_missing_fix', 'dep_proxy_unsupported', 'dep_proxy_unsupported_fix',
      'dep_storage_unwritable', 'dep_storage_unwritable_fix', 'dep_storage_exposed', 'dep_storage_exposed_fix',
      'dep_storage_missing', 'dep_storage_missing_fix', 'dep_artifacts_missing', 'dep_artifacts_missing_fix',
    ],
  },
  {
    file: 'cronjob/web-src/JobsSettings.tsx',
    keys: ['weekdayMon', 'weekdayTue', 'weekdayWed', 'weekdayThu', 'weekdayFri', 'weekdaySat', 'weekdaySun'],
  },
  // KanbanBoard renders one column per entry of its COLUMNS table and reads `s[col.labelKey]`.
  // A site card labels its visibility and status through lookup tables, so both sets are listed here
  // rather than dropping out of the check: a renamed string would otherwise render as a raw enum value.
  {
    file: 'sites/web-src/SitesPage.tsx',
    keys: [
      'visibilityPrivate', 'visibilityProject', 'visibilityAuthenticated', 'visibilityPublic',
      'statusLive', 'statusDraft', 'statusFailed',
    ],
  },
  {
    file: 'sites/web-src/SiteDetail.tsx',
    keys: [
      'visibilityPrivate', 'visibilityProject', 'visibilityAuthenticated', 'visibilityPublic',
      'statusLive', 'statusDraft', 'statusFailed',
    ],
  },
];

interface Manifest { web?: { strings?: Record<string, string> } }

function bundleFiles(pluginsDir: string, plugin: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry)) out.push(path);
    }
  };
  try { walk(join(pluginsDir, plugin, 'web-src')); } catch { /* plugin ships no bundle */ }
  return out;
}

/** Plugins whose manifest declares `web.strings` of their own — every one of them must show up in the
 *  scan. Derived from the manifests rather than counted, so a plugin that lands tomorrow is covered and
 *  a bundle the scan stops seeing fails here instead of passing quietly. */
function pluginsDeclaringStrings(pluginsDir: string = PLUGINS): string[] {
  return readdirSync(pluginsDir).filter((name) => {
    try { return Object.keys((JSON.parse(readFileSync(join(pluginsDir, name, 'elowen-plugin.json'), 'utf-8')) as Manifest).web?.strings ?? {}).length > 0; } catch { return false; }
  }).sort();
}

function manifestStrings(pluginsDir: string, plugin: string): Set<string> {
  const raw = readFileSync(join(pluginsDir, plugin, 'elowen-plugin.json'), 'utf-8');
  return new Set(Object.keys((JSON.parse(raw) as Manifest).web?.strings ?? {}));
}

/** A block comment only ever OPENS at the start of a line here (after indentation, and after a `{` for a
 *  JSX comment). Matching `/*` anywhere, as the daemon's copy of this scan does, is not safe on these
 *  bundles: `cronjob/web-src/JobsSettings.tsx` carries
 *  a `placeholder` holding the shell snippet `cat /new-bookings/` followed by a star, and a lazy
 *  `[\s\S]*?` from there to the next comment closer swallowed 56 lines of real JSX — with them ten `s.`
 *  reads that then sat outside this check entirely, free to be renamed
 *  or misspelled without a word from anywhere. Anchoring the open to a line start keeps a `/*` that is
 *  inside a string from eating the code after it; the fixtures at the bottom hold that case. */
const BLOCK_COMMENT = /^[ \t]*\{?\/\*[\s\S]*?\*\//gm;

/** Prose is not a call site: a key named in a comment has no consumer. Both passes err the same way on
 *  purpose — toward KEEPING code. Leaving a comment in can only produce a loud false positive somebody
 *  fixes; deleting code produces a blind spot that reports green forever. */
function stripComments(source: string): string {
  const code = source.replace(BLOCK_COMMENT, '');
  let out = '';
  // Quote state, so a `//` inside a string (`href="https://…"`, a shell snippet in a placeholder) is not
  // read as a comment. `'` and `"` close at the newline as well: an apostrophe in JSX prose ("it's") is
  // not a string open, and letting it run to the next quote in the file would swallow far more.
  let quote: '"' | "'" | '`' | null = null;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i]!;
    if (quote) {
      out += ch;
      if (ch === '\\') { const escaped = code[++i]; if (escaped !== undefined) out += escaped; continue; }
      if (ch === quote) quote = null;
      else if (ch === '\n' && quote !== '`') quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; out += ch; continue; }
    if (ch === '/' && code[i + 1] === '/') {
      while (i < code.length && code[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    out += ch;
  }
  return out;
}

/** The binding a file gave `usePluginStrings(<plugin>)` — `const s = hooks.usePluginStrings('skills')`, or
 *  `const s = usePluginStrings('editor')` where the hook was destructured off the runtime first. A file
 *  may hold one per plugin; the binding name is what the reads below are matched against. */
const BINDING = /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:[\w$.]+\.)?usePluginStrings\(\s*'([^']+)'\s*\)/g;

interface Read { plugin: string; key: string; where: string }

/** A declaration of the binding's name that is NOT the strings read itself. The scan matches
 *  `<binding>.<key>` textually, so a local of the same name (a reduce accumulator called `s`, say) would
 *  be read as a string lookup and reported as a missing key that is not one. Rather than guess a scope,
 *  that is failed outright with the fix: rename the local. Several COMPONENTS in one file each declaring
 *  the same strings binding is not shadowing — it is the same binding, per component. */
const foreignDeclaration = (name: string): RegExp =>
  // The whitespace sits INSIDE the lookahead on purpose: with `=\s*(?!…)` in front of it, `\s*` simply
  // backtracks to zero and the negative lookahead passes on every declaration, including the intended ones.
  new RegExp(`(?:const|let|var)\\s+${name}\\s*=(?!\\s*(?:[\\w$.]+\\.)?usePluginStrings\\()`, 'g');

interface Scan { statik: Read[]; computed: { plugin: string; where: string }[]; shadowed: string[]; sites: number; files: number }

function collect(pluginsDir: string = PLUGINS): Scan {
  const statik: Read[] = [];
  const computed: { plugin: string; where: string }[] = [];
  const shadowed: string[] = [];
  let sites = 0;
  let files = 0;
  for (const plugin of readdirSync(pluginsDir)) {
    for (const file of bundleFiles(pluginsDir, plugin)) {
      files++;
      const source = stripComments(readFileSync(file, 'utf-8'));
      const bindings = new Map<string, string>(); // variable → plugin it reads
      for (const [, name, owner] of source.matchAll(BINDING)) bindings.set(name!, owner!);
      if (bindings.size === 0) continue;
      sites += bindings.size;
      const where = file.slice(pluginsDir.length + 1);
      for (const [name, owner] of bindings) {
        if (foreignDeclaration(name).test(source)) { shadowed.push(`${where}: "${name}"`); continue; }
        for (const [, key] of source.matchAll(new RegExp(`\\b${name}\\.([A-Za-z_$][\\w$]*)`, 'g'))) {
          statik.push({ plugin: owner, key: key!, where });
        }
        if (new RegExp(`\\b${name}\\[`).test(source)) computed.push({ plugin: owner, where });
      }
    }
  }
  return { statik, computed, shadowed, sites, files };
}

describe('plugin web bundles against their own manifest strings', () => {
  const { statik, computed, shadowed, sites, files } = collect();

  // A file that reuses the binding's name for something else is skipped by the scan above, which would
  // quietly take its reads outside the check — so it fails here instead, naming the file to rename in.
  it('do not shadow the strings binding', () => {
    expect(shadowed).toEqual([]);
  });

  it('read only keys their manifest declares', () => {
    // The scan really found the bundles. Two independent ways, because each covers the other's blind
    // spot: every plugin that declares strings of its own must have a read site (structural, and it
    // follows the set of plugins as it changes), and the totals must stay in the range this registry
    // actually has (39 bundle files, 8 read sites, 344 static reads, 273 distinct keys today). The
    // floors are deliberately under those numbers — they are there to fail an empty or half-blind
    // scan, not to be updated every time a view is edited.
    //
    // Removing `agents` and `work` moved two of these and left two alone, which is worth knowing before
    // anyone "restores" the old figures: the file and read-site counts fell with the bundles, while the
    // static reads and distinct keys did not, because those two plugins bound their strings through a
    // handful of large views rather than many small ones.
    const declaring = pluginsDeclaringStrings();
    expect(declaring.length).toBeGreaterThan(0);
    expect(declaring.filter((name) => !statik.some((read) => read.plugin === name))).toEqual([]);
    expect(files).toBeGreaterThanOrEqual(39);
    expect(sites).toBeGreaterThanOrEqual(8);
    expect(statik.length).toBeGreaterThanOrEqual(250);
    expect(new Set(statik.map((read) => `${read.plugin}.${read.key}`)).size).toBeGreaterThanOrEqual(200);

    const byPlugin = new Map<string, Set<string>>();
    const missing: string[] = [];
    for (const { plugin, key, where } of statik) {
      if (!byPlugin.has(plugin)) byPlugin.set(plugin, manifestStrings(PLUGINS, plugin));
      if (!byPlugin.get(plugin)!.has(key)) missing.push(`${where}: ${plugin}.${key}`);
    }
    expect(missing).toEqual([]);
  });

  it('declare every computed read, and every declared one still exists', () => {
    // A computed read this scan cannot resolve must be visible, never skipped — the declaration is what
    // keeps it inside the check.
    const declared = new Set(COMPUTED_READS.map((entry) => entry.file));
    expect(computed.filter((read) => !declared.has(read.where)).map((read) => read.where)).toEqual([]);

    const found = new Set(computed.map((read) => read.where));
    expect(COMPUTED_READS.filter((entry) => !found.has(entry.file)).map((entry) => entry.file)).toEqual([]);

    const missing: string[] = [];
    for (const entry of COMPUTED_READS) {
      const plugin = entry.file.split('/')[0]!;
      const strings = manifestStrings(PLUGINS, plugin);
      for (const key of entry.keys) if (!strings.has(key)) missing.push(`${entry.file}: ${plugin}.${key}`);
    }
    expect(missing).toEqual([]);
  });
});

/** Everything above is the SCAN's verdict on the bundles this registry ships, and three of its
 *  assertions read empty lists today — no undeclared computed read, no stale declaration, no shadowed
 *  binding. An empty list means "clean" only for as long as the scanner still sees what it is looking
 *  at; a regex that stopped matching would report exactly the same green. So the scanner is run over a
 *  bundle written here, holding one of each thing it must catch — including the string that opens a
 *  block comment, which is not hypothetical: it cost this repo ten unchecked reads. */
describe('the scan itself still sees what it is looking for', () => {
  let dir: string | undefined;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = undefined; });

  const scan = (files: Record<string, string>): Scan => {
    dir = mkdtempSync(join(tmpdir(), 'plugin-strings-scan-'));
    for (const [path, source] of Object.entries(files)) {
      const full = join(dir, 'ledger', 'web-src', path);
      mkdirSync(join(full, '..'), { recursive: true });
      writeFileSync(full, source);
    }
    return collect(dir);
  };

  it('resolves a static read, and ignores prose naming a key', () => {
    const found = scan({
      'Panel.tsx': [
        "const s = hooks.usePluginStrings('ledger');",
        'export const Panel = () => <h1>{s.title}</h1>;',
        '// s.commentedOut is prose, not a call site',
        '/** neither is s.documented */',
      ].join('\n'),
    });
    expect(found.statik.map((r) => `${r.plugin}.${r.key}`)).toEqual(['ledger.title']);
    expect(found.sites).toBe(1);
  });

  it('keeps reading a file after a string that contains a comment opener', () => {
    // The exact shape from cronjob's JobsSettings: a shell snippet in a placeholder holds `/*`, and the
    // next `*/` is 50-odd lines further down in a real doc comment. Everything between them is code.
    const found = scan({
      'Jobs.tsx': [
        "const s = hooks.usePluginStrings('ledger');",
        'export const Jobs = () => (<>',
        '  <input placeholder="cat /new-bookings/*" />',
        '  <span>{s.afterTheSnippet}</span>',
        '</>);',
        '/** A doc comment whose closer would end that fake block. */',
        'export const More = () => <span>{s.afterTheComment}</span>;',
      ].join('\n'),
    });
    expect(found.statik.map((r) => r.key)).toEqual(['afterTheSnippet', 'afterTheComment']);
  });

  it('does not read a URL in a string as a line comment', () => {
    const found = scan({
      'Link.tsx': [
        "const s = hooks.usePluginStrings('ledger');",
        'export const Link = () => <a href="https://example.test/docs">{s.docs}</a>;',
        'export const Note = () => <p>It\'s fine {s.note}</p>;',
      ].join('\n'),
    });
    expect(found.statik.map((r) => r.key)).toEqual(['docs', 'note']);
  });

  it('reports a computed read rather than passing over it', () => {
    const found = scan({
      'Board.tsx': [
        "const s = hooks.usePluginStrings('ledger');",
        'export const Board = ({ col }) => <span>{s[col.labelKey]}</span>;',
      ].join('\n'),
    });
    expect(found.computed.map((r) => `${r.plugin}: ${r.where}`)).toEqual(['ledger: ledger/web-src/Board.tsx']);
  });

  it('reports a binding name reused for something else instead of misreading its properties', () => {
    const found = scan({
      'Totals.tsx': [
        "const s = hooks.usePluginStrings('ledger');",
        'export const Totals = ({ rows }) => { const s = rows.summary; return <span>{s.amount}</span>; };',
      ].join('\n'),
    });
    expect(found.shadowed).toEqual(['ledger/web-src/Totals.tsx: "s"']);
    expect(found.statik).toEqual([]); // …and the misread properties never reach the key comparison
  });

  it('catches a key the manifest does not declare', () => {
    // The whole point, on a fixture: the comparison the suite above runs, over a manifest written here.
    dir = mkdtempSync(join(tmpdir(), 'plugin-strings-scan-'));
    mkdirSync(join(dir, 'ledger', 'web-src'), { recursive: true });
    writeFileSync(join(dir, 'ledger', 'elowen-plugin.json'), JSON.stringify({ web: { strings: { title: 'Ledger' } } }));
    writeFileSync(join(dir, 'ledger', 'web-src', 'Panel.tsx'), [
      "const s = hooks.usePluginStrings('ledger');",
      'export const Panel = () => <h1>{s.title}{s.subtitle}</h1>;',
    ].join('\n'));
    const found = collect(dir);
    expect(pluginsDeclaringStrings(dir)).toEqual(['ledger']);
    const declared = manifestStrings(dir, 'ledger');
    expect(found.statik.filter((r) => !declared.has(r.key)).map((r) => `${r.where}: ${r.plugin}.${r.key}`))
      .toEqual(['ledger/web-src/Panel.tsx: ledger.subtitle']);
  });
});
