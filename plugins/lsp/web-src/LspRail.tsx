import { Braces } from 'lucide-react';
import { runtime, type PluginChatRailSectionProps } from './runtime';

export function LspRail({ variant, data }: PluginChatRailSectionProps) {
  const { components: C, hooks } = runtime();
  const strings = hooks.usePluginStrings('lsp');
  if (!data || typeof data !== 'object' || Array.isArray(data) || typeof (data as { enabled?: unknown }).enabled !== 'boolean') return null;
  const enabled = (data as { enabled: boolean }).enabled;
  if (variant === 'compact') return <div data-testid="telemetry-compact-lsp" className="flex w-10 flex-col items-center gap-1 rounded-md px-1 py-1.5" title={strings.railTitle}><Braces size={14} aria-hidden className={enabled ? 'text-success' : 'text-subtle-foreground'} /><span className="font-mono text-[9px] leading-none text-muted-foreground">{enabled ? strings.active : strings.inactive}</span></div>;
  return (
    <section data-testid="telemetry-lsp" className="flex flex-col gap-1">
      <div className="flex min-w-0 items-center gap-1.5 text-xs uppercase tracking-wide text-subtle-foreground"><Braces size={11} aria-hidden /><span className="truncate">{strings.railTitle}</span></div>
      {/* The badge sits in a row of its own: a bare badge in this column stretches to the rail's full
          width, which reads as a banner rather than a status chip. */}
      <p className="flex items-center gap-1.5 text-xs">
        <C.Badge tone={enabled ? 'success' : 'muted'} className="px-1 py-0 text-[10px]">{enabled ? strings.active : strings.inactive}</C.Badge>
      </p>
    </section>
  );
}