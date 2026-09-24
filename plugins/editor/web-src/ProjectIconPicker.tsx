import { useMemo, useState, type ChangeEvent } from 'react';
import { ImageIcon } from 'lucide-react';
import { runtime, type Project } from './runtime';

const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|ico|bmp|avif)$/i;
const MAX_SHOWN = 300;

type FileNode = { path: string; type: 'file' | 'dir' };

/** Project icon selection belongs to the editor bundle. Project.icon itself remains persisted and validated
 * by the host project API. */
export function ProjectIconPicker({ project, onClose }: { project: Project; onClose: () => void }) {
  const { hooks, components: C, utils, api } = runtime();
  const { AutoSaveStatus, Button, EmptyState, ErrorState, Input, LoadingState, Modal, ModalBody, ModalFooter, ProjectIcon } = C;
  // The picker's OWN copy comes from the plugin manifest (`web.strings` plus i18n/cs|sk); only genuinely
  // shared host vocabulary still comes from `t`. Reading feature strings off the host is what left this
  // modal blank when the core deleted them together with the component it moved here — and the core's
  // languages-check refuses to keep a key no core source references, so the host cannot hold them.
  const s = hooks.usePluginStrings('editor');
  const host = hooks.useTranslation().t;
  const { toast } = hooks.useToast();
  const queryClient = hooks.useQueryClient();
  const managed = project.executionKind === 'managed';
  const environment = hooks.useProjectEnvironmentState(managed ? project.id : null);
  const environmentReady = !managed || environment.data?.environment.state === 'running';
  const files = hooks.useQuery<FileNode[]>({
    queryKey: ['editor-project-files', project.id],
    queryFn: () => api(`/projects/${project.id}/files`) as Promise<FileNode[]>,
    enabled: environmentReady,
  });
  const update = hooks.useMutation<unknown, unknown, string>({
    mutationFn: (icon: string) => api(`/projects/${project.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ icon }) }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['projects'] }),
        queryClient.invalidateQueries({ queryKey: ['project-summaries'] }),
      ]);
    },
  });
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(project.icon || null);

  const images = useMemo(() => {
    const all = (files.data ?? []).filter((file) => file.type === 'file' && IMAGE_RE.test(file.path));
    const needle = query.trim().toLowerCase();
    return (needle ? all.filter((file) => file.path.toLowerCase().includes(needle)) : all).slice(0, MAX_SHOWN);
  }, [files.data, query]);
  const groups = useMemo(() => {
    const by = new Map<string, string[]>();
    for (const file of images) {
      const slash = file.path.lastIndexOf('/');
      const dir = slash >= 0 ? file.path.slice(0, slash) : '/';
      const paths = by.get(dir);
      if (paths) paths.push(file.path);
      else by.set(dir, [file.path]);
    }
    return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [images]);

  const apply = (icon: string) => {
    if (update.isPending) return;
    update.mutate(icon, {
      onSuccess: () => { toast(icon ? s.iconSet : s.iconRemoved); onClose(); },
      onError: (error: unknown) => toast(utils.apiErrorMessage(error), 'error'),
    });
  };

  return (
    <Modal title={s.chooseIcon} description={project.slug} onClose={onClose} closeDisabled={update.isPending} size="xl" icon={ImageIcon}>
      <div className="border-b border-border px-5 py-3"><Input value={query} onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)} placeholder={s.iconSearch} autoFocus /></div>
      <ModalBody gap={6}>
        {managed && environment.isLoading ? <LoadingState />
          : managed && environment.isError ? <ErrorState message={utils.apiErrorMessage(environment.error)} onRetry={() => { void environment.refetch(); }} />
          : !environmentReady ? <EmptyState title={s.gitEnvironmentStopped} icon={ImageIcon} />
          : files.isLoading ? <LoadingState />
          : files.isError ? <ErrorState message={utils.apiErrorMessage(files.error)} onRetry={() => { void files.refetch(); }} />
          : images.length === 0 ? <EmptyState title={s.noImages} icon={ImageIcon} />
          : groups.map(([dir, paths]) => (
            <div key={dir} className="flex flex-col gap-2">
              <span className="font-mono text-caption uppercase tracking-wide text-muted-foreground">{dir}</span>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-2">
                {paths.map((path) => {
                  const selectedPath = selected === path;
                  return (
                    <button key={path} type="button" onClick={() => setSelected(path)} onDoubleClick={() => apply(path)} title={path} aria-pressed={selectedPath} className={`flex flex-col items-center gap-1.5 rounded-lg border p-2 transition-colors ${selectedPath ? 'border-primary bg-primary/[0.08]' : 'border-border bg-card hover:border-border-strong hover:bg-accent'}`}>
                      <span className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-md border border-border bg-background"><ProjectIcon project={{ id: project.id, icon: path }} size={40} /></span>
                      <span className="w-full truncate text-center text-caption text-muted-foreground">{path.slice(path.lastIndexOf('/') + 1)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        {images.length >= MAX_SHOWN ? <p className="text-xs text-muted-foreground">{s.iconMore}</p> : null}
      </ModalBody>
      <ModalFooter>
        {project.icon ? <Button variant="danger" onClick={() => apply('')} disabled={update.isPending}>{s.iconRemove}</Button> : null}
        <div className="flex-1" />
        <Button variant="ghost" onClick={onClose} disabled={update.isPending}>{host.common.cancel}</Button>
        <Button variant="accent" onClick={() => { if (selected) apply(selected); }} disabled={update.isPending || !selected}>{s.iconSelect}</Button>
        <AutoSaveStatus status={update.isPending ? 'saving' : update.isError ? 'error' : update.isSuccess ? 'saved' : 'idle'} />
      </ModalFooter>
    </Modal>
  );
}
