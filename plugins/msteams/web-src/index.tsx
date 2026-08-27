import { registerTeamsUi } from './runtime';
import { TeamsWorkspace } from './TeamsWorkspace';

registerTeamsUi({
  requiresApiVersion: 8,
  pages: { '': TeamsWorkspace },
});
