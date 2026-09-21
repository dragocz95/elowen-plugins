import { useEffect, useState, type ChangeEvent } from 'react';
import { Check, ClipboardCopy, Plus, Power, Save, Trash2 } from 'lucide-react';
import { LIMIT_FIELDS, MANDATORY_LIMITS, isUsableLimit, specOf, type LimitField, type LimitValues } from '../src/limits';
import { apiJson, jsonRequest, runtime, type ChatbotBotView } from './runtime';

/** One chatbot's configuration. Every field here is saved as a whole, on an explicit click: the row's
 *  `updatedAt` is the concurrency token, so a debounced autosave would race another administrator's edit
 *  for no benefit, and `Enable` must never be the side effect of a keystroke. */

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

/** A hint for the form, never the rule: the server normalises and validates every domain it is given and
 *  refuses an entry it cannot reduce to `scheme://host`. This only keeps an obviously wrong value out of
 *  the list, so the failure is explained next to the field instead of by a failed save. */
export function originHint(value: string, existing: string[]): string | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (!/^https?:\/\/[^\s/]+$/i.test(trimmed)) return 'invalid';
  if (existing.includes(trimmed)) return 'duplicate';
  return null;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export function statusText(bot: ChatbotBotView, s: Record<string, string>): string {
  if (bot.blockers.length > 0) return s.statusAttention;
  return bot.status === 'enabled' ? s.statusEnabled : bot.status === 'disabled' ? s.statusDisabled : s.statusDraft;
}

