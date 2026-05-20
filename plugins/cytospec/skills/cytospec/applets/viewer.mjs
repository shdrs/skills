#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const graphPath = process.argv[2];

let html = readFileSync(resolve(__dirname, 'viewer.html'), 'utf8');

if (graphPath) {
  const graphData = readFileSync(resolve(graphPath), 'utf8');
  JSON.parse(graphData); // validate JSON — throws if malformed
  html = html.replace(
    'const INJECTED_GRAPH = null',
    `const INJECTED_GRAPH = ${graphData}`
  );
}

const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});

server.listen(0, () => {
  const port = server.address().port;
  console.log(JSON.stringify({ status: 'ready', port, url: `http://localhost:${port}` }));
});
