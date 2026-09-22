import { useState, type ChangeEvent } from 'react';
import { Globe, Plus, Trash2 } from 'lucide-react';
import { runtime } from './runtime';

/** The domains a chatbot answers on, as the app states a managed selection anywhere else: a summary row
 *  saying how many there are and naming a few, and ONE window that edits the list.
 *
 *  The list used to sit open on the page — every domain a row, the add field and its two refusals below
 *  them — which is a section whose height grows with the customer's estate on a surface where it is one of
 *  eight. The pair here is the host's own (`SelectionSummary` + a window), the same shape the Users screen
 *  states an account's tools with and cronjob picks a destination with.
 *
 *  What the window edits is the DRAFT the detail pane already holds: adding or removing a domain marks the
 *  form dirty exactly as it did before, and the save that stores it is still the one explicit click at the
 *  bottom of the page. So the window has nothing to save of its own and closes on `Done`. */

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

/** How many domains the summary names before it counts the rest, as every summary in the app does. */
const SAMPLES = 3;

export function OriginsField({ origins, insecure, disabled, onChange }: {
  origins: string[];
  /** The stored domains the server reports as not https, which an enabled chatbot may not carry. */
  insecure: string[];
  disabled: boolean;
  onChange(origins: string[]): void;
}) {
  const { components: C, hooks } = runtime();
  const s = hooks.usePluginStrings('chatbot');
  const { t } = hooks.useTranslation();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');

  const hint = originHint(draft, origins);
  const add = () => {
    if (hint !== null || draft.trim() === '') return;
    onChange([...origins, draft.trim()]);
    setDraft('');
  };

  return (
    <C.SettingsGroup title={s.originsLabel} description={s.originsHint} icon={Globe}>
      <C.SelectionSummary
        countText={origins.length === 0 ? s.originsEmpty : s.originsCount.replace('{n}', String(origins.length))}
        samples={origins.slice(0, SAMPLES).map((origin) => ({ id: origin, label: origin, icon: <Globe size={12} aria-hidden /> }))}
        moreCount={Math.max(0, origins.length - SAMPLES)}
        onManage={() => setOpen(true)}
        manageLabel={t.managePicker.manage}
        manageAriaLabel={s.originsLabel}
      />
      {insecure.length > 0 ? <p className="text-xs text-destructive">{s.originsInsecure}</p> : null}

      {open ? (
        <C.Modal
          title={s.originsLabel}
          description={s.originsHint}
          icon={Globe}
          size="md"
          presentation="center"
          closeLabel={t.common.close}
          onClose={() => setOpen(false)}
        >
          <C.ModalBody>
            {origins.length === 0 ? (
              <p className="text-xs text-muted-foreground">{s.originsEmpty}</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {origins.map((origin) => (
                  <li key={origin} className="flex items-center justify-between gap-2">
                    <span className="min-w-0 break-all font-mono text-xs text-foreground">{origin}</span>
                    <C.IconButton
                      icon={Trash2}
                      variant="danger"
                      label={s.originsRemove.replace('{value}', origin)}
                      disabled={disabled}
                      onClick={() => onChange(origins.filter((candidate) => candidate !== origin))}
                    />
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 flex flex-wrap items-end gap-2">
              <C.Field label={s.originsAdd} hint={s.originsHint}>
                <C.Input
                  value={draft}
                  placeholder={s.originsPlaceholder}
                  disabled={disabled}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setDraft(event.target.value)}
                />
              </C.Field>
              <C.Button icon={Plus} disabled={disabled || draft.trim() === '' || hint !== null} onClick={add}>{s.originsAdd}</C.Button>
            </div>
            {hint === 'invalid' ? <p className="mt-2 text-xs text-destructive">{s.originsInvalid}</p> : null}
            {hint === 'duplicate' ? <p className="mt-2 text-xs text-destructive">{s.originsDuplicate}</p> : null}
          </C.ModalBody>
          <C.ModalFooter>
            <C.Button variant="accent" onClick={() => setOpen(false)}>{t.common.done}</C.Button>
          </C.ModalFooter>
        </C.Modal>
      ) : null}
    </C.SettingsGroup>
  );
}
