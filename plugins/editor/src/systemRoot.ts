/** The virtual project an administrator browses the whole server filesystem through.
 *
 *  Kept free of any Node import on purpose: the daemon routes and the browser bundle both need these
 *  three values, and the bundle cannot pull in `node:fs` to get them. */

/** The reserved project id the system root answers on (`/projects/-1/...`).
 *
 *  Negative rather than zero, and that is not cosmetic. Project ids are positive rowids, so every value
 *  <= 0 is free — but 0 is unusable on the browser side: the host data hooks the editor reads through
 *  (`useProjectFiles`, `useProjectFile`, `useProjectChanged`, …) all enable themselves with `!!id`, so a
 *  zero id would silently disable every one of them and the page would render an empty tree for ever.
 *  -1 is falsy nowhere, and travels through the host's hooks, react-query cache keys and mutations
 *  exactly like a real project id.
 *
 *  A literal segment ('/projects/system/...') would have routed fine — a root mount's `:id` matches any
 *  one segment — but those same host hooks type a project id as `number`, so it would have widened every
 *  signature between the page and the daemon for a name only one caller ever uses. */
export const SYSTEM_PROJECT_ID = -1;

/** The path the reserved id resolves to. */
export const SYSTEM_ROOT = '/';

export const isSystemRoot = (root: string): boolean => root === SYSTEM_ROOT;

/** How deep a system-root listing walks: one level, and not one more.
 *
 *  A project tree is fetched whole because eight levels of a project is a few thousand entries. The
 *  server filesystem is not that: two levels below `/` already hold ~13 000 entries on a plain Debian
 *  host, and the project depth would hold millions. So the system root is served a directory at a time
 *  and the browser asks for the next level as the user opens it. */
export const SYSTEM_LIST_DEPTH = 0;
