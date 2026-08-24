---
name: skill-creation
description: Use when creating, listing or deleting a skill in Elowen — the CreateSkill/ListSkills/DeleteSkill tools, where skills are stored, and when a new one starts taking effect. Load this before writing skill files by hand.
---

# Skills in Elowen

This is the mechanics: the tools, the storage, and when a skill goes live. For the CRAFT of writing a
good skill — structure, tuning a description so it triggers reliably, evals — load the `skill-creator`
skill if this instance has it, and follow it. What this file adds is the part `skill-creator` cannot
know: Elowen creates skills through a TOOL, not by writing files into a directory.

## Create, list, delete

Use `CreateSkill` (admin only), never a hand-written file:

- `name` — kebab-case, specific: `deploy-checklist`, `weekly-report-format`.
- `description` — ONE line. It is all the model sees before deciding to load the skill, so state the
  triggering conditions explicitly.
- `content` — the body: numbered steps, exact tool names, known pitfalls, what "done" looks like.

`ListSkills` shows the catalog; check it before adding, and extend an existing skill rather than
creating a near-duplicate. `DeleteSkill` needs the user's explicit confirmation.

## Where they live

- **User skills** — created by `CreateSkill`, stored in the skills plugin's data directory. Yours go here.
- **Plugin skills** — shipped inside a plugin's `skills/` folder (`<name>.md` or `<name>/SKILL.md`),
  authored in plugin code rather than at runtime.

## What to keep out

Never put secrets or credentials in a skill — configuration belongs in plugin settings. Avoid transient
state ("X is currently broken"); a skill should stay true.

## When it takes effect

Every skill's name and description sit in the system prompt of each NEW conversation, so a skill is a
standing cost as well as a capability — that is the real argument against creating one for a task you
did once. A new skill reaches new conversations only after the plugins reload (Settings → Plugins
toggle, or a daemon restart); it never appears mid-conversation.

After creating one, tell the user its name, its one-line description, and that it activates in new
conversations after a reload.
