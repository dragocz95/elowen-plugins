import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, MessagesSquare, Plus, Search, Settings2 } from 'lucide-react';
import { apiJson, chatbotApi, runtime } from './runtime';
import { BotDetail, statusText } from './BotDetail';
import { CreateBotDialog } from './CreateBotDialog';
import type { ChatbotBotView, ChatbotsAnswer } from './types';

/** The chatbot admin surface: ONE section of Settings, offered inside Settings → Plugins → Chatbot.
 *
 *  It used to be a workspace of its own — a page in the left navigation with a hero, three metrics, a tab
 *  strip and a two-column register — which is a shape nothing else in this app wears for configuration.
 *  Its manifest entry now declares `placement: "pluginDetail"`, so the host mounts it as a tab of that
 *  plugin's detail workspace with `surface="deck"`: the tab names the section and the host supplies the
 *  panel and the settings document around it (`web/modules/settings/PluginSettingsSection.tsx`). This
 *  file therefore draws NO header of its own and no navigation of its own — it fills the panel it is
 *  given. The section is not in `ownsPageFrame` for the same reason: the frame is the host's.
 *
 *  `C.PluginPageFrame` is what makes that true on both surfaces without a branch of our own: it is a
 *  pass-through on the deck and supplies the masthead if the section is ever placed as a page. The one
 *  control the surface owns lives in the CARD's header rather than in that masthead, because the masthead
 *  does not exist on the deck.
 *
 *  What is on the panel is one card: the chatbots, one row each. Everything about ONE chatbot lives in the
 *  drawer that row opens, which is how every other settings surface treats a record it configures. */
export function ChatbotSettings({ plugin, surface }: { plugin: string; surface: 'page' | 'deck' }) {
  const { components: C, hooks, utils } = runtime();
  const s = hooks.usePluginStrings('chatbot');

  const [answer, setAnswer] = useState<ChatbotsAnswer | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    setLoadError(null);
    void apiJson<ChatbotsAnswer>(chatbotApi.bots())
      .then((value) => setAnswer(value))
      .catch((error) => setLoadError(utils.apiErrorMessage(error) || s.botsLoadError));
  }, [s.botsLoadError, utils]);

  useEffect(() => { load(); }, [load]);

  const bots = useMemo(() => answer?.bots ?? [], [answer]);
  /** A saved row replaces the one it came from; a newly created one JOINS the register. It used to only
   *  ever replace, so a chatbot created here was not in the list it was created from until a reload. */
  const upsertBot = (updated: ChatbotBotView) => {
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
  };

  const needle = search.trim().toLowerCase();
  const visible = bots.filter((bot) => {
    if (needle === '') return true;
    const haystack = `${bot.displayName} ${bot.publicId} ${bot.account?.username ?? ''} ${bot.projects.map((project) => project.slug).join(' ')}`;
    return haystack.toLowerCase().includes(needle);
  });
  // Looked up in the WHOLE register rather than in the filtered view: narrowing the rows must never move
  // the reader to another chatbot's drawer.
  const open = bots.find((bot) => bot.chatbotUserId === openId) ?? null;

  const body = loadError !== null ? <C.ErrorState message={`${s.botsLoadError} — ${loadError}`} onRetry={load} />
    : answer === null ? <C.LoadingState variant="list" />
      : bots.length === 0 ? (
        // No second creation button here: the card's header carries it in every state, and one card
        // offering the same action twice is two things to read where there is one thing to do.
        <C.EmptyState title={s.botsEmptyTitle} description={s.botsEmptyDescription} icon={Bot} />
      )
        : visible.length === 0 ? <C.EmptyState title={s.botsNoResults} description={s.botsNoResultsDescription} icon={Search} />
          : visible.map((bot) => (
            <C.SettingsRow
              key={bot.chatbotUserId}
              icon={Bot}
              label={bot.displayName || s.botFallback}
              // The account and the Project are the row's identity, not its story: they read on hover here
              // and in full inside the drawer, which is where they can be acted on.
              description={`@${bot.account?.username ?? '—'} · ${bot.projects.length === 1 ? bot.projects[0]!.slug : '—'}`}
              status={(
                <C.Badge tone={bot.blockers.length > 0 ? 'warning' : bot.status === 'enabled' ? 'success' : undefined}>
                  {statusText(bot, s)}
                </C.Badge>
              )}
              actions={(
                <C.IconButton
                  icon={Settings2}
                  label={s.openBot.replace('{name}', bot.displayName || s.botFallback)}
                  onClick={() => setOpenId(bot.chatbotUserId)}
                />
              )}
            />
          ));

  return (
    <C.PluginPageFrame
      // No title of our own: placed as a page, the frame reads the section's label from the manifest
      // listing, so the heading cannot drift from the entry that leads here.
      surface={surface}
      plugin={plugin}
      section="chatbots"
      icon={MessagesSquare}
    >
      {/* No title inside the card either: the workspace tab above it already names the section, and a
          native settings panel wears no second heading. The header carries the controls the list needs —
          creation among them, because the deck has no masthead to put an action in. */}
      <C.SettingsGroup
        actions={(
          <>
            {bots.length === 0 ? null : (
              <C.RegisterSearch
                value={search}
                onChange={setSearch}
                placeholder={s.botsSearch}
                label={s.botsSearch}
                onClear={() => setSearch('')}
                clearLabel={s.botsSearchClear}
              />
            )}
            <C.Button variant="accent" icon={Plus} onClick={() => setCreating(true)}>{s.newBot}</C.Button>
          </>
        )}
      >
        {body}
      </C.SettingsGroup>

      {open === null ? null : (
        <BotDetail
          // Keyed by the chatbot: a drawer opened on another row is a different form with its own draft,
          // never the previous one's state under a new heading.
          key={open.chatbotUserId}
          bot={open}
          requiredTools={answer?.requiredTools ?? []}
          onChanged={upsertBot}
          unknownError={s.saveFailed}
          onClose={() => setOpenId(null)}
        />
      )}
      {creating && answer !== null ? (
        <CreateBotDialog
          plugin={plugin}
          requiredTools={answer.requiredTools}
          projects={answer.projects}
          candidates={answer.candidates}
          onClose={() => setCreating(false)}
          onCreated={(bot) => {
            upsertBot(bot);
            setOpenId(bot.chatbotUserId);
          }}
        />
      ) : null}
    </C.PluginPageFrame>
  );
}
