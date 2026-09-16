import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, GitBranch, GitCommitHorizontal, FolderGit2 } from 'lucide-react';
import { runtime, type Project } from './runtime';

const { hooks, components: C, utils, navigate } = runtime();
const { Badge, Button, EntityList, EntityRow, LoadingLine } = C;

function editorUrl(projectId: number, params: Record<string, string> = {}): string {
  const query = new URLSearchParams({ project: String(projectId), ...params });
  return `/p/editor?${query.toString()}`;
}

/** Git and editor actions for one selected project. The Projects register remains core-owned; repository
 * presentation belongs to the editor plugin and disappears with it. */
export function ProjectGitPanel({ project }: { project: Project }) {
  const s = hooks.usePluginStrings('editor');
  const host = hooks.useTranslation().t.projects;
  const managed = project.executionKind === 'managed';
  const environment = hooks.useProjectEnvironmentState(managed ? project.id : null);
  const git = hooks.useProjectGit(project.id, !managed || environment.data?.environment.state === 'running');

  if (managed && environment.isLoading) return <LoadingLine />;
  if (managed && environment.isError) return <p role="alert" className="py-4 text-xs text-muted-foreground">{utils.apiErrorMessage(environment.error)}</p>;
  if (managed && environment.data && environment.data.environment.state !== 'running') return <p role="status" className="py-4 text-xs text-muted-foreground">{s.gitEnvironmentStopped}</p>;
  if (git.isLoading) return <LoadingLine />;
  if (git.isError) {
    const status = (git.error as { status?: number } | undefined)?.status;
    const message = status === 409 ? s.gitEnvironmentStopped : utils.apiErrorMessage(git.error);
    return <p role="alert" className="flex flex-wrap items-center gap-2 py-4 text-xs text-muted-foreground">{message}<Button variant="ghost" onClick={() => { void git.refetch(); }}>{host.retry}</Button></p>;
  }
  if (!git.data) return null;
  if (!git.data.isRepo) return <div className="py-4"><Badge tone="muted">{host.notGit}</Badge></div>;

  return (
    <>
      {git.data.status ? (
        <section className="border-b border-border/70 py-4">
          <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold text-foreground"><FolderGit2 size={14} className="text-muted-foreground" aria-hidden />{host.git}</h3>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="accent"><GitBranch size={11} className="mr-1" aria-hidden />{git.data.status.branch}</Badge>
            {git.data.status.clean
              ? <Badge tone="success"><CheckCircle2 size={11} className="mr-1" aria-hidden />{host.clean}</Badge>
              : <button type="button" onClick={() => navigate(editorUrl(project.id, { working: '1' }))} title={host.viewChanges} className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"><Badge tone="warning"><AlertTriangle size={11} className="mr-1" aria-hidden />{host.dirty.replace('{count}', String(git.data.status.dirty))}</Badge></button>}
            {git.data.status.ahead > 0 ? <Badge tone="accent"><ArrowUp size={11} className="mr-0.5" aria-hidden />{git.data.status.ahead}</Badge> : null}
            {git.data.status.behind > 0 ? <Badge tone="muted"><ArrowDown size={11} className="mr-0.5" aria-hidden />{git.data.status.behind}</Badge> : null}
          </div>
        </section>
      ) : null}

      {git.data.branches.length > 0 ? (
        <section className="border-b border-border/70 py-4">
          <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold text-foreground"><GitBranch size={14} className="text-muted-foreground" aria-hidden />{host.branches}</h3>
          <div className="flex flex-wrap gap-1.5">{git.data.branches.map((branch) => <Badge key={branch.name} tone={branch.current ? 'accent' : 'muted'}>{branch.name}{branch.current ? ' *' : ''}</Badge>)}</div>
        </section>
      ) : null}

      {git.data.commits.length > 0 ? (
        <section className="py-4">
          <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold text-foreground"><GitCommitHorizontal size={14} className="text-muted-foreground" aria-hidden />{host.commits}</h3>
          <EntityList>
            {git.data.commits.map((commit) => (
              <EntityRow key={commit.hash} interactive={false} className="py-0">
                <button type="button" onClick={() => navigate(editorUrl(project.id, { commit: commit.hash }))} title={host.viewCommit} className="flex w-full min-w-0 flex-col gap-1 px-1 py-3 text-left transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70">
                  <span className="flex min-w-0 items-center gap-2"><span className="font-mono text-[11px] text-primary">{commit.hash}</span><span className="min-w-0 flex-1 truncate text-xs text-foreground">{commit.subject}</span></span>
                  <span className="text-[10px] text-muted-foreground">{commit.author} · {commit.relative}</span>
                </button>
              </EntityRow>
            ))}
          </EntityList>
        </section>
      ) : null}
    </>
  );
}
