// @vitest-environment node
/** The editor's kernel-VFS exclusion list is ONE list with two consumers.
 *
 *  The host system-root guard (`safeSystemPath` in `files.ts`) and the managed guest rule
 *  (`isVirtualGuestPath` in `editorRoots.ts`) must refuse exactly the same virtual trees. The defect
 *  these pin: the list existed as two hand-copied arrays, so a path appended for one root stayed
 *  servable through the other. The shared list is exported from `editorRoots.ts` (the deliberately
 *  node-free module the browser bundle already imports) and both consumers read it. Appending a path
 *  to it must therefore change BOTH behaviours — asserted below with a temporary entry. */
import { describe, it, expect } from 'vitest';
import * as editorRoots from '../plugins/editor/src/editorRoots.js';
import { safeSystemPath } from '../plugins/editor/src/files.js';
import { isVirtualGuestPath } from '../plugins/editor/src/editorRoots.js';

const sharedList = (editorRoots as { VIRTUAL_FS_ROOTS?: readonly string[] }).VIRTUAL_FS_ROOTS;

describe('editor kernel-VFS exclusion list', () => {
  it('is exported once, from editorRoots, with the paths the editor has always excluded', () => {
    expect(sharedList, 'the exclusion list must be exported from editorRoots.ts as the single source').toBeDefined();
    expect([...(sharedList ?? [])]).toEqual(['/dev', '/proc', '/run', '/sys']);
  });

  it('a path appended to the shared list is refused through BOTH consumers', () => {
    expect(sharedList, 'shared list must exist before appending to it').toBeDefined();
    const list = sharedList as unknown as string[];
    list.push('/elowen-virtual-probe');
    try {
      // Guest consumer: the managed system root.
      expect(isVirtualGuestPath('/elowen-virtual-probe')).toBe(true);
      expect(isVirtualGuestPath('/elowen-virtual-probe/x')).toBe(true);
      // Host consumer: the admin system root behind /projects/-1.
      expect(() => safeSystemPath('/', 'elowen-virtual-probe')).toThrow(/virtual filesystem/);
      expect(() => safeSystemPath('/', 'elowen-virtual-probe/x')).toThrow(/virtual filesystem/);
    } finally {
      list.pop();
    }
  });

  it('leaves ordinary paths servable through both consumers', () => {
    expect(isVirtualGuestPath('/etc/hosts')).toBe(false);
    expect(safeSystemPath('/', 'etc/hostname')).toBe('/etc/hostname');
  });
});
