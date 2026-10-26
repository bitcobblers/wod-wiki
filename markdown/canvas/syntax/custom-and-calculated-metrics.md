---
search: hidden
title: "Custom & Calculated Metrics"
subtitle: "Property statements become metrics; calculate blocks derive summaries"
section: advanced
order: 5
---

Custom metrics let you attach line-local metadata without inventing new syntax for every field.
Calculated metrics let you derive summary values from the workout after the parser has collected the raw statements.

## Custom metric statements

A property line is a top-level statement in the form `key: value`.
It accepts scalar values only:

- numbers
- bare identifiers
- quoted strings

Known keys map to canonical metric types:

- `rpe` → session RPE
- `rir` → reps in reserve
- `intensity` → intensity
- `load` → load
- `volume` → volume
- `work` → work

Any other key stays visible as a custom metric.
That includes coach-specific fields like `location`, `surface`, or `note`.

```time
rpe: 8
location: "Garage"
surface: indoor
(5 Sets)
  5 Deadlifts 225lb
  *2:00 Rest
```

Notes:

- property lines are statement-local, not nested under child lines
- nested objects and arrays are not part of v1
- custom metrics stay visible even when there is no canonical mapping

## Calculated metrics

Frontmatter `metrics:` derive statement-level metrics and `summaries:` derive workout-level values.
Each uses the shape `metrics.<name>: <value-or-equation>` and `summaries.<name>: <equation>`.
Supported operators are `+`, `-`, `*`, `/`, and parentheses; `convert(x, unit)` converts units.

```yaml
metrics.work: reps * resistance
summaries.totalWork: sum(work)
summaries.avgRPE: avg(sessionRpe)
```

Notes:

- rows with missing inputs are skipped for that calculation
- if a definition cannot resolve to a finite number, it is omitted
- calculations can reference numeric custom metrics and mapped properties
- tag Property Notes can contribute metrics and summaries when a note or statement carries the tag

## Example fixtures

- [Custom Metrics Example](/page/guide-metrics?h=custom-metrics)
- [Calculated Metrics Example](./calculated-metrics.md)
- [Core Syntax](../../../docs/language/syntax-reference.md)
