---
title: Scheduling Plugin
slug: cronjob-plugin
order: 41
eyebrow: Plugin reference
group: Plugin reference
---

# Scheduling Plugin

Open **Settings → Automation** to review and manage scheduled prompts. The optional `cronjob` plugin adds this page, five chat tools for creating and managing schedules, and the `elowen-scheduling` skill. For help choosing and creating a schedule, see [Scheduling](scheduling).

## Recurring jobs and one-shot wake-ups

Use `CronAdd` for work that repeats, such as `every 2h` or `daily 07:30`. A recurring job keeps running until paused or deleted. Use `ScheduleWakeup` to return to a conversation once, after a delay such as `in 20m` or at a time such as `at 18:30`. A wake-up runs once and then removes itself.

Personal jobs run with their owner's permissions and project policy. A personal recurring job created in a direct platform chat reports back to that chat; one created elsewhere has its own conversation for results. A one-shot wake-up returns to the conversation where it was created. A wake-up created in a shared room reports through the instance notification channel.

Instance jobs have no personal owner and run with instance-owner permissions. Only the instance owner can create them. They report through the notification channel unless an instance job specifies a destination channel.

## Review and manage jobs

Open **Settings → Automation** to see schedules, owners, active hours, check commands, prompts, models, status and recent results. You can pause or delete a job, queue an immediate run of a recurring job (Run now; one-shot wake-ups cannot be run manually), and use the schedule builder for interval, daily or weekly schedules. Advanced mode accepts five-field cron expressions. Changes usually apply within 30 seconds. The History tab keeps past runs with their outcome, and the job owner is alerted when a run fails or its result cannot be delivered.

`CronList` shows jobs available to you, their ids, schedules and latest run results. `CronRemove` permanently deletes a job or pending wake-up. Pause a recurring job if you may want to resume it later. Personal jobs are private to their owner; administrators can also see instance jobs.

## Tools

| Tool | What it does |
| --- | --- |
| `CronAdd` | Create a recurring prompt with a schedule, scope and filing conversation. |
| `ScheduleWakeup` | Schedule one wake-up that resumes its originating conversation. |
| `CronList` | List visible jobs and pending wake-ups. |
| `CronConversations` | List conversations where a recurring job may be filed. |
| `CronRemove` | Permanently remove a job by its id. |

A recurring job must include `scope` (`personal` or `instance`) and `conversationSessionId`. Get an eligible conversation id from `CronConversations`. Filing a job only groups it in the conversation list; it does not change its owner, permissions, execution project, or where results are delivered. A one-shot wake-up needs no filing conversation.

## Create a recurring job

Before adding a schedule, use `CronList` to check that it will not duplicate an existing job. Then call `CronConversations` to get an eligible filing conversation and pass its id explicitly to `CronAdd`; the current conversation is often right, but is never assumed. Personal jobs can only be filed under a conversation belonging to their owner. In a shared room, the listing does not expose private conversations.

Choose `scope: personal` for a reminder or recurring task that belongs to the person you are talking to. Personal recurring jobs created in a direct one-to-one platform chat return results there; jobs created from web chat or another conversation run in a dedicated conversation named after the job. The job's filing conversation is just where it appears in the conversation list. Do not use it to guess where results will be delivered.

For example, ask for a weekday morning summary of new work. Create a personal job with a schedule such as `daily 08:57`, include a prompt describing the summary, and file it under the conversation where the user wants to find the schedule later. The job waits for its next scheduled time after creation; it does not run immediately. To check back just once, use `ScheduleWakeup` with `in 20m` or `at 18:30` instead. It resumes the conversation it was created in, with its context.

Only the instance owner can use `scope: instance`. An instance job has no personal owner, runs with instance-owner permissions and sends results to the instance notification channel unless it specifies a destination channel. Personal jobs cannot set that destination.

## Install and grant access

Install `cronjob` from **Settings → Plugins → Available**. It requires Elowen 0.28.53 and shared API version 5. To let a non-admin account use its tools and skill:

1. Open **Users** and select the user.
2. Under **Granted plugins**, choose **Manage**.
3. Select `cronjob` and save.

Administrators always have access. Installing, enabling, disabling or saving plugin settings requests an Elowen restart, announced as **Restart**. If active work delays it, the plugin change is saved and the restart waits for that work to settle.

## Configuration

The plugin's settings are in **Settings → Plugins → cronjob**. Values are optional and use these defaults. The two section headings are not configurable values.

| Setting | Default | Allowed range |
| --- | --- | --- |
| Scheduler tick | 30 seconds | 10–120 seconds |
| Attempts after a temporary failure | 2 total | 1–5 |
| Retry delay | 3 seconds | 1–30 seconds |
| Check command time limit | 60 seconds | 10–300 seconds |
| Check output passed to the assistant | 32,000 characters | 2,000–200,000 |
| Missed cron catch-up window | 24 hours | 1 hour–7 days |
| Jobs per non-admin account | 20 | 1–200 |
| Shortest interval for a non-admin account | 15 minutes | 1–1,440 minutes |

## Schedule limits and missed runs

Schedules accept intervals such as `every 15m` and `every 2h`, daily and weekly times, or a standard five-field cron expression. The scheduler checks for due work every 30 seconds by default, so a new or changed schedule may take about half a minute to apply.

Non-admin personal accounts are limited to 20 jobs and, by default, a minimum recurring interval of 15 minutes. An ordinary personal job cannot use a host shell check or a destination channel; both need an admin-owned or instance job, while a check that runs inside a managed project is allowed on a personal job. A recurring job can name an execution project (Execution project) so its files and commands run there; managed-project schedules must be personal. Five-field cron schedules are reserved for the instance owner and sufficiently privileged accounts. Instance jobs are not subject to personal job limits.

An optional `check` command runs before the prompt. If it fails or prints nothing, the assistant is not called. Otherwise its output is included in the run. A check runs on the host or, when an execution project is selected, in that project.

Daily, weekly and cron schedules use the configured time zone. After downtime, a five-field cron schedule may run its most recent missed occurrence within the catch-up window; it does not replay a backlog. Daily and weekly schedules do not replay missed days, and intervals do not replay missed ticks. Active-hours windows such as `5-21` keep a job quiet outside those hours; overnight windows such as `22-5` are supported. These windows use whole hours only.

Intervals are duration-based; daily, weekly and cron schedules use local clock time. Weekly schedules accept weekday abbreviations from `sun` through `sat`. Five-field cron supports wildcards, values, ranges, steps, comma-separated lists, and named months and weekdays. Sunday may be `0` or `7`. If both day-of-month and day-of-week fields are restricted, either matching field is enough. During the autumn clock change, a repeated scheduled time runs once; a spring-forward time that does not exist is skipped for that day.

## Retries and delivery

Jobs are stored durably and survive daemon restarts. A recurring job can retry a temporary request failure before producing output, two attempts by default. If a run already did work, the plugin delivers the error instead of repeating possible side effects. One-shot wake-ups are not retried. If result delivery fails, the result is queued for another attempt without rerunning the prompt; up to 50 deliveries can wait at once, with the oldest dropped if the limit is exceeded. Delivered messages normally start with the job name. Set `plain: true` for a persona message in a dedicated channel; a run with nothing to report does not deliver a message.

[Next: Image Tools](image-tools)
