/** cronjob — browser UI bundle.
 *
 *  Registers the scheduled-jobs editor as Automation's Settings section. The host serves that sole
 *  section at the bare `/p/cronjob` route as well, and `ownsPageFrame` tells it to draw no page frame
 *  of its own around a section that already renders a whole workspace shell. Built by
 *  elowen-plugin-ui-kit into web/index.js.
 */
import { registerCronUi } from './runtime';
import { JobsSettings } from './JobsSettings';

registerCronUi({
  requiresApiVersion: 12,
  settings: {
    'jobs': JobsSettings,
  },
  ownsPageFrame: ['jobs'],
});
