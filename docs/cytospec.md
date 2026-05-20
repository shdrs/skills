# cytospec

Extracts decisions from markdown files and maps them into a graph — hierarchy, rationale, tradeoffs, and cross-cutting connections between decisions across your entire spec corpus.

## Install

```
/plugin marketplace add shdrs/skills
/plugin install cytospec@shdrs-skills
```

## What it does

Point cytospec at any collection of `.md` files — design specs, architecture docs, planning documents — and it extracts every concrete decision the authors committed to. Not topics, not summaries: decisions with verbatim evidence from the source text.

The output is a `graph.json` where each node is a decision (with quotes, rationale, alternatives considered, and downstream impact) and edges represent cross-cutting relationships like `depends-on`, `enables`, `constrains`, and `contradicts`.

## Usage

```
/cytospec new specs/               # analyze all .md files in a directory
/cytospec new api.md auth.md       # analyze specific files
/cytospec merge                    # merge latest session into the master graph
/cytospec view                     # explore the decision graph
/cytospec status                   # see what's been processed, what's stale
```

## How the pipeline works

cytospec processes files through a parallelized pipeline that converges on a deduplicated, hierarchical decision graph.

### 1. Extraction (parallel)

Each input file is split into overlapping chunks. One sub-agent per chunk reads the source text and extracts every decision it can find — architecture choices, technology picks, stated preferences, rejected alternatives, accepted constraints. Sub-agents work in parallel and are instructed to be exhaustive; duplicates across chunks are expected and handled in the next stage.

### 2. Consolidation (map-reduce)

Raw extractions are consolidated through iterative rounds of comparison and deduplication:

**Map** — Pairs of chunk files are compared in parallel. Each pair undergoes venn diagram analysis: how much do two decisions overlap? Highly overlapping decisions merge into one. One-contains-the-other becomes a parent-child hierarchy. Loosely related decisions are flagged as siblings. Unrelated decisions pass through unchanged.

**Shuffle** — After each round of parallel merges, all outputs are flattened and redistributed into fresh bounded-size chunks. This redistribution deliberately mixes decisions from different source files so that cross-file duplicates — which couldn't meet during extraction — get compared in subsequent rounds.

**Convergence** — The map-shuffle cycle repeats. Each round produces fewer unique decisions as duplicates merge and hierarchies form. The orchestrating agent tracks the reduction rate across rounds and stops when another pass would yield negligible merges. There's no fixed number of rounds — the pipeline runs until the data converges naturally.

A corpus that starts with hundreds of raw candidates typically converges to a clean tree in 2-4 rounds.

### 3. Edge discovery (parallel)

Once the decision tree is stable, sub-agents compare branches pairwise to find cross-cutting relationships. A JWT authentication decision might `depend-on` a stateless API constraint from an entirely different spec file. These connections are the graph edges — each backed by quotes from the source material or marked as inferred when the relationship is logically clear but not explicitly stated.

### 4. Polish

A final pass converts raw labels into full decision nodes: attaching verbatim quotes as evidence, generating concise synthesis grounded in those quotes, filling in rationale (`why`), alternatives (`over`), and downstream effects (`impact`). The result is written as the session's `graph.json`.

## The living artifact

cytospec is designed for repeated use. Each run produces a session-scoped graph. Merging a session into the master graph is additive: existing decisions accumulate evidence, evolved specs update synthesis, and decisions that disappear from re-processed files get flagged as potentially stale — never deleted. The master graph grows more complete and more accurate over time.

```
docs/cytospec/
  graph.json              # master graph, accumulated across sessions
  scopes/
    2026-05-20-auth-api/  # one session's working data + standalone graph
    2026-05-21-frontend/  # another session
```

## Every decision is quote-backed

cytospec uses an `Insight` pattern throughout: find verbatim quotes from the source files first, then synthesize. No quotes means no synthesis — the pipeline never hallucinates rationale or connections. Every claim in the graph traces back to specific lines in your markdown files.

## Agent support

cytospec is published to all 13 supported agents:

| Agent | Directory |
|-------|-----------|
| Claude Code | `.claude/skills/` |
| Cursor | `.cursor/skills/` |
| Gemini CLI | `.gemini/skills/` |
| Codex CLI | `.agents/skills/` |
| GitHub Copilot | `.github/skills/` |
| Kiro | `.kiro/skills/` |
| OpenCode | `.opencode/skills/` |
| Pi | `.pi/skills/` |
| Qoder | `.qoder/skills/` |
| Rovo Dev | `.rovodev/skills/` |
| Trae | `.trae/skills/` |
| Trae China | `.trae-cn/skills/` |

For non-Claude agents, clone or submodule this repo and the agent picks up the skill from its native directory.
