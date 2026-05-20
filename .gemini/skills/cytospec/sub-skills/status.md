# Status

Show the current state of the cytospec living artifact — what sessions exist, what's in the master graph, what files have been covered, and what might be stale.

## When to use

- The user asks "what's in my graph?" or "cytospec status"
- Before running a new session, to understand current coverage
- After noticing stale flags from a merge

## What to report

### Sessions

List all scopes in `docs/cytospec/scopes/`, showing:

```
Sessions:
  1. 2026-05-19-auth-api-design (merged)
     Files: auth-spec.md, api-design.md
     Decisions extracted: 35 → 18 after consolidation
  
  2. 2026-05-20-database-migration (merged)
     Files: database-design.md, migration-plan.md
     Decisions extracted: 22 → 12 after consolidation
  
  3. 2026-05-21-frontend-rework (unmerged)
     Files: ui-spec.md, component-plan.md
     Decisions extracted: 28 → 15 after consolidation
     ⚠ Not yet merged into master graph
```

Read each scope's `metadata.json` for file lists and timestamps. Check if a scope's graph was merged by comparing its decisions against the master.

### Master graph summary

```
Master graph: 42 decisions (8 top-level), 15 edges
  Depth 0 (strategic):     8 decisions
  Depth 1 (tactical):     19 decisions
  Depth 2 (implementation): 15 decisions
  
  Stale: 2 decisions flagged
  Sources: 6 unique .md files
```

### File coverage

Show which files have been processed and when:

```
File coverage:
  specs/auth-spec.md          last verified 2026-05-19
  specs/api-design.md         last verified 2026-05-19
  specs/database-design.md    last verified 2026-05-20
  specs/migration-plan.md     last verified 2026-05-20
  specs/ui-spec.md            ⚠ processed but not merged
  specs/component-plan.md     ⚠ processed but not merged
  specs/deployment-plan.md    never processed
```

This helps the user see what's covered and what gaps exist.

### Stale decisions

If any decisions are stale, list them with context:

```
Stale decisions (2):
  • "Use Redis for session storage"
    Flagged stale: 2026-05-20 (auth-spec.md was re-processed but this wasn't found)
    Action: review whether this decision was removed from the spec
  
  • "Manual database migrations"
    Flagged stale: 2026-05-20 (migration-plan.md was re-processed)
    Action: review — may have been replaced by automated migrations
```

### Suggested actions

Based on the status, suggest what the user might want to do:

- Unmerged sessions → "Run `{{command_prefix}}cytospec merge` to integrate session 3"
- Unprocessed files → "Run `{{command_prefix}}cytospec new specs/deployment-plan.md` to analyze uncovered files"
- Stale decisions → "Review stale decisions — they may reflect spec evolution"
- Everything clean → "Graph is up to date. Run `{{command_prefix}}cytospec view` to explore."
