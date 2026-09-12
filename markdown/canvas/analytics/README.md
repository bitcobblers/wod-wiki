---
search: hidden
template: canvas
route: /guide/analytics
type: analytics
---

# Analytics Query Guide {sticky dark full-bleed}

Wod Query Language (WQL) is the unified query language driving cross-workout analytics and content discovery across WOD Wiki.

You write workouts in `wod` blocks, run them with the timer, and **query** what you did using WQL.

## The Three WQL Surfaces {sticky}

WQL progressive disclosure maps across three surfaces in the application:

1. **Library (`/library`) — Browse Mode:** Zero-syntax discovery using tri-state source toggles (Note / Session / Post), free-text search, and time-range presets to find entries.
2. **Explorer (`/analytics/explorer`) — Explore Mode:** Interactive WQL workbench with a visual composer, sentence builder, and chart previews.
3. **In-Note Blocks — Compose Mode:** Embedded ````query``` fenced blocks (optionally typed, ````query:timeseries-2```) inside plain Markdown notes that render live results inline; a note marked `dashboard: true` composes them into a dashboard (#899).

## Two Query Planes {sticky}

WQL operates across two distinct query planes:

| Query Plane | Syntax Pattern | What It Searches | Example |
|---|---|---|---|
| **Metrics Plane** | `<agg>:<metric>{<filters>} by {<dimension>}` | Numeric fact store (`totalVolume`, `tis`, `sessionLoad`) | `sum:totalVolume{discipline:strength} by {week}.rollup(1w)` |
| **Content Plane** | `find:<target>{<filters>,source:<scope>}` | Journal notes, Catalog sessions, and dated Posts | `find:note{effort:thruster,source:journal} last 8w` |

The two planes can be joined using the `where` clause:
`find:note{tags:pr,source:journal} last 8w where sum:totalVolume{} > 5000`

## What's Next {sticky full-bleed dark}

```button
label:  WQL Anatomy & Syntax →
target: ex
pipeline:
  - navigate: /guide/analytics/anatomy
```

```button
label:  Filters & Scopes →
target: ex
pipeline:
  - navigate: /guide/analytics/filters
```

```button
label:  Cross-Store Joins →
target: ex
pipeline:
  - navigate: /guide/analytics/joins
```

```button
label:  Cookbook & Dashboards →
target: ex
pipeline:
  - navigate: /guide/analytics/cookbook
```

```button
label:  WQL Cheat Sheet →
target: ex
pipeline:
  - navigate: /guide/analytics/cheatsheet
```
