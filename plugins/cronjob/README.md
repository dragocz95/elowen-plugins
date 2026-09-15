# cronjob

Scheduled prompts: recurring jobs and one-shot wake-ups. Personal schedules run with their owner's rights; instance automation runs with owner powers.

## Install

Install it from Settings -> Plugins -> Available in the Elowen web interface, or ask the assistant to install the `cronjob` plugin.

| | |
| --- | --- |
| Version | `0.5.3` |
| Requires core | `0.28.46` |
| Requires shared API | `4` |
| User-grantable | Yes |

## Tools

CronAdd, ScheduleWakeup, CronList, CronRemove, CronConversations.

## Configuration

tickMs, retryAttempts, retryBackoffMs, checkTimeoutMs, checkOutputChars, cronLookbackMs, maxJobsPerUser, minIntervalMinutes.

## Documentation

See the [cronjob page in the Elowen user manual](https://github.com/dragocz95/elowen/blob/main/docs/site/41-cronjob-plugin.md).
