// Outbound phone calls through a configurable HTTP voice service. One tool, one table, no UI beyond
// the settings card.
//
// There is deliberately NO allow-list of callable numbers and NO per-call confirmation step: the only
// brake is the hourly call limit, which exists to stop a repeating agent rather than to police who may
// be dialled. That decision is why the tool description carries the weight instead, and why it says
// plainly that this rings a real person's phone. Do not add a confirmation prompt back as an obvious
// improvement — it was considered and refused, and `ctx.askUser` is a no-op outside an interactive turn
// anyway, so a scheduled call could never have been confirmed by one.
import { openStore } from './lib/store.mjs';
import { registerVoiceCall } from './lib/tool.mjs';

export function register(ctx) {
  // The store opens and the account-teardown handler registers BEFORE the configuration is checked,
  // because both have to work on an unconfigured instance too: a plugin that is switched on but not yet
  // wired up still holds whatever it recorded earlier, and a deleted account must take that with it
  // whether or not anybody can currently place a call.
  const store = openStore(ctx.db());
  ctx.registerUserRemoved((userId) => store.removeUser(userId));

  registerVoiceCall(ctx, store);
}
