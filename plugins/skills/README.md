# skills

Loads markdown skills from disk and exposes them to the Elowen brain, with instance-wide, personal and bundled skills managed from a Settings page.

## Install

Install it from Settings -> Plugins -> Available in the Elowen web interface, or ask the assistant to install the `skills` plugin.

| | |
| --- | --- |
| Version | `0.3.6` |
| Requires core | `0.28.23` |
| Requires shared API | `not declared` |
| User-grantable | Yes |

## Tools

`ListSkills` shows the skills available in the session and `SkillLoad` loads one into the conversation. `CreateSkill` and `DeleteSkill` add and remove reusable instructions.

## Configuration

The manifest declares no settings fields. Skills themselves carry the configuration: each has a name, a one-line description, its body and whether the model may select it automatically.

## Documentation

See the "Skills Plugin" page of the Elowen user manual (`docs/site/45-skills-plugin.md` in the Elowen repository).