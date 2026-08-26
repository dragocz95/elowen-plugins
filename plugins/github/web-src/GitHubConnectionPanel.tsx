import { useEffect, useState } from 'react';
import { Github } from 'lucide-react';
import { jsonBody, localizedError, runtime, type DeviceFlowResponse, type Preview, type StatusResponse } from './runtime';

export const STATUS_KEY = ['plugin', 'github', 'status'];
interface PendingConnectionAction { action: Record<string, unknown>; preview: Preview }
interface DeviceChallenge { flowId: string; verificationUrl: string; userCode: string; expiresAt: number }

export function GitHubConnectionPanel({ onChanged }: { onChanged?: () => void | Promise<void> }) {
  const { components: C, hooks, api, utils } = runtime();
  const s = hooks.usePluginStrings('github');
  const { toast } = hooks.useToast();
  const qc = hooks.useQueryClient();
  const status = hooks.useQuery<StatusResponse>({ queryKey: STATUS_KEY, queryFn: () => api('/plugins/github/api/status') });
  const [pending, setPending] = useState<PendingConnectionAction | null>(null);
  const [flow, setFlow] = useState<DeviceChallenge | null>(null);

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: STATUS_KEY });
    await onChanged?.();
  };
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
  }, [flowStatus.data?.status]);

  useEffect(() => {
    if (!flow || !flowStatus.isError) return;
    const statusCode = flowStatus.error && typeof flowStatus.error === 'object' && 'status' in flowStatus.error
      ? Number((flowStatus.error as { status?: unknown }).status) : 0;
    if (statusCode !== 404 && utils.apiErrorMessage(flowStatus.error) !== 'flow_not_found') return;
    setFlow(null);
    void refresh();
    toast(s.connectionFailed, 'error');
  }, [flow, flowStatus.isError, flowStatus.error]);

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
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-4">
          {account.avatarUrl ? <img src={account.avatarUrl} alt="" className="size-14 rounded-full border border-border" /> : <Github className="size-12" />}
          <div className="min-w-0 flex-1">
            <div className="truncate text-lg font-semibold text-text">{account.name || account.login}</div>
            <div className="truncate text-sm text-text-muted">@{account.login}</div>
          </div>
          <C.Badge tone={status.data.reconnectRequired ? 'danger' : 'success'}>{status.data.reconnectRequired ? s.reconnectRequired : s.connected}</C.Badge>
        </div>
        {/* The connection's facts read through the host's own table, so this panel lines up with every
            other record surface in the app instead of inventing a private definition list. */}
        <C.DataTable ariaLabel={s.accountTitle || s.title} columns="minmax(0,14rem) minmax(0,1fr)">
          <C.DataTableRow>
            <C.DataTableCell className="text-text-muted">{s.mappings}</C.DataTableCell>
            <C.DataTableCell><span className="block truncate font-mono text-text">{status.data.mappings}</span></C.DataTableCell>
          </C.DataTableRow>
          <C.DataTableRow>
            <C.DataTableCell className="text-text-muted">GitHub ID</C.DataTableCell>
            <C.DataTableCell><span className="block truncate font-mono text-text">{account.githubUserId}</span></C.DataTableCell>
          </C.DataTableRow>
        </C.DataTable>
        <div className="flex flex-wrap gap-2">
          <C.Button variant="ghost" onClick={() => test.mutate()} disabled={test.isPending}>{s.testConnection}</C.Button>
          <C.Button variant="ghost" onClick={() => preview.mutate({ type: 'replace_identity' })}>{s.replaceIdentity}</C.Button>
          <C.Button variant="ghost-danger" onClick={() => preview.mutate({ type: 'disconnect' })}>{s.disconnect}</C.Button>
        </div>
      </div>
    ) : (
      <C.EmptyState title={status.data?.reconnectRequired ? s.reconnectRequired : s.disconnected} description={s.intro} icon={Github} action={<C.Button variant="accent" onClick={beginConnect} disabled={connect.isPending}>{status.data?.reconnectRequired ? s.reconnect : s.connect}</C.Button>} />
    )}
    {pending ? <C.ConfirmDialog open title={pending.preview.title || s.confirmExternal} description={`${pending.preview.description}\n\n${s.confirmationExpires}`} confirmLabel={s.confirm} onClose={() => setPending(null)} onConfirm={completePending} /> : null}
  </>;
}
