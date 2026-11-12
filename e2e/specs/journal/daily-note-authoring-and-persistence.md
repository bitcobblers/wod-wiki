---
domain: journal
specFile: e2e/live-app/daily-note-authoring-and-persistence.e2e.ts
routes: [/journal, /day/:date, /plan]
personas: [Athlete]
viewports: [desktop]
priority: P0-gate
---

# JRN-02 — Daily note authoring and persistence

The journal day page (`/day/:date`) is the athlete's primary writing surface.
A seeded date must load its note, a line typed into the editor must reach
IndexedDB even when the athlete navigates away before the autosave debounce
fires, and authored content must survive a full page reload. All dates are
far-future (2099-07-01..03) so they never collide with real entries.

### Scenario 1: A seeded date loads its note into the day editor

Given an athlete whose journal holds a note seeded for 2099-07-01:
1. Athlete opens '/day/2099-07-01'.
2. Athlete reads the day editor.
- expect: the seeded line 'Bike 40min zone 2' renders in the day editor.
- expect: the page title reflects the journal date.
- expect: the browser console stays clean.

### Scenario 2: A line typed before autosave survives navigation

Given an athlete whose journal holds a note seeded for 2099-07-02:
1. Athlete opens '/day/2099-07-02' and types the line 'Cooldown: mobility flow'.
2. Athlete immediately clicks the back control to '/journal' before the save debounce settles.
3. Athlete reopens '/day/2099-07-02'.
- expect: the persisted IndexedDB content for the day contains 'Cooldown: mobility flow' — navigation never drops the final write.
- expect: the reopened day editor shows the typed line.
- expect: the browser console stays clean.

### Scenario 3: Authored content survives a full page reload

Given an athlete whose journal holds a note seeded for 2099-07-03:
1. Athlete opens '/day/2099-07-03' and logs the line 'Score: 6 rounds + 4'.
2. Athlete hard-reloads '/day/2099-07-03' (full page navigation).
- expect: the persisted IndexedDB content for the day contains 'Score: 6 rounds + 4'.
- expect: the reloaded day editor shows the authored line.
- expect: the browser console stays clean.

### Scenario 4: Same-line typing without newline survives immediate hard navigation and /plan window resolves dated entries

Given an athlete whose journal holds a note seeded for today's date:
1. Athlete opens today's journal day editor, appends ' — Mobility finisher' on the same line without pressing Enter, and immediately navigates to '/plan' via full page load (`page.goto('/plan')`).
2. Athlete inspects the rewritten `/journal?mode=plan` window and reopens today's day editor.
- expect: '/plan' resolves today's dated entry inside the default 2-week planning window without a contradictory `0 of 0` status strip.
- expect: the reopened day editor retains ' — Mobility finisher' persisted via unload staging.
- expect: the browser console stays clean.
