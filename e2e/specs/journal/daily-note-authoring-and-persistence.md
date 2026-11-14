---
domain: journal
specFile: e2e/live-app/daily-note-authoring-and-persistence.e2e.ts
routes: [/journal, /day/:date, /plan, /note/:noteId, /page/:slug]
personas: [Athlete]
viewports: [desktop]
priority: P0-gate
---

# JRN-02 — Daily note authoring and persistence

The journal day page (`/day/:date`) is the athlete's primary writing surface.
An unseeded date must render a clean empty state without auto-seeding a template,
a seeded date must load its Note, lines typed into the editor or flushed via
`Ctrl+S` / WYSIWYG controls must reach IndexedDB across SPA navigation, hard
reloads, and inline workout launches, and cloning a placed Note must preserve
lineage without inheriting the source Note's named-page slug. All isolated dates
are far-future (`2099-07-01..06`) so they never collide with real entries.

### Scenario 1: An unseeded date renders an empty state while a seeded date loads its Note into the day editor

Given an athlete with an unseeded date 2099-07-04 and a Note seeded for 2099-07-01:
1. Athlete opens unseeded '/day/2099-07-04', then opens seeded '/day/2099-07-01' and reads the day editor.
- expect: unseeded '/day/2099-07-04' mounts no auto-seeded editor and emits zero `NOTE_NOT_FOUND` or console errors.
- expect: '/day/2099-07-01' renders the seeded line 'Bike 40min zone 2' and reflects the journal date in the page heading.
- expect: the browser console stays clean.

### Scenario 2: A line typed before autosave survives navigation

Given an athlete whose journal holds a Note seeded for 2099-07-02:
1. Athlete opens '/day/2099-07-02' and types the line 'Cooldown: mobility flow + stretch'.
2. Athlete immediately clicks the back control to '/journal' before the save debounce settles.
3. Athlete reopens '/day/2099-07-02'.
- expect: the persisted IndexedDB content for the day contains 'Cooldown: mobility flow + stretch' — navigation never drops the final write.
- expect: the reopened day editor shows the typed line.
- expect: the browser console stays clean.

### Scenario 3: Authored content survives a full page reload

Given an athlete whose journal holds a Note seeded for 2099-07-03:
1. Athlete opens '/day/2099-07-03' and logs the line 'Score: 6 rounds + 4'.
2. Athlete hard-reloads '/day/2099-07-03' (full page navigation).
- expect: the persisted IndexedDB content for the day contains 'Score: 6 rounds + 4'.
- expect: the reloaded day editor shows the authored line.
- expect: the browser console stays clean.

### Scenario 4: Same-line typing without newline survives immediate hard navigation and /plan window resolves dated entries

Given an athlete whose journal holds a Note seeded for today's date:
1. Athlete opens today's journal day editor, appends ' — Mobility finisher' on the same line without pressing Enter, and immediately navigates to '/plan' via full page load (`page.goto('/plan')`).
2. Athlete inspects the rewritten `/journal?mode=plan` window and reopens today's day editor.
- expect: '/plan' resolves today's dated entry inside the default 2-week planning window without a contradictory `0 of 0` status strip.
- expect: the reopened day editor retains ' — Mobility finisher' persisted via unload staging.
- expect: the browser console stays clean.

### Scenario 5: Explicit Ctrl+S flush, live WYSIWYG task/table edits, and inline workout launch persist cleanly

Given an athlete whose journal holds a Note seeded for 2099-07-05 with a task checkbox, a GFM table, and a `time` workout block:
1. Athlete opens '/day/2099-07-05', toggles the WYSIWYG task checkbox, edits a GFM table cell inline ('Squat' -> 'Front Squat'), appends single-line text without pressing Enter, and presses `ControlOrMeta+s`.
2. Athlete clicks the workout block's inline Play/Run control on '/day/2099-07-05'.
- expect: Step 1 persists `- [x] Warmup mobility`, `Front Squat`, and the single-line `Ctrl+S` draft into IndexedDB without blurring the editor.
- expect: Step 2 launches the inline workout Session (`Stop` control visible) with zero `NOTE_NOT_FOUND` or console errors.

### Scenario 6: Cloning a placed Note clears the inherited named-page slug, preserves lineage backlink, and lists both Notes on the shared Journal day

Given an athlete whose journal holds a Note seeded for 2099-07-06:
1. Athlete opens `/note/journal%2F2099-07-06`, places it on named page `e2e-orig-<stamp>`, then opens `Clone`, verifies the named-page slug field starts empty, assigns `e2e-clone-<stamp>`, and submits the clone.
2. Athlete inspects the cloned `/note/:noteId` header and opens `/day/2099-07-06` across a hard reload.
- expect: Step 1 redirects to a fresh UUID `/note/:noteId` displaying `/page/e2e-clone-<stamp>` and `Cloned from`, never inheriting `/page/e2e-orig-<stamp>`.
- expect: Step 2 lists `2 notes` on `/day/2099-07-06` across reload with a clean browser console.
