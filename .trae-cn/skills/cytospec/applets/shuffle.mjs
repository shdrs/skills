#!/usr/bin/env node

// shuffle.mjs — Split merge outputs into diverse, size-bounded chunks.
//
// Usage:
//   node shuffle.mjs <output-dir> <round> <file1.json> [file2.json ...]
//
// Reads merge output JSON files, normalizes nested source arrays,
// groups decisions into subtrees (root + descendants), interleaves
// subtrees round-robin across source files for diversity, and packs
// into chunks that respect a character limit.
//
// The report includes per-chunk label summaries so a pairing sub-agent
// can decide which chunks to pair for the next MAP phase.
//
// Env:
//   MAX_CHARS — max characters per output chunk (default: 40000)

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';

const args = process.argv.slice(2);
if (args.length < 3) {
  console.error('Usage: node shuffle.mjs <output-dir> <round-number> <file1.json> [file2.json ...]');
  process.exit(1);
}

const outputDir = args[0];
const round = parseInt(args[1], 10);
const inputFiles = args.slice(2);
const maxChars = parseInt(process.env.MAX_CHARS || '40000', 10);

mkdirSync(outputDir, { recursive: true });

// --- Helpers ---

function getLabel(d) {
  if (d.raw_label) return d.raw_label;
  if (d.label && typeof d.label === 'object') return d.label.synthesis;
  if (typeof d.label === 'string') return d.label;
  return '';
}

function getPrimarySource(d) {
  if (d.sources && d.sources.length) {
    let first = d.sources[0];
    while (Array.isArray(first) && first.length) first = first[0];
    if (typeof first === 'string') return first;
  }
  if (d.source_file) return d.source_file;
  return 'unknown';
}

function flattenSources(d) {
  const result = new Set();
  const stack = [...(d.sources || [])];
  if (d.source_file) stack.push(d.source_file);
  while (stack.length) {
    const item = stack.pop();
    if (Array.isArray(item)) stack.push(...item);
    else if (typeof item === 'string') result.add(item);
  }
  return [...result];
}

// --- Read all merge outputs and normalize ---

const allDecisions = [];
const inputSummary = [];

for (const file of inputFiles) {
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const decisions = data.decisions || [];
  for (const d of decisions) {
    d.sources = flattenSources(d);
    // Warn on format drift — merge agents should never produce these
    if (d.id) console.error(`WARN: decision has "id" field (${d.id}) in ${basename(file)} — raw_label is the identity, not a separate id`);
    if (d.children && d.children.length) {
      console.error(`WARN: decision has nested "children" in ${basename(file)} — children must be separate entries with parent references`);
      // Flatten nested children into the decisions array
      for (const child of d.children) {
        child.sources = flattenSources(child);
        if (!child.parent) child.parent = getLabel(d);
        decisions.push(child);
      }
      delete d.children;
    }
  }
  allDecisions.push(...decisions);
  inputSummary.push({ file: basename(file), decisions: decisions.length });
}

// --- Build subtrees ---
// Each subtree = one root decision + all its descendants.
// Subtrees are atomic — never split across chunks.

function buildSubtrees(decisions) {
  const roots = [];
  const nonRoots = [];

  for (const d of decisions) {
    if (!d.parent) roots.push(d);
    else nonRoots.push(d);
  }

  const subtrees = [];
  const assigned = new Set();

  for (const root of roots) {
    const tree = [root];
    assigned.add(root);

    const knownLabels = new Set([getLabel(root)]);
    let found = true;
    while (found) {
      found = false;
      for (const child of nonRoots) {
        if (!assigned.has(child) && knownLabels.has(child.parent)) {
          tree.push(child);
          assigned.add(child);
          const childLabel = getLabel(child);
          if (childLabel) knownLabels.add(childLabel);
          found = true;
        }
      }
    }

    subtrees.push(tree);
  }

  for (const d of nonRoots) {
    if (!assigned.has(d)) {
      subtrees.push([d]);
    }
  }

  return subtrees;
}

const subtrees = buildSubtrees(allDecisions);

// --- Round-robin interleave across source files ---
// Makes every chunk diverse so any pairing produces useful cross-file comparisons.

const bySource = new Map();
for (const tree of subtrees) {
  const source = getPrimarySource(tree[0]);
  if (!bySource.has(source)) bySource.set(source, []);
  bySource.get(source).push(tree);
}

const sourceQueues = [...bySource.values()];
const indices = sourceQueues.map(() => 0);
const interleaved = [];

let active = sourceQueues.length;
while (active > 0) {
  for (let i = 0; i < sourceQueues.length; i++) {
    if (indices[i] < sourceQueues[i].length) {
      interleaved.push(sourceQueues[i][indices[i]]);
      indices[i]++;
      if (indices[i] >= sourceQueues[i].length) active--;
    }
  }
}

// --- Pack into size-bounded chunks ---

function measureChunk(decisions) {
  const srcSet = new Set();
  for (const d of decisions) {
    for (const s of (d.sources || [])) srcSet.add(s);
  }
  const obj = {
    round, source: 'shuffle', sources: [...srcSet].sort(),
    decisions, root_count: decisions.filter(d => !d.parent).length,
    total_count: decisions.length,
  };
  return JSON.stringify(obj, null, 2).length;
}

const chunks = [];
let current = [];

for (const tree of interleaved) {
  if (measureChunk(tree) > maxChars) {
    if (current.length > 0) {
      chunks.push(current);
      current = [];
    }
    chunks.push(tree);
    continue;
  }

  const candidate = [...current, ...tree];
  if (measureChunk(candidate) > maxChars && current.length > 0) {
    chunks.push(current);
    current = [...tree];
  } else {
    current = candidate;
  }
}

if (current.length > 0) {
  chunks.push(current);
}

// --- Write chunks ---

const chunkStats = [];
for (let i = 0; i < chunks.length; i++) {
  const decisions = chunks[i];
  const rootCount = decisions.filter(d => !d.parent).length;
  const totalCount = decisions.length;
  const allSources = new Set();
  for (const d of decisions) {
    for (const s of (d.sources || [])) allSources.add(s);
  }
  const sources = [...allSources].sort();

  const output = {
    round,
    source: 'shuffle',
    sources,
    decisions,
    root_count: rootCount,
    total_count: totalCount,
  };

  const json = JSON.stringify(output, null, 2);
  const chunkFile = `chunk-${i + 1}.json`;
  writeFileSync(join(outputDir, chunkFile), json + '\n');

  // Per-chunk summary: labels + sources so the pairing sub-agent
  // knows what's in each chunk without reading the files.
  chunkStats.push({
    file: chunkFile,
    path: join(outputDir, chunkFile),
    chars: json.length,
    roots: rootCount,
    total: totalCount,
    sources,
    labels: decisions.filter(d => !d.parent).map(getLabel),
  });
}

// --- Report (stdout JSON) ---

console.log(JSON.stringify({
  round,
  input_files: inputSummary,
  source_files: [...bySource.keys()],
  subtrees: subtrees.length,
  orphans: subtrees.filter(t => t.length === 1 && t[0].parent).length,
  chunks_written: chunks.length,
  total_roots: subtrees.length,
  total_decisions: allDecisions.length,
  max_chunk_chars: chunkStats.length ? Math.max(...chunkStats.map(s => s.chars)) : 0,
  oversized_subtrees: chunkStats.filter(s => s.chars > maxChars).length,
  chunks: chunkStats,
}, null, 2));
