# New Session

Analyze markdown files and produce a decision graph. This is the core workflow — it runs the full extraction-to-graph pipeline and produces a session-scoped `graph.json`.

## What happens

1. You identify the input .md files
2. You create a session scope folder
3. You orchestrate the pipeline: extract → consolidate (map-reduce) → discover edges → polish
4. The session's `graph.json` is written
5. You offer to merge into the master graph

## Step 1: Setup

Identify the files to process. The user may provide:
- A directory path → find all `.md` files recursively
- Specific file paths → use those
- Nothing → ask which files or directories to process

**Do NOT read any input .md files yourself.** Use Bash commands only:
- `wc -c <file>` for character counts (primary sizing metric — 4 chars ≈ 1 LLM token)
- `wc -l <file>` for line counts (needed to calculate line ranges for the Read tool)
- `stat -f '%Sm' -t '%Y-%m-%dT%H:%M:%SZ' <file>` (macOS) or `stat -c '%y' <file>` (Linux) for real modification timestamps
- Never infer timestamps from filenames

**Sub-agent sizing rule: no sub-agent should receive more than ~80k characters of input data (~20k LLM tokens).** For merge agents reading two files, each file must be ≤ ~40k characters. Use `wc -c` to verify sizes before dispatching.

Create the session scope:
```
docs/cytospec/scopes/{YYYY-MM-DD}-{slug}/
  metadata.json
  chunks/
  rounds/
  edges/
```

Write `metadata.json` with the files being processed and their actual modification timestamps:
```json
{
  "files": {
    "specs/api-design.md": { "modified_at": "2026-05-20T09:15:32Z", "chars": 95000, "lines": 2400 },
    "specs/auth-spec.md": { "modified_at": "2026-05-19T14:22:07Z", "chars": 32000, "lines": 800 }
  },
  "created_at": "2026-05-20T15:00:00Z"
}
```

## Step 2: Extract decisions (parallel, cheap model)

Split each file into chunks of **~80k characters** with **~8k character overlap**. Use `wc -c` and `wc -l` to compute the average characters per line for each file, then derive line ranges that fit the character budget. Launch one sub-agent per chunk using the cheapest/fastest available model.

Each chunk's line range is passed to the sub-agent for the Read tool — the character budget just determines where you draw the boundaries.

### Extraction sub-agent prompt

```
Extract meaningful decisions from this chunk of a spec file.

Read the file: {file_path} (lines {start} to {end})

A "decision" is any concrete choice the authors committed to:
- Explicit choices with rationale: "We chose X because Y"
- Stated preferences: "We'll use X for this"
- Implicit assumptions: "The frontend will be built in React"
- Constraints accepted: "We can't use X because Y, so we'll do Z"
- Rejections: "We considered X but rejected it because Y"
- Architecture, design, or implementation choices at any level

Be EXHAUSTIVE. Design specs are dense with decisions — most lines represent
choices. Extract every decision you find. Duplicates with other chunks will
be handled later — your job is to never miss one.

However, group repeated instances of the same pattern into one decision.
For example, if a spec lists 15 individual signal configurations that all
follow the same pattern, that's ONE decision ("Use weighted scoring across
N signal types") with representative quotes, not 15 separate decisions.
The pattern is the decision; the instances are evidence.

For each decision, output a JSON object:
{
  "raw_label": "short label for this decision (single sentence)",
  "quotes": ["verbatim text from the file that evidences this decision"],
  "context_hint": "what broader topic or section this appeared under",
  "source_file": "{file_path}",
  "source_lines": [approximate_start, approximate_end]
}

Write your output as a JSON object to: {chunk_output_path}
The format:
{
  "chunk_id": {N},
  "source_file": "{file_path}",
  "line_range": [{start}, {end}],
  "candidates": [ ...your extracted decisions... ],
  "candidate_count": {how many you found}
}

Report back ONLY: how many candidates you found and the source file + line range.
```

## Step 3: Consolidation (map-reduce loop)

This is the core of cytospec. It takes the raw candidates from extraction and consolidates them into a deduplicated decision tree through iterative map-reduce rounds.

### The loop

