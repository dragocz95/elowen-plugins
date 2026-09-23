import { useCallback, useEffect, useState } from 'react';
import { MessagesSquare, Trash2 } from 'lucide-react';
import { apiJson, chatbotApi, runtime } from './runtime';
import { BotPicker } from './BotPicker';
import { useChatbots } from './useChatbots';
import { formatDateTime, integer } from './format';
import type { ChatbotConversationsAnswer } from './types';

/** THE CONVERSATIONS SECTION: who talked to one chatbot, and what was said.
 *
 *  It reads metadata only. A visitor's own words are read for ONE conversation at a time, which is what
 *  keeps this a register rather than a transcript dump, and every request names the chatbot it is about,
 *  so this page can never show one chatbot's visitor under another chatbot's name.
 *
 *  A row opens the visitor's canonical core session in a new host chat window; it never assembles its own URL. */

const PAGE_SIZE = 25;
/** The grid: the visitor, when it was last seen, how many turns, and what the last one did. */
const COLUMNS = 'minmax(0,1.5fr) minmax(0,1fr) 4.5rem 7rem 1.25rem';
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
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [eraseError, setEraseError] = useState<string | null>(null);

  // The first chatbot until the reader picks another, and back to a real one if the picked chatbot left
  // the register.
  const bot = bots.find((candidate) => candidate.chatbotUserId === selected) ?? bots[0] ?? null;
  const chatbotUserId = bot?.chatbotUserId ?? null;

  const load = useCallback(() => {
    if (chatbotUserId === null) return;
    setLoadError(null);
    void apiJson<ChatbotConversationsAnswer>(chatbotApi.conversations({ chatbotUserId, limit: PAGE_SIZE, offset: page * PAGE_SIZE }))
      .then(setAnswer)
      .catch((error) => setLoadError(utils.apiErrorMessage(error) || s.conversationsLoadError));
  }, [chatbotUserId, page, s.conversationsLoadError, utils]);

  // Another chatbot is another register: its first page, and nothing of the previous one left on screen
  // while the new read is in flight.
  useEffect(() => {
    setAnswer(null);
    setEraseError(null);
    setPage(0);
  }, [chatbotUserId]);

  useEffect(() => { load(); }, [load]);

  const erase = async () => {
    if (chatbotUserId === null || deleting || answer === null || answer.total === 0) return;
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

  const body = loadError !== null ? <C.ErrorState message={`${s.conversationsLoadError} — ${loadError}`} onRetry={load} />
    : answer === null ? <C.LoadingState variant="list" />
      : answer.total === 0 ? <C.EmptyState title={s.conversationsEmptyTitle} description={s.conversationsEmptyDescription} icon={MessagesSquare} />
        : (
          <div className="settings-group__panel flex min-w-0 flex-col gap-3">
            <C.DataTable ariaLabel={s.conversationsTab} columns={COLUMNS} compactColumns={COMPACT_COLUMNS} mobileColumns={MOBILE_COLUMNS}>
              <C.DataTableRow header>
                <C.DataTableCell header lines={1}>{s.columnVisitor}</C.DataTableCell>
                <C.DataTableCell header lines={1} priority="wide">{s.columnLastSeen}</C.DataTableCell>
                <C.DataTableCell header lines={1}>{s.columnTurns}</C.DataTableCell>
                <C.DataTableCell header lines={1}>{s.columnLastTurn}</C.DataTableCell>
                <C.DataTableChevronCell />
              </C.DataTableRow>
              {answer.conversations.map((conversation) => (
                <C.DataTableRow
                  key={conversation.visitorId}
                  interactive={conversation.sessionId !== null}
                  onOpen={conversation.sessionId === null ? undefined : () => utils.openBrainSessionWindow(conversation.sessionId!)}
                  openLabel={conversation.sessionId === null ? undefined : s.openConversation.replace('{visitor}', conversation.visitorId)}
                >
                  <C.DataTableCell lines={1} title={conversation.visitorId} className="font-mono text-xs">{conversation.visitorId}</C.DataTableCell>
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
          <BotPicker bots={bots} value={bot.chatbotUserId} onChange={setSelected} label={s.pickerLabel} disabled={confirming || deleting} />
          <C.IconButton icon={Trash2} variant="danger" label={s.conversationsEraseAction}
            disabled={answer === null || answer.total === 0 || loadError !== null || deleting || confirming}
            onClick={() => { setEraseError(null); setConfirming(true); }} />
        </>
      )}>
        {eraseError !== null ? <p className="text-xs text-destructive" role="alert">{eraseError}</p> : null}
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
