import { useMemo } from 'react';
import Papa from 'papaparse';

const MAX_ROWS = 1000;

export function CsvPreview({ source, invalidLabel, limitedLabel }: { source: string; invalidLabel: string; limitedLabel: string }) {
  const parsed = useMemo(() => Papa.parse<string[]>(source, { skipEmptyLines: false }), [source]);
  const fatalErrors = parsed.errors.filter((error) => error.code !== 'UndetectableDelimiter');
  if (fatalErrors.length > 0) {
    const first = fatalErrors[0];
    return <p className="p-4 text-center text-sm text-danger">{invalidLabel}: {first.message}</p>;
  }
  const rows = parsed.data.slice(0, MAX_ROWS);
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  return (
    <div className="h-full overflow-auto bg-bg p-4">
      {parsed.data.length > MAX_ROWS ? <p className="mb-3 text-xs text-text-muted">{limitedLabel.replace('{count}', String(MAX_ROWS))}</p> : null}
      <table className="min-w-full border-collapse text-left text-xs text-text">
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className={rowIndex === 0 ? 'bg-elevated font-semibold' : undefined}>
              {Array.from({ length: width }, (_, columnIndex) => (
                <td key={columnIndex} className="whitespace-pre-wrap border border-border px-2 py-1.5 align-top">{row[columnIndex] ?? ''}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
