import { useMemo, useState } from 'react';
import { Globe } from 'lucide-react';
import { runtime, SITES_LIST_KEY, type SitesListResponse } from './runtime.js';
import { SitesRegister } from './SitesPage.js';
import { SiteDetail } from './SiteDetail.js';

/** The same register and the same drawer, narrowed to one Project, so sites read identically wherever
 *  the team looks at them. */
export function SitesProjectPanel({ project }: { project: { id: number } }) {
  const { components, hooks } = runtime();
  const { WorkspaceDetailRail, LoadingState, ErrorState, EmptyState } = components;
  const strings = hooks.usePluginStrings('sites');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const list = hooks.useQuery<SitesListResponse>({
    queryKey: SITES_LIST_KEY,
    queryFn: () => runtime().api('/plugins/sites/api/sites'),
  });

  const sites = useMemo(
    () => [...(list.data?.mine ?? []), ...(list.data?.shared ?? [])].filter((site) => site.projectId === project.id),
    [list.data, project.id],
  );
  const selected = sites.find((site) => site.id === selectedId) ?? null;

  if (list.isLoading) return <LoadingState variant="list" />;
  if (list.isError) return <ErrorState message={strings.loadFailed} onRetry={() => list.refetch()} />;
  if (sites.length === 0) return <EmptyState title={strings.empty} icon={Globe} />;

  return (
    <div className="workspace-master-detail" data-detail={selected != null}>
      <SitesRegister sites={sites} selectedId={selectedId} onSelect={setSelectedId} />
      {selected ? (
        <WorkspaceDetailRail label={strings.detailTitle} closeLabel={strings.close} onClose={() => setSelectedId(null)}>
          <SiteDetail
            siteId={selected.id}
            allowPublicSites={list.data?.allowPublicSites ?? false}
            dedicatedHost={list.data?.dedicatedHost ?? false}
            onDeleted={() => setSelectedId(null)}
          />
        </WorkspaceDetailRail>
      ) : null}
    </div>
  );
}
