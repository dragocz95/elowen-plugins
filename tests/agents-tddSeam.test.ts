// @vitest-environment node
/** Adopted from the Elowen package: the plugin-owned half of tests/prompts/tdd.test.ts.
 *
 *  `tddDirective` itself is daemon code and its unit tests stayed there, as did the `worker-brain`
 *  template and the embedded-worker seam that appends to it. What moved here is everything whose
 *  SUBJECT this plugin owns: the worker* templates, the plugin's editable-prompt catalog, and
 *  `buildAgentCommand` — the CLI-agent spawn seam the directive rides on. */
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { tddDirective } from 'elowen/dist/prompts/tdd.js';
import { render, rawTemplate, setPluginPromptSources } from 'elowen/dist/prompts/index.js';
import { setPluginPromptCatalog, isEditablePrompt } from 'elowen/dist/prompts/catalog.js';
import { PromptService } from 'elowen/dist/prompts/promptService.js';
import { UserPromptStore } from 'elowen/dist/store/userPromptStore.js';
import { openDb } from 'elowen/dist/store/db.js';
import { AGENTS_PROMPTS, AGENTS_PROMPTS_DIR } from '../plugins/agents/dist/promptCatalog.js';
import { buildAgentCommand } from '../plugins/agents/dist/spawn/commandBuilder.js';

// The daemon's renderer resolves a plugin-owned template name only once the plugin overlay is
// installed — which the daemon does at boot, and a bare test process never does.
setPluginPromptSources(new Map(AGENTS_PROMPTS.map((p: { name: string }) => [p.name, join(AGENTS_PROMPTS_DIR, `${p.name}.md`)])));
setPluginPromptCatalog(AGENTS_PROMPTS.map((e: object) => ({ ...e })) as never);

describe('TDD directive is injected at the spawn seam, not through a template placeholder', () => {
  // The directive rides on a code-side append (commandBuilder), NOT a {{tddDirective}} placeholder.
  // That is the whole point: a user's saved wholesale override omits the placeholder, so riding on it
  // would silently drop the directive when TDD mode is on.
  const WORKER_TEMPLATES = ['worker', 'worker-resume', 'worker-phase'];

  for (const name of WORKER_TEMPLATES) {
    it(`${name}: the shipped template carries no {{tddDirective}} placeholder`, () => {
      expect(rawTemplate(name)).not.toContain('{{tddDirective}}');
    });
  }

  it('no template this plugin ships bakes the directive text in', () => {
    // The directive lives ONLY in the code-side append; no .md ships it. This guards against anyone
    // re-inlining it into a template (which an override would then be able to break again).
    for (const p of AGENTS_PROMPTS as { name: string }[]) {
      expect(rawTemplate(p.name)).not.toContain('Test-Driven Development');
    }
  });

  it('a wholesale worker override WITHOUT the placeholder still receives the directive when TDD is on', () => {
    // Reproduces the reported bug: an operator customized the worker prompt before TDD mode existed,
    // so their saved override has no {{tddDirective}}. PromptService substitutes it wholesale.
    const db = openDb(':memory:');
    const userPrompts = new UserPromptStore(db);
    const staleOverride = 'You are the Elowen agent "{{agentName}}" on {{taskId}}. Just do the task.';
    userPrompts.set(7, 'worker', staleOverride);
    const prompts = new PromptService(userPrompts);
    const renderPrompt = (name: string, vars?: Record<string, string>) => prompts.render(name, vars ?? {}, 7);

    // Sanity: the override really lacks the directive (a dead placeholder path would leave it here).
    expect(renderPrompt('worker', { agentName: 'A', taskId: 'T-1' })).not.toContain('Test-Driven Development');

    const on = buildAgentCommand(
      { program: 'claude-code', model: 'sonnet' },
      { projectPath: '/o', taskId: 'T-1', agentName: 'A', tddMode: true },
      renderPrompt,
    );
    const off = buildAgentCommand(
      { program: 'claude-code', model: 'sonnet' },
      { projectPath: '/o', taskId: 'T-1', agentName: 'A', tddMode: false },
      renderPrompt,
    );
    expect(on).toContain('Test-Driven Development'); // appended at the seam despite the stale override
    expect(on).toContain('confirm it FAILS');
    expect(off).not.toContain('Test-Driven Development'); // off-state appends nothing
  });

  it('off-state render is byte-identical to the shipped template body (append is a no-op)', () => {
    const vars = { agentName: 'A', taskId: 'T-1', titlePart: '', detailsPart: '', resumePart: '', closeCommand: 'elowen close T-1', cli: 'elowen' };
    const rendered = render('worker', vars);
    expect(rendered + tddDirective(false)).toBe(rendered);
    expect(rendered).not.toContain('Test-Driven Development');
  });
});

/** Adopted from the Elowen package (tests/prompts/pluginPrompts.test.ts): every template this plugin
 *  REGISTERS must resolve to the file it actually ships. The daemon keeps the mechanism — that a
 *  registered plugin template resolves to that plugin's file and a user override still wins — over a
 *  fixture template it owns. What only this repository can say is which templates are in the catalog
 *  and that each one has a file behind it: a catalog entry with no .md renders empty at runtime, and a
 *  .md that drifts from the registered name is simply never reached. */
describe('the plugin prompt catalog matches what ships on disk', () => {
  it('every registered template resolves byte-identically to its file, and is editable', () => {
    expect((AGENTS_PROMPTS as { name: string }[]).length).toBeGreaterThan(0);
    for (const e of AGENTS_PROMPTS as { name: string }[]) {
      const onDisk = readFileSync(join(AGENTS_PROMPTS_DIR, `${e.name}.md`), 'utf-8').trim();
      expect(rawTemplate(e.name), e.name).toBe(onDisk);
      expect(isEditablePrompt(e.name), e.name).toBe(true);
    }
  });
});
