import { useState } from 'react';
import { Bot, Plus, Search, Settings2 } from 'lucide-react';
import { runtime } from './runtime';
import { BotDetail, statusText } from './BotDetail';
import { CreateBotDialog } from './CreateBotDialog';
import { matchingBots } from './search';
import { useChatbots } from './useChatbots';

/** THE CHATBOTS SECTION: the register, and one chatbot's configuration in the drawer its row opens.
 *
 *  One card, one row per chatbot: the name, the account and Project it runs as, and the state an
 *  administrator has to see before anything else. Everything ABOUT one chatbot is in the drawer, which is
 *  how every settings surface in this app treats a record it configures — the register says which records
 *  exist, and the record itself is read and written in one place.
 *
 *  The card's header carries the section's own name and one line about it, and the register's two
 *  controls: the search over it and the creation action. The host draws everything around this: the
 *  section navigation, the panel and the settings document. */
export function BotsSection({ plugin, openBotId, onOpenBot }: {
  plugin: string;
  /** Which chatbot's drawer is open, and the one way that changes. Both are the DECK's: a match in the
   *  column opens a drawer too, and the deck outlives every section it draws. */
  openBotId: number | null;
  onOpenBot(chatbotUserId: number | null): void;
}) {
  const { components: C, hooks } = runtime();
  const s = hooks.usePluginStrings('chatbot');
  const register = useChatbots();
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);

  const { answer, bots, loadError } = register;
  // The register's own filter and the deck's column read the same haystack, so a name finds the same
  // chatbot in either place.
  const visible = matchingBots(bots, search);
  // Looked up in the WHOLE register rather than in the filtered view: narrowing the rows must never move
  // the reader to another chatbot's drawer.
  const open = bots.find((bot) => bot.chatbotUserId === openBotId) ?? null;

  const body = loadError !== null ? <C.ErrorState message={`${s.botsLoadError} — ${loadError}`} onRetry={register.reload} />
    : answer === undefined ? <C.LoadingState variant="list" />
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
                  onClick={() => onOpenBot(bot.chatbotUserId)}
                />
              )}
            />
          ));

  return (
    <>
      <C.SettingsGroup
        title={s.sectionBots}
        description={s.sectionBotsHint}
        icon={Bot}
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
          requiredTools={register.requiredTools}
          onChanged={register.upsert}
          unknownError={s.saveFailed}
          onClose={() => onOpenBot(null)}
        />
      )}
      {creating && answer !== undefined ? (
        <CreateBotDialog
          plugin={plugin}
          requiredTools={answer.requiredTools}
          projects={answer.projects}
          candidates={answer.candidates}
          onClose={() => setCreating(false)}
          onCreated={(bot) => {
            register.upsert(bot);
            onOpenBot(bot.chatbotUserId);
          }}
        />
      ) : null}
    </>
  );
}
