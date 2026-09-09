# github

Links each Elowen account to its own GitHub identity through device authentication, maps accessible Projects to repositories and lets the agent publish Sandbox branches, inspect and create pull requests, submit reviews, read checks and merge after an explicit confirmation.

## Install

Install it from Settings -> Plugins -> Available in the Elowen web interface, or ask the assistant to install the `github` plugin.

| | |
| --- | --- |
| Version | `0.1.15` |
| Requires core | `0.28.35` |
| Requires shared API | `not declared` |
| User-grantable | No |

## Tools

`GithubConnectionStatus`, `GithubRepositoryStatus`, `GithubListPullRequests`, `GithubGetPullRequest` and `GithubPullRequestChecks` report connection health, repository mappings and pull request state. `GithubPublishBranch`, `GithubCreatePullRequest`, `GithubSubmitReview` and `GithubMergePullRequest` change remote state and each require interactive confirmation before they act.

## Configuration

The operator schema declares no settings fields. Each account may set a default merge method, `mergeMethod`, in the personal GitHub settings, and the plugin provides a `github` control.

## Documentation

See the "Code Tools" page of the Elowen user manual (`docs/site/39-code-tools.md` in the Elowen repository).