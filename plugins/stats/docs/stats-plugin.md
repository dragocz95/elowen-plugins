---
title: Usage Statistics
slug: stats-plugin
order: 46
eyebrow: Plugin reference
group: Plugin reference
---

# Usage Statistics

After installing the `stats` plugin, open **Statistics** in the Web UI navigation to review model usage, tracked cost, cache use and generation speed. The plugin adds a page, not chat tools.

## Read model usage statistics

Choose a date range to see total tokens, tracked cost, cache tokens and average generation speed. The page includes a model search, a usage filter for all usage, usage with cost, or usage with cache, charts for tokens and cost by model, a daily trend, and a model breakdown.

Select a model to see input and output tokens, cache reads and writes, cache hit rate, and whether its cost was calculated, reported by the provider or unavailable. Models without cost data do not appear in the cost chart. The model list has 20 rows per page by default. The selected date range is remembered for your next visit.

The daily trend covers at most the latest 90 days. If there is no usage in the selected range, the page shows an empty state; if the page cannot reach Elowen, it shows an error with a retry option.

## See usage by account or address

Administrators can switch between personal statistics and **Whole instance** usage. The **Consumption origin** view is administrator-only and ranks usage by account, address or account-and-address pair. You can sort by tokens or cost; these are separate rankings because the biggest token user may not be the highest cost.

Origin view also separates scheduled and internal runs, local access and chat channels. An address is verified only when the request passed through the configured reverse proxy. Otherwise it comes from the client and is shown as unverified. If Elowen is not behind that proxy, turn off **Trusted proxy** in environment settings. Addresses removed by data retention are labelled as removed. An address identifies a connection, not necessarily a person.

Origin totals use a separate counter from model and daily statistics. The page shows the date from which origin data is available; earlier usage is not included, so the totals may differ.

## Reset recorded usage

**Reset usage** is available to administrators in personal view. It permanently clears the signed-in administrator's recorded usage and origin data, not other accounts' data. Type `RESET` to confirm. Conversations and session transcripts remain available, but the recorded usage cannot be restored.

## Install and enable

Version 0.2.9 requires Elowen 0.28.53 or newer. Install **stats** from **Settings → Plugins → Available**. The plugin has no settings, chat tools or per-user grant. Each signed-in account sees its own model usage; administrators can also view whole-instance statistics and the origin breakdown.

Enabling, disabling, installing or changing a plugin restarts Elowen. The settings screen says, "Change saved. Elowen is restarting now to load it."

[Related: Usage & Costs](usage-costs) covers in-chat usage views available without this plugin.

[Next: Task List](todo-plugin)
