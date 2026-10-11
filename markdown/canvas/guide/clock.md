---
search: hidden
template: canvas
route: /guide/clock
type: guide
title: "Run, Track & Capture (the Clock)"
---

```chapter
id: clock
title: The Clock
badge: dumbbell
quests: clock-run, clock-rest, clock-split
sections: []
```

```quest
id: clock-run
label: Run the First Example
validation:
  type: run-started
```

```quest
id: clock-rest
label: Program a required rest
validation:
  type: contains-token
  value: '*:'
```

```quest
id: clock-split
label: Add a cue card action
validation:
  type: contains-token
  value: "["
```

# Run, Track & Capture (the Clock) {sticky dark full-bleed}

Syntax is the plan; **behaviors** are what the runtime does with it. When you press Run, the compiler turns every line into a timeline of behaviors and the clock plays them in order.

```view
name:    preview
state:   note
source:  wods/examples/home/sample-script.md
runtime: in-memory
launch:  host
align:   right
width:   50%
```

## From script to clock {#run-next}

1. **Script** — your Markdown note with fenced blocks.
2. **Parse** — the grammar turns each line into statements of metrics.
3. **Compile** — statements match to behaviors and lay out a timeline.
4. **Track** — the clock steps through the timeline: counting, prompting, logging.

Three behavior families cover every line:

| Family | What it does | Example line | On the clock |
|---|---|---|---|
| **Timers** | counts up or down, repeats, rings | `20:00 AMRAP` | countdown + round counter |
| **Rounds** | repeats, names, walks a rep scheme | `(21-15-9)` | three rounds with descending reps |
| **Capture** | asks for actuals | `225lb ?lb`, `:?` | prompt when reached or finished |

**Run** starts the current block; **Next** advances it and locks the elapsed time as a **split** — every click records where you are. Timers choose their strategy from the line ([chapter 2](/guide/protocols?h=countdown-countup)): duration → countdown, `^` or no duration → count-up stopwatch, `EMOM`/work-rest pair → interval, the word `Rest` → rest cue.

## Pause, skip, and sound {#pause-skip}

```button
label:  Try it: Required rest
target: preview
pipeline:
  - set-source: wods/examples/syntax/timers-rest.md
```

- **Pause / resume** — countdowns stop and resume from the same elapsed time; interval timers keep round state, so an EMOM window never restarts from zero.
- **Skip** — any timer without `*` can be skipped. `*:30 Rest` cannot; required timers force the full wait.
- **Sound** — the runtime emits sound cues at timer start, the final ten seconds, and round transitions; audio surfaces subscribe to them.

A movement line without a duration is not "no timer" — it's a count-up stopwatch tracking that block while you log reps.

On a stored note, **Stop** or **Exit** saves the captured partial run. Finishing the last block saves a completed run. The fullscreen results view shows **Saved ✓** only after the write succeeds. If saving fails, the clock keeps the run open; **Retry save** retries the same run without creating another session. Live "results captured" counts do not confirm a save.

## Capture prompts {#capture-prompts}

Collectible placeholders (`?lb`, `:?`, `?m`, `?`) mark the values the plan doesn't know; you supply the actuals during capture, and each lands in the fact store with its block. Session RPE is captured after the workout — skippable, and never blocking a save. Every recorded value carries a declared origin — see [Provenance](#provenance).

## Casting {#casting}

The clock casts to a big screen: the timer surface — current block, round counter, countdown, cue cards — renders on a paired display while the controls stay on your device. Timers, cue cards (`[Change Plates]`), and round indicators all cross over; pauses on the device pause the cast.

## Provenance {#provenance}

Every recorded fact carries its origin, which later tells analytics what to trust:

| Origin | Producer | Example |
|---|---|---|
| `parser` / `compiler` | from your text | planned `24kg`, rep scheme values |
| `runtime` | the clock | elapsed spans, splits, round counts |
| `user` | you, at a prompt | captured loads, `:?` results, session RPE, wellness entries |
| `analyzed` | the calc engine | `calc.*` values (estimated ones are marked `analyzed-estimated`) |

## Try it {#try-it}

**Run** — run the shared `(3) × 10 Kettlebell Swings 24kg / *:30 Rest` note and try each control: pause mid-round (elapsed freezes, resumes exactly), attempt to skip the `*` rest (refused), then `Next` through the last round — each split is locked with its timestamp. **Observe** — the review grid afterwards is just this provenance trail, organized. Runtime behavior is the subject here; run saving is the shared run contract.

```button
label:  Run
target: preview
open:   view
pipeline:
  - set-state: track
```

