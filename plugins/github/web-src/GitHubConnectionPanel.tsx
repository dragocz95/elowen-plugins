import { useState } from 'react';
import { Github } from 'lucide-react';
import { jsonBody, localizedError, runtime, type Preview, type StatusResponse } from './runtime';

export const STATUS_KEY = ['plugin', 'github', 'status'];
interface PendingConnectionAction { action: Record<string, unknown>; preview: Preview }

export function GitHubConnectionPanel({ onChanged }: { onChanged?: () => void | Promise<void> }) {
  const { components: C, hooks, api } = runtime();
  const s = hooks.usePluginStrings('github');
  const { toast } = hooks.useToast();
  const qc = hooks.useQueryClient();
  const status = hooks.useQuery<StatusResponse>({ queryKey: STATUS_KEY, queryFn: () => api('/plugins/github/api/status') });
  const [pending, setPending] = useState<PendingConnectionAction | null>(null);
  const [connectionTest, setConnectionTest] = useState<{ rateLimit: { limit: number; remaining: number; reset: number } | null } | null>(null);

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: STATUS_KEY });
    await onChanged?.();
  };
  const connect = hooks.useMutation<{ authorizeUrl: string }, unknown, { replaceIdentity?: boolean; reconnect?: boolean; confirmationToken?: string }>({
    mutationFn: (value: { replaceIdentity?: boolean; reconnect?: boolean; confirmationToken?: string }) => api('/plugins/github/api/auth/start', jsonBody(value)) as Promise<{ authorizeUrl: string }>,
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
    onSuccess: (value: { rateLimit: { limit: number; remaining: number; reset: number } | null }) => { setConnectionTest(value); toast(s.connectionHealthy); },
    onError: (error: unknown) => toast(localizedError(error, s), 'error'),
  });

  if (status.isError) return <C.ErrorState message={s.loadError} onRetry={() => status.refetch()} />;
  if (status.isLoading) return <C.LoadingState variant="detail" />;

  const beginConnect = () => connect.mutate(status.data?.reconnectRequired ? { reconnect: true } : {}, { onSuccess: (value) => window.location.assign(value.authorizeUrl) });
  const completePending = () => {
    if (!pending) return;
    if (pending.action.type === 'replace_identity') {
      connect.mutate({ replaceIdentity: true, confirmationToken: pending.preview.confirmationToken }, { onSuccess: (value) => window.location.assign(value.authorizeUrl) });
      return;
    }
    confirm.mutate({ action: pending.action, token: pending.preview.confirmationToken });
  };
  const account = status.data?.account;

  return <>
    {status.data?.connected && account ? (
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-4">
          {account.avatarUrl ? <img src={account.avatarUrl} alt="" className="size-14 rounded-full border border-border" /> : <Github className="size-12" />}
          <div className="min-w-0 flex-1"><div className="truncate text-lg font-semibold text-text">{account.name || account.login}</div><div className="text-sm text-text-muted">@{account.login}</div></div>
          <C.Badge tone={status.data.reconnectRequired ? 'danger' : 'success'}>{status.data.reconnectRequired ? s.reconnectRequired : s.connected}</C.Badge>
        </div>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-text-muted">{s.tokenExpiry}</dt><dd className="text-text">{new Date(account.tokenExpiresAt).toLocaleString()}</dd></div>
          <div><dt className="text-text-muted">{s.refreshExpiry}</dt><dd className="text-text">{new Date(account.refreshExpiresAt).toLocaleString()}</dd></div>
          <div><dt className="text-text-muted">{s.mappings}</dt><dd className="font-mono text-text">{status.data.mappings}</dd></div>
          <div><dt className="text-text-muted">GitHub ID</dt><dd className="font-mono text-text">{account.githubUserId}</dd></div>
          {connectionTest?.rateLimit ? <div><dt className="text-text-muted">{s.rateLimit}</dt><dd className="font-mono text-text">{connectionTest.rateLimit.remaining} / {connectionTest.rateLimit.limit}</dd></div> : null}
        </dl>
        <div className="flex flex-wrap gap-2"><C.Button onClick={() => test.mutate()} disabled={test.isPending}>{s.testConnection}</C.Button><C.Button onClick={() => preview.mutate({ type: 'replace_identity' })}>{s.replaceIdentity}</C.Button><C.Button variant="danger" onClick={() => preview.mutate({ type: 'disconnect' })}>{s.disconnect}</C.Button></div>
      </div>
    ) : (
      <C.EmptyState title={status.data?.reconnectRequired ? s.reconnectRequired : s.disconnected} description={status.data?.setup.configured ? s.intro : s.setupHint} icon={Github} action={<C.Button variant="accent" onClick={beginConnect} disabled={!status.data?.setup.configured || connect.isPending}>{status.data?.reconnectRequired ? s.reconnect : s.connect}</C.Button>} />
    )}
    {pending ? <C.ConfirmDialog open title={pending.preview.title || s.confirmExternal} description={`${pending.preview.description}\n\n${s.confirmationExpires}`} confirmLabel={s.confirm} onClose={() => setPending(null)} onConfirm={completePending} /> : null}
  </>;
}
