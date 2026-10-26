---
search: hidden
title: "Summary properties"
subtitle: "Frontmatter metrics and workout-level summaries"
section: custom-metrics
order: 6
tags: [tonnage]
metrics.work: reps * resistance
summaries.totalWork: sum(work)
---

# Tuesday — Frontmatter metrics & summaries

## Frontmatter metrics and workout summaries

The note's frontmatter provides `metrics:` (statement-level values or equations) and `summaries:` (workout-level aggregation).
Run the block: each set gets `work = reps * resistance` and the note publishes `totalWork = sum(work)`.

```time
(2 Sets)
  10 Kettlebell Swings 24kg
  *:30 Rest
```

## Summaries added by tags

Remove `tags: [tonnage]` above and add `#tonnage` to the Kettlebell line instead.
The tag contributes `resistance = 24 kg`, `work = reps * resistance`, and `summaries.totalWork = sum(work)` automatically.
