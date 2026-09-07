import { useEffect, useState } from 'react';
import { Database, Globe2, HardDrive, ImageOff, Trash2, X } from 'lucide-react';
import type { PluginPageProps } from 'elowen-plugin-ui-kit';
import { apiError, jsonRequest, runtime } from './runtime';

interface ProfileStatus { profileBytes: number; activeSessions: number }
/** `lastReply` is what the agent last said in the conversation this session was opened from, or null —
 *  for a session whose chat has no reply yet, and equally for a host whose core does not publish the
 *  accessor at all. Both are the same absence to the panel: nothing is drawn. */
interface SessionRow { id: string; state: string; lease: { expiresAt: number } | null; lastReply?: { text: string; at: string } | null }
interface SessionsResponse { live: SessionRow[]; history: { id: string; state: string; createdAt: number; closedAt: number | null; closeReason: string | null }[] }
/** `dataUrl: null` is the ordinary answer while a page cannot be photographed — mid-navigation, or before
 *  the first capture has landed — not a failure the panel has to report. */
interface ThumbnailResponse { dataUrl: string | null; width?: number; height?: number; capturedAt?: number }

/** How often a visible panel asks for a new still. Deliberately calmer than the server's cache window, so
 *  a reader gets a fresh picture on every poll without the poll itself setting the pace of the captures. */
const PREVIEW_POLL_MS = 5_000;

/** The session register's tracks: the still, who the session belongs to, what the agent last said, and
 *  the one action.
 *
 *  The still LEADS, because it is the only part of a record a reader recognizes — the id beside it is a
 *  clipped hash. Its track is fixed at both widths so every row's picture is the same size and the three
 *  text columns start on one line down the whole list; a `minmax` there would let one tall reply widen
 *  its own row's thumbnail and break exactly that.
 *
 *  The reply takes the remaining space rather than a fixed measure: it is the only cell whose length
 *  varies, and it is what the register is read FOR. Below 40rem the plugin's own stylesheet re-lays these
 *  four cells as a stacked card (browser.css) — the same DOM, a different grid. */
const SESSION_COLUMNS = '9.5rem minmax(9rem, 14rem) minmax(0, 1fr) 2.25rem';
const SESSION_COLUMNS_COMPACT = '8rem minmax(6rem, 9rem) minmax(0, 1fr) 2.25rem';

/** Whether this document is on screen.
 *
 *  Every still costs a live browser a rasterization, so a panel left open in a background tab must stop
 *  asking. React Query already pauses interval refetches for a hidden document, but that is a default a
 *  host is free to configure away — and this is the one poll in this plugin that reaches all the way into
 *  Chrome, so it says so itself rather than inheriting the answer. */
