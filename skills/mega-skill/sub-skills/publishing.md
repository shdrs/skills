# Publishing

How to make a skill work across every AI coding agent — not just the one you're building in.

## The problem

Each agent reads skills from a different directory and has different conventions:

| Agent | Skills directory | Command prefix |
|-------|-----------------|----------------|
| Claude Code | `.claude/skills/` | `/` |
| Cursor | `.cursor/skills/` | `/` |
| Gemini CLI | `.gemini/skills/` | `/` |
| Codex CLI | `.agents/skills/` | `$` |
| GitHub Copilot | `.github/skills/` | `/` |
| Kiro | `.kiro/skills/` | `/` |
| OpenCode | `.opencode/skills/` | `/` |
| Pi | `.pi/skills/` | `/` |
| Qoder | `.qoder/skills/` | `/` |
| Rovo Dev | `.rovodev/skills/` | `/` |
| Trae | `.trae/skills/` | `/` |
| Trae China | `.trae-cn/skills/` | `/` |

A skill authored for Claude Code won't work in Codex (different path, `$` prefix instead of `/`). Publishing solves this by compiling one canonical source into agent-specific variants.

## The solution: single source, many targets

Author the skill once in a canonical directory (e.g. `skills/my-skill/`). A build system compiles it into 13 agent-specific variants and places each in the correct directory.

### Template variables

Instead of hardcoding agent-specific values, use placeholders that the build resolves per agent:

| Variable | Claude Code | Codex | Gemini | Others |
|----------|-------------|-------|--------|--------|
| `{{model}}` | Claude | GPT | Gemini | the model |
| `{{command_prefix}}` | `/` | `$` | `/` | `/` |
| `{{applets_path}}` | `.claude/skills/x/scripts` | `.agents/skills/x/scripts` | `.gemini/skills/x/scripts` | ... |
| `{{config_file}}` | CLAUDE.md | AGENTS.md | GEMINI.md | — |
| `{{ask_instruction}}` | *(Claude phrasing)* | *(Codex tool-call)* | ask the user | ask the user |

Use these in SKILL.md and sub-skill files:

```markdown
## Setup

\```bash
node {{applets_path}}/load-context.mjs
\```

If context is missing, run `{{command_prefix}}my-skill teach` first.
```

The build replaces `{{applets_path}}` with `.claude/skills/my-skill/scripts` for Claude, `.agents/skills/my-skill/scripts` for Codex, etc.

### Provider-specific blocks

When an instruction only applies to certain agents, wrap it in provider tags:

```markdown
This appears for all agents.

<claude-code>
Use the AskUserQuestion tool to confirm.
</claude-code>

<codex>
Use the ask tool to confirm.
</codex>
```

The build strips blocks tagged for other providers. Valid tags: `claude-code`, `claude`, `cursor`, `gemini`, `codex`, `agents`, `github`, `kiro`, `opencode`, `pi`, `qoder`, `trae`, `trae-cn`, `rovo-dev`.

### Frontmatter per provider

Not every agent supports every frontmatter field. The build strips unsupported ones automatically:

| Field | Supported by |
|-------|-------------|
| `name`, `description` | All |
| `version` | All except codex, agents |
| `user-invocable` | claude-code, github, opencode, qoder, trae, trae-cn, rovo-dev |
| `argument-hint` | claude-code, github, opencode, qoder, trae, trae-cn, rovo-dev |
| `allowed-tools` | claude-code, opencode, pi, qoder, rovo-dev |
| `license` | All except codex, agents, gemini |

Write all fields you want in the canonical source — the build handles the rest.

## Build pipeline

The build system reads from the canonical source and for each provider:

```
SKILL.md
  → parse YAML frontmatter (keep only supported fields)
  → compileProviderBlocks(body, providerTags)
  → replacePlaceholders(body, provider)
  → write to dist/<provider>/<configDir>/skills/<name>/SKILL.md

sub-skills/*.md
  → same pipeline (provider blocks + placeholders)
  → write to dist/<provider>/<configDir>/skills/<name>/sub-skills/*.md

applets/*
  → copy verbatim (NO transformation)
  → write to dist/<provider>/<configDir>/skills/<name>/applets/*
```

After building, sync each provider's output to the committed harness directory at the repo root. These committed dirs mean users get native-format skills without running any build.

## Marketplace registration (Claude Code)

Claude Code has a plugin marketplace system. To make a skill installable:

### 1. Create a marketplace manifest

`.claude-plugin/marketplace.json` at repo root:

```json
{
  "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
  "name": "your-marketplace-name",
  "owner": { "name": "Your Name" },
  "plugins": [
    {
      "name": "my-skill",
      "description": "What it does",
      "version": "1.0.0",
      "author": { "name": "Your Name" },
      "source": "./plugins/my-skill",
      "category": "productivity",
      "tags": ["tag1", "tag2"]
    }
  ]
}
```

### 2. Create the plugin directory

```
plugins/my-skill/
├── .claude-plugin/
│   └── plugin.json
└── skills/
    └── my-skill/...    ← Claude Code variant from dist/
```

`plugin.json`:

```json
{
  "name": "my-skill",
  "description": "What it does",
  "version": "1.0.0",
  "skills": "./skills/"
}
```

### 3. Users install via

```
/plugin marketplace add owner/repo
/plugin install my-skill@marketplace-name
```

## Other distribution channels

### Git clone / submodule

Since all 13 harness directories are committed, users can clone or submodule the repo directly. Every agent finds its skills in its native directory automatically.

### npm

Publish a CLI that handles skill installation:

```bash
npx your-package skills install    # copies skills into local harness dirs
npx your-package skills update     # updates to latest
```

## Checklist

When applying multi-agent publishing to a skill:

- [ ] All agent-specific values use template variables, not hardcoded strings
- [ ] Provider-specific blocks tagged correctly
- [ ] Build runs successfully for all 13 providers
- [ ] `claude plugin validate .` passes
- [ ] Plugin entry in marketplace.json
- [ ] Plugin directory created with plugin.json
- [ ] All harness directories committed
