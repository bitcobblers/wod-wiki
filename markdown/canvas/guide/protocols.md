---
search: hidden
template: canvas
route: /guide/protocols
type: guide
title: "Timers & Protocols"
---

```chapter
id: protocols
title: Timers & Protocols
badge: timer
quests: protocols-run, protocols-timer, protocols-rounds, protocols-tag
sections: []
```

```quest
id: protocols-run
label: Run the First Example
validation:
  type: run-started
```

```quest
id: protocols-timer
label: Add a rest or time cap
validation:
  type: has-timer
```

```quest
id: protocols-rounds
label: Add a 3-round cap
validation:
  type: min-rounds
  count: 3
```

```quest
id: protocols-tag
label: Add a workout tag
validation:
  type: contains-token
  value: AMRAP
```

# Timers & Protocols {sticky dark full-bleed}

A duration prefix turns any line into a timer. Combined with round headers, the same few tokens produce AMRAP, EMOM, Tabata, and every interval scheme.

```view
name:    preview
state:   note
source:  wods/examples/syntax/timers-rest.md
runtime: in-memory
launch:  host
align:   right
width:   50%
```

## Countdown, count-up, and the three prefixes {#countdown-countup}

```button
label:  Try it: Timer prefixes
target: preview
pipeline:
  - set-source: wods/examples/syntax/timer-modifiers.md
```

| Line | Clock behavior |
|---|---|
| `5:00 Run` | counts **down** from 5:00 |
| `10 Pushups` | no duration → counts **up** like a stopwatch while you log reps |
| `^5:00 Row` | `^` forces a count-**up** to 5:00 even though a duration is given |
| `*:30 Rest` | `*` marks the timer **required** — it cannot be skipped |
| `1:30:00 Long Row` | `H:MM:SS` for anything over an hour |
| `5:00 Run :?` | `:?` collects the **actual** result when the block finishes |

`Rest` is behavior, not decoration: the rest cue comes from the word `Rest` on the line; `*` only decides whether it can be skipped. The `:?` prompt may also lead the line — `:? Max Effort Pushups` parses identically because `:?` is its own duration token; this guide appends it as the convention.

### Required rest {#required-rest}

```button
label:  Try it: Required rest
target: preview
pipeline:
  - set-source: wods/examples/syntax/timers-rest.md
```

```time
(3)
  10 Kettlebell Swings 24kg
  *:30 Rest
```

The shared example's rest is non-skippable: the clock waits the full 30 seconds before round 2. A plain `1:00 Rest` (no `*`) can be skipped; `^5:00 Rest` counts up instead of down. What the clock does with rest — pause, skip, sound — is the [Clock chapter](/guide/clock?h=pause-skip).

## AMRAP {#amrap}

```button
label:  Try it: AMRAP
target: preview
pipeline:
  - set-source: wods/examples/syntax/classic-amrap.md
```

**As Many Rounds As Possible** — a time cap plus the `AMRAP` label. The clock counts down and counts completed rounds:

```time
20:00 AMRAP
  5 Pullups
  10 Pushups
  15 Air Squats
```

A bare duration on a line — `20:00` with no label — is a **time cap** for the work nested beneath it ([Caps](#caps)). Chain several AMRAP windows in one note and each gets its own countdown and round counter.

## EMOM {#emom}

```button
label:  Try it: EMOM
target: preview
pipeline:
  - set-source: wods/examples/syntax/basic-emom.md
```

**Every Minute On the Minute** — a round count, an interval duration, and the `EMOM` label:

```time
(10) :60 EMOM
  5 Power Cleans
```

Ten windows, one minute each, a bell at the start of every window. Heavier work wants longer windows: `(5) 2:00 EMOM` is five two-minute windows. Separate indented branches rotate across windows:

```time
(10) :60 EMOM
  5 Pullups
  10 Pushups
```

Odd windows do pull-ups, even windows do push-ups.

## Tabata and intervals {#tabata-intervals}

```button
label:  Try it: Tabata
target: preview
pipeline:
  - set-source: wods/examples/syntax/protocols-4.md
```

A work line and a rest line inside a round count — the canonical Tabata:

```time
(8)
  :20 Max Effort Burpees
  :10 Rest
```

The compact form writes the pair on one line with a slash — `(8 Rounds) :20 / :10` — same tokens, same behavior. Change any number: `:40` work with `*:20 Rest` over `(5)` is a popular variant. Sub-minute durations need the leading colon (`:20`, `:10`).

## Caps and For Time {#caps}

```button
label:  Try it: Time caps
target: preview
pipeline:
  - set-source: wods/examples/syntax/time-cap.md
```

| Line | Behavior |
|---|---|
| `20:00` (bare, work nested under it) | time cap — the clock counts down over whatever is indented |
| `For Time` | count up, no cap — stop the clock when done |
| `5:00 For Time` | count up toward a 5:00 cap |

## Distance intervals {#distance-intervals}

```button
label:  Try it: Distance intervals
target: preview
pipeline:
  - set-source: wods/examples/syntax/distance-intervals.md
```

Pair a timed work interval with a distance target, then recover:

```time
(6)
  2:00 Run 400m
  *1:00 Rest
```

Each round is 400 m against the clock, then mandatory recovery. Distance is just a measure on the line — everything from [First Workout](/guide/start?h=measurements) composes with timers.

## Try it {#try-it}

```button
label:  Try it: Tabata
target: preview
pipeline:
  - set-source: wods/examples/syntax/protocols-4.md
```

**Run** — run the Tabata block: eight `:20/:10` cycles with bells on every transition, and the round counter advancing automatically. Pause mid-window and resume — interval timers keep their round state. **Observe** — splits lock per window and the required rest refuses `Next` until elapsed. Runs save a snapshot named from this page and section under the shared run contract.

```button
label:  Run
target: preview
open:   view
pipeline:
  - set-state: track
```

