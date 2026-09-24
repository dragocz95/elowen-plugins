---
title: Skills Plugin
slug: skills-plugin
order: 45
eyebrow: Plugin reference
group: Plugin reference
---

# Skills Plugin

Open **Settings → Plugins → Skills** to add, edit or delete reusable instructions. In chat, use `/skills` to open the picker or `/skill:name` to load a particular skill. See [Skills](skills) for the full file format and guidance on writing skills.

## Discover and load skills

A skill is a name, a one-line description and a Markdown body. Elowen sees the name and description first; it loads the full instructions only when they apply or you select one. `ListSkills` shows skills available in the current session; `SkillLoad` loads one by exact name. If a name is unavailable or misspelled, check `ListSkills` rather than guessing. If a skill asks for input, pass it to `SkillLoad`; quoted phrases stay together. The `/skills` picker can also load a skill into the conversation.

By default, an eligible skill can be selected automatically when it applies. Turn off **Use automatically** to make it manual-only: Elowen will not choose it automatically, but you can still load it with `/skill:name` or the picker. A skill without a description can still be loaded by exact name, but is not available for automatic selection.

Changes made to skills apply from the next message, without restarting Elowen. An already-running turn is not rewritten. If a saved change cannot be applied immediately, Elowen reports that it will take effect after the next restart.

## Create, update or delete a skill

`CreateSkill` saves a reusable skill for later conversations. It requires choosing `personal` or `instance`; only administrators can write instance-wide skills. Creating a personal skill with a name that already exists in your personal set updates it. Use `ListSkills` to check the exact name before `DeleteSkill`, which permanently removes a saved skill. Deleting a folder-based skill keeps its supporting files. The plugin also provides these tools in addition to its Web UI manager.

A custom skill is either a flat Markdown file or a folder containing `SKILL.md`; either can include supporting files. Names use lowercase letters, digits and dashes, are limited to 64 characters, and also determine the file name.

## Choose who can use a skill

A personal skill belongs to one account and is available only in that account's conversations. An instance skill is shared across the Elowen instance and requires administrator authority to create or change. If a personal and instance skill have the same name, the personal one takes precedence. Bundled skills are read-only; a custom skill cannot replace a bundled skill or another skill in the same scope.

An account without a linked user identity sees only instance skills. Skills contributed by other enabled plugins appear in the same catalog and load through `SkillLoad`. A contributed skill is available only when its plugin is enabled and, if that plugin is user-grantable, granted to the account. Changes to plugin grants, plugin availability or skill ownership appear in the catalog on a later turn. Administrators can manage instance-wide skills and, where appropriate, other accounts' custom skills; ordinary accounts manage their own personal skills.

A skill describes a procedure; it does not give the account any new permissions. Prompt fragments, slash commands and hooks supplied by plugins are not filtered by a plugin grant.

## Install and grant the Skills plugin

Install **skills** from **Settings → Plugins → Available**. Version 0.5.1 requires Elowen 0.28.52 or newer. The plugin is user-grantable, so a non-administrator needs an administrator to grant it under **Users → Granted plugins** before using its tools, manager or skill catalog. Administrators retain access. Account tool policy can still deny `SkillLoad` independently.

Enabling, disabling, installing or changing a plugin restarts Elowen. The settings screen says, "Change saved. Elowen is restarting now to load it." Saving a skill is different: it applies from the next message without a restart.

The plugin has no configuration fields. Its files are read only from the registered skill directory; a load outside that directory is refused. Moving a skill between personal and instance scopes moves its file to the other set. If the plugin cannot apply a saved skill update immediately, it tells you the change is saved and will apply on the next restart.

[Next: Usage Statistics](stats-plugin)
