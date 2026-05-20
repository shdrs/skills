# mega-skill

Architectural patterns for skill creators. Works as an addon alongside any skill-creation plugin (like Anthropic's official `skill-creator`).

## Install

```
/plugin marketplace add shdrs/skills
/plugin install mega-skill@shdrs-skills
```

## What it does

When you're creating a skill, mega-skill offers four opt-in structural upgrades:

| Sub-skill | What it adds | When to use |
|-----------|-------------|-------------|
| `applets` | Executable scripts shipped with the skill | Skill needs to run code (analyzers, context loaders, dev servers) |
| `publishing` | Multi-agent template system + marketplace registration | Skill should work across Claude, Codex, Gemini, Cursor, and 9+ other agents |
| `one-mega-skill` | Single entry point routing to many sub-skills | Skill has 3+ related commands sharing context |
| `pinning` | Shortcut promotion for frequently-used commands | User wants `/audit` instead of `/my-skill audit` |

## Usage

### Direct invocation

```
/mega-skill              # runs assessment flow — asks which patterns apply
/mega-skill applets      # loads applets sub-skill directly
/mega-skill publishing   # loads publishing sub-skill directly
```

### Auto-activation

mega-skill also triggers automatically when it detects you're in a skill-creation session. It waits until the skill's purpose is clear, then offers to walk through which patterns apply.

## How it works with skill-creator

mega-skill does not replace skill-creator. It extends it. The skill-creator handles the draft-test-iterate loop. mega-skill steps in when structure decisions come up:

- Should this skill ship scripts? → applets
- Should this skill work on other agents? → publishing
- Should this skill consolidate multiple commands? → one-mega-skill
- Should users get shortcut aliases? → pinning

Every pattern is opt-in. A skill with none of them is perfectly valid.

## Agent support

mega-skill is published to all 13 supported agents:

| Agent | Directory |
|-------|-----------|
| Claude Code | `.claude/skills/` |
| Cursor | `.cursor/skills/` |
| Gemini CLI | `.gemini/skills/` |
| Codex CLI | `.agents/skills/` |
| GitHub Copilot | `.github/skills/` |
| Kiro | `.kiro/skills/` |
| OpenCode | `.opencode/skills/` |
| Pi | `.pi/skills/` |
| Qoder | `.qoder/skills/` |
| Rovo Dev | `.rovodev/skills/` |
| Trae | `.trae/skills/` |
| Trae China | `.trae-cn/skills/` |

For non-Claude agents, clone or submodule this repo and the agent picks up the skill from its native directory.
