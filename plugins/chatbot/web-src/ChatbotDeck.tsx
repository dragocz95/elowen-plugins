import { useState } from 'react';
import { runtime, type DeckNavGroup, type DeckNavItem } from './runtime';
import { CHATBOT_SECTIONS, sectionForRoute, sectionHref } from './sections';
import { matchingBots, normalizeQuery } from './search';
import { useChatbots } from './useChatbots';

/** THE CHATBOTS MODAL: one entry in the primary navigation, opened in the host's own reading overlay,
 *  with five sections switching inside it.
 *
 *  The frame is the host's `SectionDeck` — the same one Settings and Account wear — so there is no
 *  navigation, column or strip written here: this file only says WHICH sections exist, which one the
 *  address names, and what activating one does. The deck draws the column beside the content where there
 *  is width for it, the single scrollable line on a phone, and owns the one vertical scroller. Nothing
 *  may wrap it in another scroller or in a container that refuses to shrink; the host's modal body
 *  already bounds it.
 *
 *  Every route registers THIS component, so a section change replaces the content pane and leaves the
 *  frame — and the column's scroll position — exactly where it was. That is also why what the reader asked
 *  the column stays here rather than in a section: the deck outlives all five of them. */
export function ChatbotDeck({ plugin, rest }: { plugin: string; rest: string[] }) {
  const { components: C, hooks, navigate } = runtime();
  const s = hooks.usePluginStrings('chatbot');
  const register = useChatbots();
  const [query, setQuery] = useState('');
  // The chatbot whose drawer the register has open. It is the deck's rather than the register's because a
  // column match opens one too — and because the deck survives the section change that match goes through.
  const [openBotId, setOpenBotId] = useState<number | null>(null);

  const active = sectionForRoute(rest.join('/'));
  const needle = normalizeQuery(query);
  // With nothing typed the column offers no matches: the five sections ARE the whole list, and a field
  // that answered "every chatbot" with a register-long column would be drawing the register twice.
  const found = needle === '' ? [] : matchingBots(register.bots, query);
  // One chatbot as its own way in: the register, with that chatbot's drawer open.
  const openBot = (chatbotUserId: number) => {
    setOpenBotId(chatbotUserId);
    navigate(sectionHref(plugin, CHATBOT_SECTIONS[0]!.route));
  };

  // One group, so the column carries no caption: these five are peers, and a caption over a single group
  // names a distinction that is not there.
  const groups: DeckNavGroup[] = [{
    id: 'chatbot',
    items: CHATBOT_SECTIONS.flatMap((section): DeckNavItem[] => {
      const label = section.label(s);
      // The register is where a chatbot is a row, so it is the one record that can offer one: this is the
      // only section whose matches are things the column can take the reader to directly. Another
      // section's own name is what answers a query about it — a chatbot is not a record of the
      // conversations or the statistics, which are reads of whichever chatbot is picked once there.
      const matches = section.id === 'bots'
        ? found.map((bot) => ({
          id: String(bot.chatbotUserId),
          label: bot.displayName || s.botFallback,
          onActivate: () => openBot(bot.chatbotUserId),
        }))
        : [];
      // A query narrows the column to what answers it, and a section that answers nothing is not a
      // destination for it. An empty column then says so in the host's own words (`emptyLabel`).
      if (needle !== '' && matches.length === 0 && !label.toLowerCase().includes(needle)) return [];
      return [{
        id: section.id,
        label,
        icon: section.icon,
        current: section.id === active.id,
        // Each section is its own address inside the modal. Inside an overlay the runtime's navigate keeps
        // the page underneath mounted and rewrites the modal's own history entry, so a section is
        // deep-linkable and shareable without the modal ever closing.
        onActivate: () => navigate(sectionHref(plugin, section.route)),
        matches,
      }];
    }),
  }];

  return (
    <C.SectionDeck
      testId="chatbot-deck"
      contentLabel={active.label(s)}
      navigation={(layout, className) => (
        <C.DeckNavigation
          label={s.sectionsLabel}
          groups={groups}
          layout={layout}
          testId="chatbot-navigation"
          // The host's own filter over what it was handed: the same field Settings' column carries, one
          // lookup over the five sections and the register behind it.
          search={{ value: query, onChange: setQuery, label: s.sectionsSearch }}
          emptyLabel={s.sectionsNoMatches}
          className={className}
        />
      )}
    >
      {active.render({ plugin, openBotId, onOpenBot: setOpenBotId })}
    </C.SectionDeck>
  );
}
