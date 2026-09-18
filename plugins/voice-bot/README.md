# voice-bot

Outbound telephone calls through a configurable voice API. VoiceCall dials a real phone number and hands the conversation to a voice agent briefed by the call prompt.

## Install

Install it from Settings -> Plugins -> Available in the Elowen web interface, or ask the assistant to install the `voice-bot` plugin.

| | |
| --- | --- |
| User-grantable | Yes |

This plugin's version, minimum core version and shared-API requirement are stated in `elowen-plugin.json` in this folder and published in `registry.json`; they are deliberately kept out of this file so it cannot go stale.

## Tools

VoiceCall.

## Configuration

apiUrl, apiToken, maxCallsPerHour, callTimeoutSeconds, defaultInitMessage.

## Documentation

See the [voice-bot page in the Elowen user manual](https://github.com/dragocz95/elowen/blob/main/docs/site/48-voice-bot-plugin.md).
