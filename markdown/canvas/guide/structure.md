---
search: hidden
template: canvas
route: /guide/structure
type: guide
title: "Structure & Rounds"
---

```chapter
id: structure
title: Structure & Rounds
badge: blocks
quests: structure-run, structure-rounds, structure-repscheme
sections: []
```

```quest
id: structure-run
label: Run the First Example
validation:
  type: run-started
```

```quest
id: structure-rounds
label: Wrap movements in 2+ rounds
validation:
  type: min-rounds
  count: 2
```

```quest
id: structure-repscheme
label: Write a rep scheme
validation:
  type: contains-token
  value: 21-15-9
```

# Structure & Rounds {sticky dark full-bleed}

A header in parentheses creates a **round behavior** that owns every indented line beneath it. Ownership is indentation; the runtime tracks which round you're in and advances automatically.

```view
name:    preview
state:   note
source:  wods/examples/syntax/groups-1.md
runtime: in-memory
launch:  host
align:   right
width:   50%
```

## Rounds {#rounds}

```time
(3)
  10 Pushups
  15 Air Squats
```

`(3)`, `(3 Rounds)`, `(3 Rds)` — the label is optional. The clock executes pushups, air squats, then repeats until three rounds are done, showing the current round throughout.

## Rep schemes {#rep-schemes}

```button
label:  Try it: Rep schemes
target: preview
pipeline:
  - set-source: wods/examples/syntax/groups-2.md
```

A dash-separated list creates one round per value, and **every movement in the block inherits the current round's value**:

```time
(21-15-9) Thruster / Pull-up
```

Round 1: 21 thrusters and 21 pull-ups. Round 2: 15 of each. Round 3: 9. Ladders like `(10-8-6-4-2)` work the same way. The slash between movements is choice notation — do the movements in either order (or alternate) each round.

## Sets {#sets}

```button
label:  Try it: Sets
target: preview
pipeline:
  - set-source: wods/examples/syntax/multiple-sets.md
```

`(5 Sets)` repeats a block five times with equal reps per set — usually with rest inside:

```time
(5 Sets)
  3 Back Squat 225lb
  *2:00 Rest
```

## Nesting {#nesting}

```button
label:  Try it: Nesting
target: preview
pipeline:
  - set-source: wods/examples/syntax/groups-3.md
```

Rounds nest inside rounds — supersets, alternating blocks, complex sessions:

```time
(5)
  (3)
    5 Deadlift
    10 Pushups
```

Five outer rounds, each containing three inner sets: 5 × 3 × 5 = 75 deadlifts. The clock counts both levels and shows where you are.

### Rep math {#rep-math}

The compiler derives totals — nothing is guessed or manually logged:

| Structure | Math |
|---|---|
| `(3 Rounds) 10 Burpees` | 10 × 3 = 30 burpees |
| `(21-15-9) Thruster` | 21 + 15 + 9 = 45 thrusters |
| `(5) (3) 5 Deadlift` | 5 × 3 × 5 = 75 deadlifts |

These planned totals feed the review grid, and — combined with what the clock records — become the [recorded facts](/guide/metrics?h=planned-vs-recorded) that WQL aggregates.

## Named sections {#named-sections}

```button
label:  Try it: Named sections
target: preview
pipeline:
  - set-source: wods/examples/syntax/named-groups.md
```

Two legal ways to label a section of a session:

- **`(Warmup)`** — a parenthesized label creates a named group node. Without a number it does not repeat; it organizes.
- **`// Warmup`** — a comment line. Pure text: no group node, but it labels sections in every shipped session example.

```time
// Warmup
  400m Run
  10 Air Squats

// Strength
  (5 Sets)
    3 Back Squat 225lb
    *2:00 Rest

// Conditioning
  10:00 AMRAP
    5 Pullups
    10 Pushups

// Cool-down
  5:00 Walk
```

Chain named groups to describe a full training session in one note; sections run sequentially and don't need to repeat to be useful. Use `(Label)` when you want a first-class group the runtime knows about; use `// Label` for pure organization. Full sessions like this one are [composed in the last chapter](/guide/sessions?h=full-session).

## Try it {#try-it}

```button
label:  Try it: Full session
target: preview
pipeline:
  - set-source: wods/examples/syntax/complex-full-session.md
```

**Run** — run the four-section session above: each named section plays in order, the `(5 Sets)` block tracks set count and enforces required rest, and the AMRAP window counts its own rounds. **Observe** — the review grid at the end shows per-section and per-round splits. Runs save under the shared run contract, same as every chapter.

```button
label:  Run
target: preview
open:   view
pipeline:
  - set-state: track
```

