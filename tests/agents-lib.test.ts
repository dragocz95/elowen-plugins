// @vitest-environment node
// Adopted from the Elowen package when the agents plugin moved into this registry. Carries, verbatim:
//   tests/plugins/agents/owner.test.ts
//   tests/plugins/agents/lib/uniqueName.test.ts
//   tests/plugins/agents/cliDetection.test.ts
//   tests/plugins/agents/libParity.test.ts — the two PLUGIN↔PLUGIN describe blocks only. Its third
//     block pinned plugins/agents/src/lib/{execs,keyedMutex}.ts against the daemon's own
//     src/shared/*.ts; the published `elowen` package ships dist/ only, so that core source is not
//     present here and the block stayed behind in the daemon repo.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveOwnerId, type OwnerDeps } from '../plugins/agents/dist/lib/owner.js';
import { uniqueName, freeAgentName } from '../plugins/agents/dist/lib/uniqueName.js';
import { detectClis } from '../plugins/agents/dist/lib/cliDetection.js';

// ---- from tests/plugins/agents/owner.test.ts ----

function deps(over: Partial<{ tasks: Record<string, { created_by: number | null; parent_id: string | null }>; missions: Record<string, { created_by: number | null }>; users: number[] }> = {}): OwnerDeps {
  const tasks = over.tasks ?? {};
  const missions = over.missions ?? {};
  const users = over.users ?? [1];
  return {
    tasks: { get: (id) => tasks[id] ?? null },
    missions: { get: (id) => missions[id] ?? null },
    users: { list: () => users.map((id) => ({ id })) },
  };
}

describe('resolveOwnerId', () => {
  it('prefers the advisor user above everything', () => {
    expect(resolveOwnerId(deps({ users: [9] }), { advisorUserId: 5, taskId: 't1' })).toBe(5);
  });

  it('uses a standalone task owner', () => {
    const d = deps({ tasks: { t1: { created_by: 7, parent_id: null } }, users: [1] });
    expect(resolveOwnerId(d, { taskId: 't1' })).toBe(7);
  });

  it('inherits a phase task owner from its mission', () => {
    const d = deps({
      tasks: { ph: { created_by: null, parent_id: 'epic1' } },
      missions: { 'm-epic1': { created_by: 4 } },
      users: [1],
    });
    expect(resolveOwnerId(d, { taskId: 'ph' })).toBe(4);
  });

  it('falls through to the plan job owner', () => {
    expect(resolveOwnerId(deps({ users: [1] }), { planJob: { createdBy: 3 } })).toBe(3);
  });

  it('falls back to the first (admin) user when nothing is attributed', () => {
    expect(resolveOwnerId(deps({ users: [2, 3] }), { taskId: 'missing' })).toBe(2);
  });

  it('returns null only when there are no users at all', () => {
    expect(resolveOwnerId(deps({ users: [] }), {})).toBeNull();
  });

  it('phase with no mission owner falls back to admin', () => {
    const d = deps({ tasks: { ph: { created_by: null, parent_id: 'epicX' } }, users: [1] });
    expect(resolveOwnerId(d, { taskId: 'ph' })).toBe(1);
  });
});

// ---- from tests/plugins/agents/lib/uniqueName.test.ts ----

describe('uniqueName', () => {
  it('never returns the same name twice in a run', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(uniqueName());
    expect(seen.size).toBe(1000);
  });
});

describe('freeAgentName', () => {
  it('returns the first generated name when nothing collides', async () => {
    const name = await freeAgentName(() => 'Nova', async () => []);
    expect(name).toBe('Nova');
  });

  it('skips a name whose live tmux session already exists (worker prefix)', async () => {
    const queue = ['Nova', 'Atlas'];
    const name = await freeAgentName(() => queue.shift()!, async () => ['elowen-Nova']);
    expect(name).toBe('Atlas'); // elowen-Nova is live → rolled to the next free name
  });

  it('honours the session prefix when checking liveness (pilot)', async () => {
    const queue = ['Nova', 'Atlas'];
    const name = await freeAgentName(() => queue.shift()!, async () => ['elowen-pilot-Nova'], 'pilot-');
    expect(name).toBe('Atlas'); // elowen-pilot-Nova is live → skip Nova
  });

  it('falls back to a unique suffix when every candidate name is taken', async () => {
    // make always yields the same taken name → liveness can never be satisfied by re-rolling.
    const name = await freeAgentName(() => 'Nova', async () => ['elowen-Nova']);
    expect(name).not.toBe('Nova');
    expect(name.startsWith('Nova-')).toBe(true); // friendly base kept, uniqueness appended
  });
});

// ---- from tests/plugins/agents/cliDetection.test.ts ----

// Every detectClis() call spawns 9 real binaries with --version, and one of them (kilo) boots a
// daemon to answer, so a single case costs ~2.5s idle. Vitest's 5s default left only 2x headroom,
// which the full 400-file suite eats: these cases timed out on a loaded machine and passed on re-run.
// The work is genuinely slow, not stuck — the limit was wrong, so give it a real one.
vi.setConfig({ testTimeout: 30_000 });

