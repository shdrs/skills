# New Session

Analyze markdown files and produce a decision graph. This is the core workflow — it runs the full extraction-to-graph pipeline and produces a session-scoped `graph.json`.

## What happens

1. You identify the input .md files
2. You create a session scope folder
3. You orchestrate the pipeline: extract → consolidate (map-reduce) → polish → discover edges → assemble
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

## Decision format (used from extraction through polish)

Every decision throughout the pipeline uses this shape:

```json
{
  "raw_label": "single-sentence label — THIS is the decision's identity",
  "quotes": ["verbatim text from source files"],
  "context_hint": "topic area",
  "sources": ["file1.md", "file2.md"],
  "source_lines": [[10, 50], [200, 250]],
  "parent": "raw_label of parent decision" | null,
  "depth": 0
}
```

Three non-negotiable rules:

1. **`raw_label` IS the identity.** No `id` field. Ever. When the merge prompt below says "decision label," it means `raw_label`.
2. **`parent` references another decision's `raw_label`.** Not an invented identifier, not an index, not a hash. The literal `raw_label` string of the parent decision.
3. **Flat array with parent references. Never nest children inside parents.** A decision with 3 children produces 4 entries in the `decisions` array — the parent with `"parent": null` and three children each with `"parent": "the parent's raw_label"`.

When a merge changes a decision's `raw_label` (e.g., picking the more concise label after combining two), update every child's `parent` reference to match the new `raw_label`.

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

Applying verdicts:
- MERGE: combine quotes and sources, pick the more concise raw_label.
  If the surviving label differs from either original, update any child
  decisions whose "parent" referenced the old label.
- PARENT_CHILD: set child.parent = parent.raw_label. Both survive as
  separate entries in the flat decisions array.
- SIBLING / UNRELATED: pass through unchanged.

CRITICAL FORMAT RULES — these prevent downstream breakage:
- Each decision is: { "raw_label", "quotes", "context_hint", "sources",
  "source_lines", "parent", "depth" }
- raw_label IS the identity. Do NOT add an "id" field.
- parent is the raw_label of the parent decision, or null. Never an
  invented identifier.
- Output a FLAT decisions array. Never nest children inside parents.
  A parent with 2 children = 3 entries in the array.

