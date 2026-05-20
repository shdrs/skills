# New Session

Analyze markdown files and produce a decision graph. This is the core workflow — it runs the full extraction-to-graph pipeline and produces a session-scoped `graph.json`.

## What happens

1. You identify the input .md files
2. You create a session scope folder
3. You orchestrate the pipeline: extract → consolidate → discover edges → polish
4. The session's `graph.json` is written
5. You offer to merge into the master graph

## Step 1: Setup

Identify the files to process. The user may provide:
- A directory path → find all `.md` files recursively
- Specific file paths → use those
- Nothing → ask which files or directories to process

Create the session scope:
```
docs/cytospec/scopes/{YYYY-MM-DD}-{slug}/
  metadata.json
  chunks/
  tournament/
  edges/
```

The slug is derived from the input file names. If processing `auth-design.md` and `api-spec.md`, the slug might be `auth-api-design`. Keep it short and descriptive.

Write `metadata.json` with the files being processed and their modification timestamps:
```json
{
  "files": {
    "specs/api-design.md": { "modified_at": "2026-05-20T09:00:00Z", "lines": 2400 },
    "specs/auth-spec.md": { "modified_at": "2026-05-19T14:00:00Z", "lines": 800 }
  },
  "created_at": "2026-05-20T15:00:00Z"
}
```

## Step 2: Extract decisions (parallel, cheap model)

Split each file into ~1000 line chunks with ~100 line overlap. Launch one sub-agent per chunk using the cheapest/fastest available model.

### Extraction sub-agent prompt

```
Extract every decision from this chunk of a spec file.

Read the file: {file_path} (lines {start} to {end})

A "decision" is any concrete choice the authors committed to:
- Explicit choices with rationale: "We chose X because Y"
- Stated preferences: "We'll use X for this"
- Implicit assumptions: "The frontend will be built in React"
- Constraints accepted: "We can't use X because Y, so we'll do Z"
- Rejections: "We considered X but rejected it because Y"

For each decision, output a JSON object:
{
  "raw_label": "short label for this decision (single sentence)",
  "quotes": ["verbatim text from the file that evidences this decision"],
  "context_hint": "what broader topic or section this appeared under",
  "source_file": "{file_path}",
  "source_lines": [approximate_start, approximate_end]
}

Be EXHAUSTIVE. Extract every decision, no matter how small. Duplicates
with other chunks will be handled later — never miss one.

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

### What counts as a decision

Strong signals (almost always): "We chose / selected / decided / will use / opted for...", comparisons with conclusions, explicit rejections.

Medium signals (likely): Technology names stated as given, architecture patterns named, constraints stated.

Weak signals (extract anyway): Implicit choices with no rationale, stack choices buried in lists, "we assume" statements.

What is NOT a decision: descriptions of how something works (without choosing it), background context, unanswered questions, TODOs.

## Step 3: Tournament consolidation (parallel waves, strong model)

All candidates need comparing to deduplicate and discover hierarchy. This uses a tournament bracket with venn diagram analysis.

### Venn diagram analysis

For each pair of candidates, evaluate:

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

**SIBLING** (20-50%): Different decisions in same domain. Flag as related.

**UNRELATED** (<20%): No connection.

### Wave mechanics

**Wave 1:** Group candidates by source file (same-file candidates most likely overlap). Batches of ~25. One sub-agent per batch.

**Wave 2+:** Mix across sources to catch cross-file duplicates. Group outputs into batches of ~25 root decisions (subtrees ride along as payload).

**Stop condition:** ≤25 root decisions remain → one final reconciliation agent.

### Tournament sub-agent prompt

```
Consolidate decision candidates using venn diagram analysis.

Read the following files:
{list of input file paths}

These contain decision candidates. Your job:
1. Load all candidates from these files
2. For every plausible pair, run VennAnalysis
3. Apply MERGE, PARENT_CHILD, SIBLING, or UNRELATED verdicts
4. Output a consolidated mini-tree of deduplicated decisions

Only compare ROOT-level decisions against each other. If a previous wave
already established children, carry them as payload — don't re-compare them.

Write output to: {batch_output_path}
Format:
{
  "wave": {N},
  "batch": {M},
  "decisions": [
    {
      "raw_label": "...",
      "quotes": ["all merged quotes"],
      "sources": ["all source files"],
      "context_hint": "...",
      "parent": null,
      "depth": 0,
      "children_labels": ["child1 label", "child2 label"]
    }
  ],
  "root_count": {N},
  "total_count": {N}
}

Report back ONLY: root_count and total_count.
```

The delegator checks `root_count` across all batches. If sum > 25, run another wave. If ≤ 25, run final reconciliation.

## Step 4: Edge discovery (parallel, strong model)

With the hierarchy established in `tournament/final.json`, discover cross-cutting edges between decisions in different branches.

### What edges mean

| Type | Meaning | Example |
|------|---------|---------|
| `depends-on` | A requires B | JWT auth depends on stateless API |
| `enables` | A makes B possible | GraphQL enables client-side caching |
| `constrains` | A limits options for B | SQLite constrains concurrent writes |
| `contradicts` | A and B are in tension | Real-time updates vs static generation |

Edges can cross ANY depth level. A strategic decision can constrain an implementation detail in another branch.

### Edge discovery sub-agent prompt

Split the tree into branch pairs (one pair per sub-agent):

```
Discover cross-cutting edges between two branches of a decision tree.

Read: {path_to_tournament_final}

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

One sub-agent reads `tournament/final.json` and all edge files. It:

1. Converts raw_labels into proper `Insight` objects (the label itself needs quote-backing)
2. Fills `trace` fields: extracts `why`, `over`, `impact` from the accumulated quotes
3. Generates `explain` strings (extends label, doesn't repeat it)
4. Assigns consolidated tags (not ad-hoc per-decision — look for natural clusters)
5. Assembles all edges
6. Writes `scopes/{session}/graph.json`

The Insight generation rule: **quotes first, then synthesis.** The sub-agent finds relevant quotes for each field, then generates the synthesis grounded in those quotes. No quotes → empty array, not a hallucinated synthesis.

## Step 6: Offer to merge

After the session graph is written, tell the user:

> "Session complete — extracted {N} decisions with {M} cross-cutting edges from {K} files. The session graph is at `docs/cytospec/scopes/{session}/graph.json`."
>
> If a master graph exists: "Want me to merge this into the master graph?"
> If no master exists: "This is your first session — want me to create the master graph from this?"

If they say yes, load the [merge](merge.md) sub-skill.
