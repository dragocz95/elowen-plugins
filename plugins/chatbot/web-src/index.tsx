/** chatbot — browser UI bundle.
 *
 *  ONE settings section and no page of its own, which is the shape `cronjob` and `skills` already have and
 *  the shape the host serves at the bare `/p/chatbot` route. It is deliberately absent from
 *  `ownsPageFrame`: the masthead and the settings document around this section are the HOST's, and taking
 *  them from the host is what makes the surface read like the rest of Settings rather than like a
 *  workspace standing beside it. */
import { registerChatbotUi } from './runtime';
import { ChatbotSettings } from './ChatbotSettings';

registerChatbotUi({ chatbots: ChatbotSettings });
