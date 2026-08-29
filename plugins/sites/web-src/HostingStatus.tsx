import { Copy, Server, ShieldCheck } from 'lucide-react';
import { runtime, type GatewayView } from './runtime.js';

/** Admin-only hosting panel. Read-only by design: every site gets its own hostname under one wildcard
 *  DNS record, and that record is the only thing an operator has to provide. There are no credentials
 *  to store — certificates are issued over HTTP-01, which needs nothing but the record already
 *  resolving here — so this screen states the record and reports whether it works. */
export function HostingStatus({ gateway }: { gateway: GatewayView }) {
  const { components, hooks, utils } = runtime();
  const { Badge, IconButton } = components;
  const strings = hooks.usePluginStrings('sites');
  const { toast } = hooks.useToast();
  const { status, requiredRecord } = gateway;
  const record = requiredRecord ? `${requiredRecord.name}  ${requiredRecord.type}  ${requiredRecord.value}` : null;

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border bg-surface/40 p-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-accent">
            {status.active ? <ShieldCheck size={18} /> : <Server size={18} />}
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-text">{strings.gatewayTitle}</h3>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-text-muted">
              {status.active ? strings.gatewayActiveHint : (status.detail || strings.gatewayNotReady)}
            </p>
            {status.hostnameBase ? (
              <p className="mt-2 truncate font-mono text-[11px] text-text-muted">*.{status.hostnameBase}</p>
            ) : null}
          </div>
        </div>
        <Badge tone={status.active ? 'success' : 'warning'}>
          {status.active ? strings.gatewayActive : strings.gatewayInactive}
        </Badge>
      </div>

      {record ? (
        <div className="rounded-xl border border-border/80 bg-surface/25 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h4 className="text-xs font-medium text-text">{strings.gatewayRecordTitle}</h4>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-text-muted">{strings.gatewayRecordHint}</p>
            </div>
            <IconButton
              icon={Copy}
              label={strings.copyLink}
              onClick={() => { utils.copyText(record); toast(strings.copied); }}
            />
          </div>
          <pre className="mt-3 overflow-x-auto rounded-lg border border-border bg-surface px-3 py-2 font-mono text-[11px] leading-relaxed text-text">{record}</pre>
        </div>
      ) : null}
    </div>
  );
}
