import { useState } from 'react';
import {
  Activity, ChevronDown, ChevronUp, Clock, Coins, Gauge, Hourglass, Layers, ListOrdered, MousePointerClick,
  Timer, Trash2, Users, type LucideIcon,
} from 'lucide-react';
import { LIMIT_FIELDS, specOf, type LimitField, type LimitValues } from '../src/limits';
import { money } from './format';
import { runtime } from './runtime';

/** THE LIMITS WINDOW: one row per number, each a slider between the two ends its own specification names.
 *
 *  The rows are built like the host's own limits editor (`BrainLimitsModal`): icon, label, help mark and the
 *  current value on ONE line, and the slider under it across the row's full width. The earlier form used
 *  `SettingsRow`, which is a record band — a long label wraps, the help mark travels with it, and below the
 *  host's narrow breakpoint the whole row folds into two lines, so the marks ended up in a different place
 *  on every row. A slider row is not a record, so it is not built out of one.
 *
 *  A slider cannot express a value outside the bounds, so there is no "this number is wrong" state to word
 *  and no empty field to refuse: every limit always carries a number, which is exactly what the owner asked
 *  for. Bounds, step and default all come from `src/limits.ts`, the one place that describes a limit. */

/** The draft the detail holds while the window is open: every limit as a number in its STORED unit. */
export type LimitDraft = { [K in LimitField]: number };

/** A stored row as a draft. A limit a legacy row left unset starts at its default rather than at nothing:
 *  the slider has to stand somewhere, and the default is the value the plugin would have written itself.
 *  A stored number is carried through UNCHANGED, one outside the slider's practical span included: rewriting
 *  a value the owner set, merely because this window would not have offered it, is not the form's call. */
export function limitDraftOf(limits: LimitValues): LimitDraft {
  const draft = {} as LimitDraft;
  for (const field of LIMIT_FIELDS) draft[field] = limits[field] ?? specOf(field).default;
  return draft;
}

/** The span this row's slider covers: the practical one from the specification, widened when the stored
 *  value sits outside it, so the control can represent the number it is showing. */
export function sliderRange(field: LimitField, value: number): { min: number; max: number; step: number } {
  const { slider } = specOf(field);
  return { ...slider, min: Math.min(slider.min, value), max: Math.max(slider.max, value) };
}

/** The three numbers an owner actually decides about, in the order they are read. */
const PRIMARY_FIELDS: LimitField[] = ['dailyTurnLimit', 'dailyCostMicrousd', 'retentionDays'];
/** Everything that shapes how the traffic is served rather than how much of it there is. */
const ADVANCED_FIELDS: LimitField[] = [
  'rateIpPerMinute',
  'rateChatbotPerMinute',
  'rateConversationPerMinute',
  'dailyTokenLimit',
  'maxConcurrentTurns',
  'maxQueueDepth',
  'queueTimeoutSeconds',
  'maxActionsPerTurn',
];

const ICONS: Record<LimitField, LucideIcon> = {
  dailyTurnLimit: Activity,
  dailyCostMicrousd: Coins,
  retentionDays: Trash2,
  rateIpPerMinute: Users,
  rateChatbotPerMinute: Gauge,
  rateConversationPerMinute: Timer,
  dailyTokenLimit: Layers,
  maxConcurrentTurns: ListOrdered,
  maxQueueDepth: Hourglass,
  queueTimeoutSeconds: Clock,
  maxActionsPerTurn: MousePointerClick,
};

export function LimitsModal({ draft, disabled, onChange, onClose }: {
  draft: LimitDraft;
  disabled: boolean;
  onChange(draft: LimitDraft): void;
  onClose(): void;
}) {
  const { components: C, hooks } = runtime();
  const s = hooks.usePluginStrings('chatbot');
  const { locale, t } = hooks.useTranslation();
  const [advanced, setAdvanced] = useState(false);

  /** What the row prints on the right: the number in the unit the reader thinks in. Only the cost is stored
   *  in a different unit from the one it is read in, and it is the only one that says a currency. */
  const valueText = (field: LimitField, value: number): string => {
    if (field === 'dailyCostMicrousd') return money(value / 1_000_000, locale);
    const unit = s[`limitUnit_${field}`];
    return unit === undefined ? String(value) : `${value} ${unit}`;
  };

  const rows = (fields: readonly LimitField[]) => fields.map((field) => {
    const range = sliderRange(field, draft[field]);
    const label = s[`limit_${field}`]!;
    const Icon = ICONS[field];
    const text = valueText(field, draft[field]);
    return (
      <div key={field} className="py-3.5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center text-muted-foreground">
            <Icon size={18} aria-hidden />
          </span>
          <span className="flex min-w-0 flex-1 items-center gap-1.5 text-sm font-medium text-foreground">
            {label}
            <C.HelpTip>{s[`limitHint_${field}`]}</C.HelpTip>
          </span>
          <span className="shrink-0 font-mono text-sm tabular-nums text-primary">{text}</span>
        </div>
        <C.Slider
          className="mt-3"
          value={draft[field]}
          min={range.min}
          max={range.max}
          step={range.step}
          disabled={disabled}
          aria-label={label}
          aria-valuetext={text}
          onChange={(next: number) => onChange({ ...draft, [field]: next })}
        />
      </div>
    );
  });

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
        <div className="flex flex-col divide-y divide-border">
          {rows(PRIMARY_FIELDS)}
        </div>
        <C.Button
          variant="ghost"
          icon={advanced ? ChevronUp : ChevronDown}
          aria-expanded={advanced}
          onClick={() => setAdvanced((current) => !current)}
        >
          {s.limitsAdvanced}
        </C.Button>
        {advanced ? <div className="flex flex-col divide-y divide-border">{rows(ADVANCED_FIELDS)}</div> : null}
      </C.ModalBody>
      <C.ModalFooter>
        <C.Button variant="accent" onClick={onClose}>{t.common.done}</C.Button>
      </C.ModalFooter>
    </C.Modal>
  );
}
