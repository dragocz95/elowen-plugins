import { useCallback, useEffect, useRef, useState } from 'react';
import { MessagesSquare, Trash2 } from 'lucide-react';
import { apiJson, chatbotApi, runtime } from './runtime';
import { BotPicker } from './BotPicker';
import { useChatbots } from './useChatbots';
import { formatDateTime, integer } from './format';
import type { ChatbotConversationsAnswer, ChatbotVisitorsAnswer } from './types';

/** THE CONVERSATIONS SECTION: who talked to one chatbot, and what was said.
 *
 *  It reads metadata only. A visitor's own words are read for ONE conversation at a time, which is what
 *  keeps this a register rather than a transcript dump, and every request names the chatbot it is about,
 *  so this page can never show one chatbot's visitor under another chatbot's name.
 *
 *  A row opens the visitor's canonical core session in a new host chat window; it never assembles its own URL. */

const PAGE_SIZE = 25;
/** The grid: the conversation, the address it came from, when it was last seen, how many turns, and what
 *  the last one did. The address shares the last activity's `wide` fate, so both vanish together below
 *  the desktop layout and the compact and mobile templates keep their four tracks. */
const COLUMNS = 'minmax(0,1.5fr) 9rem minmax(0,1fr) 4.5rem 7rem 1.25rem';
const COMPACT_COLUMNS = 'minmax(0,1.5fr) 4.5rem 7rem 1.25rem';
const MOBILE_COLUMNS = 'minmax(0,1fr) 2rem 5.5rem 1rem';

