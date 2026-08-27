import { useCallback, useEffect, useState } from 'react';
import { GitFork, Github, Hash } from 'lucide-react';
import { jsonBody, localizedError, runtime, type DeviceFlowResponse, type Preview, type StatusResponse } from './runtime';

export const STATUS_KEY = ['plugin', 'github', 'status'];
interface PendingConnectionAction { action: Record<string, unknown>; preview: Preview }
interface DeviceChallenge { flowId: string; verificationUrl: string; userCode: string; expiresAt: number }

export function GitHubConnectionPanel({ onChanged, surface }: { onChanged?: () => void | Promise<void>; surface?: 'page' | 'deck' }) {
  const { components: C, hooks, api, utils } = runtime();
  const s = hooks.usePluginStrings('github');
  const { toast } = hooks.useToast();
  const qc = hooks.useQueryClient();
  const status = hooks.useQuery<StatusResponse>({ queryKey: STATUS_KEY, queryFn: () => api('/plugins/github/api/status') });
  const [pending, setPending] = useState<PendingConnectionAction | null>(null);
  const [flow, setFlow] = useState<DeviceChallenge | null>(null);

  const refresh = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: STATUS_KEY });
    await onChanged?.();
  }, [onChanged, qc]);
  const connect = hooks.useMutation<DeviceChallenge, unknown, { replaceIdentity?: boolean; reconnect?: boolean; confirmationToken?: string }>({
    mutationFn: (value: { replaceIdentity?: boolean; reconnect?: boolean; confirmationToken?: string }) => api('/plugins/github/api/auth/start', jsonBody(value)) as Promise<DeviceChallenge>,
    onSuccess: (value: DeviceChallenge) => setFlow(value),
    onError: (error: unknown) => toast(localizedError(error, s), 'error'),
  });
  const flowStatus = hooks.useQuery<DeviceFlowResponse>({
    queryKey: ['plugin', 'github', 'auth', flow?.flowId],
    queryFn: () => api(`/plugins/github/api/auth/status?flowId=${encodeURIComponent(flow!.flowId)}`),
    enabled: !!flow,
    refetchInterval: flow ? 2_000 : false,
  });
  const cancel = hooks.useMutation<DeviceFlowResponse, unknown, string>({
    mutationFn: (flowId: string) => api('/plugins/github/api/auth/cancel', jsonBody({ flowId })) as Promise<DeviceFlowResponse>,
    onSuccess: async (value: DeviceFlowResponse) => {
      setFlow(null);
      await refresh();
      toast(value.status === 'connected' ? s.connectionComplete : s.connectionCancelled);
    },
    onError: (error: unknown) => toast(localizedError(error, s), 'error'),
  });
  const preview = hooks.useMutation<Preview, unknown, Record<string, unknown>>({
    mutationFn: (action: Record<string, unknown>) => api('/plugins/github/api/actions/preview', jsonBody(action)) as Promise<Preview>,
    onSuccess: (value: Preview, action: Record<string, unknown>) => setPending({ action, preview: value }),
    onError: (error: unknown) => toast(localizedError(error, s), 'error'),
  });
  const confirm = hooks.useMutation<unknown, unknown, { action: Record<string, unknown>; token: string }>({
    mutationFn: (value: { action: Record<string, unknown>; token: string }) => api('/plugins/github/api/actions/confirm', jsonBody({ ...value.action, confirmationToken: value.token })),
    onSuccess: async () => { setPending(null); await refresh(); toast(s.actionComplete); },
    onError: (error: unknown) => toast(localizedError(error, s), 'error'),
  });
  const test = hooks.useMutation<{ rateLimit: { limit: number; remaining: number; reset: number } | null }, unknown, void>({
    mutationFn: () => api('/plugins/github/api/test', jsonBody({})) as Promise<{ rateLimit: { limit: number; remaining: number; reset: number } | null }>,
    onSuccess: () => toast(s.connectionHealthy),
    onError: (error: unknown) => toast(localizedError(error, s), 'error'),
  });

  useEffect(() => {
    const persisted = status.data?.flow;
    if (!flow && persisted?.flowId && persisted.verificationUrl && persisted.userCode && (persisted.status === 'pending' || persisted.status === 'completing')) {
      setFlow({ flowId: persisted.flowId, verificationUrl: persisted.verificationUrl, userCode: persisted.userCode, expiresAt: persisted.expiresAt });
    }
  }, [flow, status.data?.flow]);

  useEffect(() => {
    const state = flowStatus.data?.status;
    if (!state || state === 'pending' || state === 'completing') return;
    setFlow(null);
    void refresh();
    if (state === 'connected') toast(s.connectionComplete);
    else if (state === 'cancelled') toast(s.connectionCancelled);
    else if (state === 'expired') toast(s.connectionExpired, 'error');
    else toast(s.connectionFailed, 'error');
  }, [flowStatus.data?.status, refresh, s.connectionCancelled, s.connectionComplete, s.connectionExpired, s.connectionFailed, toast]);

  useEffect(() => {
    if (!flow || !flowStatus.isError) return;
    const statusCode = flowStatus.error && typeof flowStatus.error === 'object' && 'status' in flowStatus.error
      ? Number((flowStatus.error as { status?: unknown }).status) : 0;
    if (statusCode !== 404 && utils.apiErrorMessage(flowStatus.error) !== 'flow_not_found') return;
    setFlow(null);
    void refresh();
    toast(s.connectionFailed, 'error');
  }, [flow, flowStatus.isError, flowStatus.error, refresh, s.connectionFailed, toast, utils]);

  if (status.isError) return <C.ErrorState message={s.loadError} onRetry={() => status.refetch()} />;
  if (status.isLoading) return <C.LoadingState variant="detail" />;

  const account = status.data?.account;
  const beginConnect = () => connect.mutate(status.data?.reconnectRequired ? { reconnect: true } : {});
  const completePending = () => {
    if (!pending) return;
    if (pending.action.type === 'replace_identity') {
      connect.mutate({ replaceIdentity: true, confirmationToken: pending.preview.confirmationToken });
      setPending(null);
      return;
    }
    confirm.mutate({ action: pending.action, token: pending.preview.confirmationToken });
  };

  if (flow) {
    const state = flowStatus.data?.status;
    const terminal = state === 'cancelled' || state === 'expired' || state === 'failed' || state === 'interrupted';
    return <div className="space-y-4">
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="text-sm font-semibold text-text">{s.waitingForGitHub}</div>
        <div className="mt-3 text-xs text-text-muted">{s.deviceCode}</div>
        <code className="mt-1 block rounded-lg bg-bg px-3 py-2 text-center text-lg font-semibold tracking-[0.2em] text-text">{flow.userCode}</code>
        <a className="mt-3 inline-flex text-sm font-medium text-accent hover:underline" href={flow.verificationUrl} target="_blank" rel="noreferrer">{s.verifyOnGitHub}</a>
        {state === 'failed' ? <p className="mt-3 text-sm text-danger">{s.connectionFailed}</p> : null}
        {state === 'expired' ? <p className="mt-3 text-sm text-danger">{s.connectionExpired}</p> : null}
        {state === 'cancelled' ? <p className="mt-3 text-sm text-text-muted">{s.connectionCancelled}</p> : null}
        {state === 'interrupted' ? <p className="mt-3 text-sm text-danger">{s.connectionFailed}</p> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {!terminal ? <C.Button variant="ghost" onClick={() => cancel.mutate(flow.flowId)} disabled={cancel.isPending}>{s.cancelConnection}</C.Button> : null}
      </div>
    </div>;
  }

  return <>
    {status.data?.connected && account ? (
      /* Shaped exactly like the Account profile section: the connected identity leads, above a card of
         plain rows. The avatar is GitHub's, so it is an <img> rather than the host Avatar, which renders
         an Elowen account. */
      <>
        <C.SpatialIdentity actions={(
          <>
            <button type="button" className="spatial-inline-action" onClick={() => test.mutate()} disabled={test.isPending}>
              <Github size={14} aria-hidden />{s.testConnection}
            </button>
            <button type="button" className="spatial-inline-action" onClick={() => preview.mutate({ type: 'replace_identity' })}>
              {s.replaceIdentity}
            </button>
            <button type="button" className="spatial-inline-action text-danger" onClick={() => preview.mutate({ type: 'disconnect' })}>
              {s.disconnect}
            </button>
          </>
        )}>
          <div className="flex items-center gap-4">
            {account.avatarUrl
              ? <img src={account.avatarUrl} alt="" className="size-[72px] shrink-0 rounded-full border border-border object-cover" />
              : <Github className="size-[72px] shrink-0 rounded-full border border-border p-4 text-text-muted" />}
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex items-center gap-2">
                <span className="truncate text-lg font-semibold text-text">{account.name || account.login}</span>
                <C.Badge tone={status.data.reconnectRequired ? 'danger' : 'success'}>{status.data.reconnectRequired ? s.reconnectRequired : s.connected}</C.Badge>
              </span>
              <span className="truncate font-mono text-xs text-text-muted">@{account.login}</span>
            </div>
          </div>
        </C.SpatialIdentity>
        <C.PluginSection surface={surface ?? 'deck'} title={s.accountTitle || s.title} description={s.accountHint || s.intro} icon={Github}>
          <C.SettingsRow label={s.mappings} icon={GitFork} status={<span className="font-mono">{status.data.mappings}</span>} />
          <C.SettingsRow
            label="GitHub ID"
            icon={Hash}
            status={<span className="font-mono">{account.githubUserId}</span>}
          />
        </C.PluginSection>
      </>
    ) : (
      <C.EmptyState title={status.data?.reconnectRequired ? s.reconnectRequired : s.disconnected} description={s.intro} icon={Github} action={<C.Button variant="accent" onClick={beginConnect} disabled={connect.isPending}>{status.data?.reconnectRequired ? s.reconnect : s.connect}</C.Button>} />
    )}
    {pending ? <C.ConfirmDialog open title={pending.preview.title || s.confirmExternal} description={`${pending.preview.description}\n\n${s.confirmationExpires}`} confirmLabel={s.confirm} onClose={() => setPending(null)} onConfirm={completePending} /> : null}
  </>;
}
