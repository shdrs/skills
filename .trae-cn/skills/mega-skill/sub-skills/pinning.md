# Pinning

How to let users promote sub-commands (or any skill) into standalone slash-command shortcuts.

## What pinning is

A user types `/my-skill audit` fifty times a day. Pinning lets them create `/audit` as a standalone shortcut that delegates to `/my-skill audit`. One command to pin, one to unpin. The shortcut works in every agent where the parent skill is installed.

## When to use pinning

- A mega-skill has sub-commands that users invoke frequently enough to want a shortcut.
- A collection of related skills should offer quick-access aliases.
- Any situation where typing the full command path is friction.

Pinning is opt-in per user. It doesn't change the skill itself — it creates tiny stub skills alongside it.

## How it works

### The pin script

A shared `pin.mjs` script handles both operations:

```bash
node {{applets_path}}/pin.mjs pin <command>     # create shortcut
node {{applets_path}}/pin.mjs unpin <command>    # remove shortcut
```

### What `pin` creates

For each agent harness directory where the parent skill is installed, pin creates a stub skill:

```
.claude/skills/audit/SKILL.md    ← stub created by pin
.cursor/skills/audit/SKILL.md   ← stub created by pin
.gemini/skills/audit/SKILL.md   ← stub created by pin
... (every harness where parent is installed)
```

### The stub SKILL.md

```markdown
---
name: audit
description: "Shortcut for {{command_prefix}}my-skill audit. Audit designs for quality, a11y, and anti-patterns."
argument-hint: "[target]"
user-invocable: true
---

<!-- pinned-skill:my-skill -->

This is a pinned shortcut for `{{command_prefix}}my-skill audit`.

Invoke `{{command_prefix}}my-skill audit`, passing along any arguments provided here, and follow its instructions.
```

The `<!-- pinned-skill:my-skill -->` HTML comment is the ownership marker. It identifies this as a pinned stub and names the parent skill.

### What `unpin` removes

Unpin scans for the ownership marker before deleting. It only removes directories whose SKILL.md contains `<!-- pinned-skill:my-skill -->`. User-authored skills with the same name are never touched.

## Safety rules

1. **Ownership marker required.** Unpin refuses to delete any SKILL.md without the `<!-- pinned-skill:parent-name -->` marker.
2. **No overwrites.** Pin skips any harness directory that already has a skill with the same name (unless it's a pinned stub from the same parent).
3. **Harness detection.** Pin only targets directories where the parent skill is actually installed — no orphan shortcuts.
4. **Metadata from command-metadata.json.** Description and argument-hint for the stub come from the sub-command registry, ensuring consistency with the parent skill.

## Implementing pin.mjs

The script needs to:

1. **Find the project root** — walk up from `cwd()` looking for `package.json`, `.git`, or `skills-lock.json`.

2. **Discover harness directories** — check all known harness dirs for the parent skill:
   ```javascript
   const HARNESS_DIRS = [
     '.claude', '.cursor', '.gemini', '.agents', '.github',
     '.kiro', '.opencode', '.pi', '.qoder', '.rovodev',
     '.trae', '.trae-cn'
   ];
   ```

3. **Read command metadata** — load `command-metadata.json` for the command's description and argument hint.

4. **For pin**: generate the stub SKILL.md with the ownership marker, write to each qualifying harness.

5. **For unpin**: find stubs with the matching marker, delete the directory.

```javascript
// applets/pin.mjs
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';

const [action, command] = process.argv.slice(2);
if (!action || !command || !['pin', 'unpin'].includes(action)) {
  console.error('Usage: node pin.mjs <pin|unpin> <command>');
  process.exit(1);
}

// Find project root
let root = process.cwd();
while (root !== '/') {
  if (['package.json', '.git'].some(f => existsSync(join(root, f)))) break;
  root = resolve(root, '..');
}

const SKILL_NAME = 'my-skill'; // replace with actual parent skill name
const MARKER = `<!-- pinned-skill:${SKILL_NAME} -->`;

const HARNESS_DIRS = [
  '.claude', '.cursor', '.gemini', '.agents', '.github',
  '.kiro', '.opencode', '.pi', '.qoder', '.rovodev',
  '.trae', '.trae-cn'
];

// Read command metadata
const metaPath = join(root, `skills/${SKILL_NAME}/applets/command-metadata.json`);
const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
const cmd = meta.commands[command];
if (!cmd) {
  console.error(`Unknown command: ${command}`);
  process.exit(1);
}

for (const harness of HARNESS_DIRS) {
  const parentDir = join(root, harness, 'skills', SKILL_NAME);
  if (!existsSync(parentDir)) continue; // parent not installed here

  const stubDir = join(root, harness, 'skills', command);
  const stubPath = join(stubDir, 'SKILL.md');

  if (action === 'pin') {
    if (existsSync(stubPath)) {
      const existing = readFileSync(stubPath, 'utf8');
      if (!existing.includes(MARKER)) {
        console.error(`Skipping ${harness}: skill '${command}' exists and is not a pinned stub`);
        continue;
      }
    }
    mkdirSync(stubDir, { recursive: true });
    const stub = [
      '---',
      `name: ${command}`,
      `description: "${cmd.description}"`,
      `argument-hint: "[target]"`,
      'user-invocable: true',
      '---',
      '',
      MARKER,
      '',
      `This is a pinned shortcut. Invoke \`/${SKILL_NAME} ${command}\`, passing along any arguments, and follow its instructions.`,
    ].join('\n');
    writeFileSync(stubPath, stub);
    console.log(`Pinned: ${harness}/skills/${command}/`);
  }

  if (action === 'unpin') {
    if (!existsSync(stubPath)) continue;
    const content = readFileSync(stubPath, 'utf8');
    if (!content.includes(MARKER)) {
      console.error(`Skipping ${harness}: not a pinned stub`);
      continue;
    }
    rmSync(stubDir, { recursive: true });
    console.log(`Unpinned: ${harness}/skills/${command}/`);
  }
}
```

Adapt the `SKILL_NAME` constant and metadata path for each skill that uses pinning.

## Exposing pin/unpin to users

In the master SKILL.md, add a section:

```markdown
## Pin / Unpin

Create standalone shortcuts for frequently-used commands.

**Pin** makes `{{command_prefix}}<command>` invoke `{{command_prefix}}my-skill <command>` directly.
**Unpin** removes the shortcut.

\```bash
node {{applets_path}}/pin.mjs pin <command>
node {{applets_path}}/pin.mjs unpin <command>
\```

Valid commands: any from the commands table above.
```

## Pinning without the mega-skill pattern

Pinning doesn't require the mega-skill architecture. It can also be used to:
- Create aliases for any skill (`/quick` → `/long-skill-name`)
- Set up project-specific shortcuts
- Let teams standardize on short command names

The implementation is the same — a stub SKILL.md with an ownership marker that delegates to the real skill.
