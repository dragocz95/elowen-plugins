# whatsapp

Runs a WhatsApp bot over a paired phone that answers from Elowen in direct and group chats, with text commands, a numbered per-chat model menu, live progress traces, status reactions and sender policies that map senders to access.

## Install

Install it from Settings -> Plugins -> Available in the Elowen web interface, or ask the assistant to install the `whatsapp` plugin.

| | |
| --- | --- |
| Version | `0.2.17` |
| Requires core | `0.28.11` |
| Requires shared API | `4` |
| User-grantable | No |

## Tools

`WhatsappSend` sends a message to any chat, `WhatsappGroupList` and `WhatsappGroupInfo` list and inspect groups, and `WhatsappGroupCreate`, `WhatsappGroupAdd` and `WhatsappGroupRemove` create groups and manage their members.

## Configuration

No field is required. The 16 optional settings cover pairing by phone number, allowed groups and the notification chat, reply behavior and the live progress trace, vision and media limits, the open-question timeout and the sender policies that admit senders. No field is a secret; pairing happens by QR code or pairing code from the plugin's Settings screen.

## Documentation

See the "Chat Platform Plugins" page of the Elowen user manual (`docs/site/37-chat-platform-plugins.md` in the Elowen repository).