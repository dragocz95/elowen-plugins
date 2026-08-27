/** skills — browser UI bundle.
 *
 *  Registers the skill editor as Skills' Settings section. The host serves that sole section at the
 *  bare `/p/skills` route as well, and `ownsPageFrame` tells it to draw no page frame of its own
 *  around a section that already renders a whole workspace shell. Built by elowen-plugin-ui-kit into
 *  web/index.js.
 */
import { registerSkillsUi } from './runtime';
import { SkillsSettings } from './SkillsSettings';

registerSkillsUi({
  requiresApiVersion: 8,
  settings: {
    'skills': SkillsSettings,
  },
  ownsPageFrame: ['skills'],
});
