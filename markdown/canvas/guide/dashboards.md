---
search: hidden
template: canvas
route: /guide/dashboards
type: guide
title: "Dashboards & Cookbook"
---

# Dashboards & Cookbook {sticky dark full-bleed}

A dashboard is **just a note**: mark it `dashboard: true`, and every in-note query block becomes a widget on one grid. The panel on the right has the real Training Block Review board loaded — its ```query blocks render live results right in the sandbox, and you can edit a query without touching the seeded board.

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

## Avg TIS
How hard are sessions?

```query:value
avg:tis{}
```

## Weekly tonnage
Is volume rising?

```query:timeseries-2
sum:totalVolume{} by {week}
```
````

Three conventions:

- The **heading above a block** is the widget title.
- The **paragraph directly above a block** is its question/subtitle.
- `dashboard.weeks`, `dashboard.intensity: [low, moderate, high]`, or any `dashboard.<name>` value in frontmatter becomes a **token control** referenced as `$name` — `$weeks`, `$intensity`. List tokens render as segmented controls; unknown token references produce a visible refusal, never a silent blank.

## Widget types and spans {#widgets}

```button
label:  Try it: Benchmark PR board
target: sandbox
pipeline:
  - set-source: dashboards/benchmark-pr-board.md
```

The fence tag carries type and grid span (`query:<type>[-<1..4>|-full]`); a bare ```query defaults to `table`. Grid is 4 columns wide.

| Tag | Widget |
|---|---|
| ```query | table (default) |
| ```query:list / ```query:value | list / single big number |
| ```query:timeseries / ```query:timeseries-2 / ```query:timeseries-4 | line over time, 1/2/4 columns |
| ```query:bar / ```query:stacked-bar | bars / stacked bars |
| ```query:toplist | ranked rows |
| ```query:goal-rings / ```query:zone-distribution | progress rings / zone split |

The block body is **one WQL line** — everything from [the WQL chapter](/guide/wql?h=aggregate) works, including tokens:

```query
sum:sessionLoad{intensity:$intensity} by {week}
```

Wellness data comes from a capture fence in any note — wellness keys are plain properties, one per line:

```wellness
soreness: 7
sleep: 7.5h
hrv: 62
```

Capture those daily and boards like Recovery Readiness light up ([what feeds `calc.readiness`](/guide/metrics?h=calculated)).

## Compose, inspect, clone {#composer}

- **Vault boards** (`/dashboard/<your-note>`) are yours: add, edit, duplicate, reorder, and resize widgets in place; concurrent-edit guards refuse lost writes visibly.
- **Prebuilt boards** are read-only, but **Inspect** shows any widget's query with a live preview, and **Clone to vault** copies the whole board into your journal to edit.
- The widget composer is the same three steps for both: pick the **dataset** (a WQL line), the **calculation** (aggregator/metric/filters/window via the composer pills), and the **visualization** (type + span) — preview executes against your live journal with your range and kg/lb preferences.
- Empty journal? Widgets stay honest with a sample-data prompt instead of fake numbers.

## Cookbook {#cookbook}

Copy-paste queries (paste into a ```query block, or straight into the Explorer):

| Question | Query |
|---|---|
| Weekly strength volume | `sum:totalVolume{discipline:strength} by {week}` |
| Top volume movements | `sum:totalVolume{} by {effort}` |
| TIS trend | `avg:tis{} by {week}` |
| Acute:chronic load | `avg:calc.acwr{}` |
| Find benchmark notes | `:note{effort:fran,source:feeds}` |
| This week's swings volume | `sum:totalVolume{effort:kettlebell-swings} last 6w` |

The shared kettlebell note feeds the last row — [run it](/guide/start?h=try-it), and it appears among the sample rows.

## Seeded boards {#seeded-boards}

Six real dashboard notes ship with the app — open any of them, or Inspect → Clone:

| Board | Built around |
|---|---|
| [Training Block Review](/d/training-block-review) | values (`avg:tis{}`, `sum:totalVolume{}`, `avg:calc.adherence{}`), weekly volume timeseries, volume by effort toplist, stacked load by intensity/week, distance by discipline |
| [Road to 560 Total](/d/road-to-560-total) | strength PR progression toward a total |
| [Polarized Base Marathon](/d/polarized-base-marathon) | endurance polarization (intensity split across weeks) |
| [Finger Strength V8](/d/finger-strength-v8) | climbing: `calc.mvcBw` hang strength vs grade |
| [Benchmark PR Board](/d/benchmark-pr-board) | `last:elapsed{tags:benchmark} by {effort}`, benchmark timeseries |
| [Recovery Readiness](/d/recovery-readiness) | ```wellness capture → `last:calc.readiness{}`, HRV/monotony/ACWR trends |

## Try it {#try-it}

**Run** — the sandbox has the real board loaded: edit the *Weekly tonnage* query in the panel, change `by {week}` to `by {day}`, and watch the widget re-run — sandbox edits never touch the seeded board. Then open the live board: every widget executes against your journal, rows without facts badge as **sample answers until you have logged work of your own**. **Observe** — in the board view, inspect the *Weekly tonnage* widget and clone the board to keep an edit. Sample answers and board edits read saved sessions; they never rewrite them.

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

