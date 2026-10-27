---
search: hidden
title: "Summary properties & tag annotations"
subtitle: "Attribute-based metrics, the shake-out queue, and summaries added by tags"
template: canvas
route: /page/guide-metrics-summaries
type: guide
description: "Frontmatter metrics, attribute-based annotations, and workout-level summaries contributed by tags."
---
```chapter
id: metrics-summaries
title: Summary properties
badge: activity
quests: metrics-summaries-run
sections: []
```

```quest
id: metrics-summaries-run
label: Run the summary example
validation:
  type: run-started
```

# Summary properties & tag annotations {sticky dark full-bleed}

Statement-level metrics come from the workout text, Property Notes, and tags. Workout-level summaries aggregate those metrics.

```view
name:    preview
state:   note
source:  wods/examples/syntax/frontmatter-summaries.md
runtime: in-memory
launch:  host
align:   right
width:   50%
```

## Metrics and summaries in frontmatter {#frontmatter-metrics}

The example note declares `metrics.work: reps * resistance` and `summaries.totalWork: sum(work)` in its frontmatter.
The Metric Shake-Out Queue evaluates `work` on every logged statement, then `sum(work)` publishes `totalWork` as a workout-level Summary Metric.

## Summaries added by tags {#tag-summaries}

```button
label:  Try it: Run with #tonnage
target: preview
pipeline:
  - set-state: track
```

Remove the `tags: [tonnage]` property in the editor's frontmatter and put `#tonnage` on the Kettlebell line instead.
The tag supplies the same metric and summary contributions:
`resistance = 24 kg`, `work = reps * resistance`, and `summaries.totalWork = sum(work)`.

## Stacking and overrides {#stacking-overrides}

Tag Categories contribute defaults to their child Tags. Tags, Efforts, Equipment, and note frontmatter stack more specific rules on top. For a Summary Metric with the same key, the note's own definition wins over a tag or Tag Category default, so a shared `summaries.totalWork` can be overridden locally.

## Dependencies and diagnostics {#dependency-diagnostics}

Equations resolve in waves as their inputs arrive. Scalar arithmetic preserves the input unit, so `sum(work) * 2` remains a kilogram-denominated Summary Metric when `work` is in kilograms. A chained metric such as `metrics.power: work / convert(elapsed, s)` uses the statement's execution time, including time supplied while the block runs. If a required input is still missing or the expression cannot produce a number, the statement keeps a Skipped-Dependency Diagnostic naming the failed metric and missing input; the workout can still be saved. Structural session and parent rows do not emit these diagnostics.

## Querying your summaries {#querying-summaries}

Saved Summary Metrics become queryable WQL facts:
```query
sum:totalWork{} by {week} last 6w
```
Use the `+ Add metric` and `+ Add summary` buttons in the editor's Properties panel to create your own frontmatter equations.

## Try it {#try-it}

Run the frontmatter example, then switch between the note-level `tags: [tonnage]` property and an inline `#tonnage` on the Kettlebell line.
Both should produce the same statement `work` metrics and the workout-level `totalWork` summary.

```button
label:  Run
target: preview
open:   view
pipeline:
  - set-state: track
```
