import { useId, useState, type ChangeEvent } from 'react';
import { Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { runtime } from './runtime';
import type { ChatbotActionRuleView } from './types';
import { normalizeActionPathPrefix } from '../src/adminContract.js';
import {
  ACTION_KINDS,
  WIDGET_MAX_ACTIONS_PER_TURN,
  requiresVisitorConfirmation,
  type ActionKind,
} from '../src/publicContract.js';

/** What a turn may do on a visitor's page, and where.
 *
 *  The rules are the SERVER's policy — `src/actionRules.ts` resolves them on every action — and this editor
 *  is only their writer: it sends the whole list with the rest of the chatbot's state, so what an
 *  administrator sees is what the plugin will enforce. The checks here are HINTS about what the server
 *  would refuse anyway (a rule for a domain the chatbot does not answer on, the same rule twice, a limit
 *  beyond the per-turn ceiling), and the verdict comes back as a code so every locale words it itself.
 *
 *  ON THE PAGE it is one summary row — how many rules there are and which places they name — and the six
 *  controls that author one live in the window it opens. Open on the page they were a two-column form
 *  three hundred pixels tall, permanently, on a surface that already carries seven other sections; the
 *  pair here is the host's own (`SelectionSummary` + a window), the same shape the account's tools and the
 *  allowed domains now state themselves with. */

/** One rule's identity, exactly as the server keys the uniqueness it enforces: this origin, this path, this
 *  action. Exported so one rule cannot be recognized in two different ways. */
export function actionRuleKey(rule: { origin: string; pathPrefix: string; action: string }): string {
  return `${rule.origin}${rule.pathPrefix} ${rule.action}`;
}

/** Where a rule applies, as one readable place. The summary chip and the window's row are the same words. */
const rulePlace = (rule: { origin: string; pathPrefix: string }): string => `${rule.origin}${rule.pathPrefix}`;

export type DraftRuleRefusal = 'no_origin' | 'pick_origin' | 'bad_path' | 'bad_limit' | 'duplicate';

/** How many rules the summary names before it counts the rest, as every summary in the app does. */
const SAMPLES = 3;

/** Why the rule in the form cannot be added, or `null` when it can. */
export function draftRuleRefusal(
  draft: { origin: string; pathPrefix: string; action: string; maxPerTurn: string },
  allowedOrigins: readonly string[],
  existing: readonly ChatbotActionRuleView[],
): DraftRuleRefusal | null {
  if (allowedOrigins.length === 0) return 'no_origin';
  if (draft.origin === '') return 'pick_origin';
  // The server's own reading of a path, so what this field accepts is exactly what will be enforced.
  const path = normalizeActionPathPrefix(draft.pathPrefix);
  if (path === null) return 'bad_path';
  const limit = Number(draft.maxPerTurn);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > WIDGET_MAX_ACTIONS_PER_TURN) return 'bad_limit';
  if (existing.some((rule) => actionRuleKey(rule) === actionRuleKey({ origin: draft.origin, pathPrefix: path, action: draft.action }))) return 'duplicate';
  return null;
}

