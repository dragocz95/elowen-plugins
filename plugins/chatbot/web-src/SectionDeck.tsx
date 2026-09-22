import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { runtime } from './runtime';

/** THE ONE SEAM between this plugin's sections and the host's page shell.
 *
 *  The page is a DECK: a set of named sections read one at a time, listed beside the content where there
 *  is width for a column and above it as one scrollable line on a phone. That is what `/settings` and
 *  `/account` are, and the host owns that shape — `WorkspaceShell variant="deck"` with a `navigation`
 *  prop is the API being published for it.
 *
 *  Today the host's `navigation` draws horizontal tabs, so this file draws the column and the strip
 *  itself, from the SAME data the published prop takes: `{ sections, value, onChange, ariaLabel }`, with
 *  each section `{ id, label, icon }`. Nothing else in this bundle knows how the sections are drawn —
 *  `sections.tsx` declares them and `ChatbotPage.tsx` picks one — so when the host lands, the whole
 *  local drawing below is deleted and the body of this component becomes:
 *
 *    <C.WorkspaceShell variant="deck" hero={hero} navigation={{ sections, value, onChange, ariaLabel }}>
 *      {children}
 *    </C.WorkspaceShell>
 *
 *  What the host will do that this cannot: own the measure (its 15rem column), make the column its own
 *  scroller inside the page's one scroller, and offer the deck's search over section rows. This draws the
 *  same anatomy with the same tokens — a 2rem record, a 1rem glyph at half opacity, the record's own fill
 *  marking the section on screen — and keeps the column in normal page flow instead. */

export interface DeckSection {
  id: string;
  label: string;
  icon: LucideIcon;
}

export function SectionDeck({ sections, value, onChange, ariaLabel, hero, children }: {
  sections: DeckSection[];
  value: string;
  onChange(id: string): void;
  ariaLabel: string;
  hero: { title: string; description?: string; icon?: LucideIcon };
  children: ReactNode;
}) {
  const { components: C } = runtime();

  return (
    <C.WorkspaceShell variant="deck" hero={{ ...hero, mascot: false }}>
      <div className="grid min-h-0 grid-cols-1 gap-4 md:grid-cols-[15rem_minmax(0,1fr)] md:gap-6">
        {/* The secondary column, where there is width for one. It stays with the reader down a long
            section rather than scrolling away above it. */}
        <aside className="hidden min-w-0 md:block">
          <nav aria-label={ariaLabel} className="sticky top-4 flex flex-col gap-0.5 border-r border-border pr-3">
            {sections.map((section) => {
              const current = section.id === value;
              const Icon = section.icon;
              return (
                <button
                  key={section.id}
                  type="button"
                  aria-current={current ? 'page' : undefined}
                  onClick={() => onChange(section.id)}
                  className={`flex h-8 items-center gap-2.5 rounded-lg px-2 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 pointer-coarse:min-h-[var(--touch-target)] ${current ? 'bg-accent' : ''}`}
                >
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center text-foreground opacity-50" aria-hidden>
                    <Icon size={16} strokeWidth={1.75} />
                  </span>
                  <span className="min-w-0 truncate text-sm font-medium text-foreground">{section.label}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        <div className="flex min-w-0 flex-col gap-3">
          {/* The phone's answer: ONE line, scrolled sideways with a thumb, with every section on it. Never
              a dropdown — a dropdown hides every destination but the one already open. */}
          <nav
            aria-label={ariaLabel}
            className="flex shrink-0 items-center gap-1 overflow-x-auto overscroll-x-contain whitespace-nowrap pb-1 [-ms-overflow-style:none] [scrollbar-width:none] md:hidden"
          >
            {sections.map((section) => {
              const current = section.id === value;
              const Icon = section.icon;
              return (
                <button
                  key={section.id}
                  type="button"
                  aria-current={current ? 'page' : undefined}
                  onClick={() => onChange(section.id)}
                  className={`flex h-8 shrink-0 select-none items-center gap-2 rounded-full px-3 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 pointer-coarse:min-h-[var(--touch-target)] ${
                    current ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                  }`}
                >
                  <Icon size={14} strokeWidth={1.75} aria-hidden className={current ? 'text-primary' : undefined} />
                  <span>{section.label}</span>
                </button>
              );
            })}
          </nav>

          <section role="region" aria-label={sections.find((section) => section.id === value)?.label ?? ariaLabel} className="min-w-0">
            {children}
          </section>
        </div>
      </div>
    </C.WorkspaceShell>
  );
}
