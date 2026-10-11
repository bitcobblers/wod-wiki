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

A `calculate` block is document-level, not nested inside `wod`.
Each line uses the shape `target = expression`.
Supported functions are:

- `sum`
- `mean`
- `max`
- `min`
- `count`

Supported operators are `+`, `-`, `*`, `/`, `^`, and parentheses.

```time
rpe: 8
(5 Sets)
  5 Deadlifts 225lb
  5 Deadlifts ?lb
```

```calculate
totalLoad = sum(reps * weight)
avgRPE = mean(rpe)
setCount = count(reps)
```

Notes:

- rows with missing inputs are skipped for that calculation
- if a definition cannot resolve to a finite number, it is omitted
- calculations can reference numeric custom metrics and mapped properties
- cross-workout aggregation is out of scope for this v1 syntax

## Example fixtures

- [Custom Metrics Example](/guide/metrics?h=custom-metrics)
- [Calculated Metrics Example](./calculated-metrics.md)
- [Core Syntax](../../../docs/language/syntax-reference.md)
