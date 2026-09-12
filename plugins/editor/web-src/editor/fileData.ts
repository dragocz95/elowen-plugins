import { runtime } from '../runtime';
import type { FileNode } from '../runtime';
import type { EditorRoot } from '../../src/editorRoots';
import { editorApiPath } from './fileUrls';

/** The editor's own file queries, keyed by PROJECT AND ROOT.
 *
 *  The host's project-file hooks are keyed by project id alone, which is the right key for a surface that
 *  has one tree. A managed project has two, and they are different filesystems: answering the project tab
 *  from a warm cache written by the system tab would show the guest root filesystem under the project's
 *  name, and the reverse would show a handful of repository files as though they were the environment.
 *  Nothing in the key can express that, so the editor keeps its own.
 *
 *  Everything still runs through the host's single QueryClient, so one cache and one invalidation path
 *  serve both the editor and the surfaces around it. */
export interface EditorFileContent { content: string; truncated: boolean; version?: string }

export const editorTreeKey = (projectId: number, root: EditorRoot): unknown[] => ['editor-tree', projectId, root];
export const editorFileKey = (projectId: number, root: EditorRoot, path: string | null): unknown[] => ['editor-file', projectId, root, path];

/** The tree of one root. The project root arrives whole; the system root arrives one level at a time and
 *  this is its first level, with the rest merged in by `useLazyDirs`. */
export function useEditorTree(projectId: number | null, root: EditorRoot, enabled: boolean) {
  return runtime().hooks.useQuery<FileNode[]>({
    queryKey: editorTreeKey(projectId ?? 0, root),
    queryFn: () => runtime().api(editorApiPath(projectId as number, 'files', root)) as Promise<FileNode[]>,
    enabled: !!projectId && enabled,
  });
}

/** One file's text, with the content version a later save compares against. */
export function useEditorFile(projectId: number | null, root: EditorRoot, path: string | null) {
  return runtime().hooks.useQuery<EditorFileContent>({
    queryKey: editorFileKey(projectId ?? 0, root, path),
    queryFn: () => runtime().api(editorApiPath(projectId as number, 'file', root, { path: path as string })) as Promise<EditorFileContent>,
    enabled: !!projectId && !!path,
  });
}

/** Save one file. A managed save carries the content version it was read at, so a member who edited the
 *  same file meanwhile gets a conflict instead of losing their work; a host project has no version and
 *  the field is omitted rather than sent as null, which the route reads as "there was nothing here". */
export async function saveEditorFile(projectId: number, root: EditorRoot, path: string, content: string, version: string | null | undefined): Promise<string | undefined> {
  const result = await runtime().api(editorApiPath(projectId, 'file', root), {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(version === undefined ? { path, content } : { path, content, version }),
  });
  if (!result || typeof result !== 'object') throw new Error('Malformed save response');
  const next = (result as { version?: unknown }).version;
  if (version !== undefined && typeof next !== 'string') throw new Error('Missing saved content version');
  return typeof next === 'string' ? next : undefined;
}

/** The tree mutations, bound to one project and root.
 *
 *  Each one posts to the same route the host client posts to, with the root named explicitly, and then
 *  invalidates this root's tree plus the project's Git views — a new or deleted file changes what
 *  `changed` reports, and the host's own mutations are no longer the ones doing the invalidating. */
export function useEditorTreeMutations(projectId: number, root: EditorRoot) {
  const { useMutation, useQueryClient } = runtime().hooks;
  const client = useQueryClient();
  const settle = () => {
    void client.invalidateQueries({ queryKey: editorTreeKey(projectId, root) });
    void client.invalidateQueries({ queryKey: ['project-changed', projectId] });
    void client.invalidateQueries({ queryKey: ['project-git', projectId] });
  };
  const post = (route: string, body: unknown) =>
    runtime().api(editorApiPath(projectId, route, root), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return {
    newFile: useMutation<unknown, unknown, { path: string }>({ mutationFn: (v: { path: string }) => post('new-file', { path: v.path }), onSuccess: settle }),
    newDir: useMutation<unknown, unknown, { path: string }>({ mutationFn: (v: { path: string }) => post('dir', { path: v.path }), onSuccess: settle }),
    rename: useMutation<unknown, unknown, { from: string; to: string }>({ mutationFn: (v: { from: string; to: string }) => post('rename', v), onSuccess: settle }),
    copy: useMutation<unknown, unknown, { from: string; to: string }>({ mutationFn: (v: { from: string; to: string }) => post('copy', v), onSuccess: settle }),
    remove: useMutation<unknown, unknown, { path: string }>({
      mutationFn: (v: { path: string }) => runtime().api(editorApiPath(projectId, 'entry', root, { path: v.path }), { method: 'DELETE' }),
      onSuccess: settle,
    }),
  };
}
