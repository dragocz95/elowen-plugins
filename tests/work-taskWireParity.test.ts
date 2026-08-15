/** @vitest-environment node */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

/** The work bundle renders tasks in the browser, and it must not import `web/` — so
 *  `plugins/work/web-src/types.ts` carries a hand-written structural copy of the daemon's `Task` JSON.
 *  Nothing else pins it: the schema-parity suites pin SQL DDL (the table), not the wire shape (the row
 *  as it crosses HTTP), and the UI suites only import the type, which proves the bundle agrees with
 *  itself and says nothing about the daemon.
 *
 *  This used to be guarded inside the Elowen package, next to the core web app's own mirror of the same
 *  interface, until the work plugin moved here. That guard exists because of a real incident: the daemon
 *  grew `advisor_exec`/`advisor_autostart` on `/auth/me`, the hand-written copy lagged, and the UI read
 *  `undefined` at runtime with nothing failing anywhere. A copy of a wire shape with no pin is that
 *  incident waiting for its next field.
 *
 *  So the pin follows the type here. It reads the daemon's OWN declaration out of the `elowen`
 *  dependency — the published `.d.ts`, resolved rather than snapshotted, so bumping the dependency moves
 *  the pin with it and a daemon that grew a field fails this suite instead of the user's browser. */
const require_ = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));

const DAEMON_TYPES = require_.resolve('elowen/dist/store/types.d.ts');
const BUNDLE_TYPES = join(HERE, '../plugins/work/web-src/types.ts');

interface Member {
  type: string;
  optional: boolean;
}

const normalize = (type: string): string => type.replace(/\s+/g, ' ').trim();

/** Expand type-alias references (`TaskStatus`, `TaskOutcome`) to their literal bodies so a change INSIDE
 *  an alias trips the pin, not only a change at the member site. Interfaces are left as their name and
 *  compared textually — both sides declare `CommitFileChange` structurally, so the names line up. */
function resolveAliases(type: string, aliases: Map<string, string>): string {
  const expanding = new Set<string>();
  const resolve = (text: string): string => {
    let out = text;
    for (const [name, body] of aliases) {
      if (expanding.has(name)) continue; // TS bans direct alias cycles; this is just a guard
      const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
      if (re.test(out)) {
        expanding.add(name);
        out = out.replace(re, resolve(body));
        expanding.delete(name);
      }
    }
    return out;
  };
  return resolve(type);
}

function load(file: string): { sourceFile: ts.SourceFile; aliases: Map<string, string> } {
  const text = readFileSync(file, 'utf8');
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const aliases = new Map<string, string>();
  for (const stmt of sourceFile.statements) {
    if (ts.isTypeAliasDeclaration(stmt) && ts.isIdentifier(stmt.name)) {
      aliases.set(stmt.name.text, stmt.type.getText(sourceFile));
    }
  }
  return { sourceFile, aliases };
}

function interfaceMembers(parsed: ReturnType<typeof load>, name: string): Map<string, Member> {
  const decl = parsed.sourceFile.statements.find(
    (s): s is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(s) && s.name.text === name,
  );
  if (!decl) throw new Error(`${name} interface not found in ${parsed.sourceFile.fileName}`);
  const members = new Map<string, Member>();
  for (const member of decl.members) {
    if (!ts.isPropertySignature(member) || !ts.isIdentifier(member.name)) continue;
    const typeText = member.type ? member.type.getText(parsed.sourceFile) : '';
    members.set(member.name.text, {
      type: normalize(resolveAliases(typeText, parsed.aliases)),
      optional: Boolean(member.questionToken),
    });
  }
  return members;
}

/** The bundle may narrow a daemon `string` to the closed set of values the daemon actually records
 *  (`outcome` is `'ok' | 'fail' | null` here), but null-ness must match on both sides. */
function typesCompatible(daemon: string, bundle: string): boolean {
  if (daemon === bundle) return true;
  const bundleIsLiteralUnion = bundle
    .split(' | ')
    .every((p) => p === 'null' || (p.startsWith("'") && p.endsWith("'")));
  if ((daemon === 'string' || daemon === 'string | null') && bundleIsLiteralUnion) {
    return daemon.includes('null') === bundle.includes('null');
  }
  return false;
}

