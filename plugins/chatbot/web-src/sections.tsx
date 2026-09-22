import { BotsSection } from './BotsSection';
import { ConversationsSection } from './ConversationsView';
import { StatsSection } from './StatsView';
import { SharedSettings } from './SharedSettings';
import type { ChatbotSettingsSection } from './runtime';

/** WHAT THIS PLUGIN CONTRIBUTES TO SETTINGS, in one place: four sections, keyed by the ids the manifest
 *  declares in `web.settings`.
 *
 *  The host looks a section's component up by the id its listing advertised, so these keys and the
 *  manifest's ids are ONE contract — an id here the manifest does not declare is a component nothing ever
 *  mounts, and an id there that is missing here renders the host's "section unavailable" notice.
 *  `tests/workspace-page-registration.test.ts` checks the two against each other.
 *
 *  Every section is mounted on its own, with `surface="deck"`, inside the panel the host draws for it.
 *  None of them draws a header, a navigation or a document surface of its own: those are the host's, and
 *  taking them from the host is what makes this read exactly like `/settings?cat=brain`. */
export const CHATBOT_SECTIONS: Record<string, ChatbotSettingsSection> = {
  bots: ({ plugin }) => <BotsSection plugin={plugin} />,
  conversations: () => <ConversationsSection />,
  statistics: () => <StatsSection />,
  shared: ({ plugin }) => <SharedSettings plugin={plugin} />,
};
