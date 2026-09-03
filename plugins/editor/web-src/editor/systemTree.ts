import { useEffect, useMemo, useRef, useState } from 'react';
import { runtime } from '../runtime';
import type { FileNode } from '../runtime';

/** The directory levels the user has opened under the system root.
 *
 *  A project tree arrives whole, because eight levels of a project is a few thousand entries. The server
 *  filesystem is not that: two levels below `/` already hold tens of thousands of entries and the project
 *  depth would hold millions, so the daemon serves the system root ONE level at a time and this asks for
 *  the next one as a folder is opened. What comes back is merged into the same flat `FileNode` list the
 *  tree is built from, so nothing downstream has to know which root it is looking at.
 *
 *  `epoch` is bumped by the caller after a file operation. Every cached level is dropped and the open
 *  ones are read again — a file created inside an opened folder is invisible to the root listing that
 *  react-query refetches on its own. */
export function useSystemDirs(projectId: number, enabled: boolean, expanded: Set<string>, epoch: number): FileNode[] {
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
  }, [projectId, enabled, epoch]);

  useEffect(() => {
    if (!enabled) return;
    const mine = generation.current;
    for (const dir of expanded) {
      if (requested.current.has(dir)) continue;
      requested.current.add(dir);
      void (async () => {
        try {
          const nodes = await runtime().api(`/projects/${projectId}/files?path=${encodeURIComponent(dir)}`) as FileNode[];
          if (generation.current !== mine) return;
          setLevels((current) => ({ ...current, [dir]: nodes }));
        } catch {
          // A directory the daemon user cannot read stays empty in the tree. There is nothing to tell
          // the user that opening a folder they may not read did not work — the folder simply has
          // nothing in it, which is exactly what they can see of it.
        }
      })();
    }
  }, [projectId, enabled, expanded, epoch]);

  return useMemo(() => Object.values(levels).flat(), [levels]);
}
