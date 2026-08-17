// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlugins, discoverPlugins } from 'elowen/dist/plugins/loader.js';
import { makePluginDb } from 'elowen/dist/store/pluginDb.js';
import { ConfigStore } from 'elowen/dist/store/configStore.js';
import { ProjectStore } from 'elowen/dist/store/projectStore.js';
import { TaskStore } from '../plugins/work/dist/store/taskStore.js';
import { Readiness } from '../plugins/work/dist/store/readiness.js';
import { openPluginTablesDb } from './helpers/pluginTablesDb.js';
import { domainTestHost } from './helpers/domainHost.js';

const log = { info() {}, warn() {}, error() {} };
const pluginDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'plugins');

/** Tool names are a wire contract (`--json` events, MCP, per-user permission rules), so their shape is
 *  a domain rule, not a style preference: TitleCase, no separators. `mcp__*` is the ONE exception — those
 *  names are minted at runtime from a remote server's own tool list (plugins/mcp), never authored here,
 *  and with no server configured this environment registers none of them.
 *
 *  Adopted from the Elowen package, whose copy of this suite scans only ITS plugin dir — every plugin
 *  that moved here left the check behind. Same rules, applied to the registry's own plugins. */
const TITLE_CASE = /^[A-Z][A-Za-z0-9]*$/;

/** Several plugins gate their tools behind configured credentials and register nothing without them,
 *  which would silently shrink every list below. Fake credentials register the full toolset without
 *  connecting: `registerPlatform` is a stub here and the chat adapters are only recorded, never started,
 *  while the image plugins just need a provider to resolve. */
const CONFIG = {
  discord: { botToken: 'tok', rolePolicies: [] },
  telegram: { botToken: 'tok', rolePolicies: [] },
  msteams: { appId: 'a', appPassword: 'p', tenantId: 't', rolePolicies: [] },
  whatsapp: { rolePolicies: [] },
  'image-gen': { provider: 'openai' },
  'image-edit': { provider: 'openai' },
};

async function loadEveryRegistryPlugin() {
  const names = discoverPlugins([pluginDir]).map((p: { manifest: { name: string } }) => p.manifest.name);
  // `work` and `agents` reach for a database — and agents for tmux and the core stores — while they
  // register. A plugin that throws there is SKIPPED with an error and contributes no tools at all, which
  // would quietly shrink every list below instead of failing: exactly the vacuous pass the parity test
  // exists to prevent. Wiring them the way the daemon does keeps the comparison honest.
  const db = openPluginTablesDb(':memory:');
  db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'elowen','/o')").run();
  const host = domainTestHost({
    db, tasks: new TaskStore(db), readiness: new Readiness(db),
    config: new ConfigStore(db), projects: new ProjectStore(db),
  });
  return loadPlugins({
    dirs: [pluginDir], enabled: names, logger: log, config: CONFIG,
    pluginDb: (plugin: string) => makePluginDb(db, plugin, { canMigrate: true }),
    host,
    // The image plugins take their key from a central brain provider rather than their own secret field.
    resolveProvider: () => ({ apiKey: 'k', baseUrl: 'https://api.example.invalid/v1' }),
  });
}

describe('tool naming convention', () => {
  // The first load imports every plugin's module graph, which costs well over vitest's 5s default under
  // the full suite's parallel load; later loads hit the module cache. Only this test needs the headroom.
  it('every registry plugin tool is TitleCase', { timeout: 30_000 }, async () => {
    const reg = await loadEveryRegistryPlugin();
    // Guards the guard: a config or loader regression that registers nothing (a bad plugin dir alone does
    // it) must fail loudly rather than vacuously pass an empty list.
    expect(reg.tools.length).toBeGreaterThan(60);
    expect(reg.tools.map((t: { name: string }) => t.name).filter((n: string) => !TITLE_CASE.test(n))).toEqual([]);
  });
});

describe('plan-safe declarations', () => {
  // A typo here fails closed (the tool just vanishes from plan mode) so nothing would ever surface it.
  it('every tool a manifest declares plan-safe is a tool that plugin actually registers', async () => {
    const reg = await loadEveryRegistryPlugin();
    const registered = new Set(reg.tools.map((t: { name: string }) => t.name));
    expect([...reg.toolPlanSafe].filter((n: string) => !registered.has(n))).toEqual([]);
  });
});

describe('plugin manifest / code parity', () => {
  // registry.ts refuses a tool absent from `provides.tools` with a WARN and a silent drop, so a manifest
  // that drifts from its .mjs does not fail anything — the tool just vanishes. This is the only check
  // that catches it.
  it('each plugin registers exactly the tools its manifest declares', async () => {
    const reg = await loadEveryRegistryPlugin();
    const registered = new Map<string, string[]>();
    for (const t of reg.tools as { name: string }[]) {
      const owner = reg.toolOwner.get(t.name);
      if (owner) (registered.get(owner) ?? registered.set(owner, []).get(owner)!).push(t.name);
    }
    for (const p of discoverPlugins([pluginDir]) as { manifest: { name: string; provides?: { tools?: string[] } } }[]) {
      const declared = p.manifest.provides?.tools;
      if (!declared) continue; // an undeclared surface is unconstrained by design (skills)
      // A `prefix*` entry declares a DYNAMIC surface (the mcp bridge names its tools per configured
      // server at runtime) — nothing registers under it in this serverless test env, so patterns are
      // excluded from the exact-name comparison and pattern-covered registrations are dropped too.
      const patterns = declared.filter((d) => d.endsWith('*')).map((d) => d.slice(0, -1));
      const exact = declared.filter((d) => !d.endsWith('*'));
      const actual = (registered.get(p.manifest.name) ?? []).filter((n) => !patterns.some((pre) => n.startsWith(pre)));
      expect([...exact].sort(), `plugin '${p.manifest.name}'`).toEqual([...actual].sort());
    }
  });
});
