# shdrs/skills

A marketplace of agent-agnostic skills for Claude Code, Cursor, Gemini, Codex, and 9+ other agents.

## Local development

```bash
node scripts/build.mjs          # build all skills for all providers
rm -rf dist && node scripts/build.mjs   # clean rebuild
```

After pushing changes, invalidate the local plugin cache so Claude Code picks up the new version on next restart:

```bash
rm -rf ~/.claude/plugins/cache/shdrs-skills/
```

Or use the shortcut:

```bash
bun run invalidate
```

Note: run this from your terminal, not from within Claude Code.
