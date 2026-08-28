import { useState } from 'react';
import { Globe } from 'lucide-react';
import { runtime, relativeTime, type SiteView, type SitesListResponse, type Visibility } from './runtime.js';
import { SiteDetail } from './SiteDetail.js';

const VISIBILITY_STRING: Record<Visibility, string> = {
  private: 'visibilityPrivate',
  project: 'visibilityProject',
  authenticated: 'visibilityAuthenticated',
  public: 'visibilityPublic',
};

const VISIBILITY_TONE: Record<Visibility, 'muted' | 'accent' | 'warning'> = {
  private: 'muted',
  project: 'muted',
  authenticated: 'accent',
  public: 'warning',
};

const STATUS_STRING: Record<SiteView['status'], string> = {
  live: 'statusLive',
  draft: 'statusDraft',
  failed: 'statusFailed',
};

const STATUS_DOT: Record<SiteView['status'], string> = {
  live: 'bg-success',
  draft: 'bg-text-muted/50',
  failed: 'bg-danger',
};

export function SiteCard({ site, strings, onOpen }: {
  site: SiteView;
  strings: Record<string, string>;
  onOpen(site: SiteView): void;
}) {
  const { components, utils, hooks } = runtime();
  const { EntityRow, Badge, Button } = components;
  const { toast } = hooks.useToast();

  const built = site.lastPublishModel || site.createdModel;
  const when = relativeTime(site.lastPublishAt ?? site.createdAt);

  return (
    <EntityRow interactive onClick={() => onOpen(site)} className="flex flex-col gap-2 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[site.status]}`} aria-hidden />
            <span className="truncate text-sm font-medium text-text">{site.title}</span>
          </div>
          {site.summary ? <p className="line-clamp-2 text-xs text-text-muted">{site.summary}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge tone={VISIBILITY_TONE[site.visibility]}>{strings[VISIBILITY_STRING[site.visibility]] ?? site.visibility}</Badge>
          <Badge tone={site.status === 'failed' ? 'danger' : 'default'}>{strings[STATUS_STRING[site.status]] ?? site.status}</Badge>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="truncate font-mono text-[11px] text-text-muted">{site.url}</span>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            onClick={() => { utils.copyText(site.url); toast(strings.copied ?? 'Copied'); }}
            title={strings.copyLink ?? 'Copy address'}
          >
            {strings.copyLink ?? 'Copy address'}
          </Button>
        </div>
      </div>

      <p className="text-[11px] text-text-muted">
        {site.status === 'live' && site.lastPublishAt
          ? `${(strings.builtBy ?? 'Built by {model}').replace('{model}', built || '—')}${when ? ` · ${when}` : ''}`
          : strings.neverPublished ?? 'Not published yet'}
      </p>
    </EntityRow>
  );
}

export function SitesPage() {
  const { components, hooks } = runtime();
  const { WorkspacePage, PluginPageHeader, EntityList, LoadingState, ErrorState, EmptyState } = components;
  const strings = hooks.usePluginStrings('sites');
  const [openSite, setOpenSite] = useState<SiteView | null>(null);

  const list = hooks.useQuery<SitesListResponse>({
    queryKey: ['sites', 'list'],
    queryFn: () => runtime().api('/plugins/sites/api/sites'),
  });

  return (
    <WorkspacePage>
      <PluginPageHeader
        title={strings.title ?? 'Sites'}
        description={strings.subtitle}
        icon={Globe}
      />

      {list.isLoading ? <LoadingState /> : null}
      {list.isError ? <ErrorState title={strings.title ?? 'Sites'} /> : null}

      {list.data ? (
        <div className="flex flex-col gap-6">
          <section className="flex flex-col gap-2">
            <h2 className="text-xs uppercase tracking-wide text-text-muted">{strings.mine ?? 'My sites'}</h2>
            {list.data.mine.length === 0 ? (
              <EmptyState title={strings.empty ?? 'No sites yet.'} icon={Globe} />
            ) : (
              <EntityList className="flex flex-col gap-2">
                {list.data.mine.map((site) => (
                  <SiteCard key={site.id} site={site} strings={strings} onOpen={setOpenSite} />
                ))}
              </EntityList>
            )}
          </section>

          {list.data.shared.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h2 className="text-xs uppercase tracking-wide text-text-muted">{strings.shared ?? 'Shared with me'}</h2>
              <EntityList className="flex flex-col gap-2">
                {list.data.shared.map((site) => (
                  <SiteCard key={site.id} site={site} strings={strings} onOpen={setOpenSite} />
                ))}
              </EntityList>
            </section>
          ) : null}
        </div>
      ) : null}

      {openSite ? (
        <SiteDetail
          siteId={openSite.id}
          strings={strings}
          allowPublicSites={list.data?.allowPublicSites ?? false}
          dedicatedHost={list.data?.dedicatedHost ?? false}
          onClose={() => setOpenSite(null)}
        />
      ) : null}
    </WorkspacePage>
  );
}
