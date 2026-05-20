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

## Future: Applet viewer

A Cytoscape-based interactive viewer is planned as an applet for a future session. It will load `graph.json` directly and provide:
- Zoomable graph with hierarchy collapse/expand
- Edge promotion at zoomed-out levels
- Focus-on-click for any decision node
- Filter by tags, depth, staleness
- Multiple rendering modes (overview, expanded, coupling)

For now, the text-based exploration above serves as the interface.

## Graph statistics

When showing any view, include a brief stats line:

```
Graph: 42 decisions (8 top-level), 15 cross-cutting edges, sourced from 12 files
Last updated: 2026-05-20, 3 sessions merged, 2 decisions flagged stale
```
