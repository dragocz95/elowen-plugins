import { useState } from 'react';
import {
  Copy, ExternalLink, Globe2, KeyRound, Link2, Plus, Route, ShieldCheck, Star, Trash2,
} from 'lucide-react';
import {
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

function SetupBody({ domain, strings }: {
  domain: SiteDomainView;
  strings: Record<string, string>;
}) {
  const { components } = runtime();
  const { Badge, SettingsRow } = components;
  const ownershipBadge = stepBadge(domain.ownership.state, strings);
  const routingBadge = stepBadge(domain.routing.state, strings);
  const certificateBadge = stepBadge(domain.certificate.state, strings);
  const ownershipText = replaceParams(strings, domain.ownership.code, domain.ownership.params);
  const routingText = replaceParams(strings, domain.routing.code, domain.routing.params);
  const certificateText = replaceParams(strings, domain.certificate.code, domain.certificate.params);
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className="text-sm leading-relaxed text-muted-foreground">{strings.domainSetupIntro}</p>
      <SettingsRow
        label={strings.ownershipStep}
        description={ownershipText}
        icon={KeyRound}
        status={<Badge tone={ownershipBadge.tone}>{ownershipBadge.label}</Badge>}
        trailingLayout="stack"
      >
        <p className="mb-2 text-xs leading-relaxed text-muted-foreground">{strings.ownershipHint}</p>
        <RecordRows records={[domain.ownership.record]} strings={strings} />
      </SettingsRow>
      <SettingsRow
        label={strings.routingStep}
        description={routingText}
        icon={Route}
        status={<Badge tone={routingBadge.tone}>{routingBadge.label}</Badge>}
        trailingLayout="stack"
      >
        <p className="mb-2 text-xs leading-relaxed text-muted-foreground">{strings[domain.routing.hint]}</p>
        {domain.delegatedRootWarning ? (
          <p className="mb-2 text-xs leading-relaxed text-muted-foreground">{strings.delegatedRootHint}</p>
        ) : null}
        <RecordRows records={domain.routing.recommended} strings={strings} />
        {domain.routing.alternatives.length > 0 ? (
          <div className="mt-2">
            <RecordRows records={domain.routing.alternatives} strings={strings} />
          </div>
        ) : null}
      </SettingsRow>
      <SettingsRow
        label={strings.secureStep}
        description={certificateText}
        icon={ShieldCheck}
        status={<Badge tone={certificateBadge.tone}>{certificateBadge.label}</Badge>}
        trailingLayout="stack"
      />
      <p className="text-xs leading-relaxed text-muted-foreground">{strings.dnsPropagation}</p>
      <div className="flex flex-col gap-1 text-[11px] text-muted-foreground">
        <span>
          {domain.routing.checkedAt
            ? strings.lastChecked.replace('{time}', relativeTime(domain.routing.checkedAt))
            : strings.notChecked}
        </span>
        {domain.routing.nextCheckAt ? (
          <span>{strings.nextCheck.replace('{time}', relativeTime(domain.routing.nextCheckAt))}</span>
        ) : null}
        {domain.ownership.expiresAt ? (
          <span>{strings.reservationExpires.replace('{time}', relativeTime(domain.ownership.expiresAt))}</span>
        ) : null}
      </div>
    </div>
  );
}

