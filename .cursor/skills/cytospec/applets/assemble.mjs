#!/usr/bin/env node

// assemble.mjs — Combine polished decision files and edge files into graph.json.
//
// Usage:
//   node assemble.mjs <output-path> <polished-dir> [edges-dir]
//
// Reads all .json files from polished-dir (decisions) and edges-dir (edges),
// combines them, deduplicates edges, and writes the final DecisionGraph.
//
// Reports stats to stdout as JSON.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Usage: node assemble.mjs <output-path> <polished-dir> [edges-dir]');
  process.exit(1);
}

const outputPath = args[0];
const polishedDir = args[1];
const edgesDir = args[2] || null;

// --- Read polished decisions ---

const allDecisions = [];
const polishedFiles = readdirSync(polishedDir)
  .filter(f => f.endsWith('.json'))
  .sort();

for (const file of polishedFiles) {
  const data = JSON.parse(readFileSync(join(polishedDir, file), 'utf8'));
  const decisions = data.decisions || [];
  allDecisions.push(...decisions);
}

// --- Read edges ---

const allEdges = [];
let edgeFileCount = 0;

if (edgesDir) {
  const edgeFiles = readdirSync(edgesDir)
    .filter(f => f.endsWith('.json'))
    .sort();
  edgeFileCount = edgeFiles.length;

  for (const file of edgeFiles) {
    const data = JSON.parse(readFileSync(join(edgesDir, file), 'utf8'));
    const edges = data.edges || [];
    allEdges.push(...edges);
  }
}

// --- Deduplicate edges (same type + from + to) ---

const seen = new Set();
const uniqueEdges = [];

for (const edge of allEdges) {
  const key = `${edge.type}|${edge.from}|${edge.to}`;
  if (!seen.has(key)) {
    seen.add(key);
    uniqueEdges.push(edge);
  }
}

// --- Write graph ---

const graph = {
  decisions: allDecisions,
  edges: uniqueEdges,
};

const json = JSON.stringify(graph, null, 2);
writeFileSync(outputPath, json + '\n');

// --- Report (stdout JSON) ---

console.log(JSON.stringify({
  decisions: allDecisions.length,
  edges: uniqueEdges.length,
  duplicate_edges_removed: allEdges.length - uniqueEdges.length,
  polished_files: polishedFiles.length,
  edge_files: edgeFileCount,
  output: outputPath,
  output_chars: json.length,
}, null, 2));
