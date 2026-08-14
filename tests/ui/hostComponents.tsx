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
  useEffect, useMemo, useRef, useState,
  type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Search, Trash2, type LucideIcon } from 'lucide-react';
import { apiErrorMessage } from './hostClient';
import { useToast, useTranslation } from './hostHooks';

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

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode; size?: string; icon?: LucideIcon }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
    <div className="overlay-layer-modal" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true">
        <header><h2>{title}</h2></header>
        {children}
      </div>
    </div>,
    document.body,
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
