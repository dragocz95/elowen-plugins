// @vitest-environment node
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

// The other half of a contract the Elowen package holds too. The cron/schedule grammar exists in three
// hand-written copies that cannot import one another: this plugin's parseSchedule (the authority, and
// what validates writes to /plugins/cronjob/jobs), and the daemon's web/lib/cronSchedule.ts and
// web/lib/cron.ts. The plugin lives here and those live there — so both sides read the SAME file, the
// one published inside elowen-plugin-shared, rather than two copies kept equal by hand.
//
// That is deliberate: a plugin installed in production resolves this package through the daemon's
// node_modules, so the corpus under test is literally the corpus that ships. If this fails, the
// plugin's grammar moved away from the contract. Widening it means publishing a new shared package —
// which is the cost that makes "the dashboard shows a valid job as never fires" impossible to reach by
// forgetting a second copy.
const grammar = JSON.parse(
  readFileSync(createRequire(import.meta.url).resolve('elowen-plugin-shared/cronGrammar'), 'utf-8'),
) as { accepts: Record<string, boolean> };
const here = dirname(fileURLToPath(import.meta.url));
const pluginPath = resolve(here, '..', 'plugins/cronjob/index.mjs');

describe('cron schedule grammar (plugin ⋅ frozen contract)', () => {
  it('covers both accepted and rejected forms', () => {
    const values = Object.values(grammar.accepts);
    expect(values.filter(Boolean).length).toBeGreaterThan(10);
    expect(values.filter((v) => !v).length).toBeGreaterThan(10);
  });

  it('accepts and rejects exactly what the contract says', async () => {
    const plugin = await import(pluginPath) as { parseSchedule(spec: string): { kind: string } | null };
    const actual: Record<string, boolean> = {};
    for (const spec of Object.keys(grammar.accepts)) actual[spec] = plugin.parseSchedule(spec) !== null;
    expect(actual).toEqual(grammar.accepts);
  });
});
