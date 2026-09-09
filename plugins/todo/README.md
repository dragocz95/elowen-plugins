# todo

Gives the agent a session task list: it tracks multi-step work incrementally and shows progress live in the interface.

## Install

Install it from Settings -> Plugins -> Available in the Elowen web interface, or ask the assistant to install the `todo` plugin.

| | |
| --- | --- |
| Version | `0.14.3` |
| Requires core | `0.28.14` |
| Requires shared API | `not declared` |
| User-grantable | No |

## Tools

`TaskCreate` adds tasks, `TaskGet` and `TaskList` read one or all of them, `TaskUpdate` changes status, dependencies and fields, and `TaskDelete` removes them.

## Configuration

The manifest declares no settings fields. Tasks live per conversation and are visible in the interface task panel.

## Documentation

See the "Task List" page of the Elowen user manual (`docs/site/47-todo-plugin.md` in the Elowen repository).