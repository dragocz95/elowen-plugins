import { registerTaskMode } from './lib/tasks.mjs';

export function register(ctx) {
  registerTaskMode(ctx, ctx.db());
}
