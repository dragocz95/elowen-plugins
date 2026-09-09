# stats

Reports model usage analytics for tokens, cost, cache efficiency and generation speed, drawn from Elowen's shared usage ledger and presented on a Statistics page in the web interface.

## Install

Install it from Settings -> Plugins -> Available in the Elowen web interface, or ask the assistant to install the `stats` plugin.

| | |
| --- | --- |
| Version | `0.2.4` |
| Requires core | `0.28.21` |
| Requires shared API | `not declared` |
| User-grantable | No |

## Tools

This plugin provides no model tools. It adds the Statistics page with totals and per-model breakdowns, a daily trend for the latest 90 days and a consumption-origin view.

## Configuration

The manifest declares no settings fields. Recorded usage can be reset from the Statistics page.

## Documentation

See the "Usage Statistics" page of the Elowen user manual (`docs/site/46-stats-plugin.md` in the Elowen repository).