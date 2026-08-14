/** The curated component set the host installs on `window.ElowenUiRuntime.components`.
 *
 *  These are ports of the app's own primitives (web/components/ui/*, web/modules/settings/*), not
 *  look-alikes: the plugin's settings panel is asserted through the DOM contract they produce — the
 *  `role="switch"` toggles, the `role="radio"` scope filter, the `role="dialog"` detail drawer, the
 *  `aria-selected` row and the `.spatial-workspace-hero` / `[data-control-surface]` chrome. Anything
 *  weaker here would make those assertions test the stub instead of the plugin.
 *
 *  Only styling was dropped (the app's Tailwind classes carry no behaviour) and two purely visual pieces
 *  are simplified: the hero mascot and the HelpTip tooltip body. HelpTip keeps its trigger BUTTON, so the
 *  form's button set matches production.
 */
import {
  useCallback, useEffect, useId, useMemo, useRef, useState,
  type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronLeft, ChevronRight, Cpu, Loader2, Search, Settings2, Trash2, TriangleAlert, type LucideIcon } from 'lucide-react';
import { apiErrorMessage } from './hostClient';
import { useToast, useTranslation } from './hostHooks';
import type { SaveStatus } from './useAutoSaveStatus';

// ── primitives ───────────────────────────────────────────────────────────────────────────────────────

export function Badge({ children }: { children: ReactNode; tone?: string }) {
  return <span className="badge">{children}</span>;
}

export function Button({ icon: Icon, children, ...rest }: { variant?: string; icon?: LucideIcon } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...rest}>{Icon ? <Icon size={14} aria-hidden /> : null}{children}</button>;
}

export function Input({ ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} />;
}

/** The app renders the hint as a HelpTip "?" trigger beside the label, not as text under the control. */
export function Field({ label, htmlFor, children, hint }: { label: string; htmlFor?: string; children: ReactNode; hint?: string }) {
  return (
    <label htmlFor={htmlFor} className="field">
      <span className="field__label">
        {label}
        {hint ? <HelpTip>{hint}</HelpTip> : null}
      </span>
      {children}
    </label>
  );
}

function HelpTip({ children }: { children: ReactNode }) {
  return (
    <span className="help-tip">
      <button type="button" aria-label="Help" title={typeof children === 'string' ? children : undefined}>?</button>
    </span>
  );
}

