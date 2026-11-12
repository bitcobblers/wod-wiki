---
name: wod-wql
description: 'Write, validate, and execute WQL (Workout Query Language) find and aggregate queries against WOD Wiki notes, workout blocks, sessions, efforts, tags, and time windows.'
license: MIT
---

# WQL (Workout Query Language) Agent Guide

## Overview

WQL queries structured workout notes, immutable block revisions, movement efforts, tags, and recorded execution sessions across all three WOD Wiki surfaces:
- **CLI**: `wod query '<wql>' --format json` (dry-run syntax check: `wod query '<wql>' --validate-only --json`)
- **MCP / WebMCP**: `wod_query_wql` and `wod_validate_wql`
- **Browser Stream Views**: `ui_set_stream_query`

---

## Query Families

### 1. Find Queries (`:<target>{...}`)
Select entities matching structured filters:

| Target | Purpose | Example |
|---|---|---|
| `:note` | Workout & journal notes | `:note{notebook:journal time:14d}` |
| `:block` | Individual `time` / `log` workout blocks | `:block{effort:thrusters}` |
| `:session` | Completed or logged workout sessions | `:session{time:30d}` |
| `:effort` | Canonical movement / exercise definitions | `:effort{discipline:weightlifting}` |
| `:notebook` | Local and subscribed notebooks | `:notebook{}` |
| `:tag` | Tags across categories | `:tag{}` |
| `:equipment` | Equipment definitions & tags | `:equipment{}` |

Common filters inside `{...}`:
- `notebook:<slug>` — filter notes in a notebook (`journal`, `benchmarks`, etc.)
- `tags:<slug>` — filter by tag
- `effort:<slug>` — filter notes/blocks/sessions involving a movement
- `time:<window>` — relative time window (`7d`, `14d`, `30d`, `90d`, `1y`) or ISO date range

### 2. Aggregate Queries (`:<agg>{...} [by {<dim>}]`)
Roll up recorded workout metrics over time or movement dimensions:

- **Aggregators**: `:sum`, `:count`, `:max`, `:min`, `:avg`
- **Metric families**: `metric:reps`, `metric:weight`, `metric:distance`, `metric:time`, `metric:rounds`, `metric:volume`
- **Grouping dimensions (`by {...}`)**: `day`, `week`, `month`, `effort`, `notebook`

Examples:
```wql
:sum{metric:reps time:30d} by {week}
:sum{metric:reps effort:pull-ups time:90d} by {week}
:max{metric:weight effort:back-squat time:1y}
:count{metric:rounds time:30d} by {effort}
```

---

## Best Practices for Agents

1. **Validate Before Running Unfamiliar Filters**:
   Call `wod_validate_wql` (or `wod query '<wql>' --validate-only --json`) to inspect parsed AST and catch unknown filter keys (exit code `2` on invalid WQL).
2. **Read Live Capabilities**:
   Read MCP resource `wod://schema/wql` for the exact list of valid filter keys per target, aggregators, and virtual dimensions compiled into the current engine version.
3. **Prefer Unbatched Data Tools Over UI Scraping**:
   In the browser, `wod_query_wql` queries IndexedDB / `ApiStorage` directly without UI pagination limits, whereas `ui_set_stream_query` updates the visible stream for the human user.
