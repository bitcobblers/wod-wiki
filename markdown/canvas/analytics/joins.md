---
search: hidden
template: canvas
route: /guide/analytics/joins
type: analytics
---

# Cross-Store Joins {sticky dark full-bleed}

WQL bridges markdown notes and numeric analytics using the `where` clause.

## Joining Content & Facts {sticky}

A cross-store query finds notes or blocks based on numeric thresholds computed by the analytics engine.

**Example Query:**
```wql
find:note{tags:pr,source:journal} last 8w where sum:totalVolume{} > 5000
```

This query:
1. Filters journal notes modified in the last 8 weeks with tag `pr`.
2. Evaluates total volume (`sum:totalVolume{}`) for workout results linked to those notes.
3. Keeps only notes whose total volume exceeds 5,000 kg.

## Block Content Id Join Mechanics {sticky}

When you run a workout block in a note, the runtime assigns a deterministic **Block Content Id** (FNV-1a hash of the block's text).

* **Log Authority:** Raw `WorkoutResult` logs remain the single source of truth.
* **Block Stability:** Reordering or editing lines outside a `wod` block does not break its join history because the Block Content Id stays identical.
* **Cross-Note Aggregation:** Cloning a benchmark workout (like "Fran") from a Catalog into your journal preserves its Block Content Id, aggregating history across all notes where that workout lives.

## What's Next {sticky full-bleed dark}

```button
label:  ← Filters & Scopes
target: ex
pipeline:
  - navigate: /guide/analytics/filters
```

```button
label:  Cookbook & Dashboards →
target: ex
pipeline:
  - navigate: /guide/analytics/cookbook
```