export function Toggle({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: (next: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
    />
  );
}

export interface SegmentedOption { value: string; label: string }

/** A connected segmented switch — a radiogroup whose options are `role="radio"` buttons named by their
 *  label. The scope filter and the create form's "visible to" control are both this. */
export function Segmented({ options, value, onChange, className, 'aria-label': ariaLabel }: {
  options: SegmentedOption[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
  nowrap?: boolean;
  'aria-label'?: string;
}) {
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const tabbableIndex = selectedIndex >= 0 ? selectedIndex : 0;
  const move = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % options.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + options.length) % options.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = options.length - 1;
    if (next == null || !options[next]) return;
    event.preventDefault();
    onChange(options[next]!.value);
    buttonRefs.current[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={className}>
      {options.map((o, index) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          aria-label={o.label}
          tabIndex={index === tabbableIndex ? 0 : -1}
          ref={(node) => { buttonRefs.current[index] = node; }}
          onClick={() => onChange(o.value)}
          onKeyDown={(event) => move(event, index)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── surfaces ─────────────────────────────────────────────────────────────────────────────────────────

export function ControlSurfaceDocument({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section data-control-surface className={`control-surface-document ${className}`}>{children}</section>;
}
export function ControlSurfaceToolbar({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`control-surface-toolbar ${className}`}>{children}</div>;
}
export function ControlSurfaceRegister({ children, className = '', ...rest }: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return <div className={`control-surface-register ${className}`} {...rest}>{children}</div>;
}
export function ControlSurfaceState({ children, tone = 'default' }: { children: ReactNode; tone?: string; className?: string }) {
  return <div className="control-surface-state" data-tone={tone}>{children}</div>;
}

export function DataTable({ ariaLabel, children, className = '' }: { ariaLabel: string; columns?: string; compactColumns?: string; children: ReactNode; className?: string }) {
  return <div role="table" aria-label={ariaLabel} className={className}>{children}</div>;
}
export function DataTableRow({ children, header = false, selected = false, interactive = false, className = '', ...rest }: {
  children: ReactNode; header?: boolean; selected?: boolean; interactive?: boolean;
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div role="row" data-state={selected ? 'selected' : 'idle'} data-interactive={interactive || undefined} className={`${header ? 'data-table-header' : ''} ${className}`} {...rest}>
      {children}
    </div>
  );
}
export function DataTableCell({ children, header = false, priority = 'always', className = '', ...rest }: {
  children: ReactNode; header?: boolean; priority?: 'always' | 'wide';
} & HTMLAttributes<HTMLDivElement>) {
  return <div role={header ? 'columnheader' : 'cell'} data-priority={priority} className={className} {...rest}>{children}</div>;
}

export function EmptyState({ title, description, icon: Icon, action }: { title: string; description?: string; icon?: LucideIcon; action?: ReactNode }) {
  return (
    <div className="empty-state">
      {Icon ? <Icon size={28} aria-hidden /> : null}
      <p>{title}</p>
      {description ? <p>{description}</p> : null}
      {action}
    </div>
  );
}
export function LoadingState({ variant = 'list' }: { variant?: string; height?: string }) {
  const { t } = useTranslation();
  return <div className="loading-state" aria-busy="true" aria-label={t.common.loading} data-variant={variant} />;
}
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="error-state">
      <p>{message}</p>
      {onRetry ? <Button onClick={onRetry}>{t.common.retry}</Button> : null}
    </div>
  );
}

// ── workspace chrome ─────────────────────────────────────────────────────────────────────────────────

export function WorkspacePage({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`workspace-page ${className}`}>{children}</div>;
}

function SpatialWorkspaceHero({ eyebrow, title, count, description, status, action, children }: {
  eyebrow?: string; title: string; count?: number; description?: string;
  status?: ReactNode; action?: ReactNode; mascotState?: string; children: ReactNode;
}) {
  return (
    <section className="spatial-workspace-hero">
      <header className="spatial-workspace-hero__header">
        <div>
          {eyebrow ? <div className="workspace-header__eyebrow">{eyebrow}</div> : null}
          <div>
            <h1>{title}</h1>
            {count !== undefined ? <span className="workspace-header__count">{count}</span> : null}
          </div>
          {description ? <p>{description}</p> : null}
        </div>
        <div className="workspace-header__actions">{status}{action}</div>
      </header>
      <div className="spatial-workspace-hero__body">
        <div className="spatial-workspace-hero__mascot" data-testid="workspace-hero-mascot" />
        <div className="spatial-workspace-hero__metrics">{children}</div>
      </div>
    </section>
  );
}

export function SpatialWorkspaceLayout({ hero, children, className = '' }: {
  hero: { eyebrow?: string; title: string; count?: number; description?: string; status?: ReactNode; action?: ReactNode; mascotState?: string; metrics: ReactNode };
  children: ReactNode;
  className?: string;
}) {
  const { metrics, ...heroProps } = hero;
  return (
    <WorkspacePage className={`spatial-workspace-layout ${className}`}>
      <div className="spatial-workspace-layout__hero">
        <SpatialWorkspaceHero {...heroProps}>{metrics}</SpatialWorkspaceHero>
      </div>
      <div className="workspace-content" data-testid="spatial-workspace-layout">{children}</div>
    </WorkspacePage>
  );
}

export function WorkspaceMetric({ label, value, icon: Icon }: { label: string; value: ReactNode; icon?: LucideIcon }) {
  return (
    <div className="workspace-metric">
      <span className="workspace-metric__value">{value}</span>
      <span className="workspace-metric__label">{Icon ? <Icon size={12} aria-hidden /> : null}{label}</span>
    </div>
  );
}

/** The detail drawer: portaled to <body>, `role="dialog"` and named by the entry it edits. The editor
 *  form lives inside it, which is why the tests scope their form queries to `findByRole('dialog')`. */
export function WorkspaceDetailRail({ label, closeLabel, onClose, children }: { label: string; closeLabel: string; onClose: () => void; children: ReactNode }) {
  const [portal, setPortal] = useState<HTMLElement | null>(null);
  useEffect(() => setPortal(document.body), []);
  const content = (
    <div className="overlay-layer-drawer workspace-detail-layer">
      <div data-testid="workspace-detail-backdrop" className="workspace-detail-backdrop" aria-hidden onMouseDown={onClose} />
      <aside role="dialog" aria-modal="true" tabIndex={-1} className="workspace-detail-rail" aria-label={label}>
        <header className="workspace-detail-rail__header">
          <span>{label}</span>
          <button type="button" onClick={onClose} aria-label={closeLabel}>×</button>
        </header>
        <div className="workspace-detail-rail__body">{children}</div>
      </aside>
    </div>
  );
  return portal ? createPortal(content, portal) : content;
}

/** Ported from web/components/ui/Modal.tsx. Portaled to <body>, named by its title through
 *  `aria-labelledby` and carrying the header's Close button, so a modal's button set matches
 *  production. Only the size/presentation styling is dropped — a drawer and a centered window are the
 *  same dialog with the same focus and close behaviour. */
function Modal({ title, description, onClose, children }: {
  title: string; description?: string; onClose: () => void; children: ReactNode;
  size?: string; presentation?: 'center' | 'drawer'; icon?: LucideIcon;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const descriptionId = useId();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
    <div
      className="overlay-layer-modal"
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        // Portal events still bubble through their React tree — stop at this backdrop so a nested
        // modal's backdrop click cannot also close its parent.
        event.stopPropagation();
        onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        data-elowen-modal
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <h2 id={titleId}>{title}</h2>
          {description ? <p id={descriptionId}>{description}</p> : null}
          <button type="button" aria-label={t.common.close} onClick={onClose}>×</button>
        </header>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** Scrollable content region of a modal; `ModalFooter` keeps the actions pinned below it and takes an
 *  optional `status` node (the auto-save indicator) on the left. */
function ModalBody({ children }: { children: ReactNode; gap?: 4 | 5 | 6 }) {
  return <div className="modal-body">{children}</div>;
}

function ModalFooter({ children, status }: { children?: ReactNode; status?: ReactNode }) {
  return (
    <div className="modal-footer">
      {status ? <div>{status}</div> : null}
      <div>{children}</div>
    </div>
  );
}

export function ConfirmDialog({ open, title, description, confirmLabel, onConfirm, onClose }: {
  open: boolean; title: string; description?: string; confirmLabel?: string; onConfirm: () => void; onClose: () => void;
}) {
  const { t } = useTranslation();
  if (!open) return null;
  return (
    <Modal title={title} onClose={onClose}>
      <div className="modal-body">{description ? <p>{description}</p> : null}</div>
      <div className="modal-footer">
        <Button onClick={onClose}>{t.common.cancel}</Button>
        <Button onClick={onConfirm}>{confirmLabel ?? t.common.delete}</Button>
      </div>
    </Modal>
  );
}

// ── save indicator ───────────────────────────────────────────────────────────────────────────────────

/** Ported from web/components/ui/states.tsx. Without `label` it is aria-hidden: a spinner beside its own
 *  visible text would be announced twice. */
const SPINNER_PX = { xs: 10, sm: 13, md: 16, lg: 40 } as const;
export function Spinner({ size = 'sm', label }: { size?: keyof typeof SPINNER_PX; tone?: string; label?: string }) {
  return <Loader2 size={SPINNER_PX[size]} className="spinner" {...(label ? { role: 'status' as const, 'aria-label': label } : { 'aria-hidden': true })} />;
}

/** Ported from web/components/ui/AutoSaveStatus.tsx. Idle renders an EMPTY live region rather than
 *  nothing — the row keeps one stable `role="status"` node, so the first "Saving…" is announced instead
 *  of arriving with a brand-new region a screen reader may not read. The error is `role="alert"` and
 *  offers Retry. */
export function AutoSaveStatus({ status, onRetry }: { status: SaveStatus; onRetry?: () => void }) {
  const { t } = useTranslation();
  if (status === 'idle') return <span role="status" aria-live="polite" />;
  if (status === 'saving') return <span role="status" aria-live="polite"><Spinner size="sm" tone="" />{t.common.saving}</span>;
  if (status === 'saved') return <span role="status" aria-live="polite"><Check size={13} aria-hidden />{t.common.saved}</span>;
  return (
    <span role="alert">
      <TriangleAlert size={13} aria-hidden />{t.common.saveFailed}
      {onRetry ? <button type="button" onClick={onRetry}>{t.common.retry}</button> : null}
    </span>
  );
}

// ── managed selection ────────────────────────────────────────────────────────────────────────────────

/** Ported from web/lib/modelIcon.ts — ordered keyword → lobe-icons base slug, first match wins, so the
 *  model brand (deepseek, kimi…) comes before the runner brand (ollama): `ollama/deepseek-…` is a
 *  DeepSeek model. */
const MODEL_ICON_RULES: [RegExp, string][] = [
  [/deepseek/i, 'deepseek'],
  [/claude[\s_-]?code|claudecode/i, 'claudecode'],
  [/claude|anthropic|sonnet|opus|haiku/i, 'claude'],
  [/codex/i, 'codex'],
  [/gpt|openai|chatgpt|\bo[1-4]\b/i, 'openai'],
  [/kimi|\bk2\b|(?:^|\/)k\d+(?:p\d+)?$/i, 'kimi'],
  [/moonshot/i, 'moonshot'],
  [/minimax/i, 'minimax'],
  [/qwen|qwq/i, 'qwen'],
  [/gemini/i, 'gemini'],
  [/mistral|mixtral|codestral|magistral|devstral/i, 'mistral'],
  [/grok/i, 'grok'],
  [/\bxai\b/i, 'xai'],
  [/xiaomi|mimo/i, 'xiaomimimo'],
  [/glm|chatglm|zhipu/i, 'zhipu'],
  [/llama|meta[\s_-]?ai|\bmeta\b/i, 'metaai'],
  [/ollama/i, 'ollama'],
  [/github[\s_-]?copilot|\bcopilot\b/i, 'githubcopilot'],
];
/** Which of those brands ship a `-color` variant in the app's generated MODEL_ICON_SLUGS inventory; the
 *  rest resolve to the mono base. The inventory itself is generated from web/public/models, which this
 *  repo has no copy of, so only the brands the rules can reach are listed. */
const MODEL_ICON_COLOR = new Set(['deepseek', 'claudecode', 'claude', 'codex', 'kimi', 'minimax', 'qwen', 'gemini', 'mistral', 'xiaomimimo', 'zhipu', 'metaai']);

function modelIconSlug(name: string | undefined | null): { slug: string; color: boolean } | null {
  if (!name) return null;
  for (const [re, base] of MODEL_ICON_RULES) {
    if (re.test(name)) return MODEL_ICON_COLOR.has(base) ? { slug: `${base}-color`, color: true } : { slug: base, color: false };
  }
  return null;
}

/** Ported from web/components/ui/ModelIcon.tsx: the brand mark of a model, resolved from its
 *  name/exec string. An unknown name (or an asset that 404s) falls back to the generic glyph rather
 *  than a broken image. */
export function ModelIcon({ name, size = 20, className = '' }: { name?: string | null; size?: number; className?: string }) {
  const icon = modelIconSlug(name);
  const [fallback, setFallback] = useState(false);
  const [failed, setFailed] = useState(false);
  // Reset per icon so a name change from a missing icon to a good one re-tries the asset.
  useEffect(() => { setFallback(false); setFailed(false); }, [icon?.slug]);

  const onError = useCallback(() => {
    if (icon?.color && !fallback) setFallback(true);
    else setFailed(true);
  }, [icon?.color, fallback]);

  if (!icon || failed) return <Cpu size={size} className={className} aria-hidden />;
  const ext = icon.color && fallback ? 'webp' : 'svg';
  return (
    <img
      src={`/models/${icon.slug}.${ext}`}
      alt=""
      className={className}
      style={{ width: size, height: size }}
      aria-hidden
      onError={onError}
    />
  );
}

/** Ported from web/components/ui/Checkbox.tsx — a presentational box; the clickable parent owns the
 *  toggle, which is why it stays `aria-hidden` and the row's `aria-pressed` carries the state. */
export function Checkbox({ checked }: { checked: boolean; className?: string }) {
  return (
    <span aria-hidden data-checked={checked}>
      <Check size={11} strokeWidth={3} />
    </span>
  );
}

interface SelectionSummaryProps {
  /** Count line, e.g. "14 models · 5 providers". Empty hides the line (chip-only summaries). */
  countText: string;
  /** A few representative chips (the caller slices, typically first 3). */
  samples: { label: string; icon?: ReactNode }[];
  /** How many more items exist beyond the samples — renders a "+N" chip when > 0. */
  moreCount: number;
  onManage: () => void;
  manageLabel: string;
  /** More specific accessible name when several managed selections share one page. */
  manageAriaLabel?: string;
  variant?: 'default' | 'line';
}

/** Ported from web/components/ui/SelectionSummary.tsx: the compact on-page summary of a managed
 *  selection — a count line, sample chips and the "Manage" button that opens the modal. The two
 *  `data-selection-*` hooks are the contract the panel is asserted through. */
export function SelectionSummary({ countText, samples, moreCount, onManage, manageLabel, manageAriaLabel }: SelectionSummaryProps) {
  return (
    <div data-selection-summary>
      <div>
        {countText ? <span>{countText}</span> : null}
        {(samples.length > 0 || moreCount > 0) && (
          <div>
            {samples.map((s) => (
              <span key={s.label}>
                {s.icon ? <span aria-hidden>{s.icon}</span> : null}
                <span>{s.label}</span>
              </span>
            ))}
            {moreCount > 0 && <span>+{moreCount}</span>}
          </div>
        )}
      </div>
      <button type="button" data-selection-manage onClick={onManage} aria-label={manageAriaLabel}>
        <Settings2 size={13} aria-hidden />
        {manageLabel}
      </button>
    </div>
  );
}

export interface ManageSelectionItem {
  id: string;
  label: string;
  /** Grouping key — items sharing a group render under one header. `''` pins the item to an ungrouped
   *  section at the top (no header, no filter chip), e.g. a "Default" option or a saved id the
   *  vocabulary no longer lists. */
  group: string;
  /** Display name for the group header/filter chip (falls back to `group`). */
  groupLabel?: string;
  icon?: ReactNode;
  badges?: { text: string; tone?: 'accent' | 'muted' }[];
  /** Row cannot be toggled (e.g. built-in tools) — rendered with `disabledHint` as its title. */
  disabled?: boolean;
  disabledHint?: string;
}

interface ManageSelectionModalProps {
  title: string;
  subtitle?: string;
  open: boolean;
  onClose: () => void;
  items: ManageSelectionItem[];
  selected: Set<string>;
  onSave: (next: Set<string>) => void | Promise<void>;
  saving?: boolean;
  /** Shown in the footer instead of the count when nothing is selected (e.g. "empty = all allowed"). */
  emptySelectionHint?: string;
  countLabel?: (n: number) => string;
  /** Optional icon per group key, shown in the group header and its filter chip. */
  groupIcons?: Record<string, ReactNode>;
  /** Single-select mode: clicking a row REPLACES the selection (radio-like check, no deselect) and the
   *  header chip + footer show the chosen item's label instead of a count. */
  single?: boolean;
}

/** Case- and diacritics-insensitive haystack normalization for the search filter. */
const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Radio-like check for single-select rows — same footprint as the Checkbox, but round. */
function RadioDot({ checked }: { checked: boolean }) {
  return <span aria-hidden data-checked={checked}><span /></span>;
}

/** One selectable row — checkbox in multi mode, radio-like dot in single mode. The row IS the control,
 *  so its `aria-pressed` is what the selection is asserted through. */
function Row({ item, on, single, onToggle }: { item: ManageSelectionItem; on: boolean; single: boolean; onToggle: (item: ManageSelectionItem) => void }) {
  return (
    <button
      type="button"
      onClick={() => onToggle(item)}
      disabled={item.disabled}
      aria-pressed={on}
      title={item.disabled ? item.disabledHint : undefined}
    >
      {item.icon ? <span aria-hidden>{item.icon}</span> : null}
      <span>{item.label}</span>
      {item.badges?.map((b) => <span key={b.text}>{b.text}</span>)}
      {single ? <RadioDot checked={on} /> : <Checkbox checked={on} />}
    </button>
  );
}

/** Ported from web/components/ui/ManageSelectionModal.tsx: search + group filter chips + grouped rows.
 *  Selection is LOCAL until "Save changes" hands the next set to `onSave`; Cancel/Esc discards. When
 *  `onSave` rejects the modal stays open so the user can retry. `single` turns it into a radio-like
 *  picker (a row click replaces the selection); items with `group: ''` render pinned above the grouped
 *  sections. */
export function ManageSelectionModal(props: ManageSelectionModalProps) {
  // Mount the stateful body only while open so local selection re-seeds from `selected` on every open.
  if (!props.open) return null;
  return <ManageSelectionModalBody {...props} />;
}

function ManageSelectionModalBody({
  title, subtitle, onClose, items, selected, onSave, saving = false,
  emptySelectionHint, countLabel, groupIcons, single = false,
}: ManageSelectionModalProps) {
  const { t } = useTranslation();
  const [local, setLocal] = useState<Set<string>>(() => new Set(selected));
  const [query, setQuery] = useState('');
  const [groupFilter, setGroupFilter] = useState<string | null>(null);

  // Unique groups in first-appearance order — drives the filter chips and the section order. Pinned
  // (group '') items live above the sections and never get a chip.
  const groups = useMemo(() => {
    const seen = new Map<string, string>();
    for (const it of items) if (it.group !== '' && !seen.has(it.group)) seen.set(it.group, it.groupLabel ?? it.group);
    return [...seen.entries()].map(([id, label]) => ({ id, label }));
  }, [items]);

  const q = fold(query.trim());
  // Pinned rows ignore the group filter (they belong to no group) but still honor the search.
  const pinned = items.filter((it) => it.group === '' && (!q || fold(it.label).includes(q)));
  const visible = items.filter((it) =>
    it.group !== ''
    && (!groupFilter || it.group === groupFilter)
    && (!q || fold(it.label).includes(q) || fold(it.groupLabel ?? it.group).includes(q)));

  const toggle = (item: ManageSelectionItem) => {
    if (item.disabled) return;
    if (single) { setLocal(new Set([item.id])); return; } // radio semantics — a click replaces the pick
    setLocal((prev) => {
      const next = new Set(prev);
      if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
      return next;
    });
  };

  // Single mode surfaces the chosen item's label (header chip + footer) instead of a count.
  const chosen = single ? items.find((it) => local.has(it.id)) : undefined;
  const chosenLabel = chosen?.label ?? emptySelectionHint ?? '—';

  const save = async () => {
    try {
      const result = onSave(new Set(local));
      // Synchronous pickers close in the same interaction frame; async persistence keeps the modal open
      // until it resolves so failures remain retryable.
      if (result) await result;
      onClose();
    } catch {
      // The caller surfaces the failure (toast); keep the modal open so the user can retry.
    }
  };

  return (
    <Modal title={title} description={subtitle} onClose={onClose} size="xl">
      <ModalBody>
        <div>
          <div>
            <Search size={13} aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.managePicker.searchPlaceholder}
              aria-label={t.managePicker.searchPlaceholder}
            />
          </div>
          <span>{single ? chosenLabel : t.managePicker.selectedCount.replace('{n}', String(local.size))}</span>
        </div>

        {groups.length > 1 && (
          <div role="tablist" aria-label={t.managePicker.filterByGroup}>
            <button type="button" role="tab" aria-selected={groupFilter === null} onClick={() => setGroupFilter(null)}>
              {t.managePicker.all}
            </button>
            {groups.map((g) => (
              <button key={g.id} type="button" role="tab" aria-selected={groupFilter === g.id} onClick={() => setGroupFilter(g.id)}>
                {groupIcons?.[g.id]}
                {g.label}
              </button>
            ))}
          </div>
        )}

        {pinned.length === 0 && visible.length === 0
          ? <p>{t.managePicker.noResults}</p>
          : (
            <div>
              {pinned.length > 0 && (
                <ul>
                  {pinned.map((item) => <li key={item.id}><Row item={item} on={local.has(item.id)} single={single} onToggle={toggle} /></li>)}
                </ul>
              )}
              {groups.map((g) => {
                const groupItems = visible.filter((it) => it.group === g.id);
                if (groupItems.length === 0) return null;
                return (
                  <section key={g.id}>
                    <h3>
                      {groupIcons?.[g.id]}
                      {g.label}
                    </h3>
                    <ul>
                      {groupItems.map((item) => (
                        <li key={item.id}><Row item={item} on={local.has(item.id)} single={single} onToggle={toggle} /></li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
      </ModalBody>
      <ModalFooter
        status={
          <span>
            {single
              ? chosenLabel
              : local.size === 0 && emptySelectionHint
                ? emptySelectionHint
                : (countLabel ?? ((n: number) => t.managePicker.selectedCount.replace('{n}', String(n))))(local.size)}
          </span>
        }
      >
        <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>{t.common.cancel}</Button>
        <Button type="button" variant="accent" onClick={save} disabled={saving}>
          {saving ? t.common.saving : t.managePicker.saveChanges}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

interface BrainModelOption { provider: string; providerLabel?: string; model: string }

/** Ported from web/components/ui/BrainModelField.tsx. Single-select brain-model picker: a compact
 *  summary chip + a Manage modal grouping the catalog by provider, every group header carrying the
 *  provider's brand logo and every row its model icon. A pinned row (id `''`) is the "default" pick; a
 *  saved model the catalog no longer lists stays visible as a pinned, selected row so a save can never
 *  silently drop it. `keyOf` bridges the caller's id encoding — the empty string always means default. */
export function BrainModelField({ value, onChange, models, title, subtitle, defaultLabel, keyOf, allowDefault = true, manageAriaLabel }: {
  value: string;
  onChange: (key: string) => void;
  models: BrainModelOption[];
  title: string;
  subtitle?: string;
  defaultLabel: string;
  keyOf: (m: BrainModelOption) => string;
  allowDefault?: boolean;
  manageAriaLabel?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const selected = models.find((m) => keyOf(m) === value);

  const items: ManageSelectionItem[] = [
    ...(allowDefault ? [{ id: '', label: defaultLabel, group: '' }] : []),
    ...(value && !selected ? [{ id: value, label: value, group: '', icon: <ModelIcon name={value} size={14} /> }] : []),
    ...models.map((m) => ({
      id: keyOf(m),
      label: m.model,
      group: m.provider,
      groupLabel: m.providerLabel,
      icon: <ModelIcon name={m.model} size={14} />,
    })),
  ];
  // Provider brand logo on each group header/chip, resolved from the provider LABEL (Anthropic, OpenAI…)
  // and keyed by provider id; a custom endpoint with no known brand falls back to the generic glyph.
  const groupIcons = Object.fromEntries(
    [...new Map(models.map((m) => [m.provider, m.providerLabel])).entries()]
      .map(([provider, label]) => [provider, <ModelIcon key={provider} name={label} size={14} />]),
  );

  return (
    <>
      <SelectionSummary
        countText=""
        samples={[value
          ? { label: selected?.model ?? value, icon: <ModelIcon name={selected?.model ?? value} size={13} /> }
          : { label: defaultLabel }]}
        moreCount={0}
        onManage={() => setOpen(true)}
        manageLabel={t.managePicker.manage}
        manageAriaLabel={manageAriaLabel}
      />
      <ManageSelectionModal
        title={title}
        subtitle={subtitle}
        open={open}
        onClose={() => setOpen(false)}
        items={items}
        selected={new Set([value])}
        single
        groupIcons={groupIcons}
        onSave={(next) => onChange([...next][0] ?? '')}
      />
    </>
  );
}

// ── MarkdownAssetEditor ──────────────────────────────────────────────────────────────────────────────
// The shared register behind both markdown-asset panels (skills + sub-agents). The plugin injects its
// divergent bits — extra form fields, per-row controls, badges, the ownership column and the save
// strategy — so this component is most of what the UI test drives. Ported from
// web/modules/settings/MarkdownAssetEditor.tsx.

/** Mirrors NAME_RE in the daemon's validation for both skills and sub-agents. */
const NAME_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;
/** One page of entries — the same register size the built-in workspaces page at. */
const PAGE_SIZE = 20;

type SourceFilter = 'all' | 'user' | 'builtin';

interface MarkdownAsset { name: string; description: string; source: string; owner?: number | null; canDelete?: boolean }

/** Identity of a row. Not the name: with per-user assets the same name legitimately exists twice. */
const assetKey = (item: MarkdownAsset): string => `${item.source}:${item.owner ?? 'instance'}:${item.name}`;

export function MarkdownAssetEditor(props: any) {
  const {
    query, labels, emptyForm, formFromItem, extraValid, renderBadges, renderRowControl, ownership,
    renderFieldsBeforeBody, renderFieldsAfterBody, onSave, saving, onDelete, creating, onCreatingChange,
    addAction,
  } = props;
  const { t } = useTranslation();
  const { toast } = useToast();
  const [form, setForm] = useState<any>(null);
  // The item behind the open form / the pending delete, not just its name — see `assetKey`.
  const [editing, setEditing] = useState<any>(null);
  const [pendingDelete, setPendingDelete] = useState<any>(null);
  const [search, setSearch] = useState('');
  const [source, setSource] = useState<SourceFilter>('all');
  const [scope, setScope] = useState('all');
  const [page, setPage] = useState(0);

  // The hero's add button only flips a flag; the blank form is this component's to own, and an edit
  // already in the drawer wins — the flag must not wipe what the user is typing.
  useEffect(() => { if (creating) setForm((cur: any) => cur ?? emptyForm); }, [creating, emptyForm]);
  // A narrowed list can be shorter than the page the user is on; landing on an empty page reads as
  // "nothing matches" when the matches are simply on page 1.
  useEffect(() => { setPage(0); }, [search, source, scope]);

  const { data, isLoading, isError } = query;
  const items: MarkdownAsset[] = useMemo(() => data ?? [], [data]);
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const scopeRule = ownership?.scopes.find((sc: any) => sc.value === scope);
    return items.filter((item) => {
      if (source === 'user' && item.source !== 'user') return false;
      if (source === 'builtin' && item.source === 'user') return false;
      if (scopeRule && !scopeRule.matches(item)) return false;
      if (needle === '') return true;
      return item.name.toLowerCase().includes(needle) || item.description.toLowerCase().includes(needle);
    });
  }, [items, search, source, scope, ownership]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const clampedPage = Math.min(page, pageCount - 1);
  const pageItems = useMemo(() => filtered.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE), [filtered, clampedPage]);

  if (isError) return <ControlSurfaceState tone="danger"><ErrorState message={t.common.daemonUnreachable} onRetry={() => query.refetch()} /></ControlSurfaceState>;
  if (isLoading || !data) return <ControlSurfaceState><LoadingState variant="cards" /></ControlSurfaceState>;

  const patch = (p: any) => setForm((cur: any) => (cur ? { ...cur, ...p } : cur));
  const closeForm = () => { setForm(null); setEditing(null); onCreatingChange(false); };
  const nameValid = form !== null && NAME_RE.test(form.name.trim());
  const savable = form !== null && (form.editing !== null || nameValid)
    && form.description.trim() !== '' && form.body.trim() !== '' && (extraValid?.(form) ?? true);

  const submit = () => {
    if (!form || !savable) return;
    onSave(form, {
      onSuccess: () => { closeForm(); toast(form.editing !== null ? labels.updated : labels.created); },
      onError: (e: unknown) => toast(apiErrorMessage(e), 'error'),
    });
  };

  const confirmDelete = () => {
    if (!pendingDelete) return;
    onDelete(pendingDelete, {
      onSuccess: () => toast(labels.deleted),
      onError: (e: unknown) => toast(apiErrorMessage(e), 'error'),
    });
    // The open drawer belongs to the row that is going away.
    if (editing && assetKey(editing) === assetKey(pendingDelete)) closeForm();
    setPendingDelete(null);
  };

  return (
    <div className="markdown-asset-editor">
      <ControlSurfaceToolbar>
        <div className="markdown-asset-editor__toolbar">
          <div>
            <Search size={14} aria-hidden />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t.assetEditor.search} />
          </div>
          {/* One filter row, never two: an asset type with ownership scopes already splits the same set
              more finely (mine / instance / bundled), so showing the coarse source filter beside it would
              offer two controls whose answers overlap — and "Built-in" in both of them. */}
          {ownership ? (
            <Segmented
              value={scope}
              onChange={setScope}
              options={[{ value: 'all', label: t.assetEditor.filterAll }, ...ownership.scopes.map((sc: any) => ({ value: sc.value, label: sc.label }))]}
              aria-label={ownership.header}
              nowrap
            />
          ) : (
            <Segmented
              value={source}
              onChange={(value) => setSource(value as SourceFilter)}
              options={[
                { value: 'all', label: t.assetEditor.filterAll },
                { value: 'user', label: t.assetEditor.filterUser },
                { value: 'builtin', label: t.assetEditor.filterBuiltin },
              ]}
              aria-label={t.assetEditor.filterAll}
              nowrap
            />
          )}
          {addAction}
        </div>
      </ControlSurfaceToolbar>

      <ControlSurfaceRegister>
        {items.length === 0 ? <EmptyState title={labels.empty} />
          : filtered.length === 0 ? <EmptyState title={t.assetEditor.emptySearch} icon={Search} />
          : (
            <div>
              <DataTable ariaLabel={t.assetEditor.colName}>
                <DataTableRow header>
                  <DataTableCell header>{t.assetEditor.colName}</DataTableCell>
                  <DataTableCell header priority="wide">{t.assetEditor.colDescription}</DataTableCell>
                  {ownership ? <DataTableCell header priority="wide">{ownership.header}</DataTableCell> : null}
                  <DataTableCell header priority="wide" role="presentation" aria-hidden>{null}</DataTableCell>
                  <DataTableCell header priority="wide" role="presentation" aria-hidden>{null}</DataTableCell>
                  <DataTableCell header role="presentation" aria-hidden>{null}</DataTableCell>
                </DataTableRow>
                {pageItems.map((item) => {
                  // Two different questions, deliberately kept apart: WHERE the entry came from (drives the
                  // badge and the source filter, so the same row reads the same way for everyone) and
                  // whether THIS caller may write it (drives the controls). An instance-wide skill shown to
                  // somebody who may not edit it is still a custom skill, not a built-in one.
                  const isUser = item.source === 'user';
                  const editable = isUser && item.canDelete !== false;
                  const open = () => { if (editable) { setForm(formFromItem(item)); setEditing(item); } };
                  const isOpen = editing !== null && assetKey(editing) === assetKey(item);
                  return (
                    <DataTableRow key={assetKey(item)} interactive={editable} selected={isOpen} aria-selected={isOpen} className="group">
                      <DataTableCell>
                        {editable
                          ? <button type="button" onClick={open}>{item.name}</button>
                          : <span>{item.name}</span>}
                      </DataTableCell>
                      <DataTableCell priority="wide" title={item.description}>{item.description || '—'}</DataTableCell>
                      {ownership ? (
                        <DataTableCell priority="wide" title={ownership.label(item)}>{ownership.label(item)}</DataTableCell>
                      ) : null}
                      <DataTableCell priority="wide">
                        <Badge>{isUser ? labels.badgeUser : labels.badgeBuiltin}</Badge>
                        {renderBadges?.(item)}
                      </DataTableCell>
                      <DataTableCell priority="wide">{editable ? renderRowControl?.(item) : null}</DataTableCell>
                      <DataTableCell>
                        {editable ? (
                          <>
                            <Button icon={Trash2} aria-label={labels.remove} onClick={() => setPendingDelete(item)} />
                            <ChevronRight size={15} aria-hidden />
                          </>
                        ) : null}
                      </DataTableCell>
                    </DataTableRow>
                  );
                })}
              </DataTable>

              <div className="markdown-asset-editor__pager">
                <span>
                  {t.assetEditor.pageRange
                    .replace('{from}', String(clampedPage * PAGE_SIZE + 1))
                    .replace('{to}', String(clampedPage * PAGE_SIZE + pageItems.length))
                    .replace('{total}', String(filtered.length))}
                </span>
                <div>
                  <Button icon={ChevronLeft} disabled={clampedPage === 0} onClick={() => setPage(clampedPage - 1)}>{t.assetEditor.prevPage}</Button>
                  <span>{t.assetEditor.pageLabel.replace('{page}', String(clampedPage + 1)).replace('{pages}', String(pageCount))}</span>
                  <Button disabled={clampedPage >= pageCount - 1} onClick={() => setPage(clampedPage + 1)}>{t.assetEditor.nextPage}<ChevronRight size={15} aria-hidden /></Button>
                </div>
              </div>
            </div>
          )}
      </ControlSurfaceRegister>

      {form ? (
        <WorkspaceDetailRail
          label={form.editing !== null ? form.editing : labels.addTitle}
          closeLabel={t.common.close}
          onClose={closeForm}
        >
          <div className="markdown-asset-editor__form">
            <div className="markdown-asset-editor__grid">
              <Field label={labels.name} hint={labels.nameHint}>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((cur: any) => (cur ? { ...cur, name: e.target.value } : cur))}
                  disabled={form.editing !== null}
                  placeholder={labels.namePlaceholder}
                />
              </Field>
              <Field label={labels.description} hint={labels.descriptionHint}>
                <Input value={form.description} onChange={(e) => setForm((cur: any) => (cur ? { ...cur, description: e.target.value } : cur))} />
              </Field>
            </div>
            {renderFieldsBeforeBody?.(form, patch)}
            <Field label={labels.body} hint={labels.bodyHint}>
              <textarea value={form.body} onChange={(e) => setForm((cur: any) => (cur ? { ...cur, body: e.target.value } : cur))} rows={14} placeholder={labels.bodyPlaceholder} />
            </Field>
            {renderFieldsAfterBody?.(form, patch)}
            <div className="markdown-asset-editor__actions">
              <Button onClick={submit} disabled={!savable || saving}>{labels.save}</Button>
              <Button onClick={closeForm}>{labels.cancel}</Button>
              {editing !== null ? <Button icon={Trash2} onClick={() => setPendingDelete(editing)}>{labels.remove}</Button> : null}
            </div>
          </div>
        </WorkspaceDetailRail>
      ) : null}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={labels.deleteTitle}
        description={pendingDelete ? labels.deleteDesc.replace('{name}', pendingDelete.name) : undefined}
        confirmLabel={labels.remove}
        onConfirm={confirmDelete}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
}
