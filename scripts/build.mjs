#!/usr/bin/env node

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  readSourceSkills,
  cleanDir,
  ensureDir,
  writeFile,
  copyDirSync,
  generateYamlFrontmatter,
  compileProviderBlocks,
  replacePlaceholders,
} from './lib/utils.mjs';
import { PROVIDERS } from './lib/providers.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');

const FIELD_SPECS = {
  'user-invocable': {
    sourceKey: 'userInvocable',
    yamlKey: 'user-invocable',
    condition: (skill) => skill.userInvocable,
    value: () => true,
  },
  'argument-hint': {
    sourceKey: 'argumentHint',
    yamlKey: 'argument-hint',
    condition: (skill) => skill.userInvocable && skill.argumentHint,
  },
  license: { sourceKey: 'license', yamlKey: 'license' },
  'allowed-tools': { sourceKey: 'allowedTools', yamlKey: 'allowed-tools' },
};

function transformSkills(skills, config, distDir) {
  const {
    provider,
    configDir,
    displayName,
    frontmatterFields = [],
    providerTags = [provider],
    placeholderProvider,
  } = config;
  const placeholderKey = placeholderProvider || provider;
  const providerDir = path.join(distDir, provider);
  const skillsOutDir = path.join(providerDir, configDir, 'skills');

  cleanDir(providerDir);
  ensureDir(skillsOutDir);

  const allSkillNames = skills.map((s) => s.name);
  const activeFields = frontmatterFields.map((name) => FIELD_SPECS[name]).filter(Boolean);

  let subSkillCount = 0;
  let appletCount = 0;

  for (const skill of skills) {
    const skillDir = path.join(skillsOutDir, skill.name);

    const appletsPath = `${configDir}/skills/${skill.name}/applets`;

    // --- Frontmatter ---
    const fm = { name: skill.name, description: skill.description };
    for (const spec of activeFields) {
      if (spec.condition && !spec.condition(skill)) continue;
      let val = spec.value ? spec.value(skill) : skill[spec.sourceKey];
      if (val) {
        // Resolve {{applets_path}} in frontmatter values (e.g. allowed-tools)
        if (typeof val === 'string') {
          val = val.replace(/\{\{applets_path\}\}/g, appletsPath);
        } else if (Array.isArray(val)) {
          val = val.map((v) => (typeof v === 'string' ? v.replace(/\{\{applets_path\}\}/g, appletsPath) : v));
        }
        fm[spec.yamlKey] = val;
      }
    }
    const frontmatter = generateYamlFrontmatter(fm);

    // --- Body ---
    let body = compileProviderBlocks(skill.body, providerTags);
    body = replacePlaceholders(body, placeholderKey, allSkillNames);
    body = body.replace(/\{\{applets_path\}\}/g, appletsPath);

    writeFile(path.join(skillDir, 'SKILL.md'), `${frontmatter}\n\n${body}\n`);

    // --- Sub-skills (provider blocks only, no placeholder resolution) ---
    for (const ss of skill.subSkills) {
      const content = compileProviderBlocks(ss.content, providerTags);
      writeFile(path.join(skillDir, 'sub-skills', `${ss.name}.md`), content);
      subSkillCount++;
    }

    // --- Applets (verbatim copy) ---
    for (const applet of skill.applets) {
      const dest = path.join(skillDir, 'applets', applet.name);
      ensureDir(path.dirname(dest));
      fs.writeFileSync(dest, applet.content);
      appletCount++;
    }
  }

  const skillWord = skills.length === 1 ? 'skill' : 'skills';
  const ssInfo = subSkillCount > 0 ? `, ${subSkillCount} sub-skills` : '';
  const appInfo = appletCount > 0 ? `, ${appletCount} applets` : '';
  console.log(`  ${displayName}: ${skills.length} ${skillWord}${ssInfo}${appInfo}`);
}

function syncToHarnessDirs(distDir, rootDir) {
  const syncConfigs = Object.values(PROVIDERS).filter(
    ({ configDir }) => configDir !== '.codex',
  );

  for (const { provider, configDir } of syncConfigs) {
    const src = path.join(distDir, provider, configDir, 'skills');
    const dest = path.join(rootDir, configDir, 'skills');
    if (!fs.existsSync(src)) continue;
    if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true });
    copyDirSync(src, dest);
  }

  const dirs = syncConfigs.map((p) => p.configDir).join(', ');
  console.log(`  Synced to: ${dirs}`);
}

function buildPluginSubtrees(distDir, rootDir, skills) {
  const pluginsDir = path.join(rootDir, 'plugins');

  for (const skill of skills) {
    const pluginRoot = path.join(pluginsDir, skill.name);
    const pluginManifestDir = path.join(pluginRoot, '.claude-plugin');
    const pluginSkillsDir = path.join(pluginRoot, 'skills');

    if (fs.existsSync(pluginManifestDir)) fs.rmSync(pluginManifestDir, { recursive: true });
    if (fs.existsSync(pluginSkillsDir)) fs.rmSync(pluginSkillsDir, { recursive: true });

    const manifest = {
      name: skill.name,
      description: skill.description,
      author: { name: 'shdrs' },
      skills: './skills/',
    };

    ensureDir(pluginManifestDir);
    fs.writeFileSync(
      path.join(pluginManifestDir, 'plugin.json'),
      JSON.stringify(manifest, null, 2) + '\n',
    );

    const claudeSkillsSrc = path.join(
      distDir, 'claude-code', '.claude', 'skills', skill.name,
    );
    if (fs.existsSync(claudeSkillsSrc)) {
      ensureDir(pluginSkillsDir);
      copyDirSync(claudeSkillsSrc, path.join(pluginSkillsDir, skill.name));
    }

    console.log(`  Plugin: plugins/${skill.name}/`);
  }
}

function build() {
  console.log('Building skills for all providers...\n');

  if (fs.existsSync(DIST_DIR)) fs.rmSync(DIST_DIR, { recursive: true });

  const { skills } = readSourceSkills(ROOT_DIR);
  if (skills.length === 0) {
    console.error('No skills found in skills/. Nothing to build.');
    process.exit(1);
  }

  const invocable = skills.filter((s) => s.userInvocable).length;
  console.log(`Found ${skills.length} skill(s) (${invocable} user-invocable)\n`);

  console.log('Transforming:');
  for (const config of Object.values(PROVIDERS)) {
    transformSkills(skills, config, DIST_DIR);
  }

  console.log('\nSyncing to harness directories:');
  syncToHarnessDirs(DIST_DIR, ROOT_DIR);

  console.log('\nBuilding plugin subtrees:');
  buildPluginSubtrees(DIST_DIR, ROOT_DIR, skills);

  console.log('\nBuild complete!');
}

build();
