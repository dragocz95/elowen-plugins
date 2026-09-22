import { useState } from 'react';
import { Bot, Plus, Search, Settings2 } from 'lucide-react';
import { runtime } from './runtime';
import { BotDetail, statusText } from './BotDetail';
import { CreateBotDialog } from './CreateBotDialog';
import { matchingBots } from './search';
import { BudgetUsage } from './BudgetUsage';
import { useChatbots } from './useChatbots';

export function BotsSection({ plugin, openBotId, onOpenBot }: {
  plugin: string;
  openBotId: number | null;
  onOpenBot(chatbotUserId: number | null): void;
}) {
  const { components: C, hooks } = runtime();
  const s = hooks.usePluginStrings('chatbot');
  const register = useChatbots();
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);

  const { answer, bots, loadError } = register;
  const visible = matchingBots(bots, search);
  const open = bots.find((bot) => bot.chatbotUserId === openBotId) ?? null;

  const body = loadError !== null ? <C.ErrorState message={`${s.botsLoadError} — ${loadError}`} onRetry={register.reload} />
    : answer === undefined ? <C.LoadingState variant="list" />
      : bots.length === 0 ? <C.EmptyState title={s.botsEmptyTitle} description={s.botsEmptyDescription} icon={Bot} />
        : visible.length === 0 ? <C.EmptyState title={s.botsNoResults} description={s.botsNoResultsDescription} icon={Search} />
          : (
            <C.EntityList>
              {visible.map((bot) => (
                <C.EntityRow key={bot.chatbotUserId}>
                  <div className="flex min-w-0 items-center gap-2">
                    <Bot size={16} className="shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 truncate text-sm font-medium">{bot.displayName || s.botFallback}</span>
                    <C.Badge tone={bot.blockers.length > 0 ? 'warning' : bot.status === 'enabled' ? 'success' : undefined}>
                      {statusText(bot, s)}
                    </C.Badge>
                    <span className="ml-auto shrink-0">
                      <C.IconButton
                        icon={Settings2}
                        label={s.openBot.replace('{name}', bot.displayName || s.botFallback)}
                        onClick={() => onOpenBot(bot.chatbotUserId)}
                      />
                    </span>
                  </div>
                  <BudgetUsage bot={bot} compact />
                </C.EntityRow>
              ))}
            </C.EntityList>
          );

  return (
    <>
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
          key={open.chatbotUserId}
          bot={open}
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
