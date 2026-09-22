import { useCallback, useEffect, useState, type ChangeEvent } from 'react';
import {
  AlertTriangle, BadgeCheck, Check, ClipboardCopy, Code2, ExternalLink, Gauge, ListChecks, MessageSquareText,
  Palette, Power, Save, ShieldAlert,
} from 'lucide-react';
import { LIMIT_FIELDS, MANDATORY_LIMITS, isUsableLimit, specOf, type LimitField, type LimitValues } from '../src/limits';
import { apiJson, chatbotApi, jsonRequest, runtime, type AccountToolRow, type ManageSelectionItem } from './runtime';
import { formatDateTime } from './format';
import { SecuritySettings, actionRuleKey } from './SecuritySettings';
import { OriginsField } from './OriginsField';
import { AppearanceModal } from './AppearanceModal';
import type { ChatbotActionRuleView, ChatbotBotView } from './types';

/** One chatbot's configuration, as a SETTINGS DOCUMENT: the host's own stack of section cards, the same
 *  surface /settings and /account are built from, rather than eight hand-rolled blocks of its own.
 *
 *  Every field here is saved as a whole, on an explicit click: the row's `updatedAt` is the concurrency
 *  token, so a debounced autosave would race another administrator's edit for no benefit, and `Enable`
 *  must never be the side effect of a keystroke.
 *
 *  Three of the sections are LISTS whose height would otherwise grow with the customer's estate — the
 *  allowed domains, the page-action rules and the account's tools. Each is now a summary row opening one
 *  window, which is how the app states a managed selection everywhere: what used to be roughly a thousand
 *  pixels of permanently open lists and forms is three rows.
 *
 *  The grants are the exception to "everything is configured here": a core account's tool access is edited
 *  on the Users screen, which owns the rule for it. This surface REPORTS what the account can reach and
 *  hands the administrator over, rather than keeping a second implementation of a permission rule. */

/** What the limit inputs hold: the text a person typed, one entry per limit, empty meaning "not set". */
export type LimitDraft = Record<LimitField, string>;

/** The inputs one stored row starts out as. A limit the row does not carry is an EMPTY box, not a zero: the
 *  whole point of these numbers is that the owner decides them. */
export function limitDraftOf(limits: LimitValues): LimitDraft {
  const draft = {} as LimitDraft;
  for (const field of LIMIT_FIELDS) {
    const value = limits[field];
    draft[field] = value === null ? '' : String(value);
  }
  return draft;
}

/** What the boxes mean as a write.
 *
 *  The bounds are the SERVER's own, read from the plugin's limit table rather than restated here: a form that
 *  accepted a number the server refuses would turn a typo into a failed save with nothing to explain it.
 *  `invalid` and `missing` are separate answers because they are different things to fix — `missing` is a
 *  number nobody has decided yet, and it is exactly what keeps this chatbot from being enabled. */
