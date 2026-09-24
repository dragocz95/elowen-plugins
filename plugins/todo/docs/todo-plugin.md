---
title: Task List
slug: todo-plugin
order: 47
eyebrow: Plugin reference
group: Plugin reference
---

# Task List

Install and enable the **todo** plugin in **Settings → Plugins → Available**. It gives Elowen a task list for multi-step work in a conversation. When enabled, a pinned task card appears in chat and the task tools are available, subject to your account's tool permissions. The plugin has no configuration fields, does not need a separate user grant, and requires Elowen 0.28.53 or newer. Enabling or disabling it restarts Elowen; the change applies after restart.

## View and manage tasks

The pinned **Todos** card shows task status, owner, progress text and unfinished blockers. It refreshes as tasks change. In web chat, open the **Tasks** panel to find, update or remove tasks. Its filter searches task subjects and descriptions. You can change a task's status, rename it, delete an individual task, or clear completed tasks or the whole list. The panel asks you to confirm before clearing tasks. In the CLI, use `/tasks` to inspect and manage the current conversation's list. Chat platforms show the task card as a text message.

Each signed-in account has a separate list for each conversation. The list belongs to the conversation, not to a project-wide board, and it survives reloading the same conversation. The agent also receives the list as working context, so it can keep the displayed progress in sync with its work.

## Create and update a task plan

Elowen can create a complete plan in one `TaskCreate` call. Each item needs a non-empty `subject` and `description`; if either is missing, the whole batch is rejected. The result returns an ID for each task. Use `TaskUpdate` to change one existing task at a time, or `TaskDelete` to permanently remove one or more tasks.

The tools are:

- `TaskCreate` adds one or more tasks.
- `TaskList` shows the current tasks and their public status, owner and unfinished blockers.
- `TaskGet` reads one task, including its private description and dependency details.
- `TaskUpdate` changes a task's subject, description, progress text, status, owner or dependencies.
- `TaskDelete` removes a task or an explicit batch of tasks.

Task statuses are `pending`, `in_progress` and `completed`. Elowen should mark work in progress when it starts and complete it only when the work is finished. A completed blocker no longer blocks its dependent task. When no work is in progress, Elowen starts with the first pending task that has no unfinished blockers.

## Set task dependencies

Use `blockedBy` to make one task wait for another. For an existing task, use its ID as a string. To refer to a task earlier in the same `TaskCreate` batch, use its one-based position with a dollar sign. A realistic two-step plan might run the tests first, then fix any failures; the second task can wait with `blockedBy: ["$1"]`. You can also combine existing IDs and batch positions.

The plugin rejects missing dependencies, self-dependencies and cycles instead of saving a broken plan. IDs are local to the conversation's list. Use IDs returned by `TaskCreate` or shown by `TaskList`; never guess one. A blocked task can still be marked complete manually from the Tasks panel.

## What is private

The card and `TaskList` show subjects, statuses, owners, progress text and unresolved blockers. Task descriptions and metadata are private working context for the agent. `TaskGet` can show the description to the agent, but it is not displayed in the card or the Tasks panel. Do not put information in a task description if it should not be available to the agent.

The task subject and owner are displayed as single-line labels; control characters such as newlines are rejected. Web edits to task subjects are limited to 200 characters and owner labels to 64 characters.

## When completed tasks disappear

A list whose tasks are all completed stays available for three more conversation turns, then clears automatically. New work after that starts with an empty list. A list with unfinished tasks does not age out just because some tasks are complete.

[Next: Voice Calls](voice-bot-plugin)
