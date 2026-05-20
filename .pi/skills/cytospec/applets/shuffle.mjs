#!/usr/bin/env node

// shuffle.mjs — Redistribute merge outputs into bounded, cross-pollinated chunks.
//
// Usage:
//   node shuffle.mjs [options] <output-dir> <round> <file1.json> [file2.json ...]
//
// Options:
//   --strategy <name>     interleave (default), cluster, or guided
//   --assignments <file>  JSON file mapping labels to group numbers (for guided strategy)
//   --manifest            Instead of shuffling, output a lightweight label manifest
//                         for a sub-agent to produce grouping assignments
//
// Strategies:
//   interleave  Round-robin individual subtrees across source files.
//               Best for early rounds — maximizes cross-file dedup exposure.
//
//   cluster     Keep same-source subtrees together, interleave at cluster level.
//               Best for later rounds — preserves within-file relationships
//               (siblings, parent-child) while still mixing across sources.
//
//   guided      Pack subtrees according to assignments from a sub-agent.
//               The assignments file maps decision labels to group numbers.
//               Subtrees sharing a group land in the same chunk when possible.
//
// Env:
//   MAX_CHARS — max characters per output chunk (default: 40000)

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

// --- Parse args ---

const rawArgs = process.argv.slice(2);
let strategy = 'interleave';
let assignmentsFile = null;
let manifestMode = false;
const positional = [];

for (let i = 0; i < rawArgs.length; i++) {
  if (rawArgs[i] === '--strategy' && rawArgs[i + 1]) {
    strategy = rawArgs[++i];
  } else if (rawArgs[i] === '--assignments' && rawArgs[i + 1]) {
    assignmentsFile = rawArgs[++i];
    strategy = 'guided';
  } else if (rawArgs[i] === '--manifest') {
    manifestMode = true;
  } else {
    positional.push(rawArgs[i]);
  }
}

if (positional.length < 3 && !manifestMode) {
  console.error('Usage: node shuffle.mjs [--strategy interleave|cluster|guided] [--assignments file] <output-dir> <round> <file1.json> ...');
  console.error('       node shuffle.mjs --manifest <round> <file1.json> ...');
  process.exit(1);
}

// In manifest mode, first positional is round, rest are files.
// In normal mode, first is output-dir, second is round, rest are files.
const outputDir = manifestMode ? null : positional[0];
const round = parseInt(manifestMode ? positional[0] : positional[1], 10);
const inputFiles = manifestMode ? positional.slice(1) : positional.slice(2);
const maxChars = parseInt(process.env.MAX_CHARS || '40000', 10);

if (outputDir) mkdirSync(outputDir, { recursive: true });

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

// --- Read all merge outputs ---

const allDecisions = [];
const inputSummary = [];

for (const file of inputFiles) {
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const decisions = data.decisions || [];
  for (const d of decisions) {
    d.sources = flattenSources(d);
  }
  allDecisions.push(...decisions);
  inputSummary.push({ file: basename(file), decisions: decisions.length });
}

// --- Build subtrees ---

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

// --- Group subtrees by primary source ---

const bySource = new Map();
for (const tree of subtrees) {
  const source = getPrimarySource(tree[0]);
  if (!bySource.has(source)) bySource.set(source, []);
  bySource.get(source).push(tree);
}

// --- Manifest mode ---
// Output lightweight label + source info for a sub-agent to produce grouping assignments.

if (manifestMode) {
  const manifest = subtrees.map((tree, i) => ({
    index: i,
    label: getLabel(tree[0]),
    children: tree.length - 1,
    chars: JSON.stringify(tree, null, 2).length,
    sources: tree[0].sources || [],
    context_hint: tree[0].context_hint || null,
  }));

  console.log(JSON.stringify({
    round,
    total_subtrees: subtrees.length,
    total_decisions: allDecisions.length,
    source_files: [...bySource.keys()],
    max_chars_per_chunk: maxChars,
    manifest,
  }, null, 2));
  process.exit(0);
}

// --- Ordering strategies ---

function interleaveOrder(subtrees, bySource) {
  // Round-robin individual subtrees across source groups.
  // Maximizes cross-file exposure: each chunk gets decisions from many sources.
  // Cost: scatters same-file siblings across different chunks.
  const sourceQueues = [...bySource.values()];
  const indices = sourceQueues.map(() => 0);
  const ordered = [];

  let active = sourceQueues.length;
  while (active > 0) {
    for (let i = 0; i < sourceQueues.length; i++) {
      if (indices[i] < sourceQueues[i].length) {
        ordered.push(sourceQueues[i][indices[i]]);
        indices[i]++;
        if (indices[i] >= sourceQueues[i].length) active--;
      }
    }
  }
  return ordered;
}