```
Round 1:
  MAP:     merge pairs of extraction chunks (parallel)
  SHUFFLE: flatten all outputs, redistribute into new bounded chunks

Round 2:
  MAP:     merge pairs of shuffled chunks (parallel)
  SHUFFLE: flatten, redistribute

Round N:
  MAP:     merge pairs
  SHUFFLE: flatten, redistribute
  → delegator judges: negligible merges? → done
```

### MAP phase: Pairwise merge (parallel, strong model)

Each merge agent takes exactly TWO chunk files as input. It compares all root-level decisions between them using venn diagram analysis and produces a consolidated output.

#### Venn diagram analysis

For each pair of root decisions (one from each input), evaluate:

```
VennAnalysis {
  decision_a: string
  decision_b: string
  a_scope: string              // what does A cover?
  b_scope: string              // what does B cover?
  overlap: string              // what's in both?
  a_only: string               // unique to A
  b_only: string               // unique to B
  overlap_pct: number          // 0-100 of the smaller scope
  verdict: "MERGE" | "PARENT_CHILD" | "SIBLING" | "UNRELATED"
}
```

**MERGE** (≥90% overlap): Same decision. Combine all quotes and sources. Keep the more concise label.

**PARENT_CHILD** (50-90%, one contains the other): Broader decision becomes parent. Both survive as separate nodes.

**SIBLING** (20-50%): Different decisions in same domain. Flag as related — they may share a parent.

**UNRELATED** (<20%): No connection. Both pass through unchanged.

#### Merge sub-agent prompt

```
Consolidate decisions from two chunk files using venn diagram analysis.

Read these two files:
- {chunk_a_path}
- {chunk_b_path}

For every plausible pair of root-level decisions (one from each file),
run VennAnalysis and apply the verdict. Be aggressive about merging —
decisions about the same system/component using different words should MERGE.

For PARENT_CHILD verdicts: the broader decision becomes parent, the narrower
becomes its child.

Write output to: {output_path}
Format:
{
  "round": {N},
  "input_files": ["{chunk_a_path}", "{chunk_b_path}"],
  "decisions": [ ...consolidated decisions... ],
  "root_count": {N},
  "total_count": {N},
  "merges_performed": {N},
  "hierarchies_created": {N}
}

Report back ONLY: root_count, total_count, merges_performed.
```

### SHUFFLE phase: Redistribute into bounded chunks (mandatory)

**Every MAP phase is followed by a SHUFFLE.** No exceptions. You never pair merge outputs directly — they go through shuffle first, even if "they'd probably fit." The shuffle exists to enforce the sizing constraint AND to mix decisions across source files for cross-pollination.

**Chunk size limit: ~40k characters** (verify with `wc -c`). This is a hard ceiling, not a guideline. The reasoning: each merge agent reads TWO chunks, so the combined input must stay ≤ ~80k characters (~20k LLM tokens). "Well within model context" is not a valid reason to exceed this — the limit protects output quality, not just context length. Overloaded agents produce shallow comparisons and miss merges.

Run the shuffle applet — no sub-agent needed, this is deterministic:

```bash
node {{applets_path}}/shuffle.mjs {round_N+1_chunks_dir} {N+1} {merge_output_1} {merge_output_2} ...
```

The applet:
- Reads all merge outputs and normalizes nested `sources` arrays
- Groups decisions into subtrees (root + descendants — never split)
- Interleaves subtrees round-robin across source files for cross-pollination
- Packs into chunks capped at 40k characters (the full output JSON, not just decisions)
- Reports chunk count, sizes, and source coverage as JSON to stdout

Override the default 40k limit with `MAX_CHARS=50000` env var if needed.

### Delegator's role in the loop

You track the following after each round. Run `wc -c` on every output file to verify sizes before pairing in the next round:

```
Round 1: 777 roots → 450 roots (42% reduction, 180 merges) — 12 chunks, largest 38k chars
Round 2: 450 roots → 310 roots (31% reduction, 85 merges) — 8 chunks, largest 35k chars
Round 3: 310 roots → 285 roots (8% reduction, 15 merges) — 7 chunks, largest 33k chars
```