export function BotDetail({ bot, onChanged, unknownError }: {
  bot: ChatbotBotView;
  onChanged(bot: ChatbotBotView): void;
  unknownError: string;
}) {
  const { components: C, hooks, utils } = runtime();
  const s = hooks.usePluginStrings('chatbot');
  const { toast } = hooks.useToast();
  const [displayName, setDisplayName] = useState(bot.displayName);
  const [prompt, setPrompt] = useState(bot.prompt);
  const [origins, setOrigins] = useState<string[]>(bot.origins);
  const [limits, setLimits] = useState<LimitDraft>(() => limitDraftOf(bot.limits));
  const [draftOrigin, setDraftOrigin] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<'enable' | 'disable' | null>(null);

  // A different chatbot is a different form, so it starts from that chatbot's values with nothing open.
  useEffect(() => {
    setDisplayName(bot.displayName);
    setPrompt(bot.prompt);
    setOrigins(bot.origins);
    setLimits(limitDraftOf(bot.limits));
    setDraftOrigin('');
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
  }, [bot.updatedAt, bot.displayName, bot.prompt, bot.origins, bot.limits]);

  const read = readLimitDraft(limits);
  const dirty = displayName !== bot.displayName || prompt !== bot.prompt || origins.join('\n') !== bot.origins.join('\n')
    || LIMIT_FIELDS.some((field) => limits[field] !== (bot.limits[field] === null ? '' : String(bot.limits[field])));
  const hint = originHint(draftOrigin, origins);
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
      const answer = await apiJson<{ bot: ChatbotBotView }>('/plugins/chatbot/api/bots', jsonRequest('PATCH', {
        chatbotUserId: bot.chatbotUserId,
        expectedUpdatedAt: bot.updatedAt,
        displayName,
        prompt,
        origins,
        limits: read.limits,
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

  const addOrigin = () => {
    if (hint !== null) return;
    setOrigins([...origins, draftOrigin.trim()]);
    setDraftOrigin('');
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
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-foreground">{bot.displayName || s.botFallback}</h2>
          <p className="break-all font-mono text-[11px] text-subtle-foreground">{bot.publicId}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <C.Badge tone={bot.status === 'enabled' && bot.blockers.length === 0 ? 'success' : bot.blockers.length > 0 ? 'warning' : undefined}>{statusText(bot, s)}</C.Badge>
          {bot.status === 'enabled' ? (
            <C.Button variant="ghost" icon={Power} disabled={pending} onClick={() => setConfirming('disable')}>{s.disableAction}</C.Button>
          ) : (
            <C.Button variant="accent" icon={Power} disabled={pending || dirty || enableBlocked} onClick={() => setConfirming('enable')}>{s.enableAction}</C.Button>
          )}
        </div>
      </div>

      <dl className="grid gap-x-6 gap-y-3 rounded-xl border border-border bg-card p-4 text-sm sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{s.detailAccount}</dt>
          <dd className="mt-1 truncate text-foreground">{bot.account === null ? '—' : `@${bot.account.username}`}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{s.detailProject}</dt>
          <dd className="mt-1 truncate text-foreground">{bot.projects.length === 1 ? bot.projects[0]!.slug : '—'}</dd>
        </div>
        <div className="col-span-full">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{s.detailUpdated}</dt>
          <dd className="mt-1 text-muted-foreground">{formatTimestamp(bot.updatedAt)}</dd>
        </div>
      </dl>

      {blockers.map((text) => (
        <p key={text} className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">{text}</p>
      ))}

      <C.Field label={s.promptLabel} hint={s.promptHint}>
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          rows={5}
          placeholder={s.promptPlaceholder}
          className="w-full resize-y rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary"
        />
      </C.Field>

      <div className="rounded-xl border border-border bg-card p-4">
        <p className="text-sm font-semibold text-foreground">{s.originsLabel}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{s.originsHint}</p>
        {origins.length === 0 ? <p className="mt-3 text-xs text-muted-foreground">{s.originsEmpty}</p> : (
          <ul className="mt-3 flex flex-col gap-1">
            {origins.map((origin) => (
              <li key={origin} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-1.5">
                <span className="break-all font-mono text-xs text-foreground">{origin}</span>
                <C.Button
                  variant="ghost"
                  icon={Trash2}
                  aria-label={s.originsRemove.replace('{value}', origin)}
                  disabled={pending}
                  onClick={() => setOrigins(origins.filter((candidate) => candidate !== origin))}
                />
              </li>
            ))}
          </ul>
        )}
        {bot.insecureOrigins.length > 0 ? <p className="mt-3 text-xs text-destructive">{s.originsInsecure}</p> : null}
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <C.Field label={s.originsAdd}>
            <C.Input
              value={draftOrigin}
              placeholder={s.originsPlaceholder}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setDraftOrigin(event.target.value)}
            />
          </C.Field>
          <C.Button icon={Plus} disabled={pending || draftOrigin.trim() === '' || hint !== null} onClick={addOrigin}>{s.originsAdd}</C.Button>
        </div>
        {hint === 'invalid' ? <p className="mt-2 text-xs text-destructive">{s.originsInvalid}</p> : null}
        {hint === 'duplicate' ? <p className="mt-2 text-xs text-destructive">{s.originsDuplicate}</p> : null}
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <p className="text-sm font-semibold text-foreground">{s.limitsTitle}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{s.limitsHint}</p>
        {read.missing.length > 0 ? (
          <p className="mt-2 text-xs text-destructive" role="alert">{s.limitsMissing.replace('{fields}', missingText)}</p>
        ) : null}
        <div className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {LIMIT_FIELDS.map((field) => (
            <C.Field key={field} label={s[`limit_${field}`]}>
              <C.Input
                inputMode="numeric"
                value={limits[field]}
                onChange={(event: ChangeEvent<HTMLInputElement>) => setLimits({ ...limits, [field]: event.target.value })}
              />
            </C.Field>
          ))}
        </div>
        {/* The bounds in this sentence come from the same table the server reads, so what a reader is told
            here is the rule that will judge the number. One line per offending field: the label sits directly
            above the input, so repeating it would only make the message longer. */}
        {read.invalid.map((field) => (
          <p key={field} className="mt-2 text-xs text-destructive" role="alert">
            {s.limitsRange.replace('{min}', String(specOf(field).min)).replace('{max}', String(specOf(field).max))}
          </p>
        ))}
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <p className="text-sm font-semibold text-foreground">{s.sensitiveTitle}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{s.sensitiveBody}</p>
      </div>

      {snippet === null ? null : (
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-sm font-semibold text-foreground">{s.embedTitle}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{s.embedHint}</p>
          <pre className="mt-3 overflow-x-auto rounded-lg bg-muted/40 p-3 font-mono text-[11px] text-foreground">{snippet}</pre>
          <C.Button className="mt-3" variant="ghost" icon={ClipboardCopy} onClick={() => void copySnippet()}>{s.embedCopy}</C.Button>
        </div>
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
    </div>
  );
}
