export function MediaPreview({ projectId, path, kind }: { projectId: number; path: string; kind: 'video' | 'audio' }) {
  const src = `/api/projects/${projectId}/raw?path=${encodeURIComponent(path)}`;
  return (
    <div className="flex h-full items-center justify-center overflow-auto bg-bg p-6">
      {kind === 'video'
        ? <video controls preload="metadata" src={src} className="max-h-full max-w-full rounded-md bg-black" />
        : <audio controls preload="metadata" src={src} className="w-full max-w-2xl" />}
    </div>
  );
}
