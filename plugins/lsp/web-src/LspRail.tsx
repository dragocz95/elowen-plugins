import { Braces } from 'lucide-react';
import { runtime, type PluginChatRailSectionProps } from './runtime';

export function LspRail({ variant, data }: PluginChatRailSectionProps) {
  const { components: C, hooks } = runtime();
  const strings = hooks.usePluginStrings('lsp');
  if (!data || typeof data !== 'object' || Array.isArray(data) || typeof (data as { enabled?: unknown }).enabled !== 'boolean') return null;
  const enabled = (data as { enabled: boolean }).enabled;
  if (variant === 'compact') return <div data-testid="telemetry-compact-lsp" className="flex w-10 flex-col items-center gap-1 rounded-md px-1 py-1.5" title={strings.railTitle}><Braces size={14} aria-hidden className={enabled ? 'text-success' : 'text-subtle-foreground'} /><span className="font-mono text-tiny leading-none text-muted-foreground">{enabled ? strings.active : strings.inactive}</span></div>;
  return (
    <section data-testid="telemetry-lsp" className="flex flex-col gap-1">
      <C.RailSectionHead label={strings.railTitle} icon={<Braces size={11} aria-hidden />} />
      {/* The same status row the MCP section and the CLI rail draw: a dot for the state and the word
          beside it. A badge here was both a different vocabulary from its neighbour and, as the only
          child of this column, stretched to the rail's full width and read as a banner. */}
      <p className="flex min-w-0 items-center gap-1.5 text-xs">
        <span className={`shrink-0 ${enabled ? 'text-success' : 'text-subtle-foreground'}`} aria-hidden>●</span>
        <span className="min-w-0 truncate text-foreground">{enabled ? strings.active : strings.inactive}</span>
      </p>
    </section>
  );
}