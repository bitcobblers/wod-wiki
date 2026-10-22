# UI & Asset Consistency Guide — wod.wiki Explainer

**Rule #1, above all others:** the app on screen is *the* app. Every UI screen in the
video is traced from the real wod.wiki build (screenshots at production time), simplified
only by cropping chrome — never redesigned, recolored, or "video-ified." The visitor
scrolls from this video into the live demo; the two must feel like one product.

## Typography (verified in the app build)
- **Inter** — all UI text, labels, headings, end card. (`apps/playground/src/index.css`)
- **JetBrains Mono** — everything the language touches: markdown fences, statement
  text, timer digits, splits, tables, WQL queries, data values.
- Hand/marker text (CHAR-2 annotations) is the only non-app typeface allowed, and it
  is ink, not a font — drawn, slightly wobbled, warm red-orange.

## Palette
- Board background = the app's page background (warm off-white), **not** pure white —
  so scene cuts and the final page reveal feel continuous with the site.
- UI neutrals: the app's warm grays. Text: app ink color.
- **One accent:** the app's primary action color, sampled from the current build at
  production time (`ACCENT_HEX: sample from build — do not invent`). It is used for:
  run button, fragment highlights, click ripple, remote split-button ring, chart
  emphasis. Nothing else gets the accent.
- Marker ink (annotations only): warm red-orange, deliberately *not* the accent.
- Rest state on the timer uses the app's own rest styling, sampled like the accent.

## Canonical screens (trace, don't invent)
- **UI-1 · Editor:** markdown note page; prose in Inter, the ` ```time ` fence as a code
  block in JetBrains Mono; the app's real Run affordance on the block.
- **UI-2 · Timer:** giant JetBrains Mono countdown; round indicator (`ROUND n / 8`);
  current effort name; Next/split control; splits list (effort, window, reps) at the
  side; rest state visually distinct; bells on transitions; required rest locks Next
  until elapsed (behavior per the product guide — confirm copy against the build).
- **UI-3 · Results table:** journal page with the finished session as a table —
  round, effort, reps, split — under the original block on the same note.
- **UI-4 · Dashboard:** WQL query bar on top (JetBrains Mono query text), chart tiles
  in a grid below; chart styling = app's charts (bar, timeseries), never generic
  infographic style.

## Dataset T-1 — the canonical Tabata (the video's single source of truth)
The workout text is verbatim from the product guide (protocols.md):

```time
(8)
  :20 Max Effort Burpees
  :10 Rest
```

Per-round reps (splits), fixed for every scene that shows a number:
`R1 14 · R2 14 · R3 13 · R4 13 · R5 12 · R6 12 · R7 11 · R8 11` — **total 100 reps.**

- Scenes 2–3 show the text; Scene 4 fills splits R1–R4; Scene 5 continues R5–R6;
  Scene 6 shows the full table and charts built from exactly these values.
- No scene may invent, round, or "improve" a number. If the dataset ever changes,
  it changes here first, and every rendered scene is re-checked against this page.

## Secondary example assets (Scene 3 fan-out only)
- `10 KB Swing @24kg` — reps + effort + equipment + load.
- `400m Run` — distance.
- Metric chips (the collectable types, in VO order): **reps · load · distance ·
  time · calories · METs**. Chips are app-styled pills (JetBrains Mono text), not
  marker drawings.

## Scene 7 addendum — community & storage assets
- **UI-5 · Notebook card:** a note/collection page rendered as a shareable card —
  notebook title (`Tabata Collection`), a small GitHub mark on the publish action,
  and an app-styled **Subscribe** button. Used twice in Scene 7: on the publisher's
  shelf and, as a copy, inside the subscriber's laptop. Same card both times.
- **Storage chips (app-styled pills, in this fixed order):** **Browser** ·
  **SQLite — yours** · **Turso sync**. The SQLite chip is drawn larger than the Turso
  cloud glyph; the sync element is an *arc* between them, never a container — Turso
  moves copies (sync/backup), the data lives in the browser or the user's database.
- No padlock imagery anywhere in Scene 7 — it is the deliberate inverse of Scene 1's
  locked cloud.

## Statement grammar (for any text shown being parsed)
Fragment order per the syntax reference:
`[lap] [rounds] [timer] [reps] [effort] [@ load] [distance] [rest] [// comment]`.
Any workout text that appears in any scene must parse under this grammar — if it
wouldn't run in the app, it doesn't go in the video.
