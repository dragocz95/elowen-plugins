// @vitest-environment node
/** Adopted from the Elowen package: tests/plugins/work/planner.test.ts, tests/plugins/work/planService.test.ts,
 *  tests/plugins/work/jsonRepair.test.ts. */
import { describe, it, expect } from 'vitest';
import { defaultPromptTemplate, _resetDefaultCache } from 'elowen/dist/prompts/plannerDefault.js';
import { FakeInference } from 'elowen/dist/inference/client.js';
import { ConfigStore } from 'elowen/dist/store/configStore.js';
import type { ElowenEvent } from 'elowen/dist/api/sse.js';
import type { CreateTaskInput } from 'elowen/dist/store/types.js';
import { parsePhases, decompose, planPrompt, modelsBlock, parallelismBlock } from '../plugins/work/dist/api/planner.js';
import { TaskStore } from '../plugins/work/dist/store/taskStore.js';
import { PlanJobStore } from '../plugins/work/dist/api/planJobStore.js';
import { createPlanService } from '../plugins/work/dist/api/planService.js';
import { repairJson, parseLenient } from '../plugins/work/dist/lib/jsonRepair.js';
import { extractJson } from '../plugins/work/dist/lib/llmParse.js';
import { parseDecision } from '../plugins/agents/dist/overseer/decision.js';
import { openWorkDb } from './helpers/pluginTablesDb.js';

// ---- from tests/plugins/work/planner.test.ts ----

describe('planner.parsePhases', () => {
  it('parses a clean JSON array', () => {
    const phases = parsePhases('[{"title":"Set up schema","type":"task"},{"title":"Add API","type":"feature"}]');
    expect(phases).toEqual([
      { title: 'Set up schema', type: 'task' },
      { title: 'Add API', type: 'feature' },
    ]);
  });

  it('extracts the array from surrounding prose / fences', () => {
    const phases = parsePhases('Sure! Here is the plan:\n```json\n[{"title":"Phase one"}]\n```\nDone.');
    expect(phases).toEqual([{ title: 'Phase one', type: 'task' }]); // missing type defaults to task
  });

  it('coerces unknown types to task and drops titleless entries', () => {
    const phases = parsePhases('[{"title":"Keep","type":"wat"},{"type":"bug"},{"title":"  "}]');
    expect(phases).toEqual([{ title: 'Keep', type: 'task' }]);
  });

  it('captures and sanitizes the model-assigned agent name', () => {
    const phases = parsePhases('[{"title":"A","type":"task","agent":"Nova"},{"title":"B","agent":"At las!"},{"title":"C"}]');
    expect(phases[0].agent).toBe('Nova');
    expect(phases[1].agent).toBe('Atlas'); // stripped to a tmux-safe token
    expect(phases[2].agent).toBeUndefined();
  });

  it('keeps tmux-legal dashes and underscores in agent names (no collapse to one word)', () => {
    const phases = parsePhases('[{"title":"A","agent":"code-reviewer"},{"title":"B","agent":"bug_finder"},{"title":"C","agent":"db:writer"}]');
    expect(phases[0].agent).toBe('code-reviewer'); // dash survives (#33)
    expect(phases[1].agent).toBe('bug_finder');    // underscore survives
    expect(phases[2].agent).toBe('dbwriter');      // ':' (session separator) still stripped
  });

  it('extracts the first balanced array and ignores a trailing bracketed note (#30)', () => {
    const phases = parsePhases('Here is the plan: [{"title":"Only"}]. Notes: [misc, do not parse this]');
    expect(phases).toEqual([{ title: 'Only', type: 'task' }]);
  });

  it('does not choke on brackets inside string values', () => {
    const phases = parsePhases('[{"title":"Fix [BUG-12] in parser","details":"handle ] and ["}]');
    expect(phases[0].title).toBe('Fix [BUG-12] in parser');
    expect(phases[0].details).toBe('handle ] and [');
  });

  it('captures per-phase details when present', () => {
    const phases = parsePhases('[{"title":"A","details":"Build X with acceptance Y"},{"title":"B","details":"  "}]');
    expect(phases[0].details).toBe('Build X with acceptance Y');
    expect(phases[1].details).toBeUndefined(); // blank → omitted
  });

  it('captures a per-phase exec when present', () => {
    const phases = parsePhases('[{"title":"A","type":"task","exec":"sonnet"},{"title":"B","type":"task"},{"title":"C","exec":"  "}]');
    expect(phases[0].exec).toBe('sonnet');
    expect(phases[1].exec).toBeUndefined();
    expect(phases[2].exec).toBeUndefined(); // blank → omitted
  });

  it('throws when there is no array', () => {
    expect(() => parsePhases('no json here')).toThrow();
  });

  it('throws when the array has no valid phases', () => {
    expect(() => parsePhases('[]')).toThrow();
  });

  it('captures id and dependsOn (including an explicit empty array)', () => {
    const phases = parsePhases('[{"title":"API","id":"api","dependsOn":[]},{"title":"UI","id":"ui","dependsOn":["api"]}]');
    expect(phases[0].id).toBe('api');
    expect(phases[0].dependsOn).toEqual([]); // [] = no deps, distinct from absent
    expect(phases[1].id).toBe('ui');
    expect(phases[1].dependsOn).toEqual(['api']);
  });

  it('sanitizes id and dependsOn to slug chars and drops empty entries', () => {
    const phases = parsePhases('[{"title":"A","id":"my id!","dependsOn":["a b","ok-1",":x","   "]}]');
    expect(phases[0].id).toBe('myid');
    expect(phases[0].dependsOn).toEqual(['ab', 'ok-1', 'x']); // blank entry dropped
  });

  it('omits id/dependsOn for a legacy plan without them', () => {
    const phases = parsePhases('[{"title":"A","type":"task"}]');
    expect(phases[0].id).toBeUndefined();
    expect(phases[0].dependsOn).toBeUndefined();
  });

  it('treats a non-array dependsOn as absent', () => {
    const phases = parsePhases('[{"title":"A","id":"a","dependsOn":"api"}]');
    expect(phases[0].dependsOn).toBeUndefined();
  });
});

