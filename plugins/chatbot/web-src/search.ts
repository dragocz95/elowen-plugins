import type { ChatbotBotView } from './types';

/** WHAT A CHATBOT IS FOUND BY, in one place: the name it answers as, the account it runs as, its public id
 *  and the Project it works in.
 *
 *  The register narrows its own rows with this and the deck's column finds chatbots with it, so the two
 *  cannot disagree about what a typed name means. Nothing is added to the haystack for one caller's sake:
 *  a chatbot is found by what identifies it, never by its state, its numbers or its domains — those are
 *  read once the reader is looking at the chatbot, and a column that answered "enabled" would be offering
 *  a filter over somebody else's question. */
function chatbotHaystack(bot: ChatbotBotView): string {
  return `${bot.displayName} ${bot.publicId} ${bot.account?.username ?? ''} ${bot.projects.map((project) => project.slug).join(' ')}`;
}

/** The one reading of a typed query: trimmed, and compared without case. */
export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

/** The chatbots a query finds. An empty query finds every chatbot, which is what a filter over the
 *  register shows with nothing typed; a caller that OFFERS matches instead of filtering rows decides for
 *  itself what an empty field means — see the deck, where it offers none. */
export function matchingBots(bots: readonly ChatbotBotView[], query: string): ChatbotBotView[] {
  const needle = normalizeQuery(query);
  return needle === '' ? [...bots] : bots.filter((bot) => chatbotHaystack(bot).toLowerCase().includes(needle));
}
