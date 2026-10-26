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
