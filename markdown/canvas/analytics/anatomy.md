---
search: hidden
template: canvas
route: /guide/analytics/anatomy
type: analytics
---

# WQL Anatomy & Structure {sticky dark full-bleed}

Learn the building blocks of WQL queries — from aggregators and metrics to dimensions and rollups.

## Metrics Queries {sticky}

Analytics queries aggregate numeric workout facts recorded by the runtime engine.

**Query Shape:**
```wql
<aggregator>:<metric>{<filters>} by {<dimension>}.rollup(<period>)
```

### 1. Aggregators (`agg`)
Math applied to data buckets:
* `sum`: Total sum of metric values in bucket.
* `avg`: Average value per session or bucket.
* `min` / `max`: Boundary values.
* `count`: Total count of recorded data points.
* `last`: Most recent recorded value.
* `delta`: Difference between end and start of period.

### 2. Metrics (`metric`)
* **Base Metrics:** `sessionLoad`, `tis`, `totalReps`, `totalVolume`, `totalDistance`, `metMinutes`, `elapsed`, `pace`, `power`.
* **Calculated Metrics:** `calc.acwr` (acute:chronic workload ratio), `calc.monotony`, `calc.strain`.

### 3. Dimensions (`dimension`) & Rollups (`period`)
* **Time Dimensions:** `day`, `week`, `month`, `year` paired with rollups like `.rollup(1w)` or `.rollup(4w)`.
* **Metadata Dimensions:** `effort`, `discipline`, `intensity`.

## Content Queries {sticky}

Content queries search markdown notes and fenced blocks using the `find:` verb.

**Query Shape:**
```wql
find:<target>{<filters>,source:<scope>} last <n>w
```

### 1. Targets (`target`)
* `find:note`: Returns full markdown notes (journal Notes, Catalog Sessions, Catalog Posts).
* `find:block`: Returns addressable subsets of notes (`wod` blocks, `dashboard` blocks, headings).

### 2. Sources (`source:` filter)
* `source:journal`: User's personal journal notes in IndexedDB.
* `source:collections`: Preloaded Catalog sessions (e.g. Fran, Murph).
* `source:feeds`: Dated Catalog posts.
* `source:all`: Search across all sources simultaneously (the default — omit it).

## What's Next {sticky full-bleed dark}

```button
label:  ← Analytics Overview
target: ex
pipeline:
  - navigate: /guide/analytics
```

```button
label:  Filters & Scopes →
target: ex
pipeline:
  - navigate: /guide/analytics/filters
```