describe('planner.planPrompt', () => {
  it('substitutes the goal into a {{goal}} placeholder', () => {
    expect(planPrompt('ship it', 'Plan this: {{goal}} now')).toBe('Plan this: ship it now');
  });
  it('appends the goal when the template lacks a placeholder', () => {
    expect(planPrompt('ship it', 'No placeholder here')).toContain('Goal: ship it');
  });
  it('default template contains the {{goal}} placeholder', () => {
    expect(defaultPromptTemplate()).toContain('{{goal}}');
  });
  it('default template carries a {{models}} placeholder', () => {
    expect(defaultPromptTemplate()).toContain('{{models}}');
  });
  it('_resetDefaultCache forces a re-read (cache is not permanent) (#31)', () => {
    const first = defaultPromptTemplate();
    _resetDefaultCache();
    const second = defaultPromptTemplate(); // re-read from disk, not the stale module-level cache
    expect(second).toBe(first);
  });
  it('substitutes the project notes into a {{project}} placeholder', () => {
    const out = planPrompt('ship it', 'Ctx: {{project}}\nGoal: {{goal}}', { notes: 'monorepo; run pnpm' });
    expect(out).toContain('monorepo; run pnpm');
    expect(out).toContain('Goal: ship it');
    expect(out).not.toContain('{{project}}');
  });
  it('prepends the project context when the template has no {{project}} placeholder', () => {
    const out = planPrompt('ship it', 'Plan: {{goal}}', { notes: 'always use TDD' });
    expect(out.startsWith('Project context')).toBe(true);
    expect(out).toContain('always use TDD');
    expect(out).toContain('Plan: ship it');
  });
  it('injects nothing when the project has no notes', () => {
    expect(planPrompt('ship it', 'Plan: {{goal}}', { notes: '   ' })).toBe('Plan: ship it');
    expect(planPrompt('ship it', 'Plan: {{goal}}')).toBe('Plan: ship it');
  });
  it('substitutes a models block into a {{models}} placeholder', () => {
    const out = planPrompt('ship it', 'Models:\n{{models}}\nGoal: {{goal}}', undefined, '- sonnet: coder');
    expect(out).toContain('- sonnet: coder');
    expect(out).not.toContain('{{models}}');
    expect(out).toContain('Goal: ship it');
  });
  it('collapses {{models}} to empty when no block is given', () => {
    expect(planPrompt('ship it', 'Models:\n{{models}}\nGoal: {{goal}}', undefined, '')).toBe('Models:\n\nGoal: ship it');
  });
  it('prepends the models block when the template has no {{models}} placeholder', () => {
    const out = planPrompt('ship it', 'Plan: {{goal}}', undefined, '- sonnet: coder');
    expect(out.startsWith('- sonnet: coder')).toBe(true);
    expect(out).toContain('Plan: ship it');
  });
  it('substitutes a parallelism block into a {{parallelism}} placeholder', () => {
    const out = planPrompt('ship it', 'P:\n{{parallelism}}\nGoal: {{goal}}', undefined, undefined, 'RUN WIDE');
    expect(out).toContain('RUN WIDE');
    expect(out).not.toContain('{{parallelism}}');
  });
  it('prepends the parallelism block when the template has no {{parallelism}} placeholder', () => {
    const out = planPrompt('ship it', 'Plan: {{goal}}', undefined, undefined, 'RUN WIDE');
    expect(out.startsWith('RUN WIDE')).toBe(true);
    expect(out).toContain('Plan: ship it');
  });
  it('default template carries a {{parallelism}} placeholder', () => {
    expect(defaultPromptTemplate()).toContain('{{parallelism}}');
  });
});

