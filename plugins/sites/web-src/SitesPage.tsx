import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChevronRight, ExternalLink, Globe, Layers, Search, Users } from 'lucide-react';
import {
  runtime, avatarUser, relativeTime, SITES_LIST_KEY,
  type SiteView, type SitesListResponse,
} from './runtime.js';
import {
  STATUS_ICON, STATUS_ORDER, STATUS_STRING, STATUS_TONE,
  VISIBILITY_ICON, VISIBILITY_ORDER, VISIBILITY_STRING, VISIBILITY_TONE,
} from './meta.js';
import { SiteDetail } from './SiteDetail.js';

type Section = 'mine' | 'shared';

const SECTIONS: readonly Section[] = ['mine', 'shared'];
const isVisibilityFilter = (raw: string): boolean => raw === 'all' || (VISIBILITY_ORDER as readonly string[]).includes(raw);
const isStatusFilter = (raw: string): boolean => raw === 'all' || (STATUS_ORDER as readonly string[]).includes(raw);

const matches = (site: SiteView, needle: string): boolean =>
  needle === '' || `${site.title} ${site.slug} ${site.summary} ${site.owner.name}`.toLowerCase().includes(needle);

/** The register of sites: the same table on the Sites page and inside a Project panel, so a site reads
 *  identically wherever it is listed. One row opens the shared detail drawer. */
