# View

Explore an existing decision graph interactively.

## When to use

- The user wants to browse decisions in their graph
- The user asks "what decisions do we have" or "show me the graph"
- After a merge, when the user wants to see what changed

## What to show

Read the master graph at `docs/cytospec/graph.json` (or the session graph if the user specifies one).

### Overview mode (default)

Show only top-level decisions (depth 0) with their edge connections:

```
Decisions (8 top-level):

  1. "Use microservices architecture"
     └─ 5 sub-decisions, 3 cross-cutting edges
  
  2. "PostgreSQL for persistence"
     └─ 4 sub-decisions, 2 cross-cutting edges
  
  3. "JWT for authentication"
     └─ 2 sub-decisions, 1 cross-cutting edge
  ...

Cross-cutting connections:
  • "Use microservices" ←constrains→ "PostgreSQL for persistence"
  • "JWT for authentication" ←depends-on→ "Use microservices"
  ...
```

### Focus mode

When the user asks about a specific decision, expand it:

```
"Use microservices architecture"
  Explain: Event-driven service boundaries aligned with domain contexts
  Why: "Monolith became unmaintainable after third team joined" (arch-spec.md)
  Over: "Modular monolith was considered but rejected due to deployment coupling"
  Impact: "Forces per-service databases, complicates distributed transactions"
  
  Sub-decisions:
    ├─ "Service mesh for routing" (depth 1)
    │   └─ "Istio for traffic management" (depth 2)
    └─ "Event-driven communication" (depth 1)
        └─ "Kafka for async messaging" (depth 2)
  
  Cross-cutting edges:
    → constrains "One database per service" (under PostgreSQL branch)
    → enables "Independent deployment pipelines" (under DevOps branch)
  
  Sources: arch-spec.md, api-design.md, deployment-plan.md
```

### Stale decisions

If any decisions are flagged `stale: true`, highlight them:

```
⚠ Potentially stale (source files were re-processed but these weren't found):
  • "Use Redis for session storage" (stale since 2026-05-21)
    Sources: auth-spec.md (re-processed), cache-design.md
```

## Interactive viewer

Generate a standalone HTML viewer with the graph data embedded. The viewer applet writes a self-contained file the user can open directly in their browser — no server needed.

```bash
node {{applets_path}}/viewer.mjs {graph_json_path}
```

This writes `viewer.html` next to the graph file and outputs a JSON line with the `file://` URL. Give the user that URL:

> Your graph is ready to explore: `file:///path/to/docs/cytospec/viewer.html`
>
> Open that link in your browser. You can drag nodes to rearrange the layout, click any decision to see its full trace, and double-click to drill into subtrees.

If no graph path is provided, the viewer is written without injected data — the user can load any graph.json via the file picker or drag-and-drop.

### What the viewer provides

- **Overview mode** — top-level decisions only. Cross-cutting edges between deeper decisions get **promoted** to their visible ancestors, so the user sees coupling at the strategic level. Double-click a node to drill into its subtree (focus mode).
- **Expanded mode** — every decision at every depth, with full hierarchy edges and all cross-cutting connections.
- **Coupling mode** — only shows decisions that have cross-cutting edges. Hides everything else. Answers "where are the hidden dependencies?"
- **Focus mode** — click or double-click any decision to see its subtree plus all edges touching any node in that subtree. Breadcrumb navigation to walk back up.

Nodes are auto-sized to fit their full label text and colored by depth (strategic, tactical, implementation). The layout is animated and interactive — drag any node and the graph adjusts around it. Edges are colored by type (depends-on, enables, constrains, contradicts) and dashed when inferred. Stale decisions get an amber dashed border.

Clicking a node opens a detail panel with the full decision: explain, trace (why/over/impact with quotes), connections, sub-decisions, sources, and tags. Clicking a cross-cutting edge shows its evidence.

### When to use the viewer vs text

The text-based exploration above is better for quick lookups — "what are the top-level decisions?" or "show me decision X." The interactive viewer is better for exploration — discovering connections, understanding coupling, navigating the hierarchy spatially.

## Graph statistics

When showing any view, include a brief stats line:

```
Graph: 42 decisions (8 top-level), 15 cross-cutting edges, sourced from 12 files
Last updated: 2026-05-20, 3 sessions merged, 2 decisions flagged stale
```
