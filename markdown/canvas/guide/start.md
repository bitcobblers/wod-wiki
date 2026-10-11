---
search: hidden
template: canvas
route: /guide/start
type: guide
title: "First Workout"
---

```chapter
id: start
title: First Workout
badge: play
quests: start-run, start-movement, start-reps, start-load
sections: []
```

```quest
id: start-run
label: Run the First Example
validation:
  type: run-started
```

```quest
id: start-movement
label: Add a movement
validation:
  type: has-movement
```

```quest
id: start-reps
label: Add a rep count
validation:
  type: has-reps
```

```quest
id: start-load
label: Add a load or distance
validation:
  type: contains-token
  value: lb
```

# First Workout {sticky dark full-bleed}

WOD Wiki turns a plain Markdown note into a workout you can **run** and a journal you can **query**. This chapter gets you from an empty note to your first tracked session — the same note the homepage uses. Edit the example on the right as you read; every section swaps in its own.

```view
name:    preview
state:   note
source:  wods/examples/home/sample-script.md
runtime: in-memory
launch:  host
align:   right
width:   50%
```

## Fences {sticky}

A workout lives inside a fenced code block. Two fence tags matter:

- ```` ```time ```` — a session you intend to **run** with the clock.
- ```` ```log ```` — a session you are **recording** after (or while) it happened.

````markdown
```time
(3)
  10 Kettlebell Swings 24kg
  *:30 Rest
```
````

Everything else in this chapter goes *inside* the fence. There is no `wod`/`plan` fence — the runtime affords `time` and `log` (with `:sport` suffixes, [Sessions](/guide/sessions?h=intent)); in-note analytics use [```query](/guide/wql).

## Three rules {#first-workout}

```button
label:  Try it: Core rules
target: preview
pipeline:
  - set-source: wods/examples/syntax/core-rules.md
```

1. **Fences** — wrap the workout in a ```` ```time ```` (or ```` ```log ````) block.
2. **One thing per line** — a line is a movement, a time, a group header, or a note.
3. **Indentation means nesting** — anything indented under a header belongs to it.

The smallest valid workout is one line:

```time
Pushups
```

No reps, no timer — the runtime asks how many you did when you finish. Add a number and the rep count is tracked automatically:

```time
10 Pushups
```

## Measures ride along {#measurements}

```button
label:  Try it: Measurements
target: preview
pipeline:
  - set-source: wods/examples/syntax/measurements.md
```

Loads and distances attach directly to movement lines; the runtime records them as metrics:

| Line | What it records |
|---|---|
| `5 Back Squat 225lb` | 5 reps × 225 lb per set |
| `5 Back Squat 100kg` | kilograms work exactly the same |
| `Run 400m` | 400 m distance |
| `10 miles` | bare distances work too |
| `5 Deadlifts ?lb` | load unknown — the clock prompts for the actual weight ([Capture](/guide/metrics?h=capture)) |
| `5 Back Squat 225lb hard` | a plain-language effort word rides along |

## Instructions and asides {#actions-comments}

```button
label:  Try it: Actions & comments
target: preview
pipeline:
  - set-source: wods/examples/syntax/actions-comments.md
```

- **Actions** in square brackets are cue cards in the timer: `[Setup Barbell]` appears when reached, then the clock moves on.
- **Comments** start with `//` — passive annotations that never affect the clock.

```time
// Warmup — get loose
  400m Run
[Chalk up]
  10 Air Squats
```

## The system at a glance {#system}

Everything you create lives in one place, addressed one way:

| Term | Purpose | Scope / storage |
|---|---|---|
| **Note** | the markdown document + identity | one IndexedDB store (notes + results + attachments + analytics) |
| **Page** | a note bound to a surface (a routed guide page, the playground) | bindings per surface |
| **Block** | one addressable fenced unit in a note; the run target | Block Content Id = content hash, stable across reorders/clones |
| **Effort** | named workout registry entry (e.g. *fran*) | aggregates `by {effort}` |
| **Session** | one recorded run | `{noteId, resultId, block}` triple |
| **Journal** | your saved notes | `source:journal`; promotion target |
| **Playground** | experiment surface (home, learning runs) | `source:playground` |
| **Catalog** | catalog of benchmark sessions | `source:feeds`; clone into journal |
| **Feed** | dated posts | — |
| **Dashboard** | a note with `dashboard: true`; its query blocks render as widgets | [Dashboards](/guide/dashboards) |

**`source:` scope** — plural values: `journal`, `feeds`, `guides`, `playground` (plus `dashboards`, `efforts`). Omitting `source:` searches all of them; pin one catalog with `catalog:<id>`. Learning runs record with origin `'playground'` until promoted to the journal — a query pinned to `source:journal` excludes playground experiments by design ([WQL sources](/guide/wql?h=sources)).

**Session vs template vs sample vs revert.** A **session** is immutable recorded facts from one run. A **template** is read-only source content — the examples on these pages; running one copies it into your own snapshot, it never mutates. A **sample dataset** is the badged fallback you see before you have facts of your own. **Revert** discards view state only — it never deletes saved sessions.

## The running example {#try-it}

This is the homepage's edit-me note — already loaded in the panel — and the example every later chapter reuses:

```time
(3)
  10 Kettlebell Swings 24kg
  *:30 Rest
```

**Run** — press **Run**: the clock counts three rounds of 10 swings with a required 30-second rest between them; each `Next` locks the elapsed time as a split. **Observe** — when the workout completes, the review grid shows 30 total swings at 24 kg — the raw material for [Metrics](/guide/metrics). Running saves a snapshot named from this page and section; every chapter shares the one run contract — none defines its own.

```button
label:  Run
target: preview
open:   view
pipeline:
  - set-state: track
```

## Compact syntax reference {#reference}

One table, the whole line grammar. Chapters 2–3 expand each row.

| You write | You get |
|---|---|
| ```` ```time ```` / ```` ```log ```` | runnable / recorded fence |
| `10 Pushups` | movement + reps |
| `5 Back Squat 225lb` | movement + reps + load |
| `Run 400m` / `10 miles` | movement + distance |
| `?lb` / `?kg` / `225lb ?lb` | capture-the-load prompt |
| `5:00 Run` / `^5:00 Row` | countdown / forced count-up |
| `*:30 Rest` | required rest block |
| `:?` | collect-the-actual prompt (`5:00 Run :?`) |
| `(3)` / `(3 Rounds)` / `(5 Sets)` | repeat the indented block |
| `(21-15-9)` | rep scheme — one round per value |
| `(Warmup)` or `// Warmup` | named section ([Structure](/guide/structure?h=named-sections)) |
| `20:00 AMRAP` / `(10) :60 EMOM` / `(8)` + `:20`/`:10` | protocols ([Timers & Protocols](/guide/protocols?h=amrap)) |
| `{"rpe": 8}` | inline custom metric ([Metrics](/guide/metrics?h=custom-metrics)) |
| `[Setup Barbell]` / `// note` | cue card / comment |
| `hard`, `easy` | effort words |

Prefer generating? The [/ai-first](/ai-first) page shows AI-assisted note authoring.
