import { registerEditorUi } from './runtime';
import { EditorPage } from './EditorPage';

registerEditorUi({
  requiresApiVersion: 8,
  pages: { '': EditorPage },
});
