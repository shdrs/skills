# Merge

Merge a session's decision graph into the master `graph.json`. The master is the living artifact that accumulates across sessions.

## When to use

- After a `new` session completes and the user wants to integrate it
- When the user has an unmerged session from a previous run
- When the user says "merge" or "update the master graph"

## Principles

1. **Additive by default.** Don't overwrite fields with semantically identical new content. If the master already has a label string, keep it.
2. **Evolution-aware.** If source .md files have been modified since the master last saw them, the session's synthesis may be more current.
3. **Never destructive.** Don't delete decisions. Flag staleness. The developer decides.

## How it works

A sub-agent reads both graphs and the session metadata, then applies four merge cases:

### The four cases

**Case 1: Same decision, source files unchanged.**
Session found a decision that's already in the master. The source files haven't been modified since master last verified them.
→ Keep master's label and synthesis verbatim. Merge evidence additively (union of quotes, union of sources). Update `last_verified`.

**Case 2: Same decision, source files are NEWER.**
The source file's `modified_at` is newer than what `source_verified` recorded.
→ The spec evolved. Prefer the session's synthesis for fields derived from the changed file. Keep accumulated evidence from unchanged files. Update `source_verified` timestamps.

**Case 3: New decision, not in master.**
No match found in the master graph.
→ Add fresh. Set `first_seen`, `last_verified`, `source_verified`, `stale: false`.

**Case 4: Master decision not found in session.**
Master has a decision sourced from files that this session also processed, but the session didn't find it.
→ Set `stale: true` and `stale_since: now`. Don't delete. Don't modify other fields.

### Matching decisions

Use venn diagram analysis (same as the tournament) to match session decisions against master decisions. MERGE verdict → Case 1 or 2 (check timestamps). No match → Case 3.

For master decisions not matched: check if the session processed the same source files. If yes → Case 4. If no → leave untouched.

### Edges during merge

- Matching decisions: deduplicate edges. Keep master's edge insight if unchanged.
- New decisions: check for new edges to existing master decisions.
- Stale decisions: edges inherit the stale flag.

## Merge sub-agent prompt

```
Merge a session's decision graph into the master graph.

Read:
- Session graph: {session_graph_path}
- Session metadata: {session_metadata_path}
- Master graph: {master_graph_path}

Apply the four merge cases:
1. Same decision, unchanged files → keep master strings, add evidence additively
2. Same decision, newer files → update synthesis from session, keep old evidence
3. New decision → add to master with timestamps
4. Missing decision from overlapping files → flag stale: true

Use venn diagram analysis to match decisions between graphs.
File timestamps in metadata determine Case 1 vs Case 2.

Write updated master to: {master_graph_path}

Report back:
- Decisions merged (Case 1): N
- Decisions updated (Case 2): N
- Decisions added (Case 3): N
- Decisions flagged stale (Case 4): N
- New edges: N
- Stale edges: N
```

## If the master graph is too large

If the master has hundreds of decisions, chunk the merge:
1. Split master into groups of ~25 decisions
2. Compare session graph against each group in parallel
3. Collect all merge actions
4. Apply in a final pass

Same delegation pattern — by file paths and counts, never reading data yourself.

## First run (no master exists)

The session graph becomes the master. Add `first_seen`, `last_verified`, `source_verified`, and `stale: false` to every decision. No merge needed — just copy and annotate.

## After merging

Report the merge summary to the user:

> "Merged into master graph: {N} existing decisions confirmed, {M} updated (specs evolved), {K} new decisions added, {J} flagged as potentially stale."

If any decisions were flagged stale, mention it specifically:

> "{J} decisions were flagged as potentially stale — they were sourced from files you re-processed but weren't found this time. Run `/cytospec status` to review them."
