# Scene 4 — It Runs, and It Counts
*Slot: 4 of 7 · Timeline 0:41–0:57 · Runtime 16s*

**Job of the scene:** the click turns words into a running timer, and the timer is the
logger: splits lock per window, assigned to their efforts, reps included. Rest refusal
is in (locked decision) — one playful half-second, played straight otherwise.

## Narration script (41 words ≈ 16s)
*Delivery: energy up a notch — this is the payoff scene. Land "execution is the logging" flat and final.*
> One click, and it's running. Bells mark every change; the counter advances on its
> own. Each window closes as a split — tied to its effort, reps included. A required
> rest can't be skipped. Nothing gets logged afterwards: execution is the logging.

## On-screen text
- Timer screen = UI-2, drawn from the real timer: giant JetBrains Mono clock counting
  `:20 → :00`, round indicator `ROUND 1 / 8` advancing to `ROUND 4 / 8`, current
  effort `Max Effort Burpees`, splits list at right.
- Splits fill with dataset T-1 values: `R1 · Burpees · 14` · `R2 · 14` · `R3 · 13` · `R4 · 13`
- The `reps:` chip from Scene 3 reappears inside the timer and fills live.
- Rest state label: `REST :10` in the app's rest styling.

## Animation spec (second by second)
- **0:00–0:01** — First frame = Scene 3's last frame (block, cursor on Run). Cursor
  clicks: standard CHAR-3 ripple + click sound. Match-cut: the block expands in place
  into the timer screen (UI-2) — same center position, text becomes clock.
  *VO sync: "One click, and it's running."*
- **0:01–0:05** — Clock counts down from `:20` at real speed for the first two seconds,
  then eases to 2× (time compression the viewer can feel but not catch). Athlete
  (CHAR-1, P3a/P3b two-frame burpee loop) works at frame-left, small. The `reps:` chip
  ticks up per rep: 1, 2, 3…
- **0:05–0:06** — Bell (the app's own bell). Window flips to `REST :10` in rest
  styling. Round 1's split slides into the splits list: `R1 · Burpees · 14`. A thin
  connector line flashes once between the split row and the effort name — the split is
  *assigned*. *VO sync: "Bells mark every change."*
- **0:06–0:09** — Compression up: rounds 2–3 tick by at ~4×. Splits stack: `R2 · 14`,
  `R3 · 13`; round counter advances on its own (`ROUND 3 / 8`); bells at each flip,
  slightly softer each time. Athlete loop continues, a touch slower — he's tiring.
- **0:09–0:11** — **Rest refusal beat.** During a rest window, the Cursor darts to the
  Next control and clicks. The control shakes horizontally twice (4px, 0.3s total) and
  stays put; the rest countdown continues untouched. Cursor retreats. No annotation,
  no wink — move on. *VO sync: "A required rest can't be skipped."*
- **0:11–0:14** — Round 4 completes at compression; split `R4 · 13` locks in. The
  splits list now shows four rows, each stamped with its effort.
  *VO sync: "Each window closes as a split — tied to its effort, reps included"*
  (the line plays across beats 0:06–0:14 in the read; the visual order bells →
  splits → refusal is the sync that matters).
- **0:14–0:16** — Camera eases back 10%. Marker hand underlines the splits list once:
  **"logged as it happened."** Timer keeps running behind (round 5 pending) — we leave
  mid-session. *VO sync: "execution is the logging."* Cut on settled frame.

## Canonical assets
UI-2 Timer; dataset T-1 (R1–R4 shown: 14, 14, 13, 13); bell SFX = the app's bell
(production-rules audio rule); CHAR-1 poses P3a/P3b.

## Continuity
- In: the promised click from Scenes 2–3. Out: same session, live, round 5 about to
  start → Scene 5 is this session on the big screen; splits and round count carry over
  identically.

## Production notes
- *Verify before render:* exact Next/rest-lock copy and splits wording against the
  current build; match the build, not this file, if they differ.
- Two-frame burpee loop only; no in-between frames (character-sheet rule).
