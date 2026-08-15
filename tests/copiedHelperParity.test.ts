// @vitest-environment node
/** Parity for the daemon helpers a plugin carries its OWN copy of.
 *
 *  A plugin may take only TYPES from core, so any core helper it needs at RUNTIME it copies into its
 *  own tree. The copy then has to be held in step by hand. The daemon used to own a test that scanned
 *  every plugin's `src` tree and pinned these copies; it was deleted along with the four plugins that
 *  moved into this registry, and for those four nothing replaced it. That test's own comment recorded
 *  the failure it was written for: a change narrowed a hex-shape regex to `{7,64}`, which still
 *  accepted every FULL hash, so nothing looked broken while every abbreviated hash the UI passes
 *  through silently stopped resolving. `gitSha` below is exactly that helper.
 *
 *  Source text cannot be compared across the repo boundary — the daemon's npm package publishes
 *  `dist/`, not `src/` — so this pins BEHAVIOUR against the installed `elowen` package, the way
 *  tests/editorGitShaParity.test.ts already does for the editor's copy. Behavioural equivalence is
 *  worth more than byte equality anyway: it is the only thing that survives the daemon compiling its
 *  TypeScript, and it is what actually breaks a user.
 *
 *  The copies are DISCOVERED, not hand-listed, so one added tomorrow is covered the moment it exists
 *  rather than when someone remembers to write its test. A plugin file counts as a copy of a core
 *  `shared/<name>` module when it sits at the same basename AND exports exactly the same names.
 *  Plugins also keep smaller same-named helpers of their own (clock, logger, text, time, paths) that
 *  were never copies; those export a narrower surface, which is what tells the two apart.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

import { isGitSha as coreIsGitSha } from 'elowen/dist/shared/gitSha.js';
import { KeyedMutex as CoreKeyedMutex } from 'elowen/dist/shared/keyedMutex.js';
import { callElowenApi as coreCallElowenApi } from 'elowen/dist/shared/apiClient.js';
import { classifySession as coreClassifySession } from 'elowen/dist/shared/sessionInfo.js';
import * as coreExecs from 'elowen/dist/shared/execs.js';

import { isGitSha as workIsGitSha } from '../plugins/work/dist/lib/gitSha.js';
import { KeyedMutex as AgentsKeyedMutex } from '../plugins/agents/dist/lib/keyedMutex.js';
import { KeyedMutex as WorkKeyedMutex } from '../plugins/work/dist/lib/keyedMutex.js';
import { callElowenApi as workCallElowenApi } from '../plugins/work/dist/lib/apiClient.js';
import { classifySession as agentsClassifySession } from '../plugins/agents/dist/overseer/sessionInfo.js';
import * as agentsExecs from '../plugins/agents/dist/lib/execs.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const requireFromHere = createRequire(import.meta.url);

/** The daemon's shared modules, read out of the INSTALLED package — CI has the package and no sibling
 *  checkout, so a path into one would pass locally and mean nothing on the runner. */
const coreSharedDir = join(dirname(requireFromHere.resolve('elowen/package.json')), 'dist', 'shared');

/** Ids of the copies this file pins behaviourally. The discovery scan below asserts this list is
 *  exactly what it found, so a NEW copy fails the suite until someone adds cases for it here. */
const PINNED = [
  'agents/execs',
  'agents/keyedMutex',
  'agents/sessionInfo',
  'work/apiClient',
  'work/gitSha',
  'work/keyedMutex',
];

type Candidate = {
  id: string;
  srcRel: string;
  distRel: string;
  pluginExports: string[];
  coreExports: string[];
  isCopy: boolean;
};

