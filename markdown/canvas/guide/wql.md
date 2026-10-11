---
search: hidden
template: canvas
route: /guide/wql
type: guide
title: "Query Your Training (WQL)"
---

# Query Your Training (WQL) {sticky dark full-bleed}

WQL (Wod Query Language) queries your journal across two planes: numeric **facts** the clock recorded, and the markdown **content** those facts came from. The panel on the right is a live query sandbox: the ```query block renders real results, and editing the query line re-runs it as you type — switch presets with the tabs as each section loads them.

```view
name:    sandbox
state:   note
source:  wql-presets/aggregate-by-week.md
runtime: in-memory
launch:  host
align:   right
width:   50%
```

```query
sum:totalVolume{discipline:strength} by {week} last 6w
```

Three surfaces use the same language: the **Library** (zero-syntax tri-state browsing), the **Explorer** (`/dashboards` workbench), and **in-note ```query blocks** — the one this chapter focuses on, which [dashboards](/guide/dashboards) compose.

## The two planes {#planes}

| Plane | Shape | Searches | Example |
|---|---|---|---|
| **Metrics** | `agg:metric{filters} by {dim}` | the fact store | `sum:totalVolume{} by {week}` |
| **Content** | `:target{filters,source:scope}` | notes, blocks, efforts | `:note{effort:fran,source:journal} last 8w` |

## Aggregate queries {#aggregate}

```button
label:  Try it: Weekly volume
target: sandbox
pipeline:
  - set-source: wql-presets/aggregate-by-week.md
```

```button
label:  Try it: By effort
target: sandbox
pipeline:
  - set-source: wql-presets/aggregate-by-effort.md
```

```button
label:  Try it: TIS trend
target: sandbox
pipeline:
  - set-source: wql-presets/tis-trend.md
```

```
<aggregator>:<metric>{<filters>} by {<dimension>} last <window>
```

**Aggregators** — `sum`, `avg`, `min`, `max`, `count`, `last` (most recent value), `delta` (change across the window).

**Metrics** — two tiers of stored facts, plus everything calculated:

- Tier-2 aggregates: `totalVolume`, `totalReps`, `totalDistance`, `tis`, `sessionLoad`
- Metric families: `reps`, `distance`, `resistance`, `elapsed`, `power`, `pace`
- Calculated: the [`calc.*` list](/guide/metrics?h=calculated) (`calc.acwr`, `calc.e1rm`, `calc.readiness`, …)

`avg:session-rpe{}` works too — [captured metrics](/guide/metrics?h=session-rpe) are facts like any other.

```button
label:  Try it: Session RPE
target: sandbox
pipeline:
  - set-source: wql-presets/session-rpe.md
```

**Dimensions** — time buckets `day`, `week`, `session`, `round`; metadata `effort`, `discipline`, `intensity`, `grade`; and any [custom property you authored](/guide/metrics?h=custom-metrics) (`by {coach}`).

### Filters {#filters}

```button
label:  Try it: Filter combos
target: sandbox
pipeline:
  - set-source: wql-presets/filter-combos.md
```

Inside the braces:

| Filter | Meaning |
|---|---|
| `{effort:thruster}` | exact match |
| `{!discipline:recovery}` | negation — exclude |
| `{discipline:strength\|gymnastics}` | OR |
| `{text:fran}` | substring (content plane) |
| `{intensity:high}` | intensity tier — one of `low`, `moderate`, `high` |
| `{tags:benchmark}` | note tags |
| `{coach:greg}` | your custom property |

### Sources {#sources}

```button
label:  Try it: source:journal
target: sandbox
pipeline:
  - set-source: wql-presets/source-journal.md
```

The `source:` filter names where content lives — plural values:

`journal` (your notes) · `feeds` (catalog sessions) · `guides` · `playground` (plus `dashboards`, `efforts`)

Omitting `source:` searches **all** of them — there is no `source:all` (the parser refuses it). Pin one catalog with an id: `catalog:crossfit-girls`. The old `source:collections` spelling is retired — the parser errors; write `feeds` (storage keeps `collection:`-prefixed sourceIds).

Journal scope includes user-created clones whose `sourceId` points to the original note UUID or legacy `journal/YYYY-MM-DD` ID. That backlink does not turn a clone into imported content. Seeded guides, catalog notes, dashboards, efforts, and equipment remain excluded.

### Windows {#windows}

One per query, at the end: relative — `last 7d`, `last 6w`, `last 12w` — or absolute — `from 2026-01-01 to 2026-03-31` (both dates included; drop `to …` to stay open). There is no `since:` keyword.

### Grouping & rollups {#grouping-rollup}

`by {week}` buckets; multiple dimensions group hierarchically — `by {intensity, week}`. Smooth weekly series with `.rollup(2w)` or `.rollup(4w)` (any multi-day/multi-week period; `.rollup(1w)` is refused — use `by {week}`).

### Where joins {#joins}

```button
label:  Try it: Where join
target: sandbox
pipeline:
  - set-source: wql-presets/where-join.md
```

Content queries can require a numeric threshold computed over each result's linked workouts:

```query
:note{tags:pr,source:journal} last 8w where sum:totalVolume{} > 5000
```

Keep only journal notes tagged `pr` whose total volume exceeds 5,000 kg. Joins are supported on `:note` and `:block`; other targets report an advisory and ignore the clause. Joins lean on the **Block Content Id** — a content hash of each workout block, stable across reorders and preserved when you clone a catalog benchmark into your journal, so history aggregates across every note where that workout lives.

## Content queries {#content}

```button
label:  Try it: fran
target: sandbox
pipeline:
  - set-source: wql-presets/content-fran.md
```

```query
:block{text:fran,source:feeds}
```

Targets: `:note` (whole notes), `:block` (addressable fenced blocks), `:effort` (registry entries, filterable by `effort`, `discipline`, `intensity`, `origin`, `text`), plus the advanced `:session`, `:segment`, `:event` for recorded results and raw rows. Content-only keys (`type`, `text`, `has`, `source`, `catalog`) are category errors on aggregates.

The search palette's FIND mode matches note titles and bodies within its selected scope and time window. Type plain text or a quoted phrase such as `"workout in the park"`; clearing the text restores the scope. WQL mode retains diagnostics for malformed queries. Freeform CONTAINS rows have no count badge; the results total reports matches.

### Presentation pipes {#pipes}

```button
label:  Try it: limit 5
target: sandbox
pipeline:
  - set-source: wql-presets/pipes-limit.md
```

Content queries can end with pipes — `| select … | order by … | limit … [offset …]`:

```query
:note{tags:pr,source:journal} last 8w | limit 5
```

`order by <column> [asc|desc]` sorts by a field of the result rows; `select` picks columns (with `in kg`/`in lb` units). Pipes ride on content queries — aggregates don't take them — and some targets ignore a pipe and say so via advisory (`:session` always orders by completion time; `| select` only reshapes `:segment` and `:event`).

## Try it {#try-it}

**Run** — after running the kettlebell note a few times this week ([First Workout](/guide/start?h=try-it)), edit the sandbox query above: change `by {week}` to `by {effort}`, or swap `{discipline:strength}` for `{!discipline:recovery}` — results re-run as you type. **Observe** — sample fallbacks are always badged and never written as your results; this chapter only reads what runs saved. For the interactive workbench, open the [Explorer on the dashboards page](/dashboards).

```button
label:  Open the Explorer →
target: preview
pipeline:
  - navigate: /dashboards
```

