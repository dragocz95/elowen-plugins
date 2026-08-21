import { registerLegacyMode } from './lib/legacy.mjs';
import { registerTaskMode } from './lib/tasks.mjs';

export function register(ctx) {
  // Elowen <0.28.8 did not expose enabled-plugin state. Keep its original TodoWrite surface as an
  // explicit compatibility policy; once those hosts are unsupported, this branch can be deleted.
  if (typeof ctx.isPluginEnabled !== 'function') {
    registerLegacyMode(ctx);
    return;
  }

  // Work and agents own the richer task domain when enabled. Legacy mode is deliberate here, not an
  // error fallback: it avoids registering a competing session-task surface beside those plugins.
  if (ctx.isPluginEnabled('work') || ctx.isPluginEnabled('agents')) {
    registerLegacyMode(ctx);
    return;
  }

  // A host that selected session-task mode promised the DB capability. Let wiring failures propagate so
  // the loader reports the plugin as broken instead of quietly publishing a different tool contract.
  const db = ctx.db();
  registerTaskMode(ctx, db);
}
