import { z } from 'zod';
import { DEFAULT_IDLE_TTL_MS } from './manager.js';
/** How long a warm server is kept, in the unit the settings form shows. */
const IDLE_TTL_MINUTES_DEFAULT = DEFAULT_IDLE_TTL_MS / 60_000;
/** The plugin's OWN config keys (plugins.config.lsp). `diagnosticsEnabled` is the extracted core
 *  `lspEnabled` flag: the persisted on/off state of live diagnostics, seeded there by the core's
 *  one-shot migrateLspPluginConfig() and edited by the plugin's settings form (or the `/lsp` toggle,
 *  which PATCHes the same slice). Matches the manifest `configSchema`. */
const lspConfigSchema = z.object({
    diagnosticsEnabled: z.boolean().optional(),
    /** Minutes an unused language server stays warm before the manager's idle sweep disposes it. 0 turns
     *  age-based eviction off; a server whose project root disappears is reclaimed either way. */
    idleTtlMinutes: z.number().finite().min(0).max(240).optional(),
}).passthrough();
/** Resolve the plugin's effective config from its validated slice. A malformed slice degrades to the
 *  defaults whole (never half-applied), and an absent key means "never configured" → the default. */
export function lspPluginConfig(slice) {
    const parsed = lspConfigSchema.safeParse(slice);
    const own = parsed.success ? parsed.data : {};
    return {
        diagnosticsEnabled: own.diagnosticsEnabled ?? true,
        idleTtlMinutes: own.idleTtlMinutes ?? IDLE_TTL_MINUTES_DEFAULT,
    };
}
