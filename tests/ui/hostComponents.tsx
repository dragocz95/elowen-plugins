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
  createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState,
  type ButtonHTMLAttributes, type CSSProperties, type HTMLAttributes, type InputHTMLAttributes, type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import {
  CalendarDays, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Coins, Cpu, FolderGit2,
  GitCommitHorizontal, Link2, Loader2, Maximize2, Search, Settings2, Timer, Trash2, TriangleAlert,
  XCircle, type LucideIcon,
} from 'lucide-react';
import { apiErrorMessage, type Task } from './hostClient';
import {
  useAgentsPlugin, useBrainModels, useConfig, useProjectGit, useProjects, useSessionInfos,
  useSessionPane, useTaskUsage, useTasks, useToast, useTranslation, type StallState,
} from './hostHooks';
import {
  agentDisplayName, allModels as allModelsUtil, DIVIDER, execModel, formatCost, formatTokens,
  liveState, PROVIDERS, taskAgentName, taskElapsed, taskExec, taskForSession, taskSessionName,
  tailSnippet, type DateRange, type DerivedSignal, type RangePreset, type Tone,
} from './hostUtils';
import { ProjectIcon } from './hostProjectIcon';
import type { SaveStatus } from './useAutoSaveStatus';

export { ProjectIcon };
export { DIVIDER as contextMenuDivider };

/** The instance's display name — the app reads it from the brand config; here it is the default, which
 *  is what the moved suites assert the hero mascot is labelled with. */
const APP_NAME = 'Elowen';

// ── primitives ───────────────────────────────────────────────────────────────────────────────────────

