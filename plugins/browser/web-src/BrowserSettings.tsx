import { Activity, Gauge, Monitor, ShieldCheck } from 'lucide-react';
import type { PluginPageProps } from 'elowen-plugin-ui-kit';
import { apiError, runtime } from './runtime';

interface RuntimeStatus {
  activeUsers: number;
  activeSessions: number;
  maxActiveUsers: number;
  maxSessionsPerUser: number;
  artifactsAvailable: boolean;
}

export function BrowserSettings({ surface }: PluginPageProps) {
  const host = runtime();
  const { PluginPageHeader, DetailBlock, Badge, LoadingState, ErrorState } = host.components;
  const strings = host.hooks.usePluginStrings('browser');
  const query = host.hooks.useQuery<RuntimeStatus>({
    queryKey: ['browser', 'admin-status'],
    queryFn: () => runtime().api('/plugins/browser/api/admin-status'),
    refetchInterval: 10_000,
  });

  return (
    <div className="space-y-4">
      {surface === 'page' ? <PluginPageHeader title={strings.settingsTitle || 'Browser runtime'} description={strings.settingsDescription || 'Live capacity and isolation status for managed Chrome sessions.'} icon={Monitor} /> : null}
      {query.isLoading ? <LoadingState variant="block" height="10rem" /> : query.isError ? <ErrorState message={apiError(query.error)} onRetry={() => query.refetch()} /> : query.data ? (
        <div className="grid gap-3 md:grid-cols-2">
          <DetailBlock icon={Activity} title={strings.liveCapacity || 'Live capacity'} hint={strings.liveCapacityHint || 'Only counts active Chrome processes and tab sessions. Browser content remains private to its account.'}>
            <div className="flex flex-wrap gap-2">
              <Badge tone={query.data.activeUsers >= query.data.maxActiveUsers ? 'warning' : 'success'}>{query.data.activeUsers} / {query.data.maxActiveUsers} {strings.activeAccounts || 'active accounts'}</Badge>
              <Badge tone="muted">{query.data.activeSessions} {strings.activeSessions || 'tab sessions'}</Badge>
              <Badge tone="muted">{strings.perAccountLimit || 'Per account'}: {query.data.maxSessionsPerUser}</Badge>
            </div>
          </DetailBlock>
          <DetailBlock icon={ShieldCheck} title={strings.isolationTitle || 'Isolation'} hint={strings.isolationHint || 'Every account has a separate persistent profile and Chrome process. All traffic must cross the pinned enforcing proxy.'}>
            <div className="flex flex-wrap gap-2">
              <Badge tone="success">{strings.profileIsolation || 'Per-account profiles'}</Badge>
              <Badge tone="success">{strings.proxyIsolation || 'Pinned DNS proxy'}</Badge>
              <Badge tone={query.data.artifactsAvailable ? 'success' : 'warning'}>{query.data.artifactsAvailable ? strings.chatReady || 'Chat live view ready' : strings.chatUnavailable || 'Chat live view unavailable'}</Badge>
            </div>
          </DetailBlock>
          <DetailBlock icon={Gauge} title={strings.limitsTitle || 'Limits'} hint={strings.limitsHint || 'The sliders above are enforced before allocating Chrome, frames, viewers or input events.'}>
            <p className="text-sm text-muted-foreground">{strings.limitsBody || 'Idle and hard timeouts close sessions automatically. Stream frames use a bounded latest-frame queue and a global bitrate budget.'}</p>
          </DetailBlock>
        </div>
      ) : null}
    </div>
  );
}
