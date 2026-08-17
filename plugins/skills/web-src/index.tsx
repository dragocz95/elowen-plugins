/** skills — browser UI bundle.
 *
 *  Registers the skill editor both as Skills' own workspace and as a Settings section. The page
 *  registration keeps the host from wrapping a self-contained spatial workspace in a second page
 *  frame. Built by elowen-plugin-ui-kit into web/index.js.
 */
import { registerSkillsUi } from './runtime';
import { SkillsSettings } from './SkillsSettings';

registerSkillsUi({
  requiresApiVersion: 1,
  pages: { '': SkillsSettings },
  settings: {
    'skills': SkillsSettings,
  },
});
