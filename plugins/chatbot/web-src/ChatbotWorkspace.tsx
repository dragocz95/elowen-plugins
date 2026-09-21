import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, Bot, Layers, ListChecks, MessagesSquare, Plus, Search } from 'lucide-react';
import { apiJson, chatbotApi, runtime } from './runtime';
import { BotDetail, statusText } from './BotDetail';
import { ConversationsView } from './ConversationsView';
import { CreateBotDialog } from './CreateBotDialog';
import { StatsView } from './StatsView';
import type { ChatbotBotView, ChatbotsAnswer } from './types';

type BotFilter = 'all' | 'enabled' | 'not_enabled' | 'attention';
type WorkspaceTab = 'bots' | 'conversations' | 'statistics';

/** The register the whole page is built around: a chatbot's name, the ACCOUNT it runs as, the one Project
 *  it works in, and the state an administrator has to see before anything else. One template for the
 *  header row and every body row, so the grid cannot disagree with itself. */
const REGISTER_COLUMNS = 'minmax(0,2fr) minmax(0,1.2fr) minmax(0,1fr) 8rem 1.25rem';
const REGISTER_COMPACT_COLUMNS = 'minmax(0,2fr) minmax(0,1fr) 8rem 1.25rem';
const REGISTER_MOBILE_COLUMNS = 'minmax(0,1fr) 8rem 1.25rem';

/** A plugin page for chatbots: the register and one chatbot's configuration, this chatbot's conversations,
 *  and what it actually did. The instance-level settings this plugin has live on the Settings → Plugins
 *  page, where every plugin's own manifest schema is edited: one number does not need a second editor here.
 *
 *  The three tabs share ONE selection, so a reader who opened a chatbot and switched to its conversations
 *  is looking at the same chatbot — and every request the two read-only tabs make names it, so neither can
 *  show one chatbot's history under another's heading. */