function walkTs(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkTs(full, out);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

const coreModules = new Set(
  readdirSync(coreSharedDir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => f.slice(0, -'.js'.length)),
);

const pluginsDir = join(root, 'plugins');
const candidates: Candidate[] = [];
/** A plugin source with no compiled twin — it would silently drop out of the scan, so it is asserted
 *  empty rather than ignored. */
const unbuilt: string[] = [];

for (const plugin of readdirSync(pluginsDir, { withFileTypes: true })) {
  if (!plugin.isDirectory()) continue;
  const srcDir = join(pluginsDir, plugin.name, 'src');
  if (!existsSync(srcDir)) continue;
  for (const srcPath of walkTs(srcDir)) {
    const moduleName = basename(srcPath, '.ts');
    if (!coreModules.has(moduleName)) continue;
    const srcRel = srcPath.slice(root.length);
    const distPath = srcPath.replace(`${plugin.name}/src/`, `${plugin.name}/dist/`).replace(/\.ts$/, '.js');
    if (!existsSync(distPath)) {
      unbuilt.push(srcRel);
      continue;
    }
    const pluginExports = Object.keys(await import(pathToFileURL(distPath).href)).sort();
    const coreExports = Object.keys(await import(pathToFileURL(join(coreSharedDir, `${moduleName}.js`)).href)).sort();
    candidates.push({
      id: `${plugin.name}/${moduleName}`,
      srcRel,
      distRel: distPath.slice(root.length),
      pluginExports,
      coreExports,
      isCopy:
        pluginExports.length === coreExports.length &&
        pluginExports.every((name, i) => name === coreExports[i]),
    });
  }
}

const copies = candidates.filter((c) => c.isCopy).map((c) => c.id).sort();

describe('the scan that finds helpers copied out of core', () => {
  it('actually found something to pin', () => {
    // Without a floor the whole file would pass forever the day the scan breaks — a renamed folder, a
    // moved dist layout — and report nothing while checking nothing. These are the real counts today.
    expect(coreModules.size).toBeGreaterThanOrEqual(26);
    expect(candidates.length).toBeGreaterThanOrEqual(11);
    expect(copies.length).toBeGreaterThanOrEqual(6);
  });

  it('could resolve a compiled twin for every candidate it saw', () => {
    // A copy whose dist is missing would drop out of the scan silently and stop being compared.
    expect(unbuilt).toEqual([]);
  });

  it('pins every copy it discovered', () => {
    // The failure this catches: a plugin copies another core helper in, and nobody writes cases for it.
    // Adding a copy therefore has to be a deliberate edit to PINNED plus a case table below.
    expect(copies).toEqual(PINNED);
  });
});

describe('isGitSha, copied into plugins/work', () => {
  /** Both ends of the range matter. Narrowing the low end is the regression that already happened
   *  once — it still accepts every full hash, so only the abbreviated forms break. */
  const cases: [string, string][] = [
    ['c6e8', 'the shortest abbreviation git will produce'],
    ['abcd', 'four characters, all letters'],
    ['c6e8c5', 'a typical short hash from the UI'],
    ['0123456', 'seven characters, the low bound of the historical bad regex'],
    ['c6e8c59b', 'the common eight-character form'],
    ['0123456789abcdef0123456789abcdef01234567', 'a full 40-character sha-1'],
    ['C6E8C59B', 'uppercase, which git accepts'],
    ['0123456789abcdef0123456789abcdef012345678', '41 characters, longer than a sha-1'],
    ['a'.repeat(64), '64 characters, the high bound of the historical bad regex'],
    ['zzzz', 'not hexadecimal'],
    ['--all', 'a git flag, the injection this guard exists to stop'],
    ['-c', 'a short git option'],
    ['', 'empty'],
    ['abc', 'shorter than git ever abbreviates'],
    ['../etc/passwd', 'a path'],
    ['c6e8 c5', 'hex with a space, which would split into two argv entries'],
  ];

  it.each(cases)('agrees with the daemon on %j (%s)', (value) => {
    expect(workIsGitSha(value)).toBe(coreIsGitSha(value));
  });
});

describe('execs, copied into plugins/agents', () => {
  /** For a data module the tables ARE the behaviour: they seed the config allow-list and the model
   *  picker, so a copy that drifts hands a fresh install different defaults from the daemon's. */
  const tables = ['PROGRAM_PREFIXES', 'DEFAULT_BINS', 'KNOWN_EXECS', 'EXEC_NOTES'] as const;

  it.each(tables)('carries the daemon\'s %s verbatim', (name) => {
    expect(agentsExecs[name]).toEqual(coreExecs[name]);
  });

  it('routes bare specs to the same programs', () => {
    expect(agentsExecs.BARE_PLAIN_PROGRAM).toBe(coreExecs.BARE_PLAIN_PROGRAM);
    expect(agentsExecs.BARE_WITH_SLASH_PROGRAM).toBe(coreExecs.BARE_WITH_SLASH_PROGRAM);
  });

  const specs = [
    '',
    'sonnet',
    'opus',
    'codex:gpt-5.5',
    'claude:opus',
    'opencode:vendor/model',
    'kilo:k',
    'pi:p',
    'omp:o',
    'elowen:relay/ollama/kimi-k2.7-code',
    'elowen:openai/gpt-5.5',
    'elowen:',
    'elowen:/model',
    'elowen:provider/',
    'vendor/model',
    'foo',
    '--all',
  ];

  it.each(specs)('classifies %j the same way the daemon does', (spec) => {
    expect(agentsExecs.isWellFormedExec(spec)).toBe(coreExecs.isWellFormedExec(spec));
    expect(agentsExecs.parseElowenExec(spec)).toEqual(coreExecs.parseElowenExec(spec));
    expect(agentsExecs.isAllowedExec(spec, ['sonnet'])).toBe(coreExecs.isAllowedExec(spec, ['sonnet']));
    expect(agentsExecs.isAllowedExec(spec, [])).toBe(coreExecs.isAllowedExec(spec, []));
  });

  /** The permission surface: this decides which model a non-admin may spend on, so a copy that answers
   *  differently from the daemon is a privilege bug, not a cosmetic one. */
  const users = [
    ['open mode', null],
    ['an admin with no personal list', { is_admin: true, allowed_execs: [] }],
    ['an admin with a curated shortlist', { is_admin: true, allowed_execs: ['opus'] }],
    ['a plain user with no personal list', { is_admin: false, allowed_execs: [] }],
    ['a plain user narrowed to sonnet', { is_admin: false, allowed_execs: ['sonnet'] }],
  ] as const;

  it.each(users)('gates %s identically', (_label, user) => {
    const globals = ['sonnet', 'opus'];
    for (const spec of specs) {
      expect(agentsExecs.isExecAllowedForUser(user, globals, spec)).toBe(
        coreExecs.isExecAllowedForUser(user, globals, spec),
      );
      expect(agentsExecs.isModelVisibleForUser(user, globals, spec)).toBe(
        coreExecs.isModelVisibleForUser(user, globals, spec),
      );
    }
  });

  it('composes a brain exec spec the same way', () => {
    expect(agentsExecs.elowenExec('relay', 'ollama/kimi-k2.7-code')).toBe(
      coreExecs.elowenExec('relay', 'ollama/kimi-k2.7-code'),
    );
  });
});

describe('classifySession, copied into plugins/agents', () => {
  /** The daemon owns how it names tmux sessions, and this copy decodes that naming back into a role
   *  and an owner. The `userId` it returns is what the session ownership gate compares against, so a
   *  copy that reads a name differently from the daemon hands sessions to the wrong user — or, on a
   *  name it fails to parse, to everyone. */
  const names = [
    'elowen-overseer-m-1234',
    'elowen-overseer-',
    'elowen-pilot-Patricita',
    'elowen-pilot-',
    'elowen-advisor-7',
    'elowen-advisor-0',
    'elowen-advisor-abc',
    'elowen-advisor-7.5',
    'elowen-advisor-',
    'elowen-chat-7-a1b2c3',
    'elowen-chat-7',
    'elowen-chat-abc-tail',
    'elowen-chat--1-tail',
    'elowen-chat-',
    'elowen-Patricita',
    'elowen-',
    'Patricita',
    'overseer-m-1234',
    '',
  ];

  it.each(names)('reads %j exactly as the daemon does', (name) => {
    expect(agentsClassifySession(name)).toEqual(coreClassifySession(name));
  });
});

describe('KeyedMutex, copied into plugins/agents and plugins/work', () => {
  type Ctor = new () => { run<T>(key: string, fn: () => Promise<T>): Promise<T> };

  const tick = () => new Promise((resolve) => setImmediate(resolve));

  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => { resolve = res; });
    return { promise, resolve };
  }

  /** Drives one fully deterministic scenario — no timers, every step released by hand — and returns
   *  everything observable about it. Two implementations that agree on this agree on the ordering,
   *  the cross-key concurrency and the error handling that the mutex exists to provide. */
  async function observe(Ctor: Ctor) {
    const mutex = new Ctor();
    const trace: string[] = [];
    const first = deferred<string>();
    const second = deferred<string>();
    const other = deferred<string>();

    const a1 = mutex.run('a', async () => { trace.push('a1:start'); const v = await first.promise; trace.push('a1:end'); return v; });
    const a2 = mutex.run('a', async () => { trace.push('a2:start'); await second.promise; trace.push('a2:throw'); throw new Error('a2 failed'); });
    const a3 = mutex.run('a', async () => { trace.push('a3:start'); return 'a3'; });
    const b1 = mutex.run('b', async () => { trace.push('b1:start'); const v = await other.promise; trace.push('b1:end'); return v; });

    // Only the head of each key may have started: 'a' is serialized, 'b' runs alongside it.
    await tick();
    trace.push('--- both heads running ---');

    other.resolve('b1');
    await tick();
    trace.push('--- b done, a still blocked ---');

    first.resolve('a1');
    await tick();
    trace.push('--- a1 released, a2 should hold the key ---');

    second.resolve('a2');
    const settled = await Promise.allSettled([a1, a2, a3, b1]);
    trace.push('--- all settled ---');

    return {
      trace,
      settled: settled.map((r) => (r.status === 'fulfilled' ? `ok:${r.value}` : `err:${(r.reason as Error).message}`)),
      pendingKeys: pending(mutex),
    };
  }

  /** The map is dropped per key once it drains, which is what stops it growing without bound over a
   *  long-lived daemon. Reading the field directly is deliberate: there is no public view of it, and
   *  a missing field should fail loudly rather than quietly stop checking. */
  function pending(mutex: object): number {
    const tails = (mutex as { tails?: unknown }).tails;
    if (!(tails instanceof Map)) throw new Error('KeyedMutex no longer keeps its pending work in a `tails` Map');
    return tails.size;
  }

  const copiesUnderTest: [string, Ctor][] = [
    ['plugins/agents', AgentsKeyedMutex as unknown as Ctor],
    ['plugins/work', WorkKeyedMutex as unknown as Ctor],
  ];

  it.each(copiesUnderTest)('%s behaves exactly like the daemon\'s', async (_label, Copy) => {
    expect(await observe(Copy)).toEqual(await observe(CoreKeyedMutex as unknown as Ctor));
  });

  it.each([...copiesUnderTest, ['elowen (the daemon itself)', CoreKeyedMutex as unknown as Ctor]] as [string, Ctor][])(
    '%s drops a key once its work drains',
    async (_label, Ctor) => {
      // Asserted on every implementation separately: a leak that both sides shared would still pass a
      // pure equality check.
      expect((await observe(Ctor)).pendingKeys).toBe(0);
    },
  );
});

