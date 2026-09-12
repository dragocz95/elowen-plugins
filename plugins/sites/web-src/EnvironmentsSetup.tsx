import { Copy, Network, Server } from 'lucide-react';
import type { PluginPageProps } from 'elowen-plugin-ui-kit';
import { runtime, type EnvironmentReadinessResponse, type GatewayReadinessResponse } from './runtime.js';

const gatewayTone = (status: GatewayReadinessResponse['status']): 'success' | 'warning' | 'danger' =>
  status === 'ready' ? 'success' : status === 'missing' ? 'warning' : 'danger';

export function EnvironmentsSetup({ surface }: PluginPageProps) {
  const host = runtime();
  const { Badge, Button, ErrorState, LoadingState, PluginPageHeader, SettingsDocument, SettingsGroup, SettingsRow } = host.components;
  const strings = host.hooks.usePluginStrings('sites');
  const { toast } = host.hooks.useToast();
  const gateway = host.hooks.useQuery<GatewayReadinessResponse>({
    queryKey: ['sites', 'gateway-readiness'],
    queryFn: () => runtime().api('/plugins/sites/api/gateway/readiness'),
    refetchInterval: 30_000,
  });
  const sandbox = host.hooks.useQuery<EnvironmentReadinessResponse>({
    queryKey: ['sandbox', 'runtime-host'],
    queryFn: () => runtime().api('/plugins/sandbox/api/runtime/host'),
  });

  const copy = (value: string) => {
    host.utils.copyText(value);
    toast(strings.copied);
  };

  if (gateway.isLoading || sandbox.isLoading) return <LoadingState variant="block" height="14rem" />;
  if (gateway.isError) return <ErrorState message={host.utils.apiErrorMessage(gateway.error)} onRetry={() => gateway.refetch()} />;
  if (!gateway.data) return null;

  const gatewayStatus = gateway.data.status === 'ready'
    ? strings.environmentStatusReady
    : gateway.data.status === 'missing'
      ? strings.environmentStatusMissing
      : gateway.data.status === 'misdirected'
        ? strings.environmentStatusMisdirected
        : strings.environmentStatusUnavailable;
  const sandboxReady = !sandbox.isError && sandbox.data?.ready === true;

  return (
    <div className="space-y-4">
      {surface === 'page' ? <PluginPageHeader title={strings.environmentSetupTitle} description={strings.environmentSetupDescription} icon={Network} /> : null}
      <SettingsDocument>
        <SettingsGroup
          icon={Server}
          title={strings.sandboxRequiredTitle}
          description={strings.sandboxRequiredDescription}
          density="compact"
          actions={<Badge tone={sandboxReady ? 'success' : 'warning'}>{sandboxReady ? strings.environmentStatusReady : strings.environmentSetupAttention}</Badge>}
        >
          <SettingsRow
            label={strings.sandboxRequiredCheck}
            status={<Badge tone={sandboxReady ? 'success' : 'danger'}>{sandboxReady ? strings.pass : strings.fail}</Badge>}
            control={sandboxReady
              ? <p className="text-xs text-muted-foreground">{strings.sandboxRequiredReady}</p>
              : <div className="flex flex-col items-start gap-2"><p className="text-xs text-muted-foreground">{strings.sandboxRequiredUnavailable}</p><Button variant="ghost" onClick={() => host.navigate('/p/sandbox')}>{strings.openSandboxSettings}</Button></div>}
          />
        </SettingsGroup>

        <SettingsGroup
          icon={Network}
          title={strings.environmentGatewayTitle}
          description={strings.environmentGatewayDescription}
          density="compact"
          actions={<Badge tone={gatewayTone(gateway.data.status)}>{gatewayStatus}</Badge>}
        >
          <SettingsRow
            label={strings.environmentGatewayCheck}
            trailingLayout="stack"
            status={<Badge tone={gatewayTone(gateway.data.status)}>{gatewayStatus}</Badge>}
            control={<div className="space-y-1 text-left"><p className="text-xs text-muted-foreground">{gateway.data.detail}</p>{gateway.data.observedTargets.length > 0 ? <p className="break-all font-mono text-[11px] text-foreground">{strings.environmentObservedTarget}: {gateway.data.observedTargets.join(', ')}</p> : null}</div>}
          />
          {gateway.data.expectedRecord ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {([
                [strings.environmentRecordType, gateway.data.expectedRecord.type],
                [strings.environmentRecordName, gateway.data.expectedRecord.name],
                [strings.environmentRecordValue, gateway.data.expectedRecord.value],
              ] as const).map(([label, value]) => (
                <div key={label} className="min-w-0 rounded-md border border-border bg-muted/30 p-3">
                  <div className="mb-1 flex items-center justify-between gap-2"><span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span><Button variant="ghost" icon={Copy} onClick={() => copy(value)} title={`${strings.copy} ${label}`}>{strings.copy}</Button></div>
                  <code className="block break-all font-mono text-xs text-foreground">{value}</code>
                </div>
              ))}
            </div>
          ) : null}
        </SettingsGroup>
      </SettingsDocument>
    </div>
  );
}
