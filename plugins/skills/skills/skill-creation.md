---
name: skill-creation
description: "Use when creating, improving, testing, listing or deleting a skill in Elowen: capturing a workflow from the conversation as a skill, writing a description that triggers reliably, structuring the body, evaluating a draft with sub-agents, and the CreateSkill/ListSkills/DeleteSkill tools, storage and reload behaviour."
---

# Skills in Elowen

A skill is a reusable Markdown procedure the model loads when a task matches its description. This
file covers both halves: the craft of writing one that works across many future conversations, and
the mechanics of how Elowen stores, loads and applies it.

## Create, list, delete

Use `CreateSkill`, never a hand-written file. It serializes the frontmatter through a YAML library, so
a description containing `: ` or a leading `#` stays valid; a hand-built file with the same text loads
with no description and is never triggered.

- `name` — kebab-case, specific: `deploy-checklist`, `weekly-report-format`.
- `description` — ONE line, the trigger (see below).
- `content` — the body.
- `scope` — `personal` (the account you are talking to) or `instance` (every session, owner only).
  A person describing their own procedure wants `personal`, even when they are an admin.

`ListSkills` shows the catalog; check it first and extend an existing skill instead of adding a
near-duplicate. Writing an existing personal skill with the same name overwrites it, which is how a
skill is edited. `DeleteSkill` needs the user's explicit confirmation.

## Where they live and when they apply

- **User skills** — written by `CreateSkill` into the skills plugin data directory (per account, or
  the instance set). `<name>.md` and `<name>/SKILL.md` are both recognised.
- **Plugin skills** — shipped inside a plugin's `skills/` folder, authored in plugin code.

Every skill's name and description sit in the system prompt of each conversation, so a skill is a
standing cost as well as a capability. That is the argument against creating one for a task done
once. A new or changed skill is applied live: the host reloads plugins once the current turn settles
and the skill appears in the available-skills list from the next message. Bodies are loaded only on
demand through `SkillLoad`, so the body can be long while the description must stay short.

After creating one, tell the user its name and one-line description and that it is available from
the next message.

## Capture the intent

The conversation often already contains the workflow ("turn this into a skill"). Extract it from the
history first: the tools that were used, the order of steps, the corrections the user made, the input
and output shapes. Then fill the gaps with the user before writing:

1. What should the skill enable the model to do?
2. When should it trigger? Which phrases and contexts?
3. What does the output look like?
4. Is the result objectively checkable (file transforms, fixed workflows, data extraction) or a matter
   of taste (writing style, design)? The first kind benefits from test runs, the second usually does
   not. Suggest the default, let the user decide.

Match the user's vocabulary: "evaluation" is fine, "assertion" and "JSON" need cues that they know
the terms.

## Write the description

The description is the only thing the model sees before deciding to load the skill, so it carries
ALL of "when to use"; the body never repeats it. Models tend to under-trigger, so be a little pushy:
name the situations, the artefacts and the phrases that should activate it, including ones where the
user does not use the skill's own word. "How to build an internal dashboard" is weak; "How to build an
internal dashboard. Use whenever the user mentions dashboards, metrics, charts or wants to display
company data, even without saying 'dashboard'" triggers.

## Write the body

Keep it lean and explain the why. Today's models have good theory of mind: an instruction whose
reason is stated is followed in cases the author never listed, whereas ALWAYS/NEVER in capitals and
rigid templates are a yellow flag that the reasoning is missing. Use the imperative. Include what
"done" looks like, exact tool names, known pitfalls, and one or two examples when the output shape
matters:

```markdown
## Commit message format
Input: Added user authentication with JWT tokens
Output: feat(auth): implement JWT-based authentication
```

Progressive disclosure: the description is always in context, the body only when loaded, so a body
under ~500 lines is the aim; beyond that split by variant (`references/aws.md`, `references/gcp.md`)
and tell the reader which file to open when. Bundled helper scripts belong beside the skill when
several runs would otherwise reinvent the same helper.

Keep out secrets and credentials (configuration belongs in plugin settings) and transient state
("X is currently broken"); a skill should stay true. A skill's content must not surprise the user if
described to them.

## Test a draft

Skip this when the user says so or the output is subjective. Otherwise write two or three realistic
prompts a real user would say, confirm them with the user, and run each twice in the same turn with
`Delegate`: one child told to load the skill, one baseline (no skill, or the previous version when
improving). Save outputs under a scratch directory per iteration and read the transcripts, not only
the final files. Draft objective checks while the runs are in progress and explain them to the user.

Improving after feedback:

1. Generalise. The skill will be used on prompts nobody tested; a fix that only helps the three
   examples is overfitting. Try a different framing before adding a constraint.
2. Remove what does not pull its weight, especially anything the transcripts show wasting steps.
3. Turn terse feedback into an explained reason in the text, not a louder MUST.
4. If every run wrote the same helper, bundle it once.

Rerun the same prompts against the new draft and stop when the user is happy, the feedback is empty,
or the iterations stop moving.