export function readLimitDraft(draft: LimitDraft): {
  limits: LimitValues;
  invalid: LimitField[];
  missing: LimitField[];
} {
  const limits = {} as LimitValues;
  const invalid: LimitField[] = [];
  const missing: LimitField[] = [];
  for (const field of LIMIT_FIELDS) {
    const raw = draft[field].trim();
    if (raw === '') {
      limits[field] = null;
      // Only a mandatory number can be "missing": an absent ceiling is a decision, not a gap.
      if (field in MANDATORY_LIMITS) missing.push(field);
      continue;
    }
    const value = Number(raw);
    if (!isUsableLimit(value, specOf(field))) invalid.push(field);
    limits[field] = isUsableLimit(value, specOf(field)) ? value : null;
  }
  return { limits, invalid, missing };
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

/** How many tools the summary names before it counts the rest, as every summary in the app does. */
const TOOL_SAMPLES = 3;

/** The account's tool access, stated the way the host's own users panel states it: a summary of how many
 *  tools this chatbot can actually reach, and the full list behind one click.
 *
 *  It is deliberately the READ-ONLY variant of the host's picker. Nothing here may change a grant — the
 *  Users screen owns that rule, and the section's own action hands the administrator over to it — so the
 *  rows carry no checkbox that would ignore a click. A chatbot whose relay runs is not the same thing as a
 *  chatbot that can act on a page, and the difference is entirely this list. */
function AccountTools({ bot, requiredTools }: { bot: ChatbotBotView; requiredTools: string[] }) {
  const { components: C, hooks, utils, navigate } = runtime();
  const s = hooks.usePluginStrings('chatbot');
  const { t } = hooks.useTranslation();
  const [tools, setTools] = useState<AccountToolRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    setLoadError(null);
    void apiJson<AccountToolRow[]>(chatbotApi.accountTools(bot.chatbotUserId))
      .then(setTools)
      .catch((error) => setLoadError(utils.apiErrorMessage(error) || s.toolsLoadError));
  }, [bot.chatbotUserId, s.toolsLoadError, utils]);

  useEffect(() => { load(); }, [load]);

  const reachable = (state: string): boolean => state === 'allowed' || state === 'inherited';
  const all = tools ?? [];
  const usable = all.filter((tool) => reachable(tool.state));
  const missing = requiredTools.filter((name) => {
    const tool = all.find((candidate) => candidate.name === name);
    return tool === undefined || !reachable(tool.state);
  });
  // One row per tool, grouped by the plugin that owns it — the grouping the Users screen uses, so the same
  // account reads the same way on both screens.
  const items: ManageSelectionItem[] = all.map((tool) => ({
    id: tool.name,
    label: tool.name,
    group: tool.plugin ?? tool.group,
    groupLabel: tool.plugin ?? s[`toolGroup_${tool.group}`] ?? tool.group,
    badges: [{ text: s[`toolState_${tool.state}`] ?? tool.state, tone: reachable(tool.state) ? 'accent' as const : 'muted' as const }],
    disabledHint: tool.label,
  }));

  return (
    <C.SettingsGroup
      title={s.toolsTitle}
      description={s.toolsHint}
      icon={ListChecks}
      actions={<C.Button variant="ghost" icon={ExternalLink} onClick={() => navigate('/users')}>{s.toolsManage}</C.Button>}
    >
      {loadError !== null ? <C.ErrorState message={`${s.toolsLoadError} — ${loadError}`} onRetry={load} />
        : tools === null ? <C.LoadingLine layout="block" />
          : all.length === 0 ? <C.EmptyState title={s.toolsEmptyTitle} description={s.toolsEmptyDescription} icon={ListChecks} />
            : (
              <>
                <C.SelectionSummary
                  readOnly
                  countText={s.toolsCount.replace('{n}', String(usable.length)).replace('{total}', String(all.length))}
                  samples={usable.slice(0, TOOL_SAMPLES).map((tool) => ({ id: tool.name, label: tool.name }))}
                  moreCount={Math.max(0, usable.length - TOOL_SAMPLES)}
                  onManage={() => setOpen(true)}
                  manageLabel={t.managePicker.manage}
                  manageAriaLabel={s.toolsTitle}
                />
                <C.ManageSelectionModal
                  readOnly
                  title={s.toolsTitle}
                  subtitle={s.toolsHint}
                  open={open}
                  onClose={() => setOpen(false)}
                  items={items}
                  countLabel={(count: number) => s.toolsCount.replace('{n}', String(usable.length)).replace('{total}', String(count))}
                />
              </>
            )}
      {missing.length === 0 ? null : (
        <p className="text-xs text-destructive">{s.toolsMissing.replace('{names}', missing.join(', '))}</p>
      )}
    </C.SettingsGroup>
  );
}

