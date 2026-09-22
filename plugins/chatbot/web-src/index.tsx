/** chatbot — browser UI bundle.
 *
 *  ONE page, at the plugin's own entry in the main navigation, and no settings section: everything this
 *  plugin configures is inside that page, which carries its own deck of sections. The empty route is the
 *  manifest's own `nav[].route`, so the menu entry and the registered page are one address. */
import { registerChatbotUi } from './runtime';
import { ChatbotPage } from './ChatbotPage';

registerChatbotUi({ '': ChatbotPage });
