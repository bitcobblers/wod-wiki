---
search: hidden
template: canvas
route: /page/guide-dashboards
type: guide
title: "Dashboards & Cookbook"
description: "Dashboards are notes with YAML query widgets — frontmatter tokens, WQL data selection, and the visual builder."
---

# Dashboards & Cookbook {sticky dark full-bleed}

A dashboard is **just a note**: mark it `dashboard: true`, and every in-note ```query block becomes a widget on one grid. **WQL** selects and aggregates data (`query:` / `series:`), while **YAML** inside ```query describes layout, titles, multi-series baselines, formulas, goals, columns, and sorting.

```view
name:    sandbox
state:   note
source:  dashboards/training-block-review.md
runtime: in-memory
launch:  host
align:   right
width:   50%
```

## The note is the dashboard {#note-frontmatter}

The real board is already loaded in the sandbox.

````markdown
---
title: Training Block Review
dashboard: true
dashboard.weeks: 16
---

```query
title: Avg TIS
description: How hard are sessions?
view: value
query: avg:tis{}
```

```query
title: Weekly tonnage
description: Is volume rising?
view: timeseries
span: 2
window: $weeks w
query: sum:totalVolume{} by {week}
```
````

Three conventions:

- **1-line WQL shorthand** (`:session{result:<id>}`) stays valid inside ```query for zero-boilerplate session tables, expanding into YAML only when customized.
- **Self-contained YAML** inside ```query owns `title`, `description`, `view`, `span` (`1..4` or `full`), `window`, `groupBy`, `goal`, `targets`, `columns`, `sort`, and `query` / `series`.
- `dashboard.weeks`, `dashboard.intensity: [low, moderate, high]`, or any `dashboard.<name>` value in frontmatter becomes a **token control** referenced directly in WQL or YAML as `$name` — `$weeks`, `$intensity`, `$scope`. List tokens render as segmented controls; unknown token references produce a visible refusal, never a silent blank.

## Widget views and multi-series YAML {#widgets}

```button
label:  Try it: Benchmark PR board
target: sandbox
pipeline:
  - set-source: dashboards/benchmark-pr-board.md
```

Every ```query block sets `view:` (defaulting to `table` for 1-line shorthand) and optional `span:` on a 4-column grid:

| `view:` | Renders |
|---|---|
| `table` (default) | sortable session/segment rows with dynamic custom metrics & PR badges |
| `list` / `value` | note/block cards / single big scalar |
| `timeseries` | line over time (`span: 2` or `span: full` for wider cards) |
| `bar` / `stacked-bar` | grouped or stacked bars |
| `toplist` / `donut` | ranked breakdown / proportional share |
| `goal-rings` / `zone-distribution` | progress rings (`goal: $target`) / zone split (`targets: [80, 2, 18]`) |

Single-series widgets use `query: <wql>`; multi-layer baselines and formulas use `series:`:

````yaml
```query
title: Weekly Strength Tonnage vs Baseline
view: timeseries
span: 2
groupBy: [week]
series:
  - id: tonnage
    label: Weekly Tonnage
    query: sum:totalVolume{discipline:strength, $scope}
  - id: baseline
    label: 4w Baseline
    query: avg:totalVolume{discipline:strength, $scope}.rollup(4w)
  - id: ratio
    label: Acute Ratio
    formula: tonnage / baseline
    unit: ratio
```
````

Wellness data comes from a capture fence in any note — wellness keys are plain properties, one per line:

```wellness
soreness: 7
sleep: 7.5h
hrv: 62
```

Capture those daily and boards like Recovery Readiness light up ([what feeds `calc.readiness`](/page/guide-metrics?h=calculated)).

## Compose, inspect, clone {#composer}

- **Vault boards** (`/dashboard/<your-note>`) are yours: add, edit, duplicate, reorder, and resize widgets in place; concurrent-edit guards refuse lost writes visibly.
- **Prebuilt boards** are read-only, but **Inspect** shows any widget's structured query object with a live preview, and **Clone to vault** copies the whole board into your journal to edit.
- The `<QueryObjectBuilder />` powers inline note blocks, dashboard cards, and the Analytics Explorer from the same `QueryBlockObject` state — preview executes against your live journal with your range and kg/lb preferences.
- Empty journal? Widgets stay honest with a sample-data prompt instead of fake numbers.

## Cookbook {#cookbook}

Copy-paste WQL queries (use in `query:` inside a ```query block, or straight into the Explorer):

| Question | WQL `query:` | Suggested `view:` |
|---|---|---|
| Weekly strength volume | `sum:totalVolume{discipline:strength} by {week}` | `timeseries` |
| Top volume movements | `sum:totalVolume{} by {effort}` | `toplist` |
| TIS trend | `avg:tis{} by {week}` | `timeseries` |
| Acute:chronic load | `avg:calc.acwr{}` | `value` |
| Find benchmark notes | `:note{effort:fran,source:notebooks}` | `list` |
| This week's swings volume | `sum:totalVolume{effort:kettlebell-swings} last 6w` | `value` |

The shared kettlebell note feeds the last row — [run it](/page/guide-start?h=try-it), and it appears among the sample rows.

## Seeded boards {#seeded-boards}

Six real dashboard notes ship with the app — open any of them, or Inspect → Clone:

| Board | Built around |
|---|---|
| [Training Block Review](/d/training-block-review) | values (`avg:tis{}`, `sum:totalVolume{}`, `avg:calc.adherence{}`), weekly volume timeseries, volume by effort toplist, stacked load by intensity/week, distance by discipline |
| [Road to 560 Total](/d/road-to-560-total) | strength PR progression toward a total (`goal: $squatGoal`) |
| [Polarized Base Marathon](/d/polarized-base-marathon) | endurance polarization (`targets: [80, 2, 18]`) |
| [Finger Strength V8](/d/finger-strength-v8) | climbing: `calc.mvcBw` hang strength vs grade |
| [Benchmark PR Board](/d/benchmark-pr-board) | `last:elapsed{tags:benchmark} by {effort}`, benchmark timeseries |
| [Recovery Readiness](/d/recovery-readiness) | ```wellness capture → `last:calc.readiness{}`, HRV/monotony/ACWR trends |

## Try it {#try-it}

**Run** — the sandbox has the real board loaded: edit the *Weekly tonnage* block in the panel, change `by {week}` to `by {day}`, and watch the widget re-run — sandbox edits never touch the seeded board. Then open the live board: every widget executes against your journal, rows without facts badge as **sample answers until you have logged work of your own**. **Observe** — in the board view, inspect the *Weekly tonnage* widget and clone the board to keep an edit. Sample answers and board edits read saved sessions; they never rewrite them.

```button
label:  Open Training Block Review →
target: preview
pipeline:
  - navigate: /d/training-block-review
```

```button
label:  Browse all dashboards →
target: preview
pipeline:
  - navigate: /dashboards
```
