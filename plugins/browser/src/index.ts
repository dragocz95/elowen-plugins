import type { PluginContext } from 'elowen/plugin-api';
import { registerBrowserApi } from './api.js';
import { ElowenArtifactPublisher } from './artifact.js';
import { BrowserPool, LinuxProcessInspector, PuppeteerCoreFactory } from './browser-launcher.js';
import { resolveConfig } from './config.js';
import { DynamicProxyChainAdapter, EnforcingProxyManager, type HostResolver, type ProxyChainPinnedAdapter } from './navigation-policy.js';
import { browserDependencyReport, browserReadiness } from './readiness.js';
import { BrowserService } from './service.js';
import { SessionRegistry } from './session-registry.js';
import { BrowserStore } from './store.js';
import { registerBrowserTools } from './tools.js';
import { VncBridge, VncTicketStore } from './vnc-bridge.js';
import { VncDisplayPool } from './vnc-display.js';
import type {
  BrowserArtifactPublisher, BrowserClock, BrowserProcessFactory, BrowserProxyFactory, ProcessInspector,
} from './types.js';
import { SYSTEM_CLOCK } from './types.js';

export interface BrowserRegisterDeps {
  artifacts?: BrowserArtifactPublisher;
  processFactory?: BrowserProcessFactory;
  proxyFactory?: BrowserProxyFactory;
  proxyAdapter?: ProxyChainPinnedAdapter;
  resolver?: HostResolver;
  processInspector?: ProcessInspector;
  clock?: BrowserClock;
}

export function register(ctx: PluginContext, deps: BrowserRegisterDeps = {}): void {
  const config = () => resolveConfig(ctx.config as Record<string, unknown>);
  const store = new BrowserStore(ctx.db());
  const artifacts = deps.artifacts ?? new ElowenArtifactPublisher(ctx);
  const processFactory = deps.processFactory ?? new PuppeteerCoreFactory();
  const processInspector = deps.processInspector ?? new LinuxProcessInspector();
  const proxyFactory = deps.proxyFactory ?? new EnforcingProxyManager(
    config,
    deps.proxyAdapter ?? new DynamicProxyChainAdapter(),
    ctx.logger,
    deps.resolver,
  );
  const clock = deps.clock ?? SYSTEM_CLOCK;
  // PILOT (ELOWEN_BROWSER_VNC). Constructed unconditionally because construction only makes a 0700
  // directory; nothing starts an X server, a VNC server or a listener until `vncEnabled` is set.
  const displays = new VncDisplayPool({ dataDir: ctx.dataDir(), config, logger: ctx.logger });
  const tickets = new VncTicketStore(config().vncTicketTtlMs, () => clock.now());
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
  const registry = new SessionRegistry({
    config, store, pool, artifacts, processInspector, clock, logger: ctx.logger,
    vnc: { displays, tickets },
  });
  const bridge = new VncBridge({
    config, tickets, logger: ctx.logger,
    resolve: (ticket) => registry.resolveVncTarget(ticket),
  });
  const service = new BrowserService(registry);

  // One input, two consumers: the host's readiness line and the plugin's own settings panel report the
  // same dependency verdicts because they are the same computation.
  const dependencyInput = { config, processFactory, proxyFactory, artifacts, storage: () => pool.storageStatus() };

  registerBrowserTools(ctx, registry);
  registerBrowserApi(ctx, registry, () => browserDependencyReport(dependencyInput));
  ctx.registerReadinessCheck(() => browserReadiness(dependencyInput));
  ctx.registerBootReconcile(() => registry.bootReconcile());
  const runtimeService = { name: 'browser-runtime', criticalStop: true, start: () => service.start(), stop: () => service.stop() };
  ctx.registerService(runtimeService);
  ctx.registerService({
    name: 'browser-vnc-bridge',
    criticalStop: true,
    start: async () => { if (config().vncEnabled) await bridge.listen(); },
    // Stopping tears down every live socket AND every display: an X server outliving the daemon that
    // owns it is an orphan nothing will ever reconnect to, holding a framebuffer per account.
    stop: async () => { await bridge.close(); await displays.releaseAll(); },
  });
  ctx.registerInterval('browser-session-cleanup', () => service.cleanup(), 30_000);
  ctx.registerUserRemoved((userId) => registry.deleteUser(userId));
  ctx.logger.info('browser plugin registered');
}
