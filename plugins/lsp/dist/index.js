import { LspManager } from './manager.js';
import { registerLspTools } from './tools.js';
import { registerLspApi } from './api.js';
import { lspPluginConfig } from './config.js';
export function register(ctx, deps = {}) {
    // Lazy: registration must not spawn anything, and a sub-agent runner loads this plugin too (it gets
    // the tools, never the services) — so the manager appears on the first tool call there.
    const create = deps.createManager ?? (() => new LspManager());
    let manager = null;
    // A STOPPED generation stays stopped. Without this latch the accessor would happily rebuild the
    // manager after the service went down — and a reload runs stopAll() BEFORE the registry swap, so a
    // status poll or an in-flight tool call landing in that window would spawn servers into an instance
    // whose stop() has already run, leaving them with nobody to kill them.
    let stopped = false;
    const lsp = () => {
        if (stopped)
            return null;
        if (!manager) {
            manager = create();
            manager.setEnabled(lspPluginConfig(ctx.config).diagnosticsEnabled);
        }
        return manager;
    };
    // Last-resort teardown for a process that never runs plugin SERVICES: a sub-agent runner loads this
    // plugin and can spawn language servers through the tools, but PluginServiceRunner is daemon-only, so
    // nothing else would ever dispose them. Best effort by nature — 'exit' does not fire on SIGKILL, and
    // a server that ignores its stdin closing outlives the process either way — so it narrows the window
    // rather than closing it. Removed on stop so reloads cannot pile listeners up.
    const disposeOnExit = () => { manager?.disposeAll(); };
    process.on('exit', disposeOnExit);
    registerLspTools(ctx, lsp);
    registerLspApi(ctx, lsp);
    // The persisted on/off state applies at start, and stop() frees every spawned server. The `/lsp`
    // toggle and the settings form both write plugins.config.lsp.diagnosticsEnabled, which hot-reloads
    // the plugin — so the flip travels through this same stop → start path and kills the servers for real.
    ctx.registerService({
        name: 'diagnostics',
        start: () => {
            stopped = false; // a reload re-runs start() on this same closure
            const { diagnosticsEnabled } = lspPluginConfig(ctx.config);
            // Seeding through the accessor keeps ONE construction site; when diagnostics are off this makes
            // the state explicit rather than waiting for a first tool call to discover it.
            lsp()?.setEnabled(diagnosticsEnabled);
            ctx.logger.info(`live diagnostics ${diagnosticsEnabled ? 'on' : 'off'}`);
        },
        stop: () => {
            stopped = true;
            manager?.disposeAll();
            manager = null;
            process.off('exit', disposeOnExit);
        },
    });
    // The one thing core still asks this plugin: the live toggle state for GET /brain/status, so chat
    // clients render Active/Inactive. Absent control (plugin disabled) → core omits the field entirely
    // and every client hides its LSP row, which is the honest answer.
    // Read-through, never constructing: a status poll must not be what brings a language-server manager
    // into existence (nor throw during a reload's stop window). With no live manager the persisted flag IS
    // the answer — it is exactly what the next one would be seeded with.
    ctx.registerControl('lsp', {
        diagnosticsEnabled: () => manager?.isEnabled() ?? lspPluginConfig(ctx.config).diagnosticsEnabled,
    });
}
