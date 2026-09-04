import { useEffect, useState } from 'react';
import {
  Activity, Camera, Gauge, Play, RefreshCw, RotateCcw, ScrollText, Square,
} from 'lucide-react';
import {
  jsonBody, relativeTime, runtime,
  type EnvironmentLogsResponse, type EnvironmentView, type ReleaseView,
} from './runtime.js';

interface EnvironmentCall {
  path: string;
  init: RequestInit;
  done?: string;
}

export function EnvironmentDetail({
  siteId,
  currentReleaseId,
  environment,
  snapshots,
  busy,
  runCall,
}: {
  siteId: string;
  currentReleaseId: string | null;
  environment: EnvironmentView;
  snapshots: ReleaseView[];
  busy: boolean;
  runCall(call: EnvironmentCall, onSuccess?: () => void): void;
}) {
  const host = runtime();
  const { Badge, Button, ConfirmDialog, DetailBlock, HelpTip, Input } = host.components;
  const strings = host.hooks.usePluginStrings('sites');
  const [snapshotNote, setSnapshotNote] = useState('');
  const [includeData, setIncludeData] = useState(true);
  const [restore, setRestore] = useState<ReleaseView | null>(null);
  const [restoreData, setRestoreData] = useState(false);
  const [limits, setLimits] = useState({ cpus: '', memoryMb: '', pidsLimit: '', diskSoftMb: '' });

  useEffect(() => {
    const source = environment.limitOverrides;
    if (!source) return;
    setLimits({
      cpus: source.cpus === null ? '' : String(source.cpus),
      memoryMb: source.memoryMb === null ? '' : String(source.memoryMb),
      pidsLimit: source.pidsLimit === null ? '' : String(source.pidsLimit),
      diskSoftMb: source.diskSoftMb === null ? '' : String(source.diskSoftMb),
    });
  }, [environment.limitOverrides]);

  const logs = host.hooks.useQuery<EnvironmentLogsResponse>({
    queryKey: ['sites', 'environment-logs', siteId],
    queryFn: () => runtime().api(`/plugins/sites/api/site/${siteId}/logs?lines=200`),
    enabled: environment.canReadLogs === true,
  });

  const actionPending = environment.action?.lastError === null;
  const hasError = Boolean(environment.lastError || environment.action?.lastError);
  const mutationBlocked = busy || actionPending;
  const canControl = environment.canControl === true;
  const canSnapshot = canControl
    && environment.state === 'running'
    && environment.desiredState === 'running'
    && !environment.action;

  const control = (action: 'start' | 'stop' | 'restart') => runCall({
    path: `/plugins/sites/api/site/${siteId}/control`,
    init: jsonBody('POST', { action }),
    done: strings.environmentActionScheduled,
  });

  const snapshot = () => {
    if (!canSnapshot || mutationBlocked) return;
    runCall({
      path: `/plugins/sites/api/site/${siteId}/snapshot`,
      init: jsonBody('POST', { includeData, note: snapshotNote.trim() }),
      done: strings.environmentSnapshotScheduled,
    }, () => setSnapshotNote(''));
  };

  const numberOrNull = (value: string): number | null => value.trim() === '' ? null : Number(value);
  const saveLimits = () => {
    const values = Object.values(limits).filter((value) => value.trim() !== '').map(Number);
    if (values.some((value) => !Number.isFinite(value))) return;
    runCall({
      path: `/plugins/sites/api/site/${siteId}`,
      init: jsonBody('PATCH', {
        environmentCpus: numberOrNull(limits.cpus),
        environmentMemoryMb: numberOrNull(limits.memoryMb),
        environmentPidsLimit: numberOrNull(limits.pidsLimit),
        environmentDiskSoftMb: numberOrNull(limits.diskSoftMb),
      }),
      done: strings.environmentLimitsSaved,
    });
  };

  const stateTone = environment.state === 'running' ? 'success' : environment.state === 'paused' ? 'warning' : 'danger';

  return (
    <div className="flex flex-col gap-5">
      <DetailBlock icon={Activity} title={strings.environmentState} hint={strings.environmentTransportLimit}>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2">
            <span className="text-xs text-muted-foreground">{strings.environmentObservedState}</span>
            <Badge tone={stateTone}>{environment.state ?? strings.environmentStatusUnavailable}</Badge>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2">
            <span className="text-xs text-muted-foreground">{strings.environmentDesiredState}</span>
            <Badge tone={environment.desiredState === 'running' ? 'success' : environment.desiredState === 'restarting' ? 'warning' : 'muted'}>
              {environment.desiredState}
            </Badge>
          </div>
        </div>
        {environment.action ? (
          <div className={`rounded-md border px-3 py-2 text-xs ${environment.action.lastError ? 'border-destructive/40 bg-destructive/10 text-destructive' : 'border-primary/40 bg-primary/10 text-foreground'}`} role="status">
            <strong>{environment.action.lastError ? strings.environmentActionError : strings.environmentActionPending}</strong>
            <div className="mt-1 font-mono">{environment.action.kind} · {environment.action.snapshotId}</div>
            {environment.action.lastError ? <p className="mt-1">{environment.action.lastError}</p> : null}
          </div>
        ) : environment.lastError ? <p className="text-xs text-destructive">{environment.lastError}</p> : null}
        {canControl ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" icon={Play} disabled={mutationBlocked || (environment.desiredState === 'running' && !hasError)} onClick={() => control('start')}>
              {strings.environmentStart}
            </Button>
            <Button variant="ghost" icon={Square} disabled={mutationBlocked || environment.desiredState === 'stopped'} onClick={() => control('stop')}>
              {strings.environmentStop}
            </Button>
            <Button variant="ghost" icon={RefreshCw} disabled={mutationBlocked} onClick={() => control('restart')}>
              {strings.environmentRestart}
            </Button>
          </div>
        ) : null}
        <p className="text-[11px] text-muted-foreground">{strings.environmentTransportLimit}</p>
      </DetailBlock>

      <DetailBlock icon={Camera} title={strings.environmentSnapshots} hint={strings.environmentCrashConsistent}>
        {canControl ? (
          <div className="space-y-3 rounded-md border border-border bg-muted/20 p-3">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{strings.environmentSnapshotNote}</span>
              <Input
                value={snapshotNote}
                onChange={(event) => setSnapshotNote(event.target.value)}
                placeholder={strings.environmentSnapshotNotePlaceholder}
                disabled={mutationBlocked}
                aria-label={strings.environmentSnapshotNote}
              />
            </label>
            <label className="flex items-start gap-2 text-xs text-foreground">
              <input
                type="checkbox"
                checked={includeData}
                disabled={mutationBlocked}
                aria-label={strings.environmentIncludeData}
                onChange={(event) => setIncludeData(event.target.checked)}
                className="mt-0.5"
              />
              <span>{strings.environmentIncludeData}</span>
              <HelpTip>{strings.environmentIncludeDataHelp}</HelpTip>
            </label>
            <Button variant="ghost" icon={Camera} disabled={mutationBlocked || !canSnapshot} onClick={snapshot}>
              {strings.environmentSnapshot}
            </Button>
          </div>
        ) : null}

        {snapshots.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">{strings.environmentNoSnapshots}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {snapshots.map((item) => {
              const active = item.id === currentReleaseId;
              return (
                <li key={item.id} className={`rounded-md border px-3 py-2 ${active ? 'border-primary/40 bg-primary/10' : 'border-border bg-muted/30'}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2 text-xs text-foreground">
                        {relativeTime(item.createdAt)}
                        {active ? <Badge tone="success">{strings.environmentSnapshotActive}</Badge> : null}
                        {item.includesData ? <Badge tone="muted">/data</Badge> : null}
                      </span>
                      <span className="mt-1 block truncate text-[11px] text-muted-foreground">{item.note || item.model}</span>
                    </span>
                    {canControl && !active ? (
                      <div className="flex flex-wrap gap-1">
                        <Button
                          variant="ghost"
                          icon={RotateCcw}
                          disabled={mutationBlocked}
                          onClick={() => { setRestoreData(false); setRestore(item); }}
                        >
                          {strings.environmentRestoreRoot}
                        </Button>
                        {item.includesData ? (
                          <Button
                            variant="ghost"
                            icon={RotateCcw}
                            disabled={mutationBlocked}
                            onClick={() => { setRestoreData(true); setRestore(item); }}
                          >
                            {strings.environmentRestoreData}
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </DetailBlock>

      {environment.canReadLogs ? (
        <DetailBlock icon={ScrollText} title={strings.environmentLogs}>
          <div className="flex justify-end">
            <Button variant="ghost" icon={RefreshCw} disabled={logs.isLoading} onClick={() => logs.refetch()}>{strings.refresh}</Button>
          </div>
          {logs.isError ? <p className="text-xs text-destructive">{host.utils.apiErrorMessage(logs.error)}</p> : null}
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border bg-muted/40 p-3 font-mono text-[11px] text-muted-foreground">
            {logs.data ? [logs.data.lifecycle, logs.data.journal].filter(Boolean).join('\n\n') || strings.runtimeEmptyLog : strings.environmentLogsLoading}
          </pre>
        </DetailBlock>
      ) : null}

      {environment.canSetLimits && environment.limits && environment.limitOverrides ? (
        <DetailBlock icon={Gauge} title={strings.environmentLimits} hint={strings.environmentLimitsHint}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {([
              ['cpus', strings.environmentLimitCpu, environment.limits.cpus],
              ['memoryMb', strings.environmentLimitMemory, environment.limits.memoryMb],
              ['pidsLimit', strings.environmentLimitPids, environment.limits.pidsLimit],
              ['diskSoftMb', strings.environmentLimitDisk, environment.limits.diskSoftMb],
            ] as const).map(([key, label, effective]) => (
              <label key={key} className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
                <Input
                  type="number"
                  value={limits[key]}
                  onChange={(event) => setLimits((current) => ({ ...current, [key]: event.target.value }))}
                  placeholder={String(effective)}
                  disabled={mutationBlocked}
                  aria-label={label}
                />
              </label>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">{strings.environmentLimitsHint}</p>
          <Button variant="ghost" disabled={mutationBlocked} onClick={saveLimits}>{strings.environmentSaveLimits}</Button>
        </DetailBlock>
      ) : null}

      <ConfirmDialog
        open={restore !== null}
        title={strings.environmentRestoreConfirmTitle}
        description={restoreData ? strings.environmentRestoreWithDataWarning : strings.environmentRestoreRootWarning}
        confirmLabel={strings.environmentRestore}
        pending={busy}
        onClose={() => { if (!busy) setRestore(null); }}
        onConfirm={() => {
          if (!restore || busy) return;
          const selected = restore;
          runCall({
            path: `/plugins/sites/api/site/${siteId}/rollback`,
            init: jsonBody('POST', { releaseId: selected.id, restoreData }),
            done: strings.environmentRestoreScheduled,
          }, () => setRestore(null));
        }}
      />
    </div>
  );
}
