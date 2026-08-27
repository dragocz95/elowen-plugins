/** Shape of the host's ContextMenu, shared by the right-click menu and the toolbar menu bar.
 *
 *  The menu bar deliberately does NOT bring its own dropdown widget. The host already ships one that
 *  is styled with the app's tokens and already answers outside-click, Esc and viewport edges; a second
 *  implementation would be a second thing to keep looking right in every skin. */

export const DIVIDER = 'divider';

export type MenuEntry =
  | { label: string; icon?: unknown; onClick?: () => void; danger?: boolean; disabled?: boolean }
  | typeof DIVIDER;

export interface ContextMenuState { x: number; y: number; items: MenuEntry[] }

/** One top-level menu in the bar. */
export interface MenuDescriptor { id: string; label: string; items: MenuEntry[] }
