---
search: hidden
template: canvas
route: /guide/metrics
type: guide
title: "Metrics: Planned, Recorded, Calculated"
---

```chapter
id: metrics
title: Metrics
badge: activity
quests: metrics-run, metrics-custom, metrics-capture
sections: []
```

```quest
id: metrics-run
label: Run the First Example
validation:
  type: run-started
```

```quest
id: metrics-custom
label: Attach a custom metric
validation:
  type: contains-token
  value: '{"rpe"'
```

```quest
id: metrics-capture
label: Add a collectible load
validation:
  type: contains-token
  value: ?lb
```

# Metrics: Planned, Recorded, Calculated {sticky dark full-bleed}

Every number in WOD Wiki has an origin. Knowing the three layers tells you what you can query and what you can trust.

```view
name:    preview
state:   note
source:  wods/examples/home/sample-script.md
runtime: in-memory
launch:  host
align:   right
width:   50%
```

## The three layers {#planned-vs-recorded}

| Layer | Who produces it | Examples | You asked for it by writing |
|---|---|---|---|
| **Planned** | parser + compiler, from your text | `5:00` duration, `(21-15-9)` reps, `24kg` load, discipline/intensity hints | the line itself |
| **Recorded** | the runtime clock while you exercise | elapsed spans, splits, reps/distance/resistance performed, captured loads and ratings | `:?`, `?lb`, and running the workout |
| **Calculated** | the analytics engine after (and during) runs | `calc.e1rm`, `calc.acwr`, `calc.readiness`, … | enough recorded facts to feed a formula |

The running example makes the split concrete:

```time
(3)
  10 Kettlebell Swings 24kg
  *:30 Rest
```

Planned: 3 rounds, 10 reps, 24 kg, 30 s rest. After running it, the recorded facts (30 swings at 24 kg) derive **720 kg of total volume** — computed from records, never asserted. That number is what [WQL](/guide/wql?h=aggregate) queries later.

## Inline custom metrics {#custom-metrics}

```button
label:  Try it: Custom metrics
target: preview
pipeline:
  - set-source: wods/examples/syntax/custom-metrics-1.md
```

Attach any key/value data with a JSON object, anywhere on the line:

```time
5 Back Squat 225lb {"rpe": 8}
10 Thrusters 95lb {"intensity": 80, "coach": "greg"}
```

- **Optional & additive** — existing syntax is unchanged; the object can sit anywhere on the line.
- **Typed values** — numbers, strings, booleans, or null.
- **Known keys** (`rpe`, `rir`, `intensity`, `load`) map to canonical metric types.
- **Any other key becomes a custom metric** — and a queryable dimension (`{coach:greg}` filters, `by {coach}` groups; keys are camelCase-normalized, so `Sleep Quality` answers to `sleepQuality`).

## Capture prompts {#capture}

```button
label:  Try it: Collectible loads
target: preview
pipeline:
  - set-source: wods/examples/syntax/metrics-5.md
```

Unknown values become **collectible** placeholders — the plan stays honest, and you supply the actual during capture:

| Line | What it means |
|---|---|
| `?lb Back Squat` | collectible load — unknown at parse; you enter the actual value when capturing |
| `225lb ?lb Deadlift` | prescribed 225 lb alongside a collectible load (editing allowed) |
| `?kg Clean` | collectible load in kilograms |
| `?` | collectible reps — how many you actually did |
| `?m` / `?km` / `?mile` | collectible distance |
| `For Time :?` | collectible timer — elapsed time is recorded when you complete the block |
| `5km Run :?` | distance is prescribed, so `:?` collects the **time taken** |
| `:? Max Effort Pushups` | a bare `:?` mounts a count-up timer whose elapsed is recorded on completion — the prefix form parses the same |

The collectible rule: a value that is **prescribed** is written literally; a value that is the **outcome** gets the `?` placeholder — a time-prescribed run collects distance with `?m`, a distance-prescribed run collects time with `:?`. What the clock does when a prompt fires is the [Clock chapter](/guide/clock?h=capture-prompts).

Captured loads feed trendlines, estimated 1RMs, and PR detection across sessions.

## Session RPE {#session-rpe}

A session-level rating rides on the note as a property:

```log
date: 2026-05-25
rpe: 7

5 Back Squat 225lb hard
```

`rpe:` (and `rir:`) are typed session metrics — the parser maps the property to `session-rpe`, the stored fact carries canonical key `session-rpe`, and the executor matches aggregate metric keys by exact string, so weekly intensity is one query:

```query
avg:session-rpe{} by {week}
```

(Older pages showed `avg:wod.rpe` — no such key exists; `session-rpe` is the real one.)

## Calculated metrics {#calculated}

```button
label:  Try it: Calculated metrics
target: preview
pipeline:
  - set-source: wods/examples/syntax/calculated-metrics.md
```

Two ways to derive values.

**In-note `calculate` blocks** evaluate over the workout's recorded rows; rows with unknown inputs are skipped, not zeroed:

````markdown
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
````

A trailing `calculate` section inside the fence works the same way. Formulas run live during tracking and finalize on completion.

**Engine-published `calc.*` metrics** are built in — the full vocabulary WQL can query:

| Family | Keys |
|---|---|
| Training load | `calc.acwr`, `calc.monotony`, `calc.strain`, `calc.ctl`, `calc.atl`, `calc.tsb` |
| Strength | `calc.e1rm`, `calc.pct1rm` |
| Wellness | `calc.soreness`, `calc.sleep`, `calc.hrv`, `calc.readiness` |
| Climb / run | `calc.sends`, `calc.ef`, `calc.metMinutes`, `calc.mvcBw` |
| Plan | `calc.adherence` |

No invented prerequisites: each formula states what it needs. `calc.readiness`, for example, is computed only for days where a ```wellness fence captured **soreness, sleep, and HRV** — days missing any input produce no value rather than a misleading zero. These 17 keys are exactly the engine-registered set; any other `calc.*` (e.g. the planned `calc.pmc` composite) renders a labeled **proposed** placeholder instead of a value.

## Try it {#try-it}

The kettlebell example is already in the panel — run it, then open the review grid: reps and load should come from the plan, splits and elapsed from the clock, and `totalVolume` should appear as a derived summary. Add `{"rpe": 7}` to a line and re-run — the custom metric should appear in the grid. **Result query** — the same run answers `sum:totalVolume{effort:kettlebell-swings} last 6w` in [WQL](/guide/wql?h=aggregate). This chapter reads what runs record; saving follows the shared run contract — no separate result policy.

```button
label:  Run
target: preview
open:   view
pipeline:
  - set-state: track
```

