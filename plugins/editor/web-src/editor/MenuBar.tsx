'use client';
import type { MenuDescriptor } from './menu';

/** The File / View / Settings row in the toolbar.
 *
 *  Each button hands its own rectangle to the host's context menu so the dropdown opens under it
 *  rather than at the pointer — that anchoring is the only real difference between a menu bar and a
 *  right-click menu, and it is why no second widget is needed. */
export function MenuBar({ menus, openId, onOpen }: {
  menus: MenuDescriptor[];
  openId: string | null;
  onOpen: (menu: MenuDescriptor | null, x: number, y: number) => void;
}) {
  return (
    <div className="flex items-center" role="menubar">
      {menus.map((menu) => (
        <button
          key={menu.id}
          type="button"
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={openId === menu.id}
          onClick={(event) => {
            // Clicking the open menu closes it, the way every menu bar behaves.
            if (openId === menu.id) { onOpen(null, 0, 0); return; }
            const rect = event.currentTarget.getBoundingClientRect();
            onOpen(menu, rect.left, rect.bottom + 4);
          }}
          // `.overlay-menu-item` is the host's coarse-pointer floor for a dense labelled row. These are
          // drawn 24px tall, and on a touch device the menu bar is the only reachable trigger for the
          // file actions — there is no right-click there to fall back to.
          className={`overlay-menu-item rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
            openId === menu.id ? 'bg-elevated text-text' : 'text-text-muted hover:bg-elevated hover:text-text'
          }`}
        >
          {menu.label}
        </button>
      ))}
    </div>
  );
}
