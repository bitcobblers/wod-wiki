# Scene 3 — Anatomy of a Statement
*Slot: 3 of 7 · Timeline 0:25–0:41 · Runtime 16s*

**Job of the scene:** the "aha" the whole product hangs on. One line of plain text is a
structured statement that declares its metrics up front — so the timer knows what to
collect. This is the zoom from the brief: clock, effort, reps, then load/distance and
the metric types (calories, METs included).

## Narration script (41 words ≈ 16s)
*Delivery: teacher mode, unhurried. Emphasis on "declares" and "collects" in the last line.*
> Every line is a statement. Twenty seconds: the clock. Burpees: the effort — and
> reps are counted while the clock runs. A line can carry more: a load, a distance —
> reps, weight, calories, METs. The statement declares it; the timer collects it.

## On-screen text
- Hero line (from Scene 2, unchanged, JetBrains Mono, now huge): `:20 Max Effort Burpees`
- Fragment brackets under the line, drawn in marker ink: **the clock** · **the effort**
- Chip beside the line: `reps: —` (fills in Scene 4; draw identically there)
- Ghost lines (smaller, 60% opacity): `10 KB Swing @24kg` · `400m Run`
- Metric chips row (app-styled pills): **reps · load · distance · calories · METs**

## Animation spec (second by second)
- **0:00–0:02** — Scene 2's push-in completes: the hero line fills ~80% of the board
  width. The other two lines of the block fade to 15%. Settle.
- **0:02–0:05** — `:20` highlights in the app accent (fill wipe left→right, 0.4s).
  Marker bracket draws beneath it and writes: "the clock."
  *VO sync: "Twenty seconds: the clock."*
- **0:05–0:08** — Highlight moves to `Max Effort Burpees` (same wipe). Bracket writes:
  "the effort." *VO sync: "Burpees: the effort."*
- **0:08–0:10** — The `reps: —` chip pops in at the line's right edge and pulses twice
  (scale 1.0→1.08→1.0). Nothing fills it yet — that happens live in Scene 4.
  *VO sync: "reps are counted while the clock runs."*
- **0:10–0:13** — Fan-out: the two ghost lines slide in below the hero line, staggered
  0.3s apart. In the first, `@24kg` highlights and a marker bracket writes "the load";
  in the second, `400m` highlights: "the distance."
  *VO sync: "A line can carry more: a load, a distance."*
- **0:13–0:15** — Metric chips assemble along the bottom, one pop per VO word:
  reps · weight · calories · METs (load and distance chips are already implied by the
  fan-out; the row shows all five: reps · load · distance · calories · METs, with the
  spoken four popping in time and distance/load sliding in with them).
- **0:15–0:16** — Camera pulls back fast (0.7s) to the full Tabata block, restored
  pixel-identical to Scene 2's ending. Ghost lines and chips fade out during the pull.
  Cursor enters and lands on the Run button. Hold on settled frame — Scene 4's first
  frame is this frame.

## Canonical assets
Dataset T-1 block; fragment order per the syntax reference
(`[timer] [reps] [effort] [@ load] [distance] [rest]`); chips per UI guide.

## Continuity
- In: mid-zoom from Scene 2. Out: block restored, cursor on Run → Scene 4 opens on
  this exact frame; its first beat is the click the audience has been promised since
  Scene 2's narration.

## Production notes
- Two camera moves are permitted in this scene only (production-rules exception).
- Highlight order is fixed: clock → effort → reps chip → load → distance → chips.
  The narration is written to this order; do not reorder in the edit.
