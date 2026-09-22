import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Check, Copy, ExternalLink, Globe2, KeyRound, Link2, Plus, RefreshCw, Route, ShieldCheck,
  Star, Trash2,
} from 'lucide-react';
import {
  DOMAIN_CHECK_POLL_MS,
  awaitingDomain,
  jsonBody,
  relativeTime,
  runtime,
  siteDomainsKey,
  type SiteDomainsResponse,
  type SiteDomainRecordView,
  type SiteDomainView,
} from './runtime.js';

const domainPath = (siteId: string, suffix = ''): string =>
  '/plugins/sites/api/site/' + encodeURIComponent(siteId) + '/domains' + suffix;

const replaceParams = (
  strings: Record<string, string>,
  code: string,
  params: Record<string, string>,
): string => {
  const template = strings[code] ?? code;
  const locale = document.documentElement.lang || navigator.language || 'en';
  return Object.entries(params).reduce((text, [key, raw]) => {
    const parsed = key === 'date' || key === 'time' ? Date.parse(raw) : Number.NaN;
    const value = Number.isNaN(parsed)
      ? raw
      : new Intl.DateTimeFormat(locale, {
          dateStyle: 'medium',
          timeStyle: key === 'time' ? 'short' : undefined,
        }).format(new Date(parsed));
    return text.replaceAll('{' + key + '}', value);
  }, template);
};

const errorCode = (error: unknown): { code: string; params: Record<string, string> } | null => {
  if (typeof error !== 'object' || error === null || !('details' in error)) return null;
  const details = (error as { details?: unknown }).details;
  if (typeof details !== 'object' || details === null || !('error' in details)) return null;
  const value = (details as { error?: unknown }).error;
  if (typeof value !== 'object' || value === null) return null;
  const code = 'code' in value && typeof value.code === 'string' ? value.code : null;
  if (!code) return null;
  const rawParams = 'params' in value && typeof value.params === 'object' && value.params !== null
    ? value.params as Record<string, unknown>
    : {};
  return {
    code,
    params: Object.fromEntries(Object.entries(rawParams).map(([key, item]) => [key, String(item)])),
  };
};

type StatusBadge = {
  label: string;
  tone: 'muted' | 'warning' | 'danger' | 'success';
};

const badgeFor = (domain: SiteDomainView, strings: Record<string, string>): StatusBadge => {
  if (domain.status === 'ready') return { label: strings.domainReady, tone: 'success' };
  if (domain.status === 'renewal_blocked') return { label: strings.renewalBlocked, tone: 'warning' };
  if (domain.status === 'removing') return { label: strings.domainRemoving, tone: 'muted' };
  if (['authority_refused', 'rate_limited', 'expired', 'misdirected'].includes(domain.status)) {
    return { label: strings.domainAttention, tone: 'danger' };
  }
  return { label: strings.domainPending, tone: 'muted' };
};

const stepBadge = (state: string, strings: Record<string, string>): StatusBadge => {
  if (state === 'ready') return { label: strings.domainReady, tone: 'success' };
  if (['unavailable', 'misdirected', 'authority_refused', 'rate_limited', 'expired'].includes(state)) {
    return { label: strings.domainAttention, tone: 'danger' };
  }
  if (state === 'renewal_blocked') return { label: strings.renewalBlocked, tone: 'warning' };
  return { label: strings.domainPending, tone: 'muted' };
};

function RecordRows({ records, strings }: {
  records: SiteDomainRecordView[];
  strings: Record<string, string>;
}) {
  const { components, utils } = runtime();
  const { IconButton } = components;
  if (records.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {records.map((record, index) => (
        <div
          key={record.type + ':' + record.name + ':' + record.value + ':' + index}
          className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2 rounded-md border border-border/60 bg-muted/30 p-2"
        >
          <span className="rounded bg-background px-1.5 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground">
            {record.type}
          </span>
          <span className="min-w-0">
            <code className="block break-all font-mono text-[11px] text-foreground">{record.name}</code>
            <code className="block break-all font-mono text-[11px] text-muted-foreground">{record.value}</code>
          </span>
          <IconButton
            icon={Copy}
            label={strings.copy + ' ' + record.type}
            onClick={() => utils.copyText(record.value)}
          />
        </div>
      ))}
    </div>
  );
}

