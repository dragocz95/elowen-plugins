---
title: Voice Calls
slug: voice-bot-plugin
order: 48
eyebrow: Plugin reference
group: Plugin reference
---

# Voice Calls

Install **voice-bot** from **Settings → Plugins → Available**, then configure its call service and grant access to the accounts that should place calls. The plugin makes real outbound calls; the person's phone may ring within seconds, and a placed call cannot be cancelled or undone.

## Set up the voice service

In the plugin's settings, enter:

- **Call endpoint**: the full URL for your voice service. HTTP and HTTPS are accepted.
- **API token**: the service's bearer token. It is sent as an `Authorization: Bearer` header, never written to a log line, and never returned to the agent, not even in an error.

Both fields are required before the `VoiceCall` tool is offered. The plugin requires Elowen 0.28.50 or newer. Saving plugin settings restarts Elowen, so the updated configuration takes effect after restart.

Your service must accept a POST request and keep it open until the call ends. It should return a JSON result with whether the call was answered and, when available, the duration, service status and transcript.

## Allow accounts to place calls

The plugin is user-grantable. An administrator can grant it to an account under **Users → Granted plugins**; administrators can use it without a grant. Account tool permissions can still restrict access.

There is no per-call confirmation and no allow-list of phone numbers. The configured hourly limit is the only automatic brake on repeated calls. Before using the tool, confirm that the user gave the number or explicitly asked Elowen to look it up. If there is any doubt, ask and repeat the number back. Never guess a number or automatically redial after an uncertain result.

## Place a call

The number must be in international E.164 format: a leading plus sign, country code and digits only, 8 to 15 digits total. For example, a Czech number can look like `+420123456789`. Invalid numbers are rejected before a call is attempted.

The tool sends the number as `phone_number`, your instructions as `prompt`, and the optional opening line as `init_message`. The `prompt` field contains instructions for the voice agent, written in the language the person speaks. Explain what to ask or tell them and how the agent should behave. For example: Ask whether Tuesday at 3 p.m. works for the appointment, and thank the person for their time. This is not the sentence spoken aloud. The prompt is limited to 4,000 characters. The optional `init_message` is spoken first when the person answers; if omitted, the plugin uses **Default opening sentence** from its settings, if set. If no opening sentence is configured, the voice service opens the call.

The tool waits while the service handles the call, usually tens of seconds, then returns the outcome and transcript when available. It is not a quick acknowledgement followed by a separate status check.

## Call limits and failures

| Setting | Default | Allowed range |
| --- | --- | --- |
| Maximum calls per hour | 10 | 1–200 |
| Longest call | 300 seconds | 60–1,800 seconds |

The hourly limit counts calls started in any rolling 60-minute window. Failed calls count too, and the count survives a restart. When the limit is reached, the tool refuses without making a call and reports roughly when another call will be allowed.

If the service rejects the request or cannot be reached, the tool reports the failure and says no call was placed. If the request times out, the outcome is **unknown**: the service may have received the request and the phone may already have rung. Do not retry automatically; check with the person first. The call-length setting is not just a connection timeout. Setting it too low can leave a real call with an unknown outcome.

## Call records

The plugin records each call before sending its request, including the account, conversation, number and instructions. Failed and uncertain calls are recorded too, so they count toward the hourly limit. Completed calls retain the service response and transcript, up to 8,000 characters. Deleting the account that made a call deletes its call records.

[Back to start](getting-started)
