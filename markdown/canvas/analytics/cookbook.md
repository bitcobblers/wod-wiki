---
search: hidden
template: canvas
route: /guide/analytics/cookbook
type: analytics
---

# Cookbook & In-Note Dashboards {sticky dark full-bleed}

Copy canonical WQL queries and learn how to build dashboards directly inside your Markdown notes.

## Canonical Query Examples {sticky}

### Weekly Strength Volume
```wql
sum:totalVolume{discipline:strength} by {week}.rollup(1w)
```

### Top Volume Movements
```wql
sum:totalVolume{} by {effort}
```

### Training Intensity Score (TIS) Trend
```wql
avg:tis{} by {week}.rollup(1w)
```

### Acute:Chronic Workload Ratio (ACWR)
```wql
avg:calc.acwr{}
```

### Search Benchmark Notes
```wql
find:block{text:fran,source:collections}
```

## Embedding Queries in Notes (` ```query `) {sticky}

You can insert a WQL query directly into any note. The editor renders it inline as a live result widget:

````markdown
```query
sum:totalVolume{discipline:strength} by {week}.rollup(1w)
```
````

## Creating Dashboard Notes {sticky}

A dashboard is a note, not a block: mark it `dashboard: true` in frontmatter and compose `query` blocks — the heading above each block becomes the widget title, the paragraph its coaching question, and `dashboard.*` frontmatter tokens become top-level controls referenced as `$name` (#899):

````markdown
---
title: Training Review
dashboard: true
dashboard.weeks: 16
---

## Avg TIS
How hard are sessions?

```query:value
avg:tis{}
```

## Weekly tonnage
Is volume rising?

```query:timeseries-2
sum:totalVolume{} by {week}.rollup(1w)
```

## Volume by effort
Where does the volume go?

```query:toplist
sum:totalVolume{} by {effort}
```
````

Widget types: `table` (default), `value`, `timeseries`, `bar`, `toplist`, `stacked-bar`. Grid span rides the suffix: `query:timeseries-2` spans 2 columns, `-full` spans the row.

Edit any widget in place by clicking **Edit Widget Query** in the note editor.

## What's Next {sticky full-bleed dark}

```button
label:  ← Cross-Store Joins
target: ex
pipeline:
  - navigate: /guide/analytics/joins
```

```button
label:  WQL Cheat Sheet →
target: ex
pipeline:
  - navigate: /guide/analytics/cheatsheet
```
