/** The admin surface's shape, re-exported from the plugin's own contract.
 *
 *  `src/adminContract.ts` is the ONE declaration: the plugin's admin routes answer with exactly these
 *  fields, and a view that imported them from nowhere would be free to read a field the server does not
 *  send. It is dependency-free by design, so the browser bundle can import it the way the widget imports
 *  `publicContract`. */
export type {
  ChatbotActionRuleView,
  ChatbotAccountFactsView,
  ChatbotAccountOptionView,
  ChatbotBotView,
  ChatbotConversationView,
  ChatbotConversationsAnswer,
  ChatbotProjectView,
  ChatbotStatsAnswer,
  ChatbotStatsDayView,
  ChatbotsAnswer,
  ChatbotTranscriptAnswer,
  ChatbotTranscriptTurnView,
} from '../src/adminContract.js';
