import fs from 'node:fs';
import path from 'node:path';

// --- File operations ---

export function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

export function cleanDir(dirPath) {
  if (fs.existsSync(dirPath)) fs.rmSync(dirPath, { recursive: true, force: true });
}

export function writeFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf-8');
}

export function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// --- Frontmatter parsing ---

export function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };

  const [, frontmatterText, body] = match;
  const frontmatter = {};
  const lines = frontmatterText.split(/\r?\n/);
  let currentKey = null;
  let currentArray = null;

  for (const line of lines) {
    if (!line.trim()) continue;
    const leadingSpaces = line.length - line.trimStart().length;
    const trimmed = line.trim();

    if (trimmed.startsWith('- ') && leadingSpaces >= 2 && currentArray) {
      currentArray.push(trimmed.slice(2));
      continue;
    }

    if (leadingSpaces === 0) {
      const colonIndex = trimmed.indexOf(':');
      if (colonIndex > 0) {
        const key = trimmed.slice(0, colonIndex).trim();
        const value = trimmed.slice(colonIndex + 1).trim();
        const isQuoted = /^(".*"|'.*')$/.test(value);
        const unquotedValue = isQuoted ? value.slice(1, -1) : value;

        if (value) {
          const shouldCoerceBool = key === 'user-invocable' || !isQuoted;
          frontmatter[key] = shouldCoerceBool
            ? unquotedValue === 'true' ? true
              : unquotedValue === 'false' ? false
              : unquotedValue
            : unquotedValue;
          currentKey = key;
          currentArray = null;
        } else {
          currentKey = key;
          currentArray = [];
          frontmatter[key] = currentArray;
        }
      }
    }
  }

  return { frontmatter, body: body.trim() };
}

// --- YAML generation ---

