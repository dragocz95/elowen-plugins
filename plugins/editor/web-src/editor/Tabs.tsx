'use client';
import { X } from 'lucide-react';
import { baseName } from './helpers';

/** Open-file tabs (VS Code-like). A dirty file shows a warning dot that turns into a close button on
 *  hover. Switching tabs never discards edits (drafts live in the parent). */
export function Tabs({ tabs, active, dirty, onSelect, onClose, closeLabel }: {
  tabs: string[]; active: string | null; dirty: Set<string>;
  onSelect: (p: string) => void; onClose: (p: string) => void; closeLabel: string;
}) {
  if (tabs.length === 0) return null;
  return (
    <div className="flex items-stretch overflow-x-auto border-b border-border bg-muted">
      {tabs.map((p) => {
        const isActive = p === active;
        const isDirty = dirty.has(p);
        return (
          <div key={p} className={`group flex shrink-0 items-center gap-1.5 border-r border-border px-3 py-1.5 text-xs ${isActive ? 'bg-card text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'}`}>
            <button type="button" onClick={() => onSelect(p)} className="max-w-40 truncate" title={p}>{baseName(p)}</button>
            {/* A dirty tab shows the dot and reveals the cross on hover — but a finger never hovers, so
                on a coarse pointer the cross is shown outright and the dot stands down, the same
                bargain the host's hover-revealed row actions make. */}
            <button type="button" onClick={() => onClose(p)} aria-label={closeLabel} className="overlay-touch-target flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground">
              {isDirty ? <span className="h-1.5 w-1.5 rounded-full bg-warning group-hover:hidden [@media(pointer:coarse)]:hidden" aria-hidden /> : null}
              <X size={11} className={isDirty ? 'hidden group-hover:block [@media(pointer:coarse)]:block' : 'block'} aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}
