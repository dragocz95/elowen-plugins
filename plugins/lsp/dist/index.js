import { LspManager } from './manager.js';
import { registerLspTools } from './tools.js';
import { registerLspApi } from './api.js';
import { registerAfterEditDiagnostics } from './afterEdit.js';
import { lspPluginConfig } from './config.js';
import { ManagedLspManager } from './managed.js';
export function register(ctx, deps = {}) {
    // Lazy: registration must not spawn anything, and a sub-agent runner loads this plugin too (it gets
    // the tools, never the services) — so the manager appears on the first tool call there.
    const create = deps.createManager ?? (() => new LspManager());
    let manager = null;
    const managed = new Map();
    // Single-flight per (project, actor): two concurrent tool calls on a cold first use would otherwise
    // both resolve the environment, both construct an instance for the same key and both mint an
    // execution lease for the same server — one of them an orphan that no stop() will ever reach.
    const building = new Map();
    const selectedManager = async () => {
        if (stopped)
            return null;
        const project = ctx.currentAccess?.().projectRef;
        if (project?.kind !== 'managed')
            return lsp();
        const actor = ctx.currentAccountUserId();
        const sandbox = ctx.control('sandbox');
        if (!sandbox || actor === null)
            throw new Error('Managed LSP environment provider or actor is unavailable.');
        const actorKey = `${project.projectId}:${actor}`;
        const inflight = building.get(actorKey);
        if (inflight)
            return inflight;
        const build = (async () => {
            const state = await sandbox.environmentFor({ project, accountUserId: actor });
            if (state.projectId !== project.projectId)
                throw new Error('Environment provider returned another project.');
            if (stopped)
                return null;
            const key = `${project.projectId}:${actor}:${state.generation}`;
            for (const [oldKey, old] of managed) {
                if (old.project.projectId === project.projectId && old.actor === actor && oldKey !== key) {
                    await old.shutdown();
                    managed.delete(oldKey);
                }
            }
            let selected = managed.get(key);
            if (!selected) {
                selected = new ManagedLspManager(ctx, project, actor, state.generation);
                selected.setEnabled(lspPluginConfig(ctx.config).diagnosticsEnabled);
                managed.set(key, selected);
            }
            // The stop() below snapshots `managed` before its shutdowns; an entry set after that snapshot
            // would otherwise survive the clear as an instance nobody will ever shut down.
            if (stopped) {
                managed.delete(key);
                await selected.shutdown();
                return null;
            }
            return selected;
        })();
        building.set(actorKey, build);
        try {
            return await build;
        }
        finally {
            if (building.get(actorKey) === build)
                building.delete(actorKey);
        }
    };
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
    const disposeOnExit = () => { manager?.disposeAll(); for (const entry of managed.values())
        entry.disposeAll(); };
    process.on('exit', disposeOnExit);
    registerLspTools(ctx, selectedManager);
    registerLspApi(ctx, selectedManager);
    // The push half of the same manager: an edit that lands gets type-checked in the background and the
    // result reaches the model with its next turn, so a model that forgets to call LspDiagnostics is still
    // told what it broke. Delivery goes through registerTurnContext rather than the `appendContext` hook
    // patch: `brain.turn.contextBuilt` is the only patch seam the host actually emits, its payload is the
    // user's text alone, and it runs outside the turn's own scope — a plugin there cannot tell WHICH
    // conversation it is contributing to, which is the one thing this must never get wrong.
    registerAfterEditDiagnostics(ctx, selectedManager);
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
        stop: async () => {
            stopped = true;
            manager?.disposeAll();
            manager = null;
            process.off('exit', disposeOnExit);
            await Promise.all([...managed.values()].map((entry) => entry.shutdown()));
            managed.clear();
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
