import { useState } from 'react';
import { Bot, Plus, Search, Settings2 } from 'lucide-react';
import { runtime } from './runtime';
import { BotDetail, statusText } from './BotDetail';
import { CreateBotDialog } from './CreateBotDialog';
import type { ChatbotBotView, ChatbotsAnswer } from './types';

/** THE CHATBOTS SECTION: the register, and one chatbot's configuration in the drawer its row opens.
 *
 *  One card, one row per chatbot: the name, the account and Project it runs as, and the state an
 *  administrator has to see before anything else. Everything ABOUT one chatbot is in the drawer, which is
 *  how every settings surface in this app treats a record it configures — the register says which records
 *  exist, and the record itself is read and written in one place.
 *
 *  The register's own controls live in the card header: the search over it and the creation action. */
export function BotsSection({ plugin, answer, loadError, onReload, onChanged }: {
  plugin: string;
  answer: ChatbotsAnswer | null;
  loadError: string | null;
  onReload(): void;
  onChanged(bot: ChatbotBotView): void;
}) {
  const { components: C, hooks } = runtime();
  const s = hooks.usePluginStrings('chatbot');
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);

  const bots = answer?.bots ?? [];
  const needle = search.trim().toLowerCase();
  const visible = bots.filter((bot) => {
    if (needle === '') return true;
    const haystack = `${bot.displayName} ${bot.publicId} ${bot.account?.username ?? ''} ${bot.projects.map((project) => project.slug).join(' ')}`;
    return haystack.toLowerCase().includes(needle);
  });
  // Looked up in the WHOLE register rather than in the filtered view: narrowing the rows must never move
  // the reader to another chatbot's drawer.
  const open = bots.find((bot) => bot.chatbotUserId === openId) ?? null;

  const body = loadError !== null ? <C.ErrorState message={`${s.botsLoadError} — ${loadError}`} onRetry={onReload} />
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
    <>
      {/* No card title: the section's own navigation record already names it. */}
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
          onChanged={onChanged}
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
            onChanged(bot);
            setOpenId(bot.chatbotUserId);
          }}
        />
      ) : null}
    </>
  );
}
