/** Shape of the host's ContextMenu, shared by the right-click menu and the toolbar menu bar.
 *
 *  The menu bar deliberately does NOT bring its own dropdown widget. The host already ships one that
 *  is styled with the app's tokens and already answers outside-click, Esc and viewport edges; a second
 *  implementation would be a second thing to keep looking right in every skin. */

/** `as const`, matching the host's own divider: without it the literal widens to `string`, and an items
 *  array built by spreading a conditional group stops satisfying `MenuEntry[]`. */
export const DIVIDER = 'divider' as const;

export type MenuEntry =
  | { label: string; icon?: unknown; onClick?: () => void; danger?: boolean; disabled?: boolean }
  /** A row that expands a nested panel of its own entries. The host's menu is the shadcn/Radix one, so
   *  a submenu already carries roving focus, arrow-key navigation, Enter and Escape, and flips at the
   *  viewport edge — declaring the shape here is all this bundle needs to reach any of it. */
  | { label: string; icon?: unknown; disabled?: boolean; items: MenuEntry[] }
  | typeof DIVIDER;

export interface ContextMenuState { x: number; y: number; items: MenuEntry[] }

/** One top-level menu in the bar. */
export interface MenuDescriptor { id: string; label: string; items: MenuEntry[] }