describe('callElowenApi, copied into plugins/work', () => {
  type Sent = { url: string; method?: string; headers?: unknown; body?: unknown };

  /** Runs one call against a fake fetch and reports BOTH what went out on the wire and what came back
   *  — the request shape is the half a caller never sees but the daemon does. */
  async function exchange(
    call: typeof coreCallElowenApi,
    method: string,
    path: string,
    body: unknown,
    responseBody: string | null,
    status: number,
  ) {
    const sent: Sent[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      sent.push({ url: String(url), method: init.method, headers: init.headers, body: init.body });
      return new Response(responseBody, { status });
    }) as unknown as typeof fetch;
    const result = await call(method, path, body, { url: 'https://host.example', token: 'TOKEN', fetchImpl });
    return { sent, result };
  }

  const calls: [string, string, unknown][] = [
    ['GET', '/tasks', undefined],
    ['get', '/tasks', undefined],
    ['GET', 'tasks', undefined],
    ['GET', '/tasks', { ignored: true }],
    ['HEAD', '/tasks', { ignored: true }],
    ['head', 'tasks', undefined],
    ['POST', '/tasks', { title: 'x' }],
    ['POST', '/tasks', undefined],
    ['post', 'tasks', { nested: { a: [1, 2] } }],
    ['PATCH', '/tasks/1', {}],
    ['DELETE', '/tasks/1', undefined],
    ['DELETE', '/tasks/1', { force: true }],
  ];

  const responses: [string | null, number][] = [
    ['{"ok":true}', 200],
    ['[1,2,3]', 200],
    ['not json at all', 200],
    ['', 200],
    [null, 204],
    ['{"error":"nope"}', 404],
    ['<html>502</html>', 502],
  ];

  it.each(calls)('sends %s %s the same way the daemon does', async (method, path, body) => {
    for (const [responseBody, status] of responses) {
      expect(await exchange(workCallElowenApi, method, path, body, responseBody, status)).toEqual(
        await exchange(coreCallElowenApi, method, path, body, responseBody, status),
      );
    }
  });
});