describe('planner.modelsBlock', () => {
  it('lists only enabled models that have a non-empty note + carries the exec instruction', () => {
    const block = modelsBlock(['sonnet', 'codex:gpt-5.4', 'deepseek/x'], { sonnet: 'Strong coder', 'codex:gpt-5.4': '  ', 'ollama/y': 'not enabled' });
    expect(block).toContain('- sonnet: Strong coder');
    expect(block).not.toContain('codex:gpt-5.4'); // empty note → omitted
    expect(block).not.toContain('ollama/y');       // not in allowedExecs → omitted
    expect(block).toMatch(/exec/i);
  });
  it('returns empty string when nothing qualifies', () => {
    expect(modelsBlock(['sonnet'], {})).toBe('');
    expect(modelsBlock([], { sonnet: 'x' })).toBe('');
  });
});

describe('planner.parallelismBlock', () => {
  it('invites parallel branches only when >1 session AND isolated worktrees', () => {
    const block = parallelismBlock(3, true);
    expect(block).toMatch(/AT THE SAME TIME/);
    expect(block).toMatch(/3 phases/);
    expect(block).toMatch(/dependsOn: \[\]/);
  });
  it('asks for a sequential chain with a single session', () => {
    expect(parallelismBlock(1, true)).toMatch(/ONE AT A TIME/);
  });
  it('asks for a sequential chain in a shared (non-isolated) checkout even with >1 session', () => {
    // The single-writer gate would serialize anyway — emitting parallel phases there is false parallelism.
    expect(parallelismBlock(2, false)).toMatch(/ONE AT A TIME/);
  });
});

describe('planner.decompose', () => {
  it('runs the inference client and returns validated phases', async () => {
    const inf = new FakeInference('[{"title":"A","type":"feature"},{"title":"B"}]');
    // The template is a REQUIRED argument in the plugin copy (every caller resolves the prompt body
    // itself: request override → the user's own planner prompt → the workspace autopilot template).
    const phases = await decompose(inf, 'build a thing', defaultPromptTemplate());
    expect(phases).toEqual([
      { title: 'A', type: 'feature' },
      { title: 'B', type: 'task' },
    ]);
  });
});