Write output to: {output_path}
Format:
{
  "round": {N},
  "input_files": ["{chunk_a_path}", "{chunk_b_path}"],
  "decisions": [
    { "raw_label": "...", "quotes": [...], "context_hint": "...",
      "sources": [...], "source_lines": [...], "parent": null, "depth": 0 },
    { "raw_label": "...", "quotes": [...], "context_hint": "...",
      "sources": [...], "source_lines": [...], "parent": "raw_label of parent", "depth": 1 }
  ],
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

The shuffle has two parts: the applet splits decisions into diverse, size-bounded chunks, then a sub-agent decides which chunks to pair for the next MAP round.

**Part 1: Split** — run the shuffle applet:

```bash
node {{applets_path}}/shuffle.mjs {output_dir} {round} {merge_output_1} {merge_output_2} ...
```

The applet reads all merge outputs, normalizes sources, groups decisions into subtrees (root + descendants — never split across chunks), interleaves subtrees round-robin across source files so every chunk is diverse, and packs them into size-bounded chunks. Override the default 40k limit with `MAX_CHARS=50000` env var if needed.

The applet prints a JSON report to stdout with per-chunk summaries:

```json
{
  "chunks_written": 10,
  "max_chunk_chars": 39985,
  "chunks": [
    {
      "file": "chunk-1.json",
      "path": "/absolute/path/chunk-1.json",
      "chars": 39981,
      "roots": 43,
      "total": 47,
      "sources": ["spec-a.md", "spec-b.md", "spec-c.md"],
      "labels": ["Use JWT for auth", "PostgreSQL for persistence", "..."]
    }
  ]
}
```

The `labels` and `sources` arrays are the key outputs — they tell the pairing sub-agent what's in each chunk without reading the files.

**Part 2: Pair** — dispatch a sub-agent (cheapest model) to decide which chunks to merge next:

```
Here is the shuffle report from round {N} of a decision consolidation pipeline.
There are {chunk_count} chunks to pair for the next merge round.

{paste the full JSON report from stdout}

Decide which chunks to pair. Each merge agent will take exactly TWO chunks
and compare all root-level decisions between them using venn diagram analysis.
The goal is to maximize useful merges — pair chunks that contain:
- Likely duplicates (similar labels from different source files)
- Potential parent-child relationships (broad vs narrow decisions on same topic)
- Related concerns that haven't been cross-compared yet

If there's an odd number of chunks, one goes unpaired to the next round.

Output a JSON array of pairs (by filename):
{ "pairs": [["chunk-1.json", "chunk-4.json"], ["chunk-2.json", "chunk-7.json"], ...] }
If a chunk is unpaired: { "unpaired": ["chunk-10.json"] }
```

Parse the sub-agent's output and dispatch merge agents for each pair.

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
- Are the merge outputs small enough for polish? Check with `wc -c` — each file should be ≤ ~40k characters. If files are larger, either continue consolidating or use the shuffle applet to split them before polishing (see Step 4).

**Cross-file coverage matters.** The consolidation loop produces N merge outputs per round. Decisions in different outputs were only compared if they were once in the same shuffle chunk. Before stopping, check: has the pairing sub-agent had a chance to cross-compare all source files? If not, do one more shuffle+merge round with explicit cross-file pairings. A flattening merge rate within the current pairings doesn't mean all cross-file duplicates are found — it may just mean those particular pairings are exhausted.

There's no formula. Use your judgment. If the curve is clearly flattening AND cross-file coverage is thorough, stop and move to polish.

**You can also direct the pairing strategically.** You know which source files each chunk covers (from the shuffle report). If you notice that "scoring-algorithm" and "signal-tuner" chunks haven't been cross-compared yet, add that as guidance to the pairing sub-agent's prompt for the next round.

### Odd-numbered chunks

If a round produces an odd number of chunks after shuffle, the leftover chunk passes through to the next round unmerged. It gets new merge partners after the next shuffle.

## Step 4: Polish (parallel, strong model)

After consolidation, you have multiple merge output files. Each file is already internally consolidated — its decisions have been through multiple rounds of pairwise comparison. Polish converts the raw intermediate format into the final schema. It's a per-decision transformation, not a consolidation step.

Cross-file deduplication happens later in assembly (Step 6).

### Sizing

Before dispatching, check every merge output with `wc -c`. Polish agents expand their input — adding trace fields, explain strings, and tags typically doubles the character count. **A single polish agent should receive no more than ~40k characters of input.** For larger files, split decisions into groups (by top-level branch and its descendants) and dispatch one agent per group. Write the groups to temporary files so the polish agent has a clean input path.

### Polish sub-agent prompt

```
Read the consolidated decisions at: {merge_output_path}

Convert each decision from the intermediate format to the final schema.

For each decision, produce this exact shape:

{
  "label": {
    "quotes": [the existing quotes array from the intermediate format],
    "synthesis": "the raw_label text, unchanged"
  },
  "parent": "label.synthesis of parent decision" or null,
  "depth": 0 | 1 | 2,
  "sources": ["file1.md", "file2.md"],
  "trace": {
    "why":    [Insight objects — reasons this decision was made],
    "over":   [Insight objects — alternatives considered],
    "impact": [Insight objects — tradeoffs and downstream effects]
  },
  "explain": "one sentence extending the label without repeating it",
  "tags": ["architecture", "data-model", ...]
}

Where each Insight is: { "quotes": ["verbatim text"], "synthesis": "concise summary" }

Conversion rules:

1. label.synthesis = the raw_label from the input, verbatim. This string
   IS the decision's identity — it must match exactly across parent
   references and edge references. Do not rephrase it.

2. parent = the raw_label of the parent decision (which is now that
   parent's label.synthesis). Copy it unchanged. If null, keep null.

3. trace: fill why/over/impact from the accumulated quotes. Find relevant
   quotes first, then write synthesis grounded in them. No quotes → empty
   array, not a hallucinated synthesis.

4. depth: 0 = strategic (broad architectural), 1 = tactical (component),
   2 = implementation detail. Infer from scope.

5. tags: look for natural clusters across ALL decisions in this file,
   not ad-hoc per-decision. Common: architecture, data-model, api-design,
   security, performance, ui, infrastructure, etc.

6. Drop intermediate-only fields: context_hint, source_lines, source_file.
   Do NOT add any fields not listed above (no "id", no "children").

Write to: {polish_output_path}
Format: { "decisions": [...], "decision_count": N }

Report back ONLY: decision_count and the output file path.
```

Dispatch one agent per merge output (or per branch group for oversized files), in parallel. All polish agents write to `polished/part-{N}.json`.

## Step 5: Edge discovery (parallel, strong model)

**This is a separate phase from polish.** Never combine edge discovery and polish into one sub-agent — the combined workload will fail for large files.

After polish, discover cross-cutting edges between decisions in different branches.

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

Read: {path_to_polished_decisions}

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
      "from": "label.synthesis of source decision (exact string match)",
      "to": "label.synthesis of target decision (exact string match)",
      "insight": { "quotes": ["..."], "synthesis": "..." },
      "strength": "explicit"
    }
  ],
  "edge_count": {N}
}

Report back ONLY: edge_count.
```

Also run within-branch edge discovery (siblings that affect each other).

## Step 6: Assemble session graph

Assembly is mechanical — the consolidation loop already handled all deduplication and the polish agents converted everything to the final schema. The assembly applet combines all polished decision files and edge files into one `graph.json`:

```bash
node {{applets_path}}/assemble.mjs {session_scope}/graph.json {session_scope}/polished {session_scope}/edges
```

The applet reads all `.json` files from both directories, concatenates decisions, deduplicates edges (same type + from + to), and writes the graph. It reports stats to stdout:

```json
{
  "decisions": 285,
  "edges": 42,
  "duplicate_edges_removed": 3,
  "polished_files": 4,
  "edge_files": 6,
  "output": "scopes/.../graph.json",
  "output_chars": 182000
}
```

## Step 7: Viewer and next steps

After the session graph is written, copy a fresh viewer to `docs/cytospec/viewer.html`:

```bash
cp {{applets_path}}/viewer.html docs/cytospec/viewer.html
```

Then tell the user:

> "Session complete — extracted {N} decisions with {M} cross-cutting edges from {K} files."
>
> "Open the viewer to explore: `file://{absolute_path_to}/docs/cytospec/viewer.html`"
> "Load your session graph from `docs/cytospec/scopes/{session}/graph.json` via the file picker or drag-and-drop."
>
> If a master graph exists: "Want me to merge this into the master graph?"
> If no master exists: "This is your first session — want me to create the master graph from this?"

If they say yes, load the [merge](merge.md) sub-skill.
