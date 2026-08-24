// @vitest-environment node
/** One meaning of "is this sender an admin" across every platform adapter.
 *
 *  Three of the four adapters used to answer the admin gate with `policies.some(p => p.admin && matches)`
 *  while answering `accessFor` with `policies.find(matches)`. Those are different questions, and the gap
 *  between them was a live privilege bug: a sender whose FIRST matching policy is a restricted role but
 *  who also matches an `admin: true` role further down passed the operator gate — `/model` and
 *  `/reasoning` for the whole shared chat, `/restart`, answering someone else's parked question — while
 *  running with the restricted role's scope. Teams already resolved first-match-wins and its comment
 *  recorded that as the correct reading; the other three were unmigrated copies.
 *
 *  The plugins cannot share this code: `elowen-plugin-shared` is a published npm package built from the
 *  CORE repository, and each installed plugin resolves its own copy from `node_modules`, so a helper
 *  added there does not reach an adapter until a new version is published AND every plugin reinstalled.
 *  Identity matching is genuinely per-platform anyway (Discord compares role snowflakes, Telegram
 *  @usernames, WhatsApp digits, Teams UPNs and GUIDs). What must not diverge is the RESOLUTION, so each
 *  plugin exposes the same `matchPolicy` and derives its admin gate from it — and this file pins that
 *  they all agree, by DISCOVERING the platform plugins rather than listing them by hand.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const pluginsDir = join(repoRoot, 'plugins');

type Policy = { roleId: string; admin?: boolean; name?: string };
type PolicyModule = {
  matchPolicy: (ids: unknown, policies: unknown) => Policy | undefined;
  isAdmin: (ids: unknown, policies: unknown) => boolean;
};

/** Every .mjs file a plugin owns (excluding any vendored dependency tree). */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (entry.endsWith('.mjs')) out.push(path);
  }
  return out;
}

/** A platform adapter is a plugin that turns a matched policy into the shared access descriptor. That
 *  import is the actual dependency being pinned, so it — not a hand-written list — decides who is in
 *  scope here: a fifth platform added tomorrow is covered the moment it calls `buildRoleAccess`. */
const platformPlugins = readdirSync(pluginsDir)
  .filter((name) => statSync(join(pluginsDir, name)).isDirectory())
  .filter((name) => sourceFiles(join(pluginsDir, name)).some((f) => readFileSync(f, 'utf8').includes('buildRoleAccess(')))
  .sort();

const loaded: Array<[string, PolicyModule]> = [];
for (const name of platformPlugins) {
  const mod = (await import(join(pluginsDir, name, 'index.mjs'))) as Record<string, unknown>;
  const isAdmin = (mod.senderIsAdmin ?? mod.memberIsAdmin) as PolicyModule['isAdmin'];
  loaded.push([name, { matchPolicy: mod.matchPolicy as PolicyModule['matchPolicy'], isAdmin }]);
}

/** An identifier each platform's matcher accepts verbatim: digits satisfy WhatsApp's digits-only
 *  comparison and are equally valid as a Discord role id, a Telegram user id and a Teams object id. */
const SENDER = '420111222333';
const OTHER = '420999888777';

