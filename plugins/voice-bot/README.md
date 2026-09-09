# voice-bot

Places outbound telephone calls through a configurable voice API: the agent dials a real number and a voice agent briefed by the call's prompt speaks on the line.

## Install

Install it from Settings -> Plugins -> Available in the Elowen web interface, or ask the assistant to install the `voice-bot` plugin.

| | |
| --- | --- |
| Version | `0.1.1` |
| Requires core | `not declared` |
| Requires shared API | `not declared` |
| User-grantable | Yes |

## Tools

`VoiceCall` dials a phone number with a prompt and an optional opening sentence and reports the call's outcome.

## Configuration

Two fields are required: `apiUrl`, the call endpoint, and `apiToken`, a write-only bearer token that is never logged or returned to the agent. Optional fields cap calls per hour and a single call's length and set a default opening sentence. The manifest declares 5 settings fields in total; without the connection fields the tool is not offered at all.

## Documentation

See the "Voice Calls" page of the Elowen user manual (`docs/site/48-voice-bot-plugin.md` in the Elowen repository).