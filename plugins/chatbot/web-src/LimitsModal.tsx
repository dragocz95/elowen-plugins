import { type ChangeEvent } from 'react';
import { Gauge } from 'lucide-react';
import { LIMIT_FIELDS, MANDATORY_LIMITS, isUsableLimit, specOf, type LimitField, type LimitValues } from '../src/limits';
import { runtime } from './runtime';

/** The numbers a chatbot serves under, one row each: the label, the number, and a slider for it.
 *
 *  They live in a window opened from one row of the chatbot's drawer, which is how the app edits a set of
 *  bounded numbers everywhere else (`web/modules/settings/BrainLimitsModal.tsx` is the same window opened
 *  from the same kind of row). Eleven stacked fields on the surface itself were the tallest thing on it and
 *  the least often changed.
 *
 *  Every row is driven by ONE setter, so the slider and the box are two views of the same draft value and
 *  cannot disagree. The box stays because it is the only control that can express the two states a slider
 *  cannot: an exact number anywhere in the server's range, and EMPTY — which for an optional ceiling means
 *  "the owner has set none" and for a mandatory one means "nobody has decided yet", the state that keeps a
 *  chatbot from being enabled. */

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

/** How far a slider reaches, and by how much it moves.
 *
 *  PRESENTATION ONLY, and the one thing on this surface that is not the server's own rule. `src/limits.ts`
 *  bounds a value at what the arithmetic can hold — ten million turns a day, a cost ceiling up to the safe
 *  integer — and a slider across that is a control nobody can land a real number with. So each row's slider
 *  covers the part of the range an operator actually sets, and the BOX beside it still accepts anything the
 *  server does: the slider can never offer a value the server refuses, and it never stands between the owner
 *  and a value they mean. A stored number above the reach is not clipped either — the row widens to hold it.
 *
 *  These reaches are this plugin's UI judgement, not policy: nothing enforces them and no stored value
 *  depends on them. */
const SLIDER_REACH: Record<LimitField, { max: number; step: number }> = {
  rateIpPerMinute: { max: 600, step: 5 },
  rateChatbotPerMinute: { max: 1_200, step: 10 },
  rateConversationPerMinute: { max: 120, step: 1 },
  dailyTurnLimit: { max: 20_000, step: 50 },
  dailyTokenLimit: { max: 5_000_000, step: 10_000 },
  // Micro-USD: the reach is one hundred dollars a day, moved a dollar at a time.
  dailyCostMicrousd: { max: 100_000_000, step: 1_000_000 },
  maxConcurrentTurns: { max: 64, step: 1 },
  maxQueueDepth: { max: 200, step: 1 },
  queueTimeoutSeconds: { max: 600, step: 5 },
  maxActionsPerTurn: { max: 20, step: 1 },
  retentionDays: { max: 365, step: 1 },
};

/** The slider's own range for a field: never past what the server accepts, never short of what is stored. */
export function sliderRange(field: LimitField, value: number | null): { min: number; max: number; step: number } {
  const spec = specOf(field);
  const reach = SLIDER_REACH[field];
  return {
    min: spec.min,
    max: Math.max(Math.min(reach.max, spec.max), value ?? spec.min),
    step: reach.step,
  };
}

export function LimitsModal({ draft, disabled, onChange, onClose }: {
  draft: LimitDraft;
  disabled: boolean;
  onChange(draft: LimitDraft): void;
  onClose(): void;
}) {
  const { components: C, hooks } = runtime();
  const s = hooks.usePluginStrings('chatbot');
  const { t } = hooks.useTranslation();
  const read = readLimitDraft(draft);
  const missingText = read.missing.map((field) => s[`limit_${field}`]).join(', ');
  const set = (field: LimitField, value: string) => onChange({ ...draft, [field]: value });

  return (
    <C.Modal
      title={s.limitsTitle}
      description={s.limitsHint}
      icon={Gauge}
      size="md"
      presentation="center"
      closeLabel={t.common.close}
      onClose={onClose}
    >
      <C.ModalBody>
        {read.missing.length > 0 ? (
          <p className="mb-3 text-xs text-destructive" role="alert">{s.limitsMissing.replace('{fields}', missingText)}</p>
        ) : null}
        <C.SettingsGroup density="compact">
          {LIMIT_FIELDS.map((field) => {
            const label = s[`limit_${field}`]!;
            const current = read.limits[field];
            const range = sliderRange(field, current);
            return (
              <C.SettingsRow
                key={field}
                label={label}
                trailingLayout="stack"
                status={(
                  <C.Input
                    inputMode="numeric"
                    aria-label={label}
                    disabled={disabled}
                    className="w-24 text-right font-mono"
                    value={draft[field]}
                    onChange={(event: ChangeEvent<HTMLInputElement>) => set(field, event.target.value)}
                  />
                )}
                control={(
                  <C.Slider
                    aria-label={label}
                    aria-valuetext={draft[field] === '' ? s.limitsUnset : draft[field]}
                    min={range.min}
                    max={range.max}
                    step={range.step}
                    disabled={disabled}
                    // An empty box has no position, so the slider rests at the floor and MOVING it is what
                    // decides the number — the same gesture that would set any other value.
                    value={current ?? range.min}
                    onChange={(value: number) => set(field, String(value))}
                  />
                )}
              />
            );
          })}
        </C.SettingsGroup>
        {/* The bounds in this sentence come from the same table the server reads, so what a reader is told
            here is the rule that will judge the number. */}
        {read.invalid.map((field) => (
          <p key={field} className="mt-2 text-xs text-destructive" role="alert">
            {`${s[`limit_${field}`]}: ${s.limitsRange.replace('{min}', String(specOf(field).min)).replace('{max}', String(specOf(field).max))}`}
          </p>
        ))}
      </C.ModalBody>
      <C.ModalFooter>
        <C.Button variant="accent" onClick={onClose}>{t.common.done}</C.Button>
      </C.ModalFooter>
    </C.Modal>
  );
}
