/** chatbot — browser UI bundle.
 *
 *  FOUR settings sections and no page of its own. Every section is declared in the manifest with
 *  `placement: "pluginDetail"`, so the host offers them inside Settings → Plugins → Chatbots and supplies
 *  the section navigation, the panel and the settings document around each one — the same frame
 *  `/settings?cat=brain` wears. */
import { registerChatbotUi } from './runtime';
import { CHATBOT_SECTIONS } from './sections';

registerChatbotUi(CHATBOT_SECTIONS);
