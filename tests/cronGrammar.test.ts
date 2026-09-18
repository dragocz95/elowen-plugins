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

  // The web schedule builder (web-src/scheduleBuilder.ts) hand-mirrored the every/daily/weekly patterns
  // from this same authority until both were pulled into plugins/cronjob/scheduleGrammar.mjs, which the
  // builder now imports directly. This is the other half of that fix: if the builder ever stops importing
  // the shared module — a hand-written regex creeping back in, or one of the three drifting from it — a
  // grammar corpus entry the plugin accepts as 'every'/'daily'/'weekly' would silently render "Advanced"
  // in the UI, which is exactly the failure this plugin's grammar contract exists to make impossible.
  it('the builder accepts every corpus entry the plugin parses as every/daily/weekly', async () => {
    const plugin = await import(pluginPath) as { parseSchedule(spec: string): { kind: string } | null };
    const builderPath = resolve(here, '..', 'plugins/cronjob/web-src/scheduleBuilder.ts');
    const builder = await import(builderPath) as {
      parseBuilderSchedule(spec: string): { mode: string } | null;
    };
    for (const spec of Object.keys(grammar.accepts)) {
      const kind = plugin.parseSchedule(spec)?.kind;
      if (kind !== 'interval' && kind !== 'daily' && kind !== 'weekly') continue; // cron stays Advanced by design
      expect(builder.parseBuilderSchedule(spec), spec).not.toBeNull();
    }
  });
});
