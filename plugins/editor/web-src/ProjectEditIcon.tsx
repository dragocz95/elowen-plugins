import { useState } from 'react';
import { ImageIcon } from 'lucide-react';
import { ProjectIconPicker } from './ProjectIconPicker';
import { runtime, type Project } from './runtime';

/** The editor owns this form field and shares the same picker with its project-row action. */
export function ProjectEditIcon({ project }: { project: Project }) {
  const { hooks, components: C } = runtime();
  const s = hooks.usePluginStrings('editor');
  const [open, setOpen] = useState(false);
  return (
    <>
      <C.Field label={s.iconLabel} hint={s.iconHint}>
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted">
            <C.ProjectIcon project={project} size={project.icon ? 36 : 22} className="text-muted-foreground" />
          </span>
          {project.icon ? <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground" title={project.icon}>{project.icon}</span> : null}
          <C.Button icon={ImageIcon} variant="default" onClick={() => setOpen(true)}>{s.chooseIcon}</C.Button>
        </div>
      </C.Field>
      {open ? <ProjectIconPicker project={project} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
