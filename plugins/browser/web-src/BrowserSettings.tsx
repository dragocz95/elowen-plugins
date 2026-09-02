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
  const { PluginPageHeader, SettingsDocument, SettingsGroup, SettingsRow, Badge, LoadingState, ErrorState } = host.components;
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
        <SettingsDocument>
          {report ? (
            <SettingsGroup
              icon={PlugZap}
              title={strings.depsTitle || 'Dependencies'}
              // What the panel cannot prove belongs in the section's own words, not in a row wearing a
              // green badge: the sandbox and the DevTools connection are settled by the first managed
              // launch, and no read of this host can promise them in advance.
              description={strings.depsHint || 'Everything a managed browser session needs before it can start. These checks only read: the sandbox and the DevTools connection are verified by the first managed launch.'}
              actions={(
                <div className="flex items-center gap-2" role="status">
                  <Badge tone={TONE[report.status]}>{statusLabel(report.status)}</Badge>
                  <span className="text-sm text-muted-foreground">
                    {report.ready} / {report.total} {strings.depsCounted || 'dependencies ready'}
                  </span>
                </div>
              )}
            >
              {report.checks.map((check) => {
                const label = strings[`dep_label_${check.id.replace(/-/g, '_')}`] || check.label;
                const badge = <Badge tone={TONE[check.status]}>{statusLabel(check.status)}</Badge>;
                // A ready dependency is one line: its name, and the word Ready. Anything that needs the
                // reader takes the row's full width instead of a phone's value column, and says what is
                // wrong and what to do about it in the row itself rather than behind a tooltip.
                if (check.status === 'ready') {
                  return (
                    <SettingsRow
                      key={check.id}
                      label={label}
                      status={(
                        <span className="flex items-center gap-2">
                          {check.value ? <span className="text-xs text-muted-foreground">{check.value}</span> : null}
                          {badge}
                        </span>
                      )}
                    />
                  );
                }
                return (
                  <SettingsRow
                    key={check.id}
                    label={label}
                    trailingLayout="stack"
                    status={badge}
                    control={(
                      <div className="space-y-1 text-left">
                        <p className="text-xs text-muted-foreground">{say(check.code, check.detail)}</p>
                        {check.remediation ? <p className="text-xs text-foreground">{say(`${check.code}.fix`, check.remediation)}</p> : null}
                      </div>
                    )}
                  />
                );
              })}
            </SettingsGroup>
          ) : null}

          <SettingsGroup
            icon={Activity}
            title={strings.liveCapacity || 'Live capacity'}
            description={strings.liveCapacityHint || 'Only counts active Chrome processes and tab sessions. Browser content remains private to its account.'}
          >
            <SettingsRow
              label={strings.activeAccounts || 'active accounts'}
              status={<Badge tone={query.data.activeUsers >= query.data.maxActiveUsers ? 'warning' : 'success'}>{query.data.activeUsers} / {query.data.maxActiveUsers}</Badge>}
            />
            <SettingsRow label={strings.activeSessions || 'tab sessions'} status={<Badge tone="muted">{query.data.activeSessions}</Badge>} />
            <SettingsRow label={strings.perAccountLimit || 'Per account'} status={<Badge tone="muted">{query.data.maxSessionsPerUser}</Badge>} />
          </SettingsGroup>

          <SettingsGroup
            icon={ShieldCheck}
            title={strings.isolationTitle || 'Isolation'}
            description={strings.isolationHint || 'Every account has a separate persistent profile and Chrome process. All traffic must cross the pinned enforcing proxy.'}
          >
            <SettingsRow label={strings.profileIsolation || 'Per-account profiles'} status={<Badge tone="success">{strings.depReady || 'Ready'}</Badge>} />
            <SettingsRow label={strings.proxyIsolation || 'Pinned DNS proxy'} status={<Badge tone="success">{strings.depReady || 'Ready'}</Badge>} />
            <SettingsRow
              label={strings.chatLiveView || 'Live view in chat'}
              status={<Badge tone={query.data.artifactsAvailable ? 'success' : 'warning'}>{query.data.artifactsAvailable ? strings.chatReady || 'Chat live view ready' : strings.chatUnavailable || 'Chat live view unavailable'}</Badge>}
            />
          </SettingsGroup>

          <SettingsGroup icon={Gauge} title={strings.limitsTitle || 'Limits'} description={strings.limitsHint || 'The sliders above are enforced before allocating Chrome, frames, viewers or input events.'}>
            <SettingsRow label={strings.limitsBody || 'Idle and hard timeouts close sessions automatically. Stream frames use a bounded latest-frame queue and a global bitrate budget.'} />
          </SettingsGroup>
        </SettingsDocument>
      ) : null}
    </div>
  );
}
