import { registerTeamsUi } from './runtime';
import { TeamsWorkspace } from './TeamsWorkspace';

registerTeamsUi({
  requiresApiVersion: 12,
  pages: { '': TeamsWorkspace },
});
