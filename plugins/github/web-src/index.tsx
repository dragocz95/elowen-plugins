import { GitHubAccountPanel } from './GitHubAccountPanel';
import { GitHubPage } from './GitHubPage';
import { registerGitHubUi } from './runtime';

registerGitHubUi(GitHubPage, GitHubAccountPanel);