export function Badge({ children, tone = 'default' }: { children: ReactNode; tone?: Tone }) {
  return <span className="badge" data-tone={tone}>{children}</span>;
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

export function HelpTip({ children }: { children: ReactNode }) {
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

/** Responsive register table. Wide-only cells disappear as a unit and the compact grid closes ranks.
 *  The column tracks travel as CSS custom properties, which is the part a panel asserts on: the layout
 *  itself is stylesheet work jsdom never runs, but WHICH tracks a view asked for is its own decision. */
type TableStyle = CSSProperties & { '--data-table-columns'?: string; '--data-table-compact-columns'?: string };

export function DataTable({ ariaLabel, columns, compactColumns = 'minmax(0,1fr)', children, className = '', ...rest }: {
  ariaLabel: string; columns: string; compactColumns?: string; children: ReactNode; className?: string;
} & Omit<HTMLAttributes<HTMLDivElement>, 'children'>) {
  const style: TableStyle = { '--data-table-columns': columns, '--data-table-compact-columns': compactColumns };
  return <div role="table" aria-label={ariaLabel} style={style} className={`@container overflow-x-clip rounded-lg border border-border/80 ${className}`} {...rest}>{children}</div>;
}
export function DataTableRow({ children, header = false, selected = false, interactive = false, className = '', ...rest }: {
  children: ReactNode; header?: boolean; selected?: boolean; interactive?: boolean;
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="row"
      data-state={selected ? 'selected' : 'idle'}
      className={`data-table-grid items-center gap-x-3 border-b border-border/70 px-4 last:border-b-0 ${header ? 'data-table-header sticky top-0 z-10 py-2.5' : `py-3.5 ${interactive ? 'interactive-row' : ''}`} ${selected ? 'bg-accent/[0.055]' : ''} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
export function DataTableCell({ children, header = false, priority = 'always', className = '', ...rest }: {
  children: ReactNode; header?: boolean; priority?: 'always' | 'wide';
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role={header ? 'columnheader' : 'cell'}
      data-priority={priority}
      className={`${priority === 'wide' ? 'data-table-wide' : ''} min-w-0 ${header ? 'text-[10px] font-semibold uppercase tracking-wider text-text-muted' : ''} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
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

/** The workspace mascot. The app's WebGL scene is skipped under test even in production code; what a
 *  page depends on — and what the moved suites count, to prove a page grew exactly one hero — is the
 *  `role="img"` named after the instance. */
export function SpatialMascot() {
  return <div className="spatial-mascot" role="img" aria-label={APP_NAME} />;
}

/** The page's primary section switcher: a radiogroup of section nodes, each named "<label> <count>"
 *  when it carries one, with the arrow/Home/End roving the selection. */
export interface SpatialDeckSection { id: string; label: string; icon: LucideIcon; description?: string; count?: number }

export function SpatialSectionRail({ sections, value, onChange, ariaLabel }: {
  sections: SpatialDeckSection[];
  value: string;
  onChange: (id: string) => void;
  ariaLabel: string;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const move = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % sections.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + sections.length) % sections.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = sections.length - 1;
    else return;
    event.preventDefault();
    const section = sections[next];
    if (!section) return;
    onChange(section.id);
    refs.current[section.id]?.focus();
  };
  return (
    <div data-testid="spatial-section-rail" className="spatial-section-rail">
      <nav role="radiogroup" aria-label={ariaLabel} className="spatial-section-rail__track">
        {sections.map((section, index) => {
          const selected = section.id === value;
          const Icon = section.icon;
          return (
            <button
              key={section.id}
              ref={(node) => { refs.current[section.id] = node; }}
              type="button"
              role="radio"
              aria-label={section.count === undefined ? section.label : `${section.label} ${section.count}`}
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(section.id)}
              onKeyDown={(event) => move(event, index)}
              className={`spatial-section-node ${selected ? 'spatial-section-node--active' : ''}`}
            >
              {Icon ? <span className="spatial-section-node__icon"><Icon size={17} aria-hidden /></span> : null}
              <span className="spatial-section-node__label">{section.label}{section.count !== undefined ? <span className="spatial-section-node__count">{section.count}</span> : null}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
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
        <div className="spatial-workspace-hero__mascot" data-testid="workspace-hero-mascot"><SpatialMascot /></div>
        <div className="spatial-workspace-hero__metrics">{children}</div>
      </div>
    </section>
  );
}

export function SpatialWorkspaceLayout({ hero, navigation, children, className = '' }: {
  hero: { eyebrow?: string; title: string; count?: number; description?: string; status?: ReactNode; action?: ReactNode; mascotState?: string; metrics: ReactNode };
  navigation?: { sections: SpatialDeckSection[]; value: string; onChange: (id: string) => void; ariaLabel: string };
  children: ReactNode;
  className?: string;
}) {
  const { metrics, ...heroProps } = hero;
  return (
    <WorkspacePage className={`spatial-workspace-layout ${className}`}>
      <div className="spatial-workspace-layout__hero">
        <SpatialWorkspaceHero {...heroProps}>{metrics}</SpatialWorkspaceHero>
      </div>
      {navigation ? <SpatialSectionRail {...navigation} /> : null}
      <div className="workspace-content" data-testid="spatial-workspace-layout">{children}</div>
    </WorkspacePage>
  );
}

/** The slim header a workspace wears when it is mostly one working surface (no mascot hero). */
export function CompactWorkspaceHeader({ eyebrow, title, count, description, status, action, icon: Icon }: {
  eyebrow?: string; title: string; count?: number; description?: string;
  status?: ReactNode; action?: ReactNode; icon?: LucideIcon;
}) {
  return (
    <header className="workspace-header">
      <div>
        {Icon ? <span className="workspace-header__icon"><Icon size={20} aria-hidden /></span> : null}
        <div>
          {eyebrow ? <div className="workspace-header__eyebrow">{eyebrow}</div> : null}
          <div>
            <h1>{title}</h1>
            {count !== undefined ? <span className="workspace-header__count">{count}</span> : null}
          </div>
          {description ? <p>{description}</p> : null}
        </div>
      </div>
      <div className="workspace-header__actions">{status}{action}</div>
    </header>
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
export function Modal({ title, description, onClose, children }: {
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
export function ModalBody({ children }: { children: ReactNode; gap?: 4 | 5 | 6 }) {
  return <div className="modal-body">{children}</div>;
}

export function ModalFooter({ children, status }: { children?: ReactNode; status?: ReactNode }) {
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

// ── page chrome ──────────────────────────────────────────────────────────────────────────────────────

/** Publishes the page title into the shell masthead and renders only the page's own toolbar below it.
 *  There is no masthead in this repo, so the title is rendered inline — what a panel depends on is that
 *  the toolbar children land in a wrapping flex row, which is what its layout assertions read. */
export function ModuleHeader({ title: _title, subtitle, children }: { title: string; count?: number; icon?: LucideIcon; children?: ReactNode; subtitle?: string }) {
  if (!children && !subtitle) return null;
  return (
    <div className="mb-6 flex flex-col gap-2">
      {subtitle ? <p>{subtitle}</p> : null}
      {children ? <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">{children}</div> : null}
    </div>
  );
}

export function IconButton({ icon: Icon, label, onClick, disabled = false }: { icon: LucideIcon; label: string; onClick?: () => void; variant?: 'default' | 'danger'; disabled?: boolean }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled}>
      <Icon size={14} aria-hidden />
    </button>
  );
}

export function EntityList({ children, className = '', ...rest }: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return <div role="list" className={className} {...rest}>{children}</div>;
}

export function EntityRow({ children, selected = false, busy = false, interactive = true, className = '', ...rest }: {
  children: ReactNode; selected?: boolean; busy?: boolean; interactive?: boolean;
} & HTMLAttributes<HTMLDivElement>) {
  const state = busy ? 'busy' : selected ? 'selected' : 'idle';
  return (
    <div role="listitem" data-state={state} aria-busy={busy || undefined} className={`${interactive ? 'interactive-row' : ''} min-w-0 px-4 py-3.5 ${className}`} {...rest}>
      {children}
    </div>
  );
}

/** The app's Motion wrappers, without the motion library. Their whole contract to a plugin panel is
 *  "render my children in a div and keep exits out of the way"; the animation itself is app chrome that
 *  jsdom could not observe anyway, and pulling a motion runtime in for it would only add a second
 *  scheduler between a click and the assertion after it. */
export function MotionPresence({ children }: { children: ReactNode; mode?: string }) { return <>{children}</>; }
export function MotionLayout({ children, ...rest }: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) { return <div {...rest}>{children}</div>; }
export function MotionLayoutItem({ children, layoutId: _layoutId, ...rest }: HTMLAttributes<HTMLDivElement> & { children: ReactNode; layoutId?: string }) {
  return <div {...rest}>{children}</div>;
}
export function MotionReveal({ children, delay: _delay, ...rest }: HTMLAttributes<HTMLDivElement> & { children: ReactNode; delay?: number }) {
  return <div {...rest}>{children}</div>;
}

// ── loading line ─────────────────────────────────────────────────────────────────────────────────────

export function LoadingLine({ label, spinner = false }: { label?: string; layout?: 'inline' | 'block' | 'page'; spinner?: boolean }) {
  const { t } = useTranslation();
  return (
    <span role="status" aria-live="polite">
      {spinner ? <Spinner size="md" /> : null}
      <span>{label ?? t.common.loading}</span>
    </span>
  );
}

// ── project identity ─────────────────────────────────────────────────────────────────────────────────

/** Small muted pill naming the project a card belongs to. Hidden in a single-project workspace unless
 *  the caller passes `always` (on a session card, "where is this agent working" is confirmation). */
export function ProjectPill({ projectId, always = false }: { projectId?: number; always?: boolean }) {
  const { data: projects } = useProjects();
  if (projectId == null || !projects || (!always && projects.length < 2)) return null;
  const project = projects.find((p) => p.id === projectId);
  if (!project) return null;
  return (
    <span title={project.path}>
      <ProjectIcon project={project} size={11} />
      <span>{project.slug}</span>
    </span>
  );
}

/** How many project pills show before the tail folds behind "+N more". */
const PROJECT_PREVIEW = 5;

/** The shared project filter: "All projects" plus one entry per accessible project, hidden entirely
 *  when the workspace has fewer than two (no choice to make). The host owns the value and persists it.
 *  Two shapes, both in production: a `role="group"` of toggle pills, and a `role="menu"` dropdown whose
 *  options are `menuitemradio` — the pages moved here use the dropdown. */
export function ProjectFilterPills({ value, onChange, includeAll = true, variant = 'pills' }: {
  value: number | 'all'; onChange: (v: number | 'all') => void; includeAll?: boolean; variant?: 'pills' | 'dropdown';
}) {
  const { data: projects } = useProjects();
  const { t } = useTranslation();
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || variant !== 'dropdown') return;
    const onPointerDown = (event: PointerEvent) => { if (!dropdownRef.current?.contains(event.target as Node)) setOpen(false); };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('pointerdown', onPointerDown); document.removeEventListener('keydown', onKeyDown); };
  }, [open, variant]);
  if (!projects || projects.length < 2) return null;

  if (variant === 'dropdown') {
    const selected = value === 'all' ? null : projects.find((project) => project.id === value);
    const choose = (next: number | 'all') => { onChange(next); setOpen(false); };
    return (
      <div ref={dropdownRef} className="relative">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={t.tasks.filterProjectsAria}
          onClick={() => setOpen((current) => !current)}
        >
          <FolderGit2 size={13} aria-hidden />
          <span>{selected?.slug ?? t.tasks.filterAllProjects}</span>
          <ChevronDown size={13} aria-hidden />
        </button>
        {open ? (
          <div role="menu" aria-label={t.tasks.filterProjectsAria}>
            {includeAll ? (
              <button type="button" role="menuitemradio" aria-checked={value === 'all'} onClick={() => choose('all')}>
                <FolderGit2 size={14} aria-hidden />
                <span>{t.tasks.filterAllProjects}</span>
                {value === 'all' ? <Check size={15} aria-hidden /> : null}
              </button>
            ) : null}
            <div role="separator" />
            {projects.map((project) => (
              <button key={project.id} type="button" role="menuitemradio" aria-checked={value === project.id} onClick={() => choose(project.id)} title={project.path}>
                <ProjectIcon project={project} size={14} />
                <span>{project.slug}</span>
                {value === project.id ? <Check size={15} aria-hidden /> : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  const folded = !showAll && projects.length > PROJECT_PREVIEW;
  const head = folded ? projects.slice(0, PROJECT_PREVIEW) : projects;
  const selectedProject = folded ? projects.find((p) => p.id === value) : undefined;
  // A selected project inside the folded tail rides along as one extra pill — picking one must never
  // reshuffle the row.
  const visible = selectedProject && !head.some((p) => p.id === selectedProject.id) ? [...head, selectedProject] : head;
  return (
    <div role="group" aria-label={t.tasks.filterProjectsAria}>
      {includeAll ? (
        <button type="button" aria-pressed={value === 'all'} onClick={() => onChange('all')}>
          <FolderGit2 size={13} aria-hidden />{t.tasks.filterAllProjects}
        </button>
      ) : null}
      {visible.map((p) => (
        <button key={p.id} type="button" aria-pressed={value === p.id} onClick={() => onChange(p.id)} title={p.path}>
          <ProjectIcon project={p} size={13} /><span>{p.slug}</span>
        </button>
      ))}
      {projects.length > PROJECT_PREVIEW ? (
        <button type="button" aria-expanded={showAll} onClick={() => setShowAll((v) => !v)}>
          {showAll ? t.pills?.showLess ?? 'Show less' : (t.pills?.showMore ?? '+{n} more').replace('{n}', String(projects.length - visible.length))}
        </button>
      ) : null}
    </div>
  );
}

// ── menus ────────────────────────────────────────────────────────────────────────────────────────────

interface MenuAction { label: string; icon?: LucideIcon; onClick: () => void; danger?: boolean; disabled?: boolean }
interface MenuSubmenu { label: string; icon?: LucideIcon; disabled?: boolean; items: MenuEntry[] }
type MenuEntry = MenuAction | MenuSubmenu | typeof DIVIDER;

const isSubmenu = (e: MenuEntry): e is MenuSubmenu => e !== DIVIDER && 'items' in e;

/** The floating right-click menu, with one level of submenus. Closes on outside click, Esc or after a
 *  leaf runs. The app also clamps it to the viewport; jsdom measures everything as zero, so the
 *  positioning maths is the one part that does not travel. */
export function ContextMenu({ state, onClose }: { state: { x: number; y: number; items: MenuEntry[] }; onClose: () => void }) {
  useEffect(() => {
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) onClose(); };
    // Deferred a tick: the opening right-click must not instantly close it.
    const id = window.setTimeout(() => window.addEventListener('mousedown', close), 0);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
    };
  }, [onClose]);

  return createPortal(
    <div role="menu" className="overlay-layer-menu" style={{ left: state.x, top: state.y }} onMouseDown={(e) => e.stopPropagation()}>
      {state.items.map((item, i) => <MenuRow key={i} entry={item} index={i} onClose={onClose} />)}
    </div>,
    document.body,
  );
}

function MenuRow({ entry, index, onClose }: { entry: MenuEntry; index: number; onClose: () => void }) {
  if (entry === DIVIDER) return <div aria-hidden className="menu-divider" />;
  if (isSubmenu(entry)) return <SubmenuRow entry={entry} onClose={onClose} />;
  const Icon = entry.icon;
  return (
    <button type="button" role="menuitem" data-index={index} disabled={entry.disabled} onClick={() => { entry.onClick(); onClose(); }}>
      {Icon ? <Icon size={13} aria-hidden /> : null}
      <span>{entry.label}</span>
    </button>
  );
}

function SubmenuRow({ entry, onClose }: { entry: MenuSubmenu; onClose: () => void }) {
  const [open, setOpen] = useState(false);
  const Icon = entry.icon;
  return (
    <div onMouseEnter={() => !entry.disabled && setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={entry.disabled}
        onClick={() => !entry.disabled && setOpen((o) => !o)}
      >
        {Icon ? <Icon size={13} aria-hidden /> : null}
        <span>{entry.label}</span>
        <ChevronRight size={13} aria-hidden />
      </button>
      {open && !entry.disabled ? (
        <div role="menu">{entry.items.map((item, i) => <MenuRow key={i} entry={item} index={i} onClose={onClose} />)}</div>
      ) : null}
    </div>
  );
}

export type ActionMenuItem = { label: string; tone?: 'default' | 'danger'; onSelect: () => void; icon?: LucideIcon; iconNode?: ReactNode };

/** The hover/click action menu. Its trigger is a button named by `label`, and the items are
 *  `role="menuitem"` — which is why a suite tells the trigger apart from a same-named confirm button by
 *  `aria-haspopup`. */
export function ActionMenu({ items, label, trigger }: {
  items: ActionMenuItem[]; label?: string; trigger?: ReactNode; triggerClassName?: string; align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();
  const resolvedLabel = label ?? t.common.actions;
  return (
    <div className="relative" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" aria-label={resolvedLabel} aria-haspopup="menu" aria-expanded={open} title={resolvedLabel} onClick={() => setOpen((o) => !o)}>
        {trigger ?? <Trash2 size={15} aria-hidden />}
      </button>
      {open ? (
        <div role="menu">
          {items.map((it) => {
            const Icon = it.icon;
            return (
              <button key={it.label} type="button" role="menuitem" onClick={() => { setOpen(false); it.onSelect(); }}>
                {it.iconNode ?? (Icon ? <Icon size={15} aria-hidden /> : null)}
                {it.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

// ── task presentation ────────────────────────────────────────────────────────────────────────────────

/** Green ✓ / red ✕ badge for a closed task's outcome; nothing without one. */
export function OutcomeBadge({ outcome }: { outcome?: string | null }) {
  const { t } = useTranslation();
  if (!outcome) return null;
  const fail = outcome === 'fail';
  return (
    <Badge tone={fail ? 'danger' : 'success'}>
      {fail ? <XCircle size={11} aria-hidden /> : <CheckCircle2 size={11} aria-hidden />}
      {fail ? t.tasks.outcomeFail : t.tasks.outcomeOk}
    </Badge>
  );
}

/** One-line agent identity: the friendly agent name (or the model as a fallback) and the run duration,
 *  frozen once the task finishes. */
export function AgentIdentityStrip({ task, showTime = true, showIcon = false, iconSize = 14 }: { task: Task; showTime?: boolean; showIcon?: boolean; iconSize?: number }) {
  const { data: config } = useConfig();
  const exec = taskExec(task.labels) || (config as { defaults?: { exec?: string } } | undefined)?.defaults?.exec || '';
  const identity = taskSessionName(task) ?? taskAgentName(task) ?? exec;
  const ran = showTime ? taskElapsed(task, Date.now()) : null;
  if (!identity && !ran) return null;
  return (
    <div>
      {showIcon ? <ModelIcon name={exec} size={iconSize} /> : null}
      {identity ? <span>{agentDisplayName(identity)}</span> : null}
      {ran ? <><span aria-hidden>·</span><span><Timer size={11} aria-hidden />{ran}</span></> : null}
    </div>
  );
}

/** The live-state dot. Gated on the agents plugin product-wide: without it the dot could only ever say
 *  a meaningless neutral 'idle', so it hides rather than lie. */
export function AgentStatusDot({ signal, live = false, stall, silenceSec = 0 }: {
  signal?: DerivedSignal; live?: boolean; size?: 'sm' | 'md'; stall?: StallState; silenceSec?: number;
}) {
  const { t } = useTranslation();
  const agentsUi = useAgentsPlugin();
  if (!agentsUi) return null;
  const state = stall === 'stuck' ? 'stuck' : stall === 'stalled' ? 'stalled' : liveState(signal, live);
  const minutes = String(Math.max(1, Math.floor(silenceSec / 60)));
  const label = state === 'stalled' ? t.agent.stalled.replace('{min}', minutes)
    : state === 'stuck' ? t.agent.stuck.replace('{min}', minutes)
    : t.agent[state === 'idle' ? 'idle' : state === 'needs_input' ? 'needsInput' : state];
  return <span role="status" aria-label={label} title={label} data-live-state={state} />;
}

/** Compact segmented progress bar for an epic's phases. */
export function ProgressRibbon({ phases, className = '' }: { phases: Task[]; className?: string; active?: boolean }) {
  return (
    <div className={className}>
      {phases.length === 0 ? <div /> : phases.map((p) => <div key={p.id} title={`${p.title} — ${p.status}`} data-phase-status={p.status} />)}
    </div>
  );
}

/** Coloured unified-diff view for a raw git patch. */
export function PatchView({ diff, empty, loading = false }: { diff: string; empty: string; loading?: boolean }) {
  if (loading) return <div><LoadingLine /></div>;
  if (!diff.trim()) return <p>{empty}</p>;
  return (
    <pre>
      {diff.split('\n').map((line, i) => <div key={i}>{line || ' '}</div>)}
    </pre>
  );
}

/** Live tail line for a running session — polls only while mounted, so closed cards stay quiet. */
function LiveTailLine({ name }: { name: string }) {
  const { t } = useTranslation();
  const { tail, isLoading } = useSessionPane(name, 3);
  const line = tailSnippet(tail);
  return (
    <div>
      <ChevronRight size={12} aria-hidden />
      <span>{line || (isLoading ? t.common.loading : t.sessions.noOutput)}</span>
    </div>
  );
}

/** One context line per task: live tail (running), result summary (closed), blocker reason (blocked)
 *  or a subtle Ready. Nothing when there is nothing to say. */
export function TaskContextLine({ task, sessionName, blockers }: { task: Task; sessionName?: string | null; blockers?: Task[] }) {
  const { t } = useTranslation();
  if (sessionName) return <LiveTailLine name={sessionName} />;
  if (task.status === 'closed' || task.status === 'cancelled') {
    const fail = task.outcome === 'fail';
    return (
      <p>
        {fail ? <XCircle size={12} aria-hidden /> : <CheckCircle2 size={12} aria-hidden />}
        <span>{task.result_summary?.trim() || t.tasks.noSummary}</span>
      </p>
    );
  }
  if (blockers && blockers.length > 0) {
    return (
      <p>
        <Link2 size={12} aria-hidden />
        <span>{t.agent.waitingFor.replace('{deps}', blockers.map((b) => b.title).join(', '))}</span>
      </p>
    );
  }
  if (task.status === 'open') return <p>{t.agent.ready}</p>;
  return null;
}

/** Token usage as IN / CACHE / OUT (and cost) pills. */
export function UsageBadge({ usage }: { usage: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number; costUsd: number | null } }) {
  const { t } = useTranslation();
  if (!usage || usage.total === 0) return null;
  const cache = usage.cacheRead + usage.cacheWrite;
  const hasCost = usage.costUsd != null && usage.costUsd > 0;
  return (
    <span>
      <span>{t.usage.input}{formatTokens(usage.input)}</span>
      {cache > 0 ? <span>{t.usage.cache}{formatTokens(cache)}</span> : null}
      <span>{t.usage.output}{formatTokens(usage.output)}</span>
      {hasCost ? <span><Coins size={10} aria-hidden />{t.usage.cost}{formatCost(usage.costUsd!)}</span> : null}
    </span>
  );
}

/** Connected UsageBadge: fetches a task's usage (polling while live). Nothing until it resolves. */
export function TaskUsageBadge({ taskId, live = false }: { taskId: string; live?: boolean }) {
  const { data } = useTaskUsage(taskId, live);
  if (!data) return null;
  return <UsageBadge usage={data} />;
}

/** Compact "what changed" strip: dirty count + last commit subject, resolved against the first project. */
export function ChangeStrip() {
  const { t } = useTranslation();
  const projects = useProjects();
  const projectId = projects.data?.[0]?.id ?? null;
  const git = useProjectGit(projectId);
  if (!git.data) return null;
  const { status, commits } = git.data;
  if (!status) return null;
  const dirty = status.dirty;
  const last = commits[0];
  if (dirty === 0 && !last) return null;
  const dirtyLabel = dirty === 0 ? null : dirty === 1 ? t.changes.dirtyOne : t.changes.dirtyN.replace('{count}', String(dirty));
  return (
    <span>
      <GitCommitHorizontal size={12} aria-hidden />
      {dirtyLabel ? <span>{dirtyLabel}</span> : null}
      {last ? <span>{t.changes.lastCommit.replace('{relative}', last.relative).replace('{subject}', last.subject)}</span> : null}
    </span>
  );
}

// ── date window ──────────────────────────────────────────────────────────────────────────────────────

const DEFAULT_PRESETS: RangePreset[] = ['today', '7d', '30d', '90d', 'all', 'custom'];

/** The preset/custom window control shared by every dated view: a trigger showing the active window,
 *  opening a popover of quick presets and — when the caller allows it — a from/to picker. All the
 *  window maths live in hostUtils; this is presentation plus one onChange. */
export function DateRangeFilter({ value, onChange, presets = DEFAULT_PRESETS }: {
  value: DateRange; onChange: (r: DateRange) => void; compact?: boolean; presets?: RangePreset[];
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const presetLabel: Record<RangePreset, string> = {
    '7d': t.common.rangeLast7, '30d': t.common.rangeLast30, '90d': t.common.rangeLast90,
    today: t.common.rangeToday, all: t.common.rangeAll, custom: t.common.rangeCustom,
  };
  const label = value.preset === 'custom' ? `${value.from ?? '…'} – ${value.to ?? '…'}` : presetLabel[value.preset];
  const PRESETS = presets.filter((p) => p !== 'custom'); // 'custom' is the picker below, not a button
  const allowCustom = presets.includes('custom');
  const pickPreset = (p: RangePreset) => { onChange({ preset: p, from: null, to: null }); setOpen(false); };

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="dialog" aria-expanded={open}>
        <CalendarDays size={14} aria-hidden />
        <span>{label}</span>
        <ChevronDown size={14} aria-hidden />
      </button>
      {open && (
        <div role="dialog" aria-label={t.common.rangeLabel}>
          <div>
            {PRESETS.map((p) => (
              <button key={p} type="button" onClick={() => pickPreset(p)} aria-pressed={value.preset === p}>{presetLabel[p]}</button>
            ))}
          </div>
          {allowCustom && (
            <div>
              <p>{t.common.rangeCustom}</p>
              <label>
                <span>{t.common.rangeFrom}</span>
                <Input type="date" value={value.from ?? ''} max={value.to ?? undefined} onChange={(e) => onChange({ preset: 'custom', from: e.target.value || null, to: value.to })} />
              </label>
              <label>
                <span>{t.common.rangeTo}</span>
                <Input type="date" value={value.to ?? ''} min={value.from ?? undefined} onChange={(e) => onChange({ preset: 'custom', from: value.from, to: e.target.value || null })} />
              </label>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── model / provider pickers ─────────────────────────────────────────────────────────────────────────

const providerMeta = (id: string) => PROVIDERS.find((p) => p.id === id);

/** Which program runs an exec string — the same heuristic the daemon's spawn path uses, so the picker
 *  groups a model under the engine that will actually run it. */
function execProvider(exec: string): string {
  for (const prefix of ['elowen:', 'codex:', 'opencode:', 'claude:', 'kilo:', 'pi:', 'omp:']) {
    if (exec.startsWith(prefix)) return prefix.slice(0, -1) === 'claude' ? 'claude-code' : prefix.slice(0, -1);
  }
  if (exec.includes('/')) return 'opencode';
  return 'claude-code';
}

const SOURCE_BADGE: Record<string, string> = { oauth: 'OAuth', 'api-key': 'API', relay: 'Relay' };

/** Per-role reasoning backend picker: a summary chip plus the shared single-select Manage modal, with a
 *  "Workers" group per CLI engine and one group for the embedded brain. A pinned relay row sits above
 *  the groups; a saved-but-unknown exec stays visible so a save can never silently drop it. */
export function BackendPicker({ value, onChange, models, relayLabel, allowRelay = true, kind = 'all', title, manageAriaLabel }: {
  value: string;
  onChange: (v: string) => void;
  models: { label: string; exec: string }[];
  relayLabel: string;
  allowRelay?: boolean;
  kind?: 'all' | 'brain';
  title?: string;
  manageAriaLabel?: string;
}) {
  const { t } = useTranslation();
  const config = useConfig();
  const brain = useBrainModels();
  const [open, setOpen] = useState(false);

  const allowed = (config.data as { allowedExecs?: string[] } | undefined)?.allowedExecs;
  const brainList = ((brain.data ?? []) as { exec?: string; model?: string; providerLabel?: string; source?: string }[])
    .filter((m) => kind === 'brain' || !allowed || allowed.includes(m.exec ?? ''));

  const workerModels = (kind === 'brain' ? [] : [...models])
    .filter((m) => execProvider(m.exec) !== 'elowen')
    .sort((a, b) => a.label.localeCompare(b.label));

  const known = new Set([...workerModels.map((m) => m.exec), ...brainList.map((m) => m.exec ?? '')]);

  const items: ManageSelectionItem[] = [
    ...(allowRelay ? [{ id: '', label: relayLabel, group: '' }] : []),
    ...(value && !known.has(value) ? [{ id: value, label: value, group: '', icon: <ModelIcon name={value} size={14} /> }] : []),
    ...workerModels.map((m) => {
      const prov = execProvider(m.exec);
      return { id: m.exec, label: m.label, group: `w:${prov}`, groupLabel: providerMeta(prov)?.label ?? prov, icon: <ModelIcon name={m.exec} size={14} /> };
    }),
    ...brainList.map((m) => ({
      id: m.exec ?? '',
      label: m.model ?? '',
      group: 'b:elowen',
      groupLabel: providerMeta('elowen')?.label ?? 'Elowen AI',
      icon: <ModelIcon name={m.model} size={14} />,
      badges: [{ text: m.providerLabel ?? '', tone: 'muted' as const }, { text: SOURCE_BADGE[m.source ?? ''] ?? '', tone: 'muted' as const }],
    })),
  ];

  const selected = value ? items.find((it) => it.id === value) : undefined;
  return (
    <>
      <SelectionSummary
        countText=""
        samples={[value && selected ? { label: selected.label, icon: selected.icon } : { label: relayLabel }]}
        moreCount={0}
        onManage={() => setOpen(true)}
        manageLabel={t.managePicker.manage}
        manageAriaLabel={manageAriaLabel}
      />
      <ManageSelectionModal
        title={title ?? t.settings.executor}
        open={open}
        onClose={() => setOpen(false)}
        items={items}
        selected={new Set([value])}
        single
        emptySelectionHint={relayLabel}
        onSave={(next) => onChange([...next][0] ?? '')}
      />
    </>
  );
}

/** The task-executor field — the same picker, named for the task vocabulary. */
export function ExecutorPicker({ value, onChange, models, defaultLabel, allowDefault = true, kind = 'all' }: {
  value: string;
  onChange: (exec: string) => void;
  models: { label: string; exec: string }[];
  defaultLabel?: string;
  moreLabel?: string;
  limit?: number;
  allowDefault?: boolean;
  kind?: 'all' | 'brain';
}) {
  const { t } = useTranslation();
  return (
    <BackendPicker
      value={value}
      onChange={onChange}
      models={models}
      relayLabel={defaultLabel ?? t.tasks.defaultExecutor}
      allowRelay={allowDefault}
      kind={kind}
      title={t.tasks.fieldExecutor}
    />
  );
}

/** Pick one of the configured brain providers as the credential + endpoint source. A stale saved id
 *  stays selectable as its own option so a selection is never silently lost. */
export function ProviderPicker({ providers, value, onChange, label, emptyText }: {
  providers: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
  label?: string;
  emptyText?: string;
  size?: 'sm' | 'md';
  variant?: 'default' | 'line';
}) {
  const options = providers.map((p) => ({ value: p.id, label: p.label }));
  if (value && !providers.some((p) => p.id === value)) options.unshift({ value, label: value });
  if (options.length === 0) return <p>{emptyText ?? ''}</p>;
  return <Segmented aria-label={label} options={options} value={value} onChange={onChange} />;
}

/** Single-select model picker over a flat, provider-scoped catalog. */
export function ModelCatalogField({ value, onChange, catalog, title, subtitle }: {
  value: string; onChange: (v: string) => void; catalog: string[]; title: string; subtitle?: string; variant?: 'default' | 'line';
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const items: ManageSelectionItem[] = [
    { id: '', label: t.managePicker.none, group: '' },
    ...(value && !catalog.includes(value) ? [{ id: value, label: value, group: '', icon: <ModelIcon name={value} size={14} /> }] : []),
    ...catalog.map((m) => ({ id: m, label: m, group: '', icon: <ModelIcon name={m} size={14} /> })),
  ];
  return (
    <>
      <SelectionSummary
        countText=""
        samples={[value ? { label: value, icon: <ModelIcon name={value} size={13} /> } : { label: t.managePicker.none }]}
        moreCount={0}
        onManage={() => setOpen(true)}
        manageLabel={t.managePicker.manage}
      />
      <ManageSelectionModal
        title={title} subtitle={subtitle} open={open} onClose={() => setOpen(false)}
        items={items} selected={new Set([value])} single
        onSave={(next) => onChange([...next][0] ?? '')}
      />
    </>
  );
}

/** Canonical single-choice field: two or three choices stay inline; larger catalogs use the shared
 *  picker. `picker="always"` skips the inline form regardless of count (constellation pods pick in the
 *  drawer). Unknown persisted values remain selectable so opening the UI never drops data. */
export function ChoiceField({ title, options, value, onChange, picker = 'auto', manageAriaLabel }: {
  title: string;
  options: { value: string; label: string; icon?: ReactNode }[];
  value: string;
  onChange: (value: string) => void;
  picker?: 'auto' | 'always';
  manageAriaLabel?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const items = useMemo<ManageSelectionItem[]>(() => {
    const known = new Set(options.map((option) => option.value));
    return [
      ...(value && !known.has(value) ? [{ id: value, label: value, group: '' }] : []),
      ...options.map((option) => ({ id: option.value, label: option.label, group: '', icon: option.icon })),
    ];
  }, [options, value]);
  if (picker === 'auto' && items.length <= 3) {
    return <Segmented aria-label={title} options={items.map((item) => ({ value: item.id, label: item.label }))} value={value} onChange={onChange} />;
  }
  const selected = items.find((item) => item.id === value);
  return (
    <>
      <SelectionSummary
        countText=""
        samples={selected ? [{ label: selected.label }] : []}
        moreCount={0}
        onManage={() => setOpen(true)}
        manageLabel={t.managePicker.manage}
        manageAriaLabel={manageAriaLabel}
      />
      <ManageSelectionModal
        title={title} open={open} onClose={() => setOpen(false)}
        items={items} selected={new Set(value ? [value] : [])} single
        onSave={(next) => onChange([...next][0] ?? '')}
      />
    </>
  );
}

/** The CLI provider's brand mark. */
export function ProviderLogo({ meta, alt, size = 36 }: { meta: { icon: string; label: string }; alt?: string; size?: number }) {
  return <span><img src={meta.icon} alt={alt ?? meta.label} width={size * 0.62} height={size * 0.62} /></span>;
}

// ── terminal surfaces ────────────────────────────────────────────────────────────────────────────────

/** The live pane preview. The app renders the tail ANSI-coloured and scales it to fit; here the text is
 *  what matters — a panel's contract is that the agent's latest output is on screen and, when the
 *  caller passes `onExpand`, that clicking it opens the full terminal. */
export function LiveTail({ name, lines = 20, onExpand }: { name: string; lines?: number; heightClass?: string; onExpand?: () => void }) {
  const { t } = useTranslation();
  const { tail, isLoading } = useSessionPane(name, lines);
  const pane = <pre>{isLoading ? t.common.loading : tail || t.sessions.noOutput}</pre>;
  if (!onExpand) return <div>{pane}</div>;
  return (
    <div className="group relative">
      <div
        role="button"
        tabIndex={0}
        onClick={onExpand}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onExpand(); } }}
        title={t.tasks.openTerminal}
      >
        {pane}
      </div>
      <span aria-hidden><Maximize2 size={12} /> {t.tasks.openTerminal}</span>
    </div>
  );
}

/** The full agent terminal in a modal, titled by the session's role (Autopilot, Planner) or its
 *  friendly agent name, with the task it is working on as the subtitle.
 *
 *  The app mounts xterm in here through a dynamic import. This repo has no xterm and no next/dynamic,
 *  so the pane is the terminal's own `data-testid` and the session name — which is exactly what the
 *  moved suites assert, because they stubbed the xterm panel with the same node. */
export function TerminalModal({ session, onClose }: { session: string; onClose: () => void }) {
  const tasks = useTasks();
  const { t } = useTranslation();
  const info = useSessionInfos().data?.find((s) => s.name === session);
  const task = taskForSession((tasks.data ?? []) as Task[], session);
  const title = info?.role === 'overseer' ? t.sessions.roleOverseer
    : info?.role === 'pilot' ? t.sessions.rolePilot
    : agentDisplayName(session);
  return (
    <Modal title={title} description={task?.title} onClose={onClose}>
      <div data-testid="term">{session}</div>
    </Modal>
  );
}

// ── settings surfaces ────────────────────────────────────────────────────────────────────────────────

/** Inside a ConstellationScope a settings group renders as an orbital field and each row as a floating
 *  pod. The app draws the ellipse and its filaments from measured geometry; jsdom measures zero, so only
 *  the DOM contract travels — and that contract is what a section is asserted through: the pod's orb is
 *  a second button carrying the row's label, and clicking it forwards to the control's hidden
 *  [data-selection-manage] trigger. */
const ConstellationContext = createContext<{ core: string } | null>(null);

export function ConstellationScope({ core, children }: { core: string; children: ReactNode }) {
  return <ConstellationContext.Provider value={{ core }}>{children}</ConstellationContext.Provider>;
}

/** Opts a subtree back OUT of an enclosing scope — a hybrid section keeps its list groups classic. */
function ClassicScope({ children }: { children: ReactNode }) {
  return <ConstellationContext.Provider value={null}>{children}</ConstellationContext.Provider>;
}

const useConstellation = () => useContext(ConstellationContext);

export function SettingsDocument({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div data-control-surface data-settings-document className={`control-surface-document settings-document ${className}`}>{children}</div>;
}

export function SettingsGroup({ title, description, icon: Icon, actions, tone = 'default', density = 'comfortable', children, className = '', variant }: {
  title?: string; description?: string; icon?: LucideIcon; actions?: ReactNode;
  tone?: 'default' | 'danger'; density?: 'comfortable' | 'compact';
  children?: ReactNode; className?: string; variant?: 'classic';
}) {
  const cosmos = useConstellation();
  if (cosmos && variant !== 'classic') {
    return <section className="cosmos" data-testid="cosmos" data-core={title ?? cosmos.core}><div className="cosmos-pods">{children}</div></section>;
  }
  const classic = (
    <section data-settings-group data-tone={tone} data-density={density} className={`settings-group ${className}`}>
      {title || description || actions ? (
        <header className="settings-group__header">
          <div className="settings-group__heading">
            {Icon ? <span className="settings-group__icon" aria-hidden><Icon size={17} /></span> : null}
            <div>
              {title ? <h2>{title}</h2> : null}
              {description ? <p>{description}</p> : null}
            </div>
          </div>
          {actions ? <div className="settings-group__actions">{actions}</div> : null}
        </header>
      ) : null}
      {children ? <div className="settings-group__body">{children}</div> : null}
    </section>
  );
  return cosmos ? <ClassicScope>{classic}</ClassicScope> : classic;
}

export function SettingsRow({ label, description, icon: Icon, status, actions, children, className = '' }: {
  label: string; description?: string; icon?: LucideIcon; status?: ReactNode; actions?: ReactNode;
  children?: ReactNode; className?: string;
}) {
  const cosmos = useConstellation();
  const podRef = useRef<HTMLDivElement>(null);
  if (cosmos) {
    return (
      <div className="cosmos-pod" ref={podRef}>
        <div className="cosmos-pod__inner">
          {Icon ? (
            <button
              type="button"
              className="cosmos-pod__orb"
              aria-label={label}
              onClick={() => podRef.current?.querySelector<HTMLButtonElement>('[data-selection-manage]')?.click()}
            >
              <Icon size={17} aria-hidden />
            </button>
          ) : null}
          <span className="cosmos-pod__title">
            {label}
            {description ? <HelpTip>{description}</HelpTip> : null}
          </span>
          {status ? <div className="cosmos-pod__status">{status}</div> : null}
          <div className="cosmos-pod__control">{children}{actions}</div>
        </div>
      </div>
    );
  }
  return (
    <div className={`settings-row ${className}`}>
      <div className="settings-row__label">
        {Icon ? <span className="settings-row__icon" aria-hidden><Icon size={16} /></span> : null}
        <div>
          <span className="settings-row__title">{label}{description ? <HelpTip>{description}</HelpTip> : null}</span>
          {status ? <div className="settings-row__status">{status}</div> : null}
        </div>
      </div>
      {children ? <div className="settings-row__control">{children}</div> : null}
      {actions ? <div className="settings-row__actions">{actions}</div> : null}
    </div>
  );
}

// ── plugin page frames ───────────────────────────────────────────────────────────────────────────────
// Supplied by the HOST rather than by each bundle, so every plugin page is labelled the same way in the
// user's language without shipping the word seven times.

export function PluginPageHeader({ title, description, icon, action }: { title: string; description?: string; icon?: LucideIcon; action?: ReactNode }) {
  const { t } = useTranslation();
  return <CompactWorkspaceHeader eyebrow={t.pluginUi.eyebrow} title={title} description={description} icon={icon} action={action} />;
}

/** On a page the section is headed and sits on its own document surface; inside the Settings deck the
 *  surrounding panel supplies both, so the children render bare. */
export function PluginPageFrame({ surface, title, description, icon, action, children }: {
  surface: 'page' | 'deck'; title?: string; description?: string; icon?: LucideIcon; action?: ReactNode;
  plugin?: string; section?: string; children: ReactNode;
}) {
  if (surface === 'deck') return <>{children}</>;
  return (
    <>
      <PluginPageHeader title={title ?? ''} description={description} icon={icon} action={action} />
      <SettingsDocument>{children}</SettingsDocument>
    </>
  );
}

/** The identity block a section leads with — an avatar and its names on the left, actions on the right. */
export function SpatialIdentity({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="spatial-identity">
      <div className="min-w-0 flex-1">{children}</div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export interface TimeSeriesPoint {
  label: string;
  [key: string]: string | number | null;
}

export interface TimeSeriesSeries {
  key: string;
  label: string;
  colour: string;
  variant?: 'bar' | 'line';
  axis?: 'left' | 'right';
  format: (value: number) => string;
}

/** The host's charting primitive. The real one lazily loads Recharts; a bundle only ever sees the
 *  contract, so the double renders the same frame and the same text-equivalent data the real chart
 *  exposes to a screen reader — which is exactly what a test can assert against. */
export function TimeSeriesChart({ data, series, height = 220, emptyText, ariaLabel }: {
  data: TimeSeriesPoint[]; series: TimeSeriesSeries[]; height?: number; emptyText?: string; ariaLabel?: string;
}) {
  if (data.length === 0) {
    return <p className="py-10 text-center text-sm text-text-muted">{emptyText ?? ''}</p>;
  }
  return (
    <figure className="flex min-w-0 flex-col gap-2" style={{ minHeight: height }}>
      <figcaption className="flex min-w-0 flex-wrap items-center gap-4 text-xs text-text-muted">
        {series.map((entry) => (
          <span key={entry.key} className="inline-flex items-center gap-1.5">
            <span aria-hidden style={{ background: entry.colour }} className="h-2 w-2 rounded-full" />
            {entry.label}
          </span>
        ))}
      </figcaption>
      <ul className="sr-only">
        {data.map((point) => (
          <li key={point.label}>
            {point.label}: {series.map((entry) => {
              const value = point[entry.key];
              return `${entry.label} ${value == null ? '—' : entry.format(Number(value))}`;
            }).join(', ')}
          </li>
        ))}
      </ul>
      {ariaLabel ? <span className="sr-only">{ariaLabel}</span> : null}
    </figure>
  );
}

/** The common shape: one settings group. The section's own name never appears inside the card — on a
 *  page it is the page header, and in the deck the section rail already carries it. */
export function PluginSection({ surface, title, description, icon, action, actions, className, density, children }: {
  surface: 'page' | 'deck'; title: string; description?: string; icon?: LucideIcon;
  action?: ReactNode; actions?: ReactNode; className?: string; density?: 'comfortable' | 'compact'; children: ReactNode;
}) {
  return (
    <PluginPageFrame surface={surface} title={title} description={description} icon={icon} action={action}>
      <SettingsGroup className={className} actions={actions} density={density}>
        {children}
      </SettingsGroup>
    </PluginPageFrame>
  );
}

export { allModelsUtil as allModels, execModel };
