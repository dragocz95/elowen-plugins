import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Bot, Layers, ListChecks, Plus, Search } from 'lucide-react';
import { apiJson, runtime, type ChatbotBotView, type ChatbotsResponse } from './runtime';
import { BotDetail, statusText } from './BotDetail';
import { CreateBotDialog } from './CreateBotDialog';

type BotFilter = 'all' | 'enabled' | 'not_enabled' | 'attention';

/** The register the whole page is built around: a chatbot's name, the ACCOUNT it runs as, the one Project
 *  it works in, and the state an administrator has to see before anything else. One template for the
 *  header row and every body row, so the grid cannot disagree with itself. */
const REGISTER_COLUMNS = 'minmax(0,2fr) minmax(0,1.2fr) minmax(0,1fr) 8rem 1.25rem';
const REGISTER_COMPACT_COLUMNS = 'minmax(0,2fr) minmax(0,1fr) 8rem 1.25rem';
const REGISTER_MOBILE_COLUMNS = 'minmax(0,1fr) 8rem 1.25rem';

/** A plugin page for chatbots. The instance-level settings this plugin has live on the Settings → Plugins
 *  page, where every plugin's own manifest schema is edited: one number does not need a second editor
 *  here, and the surface this page owes the reader is the register and one chatbot's configuration. */
export function ChatbotWorkspace() {
  const { components: C, hooks, utils } = runtime();
  const s = hooks.usePluginStrings('chatbot');

  const [answer, setAnswer] = useState<ChatbotsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<BotFilter>('all');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    setLoadError(null);
    void apiJson<ChatbotsResponse>('/plugins/chatbot/api/bots')
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

  const selected = bots.find((bot) => bot.chatbotUserId === selectedId) ?? visible[0] ?? null;
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
    // Figures the register can actually answer for. A visitor count would need a second query and belongs
    // with the conversation and usage surfaces, not bolted onto a hero.
    metrics: (
      <>
        <C.WorkspaceMetric label={s.metricBots} value={answer === null ? '—' : bots.length} icon={Bot} />
        <C.WorkspaceMetric label={s.metricEnabled} value={answer === null ? '—' : enabledCount} icon={ListChecks} />
        <C.WorkspaceMetric label={s.metricIncomplete} value={answer === null ? '—' : attentionCount} icon={AlertTriangle} />
      </>
    ),
  };

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
    <C.ControlSurfaceDocument>
      <C.ControlSurfaceRegister className="grid min-h-[31rem] grid-cols-1 gap-4 p-4 lg:!grid-cols-[22rem_minmax(0,1fr)] lg:items-start">
        <div className="min-w-0">
          {visible.length === 0 ? (
            <C.ControlSurfaceState>
              <C.EmptyState title={s.botsNoResults} description={s.botsNoResultsDescription} icon={Search} />
            </C.ControlSurfaceState>
          ) : (
            <C.DataTable
              ariaLabel={s.botsTab}
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

        <div className="min-w-0 rounded-xl border border-border bg-muted/30 p-5 lg:sticky lg:top-4 lg:self-start">
          {selected === null ? (
            <p className="text-sm text-muted-foreground">{s.detailSelectHint}</p>
          ) : (
            <BotDetail bot={selected} onChanged={replaceBot} unknownError={s.saveFailed} />
          )}
        </div>
      </C.ControlSurfaceRegister>
    </C.ControlSurfaceDocument>
  );

  return (
    <C.WorkspaceShell
      variant="register"
      hero={hero}
      toolbar={answer === null || bots.length === 0 ? undefined : {
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
