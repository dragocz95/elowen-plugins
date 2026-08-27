'use client';
import type { ComponentType } from 'react';

export interface ViewOption<T extends string> { id: T; label: string; icon?: ComponentType<{ size?: number; className?: string }> }

/** Edit / Preview / Diff as ONE segmented control.
 *
 *  These were three separate pill buttons sitting in the same row as Save and the wrap toggle, so
 *  nothing on screen said that picking one un-picks the others while Save does something else
 *  entirely — they read as five unrelated buttons. A segment group is the shape every editor uses for
 *  a view mode, and it also stops the row from re-flowing as the middle option appears and
 *  disappears with the file type. */
export function ViewSwitch<T extends string>({ options, value, onChange, label }: {
  options: ViewOption<T>[];
  value: T;
  onChange: (id: T) => void;
  label: string;
}) {
  if (options.length < 2) return null;
  return (
    <div role="tablist" aria-label={label} className="flex items-center gap-0.5 rounded-lg border border-border bg-bg/60 p-0.5">
      {options.map((option) => {
        const Icon = option.icon;
        const active = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.id)}
            className={`overlay-menu-item flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              active ? 'bg-elevated text-text shadow-sm' : 'text-text-muted hover:text-text'
            }`}
          >
            {Icon ? <Icon size={13} className="shrink-0" /> : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