describe('cli detection unit', () => {
  it('returns correct shape with tools array and summary', async () => {
    const result = await detectClis();
    expect(result).toHaveProperty('tools');
    expect(result).toHaveProperty('summary');
    expect(Array.isArray(result.tools)).toBe(true);
    expect(result.tools.length).toBe(9);
    result.tools.forEach((t) => {
      expect(t).toHaveProperty('name');
      expect(t).toHaveProperty('installed');
      expect(t).toHaveProperty('functional');
      expect(t).toHaveProperty('version');
      expect(t).toHaveProperty('error');
    });
    expect(typeof result.summary.allInstalled).toBe('boolean');
    expect(typeof result.summary.allFunctional).toBe('boolean');
  });

  it('lists all expected CLI tools', async () => {
    const result = await detectClis();
    const names = result.tools.map((t) => t.name).sort();
    expect(names).toEqual(['claude', 'codex', 'git', 'kilo', 'node', 'omp', 'opencode', 'pi', 'tmux']);
  });

  it('excludes optional agent CLIs from the install/functional summary', async () => {
    // kilo/pi/omp are detected and displayed, but a box without them must not read as "missing tools".
    // The required set is the 6 non-optional tools; the summary is computed only over those.
    const result = await detectClis();
    expect(result.tools.map((t) => t.name)).toEqual(expect.arrayContaining(['kilo', 'pi', 'omp']));
  });

  it('detects fresh install when context indicates no config, no api key, no custom setup', async () => {
    const result = await detectClis({
      configPersisted: false, hasApiKey: false, hasCustomSetup: false,
    });
    expect(result.freshInstall.noConfigPersisted).toBe(true);
    expect(result.freshInstall.noApiKey).toBe(true);
    expect(result.freshInstall.noCustomSetup).toBe(true);
  });

  it('detects non-fresh install when config has been persisted', async () => {
    const result = await detectClis({
      configPersisted: true, hasApiKey: false, hasCustomSetup: false,
    });
    expect(result.freshInstall.noConfigPersisted).toBe(false);
  });

  it('detects non-fresh install when api key is set', async () => {
    const result = await detectClis({
      configPersisted: true, hasApiKey: true, hasCustomSetup: false,
    });
    expect(result.freshInstall.noApiKey).toBe(false);
  });
});

// ---- from tests/plugins/agents/libParity.test.ts ----

// Both pairs below are plugin↔plugin, so both sides live in THIS repo and are read from source.
const root = fileURLToPath(new URL('..', import.meta.url));

// PlanJobStore exists TWICE by design: the agents plugin's overseer runtime owns the live instance,
// while the WORK plugin keeps its own for plugin-less wiring (the /tasks/plan surface still plans an
// epic + phases with agents disabled). The two copies legitimately differ in their import specifiers
// (different compile units) but must not drift in LOGIC — a one-sided change to job settling would
// make the fallback behave differently from the real thing. Compared after normalizing module
// specifiers, which are all the two compile units may legitimately differ in. (The DecisionQueue pair
// is gone: the review gate moved into the plugin and the core fallback queue was deleted with it.)
const NORMALIZED: [core: string, copy: string][] = [
  ['plugins/work/src/api/planJobStore.ts', 'plugins/agents/src/overseer/planJob.ts'],
];

const normalize = (src: string): string => src.replace(/from '[^']+'/g, "from 'X'");

describe('the work plugin fallback stores stay in logical lockstep with the agents originals', () => {
  for (const [core, copy] of NORMALIZED) {
    it(`${core} matches ${copy} modulo import paths`, () => {
      expect(normalize(readFileSync(resolve(root, core), 'utf8'))).toBe(normalize(readFileSync(resolve(root, copy), 'utf8')));
    });
  }
});

// The lenient-JSON pair. BOTH plugins parse a model's near-JSON — the work plugin for plan/replan
// submissions, the agents plugin for overseer decisions — and each carries its own copy because they
// are separate compile units. This pair is plugin↔plugin, so no core-facing parity net sees it: the
// daemon repo's own nets (tests/contract/pluginCoreCopyParity.test.ts and the core↔plugin lists it
// keeps by hand) only compare a plugin copy against a core original. A one-sided fix here (a quoting
// rule, a trailing-comma case) would make the same malformed model output parse in one subsystem and
// fail in the other.
// `export` is normalized away with the import specifiers: work's copy exports repairJson for its unit
// test, which is a visibility difference, not a behavioural one.
const LIB_TWINS: [work: string, agents: string][] = [
  ['plugins/work/src/lib/jsonRepair.ts', 'plugins/agents/src/overseer/jsonRepair.ts'],
  ['plugins/work/src/lib/llmParse.ts', 'plugins/agents/src/overseer/llmParse.ts'],
];

const normalizeLib = (src: string): string => normalize(src).replace(/^export /gm, '');

describe('the lenient-JSON copies stay in lockstep across the two plugins', () => {
  for (const [work, agents] of LIB_TWINS) {
    it(`${work} matches ${agents} modulo import paths and visibility`, () => {
      expect(normalizeLib(readFileSync(resolve(root, work), 'utf8')))
        .toBe(normalizeLib(readFileSync(resolve(root, agents), 'utf8')));
    });
  }
});
