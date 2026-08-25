import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalogSize, loadHostCatalog } from './hostCatalog.js';

/** Plugin web bundles render their shared copy out of the HOST's translation catalog (they reach it
 *  through the runtime's `useTranslation`), because that copy is shared with core surfaces and
 *  duplicating hundreds of keys per bundle could not be kept in sync. Inside the host app that
 *  arrangement is type-checked: `LocaleDict` there is `Widen<typeof en>`, so a key that does not exist
 *  does not compile.
 *
 *  A bundle cannot import that type — it is a separate compile unit, in a separate repository now — so
 *  every bundle here declares a structural `Dict` of its own (see each plugin's `web-src/runtime.ts`)
 *  and loses the key checking entirely. A key the host does not carry renders as `undefined`, or crashes
 *  where the view calls `.replace` on it, and nothing else in this registry would say so. This test
 *  restores the guarantee mechanically for EVERY bundle.
 *
 *  Only `t.<namespace>.<key>` where `<namespace>` is a real top-level entry of the catalog is checked:
 *  bundles also name loop variables `t` (a task), and those never spell a real namespace. Computed
 *  access (`t.nav[world.id]`) and aliases (`const e = t.dashboard.ev`) are outside what a static scan can
 *  see — an under-approximation with no false positives, not a claim of totality.
 *
 *  Where the catalog comes from — and what that costs — is documented in `hostCatalog.ts`. */

const registryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BUNDLES = join(registryRoot, 'plugins');
const REF = /\bt\.([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)(?:\.([A-Za-z_$][\w$]*))?/g;

/** Plugins whose manifest declares a browser bundle — the scan has to reach every one of them. Derived
 *  from the manifests rather than counted, so this fails the day a DECLARED bundle stops being scanned:
 *  a renamed folder, a broken walk, sources that moved. */
function pluginsDeclaringABundle(): string[] {
  return readdirSync(BUNDLES).filter((name) => {
    try {
      const manifest = JSON.parse(readFileSync(join(BUNDLES, name, 'elowen-plugin.json'), 'utf-8')) as { web?: { entry?: string } };
      return typeof manifest.web?.entry === 'string';
    } catch { return false; }
  }).sort();
}

function bundleFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(entry)) out.push(p);
    }
  };
  for (const plugin of readdirSync(BUNDLES)) {
    const webSrc = join(BUNDLES, plugin, 'web-src');
    try { if (statSync(webSrc).isDirectory()) walk(webSrc); } catch { /* plugin ships no bundle */ }
  }
  return out;
}

describe('plugin web bundles against the host translation catalog', () => {
  it('resolves the real catalog out of the installed elowen package', () => {
    // Everything below compares against this object. If it ever resolved to a stub — an empty parse, the
    // wrong literal — every reference would be skipped for want of a matching namespace and the contract
    // would report green while checking nothing. So the catalog is sized before it is trusted: 43
    // namespaces and 1606 keys today, from web-dist/.next.
    const { en, source } = loadHostCatalog();
    const { namespaces, keys } = catalogSize(en);
    expect(source).toMatch(/web-dist/);
    expect(namespaces).toBeGreaterThanOrEqual(30);
    expect(keys).toBeGreaterThanOrEqual(1000);
    // Spot-check a leaf, so a catalog of the right SIZE but the wrong content cannot pass either.
    expect(en.nav?.home).toBe('Home');
  });

  it('reference only keys the catalog actually carries', () => {
    const { en } = loadHostCatalog();
    const namespaces = new Set(Object.keys(en));
    const files = bundleFiles();
    // The scan really found the bundles: every plugin that declares one contributes a source.
    const declaring = pluginsDeclaringABundle();
    expect(declaring.length).toBeGreaterThan(0);
    expect(declaring.filter((name) => !files.some((f) => f.startsWith(join(BUNDLES, name, 'web-src') + '/')))).toEqual([]);
    expect(files.length).toBeGreaterThanOrEqual(39);

    const missing: string[] = [];
    let checked = 0;
    for (const file of files) {
      const src = readFileSync(file, 'utf-8');
      for (const [, ns, key, sub] of src.matchAll(REF)) {
        if (!namespaces.has(ns!)) continue;
        checked++;
        const group = en[ns!]!;
        const rel = file.slice(BUNDLES.length + 1);
        if (!(key! in group)) { missing.push(`${rel}: t.${ns}.${key}`); continue; }
        const leaf = group[key!];
        if (sub && leaf !== null && typeof leaf === 'object' && !(sub in (leaf as Record<string, unknown>))) {
          missing.push(`${rel}: t.${ns}.${key}.${sub}`);
        }
      }
    }
    // Finding the FILES is not the same as finding the references: the whole check would go quiet if the
    // pattern drifted or the runtime stopped naming the binding `t`, and `missing` would stay empty for
    // the wrong reason. The floor fails an idle scan long before it reaches zero.
    //
    // It used to read 300, against 430 references across six bundles. `agents` and `work` carried nearly
    // all of them — they were the two bundles with real translated screens — so removing those plugins
    // took the honest count down to 18. The floor follows the reality rather than the other way round;
    // holding the old number would only mean deleting the check the next time someone hit it.
    expect(checked).toBeGreaterThanOrEqual(18);
    expect(missing).toEqual([]);
  });
});
