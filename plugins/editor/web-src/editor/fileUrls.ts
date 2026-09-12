import type { EditorRoot } from '../../src/editorRoots';

/** Every editor file URL, built in one place.
 *
 *  The root travels as its own named parameter on every request, including the default one. A file is
 *  identified by a root and a path inside it, and the two halves are only meaningful together: `bin/sh`
 *  is a file in the project tree and a different file in the guest root filesystem. Leaving the root off
 *  the default requests would make that pair implicit exactly where a stale link is most likely.
 *
 *  `URLSearchParams` does the encoding, so a path holding `&`, `?` or `#` is one parameter rather than
 *  three. */
export function editorFileUrl(projectId: number, route: string, root: EditorRoot, params?: Record<string, string | undefined>): string {
  const query = new URLSearchParams({ root });
  for (const [name, value] of Object.entries(params ?? {})) if (value !== undefined) query.set(name, value);
  return `/api/projects/${projectId}/${route}?${query.toString()}`;
}

/** The same URL against the plugin runtime's JSON caller, which prefixes `/api` itself. */
export function editorApiPath(projectId: number, route: string, root: EditorRoot, params?: Record<string, string | undefined>): string {
  return editorFileUrl(projectId, route, root, params).replace(/^\/api/, '');
}
