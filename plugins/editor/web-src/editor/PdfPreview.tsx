'use client';
import { useEffect, useState } from 'react';

/** PDF preview — fetches bytes through the same-origin cookie proxy, creates a short-lived object URL,
 * and leaves rendering to the browser's native PDF viewer. The bearer token never enters the URL. */
export function PdfPreview({ projectId, path, failedLabel, office = false }: { projectId: number; path: string; failedLabel: string; office?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setUrl(null);
    setFailed(false);
    const route = office ? 'office-preview' : 'raw';
    fetch(`/api/projects/${projectId}/${route}?path=${encodeURIComponent(path)}`, { credentials: 'same-origin' })
      .then((response) => { if (!response.ok) throw new Error(`${route} ${response.status}`); return response.blob(); })
      .then((blob) => { if (cancelled) return; objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [projectId, path, office]);

  return (
    <div className="h-full overflow-hidden bg-background p-3">
      {failed ? <p className="p-4 text-center text-sm text-destructive">{failedLabel.replace('{path}', path)}</p>
        : url ? <iframe src={url} title={path} className="h-full w-full rounded-md border border-border bg-background" />
        : null}
    </div>
  );
}