export function ConversationsSection() {
  const { components: C, hooks, utils } = runtime();
  const s = hooks.usePluginStrings('chatbot');
  const { locale } = hooks.useTranslation();
  const { toast } = hooks.useToast();
  const register = useChatbots();
  const bots = register.bots;
  // The section's own heading, worn by whichever card its state renders: the reader is told what this is
  // before being told what is missing or what it found.
  const heading = { title: s.sectionConversations, description: s.sectionConversationsHint, icon: MessagesSquare };

  const [selected, setSelected] = useState<number | null>(null);
  const [answer, setAnswer] = useState<ChatbotConversationsAnswer | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  // The one way to narrow the register: exactly one visitor, picked from the chatbot's own visitor list.
  // Null is every visitor.
  const [visitorId, setVisitorId] = useState<string | null>(null);
  const [visitors, setVisitors] = useState<ChatbotVisitorsAnswer | null>(null);
  const [visitorsError, setVisitorsError] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const visitorsSequence = useRef(0);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [eraseError, setEraseError] = useState<string | null>(null);
  // Erasing removes EVERY conversation of the chatbot, while a narrowed answer counts only one visitor's. The
  // confirmation would then name the wrong number, so erasing is offered on the whole register only.
  const filtering = visitorId !== null;
  // A visitor is named by the last address the host vouched for and the id their browser carries. An
  // address that was never kept is said to be unknown, never left out.
  const visitorLabel = (ip: string | null, id: string): string => `${ip ?? s.visitorIpUnknown} · ${id}`;

  // The first chatbot until the reader picks another, and back to a real one if the picked chatbot left
  // the register.
  const bot = bots.find((candidate) => candidate.chatbotUserId === selected) ?? bots[0] ?? null;
  const chatbotUserId = bot?.chatbotUserId ?? null;

  const load = useCallback(() => {
    const request = ++requestSequence.current;
    if (chatbotUserId === null) return;
    setLoadError(null);
    void apiJson<ChatbotConversationsAnswer>(chatbotApi.conversations({
      chatbotUserId,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      visitorId,
    }))
      .then((result) => { if (request === requestSequence.current) setAnswer(result); })
      .catch((error) => {
        if (request === requestSequence.current) setLoadError(utils.apiErrorMessage(error) || s.conversationsLoadError);
      });
  }, [chatbotUserId, page, s.conversationsLoadError, utils, visitorId]);

  // Who the register can be narrowed to. Read beside the register rather than before it: the picker is a
  // narrowing, so a register whose visitor list could not be read still shows every conversation.
  const loadVisitors = useCallback(() => {
    const request = ++visitorsSequence.current;
    if (chatbotUserId === null) return;
    setVisitorsError(null);
    void apiJson<ChatbotVisitorsAnswer>(chatbotApi.visitors(chatbotUserId))
      .then((result) => { if (request === visitorsSequence.current) setVisitors(result); })
      .catch((error) => {
        if (request === visitorsSequence.current) setVisitorsError(utils.apiErrorMessage(error) || s.visitorsLoadError);
      });
  }, [chatbotUserId, s.visitorsLoadError, utils]);

  // A new pick is a new register: its first page, and no row of the previous answer left on screen under a
  // visitor it does not belong to.
  const changeVisitor = (value: string) => {
    requestSequence.current += 1;
    setAnswer(null);
    setLoadError(null);
    setPage(0);
    setVisitorId(value === '' ? null : value);
  };

  // Another chatbot is another register: its first page, and nothing of the previous one left on screen
  // while the new read is in flight. A visitor pick and the visitor list belong to the same one-bot view.
  useEffect(() => {
    requestSequence.current += 1;
    setAnswer(null);
    setEraseError(null);
    setPage(0);
    setVisitorId(null);
    setVisitors(null);
  }, [chatbotUserId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadVisitors(); }, [loadVisitors]);

  const erase = async () => {
    if (chatbotUserId === null || deleting || filtering || answer === null || answer.total === 0) return;
    setDeleting(true);
    setEraseError(null);
    let deleted = 0;
    try {
      let remaining: number;
      do {
        const result = await apiJson<{ deleted: number; kept: number; remaining: number }>(
          chatbotApi.eraseConversations(chatbotUserId), { method: 'DELETE' },
        );
        deleted += result.deleted;
        remaining = result.remaining;
        if (result.deleted === 0) break;
      } while (remaining > 0);
      toast(remaining > 0
        ? s.conversationsEraseKept.replace('{deleted}', integer(deleted, locale)).replace('{kept}', integer(remaining, locale))
        : s.conversationsEraseDone.replace('{deleted}', integer(deleted, locale)));
    } catch (reason) {
      setEraseError(utils.apiErrorMessage(reason) || s.conversationsEraseError);
    } finally {
      setConfirming(false);
      setDeleting(false);
      setAnswer(null);
      setPage(0);
      if (page === 0) load();
      // The erased visitors are gone from the picker too.
      loadVisitors();
    }
  };

  const statusTone = (status: string): 'success' | 'danger' | 'warning' | undefined =>
    status === 'done' ? 'success' : status === 'error' ? 'danger' : 'warning';
  const statusLabel = (status: string): string => s[`turnStatus_${status}`] ?? status;

  // The register is this section's own precondition: there is nothing to read from until it arrives, and
  // "no chatbot yet" is a different answer from "not read yet" and from "could not be read".
  if (register.loadError !== null) {
    return <C.SettingsGroup {...heading}><C.ErrorState message={`${s.botsLoadError} — ${register.loadError}`} onRetry={register.reload} /></C.SettingsGroup>;
  }
  if (bot === null) {
    return (
      <C.SettingsGroup {...heading}>
        {register.isLoading
          ? <C.LoadingState variant="list" />
          : <C.EmptyState title={s.pickerNoBots} description={s.pickerNoBotsDescription} icon={MessagesSquare} />}
      </C.SettingsGroup>
    );
  }

  const emptyTitle = filtering ? s.conversationsVisitorGone : s.conversationsEmptyTitle;
  const emptyDescription = filtering ? s.conversationsVisitorGoneDescription : s.conversationsEmptyDescription;
  const body = loadError !== null ? <C.ErrorState message={`${s.conversationsLoadError} — ${loadError}`} onRetry={load} />
    : answer === null ? <C.LoadingState variant="list" />
      : answer.total === 0 ? <C.EmptyState title={emptyTitle} description={emptyDescription} icon={MessagesSquare} />
        : (
          <div className="settings-group__panel flex min-w-0 flex-col gap-3">
            <C.DataTable ariaLabel={s.conversationsTab} columns={COLUMNS} compactColumns={COMPACT_COLUMNS} mobileColumns={MOBILE_COLUMNS}>
              <C.DataTableRow header>
                <C.DataTableCell header lines={1}>{s.columnTitle}</C.DataTableCell>
                <C.DataTableCell header lines={1} priority="wide">{s.columnIp}</C.DataTableCell>
                <C.DataTableCell header lines={1} priority="wide">{s.columnLastSeen}</C.DataTableCell>
                <C.DataTableCell header lines={1}>{s.columnTurns}</C.DataTableCell>
                <C.DataTableCell header lines={1}>{s.columnLastTurn}</C.DataTableCell>
                <C.DataTableChevronCell />
              </C.DataTableRow>
              {answer.conversations.map((conversation) => (
                <C.DataTableRow
                  key={conversation.visitorId}
                  // The visitor, as the picker names them, is how a row is told apart from its namesakes and
                  // found again in the picker, so it stays one hover away on the whole row rather than taking
                  // the title's place.
                  title={visitorLabel(conversation.ip, conversation.visitorId)}
                  interactive={conversation.sessionId !== null}
                  onOpen={conversation.sessionId === null ? undefined : () => utils.openBrainSessionWindow(conversation.sessionId!)}
                  openLabel={conversation.sessionId === null ? undefined : s.openConversation.replace('{visitor}', conversation.visitorId)}
                >
                  <C.DataTableCell lines={1}>{conversation.title ?? s.conversationUntitled}</C.DataTableCell>
                  <C.DataTableCell lines={1} priority="wide" className="font-mono text-xs">{conversation.ip ?? s.visitorIpUnknown}</C.DataTableCell>
                  <C.DataTableCell lines={1} priority="wide">{formatDateTime(conversation.lastAt, locale)}</C.DataTableCell>
                  <C.DataTableCell lines={1}>
                    {integer(conversation.turns, locale)}
                    {conversation.errors > 0 ? <span className="ml-1 text-destructive">({integer(conversation.errors, locale)})</span> : null}
                  </C.DataTableCell>
                  <C.DataTableCell lines="auto">
                    <C.Badge tone={statusTone(conversation.lastStatus)}>{statusLabel(conversation.lastStatus)}</C.Badge>
                  </C.DataTableCell>
                  <C.DataTableChevronCell />
                </C.DataTableRow>
              ))}
            </C.DataTable>
            <C.Pager page={page} pageSize={PAGE_SIZE} total={answer.total} onPageChange={setPage} ariaLabel={s.conversationsTab} />
          </div>
        );

  return (
    <>
      <C.SettingsGroup {...heading} actions={(
        <>
          <div className="w-60 min-w-0 max-w-full">
            <C.ChoiceField
              picker="always"
              title={s.visitorFilter}
              manageAriaLabel={s.visitorFilter}
              value={visitorId ?? ''}
              onChange={changeVisitor}
              options={[
                { value: '', label: s.visitorAll },
                ...(visitors?.visitors ?? []).map((visitor) => ({ value: visitor.visitorId, label: visitorLabel(visitor.ip, visitor.visitorId) })),
              ]}
            />
          </div>
          <BotPicker bots={bots} value={bot.chatbotUserId} onChange={setSelected} label={s.pickerLabel} disabled={confirming || deleting} />
          <C.IconButton icon={Trash2} variant="danger" label={s.conversationsEraseAction}
            disabled={filtering || answer === null || answer.total === 0 || loadError !== null || deleting || confirming}
            onClick={() => { setEraseError(null); setConfirming(true); }} />
        </>
      )}>
        {eraseError !== null ? <p className="text-xs text-destructive" role="alert">{eraseError}</p> : null}
        {visitorsError !== null ? <p className="text-xs text-destructive" role="alert">{`${s.visitorsLoadError} — ${visitorsError}`}</p> : null}
        {visitors?.truncated === true
          ? <p className="text-xs text-muted-foreground">{s.visitorsTruncated.replace('{n}', integer(visitors.visitors.length, locale))}</p>
          : null}
        {deleting ? <C.LoadingLine label={s.conversationsErasing} layout="inline" /> : null}
        {body}
      </C.SettingsGroup>
      <C.ConfirmDialog
        open={confirming}
        title={s.conversationsEraseTitle}
        description={s.conversationsEraseDescription
          .replace('{bot}', bot.displayName || s.botFallback)
          .replace('{count}', integer(answer?.total ?? 0, locale))}
        confirmLabel={s.conversationsEraseConfirm}
        confirmVariant="danger"
        pending={deleting}
        onConfirm={() => void erase()}
        onClose={() => { if (!deleting) setConfirming(false); }}
      />
    </>
  );
}
