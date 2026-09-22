import { useCallback, useEffect, useState } from 'react';
import {
  BadgeCheck, Bot, Check, ChevronRight, ClipboardCopy, Code2, Gauge,
  MessageSquareText, Palette, Power, Save,
} from 'lucide-react';
import { LIMIT_FIELDS } from '../src/limits';
import { apiJson, chatbotApi, jsonRequest, runtime, type AccountToolRow } from './runtime';
import { formatDateTime } from './format';
import { SecuritySettings, actionRuleKey } from './SecuritySettings';
import { OriginsField } from './OriginsField';
import { LimitsModal, limitDraftOf, readLimitDraft, type LimitDraft } from './LimitsModal';
import { AppearanceModal } from './AppearanceModal';
import type { ChatbotActionRuleView, ChatbotBotView } from './types';

/** One chatbot's configuration, in the drawer its row opens.
 *
 *  Everything here is one of the host's settings records: a card of facts, a card per decision, and a
 *  window for each thing that is a list or a set of numbers. Nothing on this surface is a table of its own
 *  any more, and nothing states a rule twice.
 *
 *  Every field is saved as a whole, on an explicit click: the row's `updatedAt` is the concurrency token,
 *  so a debounced autosave would race another administrator's edit for no benefit, and `Enable` must never
 *  be the side effect of a keystroke. Closing with unsaved edits asks first, because a drawer that
 *  discarded typed instructions on a stray click would be the worst thing on this surface. */

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

/** Which of the tools this chatbot's turns NEED its account cannot reach.
 *
 *  This is all that is left of what used to be a whole section listing every tool of the account with its
 *  state. The grants belong to the Users screen, which owns that rule, so a read-only table of them here
 *  was a second telling of somebody else's page. What an administrator cannot learn anywhere else is this
 *  one fact: a chatbot without the page-action tool answers visitors and can touch nothing on their page.
 *  So that fact stays, as one line. */
function useMissingTools(chatbotUserId: number, requiredTools: string[]): { missing: string[]; failed: boolean } {
  const [tools, setTools] = useState<AccountToolRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    void apiJson<AccountToolRow[]>(chatbotApi.accountTools(chatbotUserId))
      .then(setTools)
      .catch(() => setFailed(true));
  }, [chatbotUserId]);

  useEffect(() => { load(); }, [load]);

  // Nothing is claimed before the answer arrives: an alarm raised while the read is in flight would name
  // every required tool as missing on every open.
  if (tools === null) return { missing: [], failed };
  const reachable = (state: string): boolean => state === 'allowed' || state === 'inherited';
  return {
    missing: requiredTools.filter((name) => {
      const tool = tools.find((candidate) => candidate.name === name);
      return tool === undefined || !reachable(tool.state);
    }),
    failed,
  };
}

