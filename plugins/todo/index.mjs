import { registerLegacyMode } from './lib/legacy.mjs';
import { registerTaskMode } from './lib/tasks.mjs';

export function register(ctx) {
  const hasPluginState = typeof ctx.isPluginEnabled === 'function';
  const conflicts = hasPluginState && (ctx.isPluginEnabled('work') || ctx.isPluginEnabled('agents'));

  if (hasPluginState && !conflicts) {
    let db;
    try {
      db = ctx.db();
    } catch (error) {
      ctx.logger.warn(`session tasks unavailable; falling back to legacy TodoWrite: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (db) {
      registerTaskMode(ctx, db);
      return;
    }
  }

  registerLegacyMode(ctx);
}
