# Applets

How to ship executable code alongside a skill so the agent can run it at runtime.

## What applets are

An applet is a script that lives in the skill's `applets/` directory and gets executed by the agent via Bash. Instead of the LLM reasoning through a complex analysis or generation task, an applet handles it deterministically — faster, more reliable, and reproducible.

## When to use applets

- **Context loading**: The skill needs to read project-specific files (config, design docs, product specs) and return structured data for the LLM to reason about.
- **Detection / analysis**: Scanning code for patterns, anti-patterns, quality issues, or metrics. Deterministic checks beat LLM guessing.
- **Generation**: Producing files, tokens, configs, or boilerplate from templates.
- **Interactive tools**: Dev servers, browser injection, live preview loops — anything creating a feedback loop between the agent and a running application.

If the task is purely about reasoning, writing, or conversation — don't use an applet. If the task benefits from deterministic execution — do.

## Directory structure

```
my-skill/
├── SKILL.md
└── applets/
    ├── load-context.mjs      # context loader
    ├── detect.mjs             # analyzer
    ├── command-metadata.json  # sub-command registry (if using mega-skill pattern)
    └── browser-bundle.js      # bundled browser applet (if needed)
```

## How to write an applet

### Rules

1. **Node.js ESM** (`.mjs` extension). This is the universal runtime across all agents.
2. **stdout for structured output** — print JSON that the agent consumes. Use stderr for logs and errors.
3. **Agent-agnostic** — no agent-specific code. The script doesn't know or care whether Claude, Codex, or Gemini is calling it.
4. **Self-contained** — can import from npm packages in the repo's `package.json`, but should not assume the user has installed anything globally.
5. **Idempotent** — safe to run multiple times. Don't mutate project state unless that's the explicit purpose.

### Context loader pattern

The most common applet. Reads project files and returns structured JSON:

```javascript
// applets/load-context.mjs
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const cwd = process.cwd();
const result = { contextDir: cwd };

for (const name of ['PRODUCT.md', 'DESIGN.md', 'CONFIG.md']) {
  const filePath = resolve(cwd, name);
  if (existsSync(filePath)) {
    result[name.replace('.md', '').toLowerCase()] = readFileSync(filePath, 'utf8');
  }
}

console.log(JSON.stringify(result));
```

The SKILL.md invokes it like this:

```markdown
### Context gathering

\```bash
node {{applets_path}}/load-context.mjs
\```

Consume the full JSON output. Never pipe through `head`, `tail`, `grep`, or `jq`.
```

Note: `{{applets_path}}` is a template variable resolved at build time to the correct path for each agent. If multi-agent publishing isn't being used, hardcode the path instead.

### Detector / analyzer pattern

Scans files and reports findings:

```javascript
// applets/detect.mjs
import { readFileSync } from 'node:fs';

const target = process.argv[2];
if (!target) {
  console.error('Usage: node detect.mjs <file-or-dir>');
  process.exit(1);
}

const content = readFileSync(target, 'utf8');
const findings = [];

// ... analysis logic ...

console.log(JSON.stringify({ target, findings, summary: `${findings.length} issues found` }));
```

### Interactive tool pattern

Long-running processes that create feedback loops:

```javascript
// applets/live-server.mjs
import { createServer } from 'node:http';

const server = createServer((req, res) => {
  // ... serve/inject/modify ...
});

server.listen(0, () => {
  const port = server.address().port;
  console.log(JSON.stringify({ status: 'ready', port, url: `http://localhost:${port}` }));
});
```

## Browser applets

Sometimes a script needs to run in the browser (injected into a page for visual analysis, DOM manipulation, etc.), not in Node.js.

For these, create a build script that bundles source modules into a single IIFE:

```javascript
// applets/build-browser-bundle.js
import { readFileSync, writeFileSync } from 'node:fs';

const modules = [
  'applets/src/constants.mjs',
  'applets/src/analyzer.mjs',
  'applets/src/reporter.mjs',
].map(f => readFileSync(f, 'utf8').replace(/^(import|export)\s.*/gm, ''));

const bundle = `(function(){\n${modules.join('\n')}\n})();`;
writeFileSync('applets/browser-bundle.js', bundle);
```

No external bundler needed. The output goes into `applets/` alongside the other applets and ships with the skill.

## Wiring applets into the skill

### SKILL.md frontmatter

Whitelist the Bash patterns the applets need:

```yaml
allowed-tools:
  - Bash(node {{applets_path}}/*.mjs)
```

Or for a published npm package:

```yaml
allowed-tools:
  - Bash(npx my-package *)
```

### Referencing from SKILL.md body

Always use `{{applets_path}}` if multi-agent publishing is enabled. Otherwise, use relative paths from the skill's installed location.

```markdown
## Step 1: Load context

\```bash
node {{applets_path}}/load-context.mjs
\```

Consume the full JSON output — it contains everything needed for the next steps.
```

## What NOT to use applets for

- **Pure reasoning tasks** — let the LLM handle writing, analysis, and decision-making.
- **One-line shell commands** — if `grep -r "TODO" src/` does the job, don't wrap it in a script.
- **Agent-specific tooling** — applets must work with any agent. Don't import Claude SDK, Codex APIs, or Gemini clients.
