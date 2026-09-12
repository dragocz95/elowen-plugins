/** Which root inside a managed project's environment one editor request operates on.
 *
 *  A managed project owns its entire guest filesystem, and the editor presents that as two explicit
 *  roots rather than one tree with the base image folded into it. `project` is the directory the project
 *  is mounted at — the canonical slug-derived path the agent, the tool rows and the container itself all
 *  name. `system` is the guest's own `/`, which holds the base image and the project mount beside it.
 *
 *  The selector is a VALUE, never a path. A client names a root and the daemon derives the directory from
 *  the authorized project row; a client that could send `/etc` as a project-relative path would be
 *  choosing its own confinement. It is also why the two roots cannot be told apart by inspecting a path:
 *  a project whose mount happened to be `/` would otherwise inherit the system root's rules for free.
 *
 *  Kept free of any Node import on purpose: the daemon routes and the browser bundle both read it, and
 *  the bundle cannot pull in `node:path` to get it.
 */

export const EDITOR_ROOTS = ['project', 'system'] as const;
export type EditorRoot = (typeof EDITOR_ROOTS)[number];

/** What a request that names no root operates on. Every caller that predates the selector — and every
 *  host project, which has only this one root — lands here. */
export const DEFAULT_EDITOR_ROOT: EditorRoot = 'project';

/** The guest directory the `system` root resolves to. The project root has no constant: it is derived
 *  per project from core's `managedGuestRoot`, which is the single rule the container mirrors. */
export const GUEST_SYSTEM_ROOT = '/';

/** Guest directories the system root does not serve.
 *
 *  Kernel interfaces, not files: walking `/proc` is a walk of the process table, and writing a device or
 *  a FIFO node blocks on a reader that never comes. None of them survive a restart either, so none of
 *  them is part of the persistent root filesystem this root exists to show. Mirrors the host system
 *  root's own exclusions in `files.ts`. */
const VIRTUAL_GUEST_ROOTS = ['/dev', '/proc', '/run', '/sys'] as const;

/** The root a request asked for, or null when it asked for something that is not a root.
 *
 *  An absent or empty selector is the default rather than a refusal, so a link saved before the selector
 *  existed still opens the project tree. Anything else present must be one of the two names — an
 *  unrecognized value is rejected instead of falling back, because silently serving the project root to a
 *  request that asked for the system one is the failure nobody would notice. */
export function parseEditorRoot(value: unknown): EditorRoot | null {
  if (value === undefined || value === null || value === '') return DEFAULT_EDITOR_ROOT;
  return typeof value === 'string' && (EDITOR_ROOTS as readonly string[]).includes(value) ? value as EditorRoot : null;
}

/** Whether a guest path lies inside a kernel virtual filesystem the system root does not serve. */
export function isVirtualGuestPath(path: string): boolean {
  return VIRTUAL_GUEST_ROOTS.some((blocked) => path === blocked || path.startsWith(`${blocked}/`));
}
