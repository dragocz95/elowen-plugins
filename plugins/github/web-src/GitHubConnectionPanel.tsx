import { useCallback, useEffect, useState } from 'react';
import { Github } from 'lucide-react';
import { jsonBody, localizedError, runtime, type DeviceFlowResponse, type Preview, type StatusResponse } from './runtime';

export const STATUS_KEY = ['plugin', 'github', 'status'];
interface PendingConnectionAction { action: Record<string, unknown>; preview: Preview }
interface DeviceChallenge { flowId: string; verificationUrl: string | null; userCode: string | null; expiresAt: number }

export function GitHubConnectionPanel({ onChanged }: { onChanged?: () => void | Promise<void> }) {
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
    if (!flow && persisted?.flowId && (persisted.status === 'pending' || persisted.status === 'completing')) {
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
      connect.mutate(
        { replaceIdentity: true, confirmationToken: pending.preview.confirmationToken },
        { onSuccess: () => setPending(null) },
      );
      return;
    }
    confirm.mutate({ action: pending.action, token: pending.preview.confirmationToken });
  };

  if (flow) {
    const state = flowStatus.data?.status;
    const terminal = state === 'cancelled' || state === 'expired' || state === 'failed' || state === 'interrupted';
    return <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="text-sm font-semibold text-foreground">{s.waitingForGitHub}</div>
        {flow.userCode ? <>
          <div className="mt-3 text-xs text-muted-foreground">{s.deviceCode}</div>
          <code className="mt-1 block rounded-lg bg-background px-3 py-2 text-center text-lg font-semibold tracking-[0.2em] text-foreground">{flow.userCode}</code>
        </> : <p className="mt-3 text-sm text-muted-foreground">{s.waitingForGitHub}</p>}
        {flow.verificationUrl ? <a className="mt-3 inline-flex text-sm font-medium text-primary hover:underline" href={flow.verificationUrl} target="_blank" rel="noreferrer">{s.verifyOnGitHub}</a> : null}
        {state === 'failed' ? <p className="mt-3 text-sm text-destructive">{s.connectionFailed}</p> : null}
        {state === 'expired' ? <p className="mt-3 text-sm text-destructive">{s.connectionExpired}</p> : null}
        {state === 'cancelled' ? <p className="mt-3 text-sm text-muted-foreground">{s.connectionCancelled}</p> : null}
        {state === 'interrupted' ? <p className="mt-3 text-sm text-destructive">{s.connectionFailed}</p> : null}
        {flowStatus.isError && state !== 'failed' && state !== 'expired' && state !== 'cancelled' && state !== 'interrupted'
          ? <C.ErrorState message={localizedError(flowStatus.error, s)} onRetry={() => flowStatus.refetch()} />
          : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {!terminal ? <C.Button variant="ghost" onClick={() => cancel.mutate(flow.flowId)} disabled={cancel.isPending}>{s.cancelConnection}</C.Button> : null}
      </div>
    </div>;
  }

  const connected = !!status.data?.connected && !!account;
  return <>
    {/* One row of the Linked accounts drawer, built from the host's own row so it reads as a sibling of
        Discord and Teams rather than a guest with its own furniture. The identity IS the value of the
        link, so it sits where a chat platform puts its id field; the GitHub avatar is gone because the
        question this drawer answers is "which account am I over there", and a face 72px tall answered it
        four times louder than every row beside it. Repository mappings and the numeric GitHub id moved
        out with it: operational detail belongs on the plugin's own page, not in the identity list. */}
    <C.LinkedAccountRow
      icon={<Github size={18} aria-hidden />}
      title={s.title}
      actions={connected ? (
        <>
          <C.Button variant="ghost" onClick={() => test.mutate()} disabled={test.isPending}>{s.testConnection}</C.Button>
          <C.Button variant="ghost" onClick={() => preview.mutate({ type: 'replace_identity' })}>{s.replaceIdentity}</C.Button>
          <C.Button variant="ghost-danger" onClick={() => preview.mutate({ type: 'disconnect' })}>{s.disconnect}</C.Button>
        </>
      ) : (
        <C.Button variant="ghost" onClick={beginConnect} disabled={connect.isPending}>{status.data?.reconnectRequired ? s.reconnect : s.connect}</C.Button>
      )}
      description={connected ? s.accountHint || s.intro : s.intro}
    >
      {connected && account ? (
        <span className="flex items-center gap-2">
          <span className="truncate font-mono text-sm text-foreground">@{account.login}</span>
          <C.Badge tone={status.data?.reconnectRequired ? 'danger' : 'success'}>{status.data?.reconnectRequired ? s.reconnectRequired : s.connected}</C.Badge>
        </span>
      ) : null}
    </C.LinkedAccountRow>
    {pending ? <C.ConfirmDialog open title={pending.preview.title || s.confirmExternal} description={`${pending.preview.description}\n\n${s.confirmationExpires}`} confirmLabel={s.confirm} onClose={() => setPending(null)} onConfirm={completePending} /> : null}
  </>;
}

/** What the CLOSED Linked accounts summary shows for GitHub: the same chip the host draws for a linked
 *  chat platform, and nothing at all when this account has no GitHub identity — the host cannot decide
 *  that, so an unlinked connector must say nothing rather than have the host guess. Shares the panel's
 *  query key, so mounting both costs one request. */
export function GitHubAccountChip() {
  const { components: C, hooks, api } = runtime();
  const s = hooks.usePluginStrings('github');
  const status = hooks.useQuery<StatusResponse>({ queryKey: STATUS_KEY, queryFn: () => api('/plugins/github/api/status') });
  if (!status.data?.connected) return null;
  return <C.SummaryChip icon={<Github size={12} aria-hidden />} label={s.title} />;
}
