# Scene 2 — Just Type It
*Slot: 2 of 7 · Timeline 0:13–0:25 · Runtime 12s*

**Job of the scene:** the relief. Planning is typing text and wrapping it in a timer
block. Verbatim canonical Tabata from the product guide — the video and the docs can
never disagree.

## Narration script (32 words ≈ 12s)
*Delivery: lighter, quicker than Scene 1. Small smile in the voice on "That's the whole setup."*
> wod.wiki starts with text. Type it, wrap it in a timer block. A Tabata: eight
> rounds, twenty seconds of burpees, ten of rest. That's the whole setup — and one
> click runs it.

## On-screen text (exact — dataset T-1 text)
Note title (Inter): `Tuesday — Tabata`. Inside the fence (JetBrains Mono):
```time
(8)
  :20 Max Effort Burpees
  :10 Rest
```
Marker annotation at 0:21: **"that's the whole workout"**

## Animation spec (second by second)
- **0:00–0:01** — Board wipes clean (top-to-bottom, 0.6s). A markdown note (UI-1)
  fades in center-frame: title plus two lines of light prose, cursor blinking at the
  end of a blank line.
- **0:01–0:03** — Athlete (CHAR-1, P1) at the note's left, smaller than Scene 1 —
  the UI is the hero now. Keystroke sounds; ` ```time ` types in; the code-block frame
  draws around the empty block in the app's fence styling.
  *VO sync: "Type it, wrap it in a timer block."*
- **0:03–0:08** — The three lines type in, character by character (~14 chars/sec),
  with a natural half-beat before `(8)`. As each line completes, its weight shifts
  subtly from typed gray to the app's rendered statement black — first hint the text
  is alive. *VO sync: the Tabata sentence runs over this typing.*
- **0:08–0:10** — Typing stops. The block sits complete and still for a full second —
  let the simplicity land. *VO sync: "That's the whole setup."*
- **0:10–0:11** — Marker hand underlines the block once: "that's the whole workout."
- **0:11–0:12** — The app's real Run button (UI-1) pulses once. Cursor (CHAR-3) enters
  from bottom-right and moves toward the line `:20 Max Effort Burpees` — *not* the Run
  button — and the camera begins a slow push-in on that line. Cut mid-push-in.
  *VO sync: "and one click runs it" lands as the push-in starts — the click itself is
  withheld until Scene 4.*

## Canonical assets
UI-1 Editor; CHAR-3 Cursor; dataset T-1 originates here.

## Continuity
- In: wipe from Scene 1. Out: camera mid-push-in on the work line → Scene 3 continues
  the identical zoom with no cut in the motion. The block must not move, resize, or
  restyle across Scenes 2 → 3 → 4. This is one continuous shot in three renders.

## Production notes
- No other fences, buttons, or features on screen. Simplicity is the shot.
- Keystroke sample set = production-rules canonical set.