// ---- from tests/plugins/work/planService.test.ts ----

function makeService() {
  const db = openWorkDb(':memory:');
  db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'elowen','/proj')").run();
  const tasks = new TaskStore(db);
  const events: ElowenEvent[] = [];
  const config = new ConfigStore(db);
  const planJobs = new PlanJobStore();
  const svc = createPlanService({
    tasks: () => tasks,
    planJobs: () => planJobs,
    planFlow: () => undefined, // agents plugin disabled — a plan is still an epic + its phases
    allowedExecs: () => config.get().allowedExecs,
    publishEvent: (e) => events.push(e),
    killSession: async () => {},
    pathFor: () => '/proj',
  });
  return { tasks, events, planJobs, svc };
}

describe('planService.persistPlan — atomicity (Tier 2 #15)', () => {
  it('rolls back the whole plan and publishes no events when a later phase fails to create', () => {
    const { tasks, events, planJobs, svc } = makeService();
    const job = planJobs.create({ goal: 'g', projectId: 1, epicId: null, dryRun: false, createdBy: null });
    job.phases = [
      { title: 'One', type: 'task' },
      { title: 'Two', type: 'task' },
      { title: 'Three', type: 'task' },
    ];

    // Force a failure creating the THIRD row written (epic = 1st, phase "One" = 2nd, phase "Two" = 3rd)
    // — a mid-plan disk error / id collision, exactly the scenario the review calls out.
    const originalCreate = tasks.create.bind(tasks);
    let calls = 0;
    tasks.create = ((input: CreateTaskInput) => {
      calls++;
      if (calls === 3) throw new Error('disk error');
      return originalCreate(input);
    }) as typeof tasks.create;

    expect(() => svc.persistPlan(job)).toThrow('disk error');
    // Nothing committed — not even the epic or phase "One", which were written before the failure.
    expect(tasks.list()).toEqual([]);
    // No event for a task the transaction rolled back — before the fix these fired inline, ahead of
    // the (later-failed) rest of the plan.
    expect(events).toEqual([]);
  });

  it('publishes one task event per created row only after the transaction commits', () => {
    const { tasks, events, planJobs, svc } = makeService();
    const job = planJobs.create({ goal: 'g', projectId: 1, epicId: null, dryRun: false, createdBy: null });
    job.phases = [{ title: 'One', type: 'task' }, { title: 'Two', type: 'task' }];

    const { epic, phases } = svc.persistPlan(job);
    expect(phases).toHaveLength(2);
    expect(tasks.get(epic.id)).not.toBeNull();
    const publishedIds = events.filter((e) => e.type === 'task').map((e) => (e as { taskId: string }).taskId);
    expect(publishedIds.sort()).toEqual([epic.id, ...phases.map((p) => p.id)].sort());
  });
});

// ---- from tests/plugins/work/jsonRepair.test.ts ----

