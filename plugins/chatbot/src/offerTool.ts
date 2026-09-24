import { defineTool } from '@earendil-works/pi-coding-agent';
import type { ChatbotContext } from './coreSeams.js';
import type { ChatbotStore } from './store.js';
import type { TurnEventBroker } from './broker.js';
import { findVisitorTurn } from './visitorTurn.js';
import { OFFER_SCHEMA, validateOffer } from './validation.js';
import { CHATBOT_PLATFORM } from './adapter.js';

export const OFFER_TOOL_NAME = 'ChatbotOffer';

export function registerOfferTool(deps: {
  ctx: ChatbotContext; store: ChatbotStore; broker: TurnEventBroker; now: () => string;
}): void {
  const { ctx, store, broker, now } = deps;
  ctx.registerTool(defineTool({
    name: OFFER_TOOL_NAME,
    label: 'Offer visitor choices, links or cards',
    description: 'Attach a short option set or one next step to your text answer. Choices send a reply; links and cards point only to this chatbot’s allowed pages. Never use this instead of the text answer. Calling again in one turn replaces its previous offer.',
    parameters: OFFER_SCHEMA,
    execute: async (_id, input) => {
      const live = findVisitorTurn(ctx, store);
      if (!live.ok) throw new Error(`ChatbotOffer only works in a running chatbot visitor turn (${live.reason}).`);
      const checked = validateOffer(input, store.originsOf(live.chatbotUserId));
      if (!checked.ok) return { content: [{ type: 'text', text: checked.error }], details: { status: 'refused' } };
      store.replaceOffer(live.turn.turn_id, checked.value, now());
      broker.publish(live.turn.turn_id);
      return { content: [{ type: 'text', text: 'Offer attached to this answer.' }], details: { status: 'done' } };
    },
  }), { platform: CHATBOT_PLATFORM });
}
