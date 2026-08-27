---
name: elowen-scheduling
description: Use when scheduling something for yourself on an Elowen instance — a recurring self-prompt (daily digest, periodic check) or a one-shot wake-up to come back to something later.
---

# Scheduling your own prompts

This instance has the scheduler installed, so you can wake yourself up on a schedule. Scheduling is a
per-account capability, not an owner-only one: anyone the administrator has granted this plugin can
create schedules for themselves, from any conversation where you can see these tools — a private
chat on a platform such as Teams counts. If a tool is not offered to you, do not attempt the
operation and do not work around it.

## You never choose where the result goes

This is the part most worth knowing, because it looks like a decision and is not one. A schedule you
create for the person you are talking to reports back into THIS conversation automatically. The
binding is captured for you at creation time, from the conversation you are already in.

So do not go looking for a channel, thread or conversation id to put in the job, and do not ask the
user for one. There is no field for it on a personal job: `notifyChannelId` exists only for
instance-wide jobs, which only the instance operator may create, and passing it on a personal job is
refused. The tool's own reply tells you where the job will land — "it will report here, in this
conversation" — so read that back to the user rather than guessing.

The one case that differs: a schedule created where there is no single person to report to (a shared
room, or automation with no account behind it) has nowhere to reply, and reports through the
instance's notification channel instead.

## Tools

- `CronAdd` — recurring self-prompt: `"every 15m"`, `"every 2h"`, `"daily 07:30"`,
  `"weekly sun 20:00"`, or a cron expression (`"0 9 * * 1-5"`). `scope` is required and is the only
  choice you have to make: `"personal"` for the person you are talking to, `"instance"` for the
  whole instance (operator only). Optional `hours` active window.
- `ScheduleWakeup` — ONE-SHOT wake-up (`"in 20m"`, `"at 18:30"`); it removes itself after running
  and resumes the conversation it was scheduled from, with its full context.
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