function yamlNeedsQuoting(value) {
  if (typeof value !== 'string') return false;
  if (value === '') return true;
  if (/^\s|\s$/.test(value)) return true;
  if (/^[\[\]{},&*!|>'"%@`#]/.test(value)) return true;
  if (/^[?:-](\s|$)/.test(value)) return true;
  if (/: |\s#|:$/.test(value)) return true;
  if (/^(true|false|null|yes|no|on|off|~)$/i.test(value)) return true;
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(value)) return true;
  return false;
}

function formatYamlScalar(value) {
  if (typeof value !== 'string') return String(value);
  if (yamlNeedsQuoting(value)) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return value;
}

export function generateYamlFrontmatter(data) {
  const lines = ['---'];
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`  - ${formatYamlScalar(item)}`);
      }
    } else if (typeof value === 'boolean') {
      lines.push(`${key}: ${value}`);
    } else {
      lines.push(`${key}: ${formatYamlScalar(value)}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}

// --- Provider placeholders ---

export const PROVIDER_PLACEHOLDERS = {
  'claude-code': {
    model: 'Claude',
    config_file: 'CLAUDE.md',
    ask_instruction: 'STOP and call the AskUserQuestion tool to clarify.',
    command_prefix: '/',
  },
  cursor: {
    model: 'the model',
    config_file: '.cursorrules',
    ask_instruction: 'ask the user directly to clarify what you cannot infer.',
    command_prefix: '/',
  },
  gemini: {
    model: 'Gemini',
    config_file: 'GEMINI.md',
    ask_instruction: 'ask the user directly to clarify what you cannot infer.',
    command_prefix: '/',
  },
  codex: {
    model: 'GPT',
    config_file: 'AGENTS.md',
    ask_instruction: "STOP and use Codex's structured user-input/question tool when available; if unavailable, ask directly in chat to clarify what you cannot infer.",
    command_prefix: '$',
  },
  agents: {
    model: 'the model',
    config_file: '.github/copilot-instructions.md',
    ask_instruction: 'ask the user directly to clarify what you cannot infer.',
    command_prefix: '/',
  },
  kiro: {
    model: 'Claude',
    config_file: '.kiro/settings.json',
    ask_instruction: 'ask the user directly to clarify what you cannot infer.',
    command_prefix: '/',
  },
  opencode: {
    model: 'Claude',
    config_file: 'AGENTS.md',
    ask_instruction: 'STOP and call the `question` tool to clarify.',
    command_prefix: '/',
  },
  pi: {
    model: 'the model',
    config_file: 'AGENTS.md',
    ask_instruction: 'ask the user directly to clarify what you cannot infer.',
    command_prefix: '/',
  },
  qoder: {
    model: 'the model',
    config_file: 'AGENTS.md',
    ask_instruction: 'ask the user directly to clarify what you cannot infer.',
    command_prefix: '/',
  },
  trae: {
    model: 'the model',
    config_file: 'RULES.md',
    ask_instruction: 'ask the user directly to clarify what you cannot infer.',
    command_prefix: '/',
  },
  'rovo-dev': {
    model: 'Rovo Dev',
    config_file: 'AGENTS.md',
    ask_instruction: 'ask the user directly to clarify what you cannot infer.',
    command_prefix: '/',
  },
};

export const PROVIDER_BLOCK_TAGS = new Set([
  'agents', 'claude', 'claude-code', 'codex', 'cursor', 'gemini',
  'github', 'kiro', 'opencode', 'pi', 'qoder', 'rovo-dev', 'trae', 'trae-cn',
]);

// --- Content transformation ---

export function compileProviderBlocks(content, activeTags = []) {
  const activeTagSet = new Set(activeTags);
  const pattern = /(^|\r?\n)[ \t]*<([a-z][a-z0-9-]*)>[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*<\/\2>[ \t]*(?=\r?\n|$)/g;
  let didCompile = false;

  const compiled = content.replace(pattern, (match, prefix, tag, body) => {
    if (!PROVIDER_BLOCK_TAGS.has(tag)) return match;
    didCompile = true;
    return activeTagSet.has(tag) ? `${prefix}${body}` : prefix;
  });

  return didCompile ? compiled.replace(/(?:\r?\n){3,}/g, '\n\n') : compiled;
}

export function replacePlaceholders(content, provider, skillNames = []) {
  const placeholders = PROVIDER_PLACEHOLDERS[provider] || PROVIDER_PLACEHOLDERS.cursor;
  const cmdPrefix = placeholders.command_prefix || '/';

  let result = content
    .replace(/\{\{model\}\}/g, placeholders.model)
    .replace(/\{\{config_file\}\}/g, placeholders.config_file)
    .replace(/\{\{ask_instruction\}\}/g, placeholders.ask_instruction)
    .replace(/\{\{command_prefix\}\}/g, cmdPrefix);

  if (cmdPrefix !== '/' && skillNames.length > 0) {
    const sorted = [...skillNames].sort((a, b) => b.length - a.length);
    for (const name of sorted) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      result = result.replace(
        new RegExp(`\\/(?=${escaped}(?:[^a-zA-Z0-9_-]|$))`, 'g'),
        cmdPrefix,
      );
    }
  }

  return result;
}

// --- Source reading ---

export function readSourceSkills(rootDir) {
  const skillsDir = path.join(rootDir, 'skills');
  const skills = [];

  if (!fs.existsSync(skillsDir)) return { skills };

  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const skillDir = path.join(skillsDir, entry.name);
    const skillMdPath = path.join(skillDir, 'SKILL.md');
    if (!fs.existsSync(skillMdPath)) continue;

    const content = fs.readFileSync(skillMdPath, 'utf-8');
    const { frontmatter, body } = parseFrontmatter(content);

    // Read sub-skills (markdown files in sub-skills/)
    const subSkills = [];
    const subSkillsDir = path.join(skillDir, 'sub-skills');
    if (fs.existsSync(subSkillsDir)) {
      for (const f of fs.readdirSync(subSkillsDir).filter(f => f.endsWith('.md')).sort()) {
        subSkills.push({
          name: path.basename(f, '.md'),
          content: fs.readFileSync(path.join(subSkillsDir, f), 'utf-8'),
        });
      }
    }

    // Read applets (all files, preserved as buffers for verbatim copy)
    const applets = [];
    const appletsDir = path.join(skillDir, 'applets');
    if (fs.existsSync(appletsDir)) {
      const walk = (dir, prefix = '') => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const rel = prefix ? `${prefix}/${e.name}` : e.name;
          if (e.isDirectory()) {
            walk(path.join(dir, e.name), rel);
          } else {
            applets.push({ name: rel, content: fs.readFileSync(path.join(dir, e.name)) });
          }
        }
      };
      walk(appletsDir);
    }

    skills.push({
      name: frontmatter.name || entry.name,
      description: frontmatter.description || '',
      license: frontmatter.license || '',
      userInvocable: frontmatter['user-invocable'] === true,
      argumentHint: frontmatter['argument-hint'] || '',
      allowedTools: frontmatter['allowed-tools'] || '',
      body,
      filePath: skillMdPath,
      subSkills,
      applets,
    });
  }

  return { skills };
}
