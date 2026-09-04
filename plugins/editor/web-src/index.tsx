import './editor.css';
import { registerEditorUi } from './runtime';
import { EditorPage } from './EditorPage';

registerEditorUi({
  requiresApiVersion: 16,
  pages: { '': EditorPage },
});
