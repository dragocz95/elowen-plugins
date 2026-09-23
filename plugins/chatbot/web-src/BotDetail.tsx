import { useEffect, useRef, useState } from 'react';
import {
  BadgeCheck, Bot, ChevronRight, ClipboardCopy, Gauge, Palette, Power, ShieldCheck,
} from 'lucide-react';
import { LIMIT_FIELDS } from '../src/limits';
import { apiJson, chatbotApi, jsonRequest, runtime } from './runtime';
import { formatDateTime } from './format';
import { OriginsField } from './OriginsField';
import { LimitsModal, limitDraftOf, type LimitDraft } from './LimitsModal';
import { BudgetUsage } from './BudgetUsage';
import { AppearanceModal } from './AppearanceModal';
import { switchToAccount } from './accountSwitch';
import type { ChatbotBotView, ChatbotModelView } from './types';

/** What decided the model this chatbot's visitors are answered by, in the row's own words. Three sources,
 *  three statements: the account's own pick, the instance default it fell back to, and — the case that must
 *  never be called inheritance — a model the account's allow-list forced it onto. Exported because naming the
 *  source IS the row's whole claim, and the one place that claim is made. */
export function modelSourceText(model: ChatbotModelView, s: Record<string, string>): string {
  if (model.source === 'preference') return s.detailModelSourcePreference;
  return model.source === 'instance' ? s.detailModelSourceInstance : s.detailModelSourceAllowed;
}

export function blockerText(blockers: string[], projectCount: number, s: Record<string, string>): string[] {
  return blockers.map((blocker) => {
    if (blocker === 'account_unknown') return s.accountUnknown;
    if (blocker === 'account_not_chatbot') return s.accountNotChatbot;
    if (blocker === 'account_admin') return s.accountAdmin;
    if (blocker === 'several_projects') return s.detailProjectSeveral.replace('{count}', String(projectCount));
    return s.detailProjectNone;
  });
}

export function statusText(bot: ChatbotBotView, s: Record<string, string>): string {
  if (bot.blockers.length > 0) return s.statusAttention;
  return bot.status === 'enabled' ? s.statusEnabled : bot.status === 'disabled' ? s.statusDisabled : s.statusDraft;
}