/** One rung of the connection: a marker, a name, where it stands, and — only while it is the thing that
 *  still needs doing — the record to create. The long provider advice sits behind the help mark, because
 *  a wall of prose in front of three DNS records is what makes this window unreadable. */
function StepRow({ icon: Icon, title, badge, done, spin, text, help, last, muted, children }: {
  icon: LucideIcon;
  title: string;
  badge?: StatusBadge;
  /** A step that has been reached: its marker becomes the green tick that reads as "this one is behind us". */
  done: boolean;
  /** A step that is working, which sets its marker turning. */
  spin?: boolean;
  text: string;
  help?: string;
  last?: boolean;
  /** A rung that reports rather than instructs, so its name carries the weight of a caption, not a heading. */
  muted?: boolean;
  children?: ReactNode;
}) {
  const { components } = runtime();
  const { Badge, HelpTip } = components;
  const Marker = done ? Check : Icon;
  return (
    <div className="flex min-w-0 gap-3">
      <div className="flex flex-col items-center">
        <span
          className={'grid h-7 w-7 shrink-0 place-items-center rounded-full border '
            + (done ? 'border-success/50 bg-success/10 text-success' : 'border-border bg-muted/40 text-muted-foreground')}
        >
          <Marker className={'h-3.5 w-3.5' + (spin ? ' animate-spin' : '')} />
        </span>
        {last ? null : <span className="mt-1 w-px flex-1 bg-border" />}
      </div>
      <div className={'min-w-0 flex-1 ' + (last ? 'pb-0' : 'pb-5')}>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className={muted ? 'text-xs text-muted-foreground' : 'text-sm font-medium text-foreground'}>{title}</span>
          {badge ? <Badge tone={badge.tone}>{badge.label}</Badge> : null}
          {help ? <HelpTip>{help}</HelpTip> : null}
        </div>
        {text === '' ? null : <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{text}</p>}
        {children ? <div className="mt-2">{children}</div> : null}
      </div>
    </div>
  );
}

function SetupBody({ domain, strings }: {
  domain: SiteDomainView;
  strings: Record<string, string>;
}) {
  const { components } = runtime();
  const { HelpTip } = components;
  const watching = awaitingDomain(domain);
  const routingHelp = [strings[domain.routing.hint], domain.delegatedRootWarning ? strings.delegatedRootHint : '']
    .filter((line) => line !== '')
    .join(' ');
  const meta = [
    domain.routing.checkedAt
      ? strings.lastChecked.replace('{time}', relativeTime(domain.routing.checkedAt))
      : strings.notChecked,
    domain.ownership.expiresAt
      ? strings.reservationExpires.replace('{time}', relativeTime(domain.ownership.expiresAt))
      : '',
  ].filter((line) => line !== '');
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 items-start gap-1.5">
        <p className="min-w-0 text-sm leading-relaxed text-muted-foreground">{strings.domainSetupIntro}</p>
        <HelpTip align="right">{strings.dnsPropagation}</HelpTip>
      </div>
      <div className="flex min-w-0 flex-col">
        <StepRow
          icon={KeyRound}
          title={strings.ownershipStep}
          badge={stepBadge(domain.ownership.state, strings)}
          done={domain.ownership.state === 'ready'}
          text={replaceParams(strings, domain.ownership.code, domain.ownership.params)}
          help={strings.ownershipHint}
        >
          {domain.ownership.state === 'ready'
            ? null
            : <RecordRows records={[domain.ownership.record]} strings={strings} />}
        </StepRow>
        <StepRow
          icon={Route}
          title={strings.routingStep}
          badge={stepBadge(domain.routing.state, strings)}
          done={domain.routing.state === 'ready'}
          text={replaceParams(strings, domain.routing.code, domain.routing.params)}
          help={routingHelp}
        >
          {domain.routing.state === 'ready' ? null : (
            <RecordRows
              records={[...domain.routing.recommended, ...domain.routing.alternatives]}
              strings={strings}
            />
          )}
        </StepRow>
        <StepRow
          icon={ShieldCheck}
          title={strings.secureStep}
          badge={stepBadge(domain.certificate.state, strings)}
          done={domain.certificate.state === 'ready'}
          text={replaceParams(strings, domain.certificate.code, domain.certificate.params)}
          last={!watching}
        />
        {/* Watching is the last rung of the same line, not a separate note under it: what the window does
            while nobody touches it is part of the sequence, and its marker is the one that moves — the
            spinner while a check runs, the tick the moment one has come back. */}
        {watching ? (
          <StepRow
            icon={RefreshCw}
            title={strings.domainAutoChecking}
            // The marker turns while the window is watching, not only during the request itself: between
            // two checks it is still the rung that is working, and a still icon there reads as stuck.
            done={false}
            spin
            text={meta.join(' · ')}
            muted
            last
          />
        ) : null}
      </div>
    </div>
  );
}

