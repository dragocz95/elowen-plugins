import type { ReactNode } from 'react';
import { Activity, Bot, MessageSquareHeart, MessagesSquare, SlidersHorizontal, type LucideIcon } from 'lucide-react';
import { BotsSection } from './BotsSection';
import { ConversationsSection } from './ConversationsView';
import { FeedbackSection } from './FeedbackView';
import { StatsSection } from './StatsView';
import { SharedSettings } from './SharedSettings';

/** WHAT A SECTION IS HANDED BY THE DECK AROUND IT: the plugin whose surface this is, and the one piece of
 *  deck state a section reads — which chatbot's drawer the register has open.
 *
 *  The chatbot a drawer shows belongs to the DECK rather than to the register, for two reasons that are
 *  the same reason: the deck's own column can open one from a search match, and the deck is what the host
 *  keeps mounted while the address moves between the five sections. State a section holds is gone the
 *  moment the reader looks at another section; state the deck holds survives the whole visit. */
interface ChatbotDeckFrame {
  plugin: string;
  /** The chatbot whose drawer the register has open, or null when none is. */
  openBotId: number | null;
  onOpenBot(chatbotUserId: number | null): void;
}

export interface ChatbotSection {
  id: 'bots' | 'conversations' | 'feedback' | 'statistics' | 'shared';
  /** The address inside this plugin's own modal, relative to `/p/chatbot`. */
  route: string;
  /** This section's name, read from the bundle's own strings. The name is the BUNDLE's now — the deck's
   *  navigation is built here, so the manifest has no section entries left to carry it — and it is read
   *  by its own key rather than through a variable, so a renamed string breaks the build instead of
   *  rendering an empty navigation record. The section's own heading reads the same key. */
  label(strings: Record<string, string>): string;
  icon: LucideIcon;
  render(frame: ChatbotDeckFrame): ReactNode;
}

/** WHAT THIS PLUGIN'S MODAL IS MADE OF, in one place: five sections, each an id, an address, a name, a
 *  glyph and what it renders.
 *
 *  This one list is both what the deck's navigation is built from and what the bundle registers as its
 *  pages, so a section cannot end up in the column without an address, or at an address with no way in.
 *  The register keeps the empty route, because `/p/chatbot` is what the main navigation opens and it has
 *  to land somewhere. */
export const CHATBOT_SECTIONS: readonly ChatbotSection[] = [
  { id: 'bots', route: '', label: (s) => s.sectionBots!, icon: Bot, render: ({ plugin, openBotId, onOpenBot }) => <BotsSection plugin={plugin} openBotId={openBotId} onOpenBot={onOpenBot} /> },
  { id: 'conversations', route: 'conversations', label: (s) => s.sectionConversations!, icon: MessagesSquare, render: () => <ConversationsSection /> },
  { id: 'feedback', route: 'feedback', label: (s) => s.sectionFeedback!, icon: MessageSquareHeart, render: () => <FeedbackSection /> },
  { id: 'statistics', route: 'statistics', label: (s) => s.sectionStatistics!, icon: Activity, render: () => <StatsSection /> },
  { id: 'shared', route: 'shared', label: (s) => s.sectionShared!, icon: SlidersHorizontal, render: ({ plugin }) => <SharedSettings plugin={plugin} /> },
];

/** The section an address resolves to. An address this plugin does not know is the register: it is what
 *  the main navigation opens, and the only section that is always there to fall back on. */
export function sectionForRoute(route: string): ChatbotSection {
  return CHATBOT_SECTIONS.find((section) => section.route === route) ?? CHATBOT_SECTIONS[0]!;
}

/** One section's full address. */
export function sectionHref(plugin: string, route: string): string {
  return route === '' ? `/p/${plugin}` : `/p/${plugin}/${route}`;
}