export function BotDetail({ bot, onChanged, unknownError, onClose }: {
  bot: ChatbotBotView;
  onChanged(bot: ChatbotBotView): void;
  unknownError: string;
  onClose(): void;
}) {
  const { components: C, hooks, utils } = runtime();
  const s = hooks.usePluginStrings('chatbot');
  const { locale, t } = hooks.useTranslation();
  const { toast } = hooks.useToast();
  const [origins, setOrigins] = useState<string[]>(bot.origins);
  const [limits, setLimits] = useState<LimitDraft>(() => limitDraftOf(bot.limits));
  const [maySubmitForms, setMaySubmitForms] = useState(bot.maySubmitForms);
  const [pending, setPending] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<'enable' | 'disable' | null>(null);
  const [opened, setOpened] = useState<'limits' | 'appearance' | null>(null);
  const [openingAppearance, setOpeningAppearance] = useState(false);
  const expectedUpdatedAt = useRef(bot.updatedAt);

  useEffect(() => {
    expectedUpdatedAt.current = bot.updatedAt;
    setOrigins(bot.origins);
    setLimits(limitDraftOf(bot.limits));
    setMaySubmitForms(bot.maySubmitForms);
  }, [bot.updatedAt, bot.origins, bot.limits, bot.maySubmitForms]);

  const originalLimits = limitDraftOf(bot.limits);
  const dirty = origins.join('\n') !== bot.origins.join('\n')
    || LIMIT_FIELDS.some((field) => limits[field] !== originalLimits[field])
    || maySubmitForms !== bot.maySubmitForms;
  const blockers = blockerText(bot.blockers, bot.projects.length, s);

  const save = async (action: 'enable' | 'disable' | null): Promise<boolean> => {
    setPending(true);
    setError(null);
    try {
      const answer = await apiJson<{ bot: ChatbotBotView }>(chatbotApi.bots(), jsonRequest('PATCH', {
        chatbotUserId: bot.chatbotUserId,
        expectedUpdatedAt: expectedUpdatedAt.current,
        displayName: bot.displayName,
        origins,
        limits,
        maySubmitForms,
        ...(action === null ? {} : { action }),
      }));
      expectedUpdatedAt.current = answer.bot.updatedAt;
      onChanged(answer.bot);
      setConfirming(null);
      return true;
    } catch (reason) {
      setError(utils.apiErrorMessage(reason) || unknownError);
      return false;
    } finally {
      setPending(false);
    }
  };

  const autosave = hooks.useAutoSaveStatus([origins, limits, maySubmitForms], async () => {
    if (dirty && !(await save(null))) throw new Error(error ?? unknownError);
  }, { savable: dirty, delay: 900 });

  const openAppearance = async () => {
    setOpeningAppearance(true);
    try {
      if (await autosave.flush() !== 'error') setOpened('appearance');
    } finally {
      setOpeningAppearance(false);
    }
  };

  const copySnippet = async () => {
    if (bot.embedSnippet === null) return;
    try {
      await navigator.clipboard.writeText(bot.embedSnippet);
      toast(s.embedCopied);
    } catch {
      toast(s.embedCopyFailed, 'error');
    }
  };

  /** Enter this chatbot's own account, which is where its model is changed. The host runs the switch and
   *  takes the page over from there; a refusal is reported here like any other failed action. */
  const switchAccount = async () => {
    setError(null);
    setSwitching(true);
    try {
      await switchToAccount(bot.chatbotUserId);
    } catch (reason) {
      setError(utils.apiErrorMessage(reason) || s.detailModelSwitchFailed);
      setSwitching(false);
    }
  };

  const leave = onClose;

  return (
    <C.Modal
      title={bot.displayName || s.botFallback}
      description={bot.publicId}
      icon={Bot}
      size="md"
      presentation="drawer"
      closeLabel={t.common.close}
      closeDisabled={pending}
      {...(pending ? { 'aria-busy': true as const } : {})}
      onClose={leave}
    >
      <C.ModalBody>
        <div className="flex flex-col gap-4">
          {blockers.map((text) => <p key={text} className="text-xs text-destructive" role="alert">{text}</p>)}

          <C.SettingsGroup title={s.detailFactsTitle} icon={BadgeCheck} columns={2} density="compact">
            <C.SettingsRow label={s.detailName} status={bot.displayName || s.botFallback} />
            <C.SettingsRow label={s.detailAccount} status={bot.account === null ? '—' : `@${bot.account.username}`} />
            <C.SettingsRow label={s.detailProject} status={bot.projects.length === 1 ? bot.projects[0]!.slug : '—'} />
            <C.SettingsRow label={s.detailUpdated} status={formatDateTime(bot.updatedAt, locale)} />
            {/* The model the visitor's answer comes from, as core resolves it for the account, plus what
                decided it. It belongs to the ACCOUNT, so this row states it and hands the reader to that
                account — the one place that can change it, and the only one: this page has no model of its
                own to write and no route to write it through.
                A model core did not name is stated in the same place as the others, not left as a blank the
                reader has to interpret: the payload's null is a fact — an account core does not know, an
                instance with no provider, or an account permitted no configured model — and the row says so. */}
            <C.SettingsRow
              label={s.detailModel}
              status={(
                <span className="flex min-w-0 items-center gap-2">
                  <C.Badge tone={bot.model?.source === 'allowed' ? 'accent' : 'muted'}>
                    {bot.model === null ? s.detailModelUnnamed : modelSourceText(bot.model, s)}
                  </C.Badge>
                  {bot.model === null ? null : (
                    <span className="truncate font-mono" title={bot.model.exec}>{bot.model.exec}</span>
                  )}
                </span>
              )}
              actions={(
                <C.IconButton
                  icon={ChevronRight}
                  label={s.detailModelChange}
                  disabled={pending || switching}
                  onClick={() => void switchAccount()}
                />
              )}
            />
          </C.SettingsGroup>

          <OriginsField origins={origins} insecure={bot.insecureOrigins} disabled={pending} onChange={setOrigins} />

          <C.SettingsGroup title={s.appearanceTitle} icon={Palette} density="compact">
            <C.SettingsRow
              label={s.appearanceAction}
              actions={<C.IconButton icon={ChevronRight} label={s.appearanceAction} disabled={pending || openingAppearance} onClick={() => void openAppearance()} />}
            />
            {bot.embedSnippet === null ? null : (
              <C.SettingsRow
                label={s.embedTitle}
                description={s.embedHint}
                status={<code className="block max-w-44 truncate text-caption">{bot.embedSnippet}</code>}
                actions={<C.IconButton icon={ClipboardCopy} label={s.embedCopy} onClick={() => void copySnippet()} />}
              />
            )}
          </C.SettingsGroup>

          <C.SettingsGroup title={s.budgetTitle} icon={Gauge}>
            <BudgetUsage bot={bot} />
          </C.SettingsGroup>

          <C.SettingsGroup title={s.limitsTitle} hint={s.limitsHint} icon={Gauge} density="compact">
            <C.SettingsRow
              label={s.limitsEdit}
              actions={<C.IconButton icon={ChevronRight} label={s.limitsEdit} disabled={pending} onClick={() => setOpened('limits')} />}
            />
          </C.SettingsGroup>

          <C.SettingsGroup title={s.pageActionsTitle} icon={ShieldCheck} density="compact">
            <C.SettingsRow
              label={s.maySubmitFormsLabel}
              description={s.maySubmitFormsHint}
              control={<C.Toggle checked={maySubmitForms} onChange={setMaySubmitForms} label={s.maySubmitFormsLabel} disabled={pending} />}
            />
          </C.SettingsGroup>

          <C.SettingsGroup density="compact">
            <C.SettingsRow
              label={s.sensitiveTitle}
              description={s.sensitiveBody}
              status={<C.Badge tone="muted">{s.sensitiveUnavailable}</C.Badge>}
            />
          </C.SettingsGroup>

          {error !== null ? <p className="text-xs text-destructive" role="alert">{error}</p> : null}
        </div>
      </C.ModalBody>

      <C.ModalFooter>
        {bot.status === 'enabled' ? (
          <C.Button variant="ghost" icon={Power} disabled={pending} onClick={() => setConfirming('disable')}>{s.disableAction}</C.Button>
        ) : (
          <C.Button variant="outline" icon={Power} disabled={pending || dirty} onClick={() => setConfirming('enable')}>{s.enableAction}</C.Button>
        )}
        <C.AutoSaveStatus status={autosave.status} onRetry={autosave.retry} />
      </C.ModalFooter>

      <C.ConfirmDialog
        open={confirming !== null}
        title={confirming === 'enable' ? s.enableTitle : s.disableTitle}
        description={confirming === 'enable' ? s.enableBody : s.disableBody}
        confirmLabel={confirming === 'enable' ? s.enableConfirm : s.disableConfirm}
        confirmVariant={confirming === 'enable' ? 'accent' : 'danger'}
        pending={pending || autosave.status === 'saving'}
        onConfirm={() => {
          const action = confirming;
          if (action === null) return;
          void (async () => {
            if (await autosave.flush() !== 'error') await save(action);
          })();
        }}
        onClose={() => setConfirming(null)}
      />

      {opened === 'limits' ? (
        <LimitsModal draft={limits} disabled={pending} onChange={setLimits} onClose={() => setOpened(null)} />
      ) : null}
      {opened === 'appearance' ? (
        <AppearanceModal key={bot.chatbotUserId} bot={bot} onClose={() => setOpened(null)} onChanged={onChanged} />
      ) : null}
    </C.Modal>
  );
}
