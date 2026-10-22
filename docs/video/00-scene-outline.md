# wod.wiki Explainer Video — Scene Outline (90-second cut)

**What this is:** a whiteboard-style explainer that lives on the landing page, directly
above the live demo. It gets a first-time visitor from "what is this?" to "I get it —
let me try it" in about a minute and a half, then hands them to the real application
below.

**The product story in one line:** you write markdown → the markdown either logs metrics
directly or becomes a timer that logs metrics for you → you browse and aggregate those
metrics with WQL in interactive dashboards. Obsidian (your files, your words) meets a gym
timer (execution that records) meets Datadog (queries and dashboards over the data).

**Format:** 7 scenes, each rendered as its own clip and edited together on the timeline
below. Whiteboard framing (hand, marker annotations, one recurring athlete character)
wrapped around app screens drawn faithfully from the real wod.wiki UI, so the video
feels like the app the visitor is about to scroll into.

**Narration:** Sergei narrates. Total script 235 words ≈ 90 seconds at a natural pace;
the assembled timeline is 1:33, with the extra seconds as air between scenes. Per-scene
scripts and second-by-second animation specs are in the `scenes/` files.

## Timeline & scenes

| # | Scene | Time | Key points |
|---|-------|------|-----------|
| 1 | The Problem | 0:00–0:13 | Apps force their structure and wizards; they keep your data; planner + timer + spreadsheet never talk to each other. |
| 2 | Just Type It | 0:13–0:25 | Type the workout, wrap it in a ` ```time ` block. The canonical Tabata from the product guide. One click runs it. |
| 3 | Anatomy of a Statement | 0:25–0:41 | The zoom: `:20` the clock, effort, reps collected live; a line can also carry load, distance, calories, METs. The statement declares it; the timer collects it. |
| 4 | It Runs, and It Counts | 0:41–0:57 | Click → real timer; bells, auto-advancing rounds, splits locked to efforts. Rest refusal stays in. Execution is the logging. |
| 5 | Built for the Home Gym | 0:57–1:08 | Chromecast to the TV; splits from the TV remote or a Bluetooth keyboard; phone stays on the floor. |
| 6 | From Results to Answers | 1:08–1:20 | Finished session is already a results table; WQL questions become charts and dashboards. The Datadog beat. |
| 7 | Publish & Subscribe | 1:20–1:33 | Publish a notebook to GitHub, anyone can subscribe. Data stays in your browser or your own database, synced/backed up with Turso. Ends: keep scrolling, the demo below is live. |

## Decisions (locked 2026-10-20)

1. **"Distributed"** = community distribution: notebooks are published on GitHub and
   other users subscribe to them; the data itself lives in the browser or a self-hosted
   SQLite, with Turso providing sync and backup. Scene 7 is built on this.
2. **Runtime: 90 seconds.** The 3.5-minute draft was cut to a 235-word narration;
   scenes 3 and 5 carry proportionally less, the story beats are unchanged.
3. **Narration: Sergei himself.** Scripts in the scene files are written as clean
   read-aloud copy with delivery notes; the voice-lock rule in the character sheet now
   means one narrator (Sergei), one mic setup, one session where possible.
4. **Rest refusal stays** — the half-second beat where the timer won't skip a required
   rest is in Scene 4's spec.

## Companion documents

- `scenes/scene-01…07-*.md` — per-scene production files: narration script, exact
  on-screen text, second-by-second animation instructions, continuity notes.
- `reference/characters.md` — the stable cast: athlete, hand, cursor, devices, narrator.
- `reference/ui-and-asset-guide.md` — canonical app screens, fonts, palette, and the one
  canonical dataset (Tabata splits) that must stay identical in every scene.
- `reference/production-rules.md` — canvas, transitions, audio, naming, and the
  per-render consistency checklist.
