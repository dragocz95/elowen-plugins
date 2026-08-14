---
name: elowen-scheduling
description: Use when scheduling something for yourself on an Elowen instance — a recurring self-prompt (daily digest, periodic check) or a one-shot wake-up to come back to something later.
---

# Scheduling your own prompts

This instance has the scheduler installed, so you can wake yourself up on a schedule. The tools
below are admin-only and exist ONLY in trusted (owner) sessions — the web chat dock and the CLI
chat. Platform channel sessions (e.g. Discord, WhatsApp) never get them. If a tool is missing, do
not attempt the operation and do not work around it.

## Tools

- `CronAdd` — recurring self-prompt: `"every 15m"`, `"every 2h"`, `"daily 07:30"`,
  `"weekly sun 20:00"`, or a cron expression (`"0 9 * * 1-5"`). Optional `hours` active window and
  `notifyChannelId` delivery target.
- `ScheduleWakeup` — ONE-SHOT wake-up (`"in 20m"`, `"at 18:30"`); it removes itself after running.
- `CronList` / `CronRemove` — inspect and delete scheduled jobs.

## Choosing between them

- Something that should happen again and again on a clock → `CronAdd`.
- "Check back on X later" inside a conversation → `ScheduleWakeup`, not a cron job. It fires once
  and disappears, and it resumes the conversation it was scheduled from.
- A concrete piece of work on a project's code is neither — that is a task, and task tracking is a
  separate plugin with its own skill (`elowen-tasks`).

## Safety rules

- `CronRemove` is destructive: ask for the user's explicit confirmation in this conversation first,
  and never batch-delete.
- Creating a job changes shared state. After doing it, clearly state what you created — its name
  and where its output will land.
- Do not schedule a job that duplicates an existing one — check `CronList` before `CronAdd`.
- Pick the interval from how fast the watched thing actually changes, not from round numbers. A
  check that costs a model call every 30 seconds to observe something that moves hourly is waste.
