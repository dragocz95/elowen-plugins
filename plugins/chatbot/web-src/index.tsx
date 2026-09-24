/** chatbot — browser UI bundle.
 *
 *  ONE entry in the primary navigation and no settings section. The manifest declares
 *  `web.presentation: "overlay"`, so the host opens `/p/chatbot` in its shared reading modal, keeps the
 *  page underneath mounted and owns the outer title; the five sections switch inside that modal in the
 *  host's own `SectionDeck`.
 *
 *  Every section's route registers the same deck component — the deck reads the address and renders the
 *  section it names — so switching a section replaces the content pane and leaves the frame standing. */
import { registerChatbotUi } from './runtime';
import { ChatbotDeck } from './ChatbotDeck';
import { CHATBOT_SECTIONS } from './sections';

registerChatbotUi(Object.fromEntries(CHATBOT_SECTIONS.map((section) => [section.route, ChatbotDeck])));
