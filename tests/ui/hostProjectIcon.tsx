/** A project's identity glyph — the configured repo image when it has one, the folder mark otherwise.
 *
 *  Ported from web/components/ui/ProjectIcon.tsx, and kept in its OWN module for the same reason the
 *  app keeps it in one: it is the single place that turns a project row into a picture, and a suite that
 *  wants to assert on which icon a picker rendered replaces this module rather than the whole component
 *  bag around it. Fetching the bytes is gated on the editor plugin exactly as in production — the raw
 *  route is that plugin's.
 */
import { useQuery } from '@tanstack/react-query';
import { FolderGit2 } from 'lucide-react';
import { elowenClient } from './hostClient';
import { useEditorPlugin } from './hostHooks';

export function ProjectIcon({ project, size = 16, className = '' }: { project: { id: number; icon?: string }; size?: number; className?: string }) {
  const icon = project.icon ?? '';
  const editorEnabled = useEditorPlugin();
  const { data: src } = useQuery({
    queryKey: ['project-icon', project.id, icon],
    enabled: !!icon && editorEnabled,
    staleTime: Infinity,
    queryFn: async () => {
      const blob = await elowenClient.projectRawBlob(project.id, icon);
      return await new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result as string);
        fr.onerror = () => reject(fr.error);
        fr.readAsDataURL(blob);
      });
    },
  });
  if (icon && src) {
    return <img src={src} alt="" aria-hidden data-project-icon={icon} className={className} style={{ width: size, height: size }} />;
  }
  return <FolderGit2 size={size} data-project-icon={icon || undefined} className={className} aria-hidden />;
}