/** The bundle may treat a daemon-required field as optional (it tolerates absence), never the reverse:
 *  a bundle-required field the daemon may omit is an `undefined` waiting to render. */
function optionalityCompatible(daemon: Member, bundle: Member): boolean {
  return bundle.optional || !daemon.optional;
}

/** Git bookkeeping and the authoring principal never reach these views. Naming each omission keeps the
 *  decision explicit — a blanket "the bundle may omit anything" would stay silent on exactly the drift
 *  this file exists to catch, the daemon growing a field the bundle never picks up. */
const ALLOW_MISSING = ['base_sha', 'head_sha', 'created_by'] as const;

function compare(): string[] {
  const daemon = load(DAEMON_TYPES);
  const bundle = load(BUNDLE_TYPES);
  const daemonMembers = interfaceMembers(daemon, 'Task');
  const bundleMembers = interfaceMembers(bundle, 'Task');

  const errors: string[] = [];
  for (const [name, daemonMember] of daemonMembers) {
    const bundleMember = bundleMembers.get(name);
    if (!bundleMember) {
      if (!ALLOW_MISSING.includes(name as (typeof ALLOW_MISSING)[number])) {
        errors.push(
          `daemon Task.${name} missing on the work bundle's Task — mirror it, or add it to ALLOW_MISSING if these views deliberately do not render it`,
        );
      }
      continue;
    }
    if (!typesCompatible(daemonMember.type, bundleMember.type)) {
      errors.push(
        `bundle Task.${name}: ${bundleMember.type} does not accept daemon Task.${name}: ${daemonMember.type}`,
      );
    }
    if (!optionalityCompatible(daemonMember, bundleMember)) {
      errors.push(`bundle Task.${name} is required but daemon Task.${name} is optional`);
    }
  }
  for (const name of bundleMembers.keys()) {
    if (!daemonMembers.has(name)) {
      errors.push(`bundle Task.${name} does not exist on daemon Task`);
    }
  }
  return errors;
}

describe("the work bundle's Task mirrors the daemon wire shape", () => {
  it('reads the daemon declaration out of the installed elowen package', () => {
    // Both halves must be real: a resolve that silently found an empty or aliasless file would make
    // every comparison below vacuous, which is the failure mode a mirror test cannot afford.
    const daemonMembers = interfaceMembers(load(DAEMON_TYPES), 'Task');
    const bundleMembers = interfaceMembers(load(BUNDLE_TYPES), 'Task');
    expect(daemonMembers.size).toBeGreaterThan(10);
    expect(bundleMembers.size).toBeGreaterThan(10);
    // The status alias must have been expanded, not left as a bare name — otherwise the two sides would
    // agree on the WORD `TaskStatus` while their value sets drifted apart.
    expect(daemonMembers.get('status')?.type).toContain("'in_progress'");
    expect(bundleMembers.get('status')?.type).toContain("'in_progress'");
    // And the two halves must be DIFFERENT declarations. Everything above passes just as happily when
    // both paths resolve to the same file, and a mirror compared against itself is green by
    // construction — so anchor on the asymmetry that only the real pair has: every allowed omission
    // exists on the daemon and is absent from the bundle. This doubles as the exemption list's own
    // guard, since an entry the daemon no longer declares is a dead exemption nobody would notice.
    for (const name of ALLOW_MISSING) {
      expect(daemonMembers.has(name), `daemon Task.${name} is gone — drop it from ALLOW_MISSING`).toBe(true);
      expect(bundleMembers.has(name), `bundle Task.${name} exists now — drop it from ALLOW_MISSING`).toBe(false);
    }
  });

  it('mirrors every daemon field the views render', () => {
    const errors = compare();
    expect(errors, errors.join('\n')).toEqual([]);
  });

  it('rejects a narrowing that drops a value the daemon can send', () => {
    // The relaxation this pin allows is real but bounded, so prove the boundary rather than trusting it:
    // a literal union may stand in for `string`, but not when the daemon can also send null.
    expect(typesCompatible('string | null', "'ok' | 'fail' | null")).toBe(true);
    expect(typesCompatible('string | null', "'ok' | 'fail'")).toBe(false);
    expect(typesCompatible('string', 'number')).toBe(false);
    expect(optionalityCompatible({ type: 'string', optional: true }, { type: 'string', optional: false })).toBe(false);
  });
});