**If any chunk exceeds ~40k characters after shuffle, re-split it before pairing.** Never dispatch a merge agent with more than ~80k characters of combined input. If you find yourself thinking "it's above the guideline but within context" — stop. That reasoning is exactly what the limit prevents. An agent processing 140k characters of decisions will skim instead of comparing carefully, and the whole point of the pipeline is careful comparison.

**You decide when to stop.** Look at the trend:
- Is the reduction rate flattening? (42% → 31% → 8% → clearly slowing)
- Are the remaining merges negligible? (15 merges across 285 decisions = most are distinct)
- Would another round be worth the compute?

There's no formula. Use your judgment. If the curve is clearly flattening and another round would save a handful of merges at best, stop and move to edge discovery.

**You can also direct the shuffle strategically.** You know which source files each chunk covers (from the summaries). If you notice that "scoring-algorithm" and "signal-tuner" chunks haven't been cross-compared yet, tell the shuffle agent to pair decisions from those sources together in the next round.

### Odd-numbered chunks

If a round produces an odd number of chunks after shuffle, the leftover chunk passes through to the next round unmerged. It gets new merge partners after the next shuffle.

## Step 4: Edge discovery (parallel, strong model)

After consolidation, the remaining decisions are your decision tree. Now discover cross-cutting edges between decisions in different branches.

### What edges mean

| Type | Meaning | Example |
|------|---------|---------|
| `depends-on` | A requires B | JWT auth depends on stateless API |
| `enables` | A makes B possible | GraphQL enables client-side caching |
| `constrains` | A limits options for B | SQLite constrains concurrent writes |
| `contradicts` | A and B are in tension | Real-time updates vs static generation |

Edges can cross ANY depth level. A strategic decision can constrain an implementation detail in another branch.

### Edge discovery approach

Split the decision tree into branch pairs (each top-level decision + its subtree is a "branch"). One sub-agent per pair of branches:

```
Discover cross-cutting edges between two branches of a decision tree.

Read: {path_to_consolidated_decisions}

Focus on these two branches:
- Branch A: "{root_label_A}" and all its sub-decisions
- Branch B: "{root_label_B}" and all its sub-decisions

For each pair of decisions (one from A, one from B), determine if there's
a depends-on, enables, constrains, or contradicts relationship.

Every edge needs an Insight: quotes from the source material that evidence
the connection. If no direct quote exists but the relationship is logically
clear, mark strength as "inferred".

Be conservative. No edge is better than a hallucinated edge.

Write to: {edge_output_path}
Format:
{
  "branch_a": "{root_label_A}",
  "branch_b": "{root_label_B}",
  "edges": [
    {
      "type": "constrains",
      "from": "decision label",
      "to": "decision label",
      "insight": { "quotes": ["..."], "synthesis": "..." },
      "strength": "explicit"
    }
  ],
  "edge_count": {N}
}

Report back ONLY: edge_count.
```

Also run within-branch edge discovery (siblings that affect each other).

## Step 5: Polish and write session graph

One sub-agent reads the final consolidated decisions and all edge files. It:

1. Converts raw_labels into proper `Insight` objects (the label itself needs quote-backing)
2. Fills `trace` fields: extracts `why`, `over`, `impact` from the accumulated quotes
3. Generates `explain` strings (extends label, doesn't repeat it)
4. Assigns consolidated tags (not ad-hoc per-decision — look for natural clusters)
5. Assembles all edges
6. Writes `scopes/{session}/graph.json`

The Insight generation rule: **quotes first, then synthesis.** The sub-agent finds relevant quotes for each field, then generates the synthesis grounded in those quotes. No quotes → empty array, not a hallucinated synthesis.

If the consolidated tree is too large for one polish agent, split by branch — one agent per top-level decision and its subtree.

## Step 6: Offer to merge

After the session graph is written, tell the user:

> "Session complete — extracted {N} decisions with {M} cross-cutting edges from {K} files. The session graph is at `docs/cytospec/scopes/{session}/graph.json`."
>
> If a master graph exists: "Want me to merge this into the master graph?"
> If no master exists: "This is your first session — want me to create the master graph from this?"

If they say yes, load the [merge](merge.md) sub-skill.
