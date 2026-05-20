# One Mega-Skill

How to structure a skill as a single entry point that routes to many sub-skills — instead of publishing each capability as a separate slash command.

## The problem it solves

A skill with 10+ capabilities published as 10 separate skills pollutes the slash menu. Every installed skill adds a line to the agent's skill list, and the agent reads every description on every prompt to decide what to activate. Ten skills means ten descriptions competing for attention.

The mega-skill pattern consolidates everything under one command. Instead of `/my-skill-audit`, `/my-skill-polish`, `/my-skill-extract`, the user gets `/my-skill audit`, `/my-skill polish`, `/my-skill extract` — one entry in the slash menu, many capabilities behind it.

## When to use this

- The skill has **3+ related capabilities** that share context, setup steps, or design principles.
- The capabilities form a coherent domain (design tools, testing tools, deployment tools) — not a grab-bag.
- Users will typically use several capabilities in one session.

When NOT to use this:
- Each capability is independent and unrelated.
- There are only 1-2 commands — the overhead isn't worth it.
- Different capabilities need different descriptions for activation (they trigger on different contexts).

## Structure

```
my-skill/
├── SKILL.md                        # master router
├── sub-skills/                     # one file per capability
│   ├── audit.md
│   ├── polish.md
│   ├── extract.md
│   └── ...
└── applets/
    └── command-metadata.json       # sub-command registry
```

## The master SKILL.md

The master file has three jobs: setup, routing, and the commands table.

### Frontmatter

```yaml
---
name: my-skill
description: "Exhaustive list of everything this skill handles. Every capability, every domain, every keyword a user might say. End with what it does NOT handle. The description must be comprehensive because it's the only thing agents see when deciding to activate."
argument-hint: "[{{command_hint}}] [target]"
user-invocable: true
---
```

`{{command_hint}}` auto-populates from `command-metadata.json` — it becomes the grouped list of sub-commands shown in the argument hint.

### Setup section

Shared setup that runs before any sub-command. This is the key advantage of the mega-skill pattern — setup runs once, not per-command.

```markdown
## Setup

Before any work:
1. Load context via the loader script.
2. Identify which sub-command the user wants.
3. **Load the matching sub-skill file.** Non-negotiable — each sub-skill contains the actual instructions.
```

### Commands table

```markdown
## Commands

| Command | Category | Description | Sub-skill |
|---------|----------|-------------|-----------|
| `audit [target]` | Evaluate | Technical quality checks | [sub-skills/audit.md](sub-skills/audit.md) |
| `polish [target]` | Refine | Final quality pass | [sub-skills/polish.md](sub-skills/polish.md) |
| `extract [target]` | Build | Pull reusable patterns | [sub-skills/extract.md](sub-skills/extract.md) |
```

### Routing rules

```markdown
### Routing rules

1. **No argument**: Render the commands table above. Ask what they'd like to do.
2. **First word matches a command**: Load its sub-skill file and follow its instructions. Everything after the command name is the target.
3. **First word doesn't match**: General invocation — apply setup and shared principles, using the full argument as context.
```

## Writing sub-skill files

Each sub-skill is a complete set of instructions for one capability:

```markdown
# Audit Flow

Technical quality checks for accessibility, performance, and responsive behavior.

## Step 1: Scan

Run the detector on the target files...

## Step 2: Evaluate

For each finding, assess severity...

## Step 3: Report

Present findings grouped by category...

**NEVER**:
- Don't report false positives without verification
- Don't fix issues without showing them first
```

Sub-skill files go through the same template resolution as SKILL.md (template variables, provider blocks) if multi-agent publishing is enabled.

## Command metadata

`applets/command-metadata.json` registers every sub-command:

```json
{
  "commands": {
    "audit": { "category": "Evaluate", "description": "Technical quality checks" },
    "polish": { "category": "Refine", "description": "Final quality pass" },
    "extract": { "category": "Build", "description": "Pull reusable patterns" }
  }
}
```

This feeds:
- `{{command_hint}}` → grouped by category with ` · ` separators (shown in `argument-hint`)
- `{{available_commands}}` → full prefixed command list (for use in the body)

## Pinning support

If this skill has sub-commands that users invoke frequently, consider adding pinning support. Pinning lets users promote `/my-skill audit` to just `/audit` as a standalone shortcut.

This is a separate opt-in pattern. If you want pinning, also load the pinning sub-skill — it covers the mechanics of the pin/unpin system.

Expose pin/unpin in the master SKILL.md:

```markdown
## Pin / Unpin

**Pin** creates a standalone shortcut so `{{command_prefix}}<command>` invokes
`{{command_prefix}}my-skill <command>` directly. **Unpin** removes it.

\```bash
node {{applets_path}}/pin.mjs pin <command>
node {{applets_path}}/pin.mjs unpin <command>
\```
```

## Shared context and design principles

The mega-skill's greatest strength is shared context. Put domain-wide principles, constraints, and design laws in the master SKILL.md — they apply to every sub-command without repetition.

```markdown
## Shared principles

These apply to every command in this skill:

### Rule 1: ...
### Rule 2: ...
### Rule 3: ...
```

Sub-skills inherit this context because the agent always loads the master SKILL.md first, then the specific sub-skill on top.

## Checklist

- [ ] Master SKILL.md has comprehensive description covering ALL sub-commands
- [ ] Every sub-command has a matching sub-skill file
- [ ] Commands table links to every sub-skill file
- [ ] Routing rules cover: no arg, match, no match
- [ ] `command-metadata.json` lists every sub-command
- [ ] Shared setup/principles live in the master, not duplicated in sub-skills
- [ ] Consider pinning for frequently-used sub-commands
