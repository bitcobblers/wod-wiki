# Scene 6 — From Results to Answers
*Slot: 6 of 7 · Timeline 1:08–1:20 · Runtime 12s*

**Job of the scene:** the data payoff, at speed. The finished session is already a
results table; a WQL query turns it into charts; charts stack into a dashboard — the
"Datadog view of your training" beat.

## Narration script (30 words ≈ 12s)
*Delivery: confident, brisk. The last sentence is the scene's button — give it room.*
> Finish, and it's in your journal — every effort, every split, in one table. Ask
> questions in WQL, and answers become charts; charts become dashboards. The Datadog
> view of your training.

## On-screen text
- Results table (UI-3) — dataset T-1, all 8 rounds:
  `Round · Effort · Reps · Split` → 14, 14, 13, 13, 12, 12, 11, 11 · **Total 100**
- WQL query bar (UI-4), query shown (shape per the WQL reference — source head,
  pipeline, chart final):
  `:segment{effort:burpees} | :sum{metric:reps} by {week} | :timeseries{}`
- Dashboard tiles: reps-by-round bar chart (T-1 values) + weekly volume timeseries.

## Animation spec (second by second)
- **0:00–0:03** — The timer's completion state (UI-2, final bell) folds down into the
  journal note: the original Tabata block sits on top, and the results table (UI-3)
  unfolds beneath it — plan and its record on one page. Rows populate top-to-bottom,
  fast (0.15s per row), R1 through R8.
  *VO sync: "Finish, and it's in your journal."*
- **0:03–0:05** — Camera drifts down the table as rows highlight in sequence; the
  total row lands: **Total · 100 reps**, soft emphasis pulse once.
  *VO sync: "every effort, every split, in one table."*
- **0:05–0:08** — The WQL query bar (UI-4) slides in at the top of the board; the
  query types itself in JetBrains Mono (~2.5s, faster than Scene 2's typing — this is
  power-user speed). *VO sync: "Ask questions in WQL."*
- **0:08–0:10** — On the query's final `}`, the table's rep numbers lift off their
  rows and re-form as the weekly timeseries line in a chart tile (the scene's one
  flourish — a clean data morph, no particles). Beside it, the reps-by-round bar
  chart snaps in, bars exactly the T-1 values.
  *VO sync: "answers become charts."*
- **0:10–0:12** — A third tile (pace trend) ghost-fades in at the grid's edge,
  unfinished — depth beyond the frame. The Cursor (CHAR-3) drags the bar-chart tile
  to a new grid position; it settles with a soft click. Dashboards are arranged by
  the user. Hold on settled frame. *VO sync: "charts become dashboards."*

## Canonical assets
UI-3 Results table; UI-4 Dashboard + query bar; dataset T-1 closes here — same
numbers as Scenes 4–5, nothing new invented.

## Continuity
- In: session complete (final bell carried from Scene 5). Out: dashboard settled on
  the board → Scene 7 pulls back from this page to the sharing/storage story.

## Production notes
- *Verify before render:* the WQL example against the live query engine (syntax shape
  checked against the reference 2026-10-20); if a field or function name doesn't run
  as shown, swap for an equivalent that does — never show a query that errors.
- Chart styling = the app's chart styling (UI guide). No generic infographics look.
