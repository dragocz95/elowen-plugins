import { runtime, type DeckNavGroup } from './runtime';
import { CHATBOT_SECTIONS, sectionForRoute, sectionHref } from './sections';

/** THE CHATBOTS MODAL: one entry in the primary navigation, opened in the host's own reading overlay,
 *  with four sections switching inside it.
 *
 *  The frame is the host's `SectionDeck` — the same one Settings and Account wear — so there is no
 *  navigation, column or strip written here: this file only says WHICH sections exist, which one the
 *  address names, and what activating one does. The deck draws the column beside the content where there
 *  is width for it, the single scrollable line on a phone, and owns the one vertical scroller. Nothing
 *  may wrap it in another scroller or in a container that refuses to shrink; the host's modal body
 *  already bounds it.
 *
 *  Every route registers THIS component, so a section change replaces the content pane and leaves the
 *  frame — and the column's scroll position — exactly where it was. */
export function ChatbotDeck({ plugin, rest }: { plugin: string; rest: string[] }) {
  const { components: C, hooks, navigate } = runtime();
  const s = hooks.usePluginStrings('chatbot');

  const active = sectionForRoute(rest.join('/'));
  // One group, so the column carries no caption: these four are peers, and a caption over a single group
  // names a distinction that is not there.
  const groups: DeckNavGroup[] = [{
    id: 'chatbot',
    items: CHATBOT_SECTIONS.map((section) => ({
      id: section.id,
      label: section.label(s),
      icon: section.icon,
      current: section.id === active.id,
      // Each section is its own address inside the modal. Inside an overlay the runtime's navigate keeps
      // the page underneath mounted and rewrites the modal's own history entry, so a section is
      // deep-linkable and shareable without the modal ever closing.
      onActivate: () => navigate(sectionHref(plugin, section.route)),
    })),
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
          emptyLabel={s.sectionsEmpty}
          className={className}
        />
      )}
    >
      {active.render(plugin)}
    </C.SectionDeck>
  );
}
