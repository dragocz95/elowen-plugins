import { useState } from 'react';
import { Database, Globe2, Trash2, X } from 'lucide-react';
import type { PluginPageProps } from 'elowen-plugin-ui-kit';
import { apiError, jsonRequest, runtime } from './runtime';

interface ProfileStatus { profileBytes: number; activeSessions: number }
interface SessionRow { id: string; state: string; lease: { expiresAt: number } | null }
interface SessionsResponse { live: SessionRow[]; history: { id: string; state: string; createdAt: number; closedAt: number | null; closeReason: string | null }[] }

const bytes = (value: number): string => {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MiB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GiB`;
};

export function BrowserAccount({ surface }: PluginPageProps) {
  const { PluginPageHeader, DetailBlock, Badge, Button, ConfirmDialog, LoadingState, ErrorState, EmptyState } = runtime().components;
  const strings = runtime().hooks.usePluginStrings('browser');
  const toast = runtime().hooks.useToast();
  const client = runtime().hooks.useQueryClient();
  const [confirmClear, setConfirmClear] = useState(false);
  const profile = runtime().hooks.useQuery<ProfileStatus>({ queryKey: ['browser', 'profile'], queryFn: () => runtime().api('/plugins/browser/api/profile') });
  const sessions = runtime().hooks.useQuery<SessionsResponse>({ queryKey: ['browser', 'sessions'], queryFn: () => runtime().api('/plugins/browser/api/sessions'), refetchInterval: 5_000 });
  const clear = runtime().hooks.useMutation<unknown, Error, void>({
    mutationFn: () => runtime().api('/plugins/browser/api/profile', jsonRequest('DELETE')),
    onSuccess: async () => {
      setConfirmClear(false);
      await client.invalidateQueries({ queryKey: ['browser'] });
      toast.toast(strings.profileCleared || 'Browser data cleared.', 'ok');
    },
    onError: (error: unknown) => toast.toast(apiError(error), 'error'),
  });
  const close = runtime().hooks.useMutation<unknown, Error, string>({
    mutationFn: (sessionId: string) => runtime().api(`/plugins/browser/api/close?sessionId=${encodeURIComponent(sessionId)}`, jsonRequest('POST')),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ['browser'] }); },
    onError: (error: unknown) => toast.toast(apiError(error), 'error'),
  });

  const loading = profile.isLoading || sessions.isLoading;
  const error = profile.isError ? profile.error : sessions.isError ? sessions.error : null;
  const live = sessions.data?.live ?? [];

  return (
    <div className="space-y-4">
      {surface === 'page' ? <PluginPageHeader title={strings.accountTitle || 'Browser profile'} description={strings.accountDescription || 'Your private Chrome profile keeps browser sign-ins between sessions on this Elowen instance.'} icon={Globe2} /> : null}
      {loading ? <LoadingState variant="block" height="12rem" /> : error ? <ErrorState message={apiError(error)} onRetry={() => { void profile.refetch(); void sessions.refetch(); }} /> : (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <DetailBlock icon={Database} title={strings.profileStorage || 'Stored browser data'} hint={strings.profileStorageHint || 'Cookies and sign-in state live only in your account profile. Live images are never stored.'}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="muted">{bytes(profile.data?.profileBytes ?? 0)}</Badge>
                <Badge tone={live.length ? 'accent' : 'muted'}>{live.length} {strings.activeSessions || 'active sessions'}</Badge>
              </div>
              <div className="mt-3"><Button variant="ghost-danger" icon={Trash2} onClick={() => setConfirmClear(true)} disabled={live.length > 0 || clear.isPending}>{strings.clearProfile || 'Clear browser data'}</Button></div>
            </DetailBlock>
            <DetailBlock icon={Globe2} title={strings.liveSessions || 'Live sessions'} hint={strings.liveSessionsHint || 'Closing a tab session does not erase your saved browser profile.'}>
              {live.length === 0 ? <EmptyState title={strings.noSessions || 'No browser session is running'} description={strings.noSessionsDescription || 'A session appears here when your agent opens the browser.'} icon={Globe2} /> : (
                <div className="space-y-2">
                  {live.map((session) => (
                    <div key={session.id} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
                      <div className="min-w-0"><div className="truncate font-mono text-xs text-foreground">{session.id.slice(0, 12)}…</div><div className="text-xs text-muted-foreground">{session.state === 'user' ? strings.userControl || 'User control' : strings.agentControl || 'Agent control'}</div></div>
                      <Button variant="ghost-danger" icon={X} onClick={() => close.mutate(session.id)} disabled={close.isPending}>{strings.closeSession || 'Close'}</Button>
                    </div>
                  ))}
                </div>
              )}
            </DetailBlock>
          </div>
          <ConfirmDialog
            open={confirmClear}
            title={strings.clearConfirmTitle || 'Clear your browser data?'}
            description={strings.clearConfirmDescription || 'Stored cookies, sign-ins and site data will be permanently removed. This cannot be undone.'}
            confirmLabel={strings.clearProfile || 'Clear browser data'}
            confirmVariant="danger"
            pending={clear.isPending}
            onConfirm={() => clear.mutate()}
            onClose={() => setConfirmClear(false)}
          />
        </>
      )}
    </div>
  );
}