export function SecuritySettings({ origins, rules, disabled, onChange }: {
  origins: string[];
  rules: ChatbotActionRuleView[];
  disabled: boolean;
  onChange(rules: ChatbotActionRuleView[]): void;
}) {
  const { components: C, hooks } = runtime();
  const s = hooks.usePluginStrings('chatbot');
  const { t } = hooks.useTranslation();
  // A field that only carries a label and a hint does not associate the two on its own, so the two text
  // fields name their own control: the label is what a screen reader reads out with the input.
  const pathFieldId = useId();
  const limitFieldId = useId();
  const [open, setOpen] = useState(false);
  const [origin, setOrigin] = useState('');
  const [pathPrefix, setPathPrefix] = useState('/');
  const [action, setAction] = useState<ActionKind>('read');
  const [requiresConfirmation, setRequiresConfirmation] = useState(false);
  const [maxPerTurn, setMaxPerTurn] = useState('1');

  const actionLabel = (kind: string): string => s[`action_${kind}`] ?? kind;
  // The prefix as the server will store it, read once so the row and the verdict cannot describe two
  // different paths.
  const draftPath = normalizeActionPathPrefix(pathPrefix);
  const refusal = draftRuleRefusal({ origin, pathPrefix, action, maxPerTurn }, origins, rules);
  const refusalText = refusal === null ? null
    : refusal === 'no_origin' ? s.ruleOriginNone
      : refusal === 'pick_origin' ? s.ruleOriginRequired
        : refusal === 'bad_path' ? s.rulePathInvalid
          : refusal === 'bad_limit' ? s.ruleLimitInvalid.replace('{max}', String(WIDGET_MAX_ACTIONS_PER_TURN))
            : s.ruleDuplicate;

  const add = () => {
    if (refusal !== null || draftPath === null) return;
    onChange([...rules, {
      origin,
      pathPrefix: draftPath,
      action,
      // A confirmation is only ever carried for the kind that IS one: the widget's protocol has no frame
      // for any other, and the server refuses such a rule outright.
      requiresConfirmation: requiresVisitorConfirmation(action) && requiresConfirmation,
      maxPerTurn: Number(maxPerTurn),
    }]);
    setPathPrefix('/');
    setRequiresConfirmation(false);
    setMaxPerTurn('1');
  };

  return (
    <C.SettingsGroup
      title={s.securityTitle}
      description={s.securityHint}
      icon={ShieldCheck}
      actions={<C.HelpTip align="right">{s.securityHelp}</C.HelpTip>}
    >
      <C.SelectionSummary
        countText={rules.length === 0 ? s.rulesEmpty : s.rulesCount.replace('{n}', String(rules.length))}
        samples={rules.slice(0, SAMPLES).map((rule) => ({ id: actionRuleKey(rule), label: rulePlace(rule), icon: <ShieldCheck size={12} aria-hidden /> }))}
        moreCount={Math.max(0, rules.length - SAMPLES)}
        onManage={() => setOpen(true)}
        manageLabel={t.managePicker.manage}
        manageAriaLabel={s.securityTitle}
      />
      {rules.length === 0 ? <p className="text-xs text-muted-foreground">{s.rulesEmptyHint}</p> : null}

      {open ? (
        <C.Modal
          title={s.securityTitle}
          description={s.securityHint}
          icon={ShieldCheck}
          size="lg"
          presentation="center"
          closeLabel={t.common.close}
          onClose={() => setOpen(false)}
        >
          <C.ModalBody>
            {rules.length === 0 ? (
              <p className="text-xs text-muted-foreground">{s.rulesEmptyHint}</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {rules.map((rule) => (
                  <li key={actionRuleKey(rule)} className="flex items-center justify-between gap-3">
                    <span className="flex min-w-0 flex-col">
                      <span className="break-all font-mono text-xs text-foreground">{rulePlace(rule)}</span>
                      <span className="truncate text-[11px] text-muted-foreground">{actionLabel(rule.action)}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <C.Badge tone={rule.requiresConfirmation ? 'warning' : 'muted'}>
                        {rule.requiresConfirmation ? s.ruleNeedsConfirmation : s.ruleLimit.replace('{count}', String(rule.maxPerTurn))}
                      </C.Badge>
                      <C.IconButton
                        icon={Trash2}
                        variant="danger"
                        label={s.ruleRemove.replace('{value}', actionRuleKey(rule))}
                        disabled={disabled}
                        onClick={() => onChange(rules.filter((candidate) => actionRuleKey(candidate) !== actionRuleKey(rule)))}
                      />
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <C.Field label={s.ruleOriginLabel} hint={s.ruleOriginHint}>
                {origins.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{s.ruleOriginNone}</p>
                ) : (
                  <C.SelectMenu value={origin} onChange={setOrigin} options={origins.map((value) => ({ value, label: value }))} label={s.ruleOriginLabel} />
                )}
              </C.Field>
              <C.Field label={s.rulePathLabel} htmlFor={pathFieldId} hint={s.rulePathHint}>
                <C.Input
                  id={pathFieldId}
                  value={pathPrefix}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setPathPrefix(event.target.value)}
                  placeholder="/kontakt"
                />
              </C.Field>
              <C.Field label={s.ruleActionLabel}>
                <C.SelectMenu
                  value={action}
                  onChange={(value: string) => setAction(value as ActionKind)}
                  options={ACTION_KINDS.map((kind) => ({ value: kind, label: actionLabel(kind) }))}
                  label={s.ruleActionLabel}
                />
              </C.Field>
              <C.Field label={s.ruleLimitLabel} htmlFor={limitFieldId} hint={s.ruleLimitHint}>
                <C.Input
                  id={limitFieldId}
                  type="number"
                  min={1}
                  max={WIDGET_MAX_ACTIONS_PER_TURN}
                  value={maxPerTurn}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setMaxPerTurn(event.target.value)}
                />
              </C.Field>
              {requiresVisitorConfirmation(action) ? (
                <C.Field label={s.ruleConfirmationLabel} hint={s.ruleConfirmationHint}>
                  <C.Toggle checked={requiresConfirmation} onChange={setRequiresConfirmation} label={s.ruleConfirmationLabel} />
                </C.Field>
              ) : null}
              <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
                <C.Button icon={Plus} disabled={disabled || refusal !== null} onClick={add}>{s.ruleAdd}</C.Button>
                {refusalText === null ? null : <p className="text-xs text-destructive">{refusalText}</p>}
              </div>
            </div>
          </C.ModalBody>
          <C.ModalFooter>
            <C.Button variant="accent" onClick={() => setOpen(false)}>{t.common.done}</C.Button>
          </C.ModalFooter>
        </C.Modal>
      ) : null}
    </C.SettingsGroup>
  );
}
