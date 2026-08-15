import { z } from 'zod';
/** The plugin's OWN config keys (plugins.config.agents) — the autopilot keys consumed exclusively by
 *  this runtime, seeded there by the core's one-shot migrations (wave 1: migrateAgentsPluginConfig,
 *  wave 2: migrateAgentsPluginConfigWave2) and edited by the plugin's settings deck. Matches the
 *  manifest `configSchema`. */
const agentsConfigSchema = z.object({
    overseerModel: z.string().optional(),
    prBaseBranch: z.string().optional(),
    prAutoOpen: z.boolean().optional(),
    prVerifyCommand: z.string().optional(),
    pilotExec: z.string().optional(),
    overseerExec: z.string().optional(),
    reviewOnDone: z.boolean().optional(),
    tddMode: z.boolean().optional(),
    prEnabled: z.boolean().optional(),
    ghToken: z.string().optional(),
}).passthrough();
/** Resolve the plugin's effective config: its own validated plugins.config.agents slice first, the
 *  LIVE autopilot value (and the top-level ghToken) as the fallback for a key the slice does not
 *  carry. DELIBERATELY KEPT after the mirror's removal: the one-shot migrations run on the first
 *  DAEMON boot of the new version, but a runner process opens the DB read-only and can load this
 *  plugin against a pre-migration row in the window before that boot — without the fallback, a
 *  configured prVerifyCommand would silently vanish there and a PR could open unverified.
 *  Post-migration the slice carries every key (the migrations copy all of them, empty values
 *  included), so the fallback is dead weight only then. A malformed slice degrades to the fallback
 *  whole. */
export function agentsPluginConfig(slice, host) {
    const parsed = agentsConfigSchema.safeParse(slice);
    const own = parsed.success ? parsed.data : {};
    const autopilot = host.get().autopilot;
    return {
        overseerModel: own.overseerModel ?? autopilot.overseerModel,
        prBaseBranch: own.prBaseBranch ?? autopilot.prBaseBranch,
        prAutoOpen: own.prAutoOpen ?? autopilot.prAutoOpen,
        prVerifyCommand: own.prVerifyCommand ?? autopilot.prVerifyCommand,
        pilotExec: own.pilotExec ?? autopilot.pilotExec,
        overseerExec: own.overseerExec ?? autopilot.overseerExec,
        reviewOnDone: own.reviewOnDone ?? autopilot.reviewOnDone,
        tddMode: own.tddMode ?? autopilot.tddMode,
        prEnabled: own.prEnabled ?? autopilot.prEnabled,
        // Slice first, the core's legacy top-level secret only as the fallback — the plugin owns this
        // choice, core no longer makes it. Optional call: many test stubs satisfy only get(), and a
        // missing accessor means no legacy token.
        ghToken: own.ghToken || (host.legacyGhToken?.() ?? ''),
    };
}
