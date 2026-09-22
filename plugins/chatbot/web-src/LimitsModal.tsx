import { useState, type ChangeEvent } from 'react';
import { ChevronDown, ChevronUp, Gauge } from 'lucide-react';
import { LIMIT_FIELDS, MANDATORY_LIMITS, isUsableLimit, specOf, type LimitField, type LimitValues } from '../src/limits';
import { runtime } from './runtime';

export type LimitDraft = Record<LimitField, string>;

export function limitDraftOf(limits: LimitValues): LimitDraft {
  const draft = {} as LimitDraft;
  for (const field of LIMIT_FIELDS) {
    const value = limits[field] ?? specOf(field).default;
    draft[field] = String(value);
  }
  return draft;
}

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
      if (field in MANDATORY_LIMITS) missing.push(field);
      continue;
    }
    const value = Number(raw);
    if (!isUsableLimit(value, specOf(field))) invalid.push(field);
    limits[field] = isUsableLimit(value, specOf(field)) ? value : null;
  }
  return { limits, invalid, missing };
}

const PRIMARY_FIELDS: LimitField[] = ['dailyTurnLimit', 'dailyCostMicrousd', 'retentionDays'];
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

const displayValue = (field: LimitField, raw: string): string =>
  field === 'dailyCostMicrousd' && raw !== '' && Number.isFinite(Number(raw))
    ? String(Number(raw) / 1_000_000)
    : raw;

const storedValue = (field: LimitField, raw: string): string => {
  if (field !== 'dailyCostMicrousd' || raw.trim() === '') return raw;
  const dollars = Number(raw);
  return Number.isFinite(dollars) ? String(Math.round(dollars * 1_000_000)) : raw;
};

const displayBound = (field: LimitField, value: number): string =>
  String(field === 'dailyCostMicrousd' ? value / 1_000_000 : value);

export function LimitsModal({ draft, disabled, onChange, onClose }: {
  draft: LimitDraft;
  disabled: boolean;
  onChange(draft: LimitDraft): void;
  onClose(): void;
}) {
  const { components: C, hooks } = runtime();
  const s = hooks.usePluginStrings('chatbot');
  const { t } = hooks.useTranslation();
  const [advanced, setAdvanced] = useState(false);
  const read = readLimitDraft(draft);
  const missingText = read.missing.map((field) => s[`limit_${field}`]).join(', ');
  const set = (field: LimitField, value: string) => onChange({ ...draft, [field]: value });

  const rows = (fields: readonly LimitField[]) => fields.map((field) => {
    const label = s[`limit_${field}`]!;
    return (
      <C.SettingsRow
        key={field}
        label={label}
        description={s[`limitHint_${field}`]}
        status={(
          <C.Input
            type="number"
            inputMode="numeric"
            aria-label={label}
            disabled={disabled}
            className="w-28 text-right font-mono"
            min={field === 'dailyCostMicrousd' ? specOf(field).min / 1_000_000 : specOf(field).min}
            max={field === 'dailyCostMicrousd' ? specOf(field).max / 1_000_000 : specOf(field).max}
            step={field === 'dailyCostMicrousd' ? 0.01 : 1}
            value={displayValue(field, draft[field])}
            onChange={(event: ChangeEvent<HTMLInputElement>) => set(field, storedValue(field, event.target.value))}
          />
        )}
      />
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
        {read.missing.length > 0 ? (
          <p className="mb-3 text-xs text-destructive" role="alert">{s.limitsMissing.replace('{fields}', missingText)}</p>
        ) : null}
        <C.SettingsGroup density="compact">
          {rows(PRIMARY_FIELDS)}
        </C.SettingsGroup>
        <C.Button
          variant="ghost"
          icon={advanced ? ChevronUp : ChevronDown}
          aria-expanded={advanced}
          onClick={() => setAdvanced((current) => !current)}
        >
          {s.limitsAdvanced}
        </C.Button>
        {advanced ? <C.SettingsGroup density="compact">{rows(ADVANCED_FIELDS)}</C.SettingsGroup> : null}
        {read.invalid.map((field) => (
          <p key={field} className="mt-2 text-xs text-destructive" role="alert">
            {`${s[`limit_${field}`]}: ${s.limitsRange
              .replace('{min}', displayBound(field, specOf(field).min))
              .replace('{max}', displayBound(field, specOf(field).max))}`}
          </p>
        ))}
      </C.ModalBody>
      <C.ModalFooter>
        <C.Button variant="accent" onClick={onClose}>{t.common.done}</C.Button>
      </C.ModalFooter>
    </C.Modal>
  );
}
