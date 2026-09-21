import { useCallback, useEffect, useState } from 'react';
import { MessagesSquare } from 'lucide-react';
import { apiJson, chatbotApi, runtime } from './runtime';
import { formatDateTime, integer } from './format';
import type { ChatbotBotView, ChatbotConversationView, ChatbotConversationsAnswer, ChatbotTranscriptAnswer } from './types';

/** This chatbot's conversations, one page at a time, and one conversation on demand.
 *
 *  The register reads metadata only: a visitor's own words are read for ONE conversation at a time, which
 *  is what keeps this surface a register rather than a transcript dump. Every request names the chatbot it
 *  is about, so a page cannot show one chatbot's visitor under another chatbot's heading. */

const PAGE_SIZE = 25;
/** The grid: the visitor, when it started and when it was last seen, how many turns, and what the last one
 *  did. Narrow screens drop the two timestamps, which are the least urgent facts about a conversation. */
const COLUMNS = 'minmax(0,1.5fr) minmax(0,1fr) minmax(0,1fr) 4.5rem 7rem 1.25rem';
const COMPACT_COLUMNS = 'minmax(0,1.5fr) minmax(0,1fr) 4.5rem 7rem 1.25rem';
const MOBILE_COLUMNS = 'minmax(0,1fr) 4.5rem 1.25rem';

export function ConversationsView({ bot }: { bot: ChatbotBotView }) {
  const { components: C, hooks, utils } = runtime();
  const s = hooks.usePluginStrings('chatbot');
  const { locale } = hooks.useTranslation();

  const [answer, setAnswer] = useState<ChatbotConversationsAnswer | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<ChatbotConversationView | null>(null);

  // A different chatbot is a different register: another page of it, and nothing open over it.
  useEffect(() => {
    setPage(0);
    setOpen(null);
    setAnswer(null);
    setLoadError(null);
  }, [bot.chatbotUserId]);

  const load = useCallback(() => {
    setLoadError(null);
    void apiJson<ChatbotConversationsAnswer>(chatbotApi.conversations({
      chatbotUserId: bot.chatbotUserId,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }))
      .then(setAnswer)
      .catch((error) => setLoadError(utils.apiErrorMessage(error) || s.conversationsLoadError));
  }, [bot.chatbotUserId, page, s.conversationsLoadError, utils]);

  useEffect(() => { load(); }, [load]);

  if (loadError !== null) {
    return <C.ErrorState message={`${s.conversationsLoadError} — ${loadError}`} onRetry={load} />;
  }
  if (answer === null) {
    return <C.LoadingState variant="list" />;
  }
  if (answer.total === 0) {
    return <C.EmptyState title={s.conversationsEmptyTitle} description={s.conversationsEmptyDescription} icon={MessagesSquare} />;
  }

  const statusTone = (status: string): 'success' | 'danger' | 'warning' | undefined =>
    status === 'done' ? 'success' : status === 'error' ? 'danger' : 'warning';
  const statusLabel = (status: string): string => s[`turnStatus_${status}`] ?? status;

  return (
    <>
      <C.DataTable ariaLabel={s.conversationsTab} columns={COLUMNS} compactColumns={COMPACT_COLUMNS} mobileColumns={MOBILE_COLUMNS}>
        <C.DataTableRow header>
          <C.DataTableCell header lines={1}>{s.columnVisitor}</C.DataTableCell>
          <C.DataTableCell header lines={1} priority="wide">{s.columnFirstSeen}</C.DataTableCell>
          <C.DataTableCell header lines={1} priority="wide">{s.columnLastSeen}</C.DataTableCell>
          <C.DataTableCell header lines={1}>{s.columnTurns}</C.DataTableCell>
          <C.DataTableCell header lines={1}>{s.columnLastTurn}</C.DataTableCell>
          <C.DataTableChevronCell />
        </C.DataTableRow>
        {answer.conversations.map((conversation) => (
          <C.DataTableRow
            key={conversation.visitorId}
            height="tall"
            onOpen={() => setOpen(conversation)}
            openLabel={s.openConversation.replace('{visitor}', conversation.visitorId)}
          >
            <C.DataTableCell lines={1} title={conversation.visitorId} className="font-mono text-xs">{conversation.visitorId}</C.DataTableCell>
            <C.DataTableCell lines={1} priority="wide">{formatDateTime(conversation.firstAt, locale)}</C.DataTableCell>
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
      <C.Pager
        page={page}
        pageSize={PAGE_SIZE}
        total={answer.total}
        onPageChange={setPage}
        ariaLabel={s.conversationsTab}
      />
      {open === null ? null : (
        <TranscriptModal bot={bot} conversation={open} onClose={() => setOpen(null)} />
      )}
    </>
  );
}

/** One conversation, as the plugin recorded it: what the visitor wrote and what the plugin answered. The
 *  model's tool calls and its reasoning are core transcript and are deliberately not part of this read. */
function TranscriptModal({ bot, conversation, onClose }: {
  bot: ChatbotBotView;
  conversation: ChatbotConversationView;
  onClose(): void;
}) {
  const { components: C, hooks, utils } = runtime();
  const s = hooks.usePluginStrings('chatbot');
  const { locale } = hooks.useTranslation();
  const [answer, setAnswer] = useState<ChatbotTranscriptAnswer | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoadError(null);
    void apiJson<ChatbotTranscriptAnswer>(chatbotApi.conversation({
      chatbotUserId: bot.chatbotUserId,
      visitorId: conversation.visitorId,
    }))
      .then(setAnswer)
      .catch((error) => setLoadError(utils.apiErrorMessage(error) || s.transcriptLoadError));
  }, [bot.chatbotUserId, conversation.visitorId, s.transcriptLoadError, utils]);

  useEffect(() => { load(); }, [load]);

  const statusLabel = (status: string): string => s[`turnStatus_${status}`] ?? status;

  return (
    <C.Modal
      size="lg"
      title={s.transcriptTitle}
      description={conversation.visitorId}
      onClose={onClose}
      closeLabel={s.cancel}
    >
      <C.ModalBody>
        {loadError !== null ? <C.ErrorState message={`${s.transcriptLoadError} — ${loadError}`} onRetry={load} />
          : answer === null ? <C.LoadingLine layout="block" />
            : answer.turns.length === 0 ? <C.EmptyState title={s.transcriptEmptyTitle} description={s.transcriptEmptyDescription} icon={MessagesSquare} />
              : (
                <ol className="flex flex-col gap-4" aria-label={s.transcriptTitle}>
                  {answer.turns.map((turn) => (
                    <li key={turn.turnId} className="rounded-xl border border-border bg-card p-3">
                      <p className="text-[11px] uppercase tracking-wide text-subtle-foreground">
                        {formatDateTime(turn.at, locale)} · {statusLabel(turn.status)}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{turn.visitorText}</p>
                      {turn.reply === null ? (
                        <p className="mt-2 text-xs italic text-muted-foreground">
                          {turn.errorCode === null ? s.transcriptNoReply : `${s.transcriptFailed}: ${turn.errorCode}`}
                        </p>
                      ) : (
                        <p className="mt-2 whitespace-pre-wrap rounded-lg bg-muted/40 p-2 text-sm text-muted-foreground">{turn.reply}</p>
                      )}
                    </li>
                  ))}
                </ol>
              )}
      </C.ModalBody>
      <C.ModalFooter>
        <C.Button variant="ghost" onClick={onClose}>{s.cancel}</C.Button>
      </C.ModalFooter>
    </C.Modal>
  );
}
