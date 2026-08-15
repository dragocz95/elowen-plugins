// @vitest-environment node
/** The editor plugin carries its own copy of the daemon's git-sha guard.
 *
 *  It has to: a plugin may take only TYPES from core, so anything it needs at runtime it copies. The copy
 *  then has to be held in step by hand, and drift here is silent in the worst direction — an earlier
 *  version of this copy narrowed the shape to `{7,64}`, which still accepted every FULL hash, so nothing
 *  looked broken while every abbreviated hash the UI passes through (git abbreviates to as few as four
 *  characters) quietly started returning an empty diff instead of a commit.
 *
 *  The core repo guards its remaining copies by comparing source text. That is not available here: a
 *  registry checkout has the daemon's compiled `dist/` but not its TypeScript sources, and the copy is a
 *  module-local `const` rather than an export. So this compares BEHAVIOUR instead — which is what
 *  actually matters — by extracting the copy's regex literal and asking both it and the daemon's real
 *  `isGitSha` the same questions.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isGitSha } from 'elowen/dist/shared/gitSha.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const source = readFileSync(join(root, 'plugins', 'editor', 'src', 'files.ts'), 'utf8');

/** The copy's hash-shape regex, as the plugin actually declares it. */
function copiedMatcher(): (value: string) => boolean {
  const match = /\/\^\[0-9a-f\]\{(\d+),(\d+)\}\$\/i/.exec(source);
  if (!match) throw new Error('no git-sha regex literal found in plugins/editor/src/files.ts');
  const re = new RegExp(`^[0-9a-f]{${match[1]},${match[2]}}$`, 'i');
  return (value: string) => re.test(value);
}

describe('the editor plugin copy of isGitSha', () => {
  it('is actually present to be compared', () => {
    // Without this the suite would pass vacuously the day someone deletes or renames the copy.
    expect(() => copiedMatcher()).not.toThrow();
    expect(typeof isGitSha).toBe('function');
  });

  const cases: [string, string][] = [
    ['c6e8', 'the shortest abbreviation git will produce'],
    ['c6e8c5', 'a typical short hash from the UI'],
    ['c6e8c59b', 'the common eight-character form'],
    ['0123456789abcdef0123456789abcdef01234567', 'a full 40-character sha-1'],
    ['C6E8C59B', 'uppercase, which git accepts'],
    ['zzzz', 'not hexadecimal'],
    ['--all', 'a git flag, the injection this guard exists to stop'],
    ['', 'empty'],
    ['abc', 'shorter than git ever abbreviates'],
    ['../etc/passwd', 'a path'],
  ];

  it.each(cases)('agrees with the daemon on %s (%s)', (value) => {
    expect(copiedMatcher()(value)).toBe(isGitSha(value));
  });
});
