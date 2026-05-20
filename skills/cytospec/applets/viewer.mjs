#!/usr/bin/env node

// viewer.mjs — Generate a standalone viewer HTML with optional graph data injected.
//
// Usage:
//   node viewer.mjs <graph.json> [output.html]
//   node viewer.mjs [output.html]
//
// With a graph path: injects the graph data into the HTML so it loads immediately.
// Without: copies the empty viewer (user loads via file picker or drag-and-drop).
//
// Output defaults to viewer.html in the same directory as the graph,
// or the current directory if no graph is provided.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

let html = readFileSync(resolve(__dirname, 'viewer.html'), 'utf8');
let graphPath = null;
let outputPath = null;

// Determine which args are graph vs output
for (const arg of args) {
  if (arg.endsWith('.json')) graphPath = arg;
  else if (arg.endsWith('.html')) outputPath = arg;
}

if (graphPath) {
  const absGraph = resolve(graphPath);
  const graphData = readFileSync(absGraph, 'utf8');
  JSON.parse(graphData); // validate — throws if malformed
  html = html.replace(
    'const INJECTED_GRAPH = null',
    `const INJECTED_GRAPH = ${graphData}`
  );

  const outPath = outputPath
    ? resolve(outputPath)
    : join(dirname(absGraph), 'viewer.html');

  writeFileSync(outPath, html);
  console.log(JSON.stringify({
    status: 'ready',
    path: outPath,
    url: `file://${outPath}`,
    graph: absGraph,
  }));
} else {
  const outPath = outputPath ? resolve(outputPath) : resolve('viewer.html');
  writeFileSync(outPath, html);
  console.log(JSON.stringify({
    status: 'ready',
    path: outPath,
    url: `file://${outPath}`,
    note: 'No graph injected — use file picker or drag-and-drop to load',
  }));
}
