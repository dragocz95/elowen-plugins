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

This is the part most worth knowing, because it looks like a decision and is not one. A one-shot
wake-up returns to THIS conversation. A recurring job created in a direct platform chat (a Teams or
WhatsApp 1:1) reports back into that chat. A recurring job created anywhere else — the web chat above
all — reports in a conversation of its own, named after the job, where its runs accumulate. The
binding is captured for you at creation time.

So do not go looking for a channel, thread or conversation id to put in the job, and do not ask the
user for one. There is no field for it on a personal job: `notifyChannelId` exists only for
instance-wide jobs, which only the instance operator may create, and passing it on a personal job is
refused. The tool's own reply tells you where the job will land — "it will report here, in this
conversation" — so read that back to the user rather than guessing.

The one case that differs: a schedule created where there is no single person to report to (a shared
room, or automation with no account behind it) has nowhere to reply, and reports through the
instance's notification channel instead.

## You do choose where a recurring job is FILED

A recurring job also names the conversation it is organized under, through `CronAdd`'s required
`conversationSessionId`. That is filing, and it is one of the two decisions this tool asks of you. It
groups the job under that conversation in the conversation list so it can be found and opened again
later, and it changes nothing else: not the context the job runs with, not its model, not its
permissions, not its owner, not its schedule, and not where the reply lands. Moving a job to another
conversation later makes the same promise — the grouping moves and everything else stays.

Take the id from `CronConversations` and pass it explicitly. There is no default and nothing is
inferred from the conversation you are in; that conversation is usually the right answer, but you
still have to say so with its id. A personal job may only name a conversation of its own account, so
somebody's reminder can never be filed under a colleague's chat.

In a shared room `CronConversations` deliberately lists nothing private — only that room, if it is
eligible at all. Do not work around it: ask again in a private chat, or point the user at the
Automation page. For the same reason, never read a conversation's title or id back into a shared
room; say that the job is grouped, not what it is grouped under.

## Tools

- `CronAdd` — recurring self-prompt: `"every 15m"`, `"every 2h"`, `"daily 07:30"`,
  `"weekly sun 20:00"`, or a cron expression (`"0 9 * * 1-5"`). `scope` and `conversationSessionId`
  are both required and are the choices you have to make: `"personal"` for the person you are talking
  to, `"instance"` for the whole instance (operator only), and the conversation the job is filed
  under. Optional `hours` active window.
- `CronConversations` — the conversations a job may be filed under, with their ids. Read-only.
- `ScheduleWakeup` — ONE-SHOT wake-up (`"in 20m"`, `"at 18:30"`); it removes itself after running
  and resumes the conversation it was scheduled from, with its full context. A wake-up is never
  filed under a conversation — it has no `conversationSessionId` and needs none.
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