export function BotDetail({ bot, requiredTools, onChanged, unknownError, onClose }: {
  bot: ChatbotBotView;
  requiredTools: string[];
  onChanged(bot: ChatbotBotView): void;
  unknownError: string;
  onClose(): void;
}) {
  const { components: C, hooks, utils } = runtime();
  const s = hooks.usePluginStrings('chatbot');
  const { locale, t } = hooks.useTranslation();
  const { toast } = hooks.useToast();
  const [prompt, setPrompt] = useState(bot.prompt);
  const [origins, setOrigins] = useState<string[]>(bot.origins);
  const [limits, setLimits] = useState<LimitDraft>(() => limitDraftOf(bot.limits));
  const [rules, setRules] = useState<ChatbotActionRuleView[]>(bot.actionRules);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<'enable' | 'disable' | 'discard' | null>(null);
  const [opened, setOpened] = useState<'limits' | 'appearance' | null>(null);

  // A saved row comes back with the server's own values (a normalised domain, a trimmed name), so the
  // fields are re-seeded from it. It deliberately does NOT touch `confirming` or `error`: this effect fires
  // whenever a save lands, and the save that enables or disables a chatbot is confirmed FROM a dialog the
  // reader is looking at — a refresh that closed it would dismiss the very question being asked.
  useEffect(() => {
    setPrompt(bot.prompt);
    setOrigins(bot.origins);
    setLimits(limitDraftOf(bot.limits));
    setRules(bot.actionRules);
  }, [bot.updatedAt, bot.prompt, bot.origins, bot.limits, bot.actionRules]);

  const read = readLimitDraft(limits);
  const rulesEqual = rules.map(actionRuleKey).join('\n') === bot.actionRules.map(actionRuleKey).join('\n');
  const dirty = prompt !== bot.prompt || origins.join('\n') !== bot.origins.join('\n')
    || LIMIT_FIELDS.some((field) => limits[field] !== (bot.limits[field] === null ? '' : String(bot.limits[field])))
    || !rulesEqual;
  const blockers = blockerText(bot.blockers, bot.projects.length, s);
  const tools = useMissingTools(bot.chatbotUserId, requiredTools);
  // A chatbot whose numbers are not all decided yet cannot be enabled, and the form says so instead of
  // offering a button that would be refused. Saving is a different question: a DRAFT may be stored with
  // numbers still open — that is what a draft is — while an ENABLED chatbot may not be saved into a state
  // it could not serve from.
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
        // The name is the appearance editor's field, and the row it saved is the one this drawer holds:
        // sending it back unchanged keeps the PATCH a whole row rather than a partial one.
        displayName: bot.displayName,
        prompt,
        origins,
        limits: read.limits,
        actionRules: rules,
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

  const snippet = bot.embedSnippet;
  const copySnippet = async () => {
    if (snippet === null) return;
    try {
      await navigator.clipboard.writeText(snippet);
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
          {/* What is wrong, before anything that can be configured: the reasons this chatbot cannot run,
              and the one grant it needs that its account does not have. */}
          {blockers.map((text) => (
            <p key={text} className="text-xs text-destructive" role="alert">{text}</p>
          ))}
          {tools.missing.length === 0 ? null : (
            <p className="text-xs text-destructive" role="alert">{s.toolsMissing.replace('{names}', tools.missing.join(', '))}</p>
          )}
          {tools.failed ? <p className="text-xs text-muted-foreground">{s.toolsLoadError}</p> : null}

          <C.SettingsGroup title={s.detailFactsTitle} icon={BadgeCheck} columns={2} density="compact">
            <C.SettingsRow label={s.detailAccount} status={bot.account === null ? '—' : `@${bot.account.username}`} />
            <C.SettingsRow label={s.detailProject} status={bot.projects.length === 1 ? bot.projects[0]!.slug : '—'} />
            <C.SettingsRow label={s.detailUpdated} status={formatDateTime(bot.updatedAt, locale)} />
            {/* A refusal with no setting to make. It is a record like any other, so it states itself in one
                line and keeps its explanation where every other explanation on this surface is. */}
            <C.SettingsRow
              label={s.sensitiveTitle}
              description={s.sensitiveBody}
              status={<C.Badge tone="muted">{s.sensitiveUnavailable}</C.Badge>}
            />
          </C.SettingsGroup>

          {/* The card's own heading and description ARE the field's label and hint, so the textarea carries
              the accessible name and nothing states the same words twice. */}
          <C.SettingsGroup title={s.promptLabel} description={s.promptHint} icon={MessageSquareText}>
            <textarea
              value={prompt}
              aria-label={s.promptLabel}
              onChange={(event) => setPrompt(event.target.value)}
              rows={4}
              placeholder={s.promptPlaceholder}
              className="w-full resize-y rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary"
            />
          </C.SettingsGroup>

          <OriginsField origins={origins} insecure={bot.insecureOrigins} disabled={pending} onChange={setOrigins} />

          <SecuritySettings origins={origins} rules={rules} disabled={pending} onChange={setRules} />

          <C.SettingsGroup title={s.limitsTitle} description={s.limitsHint} icon={Gauge} density="compact">
            <C.SettingsRow
              label={s.limitsEdit}
              status={enableBlocked ? <C.Badge tone="warning">{s.statusAttention}</C.Badge> : null}
              actions={<C.IconButton icon={ChevronRight} label={s.limitsEdit} disabled={pending} onClick={() => setOpened('limits')} />}
            />
          </C.SettingsGroup>

          {/* What this chatbot DID is deliberately not here. Its conversations and its statistics are
              sections of the page, each with a picker over the same register, so they are read in one
              place instead of in a per-chatbot copy reachable only through this drawer. */}

          {snippet === null ? null : (
            <C.SettingsGroup
              title={s.embedTitle}
              description={s.embedHint}
              icon={Code2}
              collapsible
              defaultOpen={false}
              storageKey="chatbot.embed"
              actions={<C.Button variant="ghost" icon={ClipboardCopy} onClick={() => void copySnippet()}>{s.embedCopy}</C.Button>}
            >
              <pre className="overflow-x-auto rounded-lg bg-muted/40 p-3 font-mono text-[11px] text-foreground">{snippet}</pre>
            </C.SettingsGroup>
          )}

          {error !== null ? <p className="text-xs text-destructive" role="alert">{error}</p> : null}
        </div>
      </C.ModalBody>

      <C.ModalFooter>
        <C.Button variant="ghost" icon={Palette} disabled={pending} onClick={() => setOpened('appearance')}>{s.appearanceAction}</C.Button>
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
        <AppearanceModal
          bot={bot}
          onClose={() => setOpened(null)}
          // The saved row comes back from the server, so this drawer's own fields re-seed from it — a name
          // changed in the appearance editor is the only name, and both surfaces read the same value.
          onChanged={onChanged}
        />
      ) : null}
    </C.Modal>
  );
}
