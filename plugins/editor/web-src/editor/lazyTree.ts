import { useEffect, useMemo, useRef, useState } from 'react';
import { runtime } from '../runtime';
import type { FileNode } from '../runtime';
import type { EditorRoot } from '../../src/editorRoots';
import { editorApiPath } from './fileUrls';

/** The directory levels the user has opened. Every root is read one level at a time, so this is how all
 *  of them are read past their first.
 *
 *  The daemon answers one directory per request and this asks for the next as a folder is opened. What
 *  comes back is merged into the same flat `FileNode` list the tree is built from, so nothing downstream
 *  has to know which root it is looking at.
 *
 *  `root` is part of the reset key, not only of the request: a managed project's two roots share its id,
 *  and levels read under one of them describe nothing under the other.
 *
 *  `epoch` is bumped by the caller after a file operation. Every cached level is dropped and the open
 *  ones are read again — a file created inside an opened folder is invisible to the root listing that
 *  react-query refetches on its own.
 *
 *  `onFailed` receives a directory that could not be read. A caller that passes nothing keeps the silence
 *  a filesystem root wants, where an unreadable directory is ordinary and reporting each one would be
 *  noise. A caller that passes a handler is told, because a folder drawn open and empty says the same
 *  untrue thing about a project that an empty tree did. */
export function useLazyDirs(
  projectId: number,
  root: EditorRoot,
  enabled: boolean,
  expanded: Set<string>,
  epoch: number,
  onFailed?: (dir: string, error: unknown) => void,
): FileNode[] {
  const [levels, setLevels] = useState<Record<string, FileNode[]>>({});
  // Which directories this generation has already asked for, so re-rendering (or opening a second
  // folder) does not re-fetch the ones already on screen.
  const requested = useRef<Set<string>>(new Set());
  // Bumped with every reset; a response that resolves after one is dropped rather than merged into the
  // listing it no longer describes.
  const generation = useRef(0);

  useEffect(() => {
    generation.current += 1;
    requested.current = new Set();
    setLevels({});
  }, [projectId, root, enabled, epoch]);

  // Held in a ref so a caller can pass an inline handler without re-running the effect on every render.
  const failed = useRef(onFailed);
  failed.current = onFailed;

  useEffect(() => {
    if (!enabled) return;
    const mine = generation.current;
    for (const dir of expanded) {
      if (requested.current.has(dir)) continue;
      requested.current.add(dir);
      void (async () => {
        try {
          const nodes = await runtime().api(editorApiPath(projectId, 'files', root, { path: dir })) as FileNode[];
          if (generation.current !== mine) return;
          setLevels((current) => ({ ...current, [dir]: nodes }));
        } catch (error) {
          if (generation.current !== mine) return;
          // Asked for again if the user opens it again: a refusal that was answered once is not a
          // standing verdict, and the folder never got its contents from this attempt.
          requested.current.delete(dir);
          failed.current?.(dir, error);
        }
      })();
    }
  }, [projectId, root, enabled, expanded, epoch]);

  return useMemo(() => Object.values(levels).flat(), [levels]);
}
