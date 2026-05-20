---
name: cytospec
description: Extracts decisions from markdown files (specs, plans, design docs) and maps them into a graph. Use this skill whenever someone wants to understand what decisions were made across their spec files, map out a decision pipeline, reduce a large corpus of markdown into browsable insights, visualize how specs relate to each other, or find hidden dependencies between design decisions. Also triggers when someone mentions decision graphs, spec analysis, decision mapping, spec consolidation, or asks things like 'what decisions did we make' or 'how do these specs connect.' Works on any .md file — one or thousands.
license: MIT
---

Extracts decisions from markdown files and maps how they relate — producing a graph that compresses large spec corpora into browsable, interconnected insights.

## Why decisions, not topics

Topics are what you wrote about. Decisions are what you committed to. A spec file about "Authentication" is a topic. "Use JWT over session cookies because of our stateless API constraint" is a decision. Decisions have rationale, alternatives, tradeoffs, and downstream impact. They connect to other decisions across files. That's what makes them graph-worthy.

## The living artifact

cytospec produces a persistent folder that grows across sessions:

```
docs/cytospec/                              ← root (configurable)
  graph.json                                ← master graph, accumulated
  scopes/
    2026-05-20-auth-api-design/             ← one session
      metadata.json
      chunks/
      rounds/
      edges/
      graph.json                            ← session's standalone graph
```

Each session produces its own `graph.json`. Then a merge integrates it into the master. The master is the accumulated truth — decisions grow, evidence accumulates, stale decisions get flagged (never deleted).

## Data model

Use this schema exactly. Field ordering matters — it matches the generation sequence (find quotes first, then synthesize).

```
Insight {
  quotes: string[]           // verbatim evidence from source .md files
  synthesis: string          // generated AFTER finding quotes — concise, 0 filler words
}

Decision {
  label: Insight             // THE ID — label.synthesis is a unique single sentence
  parent: string | null      // label.synthesis of parent decision (hierarchy)
  depth: number              // 0=strategic, 1=tactical, 2=implementation
  sources: string[]          // .md file paths that contributed evidence

  trace: {
    why:    Insight[]        // reasons this decision was made (empty if none found)
    over:   Insight[]        // alternatives considered (empty if none stated)
    impact: Insight[]        // tradeoffs and downstream effects (interpretation OK)
  }
  explain: string            // extends label without repeating it
  tags: string[]             // topic tags for clustering/filtering

  // Living artifact metadata (added during merge stage)
  source_verified: {}        // file → ISO timestamp when last verified
  first_seen: string         // when first added to master
  last_verified: string      // when last confirmed by a session
  stale: boolean             // flagged if source re-processed but decision missing
}

Edge {
  type: "depends-on" | "enables" | "constrains" | "contradicts"
  from: string               // decision label.synthesis
  to: string                 // decision label.synthesis
  insight: Insight           // quote-backed evidence this connection exists
  strength: "explicit" | "inferred"
}

DecisionGraph {
  decisions: Decision[]
  edges: Edge[]
}
```

## Talking to the user

Never say "sub-skill" or "applet." Present all files as `cytospec/filename`, stripping internal directories like `sub-skills/` and `applets/`:

| ❌ Don't say | ✅ Say instead |
|---|---|
| "Loading the `new` sub-skill" | "Loading `cytospec/new.md`" |
| "Running the viewer applet" | "Running `cytospec/viewer.mjs`" or "Running the viewer" |
| "Opening `cytospec/applets/dashboard/index.html`" | "Opening `cytospec/dashboard/index.html`" |

Also avoid pipeline jargon — the user doesn't need to hear about "map-reduce rounds," "shuffle phases," or "pairwise merge agents." Describe what's happening in plain terms: "comparing decisions across files," "deduplicating," "looking for connections." The internals are your concern, not theirs.

## Before starting a pipeline run

When beginning a `new` session, briefly tell the user what's about to happen in plain language. Ground it in *their* files, not in abstract pipeline stages. Something like:

> I'll analyze your 4 JACG spec files and extract every decision the authors committed to — architecture choices, technology picks, tradeoffs, rejections. Then I'll cross-compare everything to deduplicate and build a hierarchy, and finally map out how decisions in different areas connect to each other.
>
> This is a deep analysis — I'll be dispatching many sub-agents to read, compare, and consolidate in parallel. For 4 files it should take a few minutes; for a larger corpus it can take significantly longer and use a lot of tokens. You can stop the generation at any point without losing work — all progress is saved to disk as it happens.

Adapt the details to the actual situation — number of files, what they're about, estimated scope. Don't recite a template. The point is: the user should understand (1) what they'll get, (2) that it's compute-intensive, and (3) that they're in control.

## Commands

| Command | What the user wants | Guide |
|---------|-------------------|-------|
| `/cytospec new specs/` | "Analyze these spec files" | [new](sub-skills/new.md) |
| `/cytospec merge` | "Merge my latest session into the master" | [merge](sub-skills/merge.md) |
| `/cytospec view` | "Show me the decision graph" | [view](sub-skills/view.md) |
| `/cytospec status` | "What's in my graph?" | [status](sub-skills/status.md) |
| `/cytospec` | No argument — assess what the user needs | See routing below |

## Routing

1. **Argument is a sub-command** (`new`, `merge`, `view`, `status`): Load the corresponding guide.
2. **Argument is a path or file list**: Treat as `new` — the user wants to analyze those files.
3. **No argument**: Check context.
   - If there's a recent unmerged session → ask if they want to merge it
   - If a master graph exists → ask if they want to view it, run a new session, or check status
   - If nothing exists → ask what files to analyze and start a new session

## Delegation principles

You are a **delegator** when running the pipeline. You orchestrate sub-agents but never read their data directly. Your context holds only file paths, counts, and status summaries.

- **Never read input .md files yourself.** Not even "to get a sense of them." You only need line counts and timestamps — get those from Bash commands (`wc -l` for line counts, `stat` for modification timestamps). The file content belongs in sub-agent context, not yours.
- **Never read chunk, round, edge, or graph JSON files.** Sub-agents read each other's files. Data flows sub-agent → file → sub-agent. Never through you.
- **Tell sub-agents WHERE to read and write.** Every sub-agent prompt includes explicit file paths for input and output.
- **Track progress by counts only.** "Wave 2 produced 45 roots across 3 batches" — never the decisions themselves.
- **Use real file timestamps.** Run `stat -f '%Sm' -t '%Y-%m-%dT%H:%M:%SZ' <file>` (macOS) or `stat -c '%y' <file>` (Linux) to get actual modification times. Never infer timestamps from filenames.
- **Cheapest model for extraction** (Stage 1 is mechanical). **Strongest model for everything else** (judgment calls).
- **Chunks use line ranges.** Tell extraction agents: "Read file X, lines 0-1000." They use the Read tool with offset/limit. You do NOT copy file content into sub-agent prompts.

## After producing a graph

Whenever a `graph.json` is created or updated — whether from a `new` session, a `merge`, or any other operation — always offer the interactive viewer. Load the [view](sub-skills/view.md) guide to generate the viewer HTML and give the user a `file://` link they can open in their browser.

## What cytospec does NOT do

- **Code analysis.** cytospec reads markdown, not source code. For code architecture graphs, use other tools.
- **Summarization.** cytospec extracts decisions with quote-backed evidence. It doesn't summarize content — it structures it.
