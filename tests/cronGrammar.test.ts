// @vitest-environment node
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

// The other half of a contract the Elowen package holds too. The cron/schedule grammar exists in three
// hand-written copies that cannot import one another: this plugin's parseSchedule (the authority, and
// what validates writes to /plugins/cronjob/jobs), and the daemon's web/lib/cronSchedule.ts and
// web/lib/cron.ts. Since the plugin lives here and those live there, each side pins itself to the same
// frozen corpus — cronGrammar.json, byte-identical in both repositories.
//
// If this fails, the plugin's grammar moved. Widening it is fine; doing so without updating BOTH copies
// of the fixture is how the dashboard ends up showing a valid job as "never fires".
const here = dirname(fileURLToPath(import.meta.url));
const grammar = JSON.parse(readFileSync(join(here, 'cronGrammar.json'), 'utf-8')) as {
  accepts: Record<string, boolean>;
};
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
