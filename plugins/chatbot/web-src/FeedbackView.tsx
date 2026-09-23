import { useEffect, useRef, useState } from 'react';
import { MessageSquareHeart, ThumbsDown, ThumbsUp } from 'lucide-react';
import { apiJson, chatbotApi, runtime } from './runtime';
import { useChatbots } from './useChatbots';
import { formatDateTime, integer } from './format';
import type { ChatbotFeedbackAnswer } from './types';

const PAGE_SIZE = 25;
const COLUMNS = '8rem 4rem minmax(0,1.7fr) minmax(0,1fr) 8rem 1.25rem';
const MOBILE_COLUMNS = '3rem minmax(0,1fr) 1rem';
const HIDE_MOBILE = '@max-[40rem]:hidden';

export function FeedbackSection() {
  const { components: C, hooks, utils } = runtime();
  const s = hooks.usePluginStrings('chatbot');
  const { locale } = hooks.useTranslation();
  const register = useChatbots();
  const [chatbotUserId, setChatbotUserId] = useState<number | null>(null);
  const [rating, setRating] = useState<'all' | 'up' | 'down'>('all');
  const [page, setPage] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [answer, setAnswer] = useState<ChatbotFeedbackAnswer | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const heading = { title: s.sectionFeedback, description: s.sectionFeedbackHint, icon: MessageSquareHeart };

  useEffect(() => {
    const request = ++requestSequence.current;
    setAnswer(null);
    setLoadError(null);
    if (register.isLoading || register.loadError !== null) return;
    void apiJson<ChatbotFeedbackAnswer>(chatbotApi.feedback({
      chatbotUserId, rating, limit: PAGE_SIZE, offset: page * PAGE_SIZE,
    })).then((result) => {
      if (request === requestSequence.current) setAnswer(result);
    }).catch((error) => {
      if (request === requestSequence.current) setLoadError(utils.apiErrorMessage(error) || s.feedbackLoadError);
    });
  }, [chatbotUserId, page, rating, refresh, register.isLoading, register.loadError, s.feedbackLoadError, utils]);

  if (register.loadError) {
    return <C.SettingsGroup {...heading}><C.ErrorState message={register.loadError} onRetry={register.reload} /></C.SettingsGroup>;
  }
  if (register.isLoading || register.bots.length === 0) {
    return <C.SettingsGroup {...heading}>{register.isLoading
      ? <C.LoadingState variant="list" />
      : <C.EmptyState title={s.pickerNoBots} description={s.pickerNoBotsDescription} icon={MessageSquareHeart} />}
    </C.SettingsGroup>;
  }

  const body = loadError
    ? <C.ErrorState message={loadError} onRetry={() => setRefresh((current) => current + 1)} />
    : answer === null ? <C.LoadingState variant="list" />
      : answer.totals.total === 0 ? <C.EmptyState title={s.feedbackEmpty} description={s.feedbackEmptyHint} icon={MessageSquareHeart} />
        : <div className="settings-group__panel flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <C.Badge tone="success"><ThumbsUp size={14} aria-hidden="true" /> {s.feedbackTotalUp.replace('{count}', integer(answer.totals.up, locale))}</C.Badge>
            <C.Badge tone="danger"><ThumbsDown size={14} aria-hidden="true" /> {s.feedbackTotalDown.replace('{count}', integer(answer.totals.down, locale))}</C.Badge>
          </div>
          <C.DataTable ariaLabel={s.sectionFeedback} columns={COLUMNS} compactColumns={COLUMNS} mobileColumns={MOBILE_COLUMNS}>
            <C.DataTableRow header>
              <C.DataTableCell header lines={1} className={HIDE_MOBILE}>{s.feedbackBotFilter}</C.DataTableCell>
              <C.DataTableCell header lines={1}>{s.feedbackRatingFilter}</C.DataTableCell>
              <C.DataTableCell header lines={1}>{s.feedbackAnswer}</C.DataTableCell>
              <C.DataTableCell header lines={1} className={HIDE_MOBILE}>{s.feedbackComment}</C.DataTableCell>
              <C.DataTableCell header lines={1} className={HIDE_MOBILE}>{s.feedbackUpdated}</C.DataTableCell>
              <C.DataTableChevronCell />
            </C.DataTableRow>
            {answer.rows.map((row) => {
              const Icon = row.rating === 'up' ? ThumbsUp : ThumbsDown;
              const label = row.rating === 'up' ? s.feedbackUp : s.feedbackDown;
              return <C.DataTableRow key={row.turnId} interactive={row.sessionId !== null}
                onOpen={row.sessionId === null ? undefined : () => utils.openBrainSessionWindow(row.sessionId!)}
                openLabel={row.sessionId === null ? undefined : s.feedbackOpen.replace('{visitor}', row.visitorId)}
                title={row.message}>
                <C.DataTableCell lines={1} className={HIDE_MOBILE}>{row.chatbotName || s.botFallback}</C.DataTableCell>
                <C.DataTableCell lines={1}><span title={label} aria-label={label}><Icon size={18} aria-hidden="true" /></span></C.DataTableCell>
                <C.DataTableCell lines="auto">
                  <span className="block truncate" title={row.reply}>{row.reply}</span>
                  <span className="@min-[40rem]:hidden text-xs text-muted-foreground">{row.chatbotName || s.botFallback} · {formatDateTime(row.updatedAt, locale)}</span>
                  {row.comment ? <span className="@min-[40rem]:hidden block text-xs text-muted-foreground">{row.comment}</span> : null}
                </C.DataTableCell>
                <C.DataTableCell lines="auto" className={HIDE_MOBILE}>{row.comment ?? '—'}</C.DataTableCell>
                <C.DataTableCell lines={1} className={HIDE_MOBILE}>{formatDateTime(row.updatedAt, locale)}</C.DataTableCell>
                <C.DataTableChevronCell />
              </C.DataTableRow>;
            })}
          </C.DataTable>
          <C.Pager page={page} pageSize={PAGE_SIZE} total={answer.totals.total} onPageChange={setPage} ariaLabel={s.sectionFeedback} />
        </div>;

  return <C.SettingsGroup {...heading} actions={<div className="flex flex-wrap items-center gap-2">
    <C.SelectMenu label={s.feedbackBotFilter} variant="line" value={chatbotUserId === null ? '' : String(chatbotUserId)}
      onChange={(value: string) => { setChatbotUserId(value === '' ? null : Number(value)); setPage(0); }}
      options={[{ value: '', label: s.feedbackAllBots }, ...register.bots.map(bot => ({
        value: String(bot.chatbotUserId), label: bot.displayName || s.botFallback,
      }))]} />
    <C.SelectMenu label={s.feedbackRatingFilter} variant="line" value={rating}
      onChange={(value: string) => { if (value === 'all' || value === 'up' || value === 'down') { setRating(value); setPage(0); } }}
      options={[{ value: 'all', label: s.feedbackAllRatings }, { value: 'up', label: s.feedbackUp }, { value: 'down', label: s.feedbackDown }]} />
  </div>}>
    {body}
  </C.SettingsGroup>;
}
