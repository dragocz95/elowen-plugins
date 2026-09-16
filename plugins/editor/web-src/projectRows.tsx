import { useState } from 'react';
import { ProjectIconPicker } from './ProjectIconPicker';
import { runtime, type Project } from './runtime';

const { navigate } = runtime();

export function useProjectRowContribution({ projects }: { projects: Project[] }) {
  const s = runtime().hooks.usePluginStrings('editor');
  const [iconFor, setIconFor] = useState<Project | null>(null);

  return {
    actions: Object.fromEntries(projects.map((project) => [project.id, [
      {
        id: 'open-editor',
        label: s.openEditor,
        icon: 'Code2',
        onSelect: () => navigate(`/p/editor?project=${encodeURIComponent(String(project.id))}`),
      },
      {
        id: 'choose-icon',
        label: s.chooseIcon,
        icon: 'Image',
        onSelect: () => setIconFor(project),
      },
    ]])),
    overlay: iconFor ? <ProjectIconPicker project={iconFor} onClose={() => setIconFor(null)} /> : null,
  };
}
