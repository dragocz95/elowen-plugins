import './editor.css';
import { registerEditorUi } from './runtime';
import { EditorPage } from './EditorPage';
import { ProjectGitPanel } from './ProjectGitPanel';
import { useProjectRowContribution } from './projectRows';
import { ProjectEditIcon } from './ProjectEditIcon';

registerEditorUi({
  requiresApiVersion: 16,
  pages: { '': EditorPage },
  project: { git: ProjectGitPanel },
  projectRows: useProjectRowContribution,
  projectEditIcon: ProjectEditIcon,
});
