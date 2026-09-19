// @vitest-environment node
/** The skills plugin against the REAL core loader, rather than against the stub host.
 *
 *  `tests/skills.test.mjs` drives every surface of this plugin through a hand-written stub of the plugin
 *  context — deliberately, because that is what makes its assertions precise. It also makes that suite
 *  blind to the host contract itself: the stub answers whatever the plugin asks for, and the node lane
 *  additionally substitutes its own `@earendil-works/pi-coding-agent`. So a seam the core renames, a
 *  manifest field the core starts requiring, and a control the core stops granting all stay green there
 *  while the installed plugin quietly loses the feature.
 *
 *  Neither failure is loud. A `register()` that throws is reported only as "plugin skipped"; a control the
 *  registry refuses is a WARN and an `undefined`, which this plugin correctly degrades into "the live skill
 *  catalog is unavailable; upgrade Elowen core" — a working instance that has silently stopped listing
 *  skills. This file is the check that the manifest's `apiVersion`, `capabilities.reads`,
 *  `consumesControls`, `provides.tools` and `provides.apiRoutes` still describe a plugin this core admits,
 *  and that both declared controls actually reach the code that uses them. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlugins } from 'elowen/dist/plugins/loader.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pluginsDir = join(repoRoot, 'plugins');
const manifest = JSON.parse(readFileSync(join(pluginsDir, 'skills', 'elowen-plugin.json'), 'utf-8')) as {
  provides: { tools: string[]; apiRoutes: string[] };
  consumesControls: string[];
};

/** One host-contributed skill, shaped like pi's file-backed `Skill`. Its file never has to exist: both
 *  surfaces below render the catalog's own name and description, and neither opens the body. */
const hostSkill = (name: string, description: string, baseDir: string) =>
  ({ name, description, filePath: join(baseDir, `${name}.md`), baseDir });

type Registry = Awaited<ReturnType<typeof loadPlugins>>;

let dataRoot: string;
let registry: Registry;
/** Everything the loader logged. A refusal never throws, so the log is where the evidence is. */
const messages: string[] = [];

beforeAll(async () => {
  dataRoot = mkdtempSync(join(tmpdir(), 'elowen-skills-contract-'));
  registry = await loadPlugins({
    dirs: [pluginsDir],
    enabled: ['skills'],
    dataRoot,
    logger: { info() {}, warn: (m: string) => messages.push(m), error: (m: string) => messages.push(m) },
  });
  // Exactly what bootstrap installs: core owns both keys, so this is the same object the plugin would
  // resolve on a running daemon.
  registry.registerHostControl('skillCatalog', {
    visibleSkills: () => [hostSkill('host-catalog-skill', 'Contributed by the host.', dataRoot)],
    visibleEntries: () => [{
      key: null, skill: hostSkill('host-catalog-skill', 'Contributed by the host.', dataRoot),
      contributorPlugin: 'skills', source: 'instance', ownerUserId: null, enabledForAccount: true, effective: true,
    }],
    canonicalBaseDir: () => dataRoot,
  } as never);
  registry.registerHostControl('skillManagement', {
    catalogForAccount: () => [{
      key: 'cronjob:sibling-plugin-skill',
      skill: hostSkill('sibling-plugin-skill', 'Contributed by a sibling plugin.', dataRoot),
      contributorPlugin: 'cronjob', source: 'plugin', ownerUserId: null, enabledForAccount: true, effective: true,
    }],
    setPluginSkillEnabled: async () => ({ ok: true }),
  } as never);
});

afterAll(() => {
  rmSync(dataRoot, { recursive: true, force: true });
});

describe('the skills plugin on the core this repository resolves', () => {
  it('registers exactly the tools and root mounts its manifest declares', () => {
    expect(registry.tools.map((tool: { name: string }) => tool.name).sort()).toEqual([...manifest.provides.tools].sort());
    expect([...registry.rootApiRoutes.keys()].sort()).toEqual([...manifest.provides.apiRoutes].sort());
    // A tool or a mount the registry turns down is dropped with a WARN, never a throw, so the absence of
    // one is part of what "loaded correctly" means here.
    expect(messages.filter((m) => /refused|skipped/.test(m))).toEqual([]);
  });

  it('declares exactly the two controls the cases below exercise', () => {
    // Guards the guard: a third control added to the manifest and to no test would otherwise inherit this
    // file's claim of coverage without being covered.
    expect([...manifest.consumesControls].sort()).toEqual(['skillCatalog', 'skillManagement']);
  });

  it('reaches the live catalog through the skillCatalog control', async () => {
    const listSkills = registry.tools.find((tool: { name: string }) => tool.name === 'ListSkills') as
      { execute: (id: string, params: unknown) => Promise<{ content: { text: string }[] }> };
    const listed = await listSkills.execute('contract-1', {});
    // The fallback when the control is missing or denied reads "the live skill catalog is unavailable",
    // so the host's own row is what proves the seam resolved rather than degraded.
    expect(listed.content[0]!.text).toBe('- host-catalog-skill (instance) — Contributed by the host.');
  });

  it("reaches another account's catalog through the skillManagement control", async () => {
    const route = registry.rootApiRoutes.get('/plugins/skills/list')!.routes.find((r) => r.method === 'GET')!;
    const res = await route.handler({
      path: '', query: { account: '7' }, params: {},
      auth: { userId: 7, admin: true, tokenScope: 'user' },
      json: async () => ({}),
    } as never) as { status: number; body: { name: string; source: string; pluginKey: string | null }[] };
    // A denied control answers 503 "skill management is unavailable; upgrade Elowen core".
    expect(res.status).toBe(200);
    expect(res.body.map((row) => [row.name, row.source, row.pluginKey]))
      .toEqual([['sibling-plugin-skill', 'plugin:cronjob', 'cronjob:sibling-plugin-skill']]);
  });

  it('was denied neither control', () => {
    // `control()` refuses by warning and returning undefined. Asserting on the log as well as on the two
    // surfaces keeps a future partial refusal from hiding behind a surface that happens to still answer.
    expect(messages.filter((m) => m.includes('denied'))).toEqual([]);
  });
});
