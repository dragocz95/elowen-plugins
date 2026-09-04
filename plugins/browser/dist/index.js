import { registerBrowserApi } from './api.js';
import { ElowenArtifactPublisher } from './artifact.js';
import { BrowserPool, LinuxProcessInspector, PuppeteerCoreFactory } from './browser-launcher.js';
import { resolveConfig } from './config.js';
import { DynamicProxyChainAdapter, EnforcingProxyManager } from './navigation-policy.js';
import { browserDependencyReport, browserReadiness } from './readiness.js';
import { BrowserService } from './service.js';
import { SessionRegistry } from './session-registry.js';
import { BrowserStore } from './store.js';
import { registerBrowserTools } from './tools.js';
import { VirtualDisplayPool } from './virtual-display.js';
import { VncTransport, webSocketSupport } from './vnc-transport.js';
import { SYSTEM_CLOCK } from './types.js';
export function register(ctx, deps = {}) {
    const config = () => resolveConfig(ctx.config);
    const store = new BrowserStore(ctx.db());
    const artifacts = deps.artifacts ?? new ElowenArtifactPublisher(ctx);
    const processFactory = deps.processFactory ?? new PuppeteerCoreFactory();
    const processInspector = deps.processInspector ?? new LinuxProcessInspector();
    const proxyFactory = deps.proxyFactory ?? new EnforcingProxyManager(config, deps.proxyAdapter ?? new DynamicProxyChainAdapter(), ctx.logger, deps.resolver);
    const clock = deps.clock ?? SYSTEM_CLOCK;
    const displays = new VirtualDisplayPool({
        dataDir: ctx.dataDir(), config, store, processInspector, logger: ctx.logger,
    });
    const pool = new BrowserPool({
        dataDir: ctx.dataDir(),
        config,
        store,
        proxyFactory,
        processFactory,
        processInspector,
        logger: ctx.logger,
        displays,
    });
    // The live view needs a WebSocket the daemon carries into the plugin. A host too old to offer one
    // cannot serve a live view at all — there is no screencast to fall back to any more — so this is said
    // plainly once, at registration, and the rest of the plugin keeps working: every tool, every API route
    // and the whole agent path are unaffected, and the card reports that the picture is unavailable.
    const core = webSocketSupport(ctx);
    const transport = core ? new VncTransport({
        config,
        logger: ctx.logger,
        resolve: (userId, payload) => registry.resolveLiveView(userId, payload),
    }) : null;
    if (!core) {
        ctx.logger.warn('browser live view is unavailable: this Elowen core does not offer registerWebSocketRoute/issueWebSocketTicket');
    }
    const registry = new SessionRegistry({
        config, store, pool, artifacts, processInspector, displays, clock, logger: ctx.logger,
        closeLiveViews: (sessionId, reason) => transport?.closeSession(sessionId, reason),
    });
    const service = new BrowserService(registry);
    // One input, two consumers: the host's readiness line and the plugin's own settings panel report the
    // same dependency verdicts because they are the same computation.
    const dependencyInput = {
        config, processFactory, proxyFactory, artifacts,
        storage: () => pool.storageStatus(),
        liveView: () => core !== null,
    };
    if (core && transport)
        transport.register(core);
    registerBrowserTools(ctx, registry);
    registerBrowserApi(ctx, registry, () => browserDependencyReport(dependencyInput), core && transport ? { core, transport } : null);
    ctx.registerReadinessCheck(() => browserReadiness(dependencyInput));
    ctx.registerBootReconcile(() => registry.bootReconcile());
    const runtimeService = {
        name: 'browser-runtime',
        criticalStop: true,
        start: () => service.start(),
        // Stopping tears down every live view AND every display: an X server outliving the daemon that owns
        // it is an orphan nothing will reconnect to, holding a framebuffer per account.
        stop: async () => {
            transport?.closeAll('daemon_stopping');
            await service.stop();
            await displays.releaseAll();
        },
    };
    ctx.registerService(runtimeService);
    ctx.registerInterval('browser-session-cleanup', () => service.cleanup(), 30_000);
    ctx.registerUserRemoved((userId) => registry.deleteUser(userId));
    ctx.logger.info('browser plugin registered');
}
