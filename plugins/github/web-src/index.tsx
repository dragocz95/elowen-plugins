import { GitHubAccountChip, GitHubAccountPanel } from './GitHubAccountPanel';
import { GitHubProjectPanel } from './GitHubProjectPanel';
import { registerGitHubUi } from './runtime';

registerGitHubUi(GitHubAccountPanel, GitHubAccountChip, GitHubProjectPanel);
