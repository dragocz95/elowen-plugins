import { useState } from 'react';
import { AppWindow, Database, Globe2, HardDrive, Trash2, X } from 'lucide-react';
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

/** The account's own browser profile, built from the host's settings anatomy rather than a layout of its
 *  own. This panel sits in the Account deck between Models, Memory and Terminal, and those are records in
 *  grouped rows — so a pair of hand-built dashboard tiles with their own grid, their own borders and their
 *  own button sizing read as a different application wearing the same colours. Every piece here is the
 *  host's: SettingsDocument/SettingsGroup/SettingsRow for the geometry, Badge for the figures, IconButton
 *  for the two destructive actions, EmptyState for "nothing is running". */
export function BrowserAccount({ surface }: PluginPageProps) {
  const host = runtime();
  const { PluginPageHeader, SettingsDocument, SettingsGroup, SettingsRow, Badge, IconButton, ConfirmDialog, LoadingState, ErrorState, EmptyState } = host.components;
  const strings = host.hooks.usePluginStrings('browser');
  const toast = host.hooks.useToast();
  const client = host.hooks.useQueryClient();
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
  // Clearing the profile out from under a running Chrome would corrupt it, so the action waits for the
  // sessions to end. A disabled control with no stated reason is a dead end, so the row says why.
  const clearBlocked = live.length > 0;

  return (
    <div className="space-y-4">
      {surface === 'page' ? <PluginPageHeader title={strings.accountTitle || 'Browser profile'} description={strings.accountDescription || 'Your private Chrome profile keeps browser sign-ins between sessions on this Elowen instance.'} icon={Globe2} /> : null}
      {loading ? <LoadingState variant="block" height="12rem" /> : error ? <ErrorState message={apiError(error)} onRetry={() => { void profile.refetch(); void sessions.refetch(); }} /> : (
        <>
          <SettingsDocument>
            <SettingsGroup
              icon={Database}
              title={strings.profileStorage || 'Stored browser data'}
              description={strings.profileStorageHint || 'Cookies and sign-in state live only in your account profile. Live images are never stored.'}
            >
              <SettingsRow
                icon={HardDrive}
                label={strings.storageUsed || 'Space used'}
                // The reason goes in the row itself, not in the label's HelpTip: a disabled destructive
                // control has to say why on screen, and `description`/`hint` are behind a trigger nobody
                // presses when they have already decided the button is broken.
                trailingLayout={clearBlocked ? 'stack' : 'inline'}
                status={<Badge tone="muted">{bytes(profile.data?.profileBytes ?? 0)}</Badge>}
                control={clearBlocked ? <p className="text-xs text-muted-foreground">{strings.clearBlocked || 'Close every running session before the profile can be cleared.'}</p> : undefined}
                actions={(
                  <IconButton
                    icon={Trash2}
                    variant="danger"
                    label={strings.clearProfile || 'Clear browser data'}
                    onClick={() => setConfirmClear(true)}
                    disabled={clearBlocked || clear.isPending}
                  />
                )}
              />
            </SettingsGroup>

            <SettingsGroup
              icon={Globe2}
              title={strings.liveSessions || 'Live sessions'}
              description={strings.liveSessionsHint || 'Closing a tab session does not erase your saved browser profile.'}
              actions={<Badge tone={live.length ? 'accent' : 'muted'}>{live.length}</Badge>}
            >
              {live.length === 0 ? (
                <EmptyState
                  title={strings.noSessions || 'No browser session is running'}
                  description={strings.noSessionsDescription || 'A session appears here when your agent opens the browser.'}
                  icon={Globe2}
                />
              ) : live.map((session) => (
                // The session id is the record's name and is deliberately clipped: it identifies the tab
                // to whoever is closing it and is not something anyone reads in full.
                <SettingsRow
                  key={session.id}
                  icon={AppWindow}
                  label={`${session.id.slice(0, 12)}…`}
                  // Who holds the session is a short state word, so it belongs on the row's trailing line
                  // where it stays readable — the old tile showed it as plain text and it must not
                  // regress into a tooltip on the way to the shared row.
                  status={<span className="text-xs text-muted-foreground">{session.state === 'user' ? strings.userControl || 'User control' : strings.agentControl || 'Agent control'}</span>}
                  actions={(
                    <IconButton
                      icon={X}
                      variant="danger"
                      label={strings.closeSession || 'Close'}
                      onClick={() => close.mutate(session.id)}
                      disabled={close.isPending}
                    />
                  )}
                />
              ))}
            </SettingsGroup>
          </SettingsDocument>
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
