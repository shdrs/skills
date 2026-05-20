---
name: mega-skill
description: "Use alongside any skill-creation workflow. Triggers when the user is creating, designing, or architecting a new skill and could benefit from advanced structural patterns. Covers three opt-in concepts: applets (shipping executable code with a skill), multi-agent publishing (making a skill work across Claude, Codex, Gemini, Cursor, and 9+ other agents), and the mega-skill architecture (one slash command that routes to many sub-skills). Also covers pinning (promoting sub-commands to standalone shortcuts). This is an addon — it does not replace skill-creation tools like skill-creator, it extends them with architectural patterns. Use whenever someone mentions creating skills, skill architecture, multi-agent skills, skill scripts, skill publishing, or structuring a skill with sub-commands."
user-invocable: true
argument-hint: "[applets|publishing|one-mega-skill|pinning]"
license: MIT
---

Adds opt-in architectural patterns on top of any skill-creation workflow. This is an addon, not a replacement — the actual skill-creation process (drafting, testing, iterating) belongs to whatever skill-creator plugin is active.

## When this skill activates

You are in a session where the user is creating or designing a skill. Another skill-creation tool (like the official `skill-creator`) may already be loaded and driving the process. Your role is to offer structural upgrades at the right moment — not to take over.

## How to use this skill

### If the user invoked you directly

They typed `/mega-skill` or `/mega-skill <sub-skill>`. If they specified a sub-skill, load it immediately. If not, assess their context and ask which patterns they need (see the assessment flow below).

### If you activated alongside a skill-creation session

Wait for the right moment. Don't interrupt the initial intent-capture or drafting phase. Once the skill's purpose is clear and the conversation turns to structure or architecture, step in with:

> "I notice you're building a skill. There are a few architectural patterns that could help — want me to walk through which ones apply?"

Then run the assessment.

## Assessment flow

Ask these questions based on what you already know from the conversation. Skip any that the context already answers. Use natural language, not a form.

### 1. Does this skill need to run code?

Look for signals: the skill analyzes files, detects patterns, loads project context, injects browser scripts, starts dev servers, or does anything that benefits from deterministic execution rather than LLM reasoning.

If yes → load [sub-skills/applets.md](sub-skills/applets.md)

### 2. Should this skill work across multiple agents?

Most skills start as personal tools for one agent. But if the user wants to publish, share with a team, or support users on different platforms, the skill needs multi-agent support.

If yes → load [sub-skills/publishing.md](sub-skills/publishing.md)

### 3. Does this skill have many related capabilities?

Look for signals: the user describes multiple commands, workflows, or modes that share context and setup. If the skill has 3+ distinct operations that belong together, the mega-skill architecture avoids slash-menu pollution.

If yes → load [sub-skills/one-mega-skill.md](sub-skills/one-mega-skill.md)

This sub-skill will also ask whether the user wants pinning support. If they do, load [sub-skills/pinning.md](sub-skills/pinning.md) alongside it.

### 4. Does the user want pinning independently?

Even without the mega-skill architecture, pinning can be useful — for example, creating shortcut aliases for any skill. If the user asks for it directly, load it.

If yes → load [sub-skills/pinning.md](sub-skills/pinning.md)

## Routing rules

1. **No argument**: Run the assessment flow above.
2. **Argument matches a sub-skill** (`applets`, `publishing`, `one-mega-skill`, `pinning`): Load that sub-skill directly.
3. **Argument doesn't match**: Treat it as context for the assessment — the user is describing what they need, not naming a sub-skill.

## What this skill does NOT do

- It does not teach how to write SKILL.md frontmatter, body content, or test cases. That's the skill-creator's job.
- It does not replace the draft → test → iterate loop. It adds structure to whatever the skill-creator produces.
- It does not force any pattern. Every concept is opt-in. A skill with none of these patterns is perfectly valid.

## Sub-skills

| Sub-skill | What it adds | When to use |
|-----------|-------------|-------------|
| `applets` | Executable scripts shipped with the skill | Skill needs to run code (analyzers, loaders, tools) |
| `publishing` | Multi-agent template system + marketplace registration | Skill should work on Claude, Codex, Gemini, Cursor, etc. |
| `one-mega-skill` | Single entry point routing to many sub-skills | Skill has 3+ related commands sharing context |
| `pinning` | Shortcut promotion for frequently-used commands | User wants `/audit` instead of `/my-skill audit` |
