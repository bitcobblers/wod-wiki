---
search: hidden
template: canvas
route: /guide/sessions
type: guide
title: "Dialects & Complex Sessions"
---

```chapter
id: sessions
title: Dialects & Complex Sessions
badge: puzzle
quests: sessions-run, sessions-log, sessions-nested
sections: []
```

```quest
id: sessions-run
label: Run the First Example
validation:
  type: run-started
```

```quest
id: sessions-log
label: Write a log block
validation:
  type: contains-token
  value: \`\`\`log
```

```quest
id: sessions-nested
label: Nest a protocol inside rounds
validation:
  type: min-rounds
  count: 2
```

# Dialects & Complex Sessions {sticky dark full-bleed}

Everything you've learned composes. This chapter covers the fence flavors and the session shapes that combine them.

```view
name:    preview
state:   note
source:  wods/examples/syntax/complex-full-session.md
runtime: in-memory
launch:  host
align:   right
width:   50%
```

## Intent and the fence {#intent}

```button
label:  Try it: The time fence
target: preview
pipeline:
  - set-source: wods/examples/syntax/dialect-wod.md
```

A fence tells WOD Wiki what a block **is**, while the line grammar stays the same:

| Fence | Intent | Behavior |
|---|---|---|
| ```` ```time ```` | a session to **run** — the workout of the day, or tomorrow's plan | runnable with the clock ([the Clock](/guide/clock?h=run-next)) |
| ```` ```log ```` | a **record** of what happened — performed work, notes, subjective effort | preserved as-is; no timer expectations |
| ```` ```log:climbing ```` | a log in a **sport dialect** — climbing signals (grades, send types, attempts, high points) become explicit metrics | same `log` semantics + the climbing dialect |

Whether a ```time block is today's workout or tomorrow's plan is your call — the syntax is identical, and unknown loads stay as `?lb` placeholders until execution either way. Older pages speak of ```` ```wod ````/```` ```plan ````/```` ```climb ```` fences: treat those as *intent* vocabulary, not fence names — the runtime affords `time` and `log` (with `:sport` suffixes).

The suffix is a sport name or dialect id — `climbing` maps to the `climb` dialect. An unknown suffix warns and falls back to the full dialect stack, so a typo never loses your data.

## Full session {#full-session}

The four-section session is already in the panel — warmup → strength → conditioning → cool-down ([section labeling](/guide/structure?h=named-sections)):

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

## Nested protocols {#nested}

```button
label:  Try it: Nested protocols
target: preview
pipeline:
  - set-source: wods/examples/syntax/complex-nested-protocols.md
```

An outer round can wrap a timed block and a strength block; groups run sequentially and the runtime handles transitions:

```time
(3)
  5:00 AMRAP
    5 Pullups
    10 Pushups
// Strength
  3 Back Squat 225lb
  *2:00 Rest
```

## Partner sessions {#partner}

```button
label:  Try it: Partner windows
target: preview
pipeline:
  - set-source: wods/examples/syntax/complex-partner-workout.md
```

Separate labeled windows keep each partner's work distinct while sharing the document:

```time
// Partner A
  5:00 AMRAP
    5 Pullups
    10 Pushups

// Partner B
  5:00 AMRAP
    10 Air Squats
    8 Burpees
```

## Swimming {#swimming}

```button
label:  Try it: Swimming sets
target: preview
pipeline:
  - set-source: wods/examples/syntax/complex-swimming.md
```

Multi-set interval work with named sets and distance measures:

```time
(4) Power Sprints
  25m Freestyle Sprint
  1:30 Rest

(6) IM Main Set
  100m IM
  :45 Rest

150m Cooldown
```

## Barbell cycling {#barbell-cycling}

```button
label:  Try it: Barbell cycling
target: preview
pipeline:
  - set-source: wods/examples/syntax/complex-barbell-cycling.md
```

Back-to-back EMOM windows with changing loads — cue cards prompt the plate change between blocks:

```time
(5) :60 EMOM
  3 Power Clean 135lb

[Change Plates]

(5) :60 EMOM
  2 Power Clean 155lb
```

## Climbing and logging {#climbing}

```button
label:  Try it: Climbing log
target: preview
pipeline:
  - set-source: wods/examples/syntax/dialect-climb-bouldering.md
```

A ```log fence records what happened — effort words, properties, and comments included:

```log
date: 2026-05-25
rpe: 7

5 Back Squat 225lb hard
// Bar speed slowed on set 3.
```

With the climbing suffix, plain text becomes structured signals — grades, send types, attempt counts, high points, and discipline stay readable as Markdown but queryable via `grade`, `calc.sends`, and friends ([finger-strength board](/guide/dashboards?h=seeded-boards)):

```log
Night session. Sent "Midnight Lightning" V8, 3 attempts. High point on the 5.12a proj.
```

## Try it {#try-it}

The full session is back in the panel (the first **Try it** above restores the fence flavors any time). Run it end to end — four sections, required rest, an AMRAP window, a cooldown — then open [your dashboard](/guide/dashboards?h=seeded-boards) and find the session in this week's volume. **Observe** — per-section splits and the AMRAP round counter in the review grid. Runs save under the shared run contract, like every chapter.

```button
label:  Run
target: preview
open:   view
pipeline:
  - set-state: track
```

