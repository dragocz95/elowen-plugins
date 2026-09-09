# cronjob

Wakes the agent on a schedule: recurring jobs on interval, daily, weekly or raw cron schedules and one-shot wake-ups, each run as its own turn with per-account limits and delivery to a chosen conversation or channel.

## Install

Install it from Settings -> Plugins -> Available in the Elowen web interface, or ask the assistant to install the `cronjob` plugin.

| | |
| --- | --- |
| Version | `0.4.7` |
| Requires core | `0.28.35` |
| Requires shared API | `4` |
| User-grantable | Yes |

## Tools

`CronAdd` creates a recurring job or a one-shot wake-up, `CronList` shows the scheduled jobs with their state, `CronRemove` deletes one, `CronConversations` lists the conversations a recurring job can be filed under and `ScheduleWakeup` sets a single future wake-up for the agent itself.

## Configuration

No field is required. The 8 optional settings tune the scheduler with `tickMs`, retry attempts and backoff, the guard-check timeout and output limit and the missed-run catch-up window, and set the per-account limits `maxJobsPerUser` and `minIntervalMinutes`. No field is a secret.

## Documentation

See the "Scheduling Plugin" page of the Elowen user manual (`docs/site/41-cronjob-plugin.md` in the Elowen repository).