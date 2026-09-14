# skills

Loads markdown skills from disk and exposes the complete live skill catalog to the Elowen brain. The Skills page shows personal, instance, bundled and plugin-contributed skills; administrators can narrow plugin skill availability per account.

## Install

Install it from Settings -> Plugins -> Available in the Elowen web interface, or ask the assistant to install the `skills` plugin.

| | |
| --- | --- |
| Version | `0.4.0` |
| Requires core | `0.28.46` |
| Requires shared API | `not declared` |
| User-grantable | Yes |

## Tools

`ListSkills` shows the skills available in the session and `SkillLoad` loads one into the conversation. `CreateSkill` and `DeleteSkill` add and remove reusable instructions.

## Configuration

The manifest declares no settings fields. Personal and instance skill files retain their name, description, body and manual-only flag. Plugin-contributed skills are read-only artifacts; an administrator may select an account and set an explicit disabled override. Absence of an override means enabled, while plugin disablement and user grants still take precedence.

## Documentation

See the "Skills Plugin" page of the Elowen user manual (`docs/site/45-skills-plugin.md` in the Elowen repository).