describe('repairJson + parseLenient', () => {
  it('removes trailing commas before } and ]', () => {
    expect(parseLenient('{"a":1,}')).toEqual({ a: 1 });
    expect(parseLenient('[1,2,3,]')).toEqual([1, 2, 3]);
    expect(parseLenient('{"a":[1,2,],}')).toEqual({ a: [1, 2] });
  });

  it('converts single-quoted strings to double-quoted', () => {
    expect(parseLenient("{'a':'b'}")).toEqual({ a: 'b' });
  });

  it('quotes bare identifier keys', () => {
    expect(parseLenient('{approve:true, confidence:0.9}')).toEqual({ approve: true, confidence: 0.9 });
  });

  it('strips // and /* */ comments outside strings', () => {
    expect(parseLenient('{\n  "a": 1, // note\n  "b": 2\n}')).toEqual({ a: 1, b: 2 });
    expect(parseLenient('{ "a": 1 /* inline */ }')).toEqual({ a: 1 });
  });

  it('normalizes smart/curly quotes', () => {
    expect(parseLenient('{“a”:“b”}')).toEqual({ a: 'b' });
  });

  it('preserves apostrophes and // inside double-quoted strings', () => {
    expect(parseLenient('{"msg":"don\'t go to http://x"}')).toEqual({ msg: "don't go to http://x" });
  });

  it('is idempotent on already-valid JSON', () => {
    const valid = '{"a":1,"b":["x","y"],"c":{"d":true}}';
    expect(repairJson(valid)).toBe(valid);
    expect(parseLenient(valid)).toEqual({ a: 1, b: ['x', 'y'], c: { d: true } });
  });

  it('throws the original error when the snippet is not JSON even after repair', () => {
    expect(() => parseLenient('not json at all')).toThrow();
  });

  // Review regressions: structural fixes must NEVER touch content inside (originally single-quoted)
  // strings — quotes are normalized to double FIRST so every later pass sees correct string boundaries.
  it('preserves // and block-comment-like text inside single-quoted values', () => {
    expect(parseLenient("{'choice':'a','rationale':'see src // note'}")).toEqual({ choice: 'a', rationale: 'see src // note' });
    expect(parseLenient("{a: 'a /* b */ c'}")).toEqual({ a: 'a /* b */ c' });
  });

  it('does not quote bare-key-like patterns that live inside a string value', () => {
    expect(parseLenient('{"a": "see {x: 1}", "b": 2,}')).toEqual({ a: 'see {x: 1}', b: 2 });
  });

  // A single-quoted string carries its own escapes, and re-quoting has to translate them rather than
  // layer another round on top. Both of these are ordinary model output — an apostrophe is about the
  // most common character a written sentence has — and both used to come back out unparseable.
  it('unwraps an escaped apostrophe, which JSON has no escape for', () => {
    expect(parseLenient(String.raw`{'msg': 'don\'t'}`)).toEqual({ msg: "don't" });
  });

  it('does not escape a quote that the single-quoted body had already escaped', () => {
    // `\"` escaped a second time becomes `\\"` — an escaped backslash and then a LIVE quote, which ends
    // the string early and turns a repairable snippet into a parse error.
    expect(parseLenient(String.raw`{'msg': 'say \" hi'}`)).toEqual({ msg: 'say " hi' });
  });

  it('escapes a raw quote inside a single-quoted value and leaves other escapes alone', () => {
    expect(parseLenient(`{'a': 'he said "hi"'}`)).toEqual({ a: 'he said "hi"' });
    expect(parseLenient(String.raw`{'a': 'line\nbreak'}`)).toEqual({ a: 'line\nbreak' });
    expect(parseLenient(String.raw`{'a': 'x\\'}`)).toEqual({ a: 'x\\' });
  });

  it('handles single-quoted values containing braces', () => {
    expect(parseLenient("{'a': 'x } y', 'b': 1}")).toEqual({ a: 'x } y', b: 1 });
  });
});

describe('extractJson uses lenient parsing', () => {
  it('parses a fenced object with a trailing comma and bare keys', () => {
    const out = 'Here is the verdict:\n```json\n{approve: true, confidence: 0.9, rationale: \'looks safe\',}\n```';
    expect(extractJson(out, '{')).toEqual({ approve: true, confidence: 0.9, rationale: 'looks safe' });
  });
});

describe('downstream parsers survive off-contract JSON', () => {
  it('parseDecision handles trailing comma + single quotes', () => {
    const d = parseDecision("{approve:true, confidence:0.9, rationale:'ok',}");
    expect(d).toEqual({ approve: true, confidence: 0.9, rationale: 'ok' });
  });

  it('parsePhases handles a trailing comma in the array', () => {
    const phases = parsePhases('[{"title":"A","type":"task","details":"do a"},]');
    expect(phases).toHaveLength(1);
    expect(phases[0].title).toBe('A');
  });
});
