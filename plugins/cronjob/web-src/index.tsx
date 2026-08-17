/** cronjob — browser UI bundle.
 *
 *  Registers the scheduled-jobs editor both as Automation's own workspace and as a Settings section.
 *  The page registration keeps the host from wrapping a self-contained spatial workspace in a second
 *  page frame. Built by elowen-plugin-ui-kit into web/index.js.
 */
import { registerCronUi } from './runtime';
import { JobsSettings } from './JobsSettings';

registerCronUi({
  requiresApiVersion: 1,
  pages: { '': JobsSettings },
  settings: {
    'jobs': JobsSettings,
  },
});
