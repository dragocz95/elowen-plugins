import type { EditorRoot } from '../../src/editorRoots';
import { editorFileUrl } from './fileUrls';

export function MediaPreview({ projectId, root, path, kind }: { projectId: number; root: EditorRoot; path: string; kind: 'video' | 'audio' }) {
  const src = editorFileUrl(projectId, 'raw', root, { path });
  return (
    <div className="flex h-full items-center justify-center overflow-auto bg-background p-6">
      {kind === 'video'
        ? <video controls preload="metadata" src={src} className="max-h-full max-w-full rounded-md bg-background" />
        : <audio controls preload="metadata" src={src} className="w-full max-w-2xl" />}
    </div>
  );
}