export function SitesRegister({ sites, selectedId, onSelect }: {
  sites: SiteView[];
  selectedId: string | null;
  onSelect(siteId: string): void;
}) {
  const { components, hooks } = runtime();
  const { DataTable, DataTableRow, DataTableCell, MotionPresence, MotionLayoutItem } = components;
  const strings = hooks.usePluginStrings('sites');

  return (
    <DataTable
      ariaLabel={strings.title}
      columns="minmax(0,1fr) 11rem 8rem 7rem 6.5rem 1.25rem"
      compactColumns="minmax(0,1fr) 1.25rem"
    >
      <DataTableRow header>
        <DataTableCell header>{strings.columnSite}</DataTableCell>
        <DataTableCell header priority="wide">{strings.columnOwner}</DataTableCell>
        <DataTableCell header priority="wide">{strings.columnVisibility}</DataTableCell>
        <DataTableCell header priority="wide">{strings.columnStatus}</DataTableCell>
        <DataTableCell header priority="wide">{strings.columnPublished}</DataTableCell>
        <DataTableCell header role="presentation" aria-hidden>{null}</DataTableCell>
      </DataTableRow>

      <div role="rowgroup">
        <MotionPresence>
          {sites.map((site) => (
            <MotionLayoutItem
              key={site.id}
              layoutId={`site-${site.id}`}
              role="presentation"
              className="border-b border-border/70 last:border-b-0"
            >
              <SiteRow
                site={site}
                strings={strings}
                active={selectedId === site.id}
                onSelect={() => onSelect(site.id)}
                onNavigate={(direction) => {
                  const index = sites.findIndex((item) => item.id === site.id);
                  const next = direction === 'home' ? sites[0]
                    : direction === 'end' ? sites[sites.length - 1]
                      : sites[index + (direction === 'next' ? 1 : -1)];
                  if (!next) return;
                  // Arrow/Home/End move the row focus only. Opening the drawer here would inert the
                  // register underneath it and interrupt keyboard traversal after a single step.
                  requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-site-open="${next.id}"]`)?.focus());
                }}
              />
            </MotionLayoutItem>
          ))}
        </MotionPresence>
      </div>
    </DataTable>
  );
}

/** One site = one register row. The owner is a face and a name, never an account id. Secondary columns
 *  appear as the workspace widens, exactly as they do in the app's other registers. */
function SiteRow({ site, strings, active, onSelect, onNavigate }: {
  site: SiteView;
  strings: Record<string, string>;
  active: boolean;
  onSelect(): void;
  onNavigate(direction: 'next' | 'previous' | 'home' | 'end'): void;
}) {
  const { components } = runtime();
  const { DataTableRow, DataTableCell, Badge, Avatar, IconButton } = components;
  const StatusIcon = STATUS_ICON[site.status];
  const VisibilityIcon = VISIBILITY_ICON[site.visibility];
  const published = site.lastPublishAt ? relativeTime(site.lastPublishAt) : '—';

  return (
    <DataTableRow selected={active} interactive aria-selected={active} className="group">
      <DataTableCell>
        <button
          type="button"
          data-site-open={site.id}
          onClick={onSelect}
          onKeyDown={(event) => {
            const direction = event.key === 'ArrowDown' ? 'next'
              : event.key === 'ArrowUp' ? 'previous'
                : event.key === 'Home' ? 'home'
                  : event.key === 'End' ? 'end' : null;
            if (!direction) return;
            event.preventDefault();
            onNavigate(direction);
          }}
          className="flex w-full min-w-0 flex-col items-start gap-0.5 text-left"
        >
          <span className="flex min-w-0 max-w-full items-center gap-2">
            <StatusIcon size={12} aria-hidden className={site.status === 'live' ? 'shrink-0 text-success' : site.status === 'failed' ? 'shrink-0 text-danger' : 'shrink-0 text-text-muted'} />
            <span className="truncate text-sm text-text">{site.title}</span>
          </span>
          <span className="max-w-full truncate font-mono text-[11px] text-text-muted">{site.url}</span>
        </button>
      </DataTableCell>
      <DataTableCell priority="wide" title={site.owner.name}>
        <span className="flex min-w-0 items-center gap-2">
          <Avatar size={22} name={site.owner.name} user={avatarUser(site.owner)} />
          <span className="truncate text-xs text-text-muted">{site.owner.name}</span>
        </span>
      </DataTableCell>
      <DataTableCell priority="wide">
        <Badge tone={VISIBILITY_TONE[site.visibility]}>
          <VisibilityIcon size={10} aria-hidden className="mr-1" />
          {strings[VISIBILITY_STRING[site.visibility]]}
        </Badge>
      </DataTableCell>
      <DataTableCell priority="wide">
        <Badge tone={STATUS_TONE[site.status]}>{strings[STATUS_STRING[site.status]]}</Badge>
      </DataTableCell>
      <DataTableCell priority="wide" className="whitespace-nowrap text-xs text-text-muted">{published}</DataTableCell>
      <DataTableCell>
        {site.status === 'live' ? (
          <IconButton
            icon={ExternalLink}
            label={strings.openSite}
            onClick={() => window.open(site.url, '_blank', 'noopener,noreferrer')}
          />
        ) : null}
      </DataTableCell>
      <DataTableCell aria-hidden className="text-text-muted/50 transition-colors group-hover:text-text">
        <ChevronRight size={15} />
      </DataTableCell>
    </DataTableRow>
  );
}

/** Sites module: a filtered register of the pages this account published or was given, plus the shared
 *  detail drawer. Same shape as every other workspace — hero, section rail, control surface, drawer. */
export function SitesPage() {
  const { components, hooks } = runtime();
  const {
    SpatialWorkspaceLayout, WorkspaceMetric, WorkspaceDetailRail,
    ControlSurfaceDocument, ControlSurfaceToolbar, ControlSurfaceRegister, ControlSurfaceState,
    Input, SelectMenu, LoadingState, ErrorState, EmptyState,
  } = components;
  const strings = hooks.usePluginStrings('sites');

  const list = hooks.useQuery<SitesListResponse>({
    queryKey: SITES_LIST_KEY,
    queryFn: () => runtime().api('/plugins/sites/api/sites'),
  });

  const [section, setSection] = hooks.usePersistentState<Section>('elowen.sites.section', 'mine', SECTIONS);
  const [visibility, setVisibility] = hooks.usePersistentState<string>('elowen.sites.visibility', 'all', isVisibilityFilter);
  const [status, setStatus] = hooks.usePersistentState<string>('elowen.sites.status', 'all', isStatusFilter);
  // The search stays transient on purpose: it is an immediate intent, and a query restored after a
  // reload reads as missing data rather than as an active filter.
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const mine = useMemo(() => list.data?.mine ?? [], [list.data]);
  const shared = useMemo(() => list.data?.shared ?? [], [list.data]);
  const sectionSites = section === 'mine' ? mine : shared;

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return sectionSites
      .filter((site) => visibility === 'all' || site.visibility === visibility)
      .filter((site) => status === 'all' || site.status === status)
      .filter((site) => matches(site, needle));
  }, [sectionSites, visibility, status, query]);

  // A site can vanish under the drawer — deleted here, or dropped from the listing when its access
  // changed. Close rather than leave a rail pointing at nothing.
  const selected = useMemo(
    () => [...mine, ...shared].find((site) => site.id === selectedId) ?? null,
    [mine, shared, selectedId],
  );
  useEffect(() => { if (selectedId !== null && list.data && selected === null) setSelectedId(null); }, [selectedId, list.data, selected]);

  const summary = useMemo(() => {
    const all = [...mine, ...shared];
    return {
      total: all.length,
      live: all.filter((site) => site.status === 'live').length,
      shared: shared.length,
      published: all.filter((site) => site.visibility === 'public').length,
    };
  }, [mine, shared]);

  const visibilityOptions = [
    { value: 'all', label: strings.filterAllVisibilities, icon: <Layers size={14} /> },
    ...VISIBILITY_ORDER.map((value) => {
      const Icon = VISIBILITY_ICON[value];
      return { value, label: strings[VISIBILITY_STRING[value]], icon: <Icon size={14} /> };
    }),
  ];
  const statusOptions = [
    { value: 'all', label: strings.filterAllStatuses, icon: <Layers size={14} /> },
    ...STATUS_ORDER.map((value) => {
      const Icon = STATUS_ICON[value];
      return { value, label: strings[STATUS_STRING[value]], icon: <Icon size={14} /> };
    }),
  ];

  const register = () => {
    if (sectionSites.length === 0) {
      return <EmptyState title={section === 'mine' ? strings.empty : strings.emptyShared} icon={Globe} />;
    }
    if (filtered.length === 0) return <EmptyState title={strings.emptySearch} icon={Search} />;
    return <SitesRegister sites={filtered} selectedId={selectedId} onSelect={setSelectedId} />;
  };

  return (
    <SpatialWorkspaceLayout
      hero={{
        eyebrow: strings.title,
        title: strings.title,
        count: summary.total,
        description: strings.subtitle,
        mascotState: list.isLoading ? 'saving' : list.isError ? 'error' : 'idle',
        metrics: <>
          <WorkspaceMetric label={strings.metricTotal} value={summary.total} icon={Globe} />
          <WorkspaceMetric label={strings.metricLive} value={summary.live} icon={CheckCircle2} />
          <WorkspaceMetric label={strings.metricShared} value={summary.shared} icon={Users} />
          <WorkspaceMetric label={strings.metricPublic} value={summary.published} icon={Layers} />
        </>,
      }}
      navigation={{
        sections: [
          { id: 'mine', label: strings.mine, icon: Globe, count: mine.length },
          { id: 'shared', label: strings.shared, icon: Users, count: shared.length },
        ],
        value: section,
        onChange: (value) => setSection(value as Section),
        ariaLabel: strings.title,
      }}
    >
      <ControlSurfaceDocument>
        {list.isLoading ? <ControlSurfaceState><LoadingState variant="cards" /></ControlSurfaceState>
          : list.isError ? (
            <ControlSurfaceState tone="danger">
              <ErrorState message={strings.loadFailed} onRetry={() => list.refetch()} />
            </ControlSurfaceState>
          ) : (
            <div className="workspace-master-detail" data-detail={selected != null}>
              <div className="flex min-w-0 flex-col gap-4">
                <ControlSurfaceToolbar className="flex-col items-stretch">
                  <div className="flex min-w-0 flex-wrap items-center gap-2 py-3">
                    <div className="relative min-w-[15rem] flex-1">
                      <Search size={14} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                      <Input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder={strings.searchPlaceholder}
                        className="pl-9"
                      />
                    </div>
                    <SelectMenu
                      value={visibility}
                      onChange={setVisibility}
                      options={visibilityOptions}
                      label={strings.filterVisibility}
                      className="min-w-[10rem]"
                    />
                    <SelectMenu
                      value={status}
                      onChange={setStatus}
                      options={statusOptions}
                      label={strings.filterStatus}
                      className="min-w-[9.5rem]"
                    />
                  </div>
                </ControlSurfaceToolbar>

                <ControlSurfaceRegister className="flex flex-col gap-4">{register()}</ControlSurfaceRegister>
              </div>

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
          )}
      </ControlSurfaceDocument>
    </SpatialWorkspaceLayout>
  );
}