export function BotDetail({ bot, requiredTools, onChanged, unknownError }: {
  bot: ChatbotBotView;
  requiredTools: string[];
  onChanged(bot: ChatbotBotView): void;
  unknownError: string;
}) {
  const { components: C, hooks, utils } = runtime();
  const s = hooks.usePluginStrings('chatbot');
  const { locale } = hooks.useTranslation();
  const { toast } = hooks.useToast();
  const [displayName, setDisplayName] = useState(bot.displayName);
  const [prompt, setPrompt] = useState(bot.prompt);
  const [origins, setOrigins] = useState<string[]>(bot.origins);
  const [limits, setLimits] = useState<LimitDraft>(() => limitDraftOf(bot.limits));
  const [rules, setRules] = useState<ChatbotActionRuleView[]>(bot.actionRules);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<'enable' | 'disable' | null>(null);
  const [editingLook, setEditingLook] = useState(false);

  // A different chatbot is a different form, so it starts from that chatbot's values with nothing open.
  useEffect(() => {
    setDisplayName(bot.displayName);
    setPrompt(bot.prompt);
    setOrigins(bot.origins);
    setLimits(limitDraftOf(bot.limits));
    setRules(bot.actionRules);
    setError(null);
    setConfirming(null);
  }, [bot.chatbotUserId]);

  // A saved row comes back with the server's own values (a normalised domain, a trimmed name), so the
  // fields are re-seeded from it. DELIBERATELY separate from the reset above and deliberately not
  // touching `confirming` or `error`: this effect fires whenever a save lands, and the save that enables
  // or disables a chatbot is confirmed FROM a dialog the reader is looking at — a refresh that closed it
  // would dismiss the very question being asked.
  useEffect(() => {
    setDisplayName(bot.displayName);
    setPrompt(bot.prompt);
    setOrigins(bot.origins);
    setLimits(limitDraftOf(bot.limits));
    setRules(bot.actionRules);
  }, [bot.updatedAt, bot.displayName, bot.prompt, bot.origins, bot.limits, bot.actionRules]);

  const read = readLimitDraft(limits);
  const rulesEqual = rules.map(actionRuleKey).join('\n') === bot.actionRules.map(actionRuleKey).join('\n');
  const dirty = displayName !== bot.displayName || prompt !== bot.prompt || origins.join('\n') !== bot.origins.join('\n')
    || LIMIT_FIELDS.some((field) => limits[field] !== (bot.limits[field] === null ? '' : String(bot.limits[field])))
    || !rulesEqual;
  const blockers = blockerText(bot.blockers, bot.projects.length, s);
  // A chatbot whose numbers are not all decided yet cannot be enabled, and the form says which ones are
  // missing instead of offering a button that would be refused. Saving is a different question: a DRAFT may
  // be stored with numbers still open — that is what a draft is — while an ENABLED chatbot may not be saved
  // into a state it could not serve from.
  const invalid = read.invalid.length > 0;
  const enableBlocked = invalid || read.missing.length > 0;
  const saveBlocked = invalid || (bot.status === 'enabled' && read.missing.length > 0);
  const missingText = read.missing.map((field) => s[`limit_${field}`]).join(', ');

  const save = async (action: 'enable' | 'disable' | null) => {
    setPending(true);
    setError(null);
    try {
      const answer = await apiJson<{ bot: ChatbotBotView }>(chatbotApi.bots(), jsonRequest('PATCH', {
        chatbotUserId: bot.chatbotUserId,
        expectedUpdatedAt: bot.updatedAt,
        displayName,
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

  return (
    <C.SettingsDocument>
      {/* The identity strip: what this chatbot IS, its state, and the actions that change that state — one
          line, the way every detail surface in the app opens. */}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-foreground">{bot.displayName || s.botFallback}</h2>
          <p className="break-all font-mono text-[11px] text-subtle-foreground">{bot.publicId}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <C.Badge tone={bot.status === 'enabled' && bot.blockers.length === 0 ? 'success' : bot.blockers.length > 0 ? 'warning' : undefined}>{statusText(bot, s)}</C.Badge>
          <C.Button variant="ghost" icon={Palette} disabled={pending} onClick={() => setEditingLook(true)}>{s.appearanceAction}</C.Button>
          {bot.status === 'enabled' ? (
            <C.Button variant="ghost" icon={Power} disabled={pending} onClick={() => setConfirming('disable')}>{s.disableAction}</C.Button>
          ) : (
            <C.Button variant="accent" icon={Power} disabled={pending || dirty || enableBlocked} onClick={() => setConfirming('enable')}>{s.enableAction}</C.Button>
          )}
        </div>
      </div>

      {/* What keeps this chatbot from working, as its own marked card rather than three grey paragraphs
          floating above the form. */}
      {blockers.length === 0 ? null : (
        <C.SettingsGroup tone="danger" title={s.statusAttention} icon={AlertTriangle} density="compact">
          {blockers.map((text) => <C.SettingsRow key={text} label={text} />)}
        </C.SettingsGroup>
      )}

      <C.SettingsGroup title={s.detailFactsTitle} description={s.detailFactsHint} icon={BadgeCheck} columns={2} density="compact">
        <C.SettingsRow label={s.detailAccount} status={bot.account === null ? '—' : `@${bot.account.username}`} />
        <C.SettingsRow label={s.detailProject} status={bot.projects.length === 1 ? bot.projects[0]!.slug : '—'} />
        <C.SettingsRow label={s.detailPublicId} status={<span className="font-mono text-[11px]">{bot.publicId}</span>} />
        <C.SettingsRow label={s.detailUpdated} status={formatDateTime(bot.updatedAt, locale)} />
      </C.SettingsGroup>

      {/* The card's own heading and description ARE the field's label and hint, so the textarea carries the
          accessible name and nothing states the same words twice. */}
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

      <AccountTools bot={bot} requiredTools={requiredTools} />

      {/* Eleven numbers as eleven records in two stacks: the label opposite its box, which is the shape
          every settings card in the app reads as, and half the height of a column of stacked fields. */}
      <C.SettingsGroup
        title={s.limitsTitle}
        description={s.limitsHint}
        icon={Gauge}
        columns={2}
        density="compact"
        tone={enableBlocked ? 'danger' : 'default'}
      >
        {LIMIT_FIELDS.map((field) => (
          <C.SettingsRow
            key={field}
            label={s[`limit_${field}`]!}
            control={(
              <C.Input
                inputMode="numeric"
                aria-label={s[`limit_${field}`]}
                value={limits[field]}
                onChange={(event: ChangeEvent<HTMLInputElement>) => setLimits({ ...limits, [field]: event.target.value })}
              />
            )}
          />
        ))}
      </C.SettingsGroup>
      {read.missing.length > 0 ? (
        <p className="text-xs text-destructive" role="alert">{s.limitsMissing.replace('{fields}', missingText)}</p>
      ) : null}
      {/* The bounds in this sentence come from the same table the server reads, so what a reader is told
          here is the rule that will judge the number. One line per offending field: the label sits directly
          beside the input, so repeating it would only make the message longer. */}
      {read.invalid.map((field) => (
        <p key={field} className="text-xs text-destructive" role="alert">
          {s.limitsRange.replace('{min}', String(specOf(field).min)).replace('{max}', String(specOf(field).max))}
        </p>
      ))}

      {/* A refusal with no setting to make: the card's heading and its description are the whole story, so
          it has no body at all rather than a paragraph pretending to be one. */}
      <C.SettingsGroup title={s.sensitiveTitle} description={s.sensitiveBody} icon={ShieldAlert} />

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

      <div className="flex flex-wrap items-center gap-3">
        <C.Button variant="accent" icon={dirty ? Save : Check} disabled={pending || !dirty || saveBlocked} onClick={() => void save(null)}>
          {pending ? s.saveSaving : s.saveAction}
        </C.Button>
        {error !== null ? <p className="text-xs text-destructive" role="alert">{error}</p> : null}
      </div>

      <C.ConfirmDialog
        open={confirming !== null}
        title={confirming === 'enable' ? s.enableTitle : s.disableTitle}
        description={confirming === 'enable' ? s.enableBody : s.disableBody}
        confirmLabel={confirming === 'enable' ? s.enableConfirm : s.disableConfirm}
        confirmVariant={confirming === 'enable' ? 'accent' : 'danger'}
        pending={pending}
        onConfirm={() => void save(confirming)}
        onClose={() => setConfirming(null)}
      />

      {editingLook ? (
        <AppearanceModal
          bot={bot}
          onClose={() => setEditingLook(false)}
          // The saved row comes back from the server, so this pane's own fields re-seed from it — a name
          // changed in the appearance editor is the only name, and both surfaces read the same value.
          onChanged={onChanged}
        />
      ) : null}
    </C.SettingsDocument>
  );
}
