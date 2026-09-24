import { registerTeamsUi } from './runtime';
import { TeamsWorkspace } from './TeamsWorkspace';

registerTeamsUi({
  requiresApiVersion: 22,
  pages: { '': TeamsWorkspace },
});
