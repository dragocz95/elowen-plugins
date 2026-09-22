import type { ReactNode } from 'react';
import { Activity, Bot, MessagesSquare, SlidersHorizontal } from 'lucide-react';
import { BotsSection } from './BotsSection';
import { ConversationsSection } from './ConversationsView';
import { StatsSection } from './StatsView';
import { SharedSettings } from './SharedSettings';
import type { DeckSection } from './SectionDeck';
import type { ChatbotBotView, ChatbotsAnswer } from './types';

/** WHAT THIS PAGE IS MADE OF, in one place.
 *
 *  Four sections, each one an id, a name, a glyph and what it renders. The page picks one and the deck
 *  draws the rest as the way between them; neither of them knows what any section contains, and no
 *  section knows how it is reached. Adding, renaming or reordering a section is an edit to this list.
 *
 *  The `id`, `label` and `icon` of each entry are exactly the shape the host's `WorkspaceShell`
 *  navigation takes, so the list is handed to it unchanged. */

export const SECTION_IDS = ['bots', 'conversations', 'statistics', 'shared'] as const;
export type SectionId = (typeof SECTION_IDS)[number];

export interface ChatbotSection extends DeckSection {
  id: SectionId;
  content: ReactNode;
}

export function chatbotSections(input: {
  plugin: string;
  strings: Record<string, string>;
  answer: ChatbotsAnswer | null;
  loadError: string | null;
  onReload(): void;
  onChanged(bot: ChatbotBotView): void;
}): ChatbotSection[] {
  const { plugin, strings: s, answer, loadError, onReload, onChanged } = input;
  const bots = answer?.bots ?? [];
  return [
    {
      id: 'bots',
      label: s.sectionBots,
      icon: Bot,
      content: (
        <BotsSection plugin={plugin} answer={answer} loadError={loadError} onReload={onReload} onChanged={onChanged} />
      ),
    },
    {
      id: 'conversations',
      label: s.sectionConversations,
      icon: MessagesSquare,
      content: <ConversationsSection bots={bots} />,
    },
    {
      id: 'statistics',
      label: s.sectionStatistics,
      icon: Activity,
      content: <StatsSection bots={bots} />,
    },
    {
      id: 'shared',
      label: s.sectionShared,
      icon: SlidersHorizontal,
      content: <SharedSettings plugin={plugin} requiredTools={answer?.requiredTools ?? []} />,
    },
  ];
}
