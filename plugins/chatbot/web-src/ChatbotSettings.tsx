import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, MessagesSquare, Plus, Search, Settings2 } from 'lucide-react';
import { apiJson, chatbotApi, runtime } from './runtime';
import { BotDetail, statusText } from './BotDetail';
import { CreateBotDialog } from './CreateBotDialog';
import type { ChatbotBotView, ChatbotsAnswer } from './types';

/** The chatbot admin surface: ONE section of Settings.
 *
 *  It used to be a workspace of its own — a page in the left navigation with a hero, three metrics, a tab
 *  strip and a two-column register — which is a shape nothing else in this app wears for configuration.
 *  It is now what `cronjob` and `skills` are: a single `web.settings` section the host serves at
 *  `/p/chatbot`, drawn inside the host's OWN settings frame (`PluginPageFrame` supplies the masthead and
 *  the settings document), so its header, its cards and its rows are the same ones the rest of Settings
 *  uses. The section is not listed in `ownsPageFrame` precisely because the frame is the host's.
 *
 *  What is left on the page is one card: the chatbots, one row each. Everything about ONE chatbot lives in
 *  the drawer that row opens, which is how every other settings surface treats a record it configures. */
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
        <C.EmptyState
          title={s.botsEmptyTitle}
          description={s.botsEmptyDescription}
          icon={Bot}
          action={<C.Button variant="accent" icon={Plus} onClick={() => setCreating(true)}>{s.newBot}</C.Button>}
        />
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
      surface={surface}
      plugin={plugin}
      section="chatbots"
      title={s.title}
      description={s.sectionHint}
      icon={MessagesSquare}
      action={<C.Button variant="accent" icon={Plus} onClick={() => setCreating(true)}>{s.newBot}</C.Button>}
    >
      {/* No title inside the card: on a page the masthead above it already says what this is, and in a
          settings deck the panel does. The header carries the one control the list needs. */}
      <C.SettingsGroup
        actions={bots.length === 0 ? undefined : (
          <C.RegisterSearch
            value={search}
            onChange={setSearch}
            placeholder={s.botsSearch}
            label={s.botsSearch}
            onClear={() => setSearch('')}
            clearLabel={s.botsSearchClear}
          />
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
