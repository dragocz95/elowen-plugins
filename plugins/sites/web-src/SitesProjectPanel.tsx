import { useState } from 'react';
import { Globe } from 'lucide-react';
import { runtime, type SiteView, type SitesListResponse } from './runtime.js';
import { SiteCard } from './SitesPage.js';
import { SiteDetail } from './SiteDetail.js';

/** The same cards, filtered to one Project, so sites show up where the team already looks. */
export function SitesProjectPanel({ project }: { project: { id: number } }) {
  const { components, hooks } = runtime();
  const { EntityList, LoadingState, EmptyState } = components;
  const strings = hooks.usePluginStrings('sites');
  const [openSite, setOpenSite] = useState<SiteView | null>(null);

  const list = hooks.useQuery<SitesListResponse>({
    queryKey: ['sites', 'list'],
    queryFn: () => runtime().api('/plugins/sites/api/sites'),
  });

  if (list.isLoading) return <LoadingState />;
  const sites = [...(list.data?.mine ?? []), ...(list.data?.shared ?? [])]
    .filter((site) => site.projectId === project.id);

  if (sites.length === 0) return <EmptyState title={strings.empty ?? 'No sites yet.'} icon={Globe} />;

  return (
    <div className="flex flex-col gap-2">
      <EntityList className="flex flex-col gap-2">
        {sites.map((site) => (
          <SiteCard key={site.id} site={site} strings={strings} onOpen={setOpenSite} />
        ))}
      </EntityList>
      {openSite ? (
        <SiteDetail
          siteId={openSite.id}
          strings={strings}
          allowPublicSites={list.data?.allowPublicSites ?? false}
          dedicatedHost={list.data?.dedicatedHost ?? false}
          onClose={() => setOpenSite(null)}
        />
      ) : null}
    </div>
  );
}
