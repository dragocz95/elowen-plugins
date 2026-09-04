import { useRef, useState } from 'react';
import { CheckCircle2, Copy, Network, PackageCheck, TriangleAlert } from 'lucide-react';
import type { PluginPageProps } from 'elowen-plugin-ui-kit';
import {
  runtime,
  type EnvironmentReadinessResponse,
  type GatewayReadinessResponse,
} from './runtime.js';

const gatewayTone = (status: GatewayReadinessResponse['status']): 'success' | 'warning' | 'danger' =>
  status === 'ready' ? 'success' : status === 'missing' ? 'warning' : 'danger';

export function EnvironmentsSetup({ surface }: PluginPageProps) {
  const host = runtime();
  const {
    Badge, Button, ConfirmDialog, ErrorState, HelpTip, LoadingState,
    PluginPageHeader, SettingsDocument, SettingsGroup, SettingsRow,
  } = host.components;
  const strings = host.hooks.usePluginStrings('sites');
  const { toast } = host.hooks.useToast();
  const [confirmInstall, setConfirmInstall] = useState(false);
  const [provisionError, setProvisionError] = useState<string | null>(null);
  const installing = useRef(false);

  const gateway = host.hooks.useQuery<GatewayReadinessResponse>({
    queryKey: ['sites', 'gateway-readiness'],
    queryFn: () => runtime().api('/plugins/sites/api/gateway/readiness'),
    refetchInterval: 30_000,
  });
  const environment = host.hooks.useQuery<EnvironmentReadinessResponse>({
    queryKey: ['sites', 'environment-readiness'],
    queryFn: () => runtime().api('/plugins/sites/api/environments/readiness'),
  });
  const provision = host.hooks.useMutation<EnvironmentReadinessResponse, unknown, void>({
    mutationFn: () => runtime().api('/plugins/sites/api/environments/provision', { method: 'POST' }),
    onSuccess: (status: EnvironmentReadinessResponse) => {
      setProvisionError(null);
      toast(status.ready ? strings.environmentSetupReady : strings.environmentSetupAttention, status.ready ? 'ok' : 'error');
    },
    onError: (error: unknown) => {
      const message = host.utils.apiErrorMessage(error);
      setProvisionError(message);
      toast(message, 'error');
    },
  });

  const install = async () => {
    if (installing.current || provision.isPending) return;
    installing.current = true;
    try { await provision.mutateAsync(); }
    catch { /* The mutation callback owns the visible error state. */ }
    finally {
      installing.current = false;
      setConfirmInstall(false);
      environment.refetch();
    }
  };

  const copy = (value: string) => {
    host.utils.copyText(value);
    toast(strings.copied);
  };

  if (gateway.isLoading || environment.isLoading) return <LoadingState variant="block" height="14rem" />;
  if (gateway.isError) return <ErrorState message={host.utils.apiErrorMessage(gateway.error)} onRetry={() => gateway.refetch()} />;
  if (environment.isError) return <ErrorState message={host.utils.apiErrorMessage(environment.error)} onRetry={() => environment.refetch()} />;
  if (!gateway.data || !environment.data) return null;

  const gatewayStatus = gateway.data.status === 'ready'
    ? strings.environmentStatusReady
    : gateway.data.status === 'missing'
      ? strings.environmentStatusMissing
      : gateway.data.status === 'misdirected'
        ? strings.environmentStatusMisdirected
        : strings.environmentStatusUnavailable;

  return (
    <div className="space-y-4">
      {surface === 'page' ? (
        <PluginPageHeader
          title={strings.environmentSetupTitle}
          description={strings.environmentSetupDescription}
          icon={Network}
        />
      ) : null}
      <SettingsDocument>
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
            control={(
              <div className="space-y-1 text-left">
                <p className="text-xs text-muted-foreground">{gateway.data.detail}</p>
                {gateway.data.observedTargets.length > 0 ? (
                  <p className="break-all font-mono text-[11px] text-foreground">
                    {strings.environmentObservedTarget}: {gateway.data.observedTargets.join(', ')}
                  </p>
                ) : null}
              </div>
            )}
          />
          {gateway.data.expectedRecord ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {([
                [strings.environmentRecordType, gateway.data.expectedRecord.type],
                [strings.environmentRecordName, gateway.data.expectedRecord.name],
                [strings.environmentRecordValue, gateway.data.expectedRecord.value],
              ] as const).map(([label, value]) => (
                <div key={label} className="min-w-0 rounded-md border border-border bg-muted/30 p-3">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
                    <Button variant="ghost" icon={Copy} onClick={() => copy(value)} title={`${strings.copy} ${label}`}>
                      {strings.copy}
                    </Button>
                  </div>
                  <code className="block break-all font-mono text-xs text-foreground">{value}</code>
                </div>
              ))}
            </div>
          ) : null}
        </SettingsGroup>

        <SettingsGroup
          icon={PackageCheck}
          title={strings.environmentDependenciesTitle}
          description={strings.environmentDependenciesDescription}
          density="compact"
          actions={(
            <span className="flex items-center gap-2">
              <Badge tone={environment.data.ready ? 'success' : 'warning'}>
                {environment.data.ready ? strings.environmentStatusReady : strings.environmentSetupAttention}
              </Badge>
              <HelpTip>{strings.environmentProvisionHelp}</HelpTip>
            </span>
          )}
        >
          {environment.data.items.map((item) => (
            <SettingsRow
              key={item.id}
              label={item.label}
              icon={item.ok ? CheckCircle2 : TriangleAlert}
              trailingLayout={item.detail ? 'stack' : 'inline'}
              status={<Badge tone={item.ok ? 'success' : 'danger'}>{item.ok ? strings.pass : strings.fail}</Badge>}
              control={item.detail ? <p className="text-xs text-muted-foreground">{item.detail}</p> : undefined}
            />
          ))}
          {environment.data.detail ? <p className="px-1 text-xs text-muted-foreground">{environment.data.detail}</p> : null}
          {provisionError ? <p className="px-1 text-xs text-destructive" role="alert">{provisionError}</p> : null}
          {environment.data.canProvision ? (
            <div className="flex justify-end">
              <Button
                variant="accent"
                icon={PackageCheck}
                disabled={environment.data.ready || provision.isPending || installing.current}
                onClick={() => setConfirmInstall(true)}
              >
                {strings.environmentProvision}
              </Button>
            </div>
          ) : null}
        </SettingsGroup>
      </SettingsDocument>

      <ConfirmDialog
        open={confirmInstall}
        title={strings.environmentProvisionConfirmTitle}
        description={strings.environmentProvisionConfirmDescription}
        confirmLabel={strings.environmentProvision}
        pending={provision.isPending}
        onClose={() => { if (!provision.isPending) setConfirmInstall(false); }}
        onConfirm={install}
      />
    </div>
  );
}