describe('platform policy resolution (discovered adapters)', () => {
  it('covers every platform adapter in the registry', () => {
    expect(platformPlugins).toEqual(['discord', 'msteams', 'telegram', 'whatsapp']);
  });

  it('exposes one ordered matchPolicy per platform, with the admin gate derived from it', () => {
    for (const [name, mod] of loaded) {
      expect(typeof mod.matchPolicy, `${name} exports matchPolicy`).toBe('function');
      expect(typeof mod.isAdmin, `${name} exports its admin gate`).toBe('function');
    }
  });

  it('resolves a policy list only through matchPolicy — no adapter keeps a second scan', () => {
    // Derived, not a file list: `matchPolicy` is the only function allowed to walk a policy array, so
    // any `<something>policies.find(...)` / `.some(...)` anywhere in a platform plugin is a second
    // resolution path and exactly the divergence this suite exists to prevent.
    const offenders: string[] = [];
    for (const name of platformPlugins) {
      for (const file of sourceFiles(join(pluginsDir, name))) {
        const text = readFileSync(file, 'utf8');
        text.split('\n').forEach((line, i) => {
          // The second pattern must NOT stop at the first `)` — the scan being guarded against reads
          // `list.some((p) => p.roleId && p.admin === true …)`, and a lazy character class gives up on
          // the arrow's own parentheses and waves the bug straight through.
          if (/[Pp]olicies\.(find|some)\(/.test(line) || /\.(some|find)\(.*\badmin\b/.test(line)) {
            offenders.push(`${file.slice(repoRoot.length)}:${i + 1}: ${line.trim()}`);
          }
        });
      }
    }
    expect(offenders).toEqual([]);
  });

  it('is NOT admin when a restricted policy matches first and an admin policy matches later', () => {
    // The privilege bug, one case per platform. Under the old `.some(p => p.admin && matches)` gate this
    // sender was an operator while carrying the restricted role's scope.
    const policies: Policy[] = [
      { roleId: SENDER, name: 'restricted' },
      { roleId: SENDER, admin: true, name: 'operator' },
    ];
    for (const [name, mod] of loaded) {
      expect(mod.matchPolicy([SENDER], policies)?.name, `${name} first match`).toBe('restricted');
      expect(mod.isAdmin([SENDER], policies), `${name} admin gate`).toBe(false);
    }
  });

  it('is admin when the admin policy is the one that matches first', () => {
    const policies: Policy[] = [
      { roleId: SENDER, admin: true, name: 'operator' },
      { roleId: SENDER, name: 'restricted' },
    ];
    for (const [name, mod] of loaded) {
      expect(mod.matchPolicy([SENDER], policies)?.name, `${name} first match`).toBe('operator');
      expect(mod.isAdmin([SENDER], policies), `${name} admin gate`).toBe(true);
    }
  });

  it('leaves an unmatched sender unresolved and not admin', () => {
    const policies: Policy[] = [{ roleId: OTHER, admin: true, name: 'operator' }];
    for (const [name, mod] of loaded) {
      expect(mod.matchPolicy([SENDER], policies), `${name} unmatched`).toBeUndefined();
      expect(mod.isAdmin([SENDER], policies), `${name} unmatched admin`).toBe(false);
    }
  });

  it('supports the wildcard policy uniformly, including a sender carrying no identifiers', () => {
    // `*` was Teams-only. On Discord it must also match a member with an EMPTY role list: `member.roles`
    // omits @everyone, so a plain member arrives with no ids at all and a wildcard resolved only through
    // the id list would skip precisely the people it exists to cover.
    const policies: Policy[] = [{ roleId: '*', name: 'everyone' }];
    for (const [name, mod] of loaded) {
      expect(mod.matchPolicy([SENDER], policies)?.name, `${name} wildcard`).toBe('everyone');
      expect(mod.matchPolicy([], policies)?.name, `${name} wildcard, no ids`).toBe('everyone');
    }
  });

  it('lets a named policy above a wildcard keep its sender', () => {
    const policies: Policy[] = [
      { roleId: SENDER, admin: true, name: 'operator' },
      { roleId: '*', name: 'everyone' },
    ];
    for (const [name, mod] of loaded) {
      expect(mod.matchPolicy([SENDER], policies)?.name, `${name} named wins`).toBe('operator');
      expect(mod.matchPolicy([OTHER], policies)?.name, `${name} wildcard catches`).toBe('everyone');
      expect(mod.isAdmin([OTHER], policies), `${name} wildcard is not admin`).toBe(false);
    }
  });

  it('never lets a BLANK roleId match anyone', () => {
    // A blank `roleId` is what an operator leaves behind after clearing a row in the settings UI — two
    // such rows sit in this instance's Teams config right now. An empty policy must match nobody; read
    // as "matches anything", it would hand the whole world whatever that row grants.
    const blank: Policy[] = [{ roleId: '', admin: true, name: 'blank' }];
    for (const [name, mod] of loaded) {
      expect(mod.matchPolicy([SENDER], blank), `${name} blank policy`).toBeUndefined();
      expect(mod.matchPolicy([''], blank), `${name} blank policy, blank id`).toBeUndefined();
      expect(mod.isAdmin([SENDER], blank), `${name} blank policy admin`).toBe(false);
    }
  });

  it('lets a wildcard cover a sender whose identifiers did not resolve', () => {
    // `*` is resolved at the POLICY level, so it matches before any identifier is compared — which is
    // why it also covers a sender the platform gave us nothing usable for. That is what an operator
    // writing "everyone" is asking for, and it is deliberately broader than the per-id comparison,
    // where a blank identifier still matches nothing.
    const policies: Policy[] = [{ roleId: '*', name: 'everyone' }];
    for (const [name, mod] of loaded) {
      expect(mod.matchPolicy([''], policies)?.name, `${name} unresolved id`).toBe('everyone');
    }
  });
});
