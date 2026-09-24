---
title: GitHub
slug: github-plugin
order: 39
eyebrow: Plugin reference
group: Plugin reference
---

# GitHub

The GitHub plugin connects each account's own GitHub identity and adds branch publishing, pull requests, reviews, checks and confirmed merges to a committed branch. For the complete Project and worktree workflow, see [Projects, Environments & GitHub](projects-workflow).

Install `github` from **Settings → Plugins → Available**. It requires Elowen 0.28.53 or later. Project and tool permissions still apply. Check the registry for the plugin's current version and minimum Elowen version.

Find account connection under **Account settings → GitHub** and repository mappings and pull requests in a Project's **GitHub** tab. Each mapping belongs to the account that created it and records a base repository and a push repository. These may differ for a fork workflow. **Detect** uses the Project's Git remotes to suggest a mapping. Publishing requires a connected account, a verified mapping and a committed branch created by Elowen.

There is no personal access token field. Connecting uses GitHub CLI device login, so `gh` must be installed. Approve the one-time code on GitHub. When GitHub requires reconnection, connect again; Elowen does not refresh the authorization silently.

The first five tools below are read-only. Publishing, creating a pull request, submitting a review and merging change a remote repository and require an interactive confirmation after a preview. Scheduled and delegated sessions cannot perform these writes.

| Tool | What it does |
| --- | --- |
| `GithubConnectionStatus` | Shows connection state and the number of mappings for the account. |
| `GithubRepositoryStatus` | Checks a Project's verified mapping and repository permissions. |
| `GithubListPullRequests` | Lists pull requests for a mapped Project. |
| `GithubGetPullRequest` | Reads a pull request, changed files and reviews. |
| `GithubPullRequestChecks` | Reports checks as pending, successful, failed or requiring action. |
| `GithubPublishBranch` | Publishes the current conversation's committed branch; never force-pushes. |
| `GithubCreatePullRequest` | Publishes the branch and opens a pull request, reusing an existing open match. |
| `GithubSubmitReview` | Approves, requests changes or comments on a pull request. |
| `GithubMergePullRequest` | Merges a pull request if the safeguards below pass. |

A merge requires an open, non-draft pull request, an unchanged head commit, successful checks, no current request for changes and a repository-supported merge method. Confirmations expire after use or a short time, and an action must be previewed again if the pull request or repository changes. Unsafe repository-local Git transport, include, credential or proxy configuration blocks publishing.

The default merge method is set per account in the GitHub account panel.

| Setting | Key | Default | Purpose |
| --- | --- | --- | --- |
| Default merge method | `mergeMethod` | `squash` | Used when a merge action does not specify a method. Options: Squash, Merge commit or Rebase. |

For tool access and account grants, see [Users & Access](users-access).

[Next: Browser](browser-plugin)