export function ChatbotWorkspace({ plugin }: { plugin: string }) {
  const { components: C, hooks, utils } = runtime();
  const s = hooks.usePluginStrings('chatbot');

  const [answer, setAnswer] = useState<ChatbotsAnswer | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<WorkspaceTab>('bots');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<BotFilter>('all');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    setLoadError(null);
    void apiJson<ChatbotsAnswer>(chatbotApi.bots())
      .then((value) => setAnswer(value))
      .catch((error) => setLoadError(utils.apiErrorMessage(error) || s.botsLoadError));
  }, [s.botsLoadError, utils]);

  useEffect(() => { load(); }, [load]);

  const bots = useMemo(() => answer?.bots ?? [], [answer]);
  const replaceBot = (updated: ChatbotBotView) => {
    setAnswer((current) => current === null ? current : {
      ...current,
      bots: current.bots.map((candidate) => candidate.chatbotUserId === updated.chatbotUserId ? updated : candidate),
    });
  };

  const visible = useMemo(() => bots.filter((bot) => {
    if (filter === 'enabled' && bot.status !== 'enabled') return false;
    if (filter === 'not_enabled' && bot.status === 'enabled') return false;
    if (filter === 'attention' && bot.blockers.length === 0) return false;
    const needle = search.trim().toLowerCase();
    if (needle === '') return true;
    const haystack = `${bot.displayName} ${bot.publicId} ${bot.account?.username ?? ''} ${bot.projects.map((project) => project.slug).join(' ')}`;
    return haystack.toLowerCase().includes(needle);
  }), [bots, filter, search]);

  // The selected chatbot is looked up in the WHOLE register rather than in the filtered view: the toolbar's
  // search narrows which rows are listed, and it must not silently move a reader to another chatbot.
  const selected = bots.find((bot) => bot.chatbotUserId === selectedId) ?? visible[0] ?? bots[0] ?? null;
  const enabledCount = bots.filter((bot) => bot.status === 'enabled').length;
  const attentionCount = bots.filter((bot) => bot.blockers.length > 0).length;
  const filterOptions = [
    { value: 'all', label: s.filterAll, icon: <Layers size={14} /> },
    { value: 'enabled', label: s.filterEnabled, icon: <Bot size={14} /> },
    { value: 'not_enabled', label: s.filterNotEnabled, icon: <Bot size={14} /> },
    { value: 'attention', label: s.filterAttention, icon: <AlertTriangle size={14} /> },
  ];
  const toolbarFilters = [{
    id: 'state',
    label: s.botsFilter,
    control: (
      <C.SelectMenu
        value={filter}
        onChange={(value: string) => setFilter(value as BotFilter)}
        options={filterOptions}
        label={s.botsFilter}
      />
    ),
    ...(filter === 'all'
      ? { active: false as const }
      : {
        active: true as const,
        activeLabel: `${s.botsFilter}: ${filterOptions.find((option) => option.value === filter)?.label ?? filter}`,
        onReset: () => setFilter('all'),
      }),
  }];

  const hero = {
    eyebrow: s.workspaceEyebrow,
    title: s.title,
    description: s.workspaceIntro,
    status: <span className="workspace-status">{loadError === null ? s.workspaceReady : s.workspaceSetup}</span>,
    action: <C.Button variant="accent" icon={Plus} onClick={() => setCreating(true)}>{s.newBot}</C.Button>,
    metrics: (
      <>
        <C.WorkspaceMetric label={s.metricBots} value={answer === null ? '—' : bots.length} icon={Bot} />
        <C.WorkspaceMetric label={s.metricEnabled} value={answer === null ? '—' : enabledCount} icon={ListChecks} />
        <C.WorkspaceMetric label={s.metricIncomplete} value={answer === null ? '—' : attentionCount} icon={AlertTriangle} />
      </>
    ),
  };

  const register = (
    <C.ControlSurfaceRegister className="grid min-h-[31rem] grid-cols-1 gap-4 p-4 lg:!grid-cols-[22rem_minmax(0,1fr)] lg:items-start">
      <div className="min-w-0">
        {visible.length === 0 ? (
          <C.ControlSurfaceState>
            <C.EmptyState title={s.botsNoResults} description={s.botsNoResultsDescription} icon={Search} />
          </C.ControlSurfaceState>
        ) : (
          <C.DataTable
            ariaLabel={s.workspaceTabBots}
            columns={REGISTER_COLUMNS}
            compactColumns={REGISTER_COMPACT_COLUMNS}
            mobileColumns={REGISTER_MOBILE_COLUMNS}
          >
            <C.DataTableRow header>
              <C.DataTableCell header lines={1}>{s.columnBot}</C.DataTableCell>
              <C.DataTableCell header lines={1} priority="wide">{s.columnAccount}</C.DataTableCell>
              <C.DataTableCell header lines={1} priority="wide">{s.columnProject}</C.DataTableCell>
              <C.DataTableCell header lines={1}>{s.columnStatus}</C.DataTableCell>
              <C.DataTableChevronCell />
            </C.DataTableRow>
            {visible.map((bot) => (
              <C.DataTableRow
                key={bot.chatbotUserId}
                selected={selected?.chatbotUserId === bot.chatbotUserId}
                onOpen={() => setSelectedId(bot.chatbotUserId)}
                openLabel={s.openBot.replace('{name}', bot.displayName || s.botFallback)}
              >
                <C.DataTableCell lines={1}>{bot.displayName || s.botFallback}</C.DataTableCell>
                <C.DataTableCell lines={1} priority="wide">{bot.account === null ? '—' : `@${bot.account.username}`}</C.DataTableCell>
                <C.DataTableCell lines={1} priority="wide">{bot.projects.length === 1 ? bot.projects[0]!.slug : '—'}</C.DataTableCell>
                <C.DataTableCell lines="auto">
                  <C.Badge tone={bot.blockers.length > 0 ? 'warning' : bot.status === 'enabled' ? 'success' : undefined}>
                    {statusText(bot, s)}
                  </C.Badge>
                </C.DataTableCell>
                <C.DataTableChevronCell />
              </C.DataTableRow>
            ))}
          </C.DataTable>
        )}
      </div>

      <div className="min-w-0">
        {selected === null ? (
          <p className="text-sm text-muted-foreground">{s.detailSelectHint}</p>
        ) : (
          <BotDetail bot={selected} requiredTools={answer?.requiredTools ?? []} onChanged={replaceBot} unknownError={s.saveFailed} />
        )}
      </div>
    </C.ControlSurfaceRegister>
  );

  const scoped = (
    <C.ControlSurfaceRegister className="flex min-h-[31rem] flex-col gap-4 p-4">
      {selected === null ? (
        <C.ControlSurfaceState>
          <C.EmptyState title={s.botsEmptyTitle} description={s.botsEmptyDescription} icon={Bot} />
        </C.ControlSurfaceState>
      ) : (
        <>
          <div className="max-w-sm min-w-[14rem]">
            <C.SelectMenu
              value={String(selected.chatbotUserId)}
              onChange={(value: string) => setSelectedId(Number(value))}
              options={bots.map((bot) => ({ value: String(bot.chatbotUserId), label: bot.displayName || s.botFallback }))}
              label={s.scopedBotLabel}
              variant="line"
            />
          </div>
          {/* Conversations and statistics are both scoped to the chatbot chosen above, and both say which
              one they are about, so a reader can never mistake one chatbot's history for another's. */}
          {tab === 'conversations' ? <ConversationsView bot={selected} /> : <StatsView bot={selected} />}
        </>
      )}
    </C.ControlSurfaceRegister>
  );

  const body = loadError !== null ? (
    <C.ControlSurfaceDocument>
      <C.ControlSurfaceState tone="danger">
        <C.ErrorState message={`${s.botsLoadError} — ${loadError}`} onRetry={load} />
      </C.ControlSurfaceState>
    </C.ControlSurfaceDocument>
  ) : answer === null ? (
    <C.ControlSurfaceDocument>
      <C.ControlSurfaceState><C.LoadingState variant="list" /></C.ControlSurfaceState>
    </C.ControlSurfaceDocument>
  ) : bots.length === 0 ? (
    <C.ControlSurfaceDocument>
      <C.ControlSurfaceState>
        <C.EmptyState title={s.botsEmptyTitle} description={s.botsEmptyDescription} icon={Bot} />
      </C.ControlSurfaceState>
    </C.ControlSurfaceDocument>
  ) : (
    <C.ControlSurfaceDocument>{tab === 'bots' ? register : scoped}</C.ControlSurfaceDocument>
  );

  return (
    <C.WorkspaceShell
      variant="register"
      hero={hero}
      navigation={{
        sections: [
          { id: 'bots', label: s.workspaceTabBots, icon: Bot },
          { id: 'conversations', label: s.workspaceTabConversations, icon: MessagesSquare },
          { id: 'statistics', label: s.workspaceTabStatistics, icon: Activity },
        ],
        value: tab,
        onChange: (next: string) => setTab(next as WorkspaceTab),
        ariaLabel: s.title,
      }}
      toolbar={answer === null || bots.length === 0 || tab !== 'bots' ? undefined : {
        search: (
          <C.RegisterSearch
            value={search}
            onChange={setSearch}
            placeholder={s.botsSearch}
            label={s.botsSearch}
            onClear={() => setSearch('')}
            clearLabel={s.botsSearchClear}
          />
        ),
        filters: toolbarFilters,
      }}
    >
      {body}
      {creating && answer !== null ? (
        <CreateBotDialog
          plugin={plugin}
          requiredTools={answer.requiredTools}
          projects={answer.projects}
          candidates={answer.candidates}
          onClose={() => setCreating(false)}
          onCreated={(bot) => {
            replaceBot(bot);
            setSelectedId(bot.chatbotUserId);
          }}
        />
      ) : null}
    </C.WorkspaceShell>
  );
}