/** What is left to say once the address is served: where it is, and how long its certificate lasts. The
 *  setup steps are gone by then — a list of instructions nobody has to follow any more is noise. */
function ConnectedBody({ domain, strings }: {
  domain: SiteDomainView;
  strings: Record<string, string>;
}) {
  const { components, utils } = runtime();
  const { Badge, IconButton } = components;
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-border/60 bg-muted/20 p-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Badge tone="success">{strings.domainReady}</Badge>
        {domain.isPrimary ? <Badge tone="accent">{strings.primary}</Badge> : null}
      </div>
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <code className="min-w-0 break-all font-mono text-xs text-foreground">{domain.url}</code>
        <div className="flex shrink-0 items-center gap-1">
          <IconButton icon={Copy} label={strings.copyLink} onClick={() => utils.copyText(domain.url)} />
          <IconButton
            icon={ExternalLink}
            label={strings.openSite}
            onClick={() => window.open(domain.url, '_blank', 'noopener,noreferrer')}
          />
        </div>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {replaceParams(strings, domain.certificate.code, domain.certificate.params)}
      </p>
    </div>
  );
}

export function SiteDomains({ siteId }: { siteId: string }) {
  const { components, hooks, utils } = runtime();
  const {
    Badge, Button, ConfirmDialog, DetailBlock, EmptyState, ErrorState, HelpTip, IconButton, Input,
    LoadingState, Modal, ModalBody, ModalFooter,
  } = components;
  const strings = hooks.usePluginStrings('sites');
  const queryClient = hooks.useQueryClient();
  const { toast } = hooks.useToast();
  const query = hooks.useQuery<SiteDomainsResponse>({
    queryKey: siteDomainsKey(siteId),
    queryFn: () => runtime().api(domainPath(siteId)),
  });
  // The dialog holds the identity of the domain it is about, never a copy of it: the answer to every
  // check lands in the query cache, and a second copy in local state is a second truth that goes stale.
  const [dialog, setDialog] = useState<
    { mode: 'add' } | { mode: 'setup'; domainId: string } | null
  >(null);
  const [hostname, setHostname] = useState('');
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [removeDomain, setRemoveDomain] = useState<SiteDomainView | null>(null);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: siteDomainsKey(siteId) });
    void queryClient.invalidateQueries({ queryKey: ['sites', 'detail', siteId] });
    void queryClient.invalidateQueries({ queryKey: ['sites', 'list'] });
  };

  /** Put the answer a mutation returned into the register straight away, so the dialog renders the new
   *  state on the same tick it arrives instead of waiting for the refetch behind it. */
  const storeDomain = (domain: SiteDomainView) => {
    queryClient.setQueryData(siteDomainsKey(siteId), (previous?: SiteDomainsResponse) => {
      if (!previous) return previous;
      const known = previous.domains.some((entry) => entry.id === domain.id);
      return {
        ...previous,
        domains: known
          ? previous.domains.map((entry) => (entry.id === domain.id ? domain : entry))
          : [...previous.domains, domain],
      };
    });
  };

  const add = hooks.useMutation<{ domain: SiteDomainView }, unknown, string>({
    mutationFn: (value: string) => runtime().api(domainPath(siteId), jsonBody('POST', { hostname: value })),
    onSuccess: (result: { domain: SiteDomainView }) => {
      setDialogError(null);
      setHostname('');
      storeDomain(result.domain);
      setDialog({ mode: 'setup', domainId: result.domain.id });
      refresh();
    },
    onError: (error: unknown) => {
      const coded = errorCode(error);
      const message = coded
        ? replaceParams(strings, coded.code, coded.params)
        : utils.apiErrorMessage(error);
      setDialogError(message);
      toast(message, 'error');
    },
  });

  const check = hooks.useMutation<{ domain: SiteDomainView }, unknown, { id: string; manual: boolean }>({
    mutationFn: (input: { id: string }) => runtime().api(
      domainPath(siteId, '/' + encodeURIComponent(input.id) + '/check'),
      { method: 'POST' },
    ),
    onSuccess: (result: { domain: SiteDomainView }) => {
      setDialogError(null);
      storeDomain(result.domain);
      refresh();
    },
    onError: (error: unknown, input: { manual: boolean }) => {
      const message = utils.apiErrorMessage(error);
      setDialogError(message);
      // A check nobody asked for reports in the dialog it happened in. Toasting every automatic attempt
      // would turn one unreachable resolver into a notification every twenty seconds.
      if (input.manual) toast(message, 'error');
    },
  });

  const primary = hooks.useMutation<{ domain: SiteDomainView }, unknown, SiteDomainView>({
    mutationFn: (domain: SiteDomainView) => runtime().api(
      domainPath(siteId, '/' + encodeURIComponent(domain.id) + '/primary'),
      { method: 'POST' },
    ),
    onSuccess: () => {
      toast(strings.saved);
      refresh();
    },
    onError: (error: unknown) => toast(utils.apiErrorMessage(error), 'error'),
  });

  const remove = hooks.useMutation<{ removed: boolean; domain?: SiteDomainView }, unknown, SiteDomainView>({
    mutationFn: (domain: SiteDomainView) => runtime().api(
      domainPath(siteId, '/' + encodeURIComponent(domain.id)),
      { method: 'DELETE' },
    ),
    onSuccess: (result: { removed: boolean; domain?: SiteDomainView }) => {
      setRemoveDomain(null);
      if (result.removed) {
        if (dialog?.mode === 'setup') setDialog(null);
      } else if (result.domain) {
        storeDomain(result.domain);
      }
      refresh();
    },
    onError: (error: unknown) => toast(utils.apiErrorMessage(error), 'error'),
  });

  const open = (url: string) => window.open(url, '_blank', 'noopener,noreferrer');
  const data = query.data;
  const setupId = dialog?.mode === 'setup' ? dialog.domainId : null;
  const setupDomain = setupId === null
    ? null
    : data?.domains.find((entry) => entry.id === setupId) ?? null;
  const watching = setupDomain !== null && awaitingDomain(setupDomain);

  // The interval must not be restarted by every render, and the mutation object is new on each one, so
  // the timer reaches it through a ref instead of listing it as a dependency.
  const checkRef = useRef(check);
  checkRef.current = check;
  useEffect(() => {
    if (!watching || setupId === null) return undefined;
    const timer = window.setInterval(() => {
      if (!checkRef.current.isPending) checkRef.current.mutate({ id: setupId, manual: false });
    }, DOMAIN_CHECK_POLL_MS);
    return () => window.clearInterval(timer);
  }, [watching, setupId]);

  return (
    <>
      <DetailBlock icon={Link2} title={strings.addresses}>
        {query.isLoading ? <LoadingState variant="block" height="h-24" /> : null}
        {query.isError ? (
          <ErrorState message={strings.domainsLoadFailed} onRetry={() => query.refetch()} />
        ) : null}
        {data ? (
          <div className="flex min-w-0 flex-col gap-4" data-site-domains>
            {/* The instance's own address is a row of exactly the same shape as a custom domain: one
                register of addresses, read the same way down the whole block. Which one the Site actually
                answers on is the badge it carries, and what the fallback means sits behind the help mark. */}
            {/* Both headings stand in a row of the same height, because the one beside the add button is as
                tall as that button; without it the two groups would sit on a different rhythm. */}
            <div className="flex h-9 items-center gap-1.5">
              <span className="text-xs font-semibold text-foreground">{strings.generatedAddress}</span>
              <HelpTip>{strings.generatedAddressHint}</HelpTip>
            </div>

            {data.generated ? (
              <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-border/60 p-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <code className="break-all font-mono text-xs text-foreground">
                    {data.generated.displayHostname}
                  </code>
                  {data.generated.effective ? <Badge tone="accent">{strings.primary}</Badge> : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <IconButton
                    icon={Copy}
                    label={strings.copyLink}
                    onClick={() => utils.copyText(data.generated!.url)}
                  />
                  <IconButton
                    icon={ExternalLink}
                    label={strings.openSite}
                    onClick={() => open(data.generated!.url)}
                  />
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">{strings.noAddress}</p>
            )}

            <div className="flex h-9 items-center justify-between gap-2">
              <span className="text-xs font-semibold text-foreground">{strings.customDomains}</span>
              <Button
                variant="ghost"
                icon={Plus}
                onClick={() => {
                  setDialogError(null);
                  setDialog({ mode: 'add' });
                }}
              >
                {strings.addDomain}
              </Button>
            </div>

            {data.domains.length === 0 ? (
              <EmptyState title={strings.noCustomDomains} icon={Globe2} />
            ) : (
              <div className="flex min-w-0 flex-col gap-3">
                {data.domains.map((domain) => {
                  const badge = badgeFor(domain, strings);
                  return (
                    <div
                      key={domain.id}
                      className="flex min-w-0 flex-col gap-3 rounded-lg border border-border/60 p-3"
                    >
                      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                            <code className="break-all font-mono text-xs text-foreground">
                              {domain.displayHostname}
                            </code>
                            <Badge tone={badge.tone}>{badge.label}</Badge>
                            {domain.isPrimary ? <Badge tone="accent">{strings.primary}</Badge> : null}
                          </div>
                          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                            {domain.status === 'removing'
                              ? strings.domainRemoving
                              : replaceParams(strings, domain.statusCode, domain.statusParams)}
                          </p>
                        </div>
                        {/* The actions of one address stay on one line. Wrapping them dropped the bin under
                            the button beside it, which reads as two unrelated controls; on a narrow screen
                            the row above turns into its own line instead. */}
                        <div className="flex shrink-0 items-center gap-1">
                          {domain.canOpen ? (
                            <>
                              <IconButton
                                icon={Copy}
                                label={strings.copyLink}
                                onClick={() => utils.copyText(domain.url)}
                              />
                              <IconButton
                                icon={ExternalLink}
                                label={strings.openSite}
                                onClick={() => open(domain.url)}
                              />
                            </>
                          ) : null}
                          {domain.status === 'ready' && !domain.isPrimary ? (
                            <Button
                              variant="ghost"
                              icon={Star}
                              disabled={primary.isPending}
                              onClick={() => primary.mutate(domain)}
                            >
                              {strings.makePrimary}
                            </Button>
                          ) : null}
                          {domain.status !== 'ready' && domain.removalState === 'active' ? (
                            <Button
                              variant="ghost"
                              onClick={() => {
                                setDialogError(null);
                                setDialog({ mode: 'setup', domainId: domain.id });
                              }}
                            >
                              {strings.continueSetup}
                            </Button>
                          ) : null}
                          <IconButton
                            icon={Trash2}
                            label={strings.removeDomain}
                            variant="danger"
                            onClick={() => setRemoveDomain(domain)}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}
      </DetailBlock>

      {dialog?.mode === 'add' ? (
        <Modal
          title={strings.addDomain}
          description={strings.domainExample}
          icon={Globe2}
          size="sm"
          onClose={() => { if (!add.isPending) setDialog(null); }}
          closeDisabled={add.isPending}
          aria-busy={add.isPending ? true : undefined}
        >
          <ModalBody gap={4}>
            <label className="flex flex-col gap-2 text-sm font-medium text-foreground">
              {strings.domainName}
              <Input
                value={hostname}
                onChange={(event) => setHostname(event.target.value)}
                placeholder={strings.domainExample}
                aria-label={strings.domainName}
                autoComplete="off"
                disabled={add.isPending}
              />
            </label>
            {dialogError ? <p role="alert" className="text-sm text-destructive">{dialogError}</p> : null}
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" disabled={add.isPending} onClick={() => setDialog(null)}>
              {strings.close}
            </Button>
            <Button
              variant="accent"
              icon={Plus}
              disabled={add.isPending || hostname.trim() === ''}
              onClick={() => add.mutate(hostname)}
            >
              {strings.addDomain}
            </Button>
          </ModalFooter>
        </Modal>
      ) : null}

      {setupDomain ? (
        <Modal
          title={(setupDomain.status === 'ready' ? strings.domainConnectedTitle : strings.domainSetupTitle)
            .replace('{hostname}', setupDomain.displayHostname)}
          icon={Globe2}
          // This window holds three short steps and two records. `lg` is a fixed 88dvh frame up to 90rem
          // wide, which leaves most of the screen empty around them; `md` takes the height of what is in it.
          size="md"
          // Closing is never blocked here: a check runs on its own every few seconds, and a window that
          // refuses to close whenever one happens to be in flight is a window that traps the visitor.
          onClose={() => setDialog(null)}
          aria-busy={check.isPending ? true : undefined}
        >
          <ModalBody gap={4}>
            {dialogError ? <ErrorState message={dialogError} /> : null}
            {setupDomain.status === 'ready'
              ? <ConnectedBody domain={setupDomain} strings={strings} />
              : <SetupBody domain={setupDomain} strings={strings} />}
          </ModalBody>
          <ModalFooter>
            <Button
              variant="ghost-danger"
              icon={Trash2}
              onClick={() => setRemoveDomain(setupDomain)}
            >
              {strings.removeDomain}
            </Button>
            {setupDomain.status === 'ready' && !setupDomain.isPrimary ? (
              <Button
                variant="ghost"
                icon={Star}
                disabled={primary.isPending}
                onClick={() => primary.mutate(setupDomain)}
              >
                {strings.makePrimary}
              </Button>
            ) : null}
            {watching ? (
              <Button
                variant="accent"
                disabled={check.isPending}
                onClick={() => check.mutate({ id: setupDomain.id, manual: true })}
              >
                {check.isPending ? strings.checking : strings.checkAgain}
              </Button>
            ) : (
              <Button variant="accent" onClick={() => setDialog(null)}>{strings.close}</Button>
            )}
          </ModalFooter>
        </Modal>
      ) : null}

      <ConfirmDialog
        open={removeDomain !== null}
        title={strings.removeDomainTitle.replace('{hostname}', removeDomain?.displayHostname ?? '')}
        description={strings.removeDomainHint}
        confirmLabel={strings.removeDomain}
        confirmVariant="danger"
        pending={remove.isPending}
        onConfirm={() => removeDomain ? remove.mutateAsync(removeDomain) : undefined}
        onClose={() => { if (!remove.isPending) setRemoveDomain(null); }}
      />
    </>
  );
}

export function ReadOnlySiteAddress({ url, strings }: {
  url: string | null;
  strings: Record<string, string>;
}) {
  const { components } = runtime();
  const { DetailBlock } = components;
  return (
    <DetailBlock icon={Link2} title={strings.address}>
      <code className="break-all font-mono text-xs text-foreground">{url}</code>
    </DetailBlock>
  );
}