function clusterOrder(subtrees, bySource) {
  // Keep same-source subtrees together in clusters, interleave clusters across sources.
  // Each chunk gets clusters from multiple sources (cross-file dedup) while
  // keeping same-file relationships intact (hierarchy and sibling discovery).
  //
  // Algorithm: sort source groups by size (largest first for better bin packing),
  // then emit clusters in round-robin order. A "cluster" is a batch of subtrees
  // from the same source that fits within ~1/3 of the chunk budget, so each chunk
  // gets clusters from 2-4 different sources.
  const targetClusterChars = Math.floor(maxChars / 3);
  const sourceGroups = [...bySource.entries()]
    .sort((a, b) => b[1].length - a[1].length); // largest source first

  // Split each source's subtrees into cluster-sized batches
  const allClusters = [];
  for (const [source, trees] of sourceGroups) {
    let cluster = [];
    let clusterSize = 0;
    for (const tree of trees) {
      const treeSize = JSON.stringify(tree, null, 2).length;
      if (clusterSize + treeSize > targetClusterChars && cluster.length > 0) {
        allClusters.push({ source, trees: cluster });
        cluster = [];
        clusterSize = 0;
      }
      cluster.push(tree);
      clusterSize += treeSize;
    }
    if (cluster.length > 0) {
      allClusters.push({ source, trees: cluster });
    }
  }

  // Round-robin clusters across sources
  const clustersBySource = new Map();
  for (const c of allClusters) {
    if (!clustersBySource.has(c.source)) clustersBySource.set(c.source, []);
    clustersBySource.get(c.source).push(c);
  }

  const queues = [...clustersBySource.values()];
  const indices = queues.map(() => 0);
  const ordered = [];

  let active = queues.length;
  while (active > 0) {
    for (let i = 0; i < queues.length; i++) {
      if (indices[i] < queues[i].length) {
        // Emit all trees in this cluster sequentially
        ordered.push(...queues[i][indices[i]].trees);
        indices[i]++;
        if (indices[i] >= queues[i].length) active--;
      }
    }
  }
  return ordered;
}

function guidedOrder(subtrees, assignmentsFile) {
  // Pack subtrees according to externally-provided group assignments.
  // Assignments file format: { "assignments": { "<label>": <group_number>, ... } }
  // Subtrees with the same group number are placed adjacently.
  // Unassigned subtrees are appended at the end.
  const raw = JSON.parse(readFileSync(assignmentsFile, 'utf8'));
  const assignments = raw.assignments || raw;

  const groups = new Map(); // group_number -> subtrees[]
  const unassigned = [];

  for (const tree of subtrees) {
    const label = getLabel(tree[0]);
    const group = assignments[label];
    if (group !== undefined) {
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(tree);
    } else {
      unassigned.push(tree);
    }
  }

  // Emit groups in order, then unassigned
  const ordered = [];
  const sortedGroups = [...groups.keys()].sort((a, b) => a - b);
  for (const g of sortedGroups) {
    ordered.push(...groups.get(g));
  }
  ordered.push(...unassigned);
  return ordered;
}

// --- Apply strategy ---

let ordered;
if (strategy === 'cluster') {
  ordered = clusterOrder(subtrees, bySource);
} else if (strategy === 'guided') {
  if (!assignmentsFile || !existsSync(assignmentsFile)) {
    console.error('guided strategy requires --assignments <file>');
    process.exit(1);
  }
  ordered = guidedOrder(subtrees, assignmentsFile);
} else {
  ordered = interleaveOrder(subtrees, bySource);
}

// --- Pack into chunks ---

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

for (const tree of ordered) {
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
    strategy,
    sources,
    decisions,
    root_count: rootCount,
    total_count: totalCount,
  };

  const json = JSON.stringify(output, null, 2);
  const chunkFile = `chunk-${i + 1}.json`;
  writeFileSync(join(outputDir, chunkFile), json + '\n');

  chunkStats.push({
    file: chunkFile,
    chars: json.length,
    roots: rootCount,
    total: totalCount,
    sources,
  });
}

// --- Report ---

console.log(JSON.stringify({
  round,
  strategy,
  input_files: inputSummary,
  source_files_seen: [...bySource.keys()],
  subtrees: subtrees.length,
  orphans: subtrees.filter(t => t.length === 1 && t[0].parent).length,
  chunks_written: chunks.length,
  total_roots: subtrees.length,
  total_decisions: allDecisions.length,
  max_chunk_chars: chunkStats.length ? Math.max(...chunkStats.map(s => s.chars)) : 0,
  oversized_subtrees: chunkStats.filter(s => s.chars > maxChars).length,
  chunks: chunkStats,
}, null, 2));
