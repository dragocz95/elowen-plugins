# cronjob

Scheduled prompts: recurring jobs and one-shot wake-ups. Personal schedules run with their owner's rights; instance automation runs with owner powers.

## Install

Install it from Settings -> Plugins -> Available in the Elowen web interface, or ask the assistant to install the `cronjob` plugin.

| | |
| --- | --- |
| User-grantable | Yes |

This plugin's version, minimum core version and shared-API requirement are stated in `elowen-plugin.json` in this folder and published in `registry.json`; they are deliberately kept out of this file so it cannot go stale.

## Tools

CronAdd, ScheduleWakeup, CronList, CronRemove, CronConversations.

## Configuration

tickMs, retryAttempts, retryBackoffMs, checkTimeoutMs, checkOutputChars, cronLookbackMs, maxJobsPerUser, minIntervalMinutes.

## Documentation

See the [cronjob page in the Elowen user manual](https://github.com/dragocz95/elowen/blob/main/docs/site/41-cronjob-plugin.md).
