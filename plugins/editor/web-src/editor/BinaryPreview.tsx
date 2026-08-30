import { Download, File as FileIcon } from 'lucide-react';
import { runtime } from '../runtime';
import { baseName, mimeTypeOf } from './helpers';

const { components } = runtime();
const { Button } = components;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = units[0];
  for (let i = 1; i < units.length && value >= 1024; i += 1) { value /= 1024; unit = units[i]; }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
}

export function BinaryPreview({ projectId, path, size, message, downloadLabel, sizeLabel, typeLabel, downloadUnavailableLabel, downloadAvailable }: {
  projectId: number;
  path: string;
  size: number;
  message: string;
  downloadLabel: string;
  sizeLabel: string;
  typeLabel: string;
  downloadUnavailableLabel: string;
  downloadAvailable: boolean;
}) {
  const download = () => {
    const anchor = document.createElement('a');
    anchor.href = `/api/projects/${projectId}/raw?path=${encodeURIComponent(path)}&download=1`;
    anchor.download = baseName(path);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  return (
    <div className="flex h-full items-center justify-center overflow-auto bg-background p-6">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 text-center shadow-sm">
        <FileIcon size={36} className="mx-auto text-muted-foreground" aria-hidden />
        <p className="mt-3 break-all font-mono text-sm font-semibold text-foreground">{baseName(path)}</p>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-left text-xs">
          <dt className="text-muted-foreground">{sizeLabel}</dt><dd className="text-right text-foreground">{formatBytes(size)}</dd>
          <dt className="text-muted-foreground">{typeLabel}</dt><dd className="break-all text-right font-mono text-foreground">{mimeTypeOf(path)}</dd>
        </dl>
        {!downloadAvailable ? <p className="mt-4 text-xs text-warning">{downloadUnavailableLabel}</p> : null}
        <div className="mt-5 flex justify-center"><Button variant="accent" icon={Download} disabled={!downloadAvailable} onClick={download}>{downloadLabel}</Button></div>
      </div>
    </div>
  );
}
