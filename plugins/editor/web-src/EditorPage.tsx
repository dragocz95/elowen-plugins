import { useRef, useState } from 'react';
import { Code2, HardDrive } from 'lucide-react';
import { runtime } from './runtime';
import { ProjectEditor } from './editor/ProjectEditor';
import { SYSTEM_PROJECT_ID } from '../src/systemRoot';

const { useProjects, usePluginStrings, useProjectFilter, useFillHeight, useMobile, useMe, usePersistentState } = runtime().hooks;
const {
  ModuleHeader, EmptyState, WorkspacePage, WorkspaceHero, ProjectFilterPills, ProjectIcon,
  SelectMenu, MotionPresence, MotionLayoutItem,
} = runtime().components;
const { navigate } = runtime();

/** Remembers the system root across reloads. It cannot ride in the shared project filter: that slot
 *  accepts `'all'` or a run of digits and clamps anything the project list does not contain, and the
 *  system root is neither a project nor a positive id. */
const SYSTEM_KEY = 'elowen.editor.systemRoot';
const SYSTEM_CHOICES = ['on', 'off'] as const;
/** The dropdown value for the system entry — a non-numeric string, so it can never be read as an id. */
const SYSTEM_OPTION = 'system';

/** A deep link from Projects or the Timeline opens one project — and optionally one commit or the
 *  working tree — instead of the remembered filter. */
function linkTarget(): { project: number | null; commit: string | null; working: boolean } {
  const params = new URLSearchParams(window.location.search);
  const id = Number(params.get('project'));
  return {
    project: Number.isInteger(id) && id > 0 ? id : null,
    commit: params.get('commit'),
    working: params.get('working') === '1',
  };
}

/** Standalone code-editor page: the very same ProjectEditor that Projects opens as an overlay, here
 *  driven by the shared project-filter pills. The editor needs one concrete project, so an 'all' (or
 *  unset) filter falls back to the first accessible project. */
export function EditorPage() {
  const s = usePluginStrings('editor');
  const mobile = useMobile();
  const projects = useProjects();
  const me = useMe();
  const surfaceRef = useRef<HTMLDivElement>(null);
  const fillHeight = useFillHeight(surfaceRef);
  const { selectedProject, setProject } = useProjectFilter('elowen.editor.project');
  const [systemChoice, setSystemChoice] = usePersistentState<typeof SYSTEM_CHOICES[number]>(SYSTEM_KEY, 'off', SYSTEM_CHOICES);
  const [link] = useState(linkTarget);
  const list = projects.data ?? [];
  // Only an administrator is offered the system root. This is presentation, not the gate: the daemon
  // refuses the reserved id for every other account whether or not the entry was ever shown.
  const admin = me.data?.user.is_admin === true;
  const system = admin && systemChoice === 'on';
  const filtered = selectedProject === 'all' ? (list[0]?.id ?? null) : selectedProject;
  // A deep link wins over the remembered filter, but only while its project is one this user can see.
  const linked = link.project != null && list.some((item) => item.id === link.project) ? link.project : filtered;
  const projectId = system ? SYSTEM_PROJECT_ID : linked;
  const project = list.find((item) => item.id === projectId) ?? null;
  const chooseProject = (next: number | 'all') => { setSystemChoice('off'); setProject(next); };

  // An administrator picks from a list the shared pills cannot express: they are built from the project
  // query alone and hide themselves below two projects, so the system root would be unreachable exactly
  // where it is most useful — an instance with one project, or none. Everyone else keeps the shared
  // control unchanged.
  const picker = admin ? (
    <SelectMenu
      label={s.project}
      value={system ? SYSTEM_OPTION : String(projectId ?? '')}
      onChange={(next: string) => (next === SYSTEM_OPTION ? setSystemChoice('on') : chooseProject(Number(next)))}
      options={[
        { value: SYSTEM_OPTION, label: s.systemRoot, icon: <HardDrive size={14} /> },
        ...list.map((item) => ({
          value: String(item.id),
          label: item.slug,
          icon: <ProjectIcon project={item} size={14} />,
        })),
      ]}
      className="min-w-[9.5rem]"
    />
  ) : (
    <ProjectFilterPills value={projectId ?? 'all'} onChange={setProject} includeAll={false} variant="dropdown" />
  );

  // On mobile the editor auto-fullscreens and covers the app nav, so without a way out it traps the
  // user. Give it an onClose that leaves the editor back to the app (history if any, else the
  // dashboard). On desktop the sidebar is always visible, so no close affordance is needed.
  const onClose = mobile
    ? () => { if (window.history.length > 1) window.history.back(); else navigate('/dash'); }
    : undefined;

  return (
    <>
      <ModuleHeader title={s.title} icon={Code2} />
      <WorkspacePage className="editor-workspace-page">
        <WorkspaceHero
          eyebrow={s.workspaceEyebrow}
          title={s.title}
          icon={Code2}
          status={project || system
            ? <span className="workspace-status">{s.workspaceReady.replace('{project}', system ? s.systemRoot : (project?.slug ?? ''))}</span>
            : undefined}
          action={picker}
        />
        {/* The editor is sized to the window rather than to a fixed 70dvh: on a tall screen that left a
            band of dead space under it, and on a short one it pushed the page past the fold and wrapped
            the whole app in a scrollbar — around an editor that already has one of its own. */}
        {/* The gap under the hero's closing hairline. `WorkspacePage` is the bare page frame — gutters and
            a bottom rhythm, no top spacing — so unlike a `WorkspaceShell` page this surface has no
            `.workspace-shell__content` above it to inherit one from, and borrowing that class instead
            would drop its 2rem bottom padding INSIDE the fill height and reopen the dead band below the
            editor that the height above exists to close. */}
        <div ref={surfaceRef} className="min-h-0 overflow-hidden pt-4" style={fillHeight ? { height: fillHeight } : undefined}>
          <MotionPresence mode="wait">
            {projectId == null
              ? <MotionLayoutItem key="empty" className="h-full"><EmptyState title={s.noProjects} description={s.noProjectsDescription} icon={Code2} /></MotionLayoutItem>
              : <MotionLayoutItem key={`${projectId}:${link.commit ?? ''}:${link.working}`} className="h-full"><ProjectEditor projectId={projectId} initialCommit={link.commit} initialWorking={link.working} onClose={onClose} fill /></MotionLayoutItem>}
          </MotionPresence>
        </div>
      </WorkspacePage>
    </>
  );
}
