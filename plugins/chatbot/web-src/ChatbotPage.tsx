import { useCallback, useEffect, useState } from 'react';
import { MessagesSquare } from 'lucide-react';
import { apiJson, chatbotApi, runtime } from './runtime';
import { SectionDeck } from './SectionDeck';
import { chatbotSections, SECTION_IDS, type SectionId } from './sections';
import type { ChatbotBotView, ChatbotsAnswer } from './types';

/** THE CHATBOTS PAGE: one entry in the main navigation, and inside it a deck of sections read one at a
 *  time — the chatbots, their conversations, their statistics, and what applies to all of them.
 *
 *  The page itself owns exactly two things: WHICH section is on screen, and the register every section
 *  reads from. The register is loaded ONCE here rather than per section, because three of the four need
 *  it — the list, and the picker the two read-only sections choose a chatbot with — and three copies of
 *  one read would disagree the moment a chatbot is saved.
 *
 *  What the sections are lives in `sections.tsx`; how they are drawn lives in `SectionDeck.tsx`. */
export function ChatbotPage({ plugin }: { plugin: string }) {
  const { components: C, hooks, utils } = runtime();
  const s = hooks.usePluginStrings('chatbot');

  const [section, setSection] = useState<SectionId>('bots');
  const [answer, setAnswer] = useState<ChatbotsAnswer | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoadError(null);
    void apiJson<ChatbotsAnswer>(chatbotApi.bots())
      .then((value) => setAnswer(value))
      .catch((error) => setLoadError(utils.apiErrorMessage(error) || s.botsLoadError));
  }, [s.botsLoadError, utils]);

  useEffect(() => { load(); }, [load]);

  /** A saved row replaces the one it came from; a newly created one JOINS the register. It used to only
   *  ever replace, so a chatbot created here was not in the list it was created from until a reload. */
  const upsertBot = useCallback((updated: ChatbotBotView) => {
    setAnswer((current) => {
      if (current === null) return current;
      const known = current.bots.some((candidate) => candidate.chatbotUserId === updated.chatbotUserId);
      return {
        ...current,
        bots: known
          ? current.bots.map((candidate) => candidate.chatbotUserId === updated.chatbotUserId ? updated : candidate)
          : [...current.bots, updated],
      };
    });
  }, []);

  const sections = chatbotSections({ plugin, strings: s, answer, loadError, onReload: load, onChanged: upsertBot });
  const active = sections.find((candidate) => candidate.id === section) ?? sections[0]!;

  return (
    <>
      {/* Draws nothing: it publishes the page name for the app masthead and the browser tab, exactly as
          every other workspace page does beside its shell. */}
      <C.ModuleHeader title={s.title} icon={MessagesSquare} />
      <SectionDeck
        sections={sections.map(({ id, label, icon }) => ({ id, label, icon }))}
        value={active.id}
        onChange={(id) => setSection(SECTION_IDS.find((candidate) => candidate === id) ?? 'bots')}
        ariaLabel={s.sectionsLabel}
        hero={{ title: s.title, description: s.pageHint, icon: MessagesSquare }}
      >
        {active.content}
      </SectionDeck>
    </>
  );
}