export function SiteDomains({ siteId }: { siteId: string }) {
  const { components, hooks, utils } = runtime();
  const {
    Badge, Button, ConfirmDialog, DetailBlock, EmptyState, ErrorState, IconButton, Input,
    LoadingState, Modal, ModalBody, ModalFooter,
  } = components;
  const strings = hooks.usePluginStrings('sites');
  const queryClient = hooks.useQueryClient();
  const { toast } = hooks.useToast();
  const query = hooks.useQuery<SiteDomainsResponse>({
    queryKey: siteDomainsKey(siteId),
    queryFn: () => runtime().api(domainPath(siteId)),
  });
  const [dialog, setDialog] = useState<
    { mode: 'add' } | { mode: 'setup'; domain: SiteDomainView } | null
  >(null);
  const [hostname, setHostname] = useState('');
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [removeDomain, setRemoveDomain] = useState<SiteDomainView | null>(null);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: siteDomainsKey(siteId) });
    void queryClient.invalidateQueries({ queryKey: ['sites', 'detail', siteId] });
    void queryClient.invalidateQueries({ queryKey: ['sites', 'list'] });
  };

  const add = hooks.useMutation<{ domain: SiteDomainView }, unknown, string>({
    mutationFn: (value: string) => runtime().api(domainPath(siteId), jsonBody('POST', { hostname: value })),
    onSuccess: (result: { domain: SiteDomainView }) => {
      setDialogError(null);
      setHostname('');
      setDialog({ mode: 'setup', domain: result.domain });
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

  const check = hooks.useMutation<{ domain: SiteDomainView }, unknown, SiteDomainView>({
    mutationFn: (domain: SiteDomainView) => runtime().api(
      domainPath(siteId, '/' + encodeURIComponent(domain.id) + '/check'),
      { method: 'POST' },
    ),
    onSuccess: (result: { domain: SiteDomainView }) => {
      setDialogError(null);
      setDialog({ mode: 'setup', domain: result.domain });
      refresh();
    },
    onError: (error: unknown) => {
      const message = utils.apiErrorMessage(error);
      setDialogError(message);
      toast(message, 'error');
    },
  });

  const primary = hooks.useMutation<{ domain: SiteDomainView }, unknown, SiteDomainView>({
    mutationFn: (domain: SiteDomainView) => runtime().api(
      domainPath(siteId, '/' + encodeURIComponent(domain.id) + '/primary'),
      { method: 'POST' },
    ),
    onSuccess: (result: { domain: SiteDomainView }) => {
      if (dialog?.mode === 'setup') setDialog({ mode: 'setup', domain: result.domain });
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
        setDialog({ mode: 'setup', domain: result.domain });
      }
      refresh();
    },
    onError: (error: unknown) => toast(utils.apiErrorMessage(error), 'error'),
  });

  const open = (url: string) => window.open(url, '_blank', 'noopener,noreferrer');
  const data = query.data;

  return (
    <>
      <DetailBlock icon={Link2} title={strings.addresses}>
        {query.isLoading ? <LoadingState variant="block" height="h-24" /> : null}
        {query.isError ? (
          <ErrorState message={strings.domainsLoadFailed} onRetry={() => query.refetch()} />
        ) : null}
        {data ? (
          <div className="flex min-w-0 flex-col gap-4" data-site-domains>
            <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-border/60 bg-muted/20 p-3">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-foreground">{strings.primaryAddress}</span>
                <Badge tone="accent">{data.effectiveUrl ?? strings.noAddress}</Badge>
              </div>
              {data.generated ? (
                <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <span className="block text-xs font-medium text-foreground">{strings.generatedAddress}</span>
                    <code className="block break-all font-mono text-[11px] text-muted-foreground">
                      {data.generated.displayHostname}
                    </code>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {strings.generatedAddressHint}
                    </p>
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
              ) : null}
            </div>

            <div className="flex items-center justify-between gap-2">
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
                        <div className="flex max-w-full flex-wrap items-center gap-1">
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
                                setDialog({ mode: 'setup', domain });
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

      {dialog?.mode === 'setup' ? (
        <Modal
          title={strings.domainSetupTitle.replace('{hostname}', dialog.domain.displayHostname)}
          icon={Globe2}
          size="lg"
          onClose={() => { if (!check.isPending) setDialog(null); }}
          closeDisabled={check.isPending}
          aria-busy={check.isPending ? true : undefined}
        >
          <ModalBody gap={4}>
            {dialogError ? <ErrorState message={dialogError} /> : null}
            <SetupBody domain={dialog.domain} strings={strings} />
          </ModalBody>
          <ModalFooter>
            <Button
              variant="ghost-danger"
              icon={Trash2}
              onClick={() => setRemoveDomain(dialog.domain)}
            >
              {strings.removeDomain}
            </Button>
            {dialog.domain.status === 'ready' && !dialog.domain.isPrimary ? (
              <Button
                variant="ghost"
                icon={Star}
                disabled={primary.isPending}
                onClick={() => primary.mutate(dialog.domain)}
              >
                {strings.makePrimary}
              </Button>
            ) : null}
            <Button
              variant="accent"
              disabled={check.isPending || dialog.domain.removalState === 'removing'}
              onClick={() => check.mutate(dialog.domain)}
            >
              {check.isPending ? strings.checking : strings.checkAgain}
            </Button>
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