function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
  useEffect(() => {
    const onChange = (): void => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  return visible;
}

/** The still beside one live session, and the placeholder that stands in its place.
 *
 *  A record in the list identifies a session by a clipped id, which tells nobody WHICH page is running.
 *  The picture is what makes the row recognizable, so its absence needs a box of the same size rather
 *  than a collapsed row that jumps when the first capture arrives. */
function SessionPreview({ sessionId, label, polling }: { sessionId: string; label: string; polling: boolean }) {
  const host = runtime();
  const strings = host.hooks.usePluginStrings('browser');
  const preview = host.hooks.useQuery<ThumbnailResponse>({
    queryKey: ['browser', 'thumbnail', sessionId],
    queryFn: () => runtime().api(`/plugins/browser/api/thumbnail?sessionId=${encodeURIComponent(sessionId)}`),
    refetchInterval: PREVIEW_POLL_MS,
    enabled: polling,
  });
  const image = preview.data?.dataUrl ?? null;
  // Named for the session it belongs to. Several of these can be on screen at once, and a list of
  // pictures that all announce themselves identically tells a screen reader nothing about which row it
  // is in — which is the one thing the sighted reader gets from them for free.
  if (!image) {
    return (
      <div
        className="browser-account__preview browser-account__preview--empty"
        role="img"
        aria-label={`${strings.previewPending || 'Waiting for a picture of this session'}: ${label}`}
      >
        <ImageOff size={16} aria-hidden />
      </div>
    );
  }
  return (
    <img
      className="browser-account__preview"
      src={image}
      // The picture's own size, so the box has its aspect ratio before the bytes are decoded.
      width={preview.data?.width}
      height={preview.data?.height}
      alt={`${strings.sessionPreview || 'Session preview'}: ${label}`}
    />
  );
}

/** How long ago the reply landed, in the host's own compact vocabulary ("4m", "2h"), or null when this
 *  host publishes no timestamp helpers. A missing age costs the reader a detail; a crashed panel costs
 *  them the page, so the two helpers are treated as optional and the line is dropped without them. */
function replyAge(at: string): string | null {
  const { parseTs, compactElapsed } = runtime().utils;
  const ms = parseTs?.(at) ?? null;
  if (ms === null || !compactElapsed) return null;
  return compactElapsed(Math.max(0, Date.now() - ms));
}

/** The end of the chat this session came from, under its picture.
 *
 *  Rendered as PLAIN text, deliberately. The host runtime publishes no Markdown renderer — its components
 *  carry `MarkdownAssetEditor`, which is an editor for a stored asset, not a view of a message — and a
 *  bundle that parsed Markdown itself would be a second renderer nobody keeps in step with the transcript,
 *  on text that comes from a model. So the reply keeps its own line breaks (`pre-wrap`), is clamped to
 *  four lines, and carries the whole thing in `title` for the reader who wants the rest.
 *
 *  A stray paragraph under a browser still would read as page content, which is the one thing it is not —
 *  hence the caption naming what it is. */
function SessionReply({ reply, label }: { reply: { text: string; at: string }; label: string }) {
  const age = replyAge(reply.at);
  return (
    <div className="browser-account__reply">
      <span className="browser-account__reply-caption">
        {label}
        {age ? <span className="browser-account__reply-age">{age}</span> : null}
      </span>
      <p className="browser-account__reply-text" title={reply.text}>{reply.text}</p>
    </div>
  );
}

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
 *  host's: SettingsDocument/SettingsGroup/SettingsRow for the geometry, the shared DataTable register for
 *  the repeated session records, Badge for the figures and the states, IconButton for the two destructive
 *  actions. */
export function BrowserAccount({ surface }: PluginPageProps) {
  const host = runtime();
  const { PluginPageHeader, SettingsDocument, SettingsGroup, SettingsRow, DataTable, DataTableRow, DataTableCell, Badge, IconButton, ConfirmDialog, LoadingState, ErrorState } = host.components;
  const strings = host.hooks.usePluginStrings('browser');
  const toast = host.hooks.useToast();
  const client = host.hooks.useQueryClient();
  const [confirmClear, setConfirmClear] = useState(false);
  const visible = usePageVisible();
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
                // The RULE goes behind the row's own help mark, where every other settings row keeps its
                // explanation. What the reader needs at a glance is not the sentence but the fact that
                // something is running, and that is the badge below — a paragraph in the trailing area
                // said the same thing at four times the height and in a shape no other row has.
                hint={strings.clearBlocked || 'Close every running session before the profile can be cleared.'}
                status={(
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge tone="muted">{bytes(profile.data?.profileBytes ?? 0)}</Badge>
                    {/* The same pill a risky plugin setting wears (RISK_TONE.high → danger), for the same
                        reason: it names the condition that makes the action beside it unavailable. */}
                    {clearBlocked ? <Badge tone="danger">{(strings.sessionsRunning || 'Sessions running: {count}').replace('{count}', String(live.length))}</Badge> : null}
                  </span>
                )}
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
                // Nothing is running is not an error and not a place to act, so it reads as one quiet
                // record rather than an illustrated panel in the middle of a settings page.
                <SettingsRow
                  icon={Globe2}
                  label={strings.noSessions || 'No browser session is running'}
                  description={strings.noSessionsDescription || 'A session appears here when your agent opens the browser.'}
                />
              ) : (
                // A REGISTER, not a stack of settings rows. Several sessions are the same four readings
                // repeated, and a settings row gives each of them the trailing side's own flow — which is
                // how the still ended up floating at a different distance from the edge in every row.
                <DataTable
                  ariaLabel={strings.liveSessions || 'Live sessions'}
                  columns={SESSION_COLUMNS}
                  compactColumns={SESSION_COLUMNS_COMPACT}
                  className="browser-account__sessions"
                >
                  {live.map((session) => {
                    // The session id is the record's name and is deliberately clipped: it identifies the
                    // tab to whoever is closing it and is not something anyone reads in full.
                    const name = `${session.id.slice(0, 12)}…`;
                    const held = session.state === 'user';
                    return (
                      <DataTableRow key={session.id} height="tall">
                        <DataTableCell lines="auto" className="browser-account__cell browser-account__cell--preview">
                          <SessionPreview sessionId={session.id} label={name} polling={visible} />
                        </DataTableCell>
                        <DataTableCell lines="auto" className="browser-account__cell browser-account__cell--identity">
                          <span className="browser-account__session-id">{name}</span>
                          {/* Who holds the session stays a visible reading on the row and never becomes a
                              tooltip. The agent holding it is the ordinary case and stays quiet; a
                              takeover is the exception, so that is the one that carries a tone. */}
                          <Badge tone={held ? 'warning' : 'muted'}>{held ? strings.userControl || 'User control' : strings.agentControl || 'Agent control'}</Badge>
                        </DataTableCell>
                        {/* The cell is rendered even with nothing in it: a row one cell short would let the
                            close button of that row slide into the reply column of its neighbours. */}
                        <DataTableCell lines="auto" className="browser-account__cell browser-account__cell--reply">
                          {session.lastReply ? <SessionReply reply={session.lastReply} label={strings.lastReply || 'Last reply'} /> : null}
                        </DataTableCell>
                        <DataTableCell lines="auto" className="browser-account__cell browser-account__cell--actions">
                          <IconButton
                            icon={X}
                            variant="danger"
                            label={strings.closeSession || 'Close'}
                            onClick={() => close.mutate(session.id)}
                            disabled={close.isPending}
                          />
                        </DataTableCell>
                      </DataTableRow>
                    );
                  })}
                </DataTable>
              )}
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
