import { useEffect, useState } from 'react';
import {
  BadgeCheck, Bot, Check, ChevronRight, ClipboardCopy, Code2, Gauge, Palette, Power, Save, ShieldCheck,
} from 'lucide-react';
import { LIMIT_FIELDS } from '../src/limits';
import { apiJson, chatbotApi, jsonRequest, runtime } from './runtime';
import { formatDateTime } from './format';
import { OriginsField } from './OriginsField';
import { LimitsModal, limitDraftOf, readLimitDraft, type LimitDraft } from './LimitsModal';
import { AppearanceModal } from './AppearanceModal';
import type { ChatbotBotView } from './types';

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
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<'enable' | 'disable' | 'discard' | null>(null);
  const [opened, setOpened] = useState<'limits' | 'appearance' | null>(null);

  useEffect(() => {
    setOrigins(bot.origins);
    setLimits(limitDraftOf(bot.limits));
    setMaySubmitForms(bot.maySubmitForms);
  }, [bot.updatedAt, bot.origins, bot.limits, bot.maySubmitForms]);

  const read = readLimitDraft(limits);
  const originalLimits = limitDraftOf(bot.limits);
  const dirty = origins.join('\n') !== bot.origins.join('\n')
    || LIMIT_FIELDS.some((field) => limits[field] !== originalLimits[field])
    || maySubmitForms !== bot.maySubmitForms;
  const blockers = blockerText(bot.blockers, bot.projects.length, s);
  const invalid = read.invalid.length > 0;
  const enableBlocked = invalid || read.missing.length > 0;
  const saveBlocked = invalid || (bot.status === 'enabled' && read.missing.length > 0);

  const save = async (action: 'enable' | 'disable' | null) => {
    setPending(true);
    setError(null);
    try {
      const answer = await apiJson<{ bot: ChatbotBotView }>(chatbotApi.bots(), jsonRequest('PATCH', {
        chatbotUserId: bot.chatbotUserId,
        expectedUpdatedAt: bot.updatedAt,
        displayName: bot.displayName,
        origins,
        limits: read.limits,
        maySubmitForms,
        ...(action === null ? {} : { action }),
      }));
      onChanged(answer.bot);
      setConfirming(null);
    } catch (reason) {
      setError(utils.apiErrorMessage(reason) || unknownError);
    } finally {
      setPending(false);
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

  const leave = () => { if (dirty) setConfirming('discard'); else onClose(); };

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
          </C.SettingsGroup>

          <OriginsField origins={origins} insecure={bot.insecureOrigins} disabled={pending} onChange={setOrigins} />

          <C.SettingsGroup title={s.appearanceTitle} icon={Palette} density="compact">
            <C.SettingsRow
              label={s.appearanceAction}
              actions={<C.IconButton icon={ChevronRight} label={s.appearanceAction} disabled={pending} onClick={() => setOpened('appearance')} />}
            />
            {bot.embedSnippet === null ? null : (
              <C.SettingsRow
                label={s.embedTitle}
                description={s.embedHint}
                icon={Code2}
                status={<code className="block max-w-44 truncate text-[11px]">{bot.embedSnippet}</code>}
                actions={<C.IconButton icon={ClipboardCopy} label={s.embedCopy} onClick={() => void copySnippet()} />}
              />
            )}
          </C.SettingsGroup>

          <C.SettingsGroup title={s.limitsTitle} hint={s.limitsHint} icon={Gauge} density="compact">
            <C.SettingsRow
              label={s.limitsEdit}
              status={enableBlocked ? <C.Badge tone="warning">{s.statusAttention}</C.Badge> : null}
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
          <C.Button variant="outline" icon={Power} disabled={pending || dirty || enableBlocked} onClick={() => setConfirming('enable')}>{s.enableAction}</C.Button>
        )}
        <C.Button variant="accent" icon={dirty ? Save : Check} disabled={pending || !dirty || saveBlocked} onClick={() => void save(null)}>
          {pending ? s.saveSaving : s.saveAction}
        </C.Button>
      </C.ModalFooter>

      <C.ConfirmDialog
        open={confirming !== null}
        title={confirming === 'enable' ? s.enableTitle : confirming === 'disable' ? s.disableTitle : s.discardTitle}
        description={confirming === 'enable' ? s.enableBody : confirming === 'disable' ? s.disableBody : s.discardBody}
        confirmLabel={confirming === 'enable' ? s.enableConfirm : confirming === 'disable' ? s.disableConfirm : s.discardConfirm}
        confirmVariant={confirming === 'enable' ? 'accent' : 'danger'}
        pending={pending}
        onConfirm={() => { if (confirming === 'discard') onClose(); else void save(confirming); }}
        onClose={() => setConfirming(null)}
      />

      {opened === 'limits' ? (
        <LimitsModal draft={limits} disabled={pending} onChange={setLimits} onClose={() => setOpened(null)} />
      ) : null}
      {opened === 'appearance' ? (
        <AppearanceModal bot={bot} onClose={() => setOpened(null)} onChanged={onChanged} />
      ) : null}
    </C.Modal>
  );
}
