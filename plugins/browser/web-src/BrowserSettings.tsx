import { Activity, Gauge, Monitor, PlugZap, ShieldCheck } from 'lucide-react';
import type { PluginPageProps } from 'elowen-plugin-ui-kit';
import { apiError, runtime } from './runtime';

type DependencyStatus = 'ready' | 'warning' | 'blocked';

/** Mirror of the backend's `BrowserDependencyCheck` (plugins/browser/src/readiness.ts). The panel renders
 *  these verdicts and never recomputes one: the daemon owns what "ready" means. */
interface DependencyCheck {
  id: string;
  status: DependencyStatus;
  label: string;
  code: string;
  detail: string;
  value?: string;
  remediation?: string;
}

interface RuntimeStatus {
  activeUsers: number;
  activeSessions: number;
  maxActiveUsers: number;
  maxSessionsPerUser: number;
  artifactsAvailable: boolean;
  dependencies?: {
    status: DependencyStatus;
    ready: number;
    total: number;
    checks: DependencyCheck[];
  };
}

const TONE: Record<DependencyStatus, 'success' | 'warning' | 'danger'> = {
  ready: 'success',
  warning: 'warning',
  blocked: 'danger',
};

export function BrowserSettings({ surface }: PluginPageProps) {
  const host = runtime();
  const { PluginPageHeader, DetailBlock, Badge, EntityList, EntityRow, LoadingState, ErrorState } = host.components;
  const strings = host.hooks.usePluginStrings('browser');
  const query = host.hooks.useQuery<RuntimeStatus>({
    queryKey: ['browser', 'admin-status'],
    queryFn: () => runtime().api('/plugins/browser/api/admin-status'),
    refetchInterval: 10_000,
  });

  /** Translate one backend outcome. The daemon decided the sentence; this only says it in the reader's
   *  language, falling back to the English the daemon already sent. */
  const say = (code: string, fallback: string): string => strings[`dep_${code.replace(/\./g, '_')}`] || fallback;
  const statusLabel = (status: DependencyStatus): string => (
    status === 'ready' ? strings.depReady || 'Ready'
      : status === 'warning' ? strings.depAttention || 'Attention'
        : strings.depBlocked || 'Blocked'
  );

  const report = query.data?.dependencies;

  return (
    <div className="space-y-4">
      {surface === 'page' ? <PluginPageHeader title={strings.settingsTitle || 'Browser runtime'} description={strings.settingsDescription || 'Live capacity and isolation status for managed Chrome sessions.'} icon={Monitor} /> : null}
      {query.isLoading ? <LoadingState variant="block" height="10rem" /> : query.isError ? <ErrorState message={apiError(query.error)} onRetry={() => query.refetch()} /> : query.data ? (
        <div className="space-y-3">
          {report ? (
            <DetailBlock
              icon={PlugZap}
              title={strings.depsTitle || 'Dependencies'}
              hint={strings.depsHint || 'Everything a managed browser session needs before it can start. Every check is read-only and never starts a browser.'}
            >
              {/* The verdict first, in words as well as tone, so a glance answers the whole question. */}
              <div role="status" className="mb-2 flex flex-wrap items-center gap-2">
                <Badge tone={TONE[report.status]}>{statusLabel(report.status)}</Badge>
                <span className="text-sm text-muted-foreground">
                  {report.ready} / {report.total} {strings.depsCounted || 'dependencies ready'}
                </span>
              </div>
              <EntityList className="rounded-lg border border-border">
                {report.checks.map((check) => (
                  <EntityRow key={check.id} interactive={false} className="border-b border-border last:border-b-0 !py-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <span className="min-w-0 truncate text-sm font-medium text-foreground">
                        {strings[`dep_label_${check.id.replace(/-/g, '_')}`] || check.label}
                      </span>
                      <Badge tone={TONE[check.status]}>{statusLabel(check.status)}</Badge>
                    </div>
                    {/* A ready dependency says nothing beyond its badge — the panel stays quiet until
                        something actually needs the reader. The one exception is a plain fact worth
                        seeing, like which executable is in use. */}
                    {check.status !== 'ready' ? (
                      <p className="mt-1 text-xs text-muted-foreground">{say(check.code, check.detail)}</p>
                    ) : null}
                    {check.value ? (
                      <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{check.value}</p>
                    ) : null}
                    {check.remediation ? (
                      <p className="mt-1 text-xs text-foreground">{say(`${check.code}.fix`, check.remediation)}</p>
                    ) : null}
                  </EntityRow>
                ))}
              </EntityList>
            </DetailBlock>
          ) : null}
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
        </div>
      ) : null}
    </div>
  );
}
